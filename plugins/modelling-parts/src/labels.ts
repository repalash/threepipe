/**
 * SVG layouts for printed markings, for the `decal` command's `content.svg`: a ring of labels (dial legends), a
 * scale of ticks and numbers (lens distance and focal-length scales) and a word mark. Pure strings, so they work
 * the same in Node and the browser. Fonts are generic families: no logotype is reproduced.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface RingLabelOptions {
    /** Raster size, px (square). */
    size: number
    labels: string[]
    /** Label circle radius as a fraction of half the size. Default 0.78. */
    radius?: number
    /** Angle of the first label, degrees clockwise from the top. Default 0. */
    start?: number
    /** Degrees between labels. Default 360 / labels. */
    step?: number
    color?: string | string[]
    fontScale?: number
    fontFamily?: string
    fontWeight?: string | number
}

/** Labels round a circle, each upright towards the outside (a mode dial's top). */
export function ringLabels(o: RingLabelOptions): string {
    const S = o.size, c = S / 2, rr = (o.radius ?? 0.78) * c, step = o.step ?? 360 / o.labels.length
    const fs = (o.fontScale ?? 0.11) * S
    const parts = o.labels.map((t, i) => {
        const a = (o.start ?? 0) + i * step
        const col = Array.isArray(o.color) ? o.color[i % o.color.length] : o.color ?? '#ffffff'
        return `<text transform="rotate(${a.toFixed(2)} ${c} ${c})" x="${c}" y="${(c - rr).toFixed(2)}" text-anchor="middle" dominant-baseline="central" `
            + `font-family="${esc(o.fontFamily ?? 'Helvetica, Arial, sans-serif')}" font-weight="${o.fontWeight ?? 'bold'}" font-size="${fs.toFixed(1)}" fill="${esc(col)}">${esc(t)}</text>`
    })
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${parts.join('')}</svg>`
}

export interface ScaleOptions {
    width: number
    height: number
    /** Positions 0..1 across and the label at each. */
    marks: [number, string][]
    /** Minor ticks between marks. Default 0. */
    minor?: number
    color?: string
    fontScale?: number
    fontFamily?: string
}

/** A row of ticks with labels above them (distance or focal-length scale). */
export function scaleLabels(o: ScaleOptions): string {
    const W = o.width, H = o.height, col = esc(o.color ?? '#ffffff'), fs = (o.fontScale ?? 0.45) * H
    const out: string[] = []
    const tick = (x: number, len: number) => out.push(`<rect x="${(x - H * 0.03).toFixed(2)}" y="${(H - len).toFixed(2)}" width="${(H * 0.06).toFixed(2)}" height="${len.toFixed(2)}" fill="${col}"/>`)
    o.marks.forEach(([t, label], i) => {
        const x = t * W
        tick(x, H * 0.35)
        out.push(`<text x="${x.toFixed(2)}" y="${(H * 0.35).toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(o.fontFamily ?? 'Helvetica, Arial, sans-serif')}" font-size="${fs.toFixed(1)}" fill="${col}">${esc(label)}</text>`)
        const next = o.marks[i + 1]
        if (next && o.minor) for (let k = 1; k <= o.minor; k++) tick((t + (next[0] - t) * k / (o.minor + 1)) * W, H * 0.18)
    })
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`
}

export interface WordmarkOptions {
    width: number
    height: number
    text: string
    color?: string
    /** Serif for a product word mark, sans for a model badge. Default serif. */
    family?: 'serif' | 'sans'
    weight?: string | number
    italic?: boolean
    /** Second, smaller line under the first (a model badge: "EOS" over "5D Mark IV"). */
    sub?: string
}

/** A word mark or model badge stretched to the box. */
export function wordmark(o: WordmarkOptions): string {
    const W = o.width, H = o.height, col = esc(o.color ?? '#ffffff')
    const fam = o.family === 'sans' ? 'Helvetica, Arial, sans-serif' : 'Georgia, "Times New Roman", serif'
    const style = `font-family='${fam}' font-weight="${o.weight ?? 'bold'}" font-style="${o.italic ? 'italic' : 'normal'}" fill="${col}"`
    const lines = o.sub ? [[o.text, 0.36, 0.56], [o.sub, 0.78, 0.36]] as const : [[o.text, 0.5, 0.86]] as const
    const t = lines.map(([s, y, k]) => `<text x="${W / 2}" y="${(H * y).toFixed(2)}" text-anchor="middle" dominant-baseline="central" ${style} font-size="${(H * k).toFixed(1)}" textLength="${(W * 0.96).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(s)}</text>`)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${t.join('')}</svg>`
}
