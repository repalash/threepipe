/**
 * Math node (`ShaderNodeMath`) - `nodes/shader/nodes/node_shader_math.cc` (declaration :19-83,
 * availability `node_shader_update_math`), operation table `nodes/intern/math_functions.cc:73-180`,
 * the registered functions `functions/intern/multi_function_common.cc:20-361` and the scalar helpers in
 * `blenlib/intern/math_base_inline.cc` / `math_base_safe_inline.cc`. Fixes the divergences filed in
 * `issues/open/audit-procgen-math-nodes-blender-port-bugs.md` (MODULO, PINGPONG, SMOOTH_MIN/MAX,
 * SQRT/POWER/LOGARITHM safe forms, COMPARE epsilon).
 */

import {f32} from '../../blender/f32'
import {GVArray} from '../../geometry/varray'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached, fmodf, fn1, fn2, fn3, maxFF, minFF, stdMax, stdMin} from '../util'
import {acosf, asinf, atan2f} from '../../blender/libm'

const FLT_EPSILON = 1.1920928955078125e-7

/** `safe_divide` (`math_base_safe_inline.cc:16`). */
const safeDivide = (a: number, b: number) => (b !== 0 ? f32(a / b) : 0)
/** `safe_modf` (`:21`). */
const safeModf = (a: number, b: number) => (b !== 0 ? fmodf(a, b) : 0)
/** `safe_floored_modf` (`:26`). */
const safeFlooredModf = (a: number, b: number) => (b !== 0 ? f32(a - f32(Math.floor(f32(a / b)) * b)) : 0)
/** `safe_logf` (`:31`). */
const safeLogf = (a: number, base: number) => (a <= 0 || base <= 0 ? 0 : safeDivide(f32(Math.log(a)), f32(Math.log(base))))
/** `safe_sqrtf` (`:39`). */
const safeSqrtf = (a: number) => f32(Math.sqrt(maxFF(a, 0)))
/** `safe_inverse_sqrtf` (`:44`). */
const safeInverseSqrtf = (a: number) => (a > 0 ? f32(1 / f32(Math.sqrt(a))) : 0)
/** `safe_asinf` / `safe_acosf` (`:49`, `:55`): clamp then the libm function. */
const clamp1 = (a: number) => (a < -1 ? -1 : a > 1 ? 1 : a)
/** `safe_powf` (`:61`). */
const safePowf = (base: number, exponent: number) => (base < 0 && exponent !== Math.trunc(exponent) ? 0 : f32(Math.pow(base, exponent)))
/** `compatible_signf` (`math_base_inline.cc:530`). */
const compatibleSignf = (a: number) => (a > 0 ? 1 : a < 0 ? -1 : 0)
/** `fractf` (`:265`). */
const fractf = (a: number) => f32(a - Math.floor(a))
/** `wrapf` (`:271`). */
const wrapf = (value: number, max: number, min: number) => {
    const range = f32(max - min)
    return range !== 0 ? f32(value - f32(range * Math.floor(f32(f32(value - min) / range)))) : min
}
/** `pingpongf` (`:277`). */
const pingpongf = (value: number, scale: number) => {
    if (scale === 0) return 0
    const s2 = f32(scale * 2)
    return Math.abs(f32(f32(f32(fractf(f32(f32(value - scale) / s2)) * scale) * 2) - scale))
}
/** `smoothminf` (`:330`). */
const smoothminf = (a: number, b: number, c: number) => {
    if (c !== 0) {
        const h = f32(maxFF(f32(c - Math.abs(f32(a - b))), 0) / c)
        return f32(minFF(a, b) - f32(f32(f32(f32(h * h) * h) * c) * f32(1 / 6)))
    }
    return minFF(a, b)
}

