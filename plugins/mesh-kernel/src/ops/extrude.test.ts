import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMVert} from '../bmesh/types'
import {edgeIsManifold, radialLength, radialLoops} from '../bmesh/structure'
import {faceSelectSet, selectAll} from '../bmesh/marking'
import {SelectMode} from '../constants'
import {averageFaceNormal, extrudeEdgeOnly, extrudeFaceRegion, extrudeSelection, translateVerts} from './extrude'

function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: [number, number, number][] = [
        [-s,-s,-s],[-s,-s,s],[-s,s,-s],[-s,s,s],[s,-s,-s],[s,-s,s],[s,s,-s],[s,s,s],
    ]
    const verts = co.map(c => bm.vertCreate(...c))
    for (const f of [[0,1,3,2],[2,3,7,6],[6,7,5,4],[4,5,1,0],[2,6,4,0],[7,3,1,5]]) {
        bm.faceCreate(f.map(i => verts[i]))
    }
    return {bm, verts}
}

function grid(n = 2) {
    const bm = new BMesh()
    const v: BMVert[] = []
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) v.push(bm.vertCreate(x, 0, z))
    const at = (x: number, z: number) => v[z * (n + 1) + x]
    const faces = []
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        faces.push(bm.faceCreate([at(x,z), at(x+1,z), at(x+1,z+1), at(x,z+1)]))
    }
    return {bm, v, faces, at}
}

describe('extrudeFaceRegion', () => {
    it('extrudes one cube face into a closed box, leaving the mesh valid', () => {
        const {bm} = cube()
        const face = [...bm.faces][0]
        const before = {v: bm.totvert, e: bm.totedge, f: bm.totface}

        const res = extrudeFaceRegion(bm, [face])!
        translateVerts(res.verts, 0, 0, 0.5)

        // 4 new verts, 4 side faces, the cap replaces the original.
        expect(bm.totvert).toBe(before.v + 4)
        expect(bm.totface).toBe(before.f + 4)
        expect(res.faces.length).toBe(1)
        expect(res.sideFaces.length).toBe(4)
        expect(bm.validate()).toEqual([])
        // Still closed: every edge has exactly two faces.
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        // Euler holds for the closed result.
        expect(bm.totvert - bm.totedge + bm.totface).toBe(2)
    })

    it('gives side faces outward winding, so the result is not inside out', () => {
        const {bm} = cube()
        // The +X face of the cube.
        const face = [...bm.faces].find(f => [...f.eachLoop()].every(l => l.v.x > 0))!
        const res = extrudeFaceRegion(bm, [face])!
        translateVerts(res.verts, 0.5, 0, 0)

        // Each side face's normal must point away from the cube's centre, not into it.
        for (const side of res.sideFaces) {
            const n = averageFaceNormal([side])!
            let cx = 0, cy = 0, cz = 0, count = 0
            for (const l of side.eachLoop()) { cx += l.v.x; cy += l.v.y; cz += l.v.z; count++ }
            cx /= count; cy /= count; cz /= count
            // Outward from the mesh centre (origin) for a side face of an extruded box.
            expect(n[0] * cx + n[1] * cy + n[2] * cz).toBeGreaterThan(0)
        }
    })

    it('extrudes a multi-face region as one piece, with no interior walls', () => {
        const {bm, faces} = grid(2)
        const region = [faces[0], faces[1]] // two adjacent quads
        const res = extrudeFaceRegion(bm, region)!
        translateVerts(res.verts, 0, 1, 0)

        expect(res.faces.length).toBe(2)
        // The shared edge is interior, so it gets no side wall: 6 boundary edges, not 8.
        expect(res.sideFaces.length).toBe(6)
        expect(bm.validate()).toEqual([])
    })

    it('keeps the originals when asked', () => {
        const {bm} = cube()
        const face = [...bm.faces][0]
        const before = bm.totface
        extrudeFaceRegion(bm, [face], {keepOriginal: true})
        expect(bm.totface).toBe(before + 5) // cap + 4 sides, original retained
        expect(bm.validate()).toEqual([])
    })

    it('selects the result so the following move acts on it', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        const face = [...bm.faces][0]
        const res = extrudeFaceRegion(bm, [face])!
        expect(bm.totfacesel).toBe(1)
        expect([...bm.faces].filter(f => f.hflag & 1)[0]).toBe(res.faces[0])
    })

    it('returns null for an empty region', () => {
        const {bm} = cube()
        expect(extrudeFaceRegion(bm, [])).toBeNull()
    })

    it('extruding every face of a cube keeps it valid', () => {
        const {bm} = cube()
        const res = extrudeFaceRegion(bm, [...bm.faces])!
        translateVerts(res.verts, 0, 0, 0)
        expect(bm.validate()).toEqual([])
        expect(res.sideFaces.length).toBe(0) // no boundary: the region is the whole closed surface
    })
})

