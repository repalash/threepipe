import {faceNormalUpdate} from '../bmesh/polygon'
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
import {diskEdges, edgeIsManifold, radialLoops} from '../bmesh/structure'
import {
    M3, V3, angleNormalizedV3V3, axisDominantV3ToM3, crossV3V3V3, dotV3V3, lenV3V3, midV3V3V3,
    mulV2M3V3, nv3, subV3V3V3,
} from './bevel-math'
import {isectPointPolyV2} from '../math/geom'

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
 * `BM_face_normal_update` (`bmesh_polygon.cc:838`).
 *
 * Re-exported rather than re-implemented: this was a fourth copy of the same function, and they
 * differed only in what they returned for a degenerate face.
 */
export {faceNormalUpdate}

/**
 * `BM_mesh_normals_update` is `bmesh/normals.ts` `meshNormalsUpdate`. Like Blender's bevel, the
 * operator reads `f->no` / `v->no` as its caller left them: current, in an edit session or a mesh
 * converted with normals (`bmFromMesh(.., {calcFaceNormal: true, calcVertNormal: true})`).
 */

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
