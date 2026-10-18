/**
 * Multi-functions Blender registers by name in `functions/intern/multi_function_common.cc` and looks up
 * with `mf::registry::lookup(...)` (e.g. Set Position's "float3 + float3", Vector Math's operations through
 * `get_float3_math_operation_info`). Add entries here as ports need them, under Blender's names.
 */

import {f32} from '../blender/f32'
import {safePowf, wrapF} from '../blender/math/base'
import {
    crossHighPrecision3, distance3, dot3, faceforward3, length3, normalize3, project3, reflect3, refract3,
} from '../blender/math/vec'
import type {DataType} from '../geometry/dataTypes'
import {elementwise, MultiFunction} from './field'
import {cosf, sinf, tanf} from '../blender/libm'

type V = ArrayLike<number>

/** `mf::build::SI*_SO<float3..., float3>` of a function returning a float3. */
function vecFn(name: string, inputs: readonly DataType[], f: (...ins: number[][]) => V): MultiFunction {
    return elementwise(name, inputs, ['float3'], (i, o) => {
        const r = f(...i)
        o[0][0] = r[0]
        o[0][1] = r[1]
        o[0][2] = r[2]
    })
}
const v1 = (name: string, f: (a: number[]) => V) => vecFn(name, ['float3'], f)
const v2 = (name: string, f: (a: number[], b: number[]) => V) => vecFn(name, ['float3', 'float3'], f)
const v3 = (name: string, f: (a: number[], b: number[], c: number[]) => V) => vecFn(name, ['float3', 'float3', 'float3'], f)
/** `BLI_UNROLL_MATH_VEC_*`: a scalar function per component. */
const each1 = (f: (a: number) => number) => (a: number[]) => [f(a[0]), f(a[1]), f(a[2])]
const each2 = (f: (a: number, b: number) => number) => (a: number[], b: number[]) => [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])]

/** `math::safe_divide` (`BLI_math_base.hh:107`). */
const safeDivide = (a: number, b: number) => (b !== 0 ? f32(a / b) : 0)

const FUNCTIONS: Record<string, MultiFunction> = {
    // :366.
    'float3 + float3': v2('float3 + float3', each2((a, b) => f32(a + b))),
    // :370.
    'float3 - float3': v2('float3 - float3', each2((a, b) => f32(a - b))),
    // :374.
    'float3 * float3': v2('float3 * float3', each2((a, b) => f32(a * b))),
    // :378: `math::safe_divide`.
    'float3 / float3': v2('float3 / float3', each2(safeDivide)),
    // :384: `math::cross_high_precision`.
    'cross_product(float3, float3)': v2('cross_product(float3, float3)', crossHighPrecision3),
    // :390.
    'project(float3, float3)': v2('project(float3, float3)', project3),
    // :396: the normal is normalised first.
    'reflect(float3, float3)': v2('reflect(float3, float3)', (a, b) => reflect3(a, normalize3(b))),
    // :402: `math::floor(math::safe_divide(a, b)) * b`.
    'snap(float3, float3)': v2('snap(float3, float3)', each2((a, b) => f32(Math.floor(safeDivide(a, b)) * b))),
    // :408: `math::safe_mod` (`BLI_math_base.hh:83`, `std::fmod`, 0 for a zero divisor).
    'float3 % float3': v2('float3 % float3', each2((a, b) => (b !== 0 ? f32(a % b) : 0))),
    // :412, :418: `std::min` / `std::max` per component.
    'min(float3, float3)': v2('min(float3, float3)', each2((a, b) => (b < a ? b : a))),
    'max(float3, float3)': v2('max(float3, float3)', each2((a, b) => (a < b ? b : a))),
    // :423.
    'float3 ** float3': v2('float3 ** float3', each2(safePowf)),
    // :429.
    'dot_product(float3, float3)': elementwise('dot_product(float3, float3)', ['float3', 'float3'], ['float'], (i, o) => {
        o[0][0] = dot3(i[0], i[1])
    }),
    // :435.
    'distance(float3, float3)': elementwise('distance(float3, float3)', ['float3', 'float3'], ['float'], (i, o) => {
        o[0][0] = distance3(i[0], i[1])
    }),
    // :441.
    'float3 * float3 + float3': v3('float3 * float3 + float3', (a, b, c) => [0, 1, 2].map(k => f32(f32(a[k] * b[k]) + c[k]))),
    // :447: `wrapf(a, b, c)` per component.
    'wrap(float3, float3, float3)': v3('wrap(float3, float3, float3)', (a, b, c) => [0, 1, 2].map(k => wrapF(a[k], b[k], c[k]))),
    // :453.
    'faceforward(float3, float3, float3)': v3('faceforward(float3, float3, float3)', faceforward3),
    // :461: the normal is normalised first.
    'refract(float3, float3, float)': vecFn('refract(float3, float3, float)', ['float3', 'float3', 'float'], (a, b, c) => refract3(a, normalize3(b), c[0])),
    // :467.
    'length(float3)': elementwise('length(float3)', ['float3'], ['float'], (i, o) => {
        o[0][0] = length3(i[0])
    }),
    // :471.
    'float3 * float': vecFn('float3 * float', ['float3', 'float'], (a, b) => [f32(a[0] * b[0]), f32(a[1] * b[0]), f32(a[2] * b[0])]),
    // :475.
    'normalize(float3)': v1('normalize(float3)', normalize3),
    // :479: `math::floor(a + 0.5f)`.
    'round(float3)': v1('round(float3)', each1(a => Math.floor(f32(a + 0.5)))),
    // :482, :486.
    'floor(float3)': v1('floor(float3)', each1(Math.floor)),
    'ceil(float3)': v1('ceil(float3)', each1(Math.ceil)),
    // :491: `a - std::floor(a)`.
    'frac(float3)': v1('frac(float3)', each1(a => f32(a - Math.floor(a)))),
    // :495: `math::abs(VecBase)` is `a >= 0 ? a : -a` (`BLI_math_vector.hh:38`), which keeps -0.
    'abs(float3)': v1('abs(float3)', each1(a => (a >= 0 ? a : -a))),
    // :499: `math::sign` (`BLI_math_base.hh:38`).
    'sign(float3)': v1('sign(float3)', each1(a => (0 < a ? 1 : 0) - (a < 0 ? 1 : 0))),
    // :503-511: `sinf` / `cosf` / `tanf`.
    'sin(float3)': v1('sin(float3)', each1(sinf)),
    'cos(float3)': v1('cos(float3)', each1(cosf)),
    'tan(float3)': v1('tan(float3)', each1(tanf)),
}

/** `mf::registry::lookup(name)`. */
export function lookupMultiFunction(name: string): MultiFunction {
    const fn = FUNCTIONS[name]
    if (!fn) throw new Error(`procedural: multi-function '${name}' is not ported`)
    return fn
}
