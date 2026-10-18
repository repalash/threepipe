/**
 * Hand-checked behaviour of the bridge port that the Blender fixtures (`tests/bmesh-ops-bridge-parity`)
 * cannot show: the operator's error reports (`bmesh.ops` from Python drops them), "nothing changed"
 * on refusal, RNA clamping, hidden geometry, and the helpers.
 */

import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMVert} from '../bmesh/types'
import {diskEdgeExists} from '../bmesh/structure'
import {edgeHideSet, edgeSelectSet, faceSelectSet, selectCountsRecalc} from '../bmesh/marking'
import {ElemFlag, SelectMode} from '../constants'
import {bmoBridgeLoops, bridgeEdgeLoopsSelection, edbmBridgeTagBoundaryEdges, vertFirstLoop} from './bridge'
import {deleteFacesOflagContext, deleteSelection} from './duplicate'

/** A wire ring of `n` vertices at height `z`. */
function ring(bm: BMesh, n: number, r: number, z: number, phase = 0): {verts: BMVert[], edges: BMEdge[]} {
    const verts: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = phase + 2 * Math.PI * i / n
        verts.push(bm.vertCreate(r * Math.cos(a), r * Math.sin(a), z))
    }
    const edges = verts.map((v, i) => bm.edgeCreate(v, verts[(i + 1) % n]))
    return {verts, edges}
}

/** Vertex positions, face corner positions and edge count: enough to tell "unchanged". */
function snapshot(bm: BMesh) {
    return {
        verts: [...bm.verts].map(v => [v.x, v.y, v.z]),
        faces: [...bm.faces].map(f => f.verts().map(v => v.id)),
        edges: bm.totedge,
    }
}

describe('bmoBridgeLoops refusals (BMO_error_raise, bmo_bridge.cc:598-620)', () => {
    it('fewer than two loops: "Select at least two edge loops", nothing changes', () => {
        const bm = new BMesh()
        const a = ring(bm, 6, 1, 0)
        const before = snapshot(bm)
        const r = bmoBridgeLoops(bm, a.edges)
        expect(r).toEqual({ok: false, error: 'Select at least two edge loops', faces: [], edges: []})
        expect(snapshot(bm)).toEqual(before)
    })

    it('a branching vertex is no loop at all', () => {
        const bm = new BMesh()
        const a = ring(bm, 6, 1, 0)
        const spur = bm.edgeCreate(a.verts[0], bm.vertCreate(3, 0, 0))
        const b = ring(bm, 6, 1, 2)
        // the branch at a.verts[0] stops the walk there, which fails the whole of ring a
        const r = bmoBridgeLoops(bm, [...a.edges, spur, ...b.edges])
        expect(r.ok).toBe(false)
        expect(r.error).toBe('Select at least two edge loops')
    })

    it('pairs of an odd count: "Select an even number of loops to bridge pairs"', () => {
        const bm = new BMesh()
        const edges = [0, 1, 2].flatMap(k => ring(bm, 5, 1, k).edges)
        const before = snapshot(bm)
        const r = bmoBridgeLoops(bm, edges, {usePairs: true})
        expect(r.error).toBe('Select an even number of loops to bridge pairs')
        expect(snapshot(bm)).toEqual(before)
    })

    it('merging loops of different lengths: "Selected loops must have equal edge counts"', () => {
        const bm = new BMesh()
        const edges = [...ring(bm, 6, 1, 0).edges, ...ring(bm, 5, 1, 1).edges]
        const before = snapshot(bm)
        const r = bmoBridgeLoops(bm, edges, {useMerge: true, mergeFactor: 0.5})
        expect(r.error).toBe('Selected loops must have equal edge counts')
        expect(snapshot(bm)).toEqual(before)
    })

    it('a merge outputs no faces or edges (only `!use_merge` fills faces.out / edges.out)', () => {
        const bm = new BMesh()
        const edges = [...ring(bm, 6, 1, 0).edges, ...ring(bm, 6, 1, 1).edges]
        const r = bmoBridgeLoops(bm, edges, {useMerge: true, mergeFactor: 0.5})
        expect(r).toEqual({ok: true, faces: [], edges: []})
        expect(bm.totvert).toBe(6)
        expect(bm.validate()).toEqual([])
    })
})

