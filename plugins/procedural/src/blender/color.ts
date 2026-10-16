/**
 * Byte colour encoding - `color::encode` / `color::decode` (`blenlib/BLI_color.hh:50-85`) through
 * `linearrgb_to_srgb_uchar4` / `srgb_to_linearrgb_uchar4` (`blenlib/intern/math_color_inline.cc:42`,
 * `:105`), assuming the default scene-linear space (Rec.709), as Blender's default OCIO config is.
 *
 * Blender's release builds take the SIMD path of `linearrgb_to_srgb_v3_v3` (`math_color.cc:633`):
 * `pow(x, 1/2.4)` by bit-level approximation (`_bli_math_fastpow512`) plus `_mm_rsqrt_ps`. The port
 * follows that path, with `cvtps_epi32` rounding to nearest-even as SSE and sse2neon do, but uses an
 * exact `1 / sqrt` for `_mm_rsqrt_ps`, whose estimate is hardware-specific (x86 RSQRTPS vs. NEON
 * FRSQRTE + Newton steps). Results can differ from Blender by one step of the final byte only. See
 * `issues/open/modelling-tools/procedural-byte-color-rsqrt.md`.
 */

import {f32, floatAsInt} from './f32'

const i32 = new Int32Array(1)
const f32a = new Float32Array(i32.buffer)

function intAsFloat(v: number): number {
    i32[0] = v
    return f32a[0]
}

/** `_mm_cvtps_epi32`: float to int32, rounding to nearest even. */
function cvtpsEpi32(x: number): number {
    const r = Math.round(x)
    // Math.round rounds .5 up; nearest-even rounds .5 to the even neighbour.
    if (Math.abs(x - Math.trunc(x)) === 0.5) return 2 * Math.round(x / 2)
    return r | 0
}

/** `_bli_math_fastpow` (`math_color.cc:512`). */
function fastpow(exp: number, e2coeff: number, arg: number): number {
    let ret = f32(arg * intAsFloat(e2coeff))
    ret = f32(floatAsInt(ret))
    ret = f32(ret * intAsFloat(exp))
    return intAsFloat(cvtpsEpi32(ret))
}

const rsqrt = (x: number) => f32(1 / f32(Math.sqrt(x)))

/** `_bli_math_fastpow512` (`math_color.cc:566`): `x^(1/2.4)`. */
function fastpow512(arg: number): number {
    const xf = fastpow(0x3f2aaaab, 0x5eb504f3, arg)
    const xover = f32(arg * xf)
    const xfm1 = rsqrt(xf)
    const x2 = f32(arg * arg)
    const xunder = f32(x2 * xfm1)
    const k = f32(f32(f32(1) / f32(f32(3) * f32(0.629960524947437))) * f32(0.999852))
    let xavg = f32(k * f32(xover + xunder))
    xavg = f32(xavg * rsqrt(xavg))
    xavg = f32(xavg * rsqrt(xavg))
    return xavg
}

/** `linearrgb_to_srgb_v4_simd` (`math_color.cc:607`) for one channel. */
export function linearToSrgb(c: number): number {
    if (c < f32(0.0031308)) return Math.max(f32(c * f32(12.92)), 0)
    return f32(f32(f32(1.055) * fastpow512(c)) + f32(-0.055))
}

/** `srgb_to_linearrgb` (`math_color.cc:481`), used to fill `BLI_color_from_srgb_table`. */
export function srgbToLinear(c: number): number {
    if (c < f32(0.04045)) return c < 0 ? 0 : f32(c * f32(1 / 12.92))
    return f32(Math.pow(f32(f32(c + f32(0.055)) * f32(1 / 1.055)), f32(2.4)))
}

/** `unit_float_to_uchar_clamp` (`math_base_inline.cc:579`). */
export function unitFloatToUcharClamp(v: number): number {
    if (v <= 0) return 0
    if (v > f32(1 - f32(0.5 / 255))) return 255
    return Math.trunc(f32(f32(255 * v) + 0.5))
}

/** `color::encode(ColorGeometry4f)`: linear float RGBA to sRGB bytes; alpha is not transformed. */
export function encodeByteColor(rgba: ArrayLike<number>, out: number[] = []): number[] {
    out[0] = unitFloatToUcharClamp(linearToSrgb(rgba[0]))
    out[1] = unitFloatToUcharClamp(linearToSrgb(rgba[1]))
    out[2] = unitFloatToUcharClamp(linearToSrgb(rgba[2]))
    out[3] = unitFloatToUcharClamp(rgba[3])
    return out
}

const table = new Float32Array(256)
for (let b = 0; b < 256; b++) table[b] = srgbToLinear(f32(b * f32(1 / 255)))

/** `color::decode(ColorGeometry4b)` via `BLI_color_from_srgb_table` (`math_color.cc:769`). */
export function decodeByteColor(rgba: ArrayLike<number>, out: number[] = []): number[] {
    out[0] = table[rgba[0]]
    out[1] = table[rgba[1]]
    out[2] = table[rgba[2]]
    out[3] = f32(rgba[3] * f32(1 / 255))
    return out
}
