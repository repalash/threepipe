/**
 * Colour-model conversions from `blenlib/intern/math_color.cc` (`hsv_to_rgb` :23, `hsl_to_rgb` :40,
 * `rgb_to_hsv` :296, `rgb_to_hsl` :325) and the colour blend modes of `ramp_blend`
 * (`blenkernel/intern/material.cc:1891`), float32 like Blender (every `float` intermediate rounded).
 */

import {f32} from '../f32'
import {clampMacro} from './base'

export type RGB = [number, number, number]

/** `min_ff` / `max_ff` (`math_base_inline.cc:321`, `:325`). */
const minFF = (a: number, b: number) => (a < b ? a : b)
const maxFF = (a: number, b: number) => (a > b ? a : b)

/** The shared hue ramp of `hsv_to_rgb` / `hsl_to_rgb` (`math_color.cc:27-33`). */
function hueRamp(h: number): RGB {
    const h6 = f32(h * 6)
    const nr = clampMacro(f32(Math.abs(f32(h6 - 3)) - 1), 0, 1)
    const ng = clampMacro(f32(2 - Math.abs(f32(h6 - 2))), 0, 1)
    const nb = clampMacro(f32(2 - Math.abs(f32(h6 - 4))), 0, 1)
    return [nr, ng, nb]
}

/** `hsv_to_rgb` (`math_color.cc:23`). */
export function hsvToRgb(h: number, s: number, v: number): RGB {
    const [nr, ng, nb] = hueRamp(h)
    return [
        f32(f32(f32(f32(nr - 1) * s) + 1) * v),
        f32(f32(f32(f32(ng - 1) * s) + 1) * v),
        f32(f32(f32(f32(nb - 1) * s) + 1) * v),
    ]
}

/** `hsl_to_rgb` (`math_color.cc:40`). */
export function hslToRgb(h: number, s: number, l: number): RGB {
    const [nr, ng, nb] = hueRamp(h)
    const chroma = f32(f32(1 - Math.abs(f32(f32(2 * l) - 1))) * s)
    return [
        f32(f32(f32(nr - 0.5) * chroma) + l),
        f32(f32(f32(ng - 0.5) * chroma) + l),
        f32(f32(f32(nb - 0.5) * chroma) + l),
    ]
}

const F_1E_20 = f32(1e-20)
const F_2_6 = f32(-2 / 6)

/** `rgb_to_hsv` (`math_color.cc:296`). */
export function rgbToHsv(r: number, g: number, b: number): RGB {
    let k = 0
    if (g < b) {
        const t = g
        g = b
        b = t
        k = -1
    }
    let minGB = b
    if (r < g) {
        const t = r
        r = g
        g = t
        k = f32(F_2_6 - k)
        minGB = minFF(g, b)
    }
    const chroma = f32(r - minGB)
    const h = Math.abs(f32(k + f32(f32(g - b) / f32(f32(6 * chroma) + F_1E_20))))
    const s = f32(chroma / f32(r + F_1E_20))
    return [h, s, r]
}

/** `rgb_to_hsl` (`math_color.cc:325`). `std::max({r, g, b})` / `std::min({...})` keep the first extreme. */
export function rgbToHsl(r: number, g: number, b: number): RGB {
    let cmax = r
    if (cmax < g) cmax = g
    if (cmax < b) cmax = b
    let cmin = r
    if (g < cmin) cmin = g
    if (b < cmin) cmin = b
    const l = minFF(1, f32(f32(cmax + cmin) / 2))
    let h: number, s: number
    if (cmax === cmin) {
        h = s = 0
    } else {
        const d = f32(cmax - cmin)
        s = l > 0.5 ? f32(d / f32(f32(2 - cmax) - cmin)) : f32(d / f32(cmax + cmin))
        if (cmax === r) h = f32(f32(f32(g - b) / d) + (g < b ? 6 : 0))
        else if (cmax === g) h = f32(f32(f32(b - r) / d) + 2)
        else h = f32(f32(f32(r - g) / d) + 4)
    }
    h = f32(h / 6)
    return [h, s, l]
}

/** RNA identifiers of `rna_enum_ramp_blend_items` (`makesrna/intern/rna_material.cc:31`), in order. */
export const RAMP_BLEND_ITEMS = [
    'MIX', 'DARKEN', 'MULTIPLY', 'BURN', 'LIGHTEN', 'SCREEN', 'DODGE', 'ADD', 'OVERLAY', 'SOFT_LIGHT', 'LINEAR_LIGHT',
    'DIFFERENCE', 'EXCLUSION', 'SUBTRACT', 'DIVIDE', 'HUE', 'SATURATION', 'COLOR', 'VALUE',
] as const

/**
 * `ramp_blend(type, r_col, fac, col)` (`blenkernel/intern/material.cc:1891`): blends `col` into `rCol`
 * in place. `type` is the RNA identifier of the blend mode.
 */
