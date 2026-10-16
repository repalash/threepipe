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
    if (sq > 1.0e-35) {
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
