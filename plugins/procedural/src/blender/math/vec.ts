/**
 * Float32 3-vector helpers matching Blender's C++ `VecBase<float, 3>` operators and
 * `blenlib/BLI_math_vector.hh` functions, rounded per operation like Blender's `-ffp-contract=off`
 * build. (The C API in `math_vector_inline.cc` differs in places: `normalize_v3` multiplies by a
 * reciprocal, `math::normalize` divides; use the one the ported code calls.)
 */

import {f32} from '../f32'

export type V3 = [number, number, number]

export function v3(x = 0, y = 0, z = 0): V3 {
    return [f32(x), f32(y), f32(z)]
}

export function add3(a: ArrayLike<number>, b: ArrayLike<number>): V3 {
    return [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2])]
}

export function sub3(a: ArrayLike<number>, b: ArrayLike<number>): V3 {
    return [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])]
}

export function scale3(a: ArrayLike<number>, s: number): V3 {
    return [f32(a[0] * s), f32(a[1] * s), f32(a[2] * s)]
}

/** `math::dot` (`BLI_math_vector.hh:425`): left to right. */
export function dot3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]))
}

export function lengthSquared3(a: ArrayLike<number>): number {
    return dot3(a, a)
}

/** `math::length` (`BLI_math_vector.hh:451`). */
export function length3(a: ArrayLike<number>): number {
    return f32(Math.sqrt(dot3(a, a)))
}

/** `math::cross(float3, float3)` (`BLI_math_vector.hh`). */
export function cross3(a: ArrayLike<number>, b: ArrayLike<number>): V3 {
    return [
        f32(f32(a[1] * b[2]) - f32(a[2] * b[1])),
        f32(f32(a[2] * b[0]) - f32(a[0] * b[2])),
        f32(f32(a[0] * b[1]) - f32(a[1] * b[0])),
    ]
}

/**
 * `math::normalize_and_get_length` (`BLI_math_vector.hh:521`): component-wise division by the
 * length; zero vector when the squared length is not above 1e-35.
 */
export function normalize3(a: ArrayLike<number>): V3 {
    const sq = dot3(a, a)
    if (sq > f32(1.0e-35)) {
        const len = f32(Math.sqrt(sq))
        return [f32(a[0] / len), f32(a[1] / len), f32(a[2] / len)]
    }
    return [0, 0, 0]
}

/** `math::interpolate(a, b, t)` for float3: `a * (1 - t) + b * t`. */
export function interpolate3(a: ArrayLike<number>, b: ArrayLike<number>, t: number): V3 {
    const omt = f32(1 - t)
    return [
        f32(f32(a[0] * omt) + f32(b[0] * t)),
        f32(f32(a[1] * omt) + f32(b[1] * t)),
        f32(f32(a[2] * omt) + f32(b[2] * t)),
    ]
}

export function isZero3(a: ArrayLike<number>): boolean {
    return a[0] === 0 && a[1] === 0 && a[2] === 0
}

const FLT_1E_35 = f32(1.0e-35)

/**
 * `normalize_v3_v3` (`blenlib/intern/math_vector_inline.cc:889` via `normalize_v3_v3_length` :872): the C
 * API multiplies by `unit_length / d` instead of dividing.
 */
export function normalizeV3V3(a: ArrayLike<number>): V3 {
    let d = dot3(a, a)
    if (d > FLT_1E_35) {
        d = f32(Math.sqrt(d))
        const m = f32(1 / d)
        return [f32(a[0] * m), f32(a[1] * m), f32(a[2] * m)]
    }
    return [0, 0, 0]
}

/** `len_v3v3` (`math_vector_inline.cc:820`): `len_v3(b - a)`. */
export function lenV3V3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return length3(sub3(b, a))
}

/** `safe_asinf` (`math_base_safe_inline.cc:49`): CLAMP to [-1, 1] then `asinf`. */
function safeAsinf(a: number): number {
    return f32(Math.asin(a < -1 ? -1 : a > 1 ? 1 : a))
}

/** `angle_normalized_v3v3` (`blenlib/intern/math_vector.cc:336`). */
export function angleNormalizedV3V3(v1: ArrayLike<number>, v2: ArrayLike<number>): number {
    if (dot3(v1, v2) >= 0) return f32(2 * safeAsinf(f32(lenV3V3(v1, v2) / 2)))
    const v2n: V3 = [-v2[0], -v2[1], -v2[2]]
    return f32(f32(Math.PI) - f32(2 * safeAsinf(f32(lenV3V3(v1, v2n) / 2))))
}

/** `angle_v3v3` (`math_vector.cc:276`). */
export function angleV3V3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return angleNormalizedV3V3(normalizeV3V3(a), normalizeV3V3(b))
}

/** `math::cross_high_precision` (`BLI_math_vector.hh:565`): products and differences in double, one rounding to float. */
export function crossHighPrecision3(a: ArrayLike<number>, b: ArrayLike<number>): V3 {
    return [
        f32(a[1] * b[2] - a[2] * b[1]),
        f32(a[2] * b[0] - a[0] * b[2]),
        f32(a[0] * b[1] - a[1] * b[0]),
    ]
}

/** `math::project` (`BLI_math_vector.hh:511`): `v_proj * (dot(p, v_proj) / dot(v_proj, v_proj))`, zero for a zero `v_proj`. */
export function project3(p: ArrayLike<number>, vProj: ArrayLike<number>): V3 {
    if (isZero3(vProj)) return [0, 0, 0]
    return scale3(vProj, f32(dot3(p, vProj) / dot3(vProj, vProj)))
}

/** `math::reflect` (`BLI_math_vector.hh:486`): `incident - 2.0 * dot(normal, incident) * normal`. */
export function reflect3(incident: ArrayLike<number>, normal: ArrayLike<number>): V3 {
    // `2.0 * dot` is a double, converted to float by `operator*(T, VecBase)`; doubling is exact.
    const k = f32(2 * dot3(normal, incident))
    return sub3(incident, scale3(normal, k))
}

/** `math::refract` (`BLI_math_vector.hh:494`). `sqrt` is `math::sqrt<float>`. */
export function refract3(incident: ArrayLike<number>, normal: ArrayLike<number>, eta: number): V3 {
    const dotNI = dot3(normal, incident)
    const k = f32(1 - f32(f32(eta * eta) * f32(1 - f32(dotNI * dotNI))))
    if (k < 0) return [0, 0, 0]
    const s = f32(f32(eta * dotNI) + f32(Math.sqrt(k)))
    return sub3(scale3(incident, eta), scale3(normal, s))
}

/** `math::faceforward` (`BLI_math_vector.hh:652`). */
export function faceforward3(vector: ArrayLike<number>, incident: ArrayLike<number>, reference: ArrayLike<number>): V3 {
    return dot3(reference, incident) < 0 ? [vector[0], vector[1], vector[2]] : [-vector[0], -vector[1], -vector[2]]
}

/** `math::distance` (`BLI_math_vector.hh:480`): `length(a - b)`. */
export function distance3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return length3(sub3(a, b))
}
