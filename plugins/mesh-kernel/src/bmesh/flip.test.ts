import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMFace, BMVert} from './types'
import {radialLoops} from './structure'
import {faceNormalFlip, loopReverse} from './flip'

/** The face's corners in winding order. */
function cycle(f: BMFace): number[] {
    return [...f.eachLoop()].map(l => l.v.id)
}

/** The same cycle read backwards from the same starting corner. */
function reversed(ids: number[]): number[] {
    return [ids[0], ...ids.slice(1).reverse()]
}

function ngon(bm: BMesh, n: number): BMFace {
    const verts: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        verts.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
    }
    return bm.faceCreate(verts)
}

function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: [number, number, number][] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s], [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = co.map(c => bm.vertCreate(...c))
    const faces = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
        .map(f => bm.faceCreate(f.map(i => verts[i])))
    return {bm, verts, faces}
}

/** Every pair of faces sharing an edge must traverse it in opposite directions. */
function windingProblems(bm: BMesh): number {
    let n = 0
    for (const e of bm.edges) {
        const loops = [...radialLoops(e)]
        if (loops.length === 2 && loops[0].v === loops[1].v) n++
    }
    return n
}

describe('loopReverse', () => {
    it('reverses an isolated face of any size, keeping the first corner', () => {
        // Every loop is a boundary loop here, so this is the `is_prev_boundary` arm throughout.
        for (let n = 3; n <= 8; n++) {
            const bm = new BMesh()
            const f = ngon(bm, n)
            const before = cycle(f)

            loopReverse(f)

            expect(cycle(f)).toEqual(reversed(before))
            expect(f.len).toBe(n)
            expect(bm.totedge).toBe(n) // nothing created or destroyed
            expect(bm.validate()).toEqual([])
        }
    })

    it('is its own inverse', () => {
        for (let n = 3; n <= 8; n++) {
            const bm = new BMesh()
            const f = ngon(bm, n)
            const before = cycle(f)
            loopReverse(f)
            loopReverse(f)
            expect(cycle(f)).toEqual(before)
            expect(bm.validate()).toEqual([])
        }
    })

    it('keeps each loop on the edge that joins it to its new successor', () => {
        // `validate()` checks exactly this - `l.e.joins(l.v, l.next.v)` - which is the invariant the
        // "shift every loop onto the previous loop's edge" step exists to maintain.
        const {bm, faces} = cube()
        loopReverse(faces[0])
        for (const l of faces[0].eachLoop()) {
            expect(l.e!.joins(l.v, l.next.v)).toBe(true)
        }
        expect(bm.validate()).toEqual([])
    })

    it('repoints an edge that named the loop it is taking away', () => {
        // `if (e_iter->l == l_iter) e_iter->l = l_iter->next`. Force the case by pointing every edge
        // of the face at that face's own loop first.
        const {bm, faces} = cube()
        const f = faces[0]
        for (const l of f.eachLoop()) l.e!.l = l

        loopReverse(f)

        for (const e of bm.edges) {
            expect(e.l).not.toBeNull()
            expect(bm.loops.has(e.l!)).toBe(true)
            // The edge's loop must still be one of the loops actually using it.
            expect([...radialLoops(e)]).toContain(e.l)
        }
        expect(bm.validate()).toEqual([])
    })

    it('rewires the radial cycles of a face with neighbours, in every position', () => {
        // The interesting arm: each loop leaves a two-loop radial cycle and joins the previous edge's.
        // Do it for each face of a cube in turn, from a fresh cube each time.
        for (let i = 0; i < 6; i++) {
            const {bm, faces} = cube()
            const before = cycle(faces[i])

            loopReverse(faces[i])

            expect(cycle(faces[i])).toEqual(reversed(before))
            // Still closed: every edge has exactly two loops, and they are each other's neighbours.
            for (const e of bm.edges) {
                const loops = [...radialLoops(e)]
                expect(loops.length).toBe(2)
                expect(loops[0].radialNext).toBe(loops[1])
                expect(loops[1].radialNext).toBe(loops[0])
            }
            // A cube is consistently wound; reversing one face breaks it on that face's four edges.
            expect(windingProblems(bm)).toBe(4)
            expect(bm.validate()).toEqual([])
        }
    })

    it('restores the winding of a cube when every face is reversed', () => {
        const {bm, faces} = cube()
        for (const f of faces) loopReverse(f)
        expect(windingProblems(bm)).toBe(0)
        expect(bm.validate()).toEqual([])
    })

    it('keeps per-corner attributes on the corner they belong to', () => {
        // Loops keep their vertex, so corner data must not move. This is why the kernel reverses in
        // place rather than rebuilding the face from a vertex list.
        const bm = new BMesh()
        const layer = bm.addLayer('loop', 'uv', 'float2')
        const f = ngon(bm, 5)
        for (const l of f.eachLoop()) {
            l.fdata = new Float32Array(bm.ldata.floatSize)
            l.fdata[layer.offset] = l.v.id
            l.fdata[layer.offset + 1] = -l.v.id
        }

        loopReverse(f)

        for (const l of f.eachLoop()) {
            expect(l.fdata![layer.offset]).toBe(l.v.id)
            expect(l.fdata![layer.offset + 1]).toBe(-l.v.id)
        }
    })
})

describe('faceNormalFlip', () => {
    it('reverses the winding and negates the cached normal', () => {
        const bm = new BMesh()
        const f = ngon(bm, 4)
        f.nx = 0
        f.ny = 0
        f.nz = 1
        const before = cycle(f)

        faceNormalFlip(f)

        expect(cycle(f)).toEqual(reversed(before))
        expect([f.nx, f.ny, f.nz]).toEqual([-0, -0, -1])
        expect(bm.validate()).toEqual([])
    })
})
