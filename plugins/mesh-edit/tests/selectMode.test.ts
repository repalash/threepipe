/**
 * Select-mode switching with Shift (combine) and Ctrl (expand), against `EDBM_selectmode_convert` and
 * `EDBM_selectmode_toggle_multi`.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, ElemFlag, faceSelectSet, primitiveGrid, SelectMode, selectCountsRecalc, vertSelectSet, edgeSelectSet, BMVert, selectNone, selectModeFlush} from '@threepipe/mesh-kernel'
import {selectModeConvert, selectModeToggleMulti} from '../src/select/selectMode'

function grid(mode: number) {
    const bm = bmFromMesh(primitiveGrid({xSegments: 4, ySegments: 4, size: 2}))
    bm.selectMode = mode
    // A new primitive comes fully selected, as in Blender; start clean.
    selectNone(bm)
    const verts = [...bm.verts]
    const at = (x: number, y: number): BMVert => {
        const v = verts.find(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6)
        if (!v) throw new Error(`no vertex at ${x}, ${y}`)
        return v
    }
    return {bm, at, faces: [...bm.faces]}
}

function counts(bm: BMesh): [number, number, number] {
    selectCountsRecalc(bm)
    return [bm.totvertsel, bm.totedgesel, bm.totfacesel]
}

describe('EDBM_selectmode_convert', () => {
    it('vertex to edge with expand takes every edge touching a selected vertex', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true) // the central vertex of the 4x4 grid, valence 4
        selectModeConvert(bm, SelectMode.Vertex, SelectMode.Edge)
        expect(counts(bm)).toEqual([5, 4, 0])
    })

    it('vertex to face with expand takes every face touching a selected vertex', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        selectModeConvert(bm, SelectMode.Vertex, SelectMode.Face)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('edge to face with expand takes every face touching a selected edge', () => {
        const {bm, at} = grid(SelectMode.Edge)
        const e = [...bm.edges].find(e => e.joins(at(0, 0), at(1, 0)))!
        edgeSelectSet(bm, e, true)
        selectModeConvert(bm, SelectMode.Edge, SelectMode.Face)
        expect(counts(bm)[2]).toBe(2)
    })

    it('edge to vertex keeps only vertices whose edges are all selected', () => {
        const {bm, at} = grid(SelectMode.Edge)
        // Every edge around the central vertex: it survives, its neighbours (valence 4, one edge
        // selected) do not.
        for (const e of [...bm.edges]) if (e.uses(at(0, 0))) edgeSelectSet(bm, e, true)
        expect(counts(bm)[0]).toBe(5)
        selectModeConvert(bm, SelectMode.Edge, SelectMode.Vertex)
        expect(counts(bm)).toEqual([1, 0, 0])
        expect(at(0, 0).hflag & ElemFlag.Select).toBeTruthy()
    })

    it('face to edge keeps only edges whose faces are all selected', () => {
        const {bm, at, faces} = grid(SelectMode.Face)
        // The four faces around the centre: the four spokes are interior to the selection.
        for (const f of faces) if (f.verts().includes(at(0, 0))) faceSelectSet(bm, f, true)
        expect(counts(bm)[2]).toBe(4)
        selectModeConvert(bm, SelectMode.Face, SelectMode.Edge)
        expect(counts(bm)).toEqual([5, 4, 0])
    })

    it('face to vertex keeps only vertices whose faces are all selected', () => {
        const {bm, at, faces} = grid(SelectMode.Face)
        for (const f of faces) if (f.verts().includes(at(0, 0))) faceSelectSet(bm, f, true)
        selectModeConvert(bm, SelectMode.Face, SelectMode.Vertex)
        expect(counts(bm)).toEqual([1, 0, 0])
    })

    it('does nothing with an empty selection', () => {
        const {bm} = grid(SelectMode.Vertex)
        selectModeConvert(bm, SelectMode.Vertex, SelectMode.Face)
        expect(counts(bm)).toEqual([0, 0, 0])
    })
})

describe('EDBM_selectmode_toggle_multi (the 1 / 2 / 3 keys)', () => {
    it('plain switches the mode, keeping only fully selected elements going up', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        vertSelectSet(bm, at(1, 0), true)
        selectModeFlush(bm) // as the pick operator flushes: the edge between them is selected
        expect(selectModeToggleMulti(bm, SelectMode.Edge, 2, false, false)).toBe(true)
        expect(bm.selectMode).toBe(SelectMode.Edge)
        expect(counts(bm)).toEqual([2, 1, 0])
        expect(selectModeToggleMulti(bm, SelectMode.Face, 2, false, false)).toBe(true)
        expect(counts(bm)).toEqual([0, 0, 0])
    })

    it('Ctrl expands on the way up', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        expect(selectModeToggleMulti(bm, SelectMode.Face, 2, false, true)).toBe(true)
        expect(bm.selectMode).toBe(SelectMode.Face)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('Shift combines modes, and cannot remove the only one', () => {
        const {bm} = grid(SelectMode.Vertex)
        expect(selectModeToggleMulti(bm, SelectMode.Edge, 2, true, false)).toBe(true)
        expect(bm.selectMode).toBe(SelectMode.Vertex | SelectMode.Edge)
        expect(selectModeToggleMulti(bm, SelectMode.Vertex, 2, true, false)).toBe(true)
        expect(bm.selectMode).toBe(SelectMode.Edge)
        expect(selectModeToggleMulti(bm, SelectMode.Edge, 2, true, false)).toBe(false)
        expect(bm.selectMode).toBe(SelectMode.Edge)
    })

    it('pressing the current mode again is a no-op', () => {
        const {bm} = grid(SelectMode.Face)
        expect(selectModeToggleMulti(bm, SelectMode.Face, 2, false, false)).toBe(false)
    })

    it('going down selects every constituent', () => {
        const {bm, faces} = grid(SelectMode.Face)
        faceSelectSet(bm, faces[0], true)
        selectModeToggleMulti(bm, SelectMode.Vertex, 2, false, false)
        expect(counts(bm)).toEqual([4, 4, 1])
    })
})
