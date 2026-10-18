/**
 * `ColorBand` evaluation - `blenkernel/intern/colorband.cc`: `BKE_colorband_init` (:18, the Color Ramp node's
 * default `BKE_colorband_add(true)` :345), `colorband_hue_interp` :356 and `BKE_colorband_evaluate` :436, with
 * `key_curve_position_weights` (`blenkernel/intern/key.cc:307`) for B-Spline and Cardinal. Elements are used in
 * their stored order, as Blender does (they are kept sorted by `BKE_colorband_update_sort` when added).
 * RNA names (`makesrna/intern/rna_color.cc`): interpolation EASE/CARDINAL/LINEAR/B_SPLINE/CONSTANT, color mode
 * RGB/HSV/HSL, hue interpolation NEAR/FAR/CW/CCW.
 */

import {f32} from '../f32'
import {hslToRgb, hsvToRgb, rgbToHsl, rgbToHsv} from './color'

/** The serialised form (`porting/blender/dump_blend.py` `colorRamp`). */
export interface ColorRampJSON {
    interpolation?: string
    colorMode?: string
    hueInterpolation?: string
    elements?: {position: number, color: number[]}[]
}

interface CBData {
    r: number
    g: number
    b: number
    a: number
    pos: number
}

export interface ColorBand {
    data: CBData[]
    colorMode: 'RGB' | 'HSV' | 'HSL'
    ipotype: 'LINEAR' | 'EASE' | 'B_SPLINE' | 'CARDINAL' | 'CONSTANT'
    ipotypeHue: 'NEAR' | 'FAR' | 'CW' | 'CCW'
}

const INTERPOLATIONS = ['EASE', 'CARDINAL', 'LINEAR', 'B_SPLINE', 'CONSTANT']
const COLOR_MODES = ['RGB', 'HSV', 'HSL']
const HUE_INTERPOLATIONS = ['NEAR', 'FAR', 'CW', 'CCW']

/** A color band from its serialised form; missing parts are `BKE_colorband_init(coba, true)`'s. */
export function buildColorBand(json: ColorRampJSON | undefined): ColorBand {
    const ipotype = json?.interpolation ?? 'LINEAR'
    const colorMode = json?.colorMode ?? 'RGB'
    const ipotypeHue = json?.hueInterpolation ?? 'NEAR'
    if (!INTERPOLATIONS.includes(ipotype)) throw new Error(`procedural: color ramp interpolation ${ipotype} is not supported`)
    if (!COLOR_MODES.includes(colorMode)) throw new Error(`procedural: color ramp color mode ${colorMode} is not supported`)
    if (!HUE_INTERPOLATIONS.includes(ipotypeHue)) throw new Error(`procedural: color ramp hue interpolation ${ipotypeHue} is not supported`)
    const elements = json?.elements ?? [{position: 0, color: [0, 0, 0, 1]}, {position: 1, color: [1, 1, 1, 1]}]
    return {
        data: elements.map(e => ({r: f32(e.color[0]), g: f32(e.color[1]), b: f32(e.color[2]), a: f32(e.color[3] ?? 1), pos: f32(e.position)})),
        colorMode: colorMode as ColorBand['colorMode'],
        ipotype: ipotype as ColorBand['ipotype'],
        ipotypeHue: ipotypeHue as ColorBand['ipotypeHue'],
    }
}

/** `key_curve_position_weights` (`key.cc:307`) for KEY_CARDINAL / KEY_BSPLINE. */
function keyCurvePositionWeights(t: number, cardinal: boolean): [number, number, number, number] {
    const t2 = f32(t * t)
    const t3 = f32(t2 * t)
    if (cardinal) {
        const fc = f32(0.71)
        return [
            f32(f32(f32(-fc * t3) + f32(f32(2 * fc) * t2)) - f32(fc * t)),
            f32(f32(f32(f32(2 - fc) * t3) + f32(f32(fc - 3) * t2)) + 1),
            f32(f32(f32(f32(fc - 2) * t3) + f32(f32(3 - f32(2 * fc)) * t2)) + f32(fc * t)),
            f32(f32(fc * t3) - f32(fc * t2)),
        ]
    }
    const sixth = f32(0.16666666), twoThirds = f32(0.66666666)
    return [
        f32(f32(f32(f32(-sixth * t3) + f32(0.5 * t2)) - f32(0.5 * t)) + sixth),
        f32(f32(f32(0.5 * t3) - t2) + twoThirds),
        f32(f32(f32(f32(-0.5 * t3) + f32(0.5 * t2)) + f32(0.5 * t)) + sixth),
        f32(sixth * t3),
    ]
}