describe('bridgeEdgeLoopsSelection (edbm_bridge_edge_loops_exec)', () => {
    it('does nothing without a selected vertex', () => {
        const bm = new BMesh()
        ring(bm, 6, 1, 0)
        ring(bm, 6, 1, 1)
        const before = snapshot(bm)
        expect(bridgeEdgeLoopsSelection(bm)).toEqual({ok: true, faces: [], edges: [], cutFaces: [], facesDeleted: 0, changed: false})
        expect(snapshot(bm)).toEqual(before)
    })

    it('reports a refusal and leaves an edge selection as it was', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const a = ring(bm, 6, 1, 0)
        ring(bm, 6, 1, 1)
        for (const e of a.edges) edgeSelectSet(bm, e, true)
        const before = snapshot(bm)
        const r = bridgeEdgeLoopsSelection(bm)
        expect(r).toEqual({ok: false, error: 'Select at least two edge loops', changed: false, facesDeleted: 0})
        expect(snapshot(bm)).toEqual(before)
        expect(a.edges.every(e => e.selected)).toBe(true)
    })

    it('ignores hidden edges (BMO_FLAG_RESPECT_HIDE on `edges=%he`)', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const a = ring(bm, 6, 1, 0)
        const b = ring(bm, 6, 1, 1)
        for (const e of [...a.edges, ...b.edges]) edgeSelectSet(bm, e, true)
        // raw flags: a hidden-but-selected edge is what `%he` must skip
        for (const e of b.edges) e.hflag |= ElemFlag.Hidden
        expect(bridgeEdgeLoopsSelection(bm)).toMatchObject({ok: false, error: 'Select at least two edge loops'})
        for (const e of b.edges) e.hflag &= ~ElemFlag.Hidden
        for (const e of b.edges) edgeHideSet(bm, e, false)
        selectCountsRecalc(bm)
        expect(bridgeEdgeLoopsSelection(bm)).toMatchObject({ok: true})
        expect(bm.totface).toBe(6)
    })

    it('selects the new faces only', () => {
        const bm = new BMesh()
        bm.selectMode = SelectMode.Edge
        const a = ring(bm, 6, 1, 0)
        const b = ring(bm, 6, 0.8, 1)
        for (const e of [...a.edges, ...b.edges]) edgeSelectSet(bm, e, true)
        const r = bridgeEdgeLoopsSelection(bm)
        if (!r.ok) throw new Error(r.error)
        expect(r.faces).toHaveLength(6)
        expect(r.edges).toHaveLength(6)
        expect(bm.totfacesel).toBe(6)
        expect([...bm.faces].every(f => f.selected)).toBe(true)
        // edges.out is the six rungs, not the loops' own edges
        expect(r.edges.some(e => a.edges.includes(e) || b.edges.includes(e))).toBe(false)
    })

    it('clamps the RNA properties to their hard ranges', () => {
        const run = (opts: Parameters<typeof bridgeEdgeLoopsSelection>[1]) => {
            const bm = new BMesh()
            bm.selectMode = SelectMode.Edge
            const a = ring(bm, 7, 1, 0)
            const b = ring(bm, 7, 0.9, 1.5, 0.2)
            for (const e of [...a.edges, ...b.edges]) edgeSelectSet(bm, e, true)
            bridgeEdgeLoopsSelection(bm, opts)
            return [...bm.verts].map(v => [v.x, v.y, v.z].map(x => x.toFixed(6)).join()).join(' ')
                + ' | ' + [...bm.faces].map(f => f.verts().map(v => v.id).join()).join(' ')
        }
        // twist_offset is -1000..1000: 5000 behaves as 1000 (and 1000 mod 7 = 6 as -1)
        expect(run({type: 'CLOSED', twistOffset: 5000})).toBe(run({type: 'CLOSED', twistOffset: 1000}))
        expect(run({twistOffset: 1000})).toBe(run({twistOffset: -1}))
        // merge_factor is 0..1
        expect(run({useMerge: true, mergeFactor: 3})).toBe(run({useMerge: true, mergeFactor: 1}))
        expect(run({useMerge: true, mergeFactor: -2})).toBe(run({useMerge: true, mergeFactor: 0}))
        // number_cuts is 0..1000
        expect(run({numberCuts: -4})).toBe(run({numberCuts: 0}))
    })
})

