/** The arm64 Eigen paths of `math::invert(float4x4)` (see `eigen.ts`): FRECPE/FRECPS, fused multiply-add, inverse. */
import {describe, expect, it} from 'vitest'
import {f32} from '../f32'
import {eigenDeterminant4, fmaf, frecpe, frecps, invertMat4, neonReciprocal} from './eigen'

describe('Arm reciprocal estimate (FPRecipEstimate)', () => {
    it('matches the architecture table', () => {
        // scaled = 256 -> 2^19 / 513 = 1022 -> (1022 + 1) / 2 = 511 -> 1.99609375 * 2^-1.
        expect(frecpe(1)).toBe(0.998046875)
        expect(frecpe(2)).toBe(0.4990234375)
        expect(frecpe(-4)).toBe(-0.24951171875)
        expect(frecpe(0)).toBe(Infinity)
        expect(frecpe(Infinity)).toBe(0)
    })
    it('two Newton steps reach the reciprocal of simple values', () => {
        expect(neonReciprocal(2)).toBe(0.5)
        expect(frecps(2, 0.5)).toBe(1)
        expect(Math.abs(neonReciprocal(3) - 1 / 3)).toBeLessThan(1e-7)
    })
})

describe('fmaf', () => {
    it('rounds once', () => {
        const a = f32(1 + 2 ** -12)
        // a * a = 1 + 2^-11 + 2^-24: rounded on its own the 2^-24 is lost (a tie, to even), fused it stays.
        expect(fmaf(a, a, -1)).toBe(2 ** -11 + 2 ** -24)
        expect(f32(f32(a * a) - 1)).toBe(2 ** -11)
    })
    it('resolves double-rounding ties by the residual', () => {
        // a * b = 2^6 + 2^-30 exactly; 2^30 + 2^6 + 2^-30 rounds to the double 2^30 + 2^6, a float32 tie that
        // ties-to-even would round down, but the exact sum is above it.
        const a = f32(64 * (1 + 2 ** -12)), b = f32(1 - 2 ** -12 + 2 ** -24)
        expect(a * b).toBe(64 + 2 ** -30)
        expect(fmaf(a, b, 2 ** 30)).toBe(2 ** 30 + 128)
        expect(f32(2 ** 30 + 64)).toBe(2 ** 30)
    })
})

describe('4x4 determinant and inverse', () => {
    it('inverts a scale-translate matrix and reports singular ones', () => {
        const m = [2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0.5, 0, 1, 2, 3, 1]
        expect(eigenDeterminant4(m)).toBe(4)
        const {m: inv, success} = invertMat4(m)
        expect(success).toBe(true)
        expect(Array.from(inv, x => x + 0)).toEqual([0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 2, 0, -0.5, -0.5, -6, 1])
        expect(invertMat4([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).success).toBe(false)
    })
})
