import {describe, expect, it} from 'vitest'
import {bmFromMesh} from '../bmesh/convert'
import {primitiveCube, primitiveGrid} from '../generate/primitives'
import {dissolveEdges, dissolveVerts, vertIsEdgePair} from './dissolveEdges'
import {BMEdge, BMVert} from '../bmesh/types'

function edgeBetween(bm: ReturnType<typeof bmFromMesh>, a: (v: BMVert) => boolean, b: (v: BMVert) => boolean): BMEdge {
    for (const e of bm.edges) {
        if (a(e.v1) && b(e.v2) || a(e.v2) && b(e.v1)) return e
    }
    throw new Error('no such edge')
}

const interiorEdges = (bm: ReturnType<typeof bmFromMesh>) => [...bm.edges].filter(e => e.l && e.l.radialNext !== e.l)

describe('dissolveEdges', () => {
    it('dissolving one cube edge merges its two faces and, with use_verts, its end vertices too', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        // The edge along +X +Y: shared by the +X and +Y faces.
        const e = edgeBetween(bm, v => v.x > 0 && v.y > 0 && v.z > 0, v => v.x > 0 && v.y > 0 && v.z < 0)
        expect(dissolveEdges(bm, [e])).toBe(1)
        expect(bm.validate()).toEqual([])
        expect(bm.totface).toBe(5)
        // What Blender gives for Ctrl+X on one edge of the default cube: the two side quads become
        // one face, and each end vertex - a corner left on two edges once the dissolved edge is gone
        // (`VERT_MARK`, then `BM_vert_is_edge_pair`) - is collapsed out, turning the top and bottom
        // quads into triangles and the merged hexagon into a quad.
        expect(bm.totvert).toBe(6)
        expect(bm.totedge).toBe(9)
        expect([...bm.faces].map(f => f.len).sort()).toEqual([3, 3, 4, 4, 4])
    })

    it('keeps the end vertices when use_verts is off', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        const e = edgeBetween(bm, v => v.x > 0 && v.y > 0 && v.z > 0, v => v.x > 0 && v.y > 0 && v.z < 0)
        expect(dissolveEdges(bm, [e], {useVerts: false})).toBe(1)
        expect(bm.validate()).toEqual([])
        expect(bm.totvert).toBe(8)
        expect(bm.totedge).toBe(11)
        expect([...bm.faces].map(f => f.len).sort()).toEqual([4, 4, 4, 4, 6])
    })

    it('dissolving a grid\'s loop cuts removes them and the two-edge vertices they leave on the border (use_verts)', () => {
        // Three quads in a row: two interior edges, like two loop cuts across a strip.
        const bm = bmFromMesh(primitiveGrid({xSegments: 3, ySegments: 1}))
        expect(bm.totface).toBe(3)
        expect(bm.totedge).toBe(10)
        const interior = interiorEdges(bm)
        expect(interior).toHaveLength(2)
        expect(dissolveEdges(bm, interior)).toBe(2)
        expect(bm.validate()).toEqual([])
        // One quad remains: the four border vertices the cuts left with two edges each dissolved too.
        expect(bm.totface).toBe(1)
        expect(bm.totvert).toBe(4)
        expect(bm.totedge).toBe(4)
    })

    it('keeps the border vertices with use_verts off', () => {
        const bm = bmFromMesh(primitiveGrid({xSegments: 2, ySegments: 1}))
        expect(dissolveEdges(bm, interiorEdges(bm), {useVerts: false})).toBe(1)
        expect(bm.validate()).toEqual([])
        expect(bm.totface).toBe(1)
        expect(bm.totvert).toBe(6)
        expect([...bm.faces][0].len).toBe(6)
    })

    it('leaves boundary edges alone', () => {
        const bm = bmFromMesh(primitiveGrid({xSegments: 2, ySegments: 1}))
        const boundary = [...bm.edges].find(e => e.l && e.l.radialNext === e.l)!
        expect(dissolveEdges(bm, [boundary])).toBe(0)
        expect(bm.totface).toBe(2)
        expect(bm.validate()).toEqual([])
    })
})

describe('dissolveVerts', () => {
    it('dissolving a cube corner merges its three faces', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        const corner = [...bm.verts].find(v => v.x > 0 && v.y > 0 && v.z > 0)!
        expect(dissolveVerts(bm, [corner])).toBe(1)
        expect(bm.validate()).toEqual([])
        expect(bm.totvert).toBe(7)
        expect(bm.totface).toBe(4)
        expect([...bm.faces].map(f => f.len).sort()).toEqual([4, 4, 4, 6])
    })

    it('a border vertex on three edges merges its two faces and then collapses out of the rim', () => {
        const bm = bmFromMesh(primitiveGrid({xSegments: 2, ySegments: 1}))
        const middle = [...bm.verts].filter(v => !vertIsEdgePair(v))
        expect(middle).toHaveLength(2)
        expect(dissolveVerts(bm, [middle[0]])).toBe(1)
        expect(bm.validate()).toEqual([])
        expect(bm.totface).toBe(1)
        expect(bm.totvert).toBe(5)
        expect([...bm.faces][0].len).toBe(5)
    })
})
