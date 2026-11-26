import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {faceCalcNormal, faceCalcPolyNormal, faceNormalUpdate} from './polygon'

describe('faceCalcNormal', () => {
    it('matches the winding of a triangle, a quad and an n-gon', () => {
        const bm = new BMesh()
        const tri = bm.faceCreate([
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(0, 1, 0)])
        expect(faceCalcNormal(tri)).toEqual([0, 0, 1])

        const quad = bm.faceCreate([
            bm.vertCreate(3, 0, 0), bm.vertCreate(4, 0, 0),
            bm.vertCreate(4, 1, 0), bm.vertCreate(3, 1, 0)])
        expect(faceCalcNormal(quad)).toEqual([0, 0, 1])

        const ngon = bm.faceCreate([0, 1, 2, 3, 4].map(i =>
            bm.vertCreate(10 + Math.cos(i * 2 * Math.PI / 5), Math.sin(i * 2 * Math.PI / 5), 0)))
        expect(faceCalcNormal(ngon)[2]).toBeCloseTo(1, 6)
    })

    /**
     * The quad shortcut and Newell's sum are the same vector for *any* quad, planar or not - the
     * identity holds for four arbitrary points, so `normal_quad_v3` is a cheaper route to the same
     * answer rather than a different rule. Asserted on a deliberately warped quad, because the
     * opposite is the natural assumption and it would send someone looking for a bug that is not
     * there.
     */
    it('takes the same answer as Newell for a quad, planar or not', () => {
        const bm = new BMesh()
        for (const points of [
            [[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]],            // planar
            [[0, 0, 0], [2, 0, 0], [2, 2, 1], [0, 2, 0]],            // one corner lifted
            [[-1, -1, 0.5], [1, -1, -0.5], [1, 1, 0.5], [-1, 1, -0.5]], // saddle
        ]) {
            const quad = bm.faceCreate(points.map(p => bm.vertCreate(p[0], p[1], p[2])))
            const shortcut = faceCalcNormal(quad)
            const newell = faceCalcPolyNormal(quad)
            expect(Math.hypot(...shortcut)).toBeCloseTo(1, 10)
            for (let i = 0; i < 3; i++) expect(shortcut[i]).toBeCloseTo(newell[i], 10)
        }
    })

    it('falls back to +Z for a degenerate face rather than a zero vector', () => {
        const bm = new BMesh()
        const line = bm.faceCreate([
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(2, 0, 0)])
        const n = faceCalcPolyNormal(line)
        expect(Math.hypot(...n)).toBeCloseTo(1, 10)
    })

    it('faceNormalUpdate stores what faceCalcNormal returns', () => {
        const bm = new BMesh()
        const tri = bm.faceCreate([
            bm.vertCreate(0, 0, 0), bm.vertCreate(0, 1, 0), bm.vertCreate(0, 0, 1)])
        faceNormalUpdate(tri)
        expect([tri.nx, tri.ny, tri.nz]).toEqual(faceCalcNormal(tri))
    })
})
