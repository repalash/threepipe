/**
 * Select More / Less, against `bmo_region_extend` and `EDBM_select_more/less`.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, BMVert, ElemFlag, faceSelectSet, primitiveGrid, SelectMode, selectCountsRecalc, selectNone, vertSelectSet, edgeSelectSet} from '@threepipe/mesh-kernel'
import {selectLess, selectMore} from '../src/select/moreLess'

function grid(mode: number, n = 6) {
    const bm = bmFromMesh(primitiveGrid({xSegments: n, ySegments: n, size: n / 2}))
    bm.selectMode = mode
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

describe('select more', () => {
    it('in vertex mode grows along edges: one vertex becomes a plus', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        selectMore(bm)
        expect(counts(bm)).toEqual([5, 4, 0])
        selectMore(bm)
        // The diamond of radius 2: 13 vertices.
        expect(counts(bm)[0]).toBe(13)
    })

    it('with face stepping grows across faces: one vertex becomes a 3x3 block', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        selectMore(bm, true)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('in edge mode one edge becomes the edges touching its vertices', () => {
        const {bm, at} = grid(SelectMode.Edge)
        edgeSelectSet(bm, [...bm.edges].find(e => e.joins(at(0, 0), at(1, 0)))!, true)
        selectMore(bm)
        // 4 + 4 edges around the two endpoints, minus the shared one: 7 edges, 8 vertices.
        expect(counts(bm)).toEqual([8, 7, 0])
    })

    it('in face mode one face becomes the faces sharing an edge with it', () => {
        const {bm, at, faces} = grid(SelectMode.Face)
        const centre = faces.find(f => f.verts().includes(at(0, 0)) && f.verts().includes(at(1, 1)))!
        faceSelectSet(bm, centre, true)
        selectMore(bm)
        expect(counts(bm)[2]).toBe(5)
        // With face stepping the corners come too.
        faceSelectSet(bm, centre, true)
        selectNone(bm)
        faceSelectSet(bm, centre, true)
        selectMore(bm, true)
        expect(counts(bm)[2]).toBe(9)
    })
})

describe('select less', () => {
    it('in vertex mode removes the boundary of the selection', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        selectMore(bm)
        selectMore(bm)
        expect(counts(bm)[0]).toBe(13)
        selectLess(bm)
        expect(counts(bm)).toEqual([5, 4, 0])
        selectLess(bm)
        expect(counts(bm)).toEqual([1, 0, 0])
        selectLess(bm)
        expect(counts(bm)).toEqual([0, 0, 0])
    })

    it('in face mode removes faces that border an unselected face, and cleans isolated elements', () => {
        const {bm, at, faces} = grid(SelectMode.Face)
        const centre = faces.find(f => f.verts().includes(at(0, 0)) && f.verts().includes(at(1, 1)))!
        faceSelectSet(bm, centre, true)
        selectMore(bm, true)
        expect(counts(bm)[2]).toBe(9)
        selectLess(bm, true)
        expect(counts(bm)).toEqual([4, 4, 1])
        selectLess(bm, true)
        expect(counts(bm)).toEqual([0, 0, 0])
    })

    it('in edge mode re-derives the vertices from the remaining edges', () => {
        const {bm, at} = grid(SelectMode.Edge)
        edgeSelectSet(bm, [...bm.edges].find(e => e.joins(at(0, 0), at(1, 0)))!, true)
        selectMore(bm)
        selectLess(bm)
        expect(counts(bm)).toEqual([2, 1, 0])
    })

    it('never leaves a hidden element selected', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        at(1, 0).hflag |= ElemFlag.Hidden
        selectMore(bm)
        expect(at(1, 0).hflag & ElemFlag.Select).toBeFalsy()
        expect(counts(bm)[0]).toBe(4)
    })
})
