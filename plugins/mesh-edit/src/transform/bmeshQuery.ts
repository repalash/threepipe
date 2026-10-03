/**
 * BMesh queries the transform needs that the kernel does not export, ported from
 * `bmesh/intern/bmesh_marking.cc`, `bmesh_polygon.cc` and `bmesh_query.cc`.
 */

import {
    BMEdge,
    BMFace,
    BMLoop,
    BMVert,
    BMesh,
    diskEdges,
    edgeIsBoundary,
    ElemFlag,
    faceCalcCenterMedian,
    faceCalcTangentAuto,
    faceNormalUpdate,
} from '@threepipe/mesh-kernel'
import {
    addV3,
    angleNormalizedV3V3,
    crossV3,
    dotV3,
    lenSquaredV3,
    midV3,
    normalizeV3,
    normalizedV3,
    subV3,
    Vec3,
} from './math'

export type BMEditElem = BMVert | BMEdge | BMFace

export const vertCo = (v: BMVert): Vec3 => [v.x, v.y, v.z]
export const vertNo = (v: BMVert): Vec3 => [v.nx, v.ny, v.nz]
export const faceNo = (f: BMFace): Vec3 => [f.nx, f.ny, f.nz]

export function edgeCalcLengthSquared(e: BMEdge): number {
    return lenSquaredV3(subV3(vertCo(e.v1), vertCo(e.v2)))
}

/**
 * `BM_mesh_normals_update`: face normals from the polygon, vertex normals as the corner-angle
 * weighted sum of the adjacent face normals (`bm_vert_calc_normals_accum_loop`).
 */
export function meshNormalsUpdate(bm: BMesh): void {
    for (const f of bm.faces) faceNormalUpdate(f)
    for (const v of bm.verts) {
        const n: Vec3 = [0, 0, 0]
        if (v.e) {
            for (const e of diskEdges(v)) {
                const lFirst = e.l
                if (!lFirst) continue
                const e2diff = normalizedV3(subV3(vertCo(e.v1), vertCo(e.v2)))
                let l: BMLoop = lFirst
                do {
                    if (l.v === v) {
                        const ePrev = l.prev.e!
                        const e1diff = normalizedV3(subV3(vertCo(ePrev.v1), vertCo(ePrev.v2)))
                        let dot = dotV3(e1diff, e2diff)
                        if ((ePrev.v1 === l.prev.v) !== (l.e!.v1 === l.v)) dot = -dot
                        const fac = Math.acos(Math.max(-1, Math.min(1, -dot)))
                        n[0] += l.f.nx * fac
                        n[1] += l.f.ny * fac
                        n[2] += l.f.nz * fac
                    }
                    l = l.radialNext!
                } while (l !== lFirst)
            }
        }
        if (normalizeV3(n) === 0) {
            // A loose vertex: Blender normalises its position as the normal (`bm_vert_calc_normals_impl`).
            const p = vertCo(v)
            if (normalizeV3(p) !== 0) n[0] = p[0], n[1] = p[1], n[2] = p[2]
        }
        v.nx = n[0]
        v.ny = n[1]
        v.nz = n[2]
    }
}

// region edit selection (`bmesh_marking.cc`)

/** `BM_editselection_center` (`bmesh_marking.cc:1044`). */
export function editselectionCenter(elem: BMEditElem): Vec3 {
    if (elem instanceof BMVert) return vertCo(elem)
    if (elem instanceof BMEdge) return midV3(vertCo(elem.v1), vertCo(elem.v2))
    return faceCalcCenterMedian(elem)
}

/** `BM_editselection_normal` (`bmesh_marking.cc:1060`). */
export function editselectionNormal(elem: BMEditElem): Vec3 {
    if (elem instanceof BMVert) return vertNo(elem)
    if (elem instanceof BMEdge) {
        let normal = addV3(vertNo(elem.v1), vertNo(elem.v2))
        const plane = subV3(vertCo(elem.v2), vertCo(elem.v1))
        // The two vertex normals are close but not at right angles to the edge; correct them.
        const vec = crossV3(normal, plane)
        normal = crossV3(plane, vec)
        normalizeV3(normal)
        return normal
    }
    return faceNo(elem)
}