/** `colorband_hue_interp` (`colorband.cc:356`). */
function colorbandHueInterp(ipotypeHue: ColorBand['ipotypeHue'], mfac: number, fac: number, h1: number, h2: number): number {
    const interp = (a: number, b: number) => f32(f32(mfac * a) + f32(fac * b))
    const mod = (h: number) => (h < 1 ? h : f32(h - 1))
    h1 = mod(h1)
    h2 = mod(h2)
    let mode = 0
    switch (ipotypeHue) {
    case 'NEAR':
        if (h1 < h2 && f32(h2 - h1) > 0.5) mode = 1
        else if (h1 > h2 && f32(h2 - h1) < -0.5) mode = 2
        break
    case 'FAR':
        if (h1 === h2) mode = 1
        else if (h1 < h2 && f32(h2 - h1) < 0.5) mode = 1
        else if (h1 > h2 && f32(h2 - h1) > -0.5) mode = 2
        break
    case 'CCW':
        if (h1 > h2) mode = 2
        break
    case 'CW':
        if (h1 < h2) mode = 1
        break
    }
    if (mode === 0) return interp(h1, h2)
    if (mode === 1) return mod(interp(f32(h1 + 1), h2))
    return mod(interp(h1, f32(h2 + 1)))
}

/** `BKE_colorband_evaluate` (`colorband.cc:436`): RGBA of `input`. */
export function colorbandEvaluate(coba: ColorBand, input: number): [number, number, number, number] {
    const data = coba.data
    const tot = data.length
    if (tot === 0) throw new Error('procedural: color ramp has no elements')
    const out: [number, number, number, number] = [0, 0, 0, 0]
    const set = (c: CBData) => {
        out[0] = c.r
        out[1] = c.g
        out[2] = c.b
        out[3] = c.a
    }
    const ipotype = coba.colorMode === 'RGB' ? coba.ipotype : 'LINEAR'
    const simple = ipotype === 'LINEAR' || ipotype === 'EASE' || ipotype === 'CONSTANT'
    if (tot === 1) {
        set(data[0])
        return out
    }
    if (input <= data[0].pos && simple) {
        set(data[0])
        return out
    }
    let a = 0
    for (; a < tot; a++) if (data[a].pos > input) break
    let cbd1: CBData, cbd2: CBData
    if (a === tot) {
        cbd2 = data[a - 1]
        cbd1 = {...cbd2, pos: 1}
    } else if (a === 0) {
        cbd1 = data[0]
        cbd2 = {...cbd1, pos: 0}
    } else {
        cbd1 = data[a]
        cbd2 = data[a - 1]
    }
    if (a === tot && simple) {
        set(cbd2)
        return out
    }
    if (ipotype === 'CONSTANT') {
        set(cbd2)
        return out
    }
    let fac = cbd2.pos !== cbd1.pos ? f32(f32(input - cbd1.pos) / f32(cbd2.pos - cbd1.pos)) : (a !== tot ? 0 : 1)
    if (ipotype === 'B_SPLINE' || ipotype === 'CARDINAL') {
        // Indices into the stored elements: cbd0 right of cbd1, cbd3 left of cbd2 (the virtual end copies count as the end elements).
        const i1 = a === tot ? tot - 1 : a
        const i2 = a === 0 ? 0 : a - 1
        const cbd0 = a >= tot - 1 ? cbd1 : data[i1 + 1]
        const cbd3 = a < 2 ? cbd2 : data[i2 - 1]
        fac = fac < 0 ? 0 : fac > 1 ? 1 : fac
        const t = keyCurvePositionWeights(fac, ipotype === 'CARDINAL')
        const ch = (k: 'r' | 'g' | 'b' | 'a') => {
            const v = f32(f32(f32(f32(t[3] * cbd3[k]) + f32(t[2] * cbd2[k])) + f32(t[1] * cbd1[k])) + f32(t[0] * cbd0[k]))
            return v < 0 ? 0 : v > 1 ? 1 : v
        }
        return [ch('r'), ch('g'), ch('b'), ch('a')]
    }
    if (ipotype === 'EASE') {
        const fac2 = f32(fac * fac)
        fac = f32(f32(3 * fac2) - f32(f32(2 * fac2) * fac))
    }
    const mfac = f32(1 - fac)
    const lerp = (x: number, y: number) => f32(f32(mfac * x) + f32(fac * y))
    if (coba.colorMode === 'HSV' || coba.colorMode === 'HSL') {
        const toModel = coba.colorMode === 'HSV' ? rgbToHsv : rgbToHsl
        const col1 = toModel(cbd1.r, cbd1.g, cbd1.b)
        const col2 = toModel(cbd2.r, cbd2.g, cbd2.b)
        const h = colorbandHueInterp(coba.ipotypeHue, mfac, fac, col1[0], col2[0])
        const s = lerp(col1[1], col2[1])
        const v = lerp(col1[2], col2[2])
        const rgb = coba.colorMode === 'HSV' ? hsvToRgb(h, s, v) : hslToRgb(h, s, v)
        return [rgb[0], rgb[1], rgb[2], lerp(cbd1.a, cbd2.a)]
    }
    return [lerp(cbd1.r, cbd2.r), lerp(cbd1.g, cbd2.g), lerp(cbd1.b, cbd2.b), lerp(cbd1.a, cbd2.a)]
}
