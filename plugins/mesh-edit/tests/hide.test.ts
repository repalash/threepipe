/**
 * Hide and reveal, against `EDBM_mesh_hide` and `EDBM_mesh_reveal`.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, BMVert, ElemFlag, faceSelectSet, primitiveGrid, SelectMode, selectCountsRecalc, selectNone, vertSelectSet, edgeSelectSet} from '@threepipe/mesh-kernel'
import {meshHide, meshReveal} from '../src/select/hide'

function grid(mode: number, n = 4) {
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

function hidden(bm: BMesh): [number, number, number] {
    let v = 0, e = 0, f = 0
    for (const x of bm.verts) if (x.hflag & ElemFlag.Hidden) v++
    for (const x of bm.edges) if (x.hflag & ElemFlag.Hidden) e++
    for (const x of bm.faces) if (x.hflag & ElemFlag.Hidden) f++
    return [v, e, f]
}

describe('EDBM_mesh_hide', () => {
    it('hiding a vertex hides its edges and faces and clears the selection', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        expect(meshHide(bm, false)).toBe(true)
        expect(hidden(bm)).toEqual([1, 4, 4])
        expect(counts(bm)).toEqual([0, 0, 0])
    })

    it('hiding a face hides its edges and vertices only when nothing visible uses them', () => {
        const {bm, faces} = grid(SelectMode.Face)
        faceSelectSet(bm, faces[0], true) // the corner face
        meshHide(bm, false)
        // Its two boundary edges and the corner vertex have no other face; the rest stay.
        expect(hidden(bm)).toEqual([1, 2, 1])
        expect(counts(bm)).toEqual([0, 0, 0])
    })

    it('Shift+H hides the unselected elements', () => {
        const {bm, at, faces} = grid(SelectMode.Face)
        const centre = faces.find(f => f.verts().includes(at(0, 0)) && f.verts().includes(at(1, 1)))!
        faceSelectSet(bm, centre, true)
        meshHide(bm, true)
        expect(hidden(bm)[2]).toBe(15)
        // The kept face keeps its four vertices and edges.
        expect(hidden(bm)[0]).toBe(25 - 4)
        expect(hidden(bm)[1]).toBe(40 - 4)
        expect(counts(bm)).toEqual([4, 4, 1])
    })

    it('reports nothing to do with an empty selection', () => {
        const {bm} = grid(SelectMode.Vertex)
        expect(meshHide(bm, false)).toBe(false)
    })

    it('in edge mode hides the selected edges and their faces', () => {
        const {bm, at} = grid(SelectMode.Edge)
        edgeSelectSet(bm, [...bm.edges].find(e => e.joins(at(0, 0), at(1, 0)))!, true)
        meshHide(bm, false)
        expect(hidden(bm)).toEqual([0, 1, 2])
    })
})

describe('EDBM_mesh_reveal', () => {
    it('reveals everything and selects what was hidden, in the mode\'s domains', () => {
        const {bm, faces} = grid(SelectMode.Face)
        faceSelectSet(bm, faces[0], true)
        meshHide(bm, false)
        expect(meshReveal(bm, true)).toBe(true)
        expect(hidden(bm)).toEqual([0, 0, 0])
        expect(counts(bm)).toEqual([4, 4, 1])
    })

    it('can reveal without selecting', () => {
        const {bm, at} = grid(SelectMode.Vertex)
        vertSelectSet(bm, at(0, 0), true)
        meshHide(bm, false)
        meshReveal(bm, false)
        expect(hidden(bm)).toEqual([0, 0, 0])
        expect(counts(bm)).toEqual([0, 0, 0])
    })

    it('reports nothing to do when nothing is hidden', () => {
        const {bm} = grid(SelectMode.Vertex)
        expect(meshReveal(bm, true)).toBe(false)
    })
})
