import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {diskEdgeExists, edgeIsWire} from '../bmesh/structure'
import {dissolveFaces, facesJoin, vertIsManifoldInRegion} from './dissolve'

/** An `n` by `n` grid of quads, `n + 1` vertices a side. */
function grid(bm: BMesh, n: number, x0 = 0) {
    const v: BMVert[] = []
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) v.push(bm.vertCreate(x0 + x, 0, z))
    const at = (x: number, z: number) => v[z * (n + 1) + x]
    const faces: BMFace[] = []
    for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) faces.push(bm.faceCreate([at(x, z), at(x + 1, z), at(x + 1, z + 1), at(x, z + 1)]))
    }
    return {v, at, faces}
}

/** A closed fan of `n` triangles round a centre - the shape a circle or cone cap is built as. */
function fan(bm: BMesh, n: number) {
    const centre = bm.vertCreate(0, 0, 0)
    const rim: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        rim.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
    }
    const faces: BMFace[] = []
    for (let i = 0; i < n; i++) faces.push(bm.faceCreate([centre, rim[i], rim[(i + 1) % n]]))
    return {centre, rim, faces}
}

function cube(bm: BMesh) {
    const s = 0.5
    const co: [number, number, number][] = [
        [-s, -s, -s], [-s, -s, s], [-s, s, -s], [-s, s, s], [s, -s, -s], [s, -s, s], [s, s, -s], [s, s, s],
    ]
    const verts = co.map(c => bm.vertCreate(...c))
    const faces = [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]]
        .map(f => bm.faceCreate(f.map(i => verts[i])))
    return {verts, faces}
}

describe('vertIsManifoldInRegion', () => {
    it('separates the interior of a region from its border', () => {
        const bm = new BMesh()
        const {at, faces} = grid(bm, 2)
        const region = new Set(faces)
        expect(vertIsManifoldInRegion(at(1, 1), region)).toBe(true) // the one interior vertex
        expect(vertIsManifoldInRegion(at(0, 0), region)).toBe(false) // a corner
        expect(vertIsManifoldInRegion(at(1, 0), region)).toBe(false) // an edge of the grid
    })

    it('rejects a vertex whose faces are not all in the region', () => {
        const bm = new BMesh()
        const {at, faces} = grid(bm, 2)
        const partial = new Set([faces[0], faces[1], faces[2]])
        expect(vertIsManifoldInRegion(at(1, 1), partial)).toBe(false)
    })
})

describe('facesJoin', () => {
    it('merges a grid into one n-gon and removes what is now interior', () => {
        const bm = new BMesh()
        const {at, faces} = grid(bm, 2)

        const joined = facesJoin(bm, faces, true)!

        expect(joined).not.toBeNull()
        expect(bm.totface).toBe(1)
        expect(joined.len).toBe(8) // the grid's border
        expect(bm.totvert).toBe(8) // the centre went with the interior edges
        expect(bm.totedge).toBe(8)
        expect(bm.verts.has(at(1, 1))).toBe(false)
        expect(bm.validate()).toEqual([])
    })

    it('merges a triangle fan into one n-gon, which is how a cap is built', () => {
        for (const n of [3, 5, 8, 16]) {
            const bm = new BMesh()
            const {centre, rim, faces} = fan(bm, n)

            const joined = facesJoin(bm, faces, true)!

            expect(joined.len).toBe(n)
            expect(bm.verts.has(centre)).toBe(false)
            expect(new Set([...joined.eachLoop()].map(l => l.v))).toEqual(new Set(rim))
            expect(bm.totvert).toBe(n)
            expect(bm.totedge).toBe(n)
            expect(bm.totface).toBe(1)
            expect(bm.validate()).toEqual([])
        }
    })

    it('leaves the interior behind as wire when doDel is off', () => {
        const bm = new BMesh()
        const {centre, faces} = fan(bm, 6)

        facesJoin(bm, faces, false)

        expect(bm.totface).toBe(1)
        expect(bm.verts.has(centre)).toBe(true)
        // The spokes survive with no face on them.
        let wire = 0
        for (const e of bm.edges) if (edgeIsWire(e)) wire++
        expect(wire).toBe(6)
        expect(bm.validate()).toEqual([])
    })

    it('takes each new corner from the corner of the old face at the same vertex', () => {
        const bm = new BMesh()
        const layer = bm.addLayer('loop', 'uv', 'float2')
        const {faces} = fan(bm, 5)
        for (const f of faces) {
            for (const l of f.eachLoop()) {
                l.fdata = new Float32Array(bm.ldata.floatSize)
                l.fdata[layer.offset] = l.v.id
                l.fdata[layer.offset + 1] = 100 + l.v.id
            }
        }

        const joined = facesJoin(bm, faces, true)!

        for (const l of joined.eachLoop()) {
            expect(l.fdata![layer.offset]).toBe(l.v.id)
            expect(l.fdata![layer.offset + 1]).toBe(100 + l.v.id)
        }
    })

    it('returns the face itself for a region of one, and null for none', () => {
        const bm = new BMesh()
        const {faces} = fan(bm, 4)
        expect(facesJoin(bm, [faces[0]], true)).toBe(faces[0])
        expect(facesJoin(bm, [], true)).toBeNull()
        expect(bm.totface).toBe(4)
    })

    it('refuses a closed region, which has no boundary to build a face from', () => {
        const bm = new BMesh()
        const {faces} = cube(bm)
        expect(facesJoin(bm, faces, true)).toBeNull()
        // And it refused before touching anything.
        expect(bm.totface).toBe(6)
        expect(bm.totvert).toBe(8)
        expect(bm.validate()).toEqual([])
    })

    it('refuses a region pinched at a vertex, whose boundary is not one cycle', () => {
        const bm = new BMesh()
        const c = bm.vertCreate(0, 0, 0)
        const a = bm.faceCreate([c, bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0)])
        const b = bm.faceCreate([c, bm.vertCreate(-1, 1, 0), bm.vertCreate(-1, 0, 0)])

        expect(facesJoin(bm, [a, b], true)).toBeNull()
        expect(bm.totface).toBe(2)
        expect(bm.validate()).toEqual([])
    })

    it('refuses an edge with three of the region on it', () => {
        // `rlen > 2`: not a contiguous manifold region, so there is no single n-gon to make.
        const bm = new BMesh()
        const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0)]
        const faces = [0, 1, 2].map(i => bm.faceCreate([v[0], v[1], bm.vertCreate(0.5, i + 1, 0)]))

        expect(facesJoin(bm, faces, true)).toBeNull()
        expect(bm.totface).toBe(3)
        expect(bm.validate()).toEqual([])
    })
})

