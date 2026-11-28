import type {TransferFunctionPreset} from '../TransferFunction'

/**
 * A transfer function read from a file: the preset (points in 0..1, relative) and, when the file gives one, the value
 * range it was made for (in data units).
 */
export interface ParsedTransferFunction {
    preset: TransferFunctionPreset
    range?: [number, number]
}

// MRIcroGL colour tables (.clut): an INI file with up to 256 nodes, each a byte intensity (0..255 over the display
// range) and an RGBA colour (0..255), interpolated linearly; [FLT] min and max are the suggested display range, unset
// when equal. Ported from MRIcroGL colorTable.pas (CLUT2disk, GenerateLUT), BSD-3-Clause, Chris Rorden.

function iniValues(text: string) {
    const values: Record<string, string> = {}
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('[') || line.startsWith(';') || line.startsWith('#')) continue
        const i = line.indexOf('=')
        if (i > 0) values[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    return values
}

/**
 * Read an MRIcroGL `.clut` colour table. Alpha 0..255 becomes opacity 0..1.
 */
export function parseClut(text: string, name = 'clut'): ParsedTransferFunction {
    const v = iniValues(text)
    const n = parseInt(v.numnodes ?? '0')
    if (!(n > 1 && n <= 256)) throw new Error('parseClut: numnodes must be from 2 to 256')
    const colors: number[][] = []
    const opacities: number[][] = []
    for (let i = 0; i < n; i++) {
        let intensity = parseInt(v['nodeintensity' + i] ?? 'NaN')
        const rgba = (v['nodergba' + i] ?? '').split('|').filter(s => s !== '').map(Number)
        if (!Number.isFinite(intensity) || rgba.length < 4 || rgba.some(c => !Number.isFinite(c))) throw new Error(`parseClut: bad node ${i}`)
        // as MRIcroGL: the last node always ends the table
        if (i === n - 1 && intensity < 255) intensity = 255
        const x = Math.min(255, Math.max(0, intensity)) / 255
        colors.push([x, rgba[0] / 255, rgba[1] / 255, rgba[2] / 255])
        opacities.push([x, rgba[3] / 255])
    }
    const min = parseFloat(v.min ?? '0'), max = parseFloat(v.max ?? '0')
    return {
        preset: {name, absolute: false, colors, opacities},
        range: Number.isFinite(min) && Number.isFinite(max) && min !== max ? [min, max] : undefined,
    }
}

/**
 * Write an MRIcroGL `.clut` colour table: one node at every colour and opacity point (at most 256), opacity 0..1 as
 * alpha 0..255. `range` is written as the suggested display range.
 */
export function toClut(evaluate: (x: number) => [number, number, number, number], xs: number[], range?: [number, number]) {
    const bytes = [...new Set(xs.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255)))].sort((a, b) => a - b)
    if (bytes[0] !== 0) bytes.unshift(0)
    if (bytes[bytes.length - 1] !== 255) bytes.push(255)
    const nodes = bytes.length > 256 ? bytes.filter((_, i) => i % Math.ceil(bytes.length / 256) === 0 || i === bytes.length - 1) : bytes
    const b = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)
    const lines = ['[FLT]', `min=${range ? range[0] : 0}`, `max=${range ? range[1] : 0}`, '[INT]', `numnodes=${nodes.length}`, '[BYT]']
    nodes.forEach((n, i) => lines.push(`nodeintensity${i}=${n}`))
    lines.push('[RGBA255]')
    nodes.forEach((n, i) => {
        const [r, g, bl, a] = evaluate(n / 255)
        lines.push(`nodergba${i}=${b(r)}|${b(g)}|${b(bl)}|${b(a)}`)
    })
    return lines.join('\n') + '\n'
}

/**
 * NiiVue colour maps (JSON `{R, G, B, A, I, min?, max?}`): channels 0..255 at intensities `I` 0..255, the format
 * MRIcroGL also exports.
 */
export interface NiiVueColormap {
    R: number[]
    G: number[]
    B: number[]
    A?: number[]
    I?: number[]
    min?: number
    max?: number
}

export function parseNiiVueColormap(json: NiiVueColormap | string, name = 'niivue'): ParsedTransferFunction {
    const c = typeof json === 'string' ? JSON.parse(json) as NiiVueColormap : json
    const n = c.R?.length ?? 0
    if (n < 2 || c.G?.length !== n || c.B?.length !== n) throw new Error('parseNiiVueColormap: R, G and B need the same length, at least 2')
    const I = c.I && c.I.length === n ? c.I : Array.from({length: n}, (_, i) => Math.round(i * 255 / (n - 1)))
    const A = c.A && c.A.length === n ? c.A : Array.from({length: n}, (_, i) => Math.round(i * 255 / (n - 1)))
    const colors = I.map((x, i) => [x / 255, c.R[i] / 255, c.G[i] / 255, c.B[i] / 255])
    const opacities = I.map((x, i) => [x / 255, A[i] / 255])
    const min = c.min ?? 0, max = c.max ?? 0
    return {preset: {name, absolute: false, colors, opacities}, range: min !== max ? [min, max] : undefined}
}