/** The registered function of each operation (`multi_function_common.cc`). */
const OPS: Record<string, MultiFunction> = {
    ADD: fn2('float + float', (a, b) => a + b),
    SUBTRACT: fn2('float - float', (a, b) => a - b),
    MULTIPLY: fn2('float * float', (a, b) => a * b),
    DIVIDE: divideFunction(),
    MULTIPLY_ADD: fn3('float * float + float', (a, b, c) => f32(f32(a * b) + c)),
    POWER: powFunction(),
    LOGARITHM: fn2('log(float, float)', safeLogf),
    SQRT: fn1('sqrt(float)', safeSqrtf),
    INVERSE_SQRT: fn1('inverse_sqrt(float)', safeInverseSqrtf),
    ABSOLUTE: fn1('abs(float)', a => Math.abs(a)),
    EXPONENT: fn1('exp(float)', a => Math.exp(a)),
    MINIMUM: fn2('min(float, float)', stdMin),
    MAXIMUM: fn2('max(float, float)', stdMax),
    LESS_THAN: fn2('float(float < float)', (a, b) => (a < b ? 1 : 0)),
    GREATER_THAN: fn2('float(float > float)', (a, b) => (a > b ? 1 : 0)),
    SIGN: fn1('sign(float)', compatibleSignf),
    COMPARE: fn3('compare(float, float, float)', (a, b, c) => (a === b || Math.abs(f32(a - b)) <= Math.max(c, FLT_EPSILON) ? 1 : 0)),
    SMOOTH_MIN: fn3('smooth_min(float, float, float)', smoothminf),
    SMOOTH_MAX: fn3('smooth_max(float, float, float)', (a, b, c) => -smoothminf(-a, -b, c)),
    ROUND: fn1('round(float)', a => Math.floor(f32(a + 0.5))),
    FLOOR: fn1('floor(float)', a => Math.floor(a)),
    CEIL: fn1('ceil(float)', a => Math.ceil(a)),
    TRUNC: fn1('trunc(float)', a => (a >= 0 ? Math.floor(a) : Math.ceil(a))),
    FRACT: fn1('frac(float)', fractf),
    MODULO: fn2('float % float', safeModf),
    FLOORED_MODULO: fn2('floor_mod(float, float)', safeFlooredModf),
    WRAP: fn3('wrap(float, float, float)', wrapf),
    SNAP: fn2('snap(float, float)', (a, b) => f32(Math.floor(safeDivide(a, b)) * b)),
    PINGPONG: fn2('pingpong(float, float)', pingpongf),
    SINE: fn1('sin(float)', a => Math.sin(a)),
    COSINE: fn1('cos(float)', a => Math.cos(a)),
    TANGENT: fn1('tan(float)', a => Math.tan(a)),
    ARCSINE: fn1('asin(float)', a => asinf(clamp1(a))),
    ARCCOSINE: fn1('acos(float)', a => acosf(clamp1(a))),
    ARCTANGENT: fn1('atan(float)', a => Math.atan(a)),
    ARCTAN2: fn2('atan2(float, float)', (a, b) => atan2f(a, b)),
    SINH: fn1('sinh(float)', a => Math.sinh(a)),
    COSH: fn1('cosh(float)', a => Math.cosh(a)),
    TANH: fn1('tanh(float)', a => Math.tanh(a)),
    // `float(DEG2RAD(a))`: the macro multiplies in double (`BLI_math_constants.h:72`).
    RADIANS: fn1('radians(float)', a => a * (Math.PI / 180)),
    DEGREES: fn1('degrees(float)', a => a * (180 / Math.PI)),
}

