/**
 * Blender's C rotation/matrix API (`blenlib/intern/math_rotation_c.cc`, `math_matrix_c.cc`,
 * `math_vector.cc`), used by the older function nodes (Rotate Euler, Align Euler to Vector, Vector
 * Rotate). Matrices are `float m[3][3]` flattened `m[i * 3 + j]` = `m[i][j]` (`m[i]` is a column, like
 * `MatBase`). These differ from the C++ `math::` versions in places (`normalize_v3_v3` multiplies by a
 * reciprocal, `mat3_to_eul` uses `EULER_HYPOT_EPSILON`), so the port keeps them apart.
 */

import {f32} from '../f32'
import {angleV3V3, dot3, normalizeV3V3, V3} from './vec'

export type M3 = Float32Array

/**
 * `eul_to_mat3` (`math_rotation_c.cc:1362`). The products are in `double`, but `cos(eul[0])` takes a
 * `float` argument, so C++ overload resolution calls the `float` overload (`cosf`) and widens its result.
 */
export function eulToMat3(eul: ArrayLike<number>): M3 {
    const ci = f32(Math.cos(eul[0])), cj = f32(Math.cos(eul[1])), ch = f32(Math.cos(eul[2]))
    const si = f32(Math.sin(eul[0])), sj = f32(Math.sin(eul[1])), sh = f32(Math.sin(eul[2]))
    const cc = ci * ch, cs = ci * sh, sc = si * ch, ss = si * sh
    const m = new Float32Array(9)
    m[0] = cj * ch
    m[3] = sj * sc - cs
    m[6] = sj * cc + ss
    m[1] = cj * sh
    m[4] = sj * ss + cc
    m[7] = sj * cs - sc
    m[2] = -sj
    m[5] = cj * si
    m[8] = cj * ci
    return m
}

/** `axis_angle_normalized_to_mat3_ex` (`math_rotation_c.cc:1138`). */
export function axisAngleNormalizedToMat3Ex(axis: ArrayLike<number>, angleSin: number, angleCos: number): M3 {
    const ico = f32(1 - angleCos)
    const nsi = [f32(axis[0] * angleSin), f32(axis[1] * angleSin), f32(axis[2] * angleSin)]
    const n00 = f32(f32(axis[0] * axis[0]) * ico)
    const n01 = f32(f32(axis[0] * axis[1]) * ico)
    const n11 = f32(f32(axis[1] * axis[1]) * ico)
    const n02 = f32(f32(axis[0] * axis[2]) * ico)
    const n12 = f32(f32(axis[1] * axis[2]) * ico)
    const n22 = f32(f32(axis[2] * axis[2]) * ico)
    const m = new Float32Array(9)
    m[0] = n00 + angleCos
    m[1] = n01 + nsi[2]
    m[2] = n02 - nsi[1]
    m[3] = n01 - nsi[2]
    m[4] = n11 + angleCos
    m[5] = n12 + nsi[0]
    m[6] = n02 + nsi[1]
    m[7] = n12 - nsi[0]
    m[8] = n22 + angleCos
    return m
}

/** `axis_angle_to_mat3` (`math_rotation_c.cc:1178`): the axis normalised with `normalize_v3_v3`; identity for a zero axis. */
export function axisAngleToMat3(axis: ArrayLike<number>, angle: number): M3 {
    const nor = normalizeV3V3(axis)
    if (nor[0] === 0 && nor[1] === 0 && nor[2] === 0) {
        const m = new Float32Array(9)
        m[0] = m[4] = m[8] = 1
        return m
    }
    // `axis_angle_normalized_to_mat3` (:1173): `sinf` / `cosf`.
    return axisAngleNormalizedToMat3Ex(nor, f32(Math.sin(angle)), f32(Math.cos(angle)))
}

/** `mul_m3_m3m3(R, A, B)` (`math_matrix_c.cc:319`): `R[i][j] = B[i][0] * A[0][j] + B[i][1] * A[1][j] + B[i][2] * A[2][j]`. */
export function mulM3M3M3(A: ArrayLike<number>, B: ArrayLike<number>): M3 {
    const R = new Float32Array(9)
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            R[i * 3 + j] = f32(f32(f32(B[i * 3] * A[j]) + f32(B[i * 3 + 1] * A[3 + j])) + f32(B[i * 3 + 2] * A[6 + j]))
        }
    }
    return R
}

/** `mul_v3_m3v3(r, M, a)` (`math_matrix_c.cc:824`). */
export function mulV3M3V3(M: ArrayLike<number>, a: ArrayLike<number>): V3 {
    const r: V3 = [0, 0, 0]
    for (let j = 0; j < 3; j++) r[j] = f32(f32(f32(M[j] * a[0]) + f32(M[3 + j] * a[1])) + f32(M[6 + j] * a[2]))
    return r
}

const EULER_HYPOT_EPSILON = f32(0.0000375)