/** `BM_editselection_plane` (`bmesh_marking.cc:1088`). `prev` is the previously selected element. */
export function editselectionPlane(elem: BMEditElem, prev: BMEditElem | null = null): Vec3 {
    if (elem instanceof BMVert) {
        let plane: Vec3
        if (prev) {
            // Use previously selected data to make a useful vertex plane.
            plane = subV3(editselectionCenter(prev), vertCo(elem))
        } else {
            // A fake plane at right angles to the normal.
            const no = vertNo(elem)
            const vec: Vec3 = [0, 0, 0]
            if (no[0] < 0.5) vec[0] = 1
            else if (no[1] < 0.5) vec[1] = 1
            else vec[2] = 1
            plane = crossV3(no, vec)
        }
        normalizeV3(plane)
        return plane
    }
    if (elem instanceof BMEdge) {
        let plane: Vec3
        if (edgeIsBoundary(elem)) {
            plane = subV3(vertCo(elem.l!.v), vertCo(elem.l!.next.v))
        } else {
            // The plane runs along the edge; selecting different edges can swap the direction of the
            // Y axis, so pick by height to make it less likely to flip (`bmesh_marking.cc:1123`).
            plane = elem.v2.y > elem.v1.y ? subV3(vertCo(elem.v2), vertCo(elem.v1)) : subV3(vertCo(elem.v1), vertCo(elem.v2))
        }
        normalizeV3(plane)
        return plane
    }
    return faceCalcTangentAuto(elem)
}

// endregion

// region tangents (`bmesh_polygon.cc`)

/** `bm_vert_tri_find_unique_edge`: the index of the most "unique" edge of a triangle. */
function vertTriFindUniqueEdge(verts: [BMVert, BMVert, BMVert]): number {
    const len = (a: BMVert, b: BMVert) => lenSquaredV3(subV3(vertCo(a), vertCo(b)))
    const lens = [len(verts[0], verts[1]), len(verts[1], verts[2]), len(verts[2], verts[0])]
    const difs = [Math.abs(lens[1] - lens[2]), Math.abs(lens[2] - lens[0]), Math.abs(lens[0] - lens[1])]
    let best = 0
    for (let i = 1; i < 3; i++) if (difs[i] > difs[best]) best = i
    return best
}

/** `BM_vert_tri_calc_tangent_pair_from_edge` (`bmesh_polygon.cc:350`). */
function vertTriCalcTangentPairFromEdge(verts: [BMVert, BMVert, BMVert]): [Vec3, Vec3] {
    const index = vertTriFindUniqueEdge(verts)
    const indexNext = (index + 1) % 3
    const indexPrev = (indexNext + 1) % 3
    const a = normalizedV3(subV3(vertCo(verts[index]), vertCo(verts[indexNext])))
    // Pick the adjacent loop that is least co-linear.
    const vecPrev = subV3(vertCo(verts[indexPrev]), vertCo(verts[index]))
    const vecNext = subV3(vertCo(verts[indexNext]), vertCo(verts[indexPrev]))
    const tmpPrev = crossV3(a, vecPrev)
    const tmpNext = crossV3(a, vecNext)
    const b = normalizedV3(lenSquaredV3(tmpNext) > lenSquaredV3(tmpPrev) ? vecNext : vecPrev)
    return [a, b]
}

/** `bm_face_calc_tangent_pair_from_quad_edge_pair` (`bmesh_polygon.cc:419`). */
function faceCalcTangentPairFromQuadEdgePair(f: BMFace): [Vec3, Vec3] {
    const l0 = f.lFirst
    const v0 = vertCo(l0.v), v1 = vertCo(l0.next.v), v2 = vertCo(l0.next.next.v), v3 = vertCo(l0.next.next.next.v)
    let a = addV3(subV3(v3, v2), subV3(v0, v1))
    let b = addV3(subV3(v0, v3), subV3(v1, v2))
    // `a` always gets the longest edge.
    const la = normalizeV3(a), lb = normalizeV3(b)
    if (la < lb) [a, b] = [b, a]
    return [a, b]
}

/** `BM_face_find_longest_loop` (`bmesh_query.cc:1523`). */
export function faceFindLongestLoop(f: BMFace): BMLoop {
    let lenMaxSq = 0
    let longest = f.lFirst
    let l = f.lFirst
    do {
        const lenSq = lenSquaredV3(subV3(vertCo(l.v), vertCo(l.next.v)))
        if (lenSq >= lenMaxSq) {
            longest = l
            lenMaxSq = lenSq
        }
        l = l.next
    } while (l !== f.lFirst)
    return longest
}

/** `BM_face_calc_tangent_pair_from_edge` (`bmesh_polygon.cc:443`). */
function faceCalcTangentPairFromEdge(f: BMFace): [Vec3, Vec3] {
    const lLong = faceFindLongestLoop(f)
    const a = normalizedV3(subV3(vertCo(lLong.v), vertCo(lLong.next.v)))
    const vecPrev = subV3(vertCo(lLong.prev.v), vertCo(lLong.v))
    const vecNext = subV3(vertCo(lLong.next.v), vertCo(lLong.next.next.v))
    const tmpPrev = crossV3(a, vecPrev)
    const tmpNext = crossV3(a, vecNext)
    const b = normalizedV3(lenSquaredV3(tmpNext) > lenSquaredV3(tmpPrev) ? vecNext : vecPrev)
    return [a, b]
}

