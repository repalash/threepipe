import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMVert} from '../bmesh/types'
import {splitEdgeMakeVert} from '../bmesh/euler'
import {subdivideTrisOnSphere, triThreeEdgeSubdivide, vertPairShareFaceByLen} from './subdivide'

function triangle(bm: BMesh, a: [number, number, number], b: [number, number, number], c: [number, number, number]) {
    const v = [bm.vertCreate(...a), bm.vertCreate(...b), bm.vertCreate(...c)]
    return {v, f: bm.faceCreate(v)}
}

function quad(bm: BMesh) {
    const v = [
        bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0),
        bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0),
    ]
    return {v, f: bm.faceCreate(v)}
}

/** The plain, un-projected version of the callback `subdivideTrisOnSphere` passes down. */
function plainSubdivideEdgeNum(bm: BMesh) {
    return (e: BMEdge, curPoint: number, totPoint: number) => {
        const {vNew, eNew} = splitEdgeMakeVert(bm, e, e.v1, 1 / (totPoint + 1 - curPoint))
        return {v: vNew, e: eNew}
    }
}

const len = (v: BMVert) => Math.hypot(v.x, v.y, v.z)

describe('vertPairShareFaceByLen', () => {
    it('finds the face two vertices share, and the loop of each', () => {
        const bm = new BMesh()
        const {v, f} = quad(bm)
        const share = vertPairShareFaceByLen(v[0], v[2], false)!

        expect(share.f).toBe(f)
        expect(share.lA.v).toBe(v[0])
        expect(share.lB.v).toBe(v[2])
    })

    it('honours allowAdjacent', () => {
        const bm = new BMesh()
        const {v, f} = quad(bm)
        // Neighbours round the quad: excluded unless adjacency is allowed.
        expect(vertPairShareFaceByLen(v[0], v[1], false)).toBeNull()
        expect(vertPairShareFaceByLen(v[0], v[1], true)!.f).toBe(f)
    })

    it('picks the smallest of several shared faces', () => {
        // This is the "by_len" in the name, and what keeps a grid fill cutting the cell it just made
        // instead of the whole triangle again.
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0)
        const b = bm.vertCreate(1, 0, 0)
        const big = bm.faceCreate([a, bm.vertCreate(0, -1, 0), bm.vertCreate(1, -1, 0), b, bm.vertCreate(0.5, -2, 0)])
        const small = bm.faceCreate([a, b, bm.vertCreate(0.5, 1, 0)])

        expect(big.len).toBe(5)
        expect(small.len).toBe(3)
        expect(vertPairShareFaceByLen(a, b, true)!.f).toBe(small)
    })

    it('returns null when there is no shared face', () => {
        const bm = new BMesh()
        const {v} = quad(bm)
        const lone = bm.vertCreate(5, 5, 5)
        expect(vertPairShareFaceByLen(v[0], lone, true)).toBeNull()
    })
})

describe('triThreeEdgeSubdivide', () => {
    it('fills a triangle whose edges are cut once into four', () => {
        const bm = new BMesh()
        const {v, f} = triangle(bm, [0, 0, 0], [1, 0, 0], [0, 1, 0])
        const cut = plainSubdivideEdgeNum(bm)
        const start = f.lFirst.v
        for (const e of [...bm.edges]) cut(e, 0, 1)

        triThreeEdgeSubdivide(bm, {face: f, start}, 1, cut)

        expect(bm.totface).toBe(4)
        expect(bm.totvert).toBe(6)
        expect(bm.totedge).toBe(9)
        for (const face of bm.faces) expect(face.len).toBe(3)
        // Still one disc.
        expect(bm.totvert - bm.totedge + bm.totface).toBe(1)
        // The three original corners each ended up in exactly one of the four triangles.
        for (const corner of v) {
            let n = 0
            for (const face of bm.faces) if (face.verts().includes(corner)) n++
            expect(n).toBe(1)
        }
        expect(bm.validate()).toEqual([])
    })

    it('fills deeper cuts into (numCuts + 1) squared triangles', () => {
        for (const numCuts of [1, 2, 3, 7]) {
            const bm = new BMesh()
            const {f} = triangle(bm, [0, 0, 0], [1, 0, 0], [0, 1, 0])
            const cut = plainSubdivideEdgeNum(bm)
            const start = f.lFirst.v
            for (const e of [...bm.edges]) {
                for (let i = 0; i < numCuts; i++) cut(e, i, numCuts)
            }

            triThreeEdgeSubdivide(bm, {face: f, start}, numCuts, cut)

            expect(bm.totface).toBe((numCuts + 1) ** 2)
            expect(bm.totvert).toBe((numCuts + 2) * (numCuts + 3) / 2)
            expect(bm.totvert - bm.totedge + bm.totface).toBe(1)
            for (const face of bm.faces) expect(face.len).toBe(3)
            expect(bm.validate()).toEqual([])
        }
    })
})

