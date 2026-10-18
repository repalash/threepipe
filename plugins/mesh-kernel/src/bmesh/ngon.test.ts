import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMEdge, BMVert} from './types'
import {edgesSortWinding, faceCreateNgon} from './ngon'

/** A closed ring of `n` wire edges, returned in a deliberately shuffled order. */
function ring(bm: BMesh, n: number) {
    const verts: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        verts.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
    }
    const edges: BMEdge[] = []
    for (let i = 0; i < n; i++) edges.push(bm.edgeCreate(verts[i], verts[(i + 1) % n]))
    return {verts, edges}
}

/** Deterministic shuffle, so a failure is reproducible. */
function shuffled<T>(items: T[], seed = 1): T[] {
    const out = [...items]
    let s = seed
    for (let i = out.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        const j = s % (i + 1)
        const t = out[i]
        out[i] = out[j]
        out[j] = t
    }
    return out
}

describe('edgesSortWinding', () => {
    it('recovers the cycle from an unordered edge set', () => {
        for (let n = 3; n <= 8; n++) {
            const bm = new BMesh()
            const {verts, edges} = ring(bm, n)
            const sorted = edgesSortWinding(verts[0], verts[1], shuffled(edges, n))!

            expect(sorted).not.toBeNull()
            expect(sorted.verts.length).toBe(n)
            // The caller's first step is honoured, and the rest follows the ring from there.
            expect(sorted.verts.map(v => verts.indexOf(v))).toEqual([...Array(n).keys()])
            for (let i = 0; i < n; i++) {
                expect(sorted.edges[i].joins(sorted.verts[i], sorted.verts[(i + 1) % n])).toBe(true)
            }
        }
    })

    it('winds the other way when the caller names the other neighbour', () => {
        // The whole reason the entry point takes `v1` and `v2`: the same edge set has two windings.
        const bm = new BMesh()
        const {verts, edges} = ring(bm, 5)
        const forward = edgesSortWinding(verts[0], verts[1], edges)!
        const backward = edgesSortWinding(verts[0], verts[4], edges)!

        expect(forward.verts.map(v => verts.indexOf(v))).toEqual([0, 1, 2, 3, 4])
        expect(backward.verts.map(v => verts.indexOf(v))).toEqual([0, 4, 3, 2, 1])
    })

    it('refuses a set that is not one cycle', () => {
        const bm = new BMesh()
        const {verts, edges} = ring(bm, 6)

        // A gap: drop one edge, so the walk runs out before it gets back.
        expect(edgesSortWinding(verts[0], verts[1], edges.slice(0, 5))).toBeNull()

        // Two separate triangles sharing no vertex - each is a cycle, together they are not one.
        const bm2 = new BMesh()
        const a = ring(bm2, 3)
        const b = ring(bm2, 3)
        expect(edgesSortWinding(a.verts[0], a.verts[1], [...a.edges, ...b.edges])).toBeNull()
    })

    it('refuses when v2 is not a neighbour of v1 in the set', () => {
        const bm = new BMesh()
        const {verts, edges} = ring(bm, 5)
        expect(edgesSortWinding(verts[0], verts[2], edges)).toBeNull()
    })

    it('refuses a figure of eight, where a vertex is reached twice', () => {
        // Two triangles pinched at one shared vertex. Every vertex has an edge, the walk never runs
        // out, and only the "vert appears in the loop twice" test catches it.
        const bm = new BMesh()
        const c = bm.vertCreate(0, 0, 0)
        const a1 = bm.vertCreate(1, 0, 0)
        const a2 = bm.vertCreate(1, 1, 0)
        const b1 = bm.vertCreate(-1, 0, 0)
        const b2 = bm.vertCreate(-1, 1, 0)
        const edges = [
            bm.edgeCreate(c, a1), bm.edgeCreate(a1, a2), bm.edgeCreate(a2, c),
            bm.edgeCreate(c, b1), bm.edgeCreate(b1, b2), bm.edgeCreate(b2, c),
        ]
        expect(edgesSortWinding(c, a1, edges)).toBeNull()
    })
})

describe('faceCreateNgon', () => {
    it('builds a face from an unordered edge set, on the given edges', () => {
        const bm = new BMesh()
        const {verts, edges} = ring(bm, 6)
        const f = faceCreateNgon(bm, verts[0], verts[1], shuffled(edges, 7))!

        expect(f).not.toBeNull()
        expect(f.len).toBe(6)
        expect(bm.totedge).toBe(6) // it used the edges given, it did not make new ones
        expect([...f.eachLoop()].map(l => verts.indexOf(l.v))).toEqual([0, 1, 2, 3, 4, 5])
        expect(bm.validate()).toEqual([])
    })

    it('returns null rather than a broken face when the edges do not form a cycle', () => {
        const bm = new BMesh()
        const {verts, edges} = ring(bm, 5)
        expect(faceCreateNgon(bm, verts[0], verts[1], edges.slice(0, 4))).toBeNull()
        expect(bm.totface).toBe(0)
        expect(bm.validate()).toEqual([])
    })

    it('copies the example face', () => {
        const bm = new BMesh()
        const layer = bm.addLayer('face', 'weight', 'float')
        const {verts, edges} = ring(bm, 4)
        const example = bm.faceCreate([...verts])
        example.matNr = 3
        example.fdata = new Float32Array(bm.pdata.floatSize)
        example.fdata[layer.offset] = 0.25

        const ring2 = ring(bm, 4)
        const f = faceCreateNgon(bm, ring2.verts[0], ring2.verts[1], ring2.edges, example)!

        expect(f.matNr).toBe(3)
        expect(f.fdata![layer.offset]).toBe(0.25)
        expect(edges.length).toBe(4)
    })
})
