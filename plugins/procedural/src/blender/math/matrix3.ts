/**
 * `float3x3` operations of Blender's C++ matrix library not covered by `matrix.ts`: `from_rotation(AxisAngle)`
 * (`blenlib/BLI_math_matrix.hh:1124`), `float3x3 * float3x3` (`blenlib/intern/math_matrix.cc:74`) and the
 * enlarging `float4x4(float3x3)` constructor (`BLI_math_matrix_types.hh:119`). Column major (`m[col * 3 + row]`).
 */

import {f32} from '../f32'

/**
 * `from_rotation<float3x3>(AxisAngle(axis, angle))` (`BLI_math_matrix.hh:1124`) in float: `sin`/`cos` of an
 * `AngleRadian` are `sinf`/`cosf`. `axis` must be unit length (asserted in Blender).
 */
export function mat3FromAxisAngle(axis: ArrayLike<number>, angle: number): Float32Array {
    const s = f32(Math.sin(angle))
    const c = f32(Math.cos(angle))
    const ico = f32(1 - c)
    const nsi = [f32(axis[0] * s), f32(axis[1] * s), f32(axis[2] * s)]
    const n012 = [0, 1, 2].map(k => f32(f32(axis[k] * axis[k]) * ico))
    const n01 = f32(f32(axis[0] * axis[1]) * ico)
    const n02 = f32(f32(axis[0] * axis[2]) * ico)
    const n12 = f32(f32(axis[1] * axis[2]) * ico)
    const m = new Float32Array(9)
    // `from_scale<MatT>(n012 + angle_cos)`.
    m[0] = f32(n012[0] + c)
    m[4] = f32(n012[1] + c)
    m[8] = f32(n012[2] + c)
    m[1] = f32(n01 + nsi[2])
    m[2] = f32(n02 - nsi[1])
    m[3] = f32(n01 - nsi[2])
    m[5] = f32(n12 + nsi[0])
    m[6] = f32(n02 + nsi[1])
    m[7] = f32(n12 - nsi[0])
    return m
}

/** `float3x3 operator*(a, b)` (`math_matrix.cc:74`, the unrolled scalar branch): `r[j][i] = b[j][0]*a[0][i] + b[j][1]*a[1][i] + b[j][2]*a[2][i]`. */
export function mat3Multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
    const r = new Float32Array(9)
    for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
            r[j * 3 + i] = f32(f32(f32(b[j * 3] * a[i]) + f32(b[j * 3 + 1] * a[3 + i])) + f32(b[j * 3 + 2] * a[6 + i]))
        }
    }
    return r
}

/** `float4x4(float3x3)` (`BLI_math_matrix_types.hh:119`): the 3x3 in the upper left, identity elsewhere. */
export function mat4FromMat3(m: ArrayLike<number>): Float32Array {
    const r = new Float32Array(16)
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) r[c * 4 + k] = m[c * 3 + k]
    r[15] = 1
    return r
}