/** `PowFunction` (`multi_function_common.cc:20`): single integer exponents 0..3 skip `powf`. */
function powFunction(): MultiFunction {
    const generic = fn2('pow generic', safePowf)
    return {
        name: 'float ** float', inputs: ['float', 'float'], outputs: ['float'],
        call(size, ins, outs) {
            const [base, exponent] = ins
            if (exponent.isSingle) {
                const e = exponent.single[0]
                const ei = Math.trunc(e)
                if (ei === e) {
                    switch (ei) {
                    case 0: outs[0].fill(1, 0, size); return
                    case 1: for (let i = 0; i < size; i++) outs[0][i] = base.get(i); return
                    case 2: for (let i = 0; i < size; i++) {
                        const a = base.get(i)
                        outs[0][i] = a * a
                    }
                        return
                    case 3: for (let i = 0; i < size; i++) {
                        const a = base.get(i)
                        outs[0][i] = f32(f32(a * a) * a)
                    }
                        return
                    default: break
                    }
                }
            }
            generic.call(size, ins, outs)
        },
    }
}

/** `DivideFunction` (`multi_function_common.cc:96`): constant divisors and dividends are special-cased. */
function divideFunction(): MultiFunction {
    return {
        name: 'float / float', inputs: ['float', 'float'], outputs: ['float'],
        call(size, ins, outs) {
            const [a, b] = ins
            const out = outs[0]
            if (b.isSingle) {
                const d = b.single[0]
                if (d === 0) {
                    out.fill(0, 0, size)
                    return
                }
                if (d === 1) {
                    for (let i = 0; i < size; i++) out[i] = a.get(i)
                    return
                }
                // Power-of-two divisors multiply by the exact inverse; the result equals the division.
            }
            if (a.isSingle && a.single[0] === 0) {
                out.fill(0, 0, size)
                return
            }
            for (let i = 0; i < size; i++) out[i] = safeDivide(a.get(i), b.get(i))
        },
    }
}

/** `CLAMP(value, 0, 1)` after the operation (`ClampWrapperFunction`, `math_functions.cc:21`). */
const clampWrapper = cached((op: string): MultiFunction => {
    const base = OPS[op]
    return {
        name: `${base.name} (clamped)`, inputs: base.inputs, outputs: base.outputs,
        call(size, ins, outs) {
            base.call(size, ins, outs)
            const o = outs[0]
            for (let i = 0; i < size; i++) {
                const v = o[i]
                o[i] = v < 0 ? 0 : v > 1 ? 1 : v
            }
        },
    }
})

/** Number of inputs each operation uses (`node_shader_update_math` availability rules). */
const ARITY: Record<string, number> = {
    MULTIPLY_ADD: 3, COMPARE: 3, SMOOTH_MIN: 3, SMOOTH_MAX: 3, WRAP: 3,
    SQRT: 1, INVERSE_SQRT: 1, ABSOLUTE: 1, EXPONENT: 1, SIGN: 1, ROUND: 1, FLOOR: 1, CEIL: 1, TRUNC: 1,
    FRACT: 1, SINE: 1, COSINE: 1, TANGENT: 1, ARCSINE: 1, ARCCOSINE: 1, ARCTANGENT: 1, SINH: 1, COSH: 1,
    TANH: 1, RADIANS: 1, DEGREES: 1,
}

registerNodeType({
    idname: 'ShaderNodeMath',
    label: 'Math',
    properties: {operation: 'ADD', use_clamp: false},
    enums: {operation: Object.keys(OPS)},
    declare(b, node) {
        const arity = ARITY[node.prop<string>('operation')] ?? 2
        b.input('FLOAT', 'Value').default(0.5).min(-10000).max(10000)
        b.input('FLOAT', 'Value', 'Value_001').default(0.5).min(-10000).max(10000).available(arity >= 2)
        b.input('FLOAT', 'Value', 'Value_002').default(0.5).min(-10000).max(10000).available(arity >= 3)
        b.output('FLOAT', 'Value')
    },
    multiFunction(node) {
        const op = node.prop<string>('operation')
        if (!OPS[op]) throw new Error(`procedural: Math operation ${op} is not supported`)
        return node.prop<boolean>('use_clamp') ? clampWrapper(op) : OPS[op]
    },
})

export {OPS as MATH_OPERATIONS, GVArray}
