import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMVert} from '../bmesh/types'
import {edgeIsManifold, radialLength} from '../bmesh/structure'
import {faceSelectSet} from '../bmesh/marking'
import {SelectMode} from '../constants'
import {signedVolume6, windingProblems} from '../generate/topology.testutil'
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

/** The face's corners in winding order, so a test can say a flip happened rather than guess. */
function cycle(f: BMFace): number[] {
    return [...f.eachLoop()].map(l => l.v.id)
}

/** `cycle` read the other way round, keeping the same starting corner. */
function reversedCycle(ids: number[]): number[] {
    return [ids[0], ...ids.slice(1).reverse()]
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
        // Both quads border the row above, which is outside the region, so `delorig` is true and the
        // originals go. This is the arm of the rule the cube case also takes.
        expect(bm.faces.has(faces[0])).toBe(false)
        expect(bm.faces.has(faces[1])).toBe(false)
        expect(bm.validate()).toEqual([])
    })

    it('keeps the originals when asked, and reverses them', () => {
        const {bm} = cube()
        const face = [...bm.faces][0]
        const before = bm.totface
        const woundBefore = cycle(face)

        extrudeFaceRegion(bm, [face], {keepOriginal: true})

        expect(bm.totface).toBe(before + 5) // cap + 4 sides, original retained
        // `use_keep_orig` leaves `delorig` false, and `bmo_extrude.cc:437` flips every input face
        // whenever `delorig` is false. The kept original is the far side of the new solid, so it has
        // to face the other way; keeping it *and* its winding needs `skipInputFlip` as well.
        expect(cycle(face)).toEqual(reversedCycle(woundBefore))
        expect(bm.validate()).toEqual([])
    })

    it('leaves a kept original alone with skipInputFlip, which is what spin asks for', () => {
        const {bm} = cube()
        const face = [...bm.faces][0]
        const woundBefore = cycle(face)
        extrudeFaceRegion(bm, [face], {keepOriginal: true, skipInputFlip: true})
        expect(cycle(face)).toEqual(woundBefore)
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

    it('extruding every face of a cube keeps both shells, because nothing borders the region', () => {
        // Changed expectation: this used to assert only that the result validated, and it did so
        // with the original cube deleted. Every edge of a closed cube has both of its faces inside
        // the region, so no edge has an outside face user, so `delorig` is false and Blender keeps
        // the input - the shell-in-a-shell you get from selecting everything and pressing E.
        const {bm} = cube()
        const originals = [...bm.faces]
        const wound = originals.map(cycle)

        const res = extrudeFaceRegion(bm, originals)!
        translateVerts(res.verts, 0, 0, 0)

        expect(res.sideFaces.length).toBe(0) // no boundary: the region is the whole closed surface
        expect(res.faces.length).toBe(6)
        // Both cubes are present: 2 x 8 verts, 2 x 12 edges, 2 x 6 faces.
        expect(bm.totvert).toBe(16)
        expect(bm.totedge).toBe(24)
        expect(bm.totface).toBe(12)
        // Two closed shells, so twice the Euler characteristic of one.
        expect(bm.totvert - bm.totedge + bm.totface).toBe(4)
        for (const e of bm.edges) expect(radialLength(e)).toBe(2)
        // Every original survived, reversed.
        for (const [i, f] of originals.entries()) {
            expect(bm.faces.has(f)).toBe(true)
            expect(cycle(f)).toEqual(reversedCycle(wound[i]))
        }
        expect(bm.validate()).toEqual([])
    })

    it('deletes the originals only when the region has a neighbour', () => {
        // The rule itself, both ways round, on the same mesh. `delorig` is set by *any* input edge
        // with a face user outside the region (`bmo_extrude.cc:341`).

        // One quad of a 2x2 grid: two of its edges are shared with the rest of the grid.
        {
            const {bm, faces} = grid(2)
            extrudeFaceRegion(bm, [faces[0]])
            expect(bm.faces.has(faces[0])).toBe(false)
            expect(bm.faces.has(faces[1])).toBe(true) // and nothing outside the region is touched
            expect(bm.validate()).toEqual([])
        }

        // The whole grid: every edge either has one face (the grid's border) or two, both input.
        // No edge sees anything outside, so the originals stay.
        {
            const {bm, faces} = grid(2)
            const res = extrudeFaceRegion(bm, [...faces])!
            translateVerts(res.verts, 0, 1, 0)
            for (const f of faces) expect(bm.faces.has(f)).toBe(true)
            // 4 originals + 4 duplicates + one side quad per border edge.
            expect(res.sideFaces.length).toBe(8)
            expect(bm.totface).toBe(4 + 4 + 8)
            expect(bm.validate()).toEqual([])
        }
    })

    it('extrudes a lone quad into a closed box', () => {
        // The headline case: a Blender Plane, `E`, and the result is a solid. Nothing in the operator
        // special-cases it - the region has no neighbour, so the original is kept and reversed, and
        // the four side quads close it against the cap.
        const {bm, faces} = grid(1)
        const face = faces[0]
        const n = averageFaceNormal([face])!

        const res = extrudeFaceRegion(bm, [face])!
        translateVerts(res.verts, n[0], n[1], n[2])

        expect(bm.totvert).toBe(8)
        expect(bm.totedge).toBe(12)
        expect(bm.totface).toBe(6)
        expect(bm.faces.has(face)).toBe(true)
        // Closed: every edge manifold, and the Euler characteristic of a sphere.
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        expect(bm.totvert - bm.totedge + bm.totface).toBe(2)
        // Consistently wound, and wound *outwards* rather than inside out.
        expect(windingProblems(bm)).toEqual([])
        expect(signedVolume6(bm)).toBeGreaterThan(0)
        expect(bm.validate()).toEqual([])
    })

    it('extrudes a lone triangle fan island into a closed solid too', () => {
        // Not a special case for quads: any island with nothing attached to its border behaves the
        // same way. A triangle pair here, so the cap is two faces and the rim is four edges.
        const bm = new BMesh()
        const v = [
            bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0),
            bm.vertCreate(1, 0, 1), bm.vertCreate(0, 0, 1),
        ]
        const a = bm.faceCreate([v[0], v[1], v[2]])
        const b = bm.faceCreate([v[0], v[2], v[3]])
        const n = averageFaceNormal([a, b])!

        const res = extrudeFaceRegion(bm, [a, b])!
        translateVerts(res.verts, n[0], n[1], n[2])

        expect(bm.faces.has(a)).toBe(true)
        expect(bm.faces.has(b)).toBe(true)
        expect(res.sideFaces.length).toBe(4)
        expect(bm.totface).toBe(2 + 2 + 4)
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
        expect(bm.totvert - bm.totedge + bm.totface).toBe(2)
        expect(windingProblems(bm)).toEqual([])
        expect(signedVolume6(bm)).toBeGreaterThan(0)
        expect(bm.validate()).toEqual([])
    })

    it('deletes the interior of a region, but not an edge something else still uses', () => {
        // `EXT_DEL` is `edge_face_tot > 1 && !found`, not "is not a boundary edge". An edge with two
        // input faces *and* a third, non-input one fails `!found` and survives.
        const {bm, faces, at} = grid(2)
        // A third face hanging off the grid's interior edge, outside the region.
        const extra = bm.faceCreate([at(1, 0), at(1, 1), bm.vertCreate(1, 1, 0.5)])
        const shared = [...faces[0].eachLoop()].find(l => l.e!.joins(at(1, 0), at(1, 1)))!.e!

        extrudeFaceRegion(bm, [faces[0], faces[1]])

        expect(bm.edges.has(shared)).toBe(true)
        expect(bm.faces.has(extra)).toBe(true)
        expect(bm.validate()).toEqual([])
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
