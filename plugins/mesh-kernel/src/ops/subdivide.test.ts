import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMVert} from '../bmesh/types'
import {editMeshSubdivide, subdivideEdges, subdivideTrisOnSphere, vertPairShareFaceByLen} from './subdivide'
import {getComponent, setComponent} from '../bmesh/customdata'

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

// `tri_3edge_subdivide` is private to the operator now that every pattern is ported; these drive it
// the way Blender does, through `subdivide_edges` with `use_grid_fill` on a fully cut triangle.
describe('tri_3edge (subdivideEdges with useGridFill)', () => {
    it('fills a triangle whose edges are cut once into four', () => {
        const bm = new BMesh()
        const {v} = triangle(bm, [0, 0, 0], [1, 0, 0], [0, 1, 0])

        subdivideEdges(bm, [...bm.edges], {cuts: 1, useGridFill: true})

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
            triangle(bm, [0, 0, 0], [1, 0, 0], [0, 1, 0])

            subdivideEdges(bm, [...bm.edges], {cuts: numCuts, useGridFill: true})

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

describe('subdivideEdges vertex creases (#154814)', () => {
    it('resets the crease of the vertices it creates, and keeps the originals', () => {
        // `bmo_subdivide.cc:1301`: new vertices would otherwise inherit (interpolate) the crease of
        // the edge ends, turning a creased corner into a creased line of new vertices.
        const bm = new BMesh()
        const crease = bm.addLayer('vert', 'crease_vert', 'float')
        const {v} = quad(bm)
        for (const x of v) setComponent(x, bm.vdata, crease, 0, 1)

        const res = subdivideEdges(bm, [...bm.edges], {cuts: 2, useGridFill: true})

        expect(res.inner.verts.length).toBeGreaterThan(0)
        for (const x of res.inner.verts) expect(getComponent(x, crease)).toBe(0)
        for (const x of v) expect(getComponent(x, crease)).toBe(1)
    })
})

describe('editMeshSubdivide', () => {
    it('does nothing without a selection, as Blender skips the object', () => {
        const bm = new BMesh()
        quad(bm)
        expect(editMeshSubdivide(bm, {numberCuts: 2})).toBeNull()
        expect(bm.totvert).toBe(4)
    })
})
