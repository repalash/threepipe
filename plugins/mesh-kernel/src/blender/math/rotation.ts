/**
 * Quaternion functions of Blender's C++ rotation library (`blenlib/BLI_math_quaternion.hh`,
 * `BLI_math_quaternion_types.hh`) used by the function nodes, float32 like the `float` instantiation.
 * Quaternions are `[w, x, y, z]` (`QuaternionBase` member order).
 */

import {f32} from '../f32'
import {quatToMat3} from './matrix'
import {mulM3M3M3} from './matrixC'
import {Quat} from './quaternion'
import {normalize3} from './vec'
import {acosf, sincosf} from '../libm'

const PI_F = f32(Math.PI)

/** `QuaternionBase * QuaternionBase` (`BLI_math_quaternion_types.hh:146`), left to right. */
export function quatMultiply(a: ArrayLike<number>, b: ArrayLike<number>): Quat {
    const [aw, ax, ay, az] = [a[0], a[1], a[2], a[3]]
    const [bw, bx, by, bz] = [b[0], b[1], b[2], b[3]]
    return [
        f32(f32(f32(f32(aw * bw) - f32(ax * bx)) - f32(ay * by)) - f32(az * bz)),
        f32(f32(f32(f32(aw * bx) + f32(ax * bw)) + f32(ay * bz)) - f32(az * by)),
        f32(f32(f32(f32(aw * by) + f32(ay * bw)) + f32(az * bx)) - f32(ax * bz)),
        f32(f32(f32(f32(aw * bz) + f32(az * bw)) + f32(ax * by)) - f32(ay * bx)),
    ]
}

/** `math::dot(Quaternion, Quaternion)` (`BLI_math_quaternion.hh:198`): `w*w + x*x + y*y + z*z`. */
export function quatDot(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return f32(f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2])) + f32(a[3] * b[3]))
}

/** `math::conjugate` (`BLI_math_quaternion.hh:221`) - also `invert_normalized` (`:244`). */
export function quatConjugate(q: ArrayLike<number>): Quat {
    return [q[0], -q[1], -q[2], -q[3]]
}

/** `math::safe_acos` (`BLI_math_base.hh:236`): pi below -1, 0 above 1, else `acosf`. */
export function safeAcos(a: number): number {
    if (a <= -1) return PI_F
    if (a >= 1) return 0
    return acosf(a)
}

/** `math::pow(Quaternion, T)` (`BLI_math_quaternion.hh:204`). */
export function quatPow(q: ArrayLike<number>, y: number): Quat {
    const halfAngle = f32(y * safeAcos(q[0]))
    const [s, c] = sincosf(halfAngle)
    const n = normalize3([q[1], q[2], q[3]])
    return [c, f32(s * n[0]), f32(s * n[1]), f32(s * n[2])]
}

/** `math::interpolate(Quaternion, Quaternion, T)` (`BLI_math_quaternion.hh:304`): slerp along the shortest arc. */
export function quatInterpolate(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Quat {
    let inv = quatConjugate(a)
    // `-math::invert_normalized(a) * b`: the negation applies to the inverse.
    if (quatDot(a, b) < 0) inv = [-inv[0], -inv[1], -inv[2], -inv[3]]
    return quatMultiply(a, quatPow(quatMultiply(inv, b), t))
}

/** `math::normalize(Quaternion)` (`BLI_math_quaternion.hh:258`, via `normalize_and_get_length` :251): identity for a zero quaternion. */
export function quatNormalize(q: ArrayLike<number>): Quat {
    const len = f32(Math.sqrt(quatDot(q, q)))
    if (len === 0) return [1, 0, 0, 0]
    const inv = f32(1 / len)
    return [f32(q[0] * inv), f32(q[1] * inv), f32(q[2] * inv), f32(q[3] * inv)]
}

/** `math::invert(Quaternion)` (`BLI_math_quaternion.hh:234`): `conjugate(q) * (1 / dot(q, q))`, identity for zero. */
export function quatInvert(q: ArrayLike<number>): Quat {
    const lengthSquared = quatDot(q, q)
    if (lengthSquared === 0) return [1, 0, 0, 0]
    const inv = f32(1 / lengthSquared)
    return [f32(q[0] * inv), f32(-q[1] * inv), f32(-q[2] * inv), f32(-q[3] * inv)]
}

/** `math::transform_point(Quaternion, float3)` (`BLI_math_quaternion.hh:318`), the expanded `q * v * conjugate(q)`. */
export function quatTransformPoint(q: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] {
    const [qw, qx, qy, qz] = [q[0], q[1], q[2], q[3]]
    const [vx, vy, vz] = [v[0], v[1], v[2]]
    const sw = f32(f32(f32(-qx * vx) - f32(qy * vy)) - f32(qz * vz))
    const sx = f32(f32(f32(qw * vx) + f32(qy * vz)) - f32(qz * vy))
    const sy = f32(f32(f32(qw * vy) + f32(qz * vx)) - f32(qx * vz))
    const sz = f32(f32(f32(qw * vz) + f32(qx * vy)) - f32(qy * vx))
    return [
        f32(f32(f32(f32(sw * -qx) + f32(sx * qw)) - f32(sy * qz)) + f32(sz * qy)),
        f32(f32(f32(f32(sw * -qy) + f32(sy * qw)) - f32(sz * qx)) + f32(sx * qz)),
        f32(f32(f32(f32(sw * -qz) + f32(sz * qw)) - f32(sx * qy)) + f32(sy * qx)),
    ]
}

/** `math::angle_of(Quaternion)` (`BLI_math_rotation.hh:125`): `2 * safe_acos(q.w)`. */
export function quatAngleOf(q: ArrayLike<number>): number {
    return f32(2 * safeAcos(q[0]))
}

/**
 * `from_loc_rot_scale<float4x4>(location, Quaternion, scale)` (`BLI_math_matrix.hh:1447`): `from_rotation(q) *
 * from_scale(scale)` through the `float3x3 * float3x3` specialisation (`blenlib/intern/math_matrix.cc:74`),
 * whose sums with the zero entries of the scale matrix decide the signs of zero results (`matrix.ts`'s
 * `mat4FromLocRot3Scale` multiplies directly and can produce -0 where Blender has +0).
 */
export function fromLocQuatScale(loc: ArrayLike<number>, q: ArrayLike<number>, scale: ArrayLike<number>, out: Float32Array = new Float32Array(16)): Float32Array {
    const a = quatToMat3(q)
    const b = new Float32Array(9)
    b[0] = scale[0]
    b[4] = scale[1]
    b[8] = scale[2]
    // `result[i][j] = b[i][0] * a[0][j] + b[i][1] * a[1][j] + b[i][2] * a[2][j]` (= `mul_m3_m3m3(R, a, b)`).
    const r = mulM3M3M3(a, b)
    out.fill(0)
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[c * 4 + k] = r[c * 3 + k]
    out[12] = loc[0]
    out[13] = loc[1]
    out[14] = loc[2]
    out[15] = 1
    return out
}
