/**
 * The `bmesh_query.cc`, `bmesh_polygon.cc` and `bmesh_mesh_normals.cc` functions that bevel needs and
 * that `src/bmesh` does not export yet.
 *
 * Everything here is a general-purpose BMesh query and belongs next to its neighbours in
 * `src/bmesh/structure.ts`; it is private to the bevel port only because the parent owns those files
 * this session. The report lists them as promotion candidates.
 *
 * Positions and normals are read out into fresh arrays by {@link co}, {@link fno} and {@link vno}
 * rather than aliased the way C aliases `v->co`. That is a deliberate cost: `bmesh_bevel.cc` passes
 * `v->co` straight into functions that also write their destination, and silently aliasing a live
 * vertex position would be a class of bug that is very hard to see.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, edgeIsManifold, radialLoops} from '../bmesh/structure'
import {
    M3, V3, angleNormalizedV3V3, axisDominantV3ToM3, crossV3V3V3, dotV3V3, lenV3V3, midV3V3V3,
    mulV2M3V3, normalizeV3, nv3, subV3V3V3,
} from './bevel-math'

/** A vertex position as a fresh array. Blender's `v->co`. */
export const co = (v: BMVert): V3 => [v.x, v.y, v.z]

/** Write a position back to a vertex. */
export function setCo(v: BMVert, a: readonly number[]): void {
    v.x = a[0]
    v.y = a[1]
    v.z = a[2]
}

/** A face normal as a fresh array. Blender's `f->no`. Valid only after a normals update. */
export const fno = (f: BMFace): V3 => [f.nx, f.ny, f.nz]

/** A vertex normal as a fresh array. Blender's `v->no`. */
export const vno = (v: BMVert): V3 => [v.nx, v.ny, v.nz]

/** `BM_edge_other_vert` - `BMEdge.otherVert`, but tolerating a vertex that is not on the edge. */
export function edgeOtherVert(e: BMEdge, v: BMVert): BMVert {
    return e.v1 === v ? e.v2 : e.v1
}

/** `BM_edge_calc_length` (`bmesh_query.cc:540`). */
export function edgeCalcLength(e: BMEdge): number {
    return lenV3V3(co(e.v1), co(e.v2))
}

/** `BM_face_vert_share_loop` (`bmesh_query.cc:1114`). */
export function faceVertShareLoop(f: BMFace, v: BMVert): BMLoop | null {
    let l = f.lFirst
    do {
        if (l.v === v) return l
        l = l.next
    } while (l !== f.lFirst)
    return null
}

/** `BM_face_edge_share_loop` (`bmesh_query.cc:1129`). */
export function faceEdgeShareLoopQ(f: BMFace, e: BMEdge): BMLoop | null {
    const lFirst = e.l
    if (!lFirst) return null
    let l: BMLoop = lFirst
    do {
        if (l.f === f) return l
        l = l.radialNext!
    } while (l !== lFirst)
    return null
}

/**
 * `BM_edge_loop_pair` (`bmesh_query.cc:565`) - the two loops of a manifold edge, in radial order.
 * False when the edge is a boundary or non-manifold.
 */
export function edgeLoopPair(e: BMEdge): [BMLoop, BMLoop] | null {
    const la = e.l
    if (!la) return null
    const lb = la.radialNext
    if (!lb || la === lb || lb.radialNext !== la) return null
    return [la, lb]
}

/** `BM_edge_other_loop` (`bmesh_query.cc:448`). */
export function edgeOtherLoop(e: BMEdge, l: BMLoop): BMLoop {
    let lOther = l.e === e ? l : l.prev
    lOther = lOther.radialNext!
    if (lOther.v === l.v) {
        // pass
    } else if (lOther.next.v === l.v) {
        lOther = lOther.next
    }
    return lOther
}

/** `BM_loop_other_vert_loop` (`bmesh_query.cc:71`). */
export function loopOtherVertLoop(l: BMLoop, v: BMVert): BMLoop {
    const e = l.e!
    const vPrev = edgeOtherVert(e, v)
    if (l.v === v) {
        if (l.prev.v === vPrev) return l.next
        return l.prev
    }
    if (l.prev.v === v) return l.prev.prev
    return l.next.next
}

