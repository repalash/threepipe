/**
 * Helpers shared by node ports: C float semantics (`std::min`, `fmodf`, ...) and builders for
 * element-wise multi-functions over float32 values (`mf::build::SI1_SO` ...).
 */

import {f32} from '../blender/f32'
import {DataType} from '../geometry/dataTypes'
import {elementwise, MultiFunction} from '../fields/field'

/** `std::min` / `min_ff` (`(b < a) ? b : a` / `(a < b) ? a : b` agree except for NaN: Blender's `min_ff` keeps `b` for NaN `a`). */
export const minFF = (a: number, b: number) => (a < b ? a : b)
export const maxFF = (a: number, b: number) => (a > b ? a : b)
/** `std::min<float>` (`b < a ? b : a`). */
export const stdMin = (a: number, b: number) => (b < a ? b : a)
/** `std::max<float>` (`a < b ? b : a`). */
export const stdMax = (a: number, b: number) => (a < b ? b : a)

/** C `fmodf`: JS `%` on floats is the same truncated remainder. */
export const fmodf = (a: number, b: number) => f32(a % b)

/** `mf::build::SI1_SO<float, float>`. */
export function fn1(name: string, f: (a: number) => number, inT: DataType = 'float', outT: DataType = 'float'): MultiFunction {
    return elementwise(name, [inT], [outT], (i, o) => {
        o[0][0] = f(i[0][0])
    })
}

/** `mf::build::SI2_SO<float, float, float>`. */
export function fn2(name: string, f: (a: number, b: number) => number, inT: DataType = 'float', outT: DataType = 'float'): MultiFunction {
    return elementwise(name, [inT, inT], [outT], (i, o) => {
        o[0][0] = f(i[0][0], i[1][0])
    })
}

/** `mf::build::SI3_SO<float, float, float, float>`. */
export function fn3(name: string, f: (a: number, b: number, c: number) => number, inT: DataType = 'float', outT: DataType = 'float'): MultiFunction {
    return elementwise(name, [inT, inT, inT], [outT], (i, o) => {
        o[0][0] = f(i[0][0], i[1][0], i[2][0])
    })
}

/** Memoise multi-functions per key: identity matters for field reuse, and building them is not free. */
export function cached<T>(build: (key: string) => T): (key: string) => T {
    const m = new Map<string, T>()
    return key => {
        let v = m.get(key)
        if (v === undefined) m.set(key, v = build(key))
        return v
    }
}

/** A multi-function with one boolean output (`mf::build::SI*_SO<..., bool>`): `pred` reads each input's components. */
export function elementwiseBool(name: string, inputs: readonly DataType[], pred: (...ins: number[][]) => boolean): MultiFunction {
    return elementwise(name, inputs, ['bool'], (i, o) => {
        o[0][0] = pred(...i) ? 1 : 0
    })
}

/**
 * `IMB_colormanagement_get_luminance` (`imbuf/intern/colormanagement_inline.h:24`): `dot_v3v3` with the
 * OCIO config's luma coefficients - Blender's default config, as `geometry/typeConversions.ts` assumes.
 */
const LUMA = [f32(0.2126), f32(0.7152), f32(0.0722)]
export function colormanagementLuminance(rgb: ArrayLike<number>): number {
    return f32(f32(f32(LUMA[0] * rgb[0]) + f32(LUMA[1] * rgb[1])) + f32(LUMA[2] * rgb[2]))
}
