// Image metrics for render-vs-render comparison: SSIM (Wang, Bovik, Sheikh, Simoncelli 2004), Sobel edge
// magnitude, binary masks and IoU. Images are {w, h, data: Float32Array} single-channel, 0..255.
//
// SSIM is a port of the authors' reference MATLAB implementation, ssim.m (2009 revision,
// https://ece.uwaterloo.ca/~z70wang/research/ssim/ssim.m): 11x11 Gaussian window, sigma 1.5, K = [0.01 0.03],
// L = 255, 'valid' filtering, and the automatic downsampling by f = max(1, round(min(M, N) / 256)) with an
// f x f box filter ('symmetric' borders) before sampling every f-th pixel.

/** Rec. 601 luma of 8-bit RGB(A), as MATLAB's rgb2gray (0.2989, 0.5870, 0.1140). */
export function toGray(rgba, w, h, channels = 4) {
    const out = new Float32Array(w * h)
    for (let i = 0, j = 0; i < out.length; i++, j += channels)
        out[i] = 0.2989 * rgba[j] + 0.5870 * rgba[j + 1] + 0.1140 * rgba[j + 2]
    return {w, h, data: out}
}

/** fspecial('gaussian', size, sigma), separable: the normalised 1D kernel. */
export function gaussian1d(size = 11, sigma = 1.5) {
    const k = new Float64Array(size), c = (size - 1) / 2
    let s = 0
    for (let i = 0; i < size; i++) { k[i] = Math.exp(-((i - c) ** 2) / (2 * sigma * sigma)); s += k[i] }
    for (let i = 0; i < size; i++) k[i] /= s
    return k
}

/** filter2(k' * k, img, 'valid') for a separable kernel k. */
function filterValid(img, k) {
    const {w, h, data} = img, n = k.length
    const ow = w - n + 1, oh = h - n + 1
    const tmp = new Float64Array(ow * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < ow; x++) {
        let s = 0
        for (let i = 0; i < n; i++) s += k[i] * data[y * w + x + i]
        tmp[y * ow + x] = s
    }
    const out = new Float64Array(ow * oh)
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        let s = 0
        for (let i = 0; i < n; i++) s += k[i] * tmp[(y + i) * ow + x]
        out[y * ow + x] = s
    }
    return {w: ow, h: oh, data: out}
}

/** ssim.m's pre-filter: imfilter(img, ones(f)/f^2, 'symmetric', 'same') then img(1:f:end, 1:f:end). */
export function downsample(img, f) {
    if (f <= 1) return img
    const {w, h, data} = img
    // imfilter's kernel centre is floor((f + 1) / 2) (1-based), so the taps run from -(centre - 1) to f - centre
    const o0 = -(Math.floor((f + 1) / 2) - 1)
    const sym = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i }
    const ow = Math.ceil(w / f), oh = Math.ceil(h / f)
    const out = new Float32Array(ow * oh)
    for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
        const x = ox * f, y = oy * f
        let s = 0
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += data[sym(y + o0 + j, h) * w + sym(x + o0 + i, w)]
        out[oy * ow + ox] = s / (f * f)
    }
    return {w: ow, h: oh, data: out}
}

/**
 * Mean SSIM of two same-size grayscale images, and the SSIM map (in the downsampled, 'valid' frame).
 * `roi` = {x0, y0, x1, y1} in input pixels restricts the mean to map pixels whose window centre falls inside it.
 */
export function ssim(a, b, {K1 = 0.01, K2 = 0.03, L = 255, window = 11, sigma = 1.5, downsample: ds = true, roi = null} = {}) {
    if (a.w !== b.w || a.h !== b.h) throw new Error('ssim: images differ in size')
    const f = ds ? Math.max(1, Math.round(Math.min(a.w, a.h) / 256)) : 1
    a = downsample(a, f); b = downsample(b, f)
    const k = gaussian1d(window, sigma)
    const C1 = (K1 * L) ** 2, C2 = (K2 * L) ** 2
    const n = a.data.length
    const aa = new Float64Array(n), bb = new Float64Array(n), ab = new Float64Array(n)
    for (let i = 0; i < n; i++) { aa[i] = a.data[i] * a.data[i]; bb[i] = b.data[i] * b.data[i]; ab[i] = a.data[i] * b.data[i] }
    const img = d => ({w: a.w, h: a.h, data: d})
    const mu1 = filterValid(a, k), mu2 = filterValid(b, k)
    const s11 = filterValid(img(aa), k), s22 = filterValid(img(bb), k), s12 = filterValid(img(ab), k)
    const map = new Float64Array(mu1.data.length)
    const half = (window - 1) / 2
    let sum = 0, cnt = 0
    for (let y = 0; y < mu1.h; y++) for (let x = 0; x < mu1.w; x++) {
        const i = y * mu1.w + x
        const m1 = mu1.data[i], m2 = mu2.data[i]
        const v1 = s11.data[i] - m1 * m1, v2 = s22.data[i] - m2 * m2, c12 = s12.data[i] - m1 * m2
        const s = ((2 * m1 * m2 + C1) * (2 * c12 + C2)) / ((m1 * m1 + m2 * m2 + C1) * (v1 + v2 + C2))
        map[i] = s
        if (roi) {
            const cx = (x + half) * f, cy = (y + half) * f
            if (cx < roi.x0 || cx >= roi.x1 || cy < roi.y0 || cy >= roi.y1) continue
        }
        sum += s; cnt++
    }
    return {mssim: cnt ? sum / cnt : NaN, map: {w: mu1.w, h: mu1.h, data: map}, factor: f}
}

/** Sobel gradient magnitude (3x3, replicate borders). */
export function sobel(img) {
    const {w, h, data} = img
    const out = new Float32Array(w * h)
    const at = (x, y) => data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
        const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        out[y * w + x] = Math.min(255, Math.hypot(gx, gy) / 4)
    }
    return {w, h, data: out}
}

/** A binary mask (Uint8Array 0/1) of pixels brighter than `threshold`. */
export function mask(img, threshold = 128) {
    const m = new Uint8Array(img.w * img.h)
    for (let i = 0; i < m.length; i++) m[i] = img.data[i] > threshold ? 1 : 0
    return {w: img.w, h: img.h, data: m}
}

/** Intersection over union of two masks; 1 when both are empty. */
export function iou(a, b) {
    let inter = 0, uni = 0
    for (let i = 0; i < a.data.length; i++) { const p = a.data[i], q = b.data[i]; inter += p & q; uni += p | q }
    return uni ? inter / uni : 1
}

/** Bounding box {x0, y0, x1, y1} of the set pixels of one or more masks, padded by `pad`, clamped. */
export function maskBounds(masks, pad = 0) {
    const {w, h} = masks[0]
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (const m of masks) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m.data[y * w + x]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    if (x1 < 0) return {x0: 0, y0: 0, x1: w, y1: h}
    return {x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + 1 + pad), y1: Math.min(h, y1 + 1 + pad)}
}
