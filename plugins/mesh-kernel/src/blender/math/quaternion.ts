/**
 * The parts of Blender's C++ rotation library (`blenlib/BLI_math_quaternion.hh`,
 * `BLI_math_axis_angle.hh`, `BLI_math_angle_types.hh`, `BLI_math_vector.hh`) that the geometry data model
 * needs. Quaternions are `[w, x, y, z]`, Blender's `QuaternionBase` member order.
 *
 * Arithmetic is float32 like Blender's `float` instantiation: every intermediate goes through {@link f32}.
 */

import {f32} from '../f32'
import {atan2f, sincosf} from '../libm'

export type Quat = [number, number, number, number]
export type Float3 = [number, number, number]

const PI = Math.PI

/** `QuaternionBase::identity()` (`BLI_math_quaternion_types.hh:58`). */
export function quatIdentity(): Quat {
    return [1, 0, 0, 0]
}

/** `length_squared` then `sqrt` (`BLI_math_vector.hh`). */
function lengthSquared3(x: number, y: number, z: number): number {
    return f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))
}

/**
 * `normalize_and_get_length` (`BLI_math_vector.hh:521`): threshold 1e-35 on the squared length for
 * floats, zero vector and zero length otherwise.
 */
export function normalizeAndGetLength3(v: ArrayLike<number>): {v: Float3, length: number} {
    const sq = lengthSquared3(v[0], v[1], v[2])
    if (sq > f32(1.0e-35)) {
        const len = f32(Math.sqrt(sq))
        return {v: [f32(v[0] / len), f32(v[1] / len), f32(v[2] / len)], length: len}
    }
    return {v: [0, 0, 0], length: 0}
}

/** `math::mod_periodic` for floats (`BLI_math_base.hh:127`): `a - b * floor(a / b)`. */
export function modPeriodic(a: number, b: number): number {
    return f32(a - f32(b * Math.floor(f32(a / b))))
}

/** `AngleRadianBase::wrapped()` (`BLI_math_angle_types.hh:80`): into [-pi, pi]. */
export function angleWrapped(radian: number): number {
    return f32(modPeriodic(f32(radian + f32(PI)), f32(2 * PI)) - f32(PI))
}

/** `to_quaternion(AxisAngle)` (`BLI_math_axis_angle.hh:71`). `axis` must be unit length. */
export function axisAngleToQuat(axis: ArrayLike<number>, angle: number): Quat {
    const half = f32(angle / 2)
    const [hs, hc] = sincosf(half)
    return [hc, f32(axis[0] * hs), f32(axis[1] * hs), f32(axis[2] * hs)]
}

/** `to_axis_angle(Quaternion)` (`BLI_math_quaternion.hh:630`). Identity axis is +Y (`AxisAngleBase::identity`). */
export function quatToAxisAngle(q: ArrayLike<number>): {axis: Float3, angle: number} {
    let ax = q[1], ay = q[2], az = q[3]
    const cosHalf = q[0]
    const sinHalf = f32(Math.sqrt(lengthSquared3(ax, ay, az)))
    if (sinHalf < f32(0.0005)) {
        const s = cosHalf > 0 ? 1 : cosHalf < 0 ? -1 : 0
        return {axis: [0, s, 0], angle: 0}
    }
    ax = f32(ax / sinHalf)
    ay = f32(ay / sinHalf)
    az = f32(az / sinHalf)
    // AngleRadianBase(cos, sin) is atan2(sin, cos); `* 2` doubles it.
    const angle = f32(atan2f(sinHalf, cosHalf) * 2)
    return {axis: [ax, ay, az], angle}
}

/** `QuaternionBase::expmap(const float3 &)` (`BLI_math_quaternion.hh:686`). */
export function quatFromExpmap(e: ArrayLike<number>): Quat {
    const {v: axis, length: angle} = normalizeAndGetLength3(e)
    if (angle !== 0) return axisAngleToQuat(axis, angleWrapped(angle))
    return quatIdentity()
}

/** `QuaternionBase::expmap()` (`BLI_math_quaternion.hh:698`). */
export function quatToExpmap(q: ArrayLike<number>): Float3 {
    const {axis, angle} = quatToAxisAngle(q)
    return [f32(axis[0] * angle), f32(axis[1] * angle), f32(axis[2] * angle)]
}
