/**
 * Per-face evaluation helpers of `blenkernel/intern/mesh_evaluate.cc` (`bke::mesh::face_area_calc` :67,
 * `face_center_calc` :45) with the `blenlib/intern/math_geom.cc` / `math_vector.cc` functions they call,
 * float32 per operation as Blender computes them.
 */

import {f32} from '../blender/f32'
import type {V3} from '../blender/math/vec'

/** `cross_tri_v3` (`math_geom.cc:30`). */
function crossTriV3(positions: ArrayLike<number>, a: number, b: number, c: number): V3 {
    const n1 = [f32(positions[a] - positions[b]), f32(positions[a + 1] - positions[b + 1]), f32(positions[a + 2] - positions[b + 2])]
    const n2 = [f32(positions[b] - positions[c]), f32(positions[b + 1] - positions[c + 1]), f32(positions[b + 2] - positions[c + 2])]
    return [
        f32(f32(n1[1] * n2[2]) - f32(n1[2] * n2[1])),
        f32(f32(n1[2] * n2[0]) - f32(n1[0] * n2[2])),
        f32(f32(n1[0] * n2[1]) - f32(n1[1] * n2[0])),
    ]
}

/** `len_v3` (`math_vector_inline.cc:775`): `sqrtf(dot_v3v3(a, a))`. */
function lenV3(n: ArrayLike<number>): number {
    return f32(Math.sqrt(f32(f32(f32(n[0] * n[0]) + f32(n[1] * n[1])) + f32(n[2] * n[2]))))
}

/** `cross_poly_v3` (`math_geom.cc:172`): Newell's method with `add_newell_cross_v3_v3v3` (`math_vector_inline.cc:700`). */
export function crossPolyV3(positions: ArrayLike<number>, cornerVerts: ArrayLike<number>, start: number, end: number): V3 {
    let nx = 0, ny = 0, nz = 0
    let p = cornerVerts[end - 1] * 3
    for (let k = start; k < end; k++) {
        const c = cornerVerts[k] * 3
        nx = f32(nx + f32(f32(positions[p + 1] - positions[c + 1]) * f32(positions[p + 2] + positions[c + 2])))
        ny = f32(ny + f32(f32(positions[p + 2] - positions[c + 2]) * f32(positions[p] + positions[c])))
        nz = f32(nz + f32(f32(positions[p] - positions[c]) * f32(positions[p + 1] + positions[c + 1])))
        p = c
    }
    return [nx, ny, nz]
}

/**
 * `bke::mesh::face_area_calc` (`mesh_evaluate.cc:67`): `area_tri_v3` (`math_geom.cc:104`) for triangles,
 * `area_poly_v3` (`math_geom.cc:137`, Newell) for every other face size.
 */
export function faceAreaCalc(positions: ArrayLike<number>, cornerVerts: ArrayLike<number>, start: number, end: number): number {
    if (end - start === 3) {
        const n = crossTriV3(positions, cornerVerts[start] * 3, cornerVerts[start + 1] * 3, cornerVerts[start + 2] * 3)
        return f32(lenV3(n) * 0.5)
    }
    return f32(lenV3(crossPolyV3(positions, cornerVerts, start, end)) * 0.5)
}

/**
 * `bke::mesh::face_center_calc` (`mesh_evaluate.cc:45`): `mid_v3_v3v3v3` / `mid_v3_v3v3v3v3`
 * (`math_vector.cc:202`, `:209`) for triangles and quads, otherwise `face_center_calc_ngon` (:34), the sum of
 * `position * (1.0f / size)`.
 */
export function faceCenterCalc(positions: ArrayLike<number>, cornerVerts: ArrayLike<number>, start: number, end: number): V3 {
    const size = end - start
    const P = (i: number, k: number) => positions[cornerVerts[start + i] * 3 + k]
    if (size === 3) {
        return [0, 1, 2].map(k => f32(f32(f32(P(0, k) + P(1, k)) + P(2, k)) / 3)) as V3
    }
    if (size === 4) {
        return [0, 1, 2].map(k => f32(f32(f32(f32(P(0, k) + P(1, k)) + P(2, k)) + P(3, k)) / 4)) as V3
    }
    const w = f32(1 / size)
    const c: V3 = [0, 0, 0]
    for (let i = 0; i < size; i++) for (let k = 0; k < 3; k++) c[k] = f32(c[k] + f32(P(i, k) * w))
    return c
}