describe('dissolveFaces', () => {
    it('joins each connected group separately', () => {
        const bm = new BMesh()
        const left = grid(bm, 2, 0)
        const right = grid(bm, 2, 10)

        const out = dissolveFaces(bm, [...left.faces, ...right.faces])

        expect(out.length).toBe(2)
        expect(bm.totface).toBe(2)
        for (const f of out) expect(f.len).toBe(8)
        expect(bm.validate()).toEqual([])
    })

    it('only dissolves the faces it is given', () => {
        const bm = new BMesh()
        const {faces} = grid(bm, 2)
        const out = dissolveFaces(bm, [faces[0], faces[1]])

        expect(out.length).toBe(1)
        expect(out[0].len).toBe(6)
        expect(bm.totface).toBe(3) // the merged pair, plus the two that were left alone
        expect(bm.faces.has(faces[2])).toBe(true)
        expect(bm.faces.has(faces[3])).toBe(true)
        expect(bm.validate()).toEqual([])
    })

    it('drops a group it cannot join rather than failing the rest', () => {
        const bm = new BMesh()
        const good = fan(bm, 5)
        const {faces: closed} = cube(bm)

        const out = dissolveFaces(bm, [...good.faces, ...closed])

        expect(out.length).toBe(1)
        expect(out[0].len).toBe(5)
        expect(bm.faces.has(closed[0])).toBe(true) // the cube is untouched
        expect(bm.validate()).toEqual([])
    })

    it('does nothing with an empty input', () => {
        const bm = new BMesh()
        const {faces} = fan(bm, 4)
        expect(dissolveFaces(bm, [])).toEqual([])
        expect(bm.totface).toBe(faces.length)
    })
})

describe('facesJoin keeps the winding of what it replaced', () => {
    it('winds the n-gon the way the region was wound', () => {
        // `faceCreateNgon` is handed `v1`/`v2` from the first boundary loop it meets, which is what
        // ties the new face's direction to the old ones rather than to the edge set's arbitrary order.
        const bm = new BMesh()
        const {rim, faces} = fan(bm, 6)
        const joined = facesJoin(bm, faces, true)!

        const order = [...joined.eachLoop()].map(l => rim.indexOf(l.v))
        const start = order[0]
        // Ascending round the rim, modulo where it happened to start: the same sense as the fan.
        expect(order).toEqual(order.map((_, i) => (start + i) % 6))
        // And every consecutive pair really is joined by an edge.
        for (const l of joined.eachLoop()) expect(diskEdgeExists(l.v, l.next.v)).toBe(l.e)
    })
})