export function rampBlend(type: string, rCol: number[], fac: number, col: ArrayLike<number>): void {
    const facm = f32(1 - fac)
    switch (type) {
    case 'MIX':
        for (let i = 0; i < 4; i++) rCol[i] = f32(f32(facm * rCol[i]) + f32(fac * col[i]))
        break
    case 'ADD':
        for (let i = 0; i < 3; i++) rCol[i] = f32(rCol[i] + f32(fac * col[i]))
        break
    case 'MULTIPLY':
        for (let i = 0; i < 3; i++) rCol[i] = f32(rCol[i] * f32(facm + f32(fac * col[i])))
        break
    case 'SCREEN':
        for (let i = 0; i < 3; i++) rCol[i] = f32(1 - f32(f32(facm + f32(fac * f32(1 - col[i]))) * f32(1 - rCol[i])))
        break
    case 'OVERLAY':
        for (let i = 0; i < 3; i++) {
            if (rCol[i] < 0.5) rCol[i] = f32(rCol[i] * f32(facm + f32(f32(2 * fac) * col[i])))
            else rCol[i] = f32(1 - f32(f32(facm + f32(f32(2 * fac) * f32(1 - col[i]))) * f32(1 - rCol[i])))
        }
        break
    case 'SUBTRACT':
        for (let i = 0; i < 3; i++) rCol[i] = f32(rCol[i] - f32(fac * col[i]))
        break
    case 'DIVIDE':
        // `facm * r + fac * r / col`: `(fac * r) / col`.
        for (let i = 0; i < 3; i++) if (col[i] !== 0) rCol[i] = f32(f32(facm * rCol[i]) + f32(f32(fac * rCol[i]) / col[i]))
        break
    case 'DIFFERENCE':
        for (let i = 0; i < 3; i++) rCol[i] = f32(f32(facm * rCol[i]) + f32(fac * Math.abs(f32(rCol[i] - col[i]))))
        break
    case 'EXCLUSION':
        for (let i = 0; i < 3; i++) {
            const x = f32(f32(rCol[i] + col[i]) - f32(f32(2 * rCol[i]) * col[i]))
            rCol[i] = maxFF(f32(f32(facm * rCol[i]) + f32(fac * x)), 0)
        }
        break
    case 'DARKEN':
        for (let i = 0; i < 3; i++) rCol[i] = f32(f32(minFF(rCol[i], col[i]) * fac) + f32(rCol[i] * facm))
        break
    case 'LIGHTEN':
        for (let i = 0; i < 3; i++) rCol[i] = f32(f32(maxFF(rCol[i], col[i]) * fac) + f32(rCol[i] * facm))
        break
    case 'DODGE':
        for (let i = 0; i < 3; i++) {
            if (rCol[i] === 0) continue
            let tmp = f32(1 - f32(fac * col[i]))
            if (tmp <= 0) rCol[i] = 1
            else if ((tmp = f32(rCol[i] / tmp)) > 1) rCol[i] = 1
            else rCol[i] = tmp
        }
        break
    case 'BURN':
        for (let i = 0; i < 3; i++) {
            let tmp = f32(facm + f32(fac * col[i]))
            if (tmp <= 0) rCol[i] = 0
            else if ((tmp = f32(1 - f32(f32(1 - rCol[i]) / tmp))) < 0) rCol[i] = 0
            else if (tmp > 1) rCol[i] = 1
            else rCol[i] = tmp
        }
        break
    case 'HUE': {
        const [colH, colS] = rgbToHsv(col[0], col[1], col[2])
        if (colS !== 0) {
            const [, rS, rV] = rgbToHsv(rCol[0], rCol[1], rCol[2])
            const t = hsvToRgb(colH, rS, rV)
            for (let i = 0; i < 3; i++) rCol[i] = f32(f32(facm * rCol[i]) + f32(fac * t[i]))
        }
        break
    }
    case 'SATURATION': {
        const [rH, rS, rV] = rgbToHsv(rCol[0], rCol[1], rCol[2])
        if (rS !== 0) {
            const [, colS] = rgbToHsv(col[0], col[1], col[2])
            const t = hsvToRgb(rH, f32(f32(facm * rS) + f32(fac * colS)), rV)
            rCol[0] = t[0]
            rCol[1] = t[1]
            rCol[2] = t[2]
        }
        break
    }
    case 'VALUE': {
        const [rH, rS, rV] = rgbToHsv(rCol[0], rCol[1], rCol[2])
        const [, , colV] = rgbToHsv(col[0], col[1], col[2])
        const t = hsvToRgb(rH, rS, f32(f32(facm * rV) + f32(fac * colV)))
        rCol[0] = t[0]
        rCol[1] = t[1]
        rCol[2] = t[2]
        break
    }
    case 'COLOR': {
        const [colH, colS] = rgbToHsv(col[0], col[1], col[2])
        if (colS !== 0) {
            const [, , rV] = rgbToHsv(rCol[0], rCol[1], rCol[2])
            const t = hsvToRgb(colH, colS, rV)
            for (let i = 0; i < 3; i++) rCol[i] = f32(f32(facm * rCol[i]) + f32(fac * t[i]))
        }
        break
    }
    case 'SOFT_LIGHT': {
        const sc = [0, 1, 2].map(i => f32(1 - f32(f32(1 - col[i]) * f32(1 - rCol[i]))))
        for (let i = 0; i < 3; i++) {
            const x = f32(f32(f32(f32(1 - rCol[i]) * col[i]) * rCol[i]) + f32(rCol[i] * sc[i]))
            rCol[i] = f32(f32(facm * rCol[i]) + f32(fac * x))
        }
        break
    }
    case 'LINEAR_LIGHT':
        for (let i = 0; i < 3; i++) {
            if (col[i] > 0.5) rCol[i] = f32(rCol[i] + f32(fac * f32(2 * f32(col[i] - 0.5))))
            else rCol[i] = f32(rCol[i] + f32(fac * f32(f32(2 * col[i]) - 1)))
        }
        break
    default:
        throw new Error(`procedural: color blend mode ${type} is not a ramp_blend mode`)
    }
}