describe('extrudeEdgeOnly', () => {
    it('makes a ribbon from a boundary edge', () => {
        const {bm} = grid(1)
        const edge = [...bm.edges][0]
        const res = extrudeEdgeOnly(bm, [edge])!
        translateVerts(res.verts, 0, 1, 0)
        expect(res.sideFaces.length).toBe(1)
        expect(bm.totface).toBe(2)
        expect(bm.validate()).toEqual([])
    })
})

describe('extrudeSelection', () => {
    it('prefers faces when any are selected', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        faceSelectSet(bm, [...bm.faces][0], true)
        const res = extrudeSelection(bm)!
        expect(res.faces.length).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('falls back to edges when only edges are selected', () => {
        const {bm} = grid(1)
        bm.selectMode = 2
        const edge = [...bm.edges][0]
        edge.hflag |= 1
        const res = extrudeSelection(bm)!
        expect(res.faces.length).toBe(0)
        expect(res.sideFaces.length).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('returns null with nothing selected', () => {
        const {bm} = cube()
        expect(extrudeSelection(bm)).toBeNull()
    })
})

describe('repeated extrude', () => {
    it('builds a tower of five segments that stays closed and valid', () => {
        const {bm} = cube()
        let face = [...bm.faces].find(f => [...f.eachLoop()].every(l => l.y > 0))
            ?? [...bm.faces][0]
        for (let i = 0; i < 5; i++) {
            const res = extrudeFaceRegion(bm, [face])!
            translateVerts(res.verts, 0, 0.4, 0)
            face = res.faces[0]
            expect(bm.validate()).toEqual([])
        }
        for (const e of bm.edges) expect(radialLength(e)).toBe(2)
        expect(bm.totvert - bm.totedge + bm.totface).toBe(2)
        expect(bm.totface).toBe(6 + 5 * 4)
    })
})

describe('chained extrudeEdgeOnly', () => {
    /** Every pair of faces sharing an edge must traverse it in opposite directions. */
    function windingProblems(bm: BMesh): string[] {
        const problems: string[] = []
        for (const e of bm.edges) {
            const loops = [...radialLoops(e)]
            if (loops.length === 2 && loops[0].v === loops[1].v) {
                problems.push(`edge ${e.id} runs the same way in faces ${loops[0].f.id} and ${loops[1].f.id}`)
            }
        }
        return problems
    }

    function wireChain(bm: BMesh, n: number) {
        const verts: BMVert[] = []
        for (let i = 0; i <= n; i++) verts.push(bm.vertCreate(0, i, 0))
        const edges = []
        for (let i = 0; i < n; i++) edges.push(bm.edgeCreate(verts[i], verts[i + 1]))
        return {verts, edges}
    }

    it('keeps the winding consistent across repeats with useNormalFromAdjacent', () => {
        // The rim edge comes back from `faceCreate` in whichever direction the quad walked it, so a
        // second extrusion that only reads `e.v1`/`e.v2` winds the opposite way. Blender's
        // `bmo_extrude_edge_only_exec` decides from the face already on the edge instead.
        const bm = new BMesh()
        let edges = wireChain(bm, 3).edges
        for (let step = 0; step < 4; step++) {
            const res = extrudeEdgeOnly(bm, edges, {useNormalFromAdjacent: true, selectResult: false})!
            translateVerts(res.verts, 0.5, 0, 0)
            edges = edges.map(e => res.edgeMap.get(e)!)
            expect(edges.every(Boolean)).toBe(true)
        }
        expect(bm.totface).toBe(3 * 4)
        expect(bm.validate()).toEqual([])
        expect(windingProblems(bm)).toEqual([])
    })

    it('reports the new rim through edgeMap, oriented like the edge it came from', () => {
        const bm = new BMesh()
        const {edges} = wireChain(bm, 2)
        const res = extrudeEdgeOnly(bm, edges, {selectResult: false})!
        expect(res.edgeMap.size).toBe(2)
        for (const e of edges) {
            const rim = res.edgeMap.get(e)!
            expect(rim.joins(res.vertMap.get(e.v1)!, res.vertMap.get(e.v2)!)).toBe(true)
        }
    })
})
