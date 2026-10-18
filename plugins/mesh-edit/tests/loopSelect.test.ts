/**
 * Alt+click loop and ring select, against `mouse_mesh_loop_*` and the modifier resolution of
 * `edbm_select_loop_or_ring_exec_impl`.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, BMEdge, ElemFlag, primitiveGrid, primitiveUVSphere, SelectMode, selectCountsRecalc, edgeSelectSet, selectHistoryActive, BMVert, selectNone} from '@threepipe/mesh-kernel'
import {loopSelectEdge, walkerSelectCount} from '../src/select/loopSelect'

function grid(mode: number, n = 4) {
    const bm = bmFromMesh(primitiveGrid({xSegments: n, ySegments: n, size: n / 2}))
    bm.selectMode = mode
    // A new primitive comes fully selected, as in Blender; start clean.
    selectNone(bm)
    const verts = [...bm.verts]
    const at = (x: number, y: number): BMVert => {
        const v = verts.find(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6)
        if (!v) throw new Error(`no vertex at ${x}, ${y}`)
        return v
    }
    const edge = (x0: number, y0: number, x1: number, y1: number): BMEdge =>
        [...bm.edges].find(e => e.joins(at(x0, y0), at(x1, y1)))!
    return {bm, at, edge}
}

function counts(bm: BMesh): [number, number, number] {
    selectCountsRecalc(bm)
    return [bm.totvertsel, bm.totedgesel, bm.totfacesel]
}

describe('loop select on a grid', () => {
    it('selects the whole row through an interior horizontal edge', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        // A horizontal edge in the interior row y = 0: the loop is the 4 edges of that row.
        loopSelectEdge(bm, edge(0, 0, 1, 0))
        expect(counts(bm)).toEqual([5, 4, 0])
        expect(selectHistoryActive(bm)).toBe(edge(0, 0, 1, 0))
    })

    it('ring select takes the parallel edges across the column of quads', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        loopSelectEdge(bm, edge(0, 0, 1, 0), {ring: true})
        // The ring through the quads between x = 0 and 1: horizontal edges at y = -2..2.
        expect(counts(bm)).toEqual([10, 5, 0])
        for (let y = -2; y <= 2; y++) expect(edge(0, y, 1, y).hflag & ElemFlag.Select).toBeTruthy()
    })

    it('in face mode selects the face loop', () => {
        const {bm, edge} = grid(SelectMode.Face)
        loopSelectEdge(bm, edge(0, 0, 1, 0))
        // The quads stacked between x = 0 and 1, all four rows.
        expect(counts(bm)[2]).toBe(4)
    })

    it('replaces the selection unless extending, and toggles with Shift', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        loopSelectEdge(bm, edge(0, 0, 1, 0))
        loopSelectEdge(bm, edge(0, 1, 1, 1))
        expect(counts(bm)[1]).toBe(4)
        loopSelectEdge(bm, edge(0, 0, 1, 0), {extend: true})
        expect(counts(bm)[1]).toBe(8)
        // Toggle on a selected loop deselects it.
        loopSelectEdge(bm, edge(0, 0, 1, 0), {toggle: true})
        expect(counts(bm)[1]).toBe(4)
        // Toggle on an unselected loop selects it.
        loopSelectEdge(bm, edge(0, 0, 1, 0), {toggle: true})
        expect(counts(bm)[1]).toBe(8)
        loopSelectEdge(bm, edge(0, 1, 1, 1), {deselect: true})
        expect(counts(bm)[1]).toBe(4)
    })

    it('Alt+click on a boundary edge twice cycles to the whole boundary', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        const boundary = edge(-2, -2, -1, -2)
        // Blender's loop_select default delimiters: outer corners stop a boundary loop.
        const delimit = {delimitOuterCorners: true, delimitNgons: true}
        loopSelectEdge(bm, boundary, {delimit})
        // The bottom row of the boundary first.
        expect(counts(bm)[1]).toBe(4)
        loopSelectEdge(bm, boundary, {delimit})
        // Then the whole 16-edge boundary.
        expect(counts(bm)[1]).toBe(16)
        // And back to the row.
        loopSelectEdge(bm, boundary, {delimit})
        expect(counts(bm)[1]).toBe(4)
    })

    it('makes the vertex nearest the cursor active in vertex mode', () => {
        const {bm, edge, at} = grid(SelectMode.Vertex)
        const e = edge(0, 0, 1, 0)
        loopSelectEdge(bm, e, {cursor: {x: 95, y: 0, project: (x, y) => ({x: x * 100, y, depth: 0})}})
        expect(selectHistoryActive(bm)).toBe(at(1, 0))
        expect(counts(bm)).toEqual([5, 4, 0])
    })
})

describe('walker_select_count and delimiters', () => {
    it('counts selected and unselected elements, bailing out when mixed', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        expect(walkerSelectCount('edgeLoop', edge(0, 0, 1, 0), {})).toEqual([4, 0])
        edgeSelectSet(bm, edge(0, 0, 1, 0), true)
        expect(walkerSelectCount('edgeLoop', edge(0, 0, 1, 0), {})).toEqual([-1, -1])
    })

    it('a seam delimits the loop, and clicking again crosses it', () => {
        const {bm, edge} = grid(SelectMode.Edge)
        // A seam on the vertical edge the loop would cross between x = 0 and 1... the loop runs along
        // horizontal edges; mark the one at x = 1..2 so the walk stops there.
        edge(1, 0, 2, 0).hflag |= ElemFlag.Seam
        loopSelectEdge(bm, edge(-1, 0, 0, 0), {delimit: {delimitSeam: true}})
        const first = counts(bm)[1]
        expect(first).toBeLessThan(4)
        // Up to the delimiter is selected: the next click takes the full loop.
        loopSelectEdge(bm, edge(-1, 0, 0, 0), {delimit: {delimitSeam: true}})
        expect(counts(bm)[1]).toBe(4)
    })
})

describe('loops on a sphere', () => {
    it('a parallel is a closed loop and a meridian stops at the poles', () => {
        const bm = bmFromMesh(primitiveUVSphere({uSegments: 12, vSegments: 6}))
        bm.selectMode = SelectMode.Edge
        // A horizontal edge: both endpoints at the same height, off the poles.
        const parallel = [...bm.edges].find(e => Math.abs(e.v1.z - e.v2.z) < 1e-6 && Math.abs(e.v1.z) < 0.9)!
        loopSelectEdge(bm, parallel)
        expect(counts(bm)[1]).toBe(12)
        const meridian = [...bm.edges].find(e => Math.abs(e.v1.z - e.v2.z) > 1e-6 && Math.abs(e.v1.z) < 0.9 && Math.abs(e.v2.z) < 0.9)!
        loopSelectEdge(bm, meridian)
        // Between the poles: the quad band has 5 interior edges per meridian; the pole fans stop it.
        expect(counts(bm)[1]).toBeGreaterThanOrEqual(4)
        expect(counts(bm)[1]).toBeLessThan(12)
    })
})
