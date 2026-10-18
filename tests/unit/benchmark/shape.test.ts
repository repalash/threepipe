import {describe, expect, it} from 'vitest'
import {BoxGeometry, BufferGeometry, Euler, Matrix4, Quaternion, SphereGeometry, Triangle, Vector3} from 'three'
// @ts-expect-error plain ESM module without types
import {absoluteOrientation, area, distances, icp, jacobiEigen, rng, sample, soup, summarize, TriangleBVH} from '../../../demos/benchmark/metrics/shape.mjs'

const part = (g: BufferGeometry, name = 'p') => {
    const gi = g.index ? g : g
    return {name, position: gi.attributes.position.array as Float32Array, index: Uint32Array.from(gi.index ? gi.index.array : Array.from({length: gi.attributes.position.count}, (_, i) => i))}
}
/** An asymmetric shape (an L of two boxes), so a fit has one right answer. */
const lShape = () => {
    const a = new BoxGeometry(4, 1, 1).translate(1.5, 0, 0), b = new BoxGeometry(1, 3, 1.5).translate(0, 1, 0.25)
    return [part(a, 'a'), part(b, 'b')]
}

describe('benchmark shape metrics', () => {
    it('rng is deterministic per seed', () => {
        const a = rng(5), b = rng(5), c = rng(6)
        const sa = [a(), a(), a()], sb = [b(), b(), b()]
        expect(sa).toEqual(sb)
        expect(c()).not.toBe(sa[0])
    })

    it('samples are on the surface, area-weighted and reproducible', () => {
        // two triangles: area 2 and area 0.5
        const s = {tris: Float64Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]), part: new Int32Array(2), count: 2}
        expect(area(s)).toBeCloseTo(2.5, 12)
        const {points, tri} = sample(s, 20000, 3)
        const again = sample(s, 20000, 3)
        expect(Array.from(points.slice(0, 30))).toEqual(Array.from(again.points.slice(0, 30)))
        let big = 0
        for (let i = 0; i < 20000; i++) {
            const x = points[3 * i], y = points[3 * i + 1]
            expect(points[3 * i + 2]).toBe(0)
            if (tri[i] === 0) { big++; expect(x + y).toBeLessThanOrEqual(2 + 1e-9); expect(x).toBeGreaterThanOrEqual(-1e-12) }
            else expect(x + y).toBeLessThanOrEqual(6 + 1e-9)
        }
        expect(big / 20000).toBeCloseTo(0.8, 1)
    })

    it('BVH closest point equals brute force', () => {
        const s = soup([part(new SphereGeometry(1, 24, 16)), part(new BoxGeometry(0.5, 2, 0.5).translate(1.5, 0, 0))])
        const bvh = new TriangleBVH(s, 4)
        const r = rng(9), tri = new Triangle(), q = new Vector3(), p = new Vector3()
        for (let k = 0; k < 200; k++) {
            p.set(r() * 6 - 3, r() * 6 - 3, r() * 6 - 3)
            let best = Infinity
            for (let t = 0; t < s.count; t++) {
                const o = t * 9
                tri.set(new Vector3(s.tris[o], s.tris[o + 1], s.tris[o + 2]), new Vector3(s.tris[o + 3], s.tris[o + 4], s.tris[o + 5]), new Vector3(s.tris[o + 6], s.tris[o + 7], s.tris[o + 8]))
                tri.closestPointToPoint(p, q)
                best = Math.min(best, q.distanceToSquared(p))
            }
            expect(bvh.closest(p.x, p.y, p.z).d2).toBeCloseTo(best, 10)
        }
    })

    it('Chamfer, Hausdorff and F-score on concentric spheres', () => {
        const a = soup([part(new SphereGeometry(1, 96, 64))]), b = soup([part(new SphereGeometry(1.1, 96, 64))])
        const dAB = distances(sample(a, 4000, 1).points, new TriangleBVH(b)), dBA = distances(sample(b, 4000, 2).points, new TriangleBVH(a))
        const s = summarize(dAB, dBA, [0.05, 0.2])
        expect(s.chamfer).toBeCloseTo(0.1, 2)
        expect(s.hausdorff).toBeLessThan(0.102)
        expect(s.hausdorff).toBeGreaterThan(0.098)
        expect(s.fscore[0.05].f).toBe(0)
        expect(s.fscore[0.2].f).toBe(1)
    })

    it('a model scored against itself is perfect', () => {
        const a = soup(lShape()), bvh = new TriangleBVH(a)
        const d = distances(sample(a, 2000, 4).points, bvh)
        expect(Math.max(...d)).toBeLessThan(1e-9)
    })

    it('jacobiEigen decomposes a symmetric matrix', () => {
        const A = [[4, 1, 2, 0], [1, 3, 0, 1], [2, 0, 5, 1], [0, 1, 1, 2]]
        const {values, vectors} = jacobiEigen(A, 4)
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
            let av = 0
            for (let k = 0; k < 4; k++) av += A[r][k] * vectors[k][c]
            expect(av).toBeCloseTo(values[c] * vectors[r][c], 10)
        }
    })

    it("Horn's method recovers a similarity from exact pairs", () => {
        const M = new Matrix4().compose(new Vector3(3, -1, 2), new Quaternion().setFromEuler(new Euler(0.3, -0.7, 1.1)), new Vector3(1.7, 1.7, 1.7))
        const r = rng(2), n = 50, X = new Float64Array(n * 3), Y = new Float64Array(n * 3), v = new Vector3()
        for (let i = 0; i < n; i++) { v.set(r(), r(), r()); X.set(v.toArray(), 3 * i); Y.set(v.applyMatrix4(M).toArray(), 3 * i) }
        const got = absoluteOrientation(X, Y, 'similarity').toArray(), want = M.toArray()
        for (let i = 0; i < 16; i++) expect(got[i]).toBeCloseTo(want[i], 9)
        // scale-translation keeps the rotation at identity
        const T = new Matrix4().makeScale(2, 2, 2).setPosition(1, 2, 3)
        for (let i = 0; i < n; i++) { v.fromArray(X, 3 * i).applyMatrix4(T); Y.set(v.toArray(), 3 * i) }
        const st = absoluteOrientation(X, Y, 'scale-translation').toArray(), wt = T.toArray()
        for (let i = 0; i < 16; i++) expect(st[i]).toBeCloseTo(wt[i], 9)
    })

    it('trimmed ICP recovers a small misalignment of an asymmetric shape', () => {
        const target = soup(lShape()), bvh = new TriangleBVH(target)
        const truth = new Matrix4().compose(new Vector3(0.12, -0.08, 0.05), new Quaternion().setFromEuler(new Euler(0.03, -0.04, 0.02)), new Vector3(1.03, 1.03, 1.03))
        // the source is the target moved by truth^-1; ICP from identity must find truth
        const src = soup(lShape(), truth.clone().invert().toArray())
        const res = icp(sample(src, 4000, 8).points, bvh, new Matrix4(), {mode: 'similarity', keep: 1, iterations: 200, tolerance: 1e-12})
        const got = res.matrix.toArray(), want = truth.toArray()
        for (let i = 0; i < 16; i++) expect(got[i]).toBeCloseTo(want[i], 3)
        expect(res.rms).toBeLessThan(1e-3)
    })
})