/** `mat3_normalized_to_eul2` (`math_rotation_c.cc:1420`): `hypotf`, `atan2f`. */
function mat3NormalizedToEul2(m: ArrayLike<number>): [V3, V3] {
    const at = (i: number, j: number) => m[i * 3 + j]
    const cy = f32(Math.hypot(at(0, 0), at(0, 1)))
    if (cy > EULER_HYPOT_EPSILON) {
        return [
            [f32(Math.atan2(at(1, 2), at(2, 2))), f32(Math.atan2(-at(0, 2), cy)), f32(Math.atan2(at(0, 1), at(0, 0)))],
            [f32(Math.atan2(-at(1, 2), -at(2, 2))), f32(Math.atan2(-at(0, 2), -cy)), f32(Math.atan2(-at(0, 1), -at(0, 0)))],
        ]
    }
    const e: V3 = [f32(Math.atan2(-at(2, 1), at(1, 1))), f32(Math.atan2(-at(0, 2), cy)), 0]
    return [e, [e[0], e[1], e[2]]]
}

/** `mat3_normalized_to_eul` (`math_rotation_c.cc:1444`): the solution with the smaller sum of absolute values. */
export function mat3NormalizedToEul(m: ArrayLike<number>): V3 {
    const [e1, e2] = mat3NormalizedToEul2(m)
    const s = (e: V3) => f32(f32(Math.abs(e[0]) + Math.abs(e[1])) + Math.abs(e[2]))
    return s(e1) > s(e2) ? e2 : e1
}

/** `mat3_to_eul` (`math_rotation_c.cc:1460`): columns normalised with `normalize_m3_m3` (`normalize_v3_v3`) first. */
export function mat3ToEul(m: ArrayLike<number>): V3 {
    const u = new Float32Array(9)
    for (let i = 0; i < 3; i++) u.set(normalizeV3V3([m[i * 3], m[i * 3 + 1], m[i * 3 + 2]]), i * 3)
    return mat3NormalizedToEul(u)
}

/** `determinant_m3_array` (`math_matrix_c.cc:1004`). */
export function determinantM3Array(m: ArrayLike<number>): number {
    const at = (i: number, j: number) => m[i * 3 + j]
    const a = f32(at(0, 0) * f32(f32(at(1, 1) * at(2, 2)) - f32(at(1, 2) * at(2, 1))))
    const b = f32(at(1, 0) * f32(f32(at(0, 1) * at(2, 2)) - f32(at(0, 2) * at(2, 1))))
    const c = f32(at(2, 0) * f32(f32(at(0, 1) * at(1, 2)) - f32(at(0, 2) * at(1, 1))))
    return f32(f32(a - b) + c)
}

/** `adjoint_m3_m3` (`math_matrix_c.cc:1813`). */
function adjointM3(M: ArrayLike<number>): M3 {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = Array.from(M)
    const R = new Float32Array(9)
    R[0] = f32(m11 * m22) - f32(m12 * m21)
    R[1] = f32(-m01 * m22) + f32(m02 * m21)
    R[2] = f32(m01 * m12) - f32(m02 * m11)
    R[3] = f32(-m10 * m22) + f32(m12 * m20)
    R[4] = f32(m00 * m22) - f32(m02 * m20)
    R[5] = f32(-m00 * m12) + f32(m02 * m10)
    R[6] = f32(m10 * m21) - f32(m11 * m20)
    R[7] = f32(-m00 * m21) + f32(m01 * m20)
    R[8] = f32(m00 * m11) - f32(m01 * m10)
    return R
}

/** `invert_m3_m3` (`math_matrix_c.cc:1043`): adjoint times `1.0f / det`; the adjoint is kept when `det == 0`. */
export function invertM3(m: ArrayLike<number>): {m: M3, success: boolean} {
    const inverse = adjointM3(m)
    let det = determinantM3Array(m)
    const success = det !== 0
    if (det !== 0) {
        det = f32(1 / det)
        for (let k = 0; k < 9; k++) inverse[k] = f32(inverse[k] * det)
    }
    return {m: inverse, success}
}

/** `project_plane_normalized_v3_v3v3` (`math_vector.cc:529`): `p + v_plane * -dot(p, v_plane)` (`madd_v3_v3v3fl`). */
function projectPlaneNormalized(p: ArrayLike<number>, vPlane: ArrayLike<number>): V3 {
    const mul = -dot3(p, vPlane)
    return [f32(p[0] + f32(vPlane[0] * mul)), f32(p[1] + f32(vPlane[1] * mul)), f32(p[2] + f32(vPlane[2] * mul))]
}

/** `angle_signed_on_axis_v3v3_v3` (`math_vector.cc:379`). */
export function angleSignedOnAxisV3V3V3(v1: ArrayLike<number>, v2: ArrayLike<number>, axis: ArrayLike<number>): number {
    const v1p = projectPlaneNormalized(v1, axis)
    const v2p = projectPlaneNormalized(v2, axis)
    let angle = angleV3V3(v1p, v2p)
    // `cross_v3_v3v3(tproj, v2_proj, v1_proj)` (`math_vector_inline.cc:684`).
    const t: V3 = [
        f32(f32(v2p[1] * v1p[2]) - f32(v2p[2] * v1p[1])),
        f32(f32(v2p[2] * v1p[0]) - f32(v2p[0] * v1p[2])),
        f32(f32(v2p[0] * v1p[1]) - f32(v2p[1] * v1p[0])),
    ]
    if (dot3(t, axis) < 0) angle = f32(f32(Math.PI * 2) - angle)
    return angle
}
