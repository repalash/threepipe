/**
 * Face geometry: the `BM_face_calc_*` family from `bmesh/intern/bmesh_polygon.cc`.
 *
 * This exists because four different ports each needed a face normal and each wrote its own - three
 * faithful to Blender's tri/quad special cases and one Newell-only.
 *
 * Worth knowing, because it is easy to assume otherwise: for a quadrilateral the diagonal cross
 * `normal_quad_v3` uses and Newell's sum are the *same vector*, planar or not - the identity holds
 * for any four points. Blender's special cases are a shortcut, not a different answer. So the four
 * copies did agree on direction; where they differed was on degenerate faces, where one returned the
 * zero vector and another fell back to +Z. One implementation, one answer.
 */

import {BMFace} from './types'
import {Vec3, v3cross, v3normalize, v3sub} from '../math'

const co = (v: {x: number, y: number, z: number}): Vec3 => [v.x, v.y, v.z]

/** `normal_tri_v3` (`math_geom.cc:45`): the normalised cross of two edge directions. */
export function normalTriV3(
    v1: {x: number, y: number, z: number},
    v2: {x: number, y: number, z: number},
    v3: {x: number, y: number, z: number},
): Vec3 {
    return v3normalize(v3cross(v3sub(co(v1), co(v2)), v3sub(co(v2), co(v3))))
}

/**
 * `normal_quad_v3` (`math_geom.cc:62`): the normalised cross of the two diagonals.
 *
 * Equal to Newell's sum over the four corners for any quad, planar or not; Blender uses this form
 * because it is four subtractions and one cross rather than four of each.
 */
export function normalQuadV3(
    v1: {x: number, y: number, z: number},
    v2: {x: number, y: number, z: number},
    v3: {x: number, y: number, z: number},
    v4: {x: number, y: number, z: number},
): Vec3 {
    return v3normalize(v3cross(v3sub(co(v1), co(v3)), v3sub(co(v2), co(v4))))
}

/** `bm_face_calc_poly_normal` (`bmesh_polygon.cc:54`): Newell's method over the loop cycle. */
export function faceCalcPolyNormal(f: BMFace): Vec3 {
    const n: Vec3 = [0, 0, 0]
    let prev = f.lFirst.prev.v
    let l = f.lFirst
    do {
        const curr = l.v
        n[0] += (prev.y - curr.y) * (prev.z + curr.z)
        n[1] += (prev.z - curr.z) * (prev.x + curr.x)
        n[2] += (prev.x - curr.x) * (prev.y + curr.y)
        prev = curr
        l = l.next
    } while (l !== f.lFirst)

    const normalised = v3normalize(n)
    // Blender falls back to +Z for a degenerate face rather than leaving a zero vector, so that
    // anything reading the normal gets a unit vector.
    return normalised[0] === 0 && normalised[1] === 0 && normalised[2] === 0 ? [0, 0, 1] : normalised
}

/**
 * `BM_face_calc_normal` (`bmesh_polygon.cc:824`).
 *
 * Triangles and quads take their own closed forms; everything else goes through Newell.
 */
export function faceCalcNormal(f: BMFace): Vec3 {
    let l = f.lFirst
    switch (f.len) {
    case 4: {
        const v1 = l.v
        const v2 = (l = l.next).v
        const v3 = (l = l.next).v
        const v4 = l.next.v
        return normalQuadV3(v1, v2, v3, v4)
    }
    case 3: {
        const v1 = l.v
        const v2 = (l = l.next).v
        const v3 = l.next.v
        return normalTriV3(v1, v2, v3)
    }
    default:
        return faceCalcPolyNormal(f)
    }
}

/** `BM_face_normal_update` (`bmesh_polygon.cc:838`): recompute and store the face's cached normal. */
export function faceNormalUpdate(f: BMFace): void {
    const n = faceCalcNormal(f)
    f.nx = n[0]
    f.ny = n[1]
    f.nz = n[2]
}
