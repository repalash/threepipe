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