/** `BM_face_calc_tangent_pair_auto` (`bmesh_polygon.cc:590`). */
export function faceCalcTangentPairAuto(f: BMFace): [Vec3, Vec3] {
    if (f.len === 3) {
        const l = f.lFirst
        return vertTriCalcTangentPairFromEdge([l.v, l.next.v, l.next.next.v])
    }
    if (f.len === 4) return faceCalcTangentPairFromQuadEdgePair(f)
    return faceCalcTangentPairFromEdge(f)
}

/** `BM_vert_tri_calc_tangent_from_edge` (`bmesh_polygon.cc:341`). */
export function vertTriCalcTangentFromEdge(verts: [BMVert, BMVert, BMVert]): Vec3 {
    const index = vertTriFindUniqueEdge(verts)
    const indexNext = (index + 1) % 3
    return normalizedV3(subV3(vertCo(verts[index]), vertCo(verts[indexNext])))
}

// endregion

// region queries (`bmesh_query.cc`)

/** `BM_vert_edge_pair` (`bmesh_query.cc:602`): the two edges of a vertex with exactly two. */
export function vertEdgePair(v: BMVert): [BMEdge, BMEdge] | null {
    const eA = v.e
    if (eA) {
        const eB = eA.diskNext(v)
        if (eB && eB !== eA && eB.diskNext(v) === eA) return [eA, eB]
    }
    return null
}

/** `BM_edge_ordered_verts` (`bmesh_query.cc:1155`): the edge's verts in the winding of its first face. */
export function edgeOrderedVerts(e: BMEdge): [BMVert, BMVert] {
    const l = e.l!
    return [l.v, l.next.v]
}

/** `BM_edge_exists`: the edge joining two verts, if any. */
export function edgeExists(a: BMVert, b: BMVert): BMEdge | null {
    if (!a.e) return null
    for (const e of diskEdges(a)) if (e.uses(b)) return e
    return null
}

/**
 * `BM_mesh_calc_edge_groups` with `BM_ELEM_SELECT` (`bmesh_query.cc:2267`): selected edges
 * grouped by connectivity through their vertices.
 */
export function meshCalcEdgeGroups(bm: BMesh): BMEdge[][] {
    const groups: BMEdge[][] = []
    const seen = new Set<BMEdge>()
    for (const start of bm.edges) {
        if (!(start.hflag & ElemFlag.Select) || seen.has(start)) continue
        const group: BMEdge[] = []
        const stack = [start]
        seen.add(start)
        while (stack.length) {
            const e = stack.pop()!
            group.push(e)
            for (const v of [e.v1, e.v2]) {
                for (const other of diskEdges(v)) {
                    if (!(other.hflag & ElemFlag.Select) || seen.has(other)) continue
                    seen.add(other)
                    stack.push(other)
                }
            }
        }
        groups.push(group)
    }
    return groups
}

/**
 * `BM_mesh_calc_face_groups` with `BM_ELEM_SELECT` and `htype_step = BM_VERT`
 * (`bmesh_query.cc:2111`): selected faces grouped by any shared vertex.
 */
export function meshCalcFaceGroups(bm: BMesh): BMFace[][] {
    const groups: BMFace[][] = []
    const seen = new Set<BMFace>()
    for (const start of bm.faces) {
        if (!(start.hflag & ElemFlag.Select) || seen.has(start)) continue
        const group: BMFace[] = []
        const stack = [start]
        seen.add(start)
        while (stack.length) {
            const f = stack.pop()!
            group.push(f)
            for (const l of f.eachLoop()) {
                // `BM_LOOPS_OF_LOOP`: every other loop around this loop's vertex.
                for (const e of diskEdges(l.v)) {
                    const lf = e.l
                    if (!lf) continue
                    let r: BMLoop = lf
                    do {
                        const fo = r.f
                        if (fo !== f && fo.hflag & ElemFlag.Select && !seen.has(fo)) {
                            seen.add(fo)
                            stack.push(fo)
                        }
                        r = r.radialNext!
                    } while (r !== lf)
                }
            }
        }
        groups.push(group)
    }
    return groups
}

/** `BM_edge_calc_length_squared`. */
export {edgeIsBoundary}

/** The angle at a corner, for callers that need `BM_loop_calc_face_angle`. */
export function loopCalcFaceAngle(l: BMLoop): number {
    const a = normalizedV3(subV3(vertCo(l.prev.v), vertCo(l.v)))
    const b = normalizedV3(subV3(vertCo(l.next.v), vertCo(l.v)))
    return angleNormalizedV3V3(a, b)
}

// endregion