/** A 2x2 grid of quads in the XY plane: vertices `y * 3 + x`, faces row-major. */
function grid2x2(bm: BMesh) {
    const v: BMVert[] = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) v.push(bm.vertCreate(x, y, 0))
    const faces = [
        bm.faceCreate([v[0], v[1], v[4], v[3]]), bm.faceCreate([v[1], v[2], v[5], v[4]]),
        bm.faceCreate([v[3], v[4], v[7], v[6]]), bm.faceCreate([v[4], v[5], v[8], v[7]]),
    ]
    return {v, faces}
}

describe('deleteFacesOflagContext (BMO_mesh_delete_oflag_context, DEL_FACES / DEL_FACES_KEEP_BOUNDARY)', () => {
    it('DEL_FACES takes a corner face with its unshared edges and its corner vertex', () => {
        const bm = new BMesh()
        const {v, faces} = grid2x2(bm)
        deleteFacesOflagContext(bm, [faces[0]], false)
        expect(bm.totface).toBe(3)
        expect(bm.verts.has(v[0])).toBe(false)
        expect(diskEdgeExists(v[0], v[1])).toBeNull()
        expect(diskEdgeExists(v[1], v[4])).not.toBeNull()
        expect(bm.totedge).toBe(10)
        expect(bm.validate()).toEqual([])
    })

    it('KEEP_BOUNDARY keeps the edges that were mesh boundaries before, so the hole stays rimmed', () => {
        const bm = new BMesh()
        const {v, faces} = grid2x2(bm)
        deleteFacesOflagContext(bm, [faces[0]], true)
        expect(bm.totface).toBe(3)
        expect(bm.verts.has(v[0])).toBe(true)
        expect(diskEdgeExists(v[0], v[1])).not.toBeNull()
        expect(diskEdgeExists(v[0], v[3])).not.toBeNull()
        expect(bm.totedge).toBe(12)
        expect(bm.validate()).toEqual([])
    })

    it('KEEP_BOUNDARY still removes interior edges whose faces all went', () => {
        const bm = new BMesh()
        const {v, faces} = grid2x2(bm)
        deleteFacesOflagContext(bm, faces, true)
        expect(bm.totface).toBe(0)
        // the four interior edges and the centre vertex go; the eight rim edges stay
        expect(bm.totedge).toBe(8)
        expect(bm.verts.has(v[4])).toBe(false)
        expect(bm.validate()).toEqual([])
    })

    it("is deleteSelection's 'facesKeepBoundary' context", () => {
        const bm = new BMesh()
        const {faces} = grid2x2(bm)
        faceSelectSet(bm, faces[0], true)
        faceSelectSet(bm, faces[3], true)
        expect(deleteSelection(bm, 'facesKeepBoundary')).toBe(2)
        expect(bm.totface).toBe(2)
        expect(bm.totedge).toBe(12)
    })
})

describe('edbmBridgeTagBoundaryEdges (editmesh_tools.cc:7363)', () => {
    it('tags the selected edges bounding the face selection and the faces inside it', () => {
        const bm = new BMesh()
        const {v, faces} = grid2x2(bm)
        faceSelectSet(bm, faces[0], true)
        faceSelectSet(bm, faces[1], true)
        expect(edbmBridgeTagBoundaryEdges(bm)).toBe(2)
        const tagged = [...bm.edges].filter(e => e.testFlag(ElemFlag.Tag))
        // seven edges are selected; the one between the two faces is not a boundary of the selection
        expect(tagged).toHaveLength(6)
        expect(tagged.includes(diskEdgeExists(v[1], v[4])!)).toBe(false)
        expect(faces.map(f => f.testFlag(ElemFlag.Tag))).toEqual([true, true, false, false])
    })
})

describe('vertFirstLoop (BM_iter_at_index(BM_LOOPS_OF_VERT, v, 0))', () => {
    it('is null for a loose or wire vertex and a loop of the vertex otherwise', () => {
        const bm = new BMesh()
        const loose = bm.vertCreate(9, 9, 9)
        expect(vertFirstLoop(loose)).toBeNull()
        const {verts} = ring(bm, 4, 1, 0)
        expect(vertFirstLoop(verts[0])).toBeNull()
        const {v, faces} = grid2x2(bm)
        const l = vertFirstLoop(v[4])!
        expect(l.v).toBe(v[4])
        expect(faces).toContain(l.f)
        // `bmesh_disk_faceloop_find_first`: the first edge from v->e that has a loop, then its loop at v
        const e = v[4].e!
        expect(l.e === e || l.prev.e === e).toBe(true)
    })
})
