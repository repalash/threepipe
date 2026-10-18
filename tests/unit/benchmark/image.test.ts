import {describe, expect, it} from 'vitest'
// @ts-expect-error plain ESM module without types
import {downsample, gaussian1d, iou, mask, maskBounds, sobel, ssim, toGray} from '../../../demos/benchmark/metrics/image.mjs'

type Img = {w: number, h: number, data: Float32Array}
const img = (w: number, h: number, f: (x: number, y: number) => number): Img => {
    const data = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y)
    return {w, h, data}
}
const rand = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

/** SSIM straight from the definition: a full 2D 11x11 Gaussian window, 'valid', no downsampling. */
function ssimDirect(a: Img, b: Img) {
    const k = gaussian1d(11, 1.5), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2
    let sum = 0, n = 0
    for (let y = 0; y + 11 <= a.h; y++) for (let x = 0; x + 11 <= a.w; x++) {
        let m1 = 0, m2 = 0, s11 = 0, s22 = 0, s12 = 0
        for (let j = 0; j < 11; j++) for (let i = 0; i < 11; i++) {
            const w = k[i] * k[j], p = a.data[(y + j) * a.w + x + i], q = b.data[(y + j) * a.w + x + i]
            m1 += w * p; m2 += w * q; s11 += w * p * p; s22 += w * q * q; s12 += w * p * q
        }
        const v1 = s11 - m1 * m1, v2 = s22 - m2 * m2, c = s12 - m1 * m2
        sum += ((2 * m1 * m2 + C1) * (2 * c + C2)) / ((m1 * m1 + m2 * m2 + C1) * (v1 + v2 + C2)); n++
    }
    return sum / n
}

describe('benchmark image metrics', () => {
    it('gaussian window is fspecial(gaussian, 11, 1.5): normalised and symmetric', () => {
        const k = gaussian1d(11, 1.5)
        expect(k.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1, 12)
        for (let i = 0; i < 11; i++) expect(k[i]).toBeCloseTo(k[10 - i], 15)
        expect(k[5] / k[6]).toBeCloseTo(Math.exp(1 / (2 * 1.5 * 1.5)), 12)
    })

    it('SSIM of an image with itself is 1', () => {
        const r = rand(3), a = img(80, 60, () => r() * 255)
        expect(ssim(a, a).mssim).toBeCloseTo(1, 12)
    })

    it('SSIM of two constant images is the luminance term alone', () => {
        const C1 = (0.01 * 255) ** 2, a = img(40, 40, () => 100), b = img(40, 40, () => 160)
        expect(ssim(a, b).mssim).toBeCloseTo((2 * 100 * 160 + C1) / (100 * 100 + 160 * 160 + C1), 10)
    })

    it('the separable implementation equals the direct 2D definition', () => {
        const r = rand(11), a = img(48, 40, () => r() * 255)
        const b = img(48, 40, (x, y) => a.data[y * 48 + x] * 0.7 + 30 + r() * 40)
        expect(ssim(a, b, {downsample: false}).mssim).toBeCloseTo(ssimDirect(a, b), 10)
    })

    it('downsamples by round(min(M, N) / 256) as ssim.m does', () => {
        expect(ssim(img(600, 400, () => 1), img(600, 400, () => 1)).factor).toBe(2)
        expect(ssim(img(1200, 800, () => 1), img(1200, 800, () => 1)).factor).toBe(3)
        expect(ssim(img(300, 200, () => 1), img(300, 200, () => 1)).factor).toBe(1)
    })

    it('downsample uses imfilter centring and symmetric borders', () => {
        const a = img(4, 4, (x, y) => y * 4 + x)
        // f = 2: centre floor(3/2) = 1 (1-based) -> taps at offsets 0 and +1
        const d2 = downsample(a, 2)
        expect(Array.from(d2.data)).toEqual([(0 + 1 + 4 + 5) / 4, (2 + 3 + 6 + 7) / 4, (8 + 9 + 12 + 13) / 4, (10 + 11 + 14 + 15) / 4])
        // f = 3: centre 2 -> offsets -1..+1; at (0, 0) the row/column -1 mirrors to 0
        const d3 = downsample(a, 3)
        expect(d3.w).toBe(2)
        expect(d3.data[0]).toBeCloseTo((0 + 0 + 1 + 0 + 0 + 1 + 4 + 4 + 5) / 9, 6)
        // (3, 0): columns 2, 3, 4->3 ; rows -1->0, 0, 1
        expect(d3.data[1]).toBeCloseTo((2 + 3 + 3 + 2 + 3 + 3 + 6 + 7 + 7) / 9, 6)
    })

    it('ROI restricts the mean to windows centred inside it', () => {
        const a = img(64, 64, (x) => x < 32 ? 50 : 200), b = img(64, 64, (x) => x < 32 ? 50 : 100)
        const left = ssim(a, b, {downsample: false, roi: {x0: 0, y0: 0, x1: 20, y1: 64}}).mssim
        const right = ssim(a, b, {downsample: false, roi: {x0: 44, y0: 0, x1: 64, y1: 64}}).mssim
        expect(left).toBeCloseTo(1, 10)
        expect(right).toBeLessThan(0.9)
    })

    it('toGray uses rgb2gray weights; Sobel sees a step and nothing on flat ground', () => {
        const g = toGray(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1)
        expect(g.data[0]).toBeCloseTo(0.2989 * 255, 3)
        expect(g.data[1]).toBeCloseTo(0.5870 * 255, 3)
        const s = sobel(img(10, 10, x => x < 5 ? 0 : 100))
        expect(s.data[5 * 10 + 2]).toBe(0)
        expect(s.data[5 * 10 + 5]).toBeGreaterThan(0)
    })

    it('IoU and mask bounds', () => {
        const a = mask(img(10, 10, (x, y) => x < 5 && y < 5 ? 255 : 0)), b = mask(img(10, 10, (x, y) => x < 5 && y < 10 ? 255 : 0))
        expect(iou(a, b)).toBeCloseTo(25 / 50, 12)
        expect(iou(mask(img(4, 4, () => 0)), mask(img(4, 4, () => 0)))).toBe(1)
        expect(maskBounds([a, b], 1)).toEqual({x0: 0, y0: 0, x1: 6, y1: 10})
    })
})
