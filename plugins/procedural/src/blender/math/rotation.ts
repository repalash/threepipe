/**
 * Quaternion functions of Blender's C++ rotation library (`blenlib/BLI_math_quaternion.hh`,
 * `BLI_math_quaternion_types.hh`) used by the function nodes, float32 like the `float` instantiation.
 * Quaternions are `[w, x, y, z]` (`QuaternionBase` member order).
 */

import {f32} from '../f32'
import {Quat} from './quaternion'
import {normalize3} from './vec'

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
    return f32(Math.acos(a))
}

/** `math::pow(Quaternion, T)` (`BLI_math_quaternion.hh:204`). */
export function quatPow(q: ArrayLike<number>, y: number): Quat {
    const halfAngle = f32(y * safeAcos(q[0]))
    const s = f32(Math.sin(halfAngle))
    const n = normalize3([q[1], q[2], q[3]])
    return [f32(Math.cos(halfAngle)), f32(s * n[0]), f32(s * n[1]), f32(s * n[2])]
}

/** `math::interpolate(Quaternion, Quaternion, T)` (`BLI_math_quaternion.hh:304`): slerp along the shortest arc. */
export function quatInterpolate(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Quat {
    let inv = quatConjugate(a)
    // `-math::invert_normalized(a) * b`: the negation applies to the inverse.
    if (quatDot(a, b) < 0) inv = [-inv[0], -inv[1], -inv[2], -inv[3]]
    return quatMultiply(a, quatPow(quatMultiply(inv, b), t))
}
