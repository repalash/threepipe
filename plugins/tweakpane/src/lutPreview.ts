// HSL → RGB in [0..1]
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) return [l, l, l]
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const conv = (t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 0.5) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
    }
    return [conv(h + 1 / 3), conv(h), conv(h - 1 / 3)]
}

/**
 * Renders a thumbnail visualization of a 3D LUT (`.cube`) file. Uses a **3-band strip**
 * — the shape used by many color-grading UIs — because it makes different LUTs
 * visibly distinct:
 *
 *   Band 1 (top third)    — grayscale luminance ramp (s=0, l=0..1).
 *                           Shows the LUT's tonal curve: lift / gamma / gain, contrast.
 *   Band 2 (middle third) — **desaturated** rainbow (s=0.35, l=0.55, hue=0..1).
 *                           Shows midtone hue shifts — where most creative grading lives
 *                           (skin, sky, foliage). Two LUTs that differ here look visibly
 *                           different even if their saturated-primary behavior is similar.
 *   Band 3 (bottom third)  — fully saturated rainbow (s=1, l=0.5, hue=0..1).
 *                           Shows saturated-primary shifts (oranges, teals, magentas).
 *
 * Each reference RGB is trilinearly sampled into the LUT voxel grid. Supports both
 * UnsignedByteType (Uint8Array) and FloatType (Float32Array) LUT data, threepipe's
 * `.texture3D` wrappers and legacy `.texture` 2D-fallback wrappers.
 *
 * Returns `null` if the wrapper has no usable voxel data (caller should fall back
 * to a placeholder).
 */
export function lutPreviewDataUrl(wrapper: any, w = 160, h = 81): string | null {
    const tex = wrapper.texture3D ?? wrapper.texture
    const img = tex?.image
    const data = img?.data as Uint8Array | Uint8ClampedArray | Float32Array | undefined
    const n = img?.width ?? wrapper.size
    if (!data || !n || n < 2) return null
    const isFloat = data instanceof Float32Array
    const scale = isFloat ? 255 : 1
    const nn = n * n
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const out = ctx.createImageData(w, h)
    const clamp01 = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x
    const max = n - 1
    const fetch3 = (ix: number, iy: number, iz: number, dst: [number, number, number]) => {
        const o = (iz * nn + iy * n + ix) * 4
        dst[0] = data[o] * scale; dst[1] = data[o + 1] * scale; dst[2] = data[o + 2] * scale
    }
    const c000: [number, number, number] = [0, 0, 0]
    const c100: [number, number, number] = [0, 0, 0]
    const c010: [number, number, number] = [0, 0, 0]
    const c110: [number, number, number] = [0, 0, 0]
    const c001: [number, number, number] = [0, 0, 0]
    const c101: [number, number, number] = [0, 0, 0]
    const c011: [number, number, number] = [0, 0, 0]
    const c111: [number, number, number] = [0, 0, 0]
    const samplePixel = (r: number, g: number, b: number, dstIdx: number) => {
        const fx = r * max, fy = g * max, fz = b * max
        const ix0 = Math.floor(fx), iy0 = Math.floor(fy), iz0 = Math.floor(fz)
        const ix1 = Math.min(ix0 + 1, max), iy1 = Math.min(iy0 + 1, max), iz1 = Math.min(iz0 + 1, max)
        const tx = fx - ix0, ty = fy - iy0, tz = fz - iz0
        fetch3(ix0, iy0, iz0, c000); fetch3(ix1, iy0, iz0, c100)
        fetch3(ix0, iy1, iz0, c010); fetch3(ix1, iy1, iz0, c110)
        fetch3(ix0, iy0, iz1, c001); fetch3(ix1, iy0, iz1, c101)
        fetch3(ix0, iy1, iz1, c011); fetch3(ix1, iy1, iz1, c111)
        for (let i = 0; i < 3; i++) {
            const a00 = c000[i] * (1 - tx) + c100[i] * tx
            const a10 = c010[i] * (1 - tx) + c110[i] * tx
            const a01 = c001[i] * (1 - tx) + c101[i] * tx
            const a11 = c011[i] * (1 - tx) + c111[i] * tx
            const b0 = a00 * (1 - ty) + a10 * ty
            const b1 = a01 * (1 - ty) + a11 * ty
            out.data[dstIdx + i] = Math.round(b0 * (1 - tz) + b1 * tz)
        }
        out.data[dstIdx + 3] = 255
    }
    const band = Math.floor(h / 3)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const t = x / (w - 1)
            let r: number, g: number, b: number
            if (y < band) {
                // Band 1: grayscale luminance ramp
                r = g = b = t
            } else if (y < band * 2) {
                // Band 2: desaturated midtone rainbow (where LUTs differ most)
                ;[r, g, b] = hslToRgb(t, 0.35, 0.55).map(clamp01) as [number, number, number]
            } else {
                // Band 3: saturated rainbow (shows primary shifts)
                ;[r, g, b] = hslToRgb(t, 1, 0.5).map(clamp01) as [number, number, number]
            }
            samplePixel(r, g, b, (y * w + x) * 4)
        }
    }
    ctx.putImageData(out, 0, 0)
    return canvas.toDataURL('image/png')
}
