import {describe, expect, it} from 'vitest'
import {BVHTree, newNearest} from './kdopbvh'
import {closestOnTriToPointV3, closestToLineSegmentV3, interpWeightsTriV3, lenSquaredV3V3} from './math/geom'

/** Deterministic pseudo-random floats in [0, 1). */
function rng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0
        return s / 4294967296
    }
}

describe('BLI_kdopbvh', () => {
    for (const n of [1, 2, 3, 5, 17, 100, 257]) {
        it(`find_nearest over ${n} points matches a brute-force minimum`, () => {
            const r = rng(n)
            const pts: number[][] = []
            const tree = new BVHTree(n, 0, 2, 6)
            for (let i = 0; i < n; i++) {
                const p = [Math.fround(r() * 4 - 2), Math.fround(r() * 4 - 2), Math.fround(r() * 4 - 2)]
                pts.push(p)
                tree.insert(i, p, 1)
            }
            tree.balance()
            for (let q = 0; q < 50; q++) {
                const co = [Math.fround(r() * 5 - 2.5), Math.fround(r() * 5 - 2.5), Math.fround(r() * 5 - 2.5)]
                const nearest = newNearest()
                const index = tree.findNearest(co, nearest)
                const best = Math.min(...pts.map(p => lenSquaredV3V3(co, p)))
                expect(Math.abs(lenSquaredV3V3(co, pts[index]) - best)).toBeLessThan(1e-5)
            }
        })
    }

    it('nearest with a callback over segments', () => {
        const r = rng(7)
        const segs: number[][] = []
        const tree = new BVHTree(40, 0, 2, 6)
        for (let i = 0; i < 40; i++) {
            const s = [r(), r(), r(), r(), r(), r()].map(x => Math.fround(x * 3))
            segs.push(s)
            tree.insert(i, s, 2)
        }
        tree.balance()
        const dist = (co: number[], i: number) => lenSquaredV3V3(closestToLineSegmentV3(co, segs[i].slice(0, 3), segs[i].slice(3)), co)
        for (let q = 0; q < 40; q++) {
            const co = [r() * 3, r() * 3, r() * 3].map(Math.fround)
            const nearest = newNearest()
            tree.findNearest(co, nearest, (index, c, nr) => {
                const d = dist(c as number[], index)
                if (d < nr.distSq) {
                    nr.index = index
                    nr.distSq = d
                }
            })
            const best = Math.min(...segs.map((_, i) => dist(co, i)))
            expect(nearest.distSq).toBe(best)
        }
    })
})

describe('math_geom closest points', () => {
    it('closest_on_tri_to_point_v3 regions', () => {
        const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0]
        expect(closestOnTriToPointV3([-1, -1, 1], a, b, c)).toEqual([0, 0, 0])
        expect(closestOnTriToPointV3([2, -0.5, 0], a, b, c)).toEqual([1, 0, 0])
        expect(closestOnTriToPointV3([0.25, 0.25, 3], a, b, c)).toEqual([0.25, 0.25, 0])
        expect(closestOnTriToPointV3([0.5, -1, 0], a, b, c)).toEqual([0.5, 0, 0])
    })

    it('interp_weights_tri_v3 sums to one inside, thirds for a degenerate triangle', () => {
        const w = interpWeightsTriV3([0, 0, 0], [1, 0, 0], [0, 1, 0], [0.25, 0.25, 0])
        expect(w.map(x => Math.round(x * 1e6) / 1e6)).toEqual([0.5, 0.25, 0.25])
        expect(interpWeightsTriV3([0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, 1])).toEqual([1, 1, 1].map(() => Math.fround(1 / 3)))
    })
})