/** `BM_vert_face_check` (`bmesh_query.cc:686`) - does any face use this vertex? */
export function vertFaceCheck(v: BMVert): boolean {
    if (!v.e) return false
    for (const e of diskEdges(v)) {
        if (e.l) return true
    }
    return false
}

/** `BM_edge_is_convex` (`bmesh_query.cc:870`). */
export function edgeIsConvex(e: BMEdge): boolean {
    if (edgeIsManifold(e)) {
        const l1 = e.l!
        const l2 = l1.radialNext!
        const n1 = fno(l1.f)
        const n2 = fno(l2.f)
        if (!(n1[0] === n2[0] && n1[1] === n2[1] && n1[2] === n2[2])) {
            const cross = nv3()
            crossV3V3V3(cross, n1, n2)
            const lDir = nv3()
            subV3V3V3(lDir, co(l1.next.v), co(l1.v))
            return dotV3V3(lDir, cross) > 0
        }
    }
    return true
}

/** `BM_edge_calc_face_angle_signed_ex` (`bmesh_query.cc:1383`) - negative for a concave edge. */
export function edgeCalcFaceAngleSignedEx(e: BMEdge, fallback: number): number {
    if (edgeIsManifold(e)) {
        const l1 = e.l!
        const l2 = l1.radialNext!
        const angle = angleNormalizedV3V3(fno(l1.f), fno(l2.f))
        return edgeIsConvex(e) ? angle : -angle
    }
    return fallback
}

/** `BM_face_calc_center_bounds` (`bmesh_polygon.cc:617`) - the centre of the bounding box, not the median. */
export function faceCalcCenterBounds(f: BMFace, rCent: V3): void {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    let l = f.lFirst
    do {
        for (let i = 0; i < 3; i++) {
            const x = i === 0 ? l.v.x : i === 1 ? l.v.y : l.v.z
            if (x < min[i]) min[i] = x
            if (x > max[i]) max[i] = x
        }
        l = l.next
    } while (l !== f.lFirst)
    midV3V3V3(rCent, min, max)
}

/** `isect_point_poly_v2` (`math_geom.cc:1533`) - the crossing-number test. */
export function isectPointPolyV2(pt: readonly number[], verts: readonly (readonly number[])[], nr: number): boolean {
    let isect = false
    for (let i = 0, j = nr - 1; i < nr; j = i++) {
        if (((verts[i][1] > pt[1]) !== (verts[j][1] > pt[1])) &&
            (pt[0] < (verts[j][0] - verts[i][0]) * (pt[1] - verts[i][1]) / (verts[j][1] - verts[i][1]) + verts[i][0])) {
            isect = !isect
        }
    }
    return isect
}

/** `BM_face_point_inside_test` (`bmesh_polygon.cc:1081`) - in the face's own plane. */
export function facePointInsideTest(f: BMFace, point: readonly number[]): boolean {
    const axisMat: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    axisDominantV3ToM3(axisMat, fno(f))
    const co2d = [0, 0]
    mulV2M3V3(co2d, axisMat, point)
    const projverts: number[][] = []
    let l = f.lFirst
    for (let i = 0; i < f.len; i++) {
        const p = [0, 0]
        mulV2M3V3(p, axisMat, co(l.v))
        projverts.push(p)
        l = l.next
    }
    return isectPointPolyV2(co2d, projverts, f.len)
}

// region normals

/**
 * `BM_face_calc_normal` (`bmesh_polygon.cc:824`) written into `f->no`.
 *
 * Triangles and quads do not go through Newell: Blender uses `normal_tri_v3` and the cross of a
 * quad's two diagonals, which for a non-planar quad is a different answer, so the special cases are
 * not an optimisation.
 *
 * (`bmesh/interp.ts` exports `faceCalcNormal` with the same body but returning a value; this writes
 * the normal onto the face, which `faceNormalUpdate` needs and that one does not do.)
 */