describe('subdivideTrisOnSphere', () => {
    it('subdivides every marked triangle and projects the result onto the sphere', () => {
        for (const numCuts of [1, 3, 7]) {
            const bm = new BMesh()
            triangle(bm, [1, 0, 0], [0, 1, 0], [0, 0, 1])

            subdivideTrisOnSphere(bm, [...bm.edges], numCuts, 1)

            expect(bm.totface).toBe((numCuts + 1) ** 2)
            for (const v of bm.verts) expect(len(v)).toBeCloseTo(1, 12)
            expect(bm.validate()).toEqual([])
        }
    })

    it('uses the radius it is given', () => {
        const bm = new BMesh()
        triangle(bm, [1, 0, 0], [0, 1, 0], [0, 0, 1])
        subdivideTrisOnSphere(bm, [...bm.edges], 1, 4)
        for (const v of bm.verts) expect(len(v)).toBeCloseTo(4, 12)
    })

    it('cuts the original edge, not the sphere it is being projected onto', () => {
        // The reason for the staging layer: a cut point is a fraction of the *flat* edge, projected
        // afterwards. Project as you go and the second cut would divide an already-bent edge.
        const bm = new BMesh()
        triangle(bm, [1, 0, 0], [0, 1, 0], [0, 0, 1])

        subdivideTrisOnSphere(bm, [...bm.edges], 2, 1)

        const norm = (p: [number, number, number]) => {
            const l = Math.hypot(...p)
            return p.map(c => c / l)
        }
        const wanted = [norm([2 / 3, 1 / 3, 0]), norm([1 / 3, 2 / 3, 0])]
        for (const w of wanted) {
            const found = [...bm.verts].some(v =>
                Math.abs(v.x - w[0]) < 1e-9 && Math.abs(v.y - w[1]) < 1e-9 && Math.abs(v.z - w[2]) < 1e-9)
            expect(found).toBe(true)
        }
    })

    it('leaves faces whose edges are not all marked alone', () => {
        // The pattern match: only a triangle with all three edges cut is `tri_3edge`.
        const bm = new BMesh()
        const a = triangle(bm, [1, 0, 0], [0, 1, 0], [0, 0, 1])
        const b = triangle(bm, [-1, 0, 0], [0, -1, 0], [0, 0, -1])
        const marked = [...a.f.eachLoop()].map(l => l.e!)

        subdivideTrisOnSphere(bm, marked, 1, 1)

        expect(bm.faces.has(b.f)).toBe(true)
        expect(b.f.len).toBe(3)
        // Untouched, so not projected either.
        for (const v of b.v) expect(len(v)).toBeCloseTo(1, 12)
        expect(bm.totface).toBe(4 + 1)
        expect(bm.validate()).toEqual([])
    })

    it('does nothing with no edges', () => {
        const bm = new BMesh()
        const {f} = triangle(bm, [1, 0, 0], [0, 1, 0], [0, 0, 1])
        subdivideTrisOnSphere(bm, [], 2, 1)
        expect(bm.totface).toBe(1)
        expect(f.len).toBe(3)
    })
})
