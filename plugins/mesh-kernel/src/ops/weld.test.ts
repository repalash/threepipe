import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMVert} from '../bmesh/types'
import {radialLoops} from '../bmesh/structure'
import {faceExists, weldVerts} from './weld'

/** Two quads side by side in the XY plane, sharing nothing. */
function twoQuads(bm: BMesh) {
    const a = [
        bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0),
        bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0),
    ]
    const b = [
        bm.vertCreate(1, 0, 0), bm.vertCreate(2, 0, 0),
        bm.vertCreate(2, 1, 0), bm.vertCreate(1, 1, 0),
    ]
    return {a, b, fa: bm.faceCreate(a), fb: bm.faceCreate(b)}
}

describe('faceExists', () => {
    it('finds a face from its vertex loop, in either winding direction', () => {
        const bm = new BMesh()
        const {a, fa} = twoQuads(bm)
        expect(faceExists(a)).toBe(fa)
        expect(faceExists([...a].reverse())).toBe(fa)
        // Rotating the loop is the same face too.
        expect(faceExists([a[2], a[3], a[0], a[1]])).toBe(fa)
    })

    it('does not find a face that is not there', () => {
        const bm = new BMesh()
        const {a, b} = twoQuads(bm)
        expect(faceExists([a[0], a[1], b[1], b[2]])).toBeNull()
        expect(faceExists([a[0], a[1], a[2]])).toBeNull() // wrong length
        expect(faceExists([a[0], a[1]])).toBeNull()
    })
})

describe('weldVerts', () => {
    it('joins two quads along a seam, reusing the edge that results', () => {
        const bm = new BMesh()
        const {a, b, fa, fb} = twoQuads(bm)
        const map = new Map<BMVert, BMVert>([[b[0], a[1]], [b[3], a[2]]])
        const r = weldVerts(bm, map)

        expect(r.killedVerts.length).toBe(2)
        expect(bm.totvert).toBe(6)
        expect(bm.totface).toBe(2)
        expect(bm.faces.has(fa)).toBe(true)
        expect(bm.faces.has(fb)).toBe(false) // rebuilt on the survivors
        expect(r.newFaces.length).toBe(1)
        expect(r.faceReplace.get(fb)).toBe(r.newFaces[0])
        expect(bm.validate()).toEqual([])

        // The seam edge now has both faces on it.
        const seam = [...bm.edges].find(e =>
            (e.v1 === a[1] && e.v2 === a[2]) || (e.v1 === a[2] && e.v2 === a[1]))!
        expect([...radialLoops(seam)].length).toBe(2)
    })

    it('reuses a coincident face rather than creating a duplicate of it', () => {
        // This is the property that separates a weld from a naive rebuild, and the reason the array
        // and mirror generators cannot use `mergeVerts`.
        const bm = new BMesh()
        const a = [
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0),
            bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0),
        ]
        const b = a.map(v => bm.vertCreate(v.x, v.y, v.z))
        const fa = bm.faceCreate(a)
        const fb = bm.faceCreate(b)

        const map = new Map<BMVert, BMVert>(b.map((v, i) => [v, a[i]]))
        const r = weldVerts(bm, map)

        expect(bm.totvert).toBe(4)
        expect(bm.totface).toBe(1) // not 2
        expect(bm.faces.has(fa)).toBe(true)
        expect(bm.faces.has(fb)).toBe(false)
        expect(r.newFaces).toEqual([])
        expect(r.faceReuse.get(fb)).toBe(fa)
        expect(bm.validate()).toEqual([])
        // Every edge is a boundary again: no doubled face hiding behind the first.
        for (const e of bm.edges) expect([...radialLoops(e)].length).toBe(1)
    })

    it('drops a face that collapses to fewer than three corners', () => {
        const bm = new BMesh()
        const v = [
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0),
        ]
        const f = bm.faceCreate(v)
        weldVerts(bm, new Map([[v[1], v[0]]]))
        expect(bm.faces.has(f)).toBe(false)
        expect(bm.totface).toBe(0)
        expect(bm.totvert).toBe(2)
        expect(bm.validate()).toEqual([])
    })

    it('splits a face whose own corners weld onto each other', () => {
        // `remdoubles_splitface`: welding two corners of the same hexagon that are not neighbours
        // would fold it onto itself, so Blender cuts along the pair first and recurses into halves.
        const bm = new BMesh()
        const v: BMVert[] = []
        for (let i = 0; i < 6; i++) {
            v.push(bm.vertCreate(Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3), 0))
        }
        const hex = bm.faceCreate(v)
        weldVerts(bm, new Map([[v[3], v[0]]]))

        expect(bm.faces.has(hex)).toBe(false)
        expect(bm.totvert).toBe(5)
        // Two triangles, not one self-touching pentagon.
        expect(bm.totface).toBe(2)
        for (const f of bm.faces) expect(f.len).toBe(3)
        expect(bm.validate()).toEqual([])
    })

    it('ignores self-mappings and an empty map', () => {
        const bm = new BMesh()
        const {a} = twoQuads(bm)
        const before = bm.describe()
        expect(weldVerts(bm, new Map()).killedVerts).toEqual([])
        expect(weldVerts(bm, new Map([[a[0], a[0]]])).killedVerts).toEqual([])
        expect(bm.describe()).toBe(before)
    })

    it('averages positions and attributes on request', () => {
        const bm = new BMesh()
        const layer = bm.addLayer('vert', 'weight', 'float')
        const keep = bm.vertCreate(0, 0, 0)
        const gone = bm.vertCreate(2, 0, 0)
        const third = bm.vertCreate(0, 3, 0)
        bm.faceCreate([keep, gone, third])
        keep.fdata = new Float32Array([1])
        gone.fdata = new Float32Array([3])

        weldVerts(bm, new Map([[gone, keep]]), {useCentroid: true})
        expect(keep.x).toBeCloseTo(1, 9)
        expect(keep.fdata![layer.offset]).toBeCloseTo(2, 6)
    })
})