export function faceNormalUpdate(f: BMFace): void {
    const n = nv3()
    if (f.len === 4) {
        const l0 = f.lFirst, l1 = l0.next, l2 = l1.next, l3 = l2.next
        const a = nv3(), b = nv3()
        subV3V3V3(a, co(l0.v), co(l2.v))
        subV3V3V3(b, co(l1.v), co(l3.v))
        crossV3V3V3(n, a, b)
    } else if (f.len === 3) {
        const l0 = f.lFirst, l1 = l0.next, l2 = l1.next
        const a = nv3(), b = nv3()
        subV3V3V3(a, co(l0.v), co(l1.v))
        subV3V3V3(b, co(l1.v), co(l2.v))
        crossV3V3V3(n, a, b)
    } else {
        // `bm_face_calc_poly_normal` - Newell's method over the loop cycle.
        let lPrev = co(f.lFirst.prev.v)
        let l = f.lFirst
        do {
            const lCurr = co(l.v)
            n[0] += (lPrev[1] - lCurr[1]) * (lPrev[2] + lCurr[2])
            n[1] += (lPrev[2] - lCurr[2]) * (lPrev[0] + lCurr[0])
            n[2] += (lPrev[0] - lCurr[0]) * (lPrev[1] + lCurr[1])
            lPrev = lCurr
            l = l.next
        } while (l !== f.lFirst)
    }
    normalizeV3(n)
    f.nx = n[0]
    f.ny = n[1]
    f.nz = n[2]
}

/**
 * `bm_vert_calc_normals_impl` (`bmesh_mesh_normals.cc:85`) - adjacent face normals weighted by the
 * corner angle each subtends at `v`.
 *
 * The sign flip is Blender's and is load-bearing: the corner angle is computed from *edge* vectors,
 * which run `v1 -> v2` rather than away from the vertex, so when exactly one of the two edges runs
 * backwards relative to its loop the dot product must be negated. Getting the exclusive-or wrong
 * weights some corners by their supplement instead.
 */
export function vertNormalUpdate(v: BMVert): void {
    const n = nv3()
    if (v.e) {
        for (const eIter of diskEdges(v)) {
            const lFirst = eIter.l
            if (!lFirst) continue
            const e2diff = nv3()
            subV3V3V3(e2diff, co(eIter.v1), co(eIter.v2))
            normalizeV3(e2diff)
            let lIter: BMLoop = lFirst
            do {
                if (lIter.v === v) {
                    const ePrev = lIter.prev.e!
                    const e1diff = nv3()
                    subV3V3V3(e1diff, co(ePrev.v1), co(ePrev.v2))
                    normalizeV3(e1diff)
                    let dotprod = dotV3V3(e1diff, e2diff)
                    if ((ePrev.v1 === lIter.prev.v) !== (lIter.e!.v1 === lIter.v)) {
                        dotprod = -dotprod
                    }
                    const fac = Math.acos(Math.min(1, Math.max(-1, -dotprod)))
                    n[0] += lIter.f.nx * fac
                    n[1] += lIter.f.ny * fac
                    n[2] += lIter.f.nz * fac
                }
                lIter = lIter.radialNext!
            } while (lIter !== lFirst)
        }
        if (normalizeV3(n) !== 0) {
            v.nx = n[0]
            v.ny = n[1]
            v.nz = n[2]
            return
        }
    }
    // Blender's fallback for a loose vertex: point away from the origin.
    const fallback = co(v)
    normalizeV3(fallback)
    v.nx = fallback[0]
    v.ny = fallback[1]
    v.nz = fallback[2]
}

/**
 * `BM_mesh_normals_update`. Bevel reads `f->no` and `v->no` throughout and edit mode guarantees they
 * are current; nothing in this kernel maintains them, so the operator refreshes the whole mesh on
 * entry. This is the same deliberate side effect `ops/inset.ts` documents.
 */
export function normalsUpdate(bm: BMesh): void {
    for (const f of bm.faces) faceNormalUpdate(f)
    for (const v of bm.verts) vertNormalUpdate(v)
}

// endregion

/** Every loop using `v`, in no particular order. `BM_LOOPS_OF_VERT`. */
export function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    if (!v.e) return
    for (const e of [...diskEdges(v)]) {
        if (!e.l) continue
        for (const l of radialLoops(e)) {
            if (l.v === v) yield l
        }
    }
}

/** Every face using `v`. `BM_FACES_OF_VERT`. */
export function facesOfVert(v: BMVert): BMFace[] {
    const out: BMFace[] = []
    for (const l of loopsOfVert(v)) {
        if (!out.includes(l.f)) out.push(l.f)
    }
    return out
}
