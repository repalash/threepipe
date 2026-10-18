/**
 * Scalar functions from `blenlib/BLI_math_base.hh` and `blenlib/intern/math_base_inline.cc` that are
 * shared by several ports. Float32 like Blender: float literals (`0.5f`) are rounded to float32 before
 * use, as the C++ compiler does.
 */

import {f32} from '../f32'

const ACOS_C0 = f32(1.5707963267)
const ACOS_C1 = f32(-0.213300989)
const ACOS_C2 = f32(0.077980478)
const ACOS_C3 = f32(-0.02164095)
const PI_F = f32(Math.PI)

/**
 * `math::safe_acos_approx` (`BLI_math_base.hh:236`): a polynomial acos used for vertex normal angle
 * weights. Not `Math.acos` - Blender uses this approximation, so its weights do too.
 */
export function safeAcosApprox(x: number): number {
    const fa = Math.abs(x)
    const m = fa < 1 ? f32(1 - f32(1 - fa)) : 1
    const poly = f32(ACOS_C0 + f32(m * f32(ACOS_C1 + f32(m * f32(ACOS_C2 + f32(m * ACOS_C3))))))
    const a = f32(f32(Math.sqrt(f32(1 - m))) * poly)
    return x < 0 ? f32(PI_F - a) : a
}

/** `CLAMP(a, b, c)` (`BLI_utildefines.h`): `if (a < b) a = b; else if (a > c) a = c;` - NaN passes through. */
export function clampMacro(a: number, min: number, max: number): number {
    return a < min ? min : a > max ? max : a
}

/** `std::clamp(v, lo, hi)`: `v < lo ? lo : hi < v ? hi : v`. */
export function stdClamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : hi < v ? hi : v
}

/** `clamp_f` (`blenlib/intern/math_base_inline.cc:405`): upper bound tested first. */
export function clampF(value: number, min: number, max: number): number {
    if (value > max) return max
    if (value < min) return min
    return value
}

/** `safe_divide(float, float)` (`math_base_safe_inline.cc:16`) / `math::safe_divide` (`BLI_math_base.hh:107`). */
export function safeDivideF(a: number, b: number): number {
    return b !== 0 ? f32(a / b) : 0
}

/** `safe_powf` (`math_base_safe_inline.cc:61`). */
export function safePowf(base: number, exponent: number): number {
    return base < 0 && exponent !== Math.trunc(exponent) ? 0 : f32(Math.pow(base, exponent))
}

/** `fractf` (`math_base_inline.cc:265`) / `math::fract` (`BLI_math_base.hh:148`). */
export function fractF(a: number): number {
    return f32(a - Math.floor(a))
}

/** `wrapf` (`math_base_inline.cc:271`). */
export function wrapF(value: number, max: number, min: number): number {
    const range = f32(max - min)
    return range !== 0 ? f32(value - f32(range * Math.floor(f32(f32(value - min) / range)))) : min
}

/** `math::sign` (`BLI_math_base.hh:38`): `(T(0) < a) - (a < T(0))`; 0 for NaN. */
export function signT(a: number): number {
    return (0 < a ? 1 : 0) - (a < 0 ? 1 : 0)
}

/** `divide_floor_i` (`math_base_inline.cc:228`), C `int` division (truncating). */
export function divideFloorI(a: number, b: number): number {
    const d = (a / b) | 0
    const r = a % b | 0
    return r ? (d - ((a < 0 ? 1 : 0) ^ (b < 0 ? 1 : 0))) | 0 : d
}

/** `math::mod_periodic<int>` (`BLI_math_base.hh:127`): `((a % b) + b) % b`, wrapping like 32-bit `int`. */
export function modPeriodicI(a: number, b: number): number {
    return (((a % b) + b) | 0) % b | 0
}

/** `std::gcd` on `int` (result is non-negative). */
export function gcdI(a: number, b: number): number {
    let x = Math.abs(a), y = Math.abs(b)
    while (y !== 0) {
        const t = x % y
        x = y
        y = t
    }
    return x | 0
}

/** `std::lcm` on `int`: `|a| / gcd * |b|`, 0 when either is 0 (wrapping like 32-bit `int` on overflow). */
export function lcmI(a: number, b: number): number {
    if (a === 0 || b === 0) return 0
    const g = gcdI(a, b)
    return Math.imul((Math.abs(a) / g) | 0, Math.abs(b) | 0)
}
