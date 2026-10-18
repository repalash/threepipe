/**
 * Select linked (`L`, `Ctrl+L`) with delimiters, against `edbm_select_linked_pick_ex` and
 * `edbm_select_linked_exec`.
 */

import {describe, expect, it} from 'vitest'
import {bmFromMesh, BMesh, BMVert, ElemFlag, faceSelectSet, MeshData, primitiveGrid, SelectMode, selectCountsRecalc, selectNone, vertSelectSet, edgeSelectSet} from '@threepipe/mesh-kernel'
import {linkedDelimitDefault, selectLinkedAll, selectLinkedPick} from '../src/select/linked'

/** Two separate 2x2 grids, side by side, in one mesh. */
function twoIslands(mode: number) {
    const a = primitiveGrid({xSegments: 2, ySegments: 2, size: 1})
    const b = primitiveGrid({xSegments: 2, ySegments: 2, size: 1})
    const positions: number[] = []
    const faces: number[][] = []
    const add = (m: MeshData, dx: number) => {
        const base = positions.length / 3
        for (let i = 0; i < m.vertsNum; i++) positions.push(m.positions[i * 3] + dx, m.positions[i * 3 + 1], m.positions[i * 3 + 2])
        for (let f = 0; f < m.facesNum; f++) {
            const face: number[] = []
            for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) face.push(base + m.cornerVerts[c])
            faces.push(face)
        }
    }
    add(a, -2)
    add(b, 2)
    const bm = bmFromMesh(MeshData.fromFaces({positions, faces}))
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

describe('select linked pick', () => {
    it('selects the island of the picked vertex', () => {
        const {bm, at} = twoIslands(SelectMode.Vertex)
        selectLinkedPick(bm, at(-2, 0), true)
        expect(counts(bm)).toEqual([9, 12, 4])
        expect(at(2, 0).hflag & ElemFlag.Select).toBeFalsy()
    })

    it('deselects with Shift+L', () => {
        const {bm, at} = twoIslands(SelectMode.Vertex)
        selectLinkedPick(bm, at(-2, 0), true)
        selectLinkedPick(bm, at(2, 0), true)
        expect(counts(bm)[0]).toBe(18)
        selectLinkedPick(bm, at(-2, 0), false)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('in face mode walks the island of faces', () => {
        const {bm, faces} = twoIslands(SelectMode.Face)
        selectLinkedPick(bm, faces[0], true)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('a seam delimits the walk', () => {
        const {bm, at} = twoIslands(SelectMode.Vertex)
        // Seams down the middle column of the left island: the walk from its left edge stops there.
        for (const e of bm.edges) if (e.v1.x === -2 && e.v2.x === -2) e.hflag |= ElemFlag.Seam
        selectLinkedPick(bm, at(-3, 0), true, {seam: true})
        // The left column of quads: 6 vertices, 7 edges, 2 faces.
        expect(counts(bm)).toEqual([6, 7, 2])
    })

    it('a material change delimits the walk in face mode', () => {
        const {bm, faces} = twoIslands(SelectMode.Face)
        faces[0].matNr = 1
        selectLinkedPick(bm, faces[0], true, {material: true})
        expect(counts(bm)[2]).toBe(1)
    })

    it('defaults to seams in face mode and nothing otherwise', () => {
        const {bm} = twoIslands(SelectMode.Face)
        expect(linkedDelimitDefault(bm)).toEqual({seam: true})
        bm.selectMode = SelectMode.Edge
        expect(linkedDelimitDefault(bm)).toEqual({})
    })
})

describe('select linked (Ctrl+L)', () => {
    it('grows every selected vertex to its island', () => {
        const {bm, at} = twoIslands(SelectMode.Vertex)
        vertSelectSet(bm, at(-3, -1), true)
        selectLinkedAll(bm)
        expect(counts(bm)).toEqual([9, 12, 4])
    })

    it('in edge mode grows from the selected edges', () => {
        const {bm, at} = twoIslands(SelectMode.Edge)
        edgeSelectSet(bm, [...bm.edges].find(e => e.joins(at(2, 0), at(3, 0)))!, true)
        selectLinkedAll(bm)
        expect(counts(bm)).toEqual([9, 12, 4])
        expect(at(-2, 0).hflag & ElemFlag.Select).toBeFalsy()
    })

    it('in face mode grows the selected faces, stopping at seams by default', () => {
        const {bm, faces} = twoIslands(SelectMode.Face)
        for (const e of bm.edges) if (e.v1.x === -2 && e.v2.x === -2) e.hflag |= ElemFlag.Seam
        faceSelectSet(bm, faces[0], true)
        selectLinkedAll(bm, linkedDelimitDefault(bm))
        expect(counts(bm)[2]).toBe(2)
        selectLinkedAll(bm, {})
        expect(counts(bm)[2]).toBe(4)
    })

    it('with a seam delimiter in vertex mode, an isolated vertex on a seam still steps off it', () => {
        const {bm, at} = twoIslands(SelectMode.Vertex)
        for (const e of bm.edges) if (e.v1.x === -2 && e.v2.x === -2) e.hflag |= ElemFlag.Seam
        vertSelectSet(bm, at(-2, 0), true)
        selectLinkedAll(bm, {seam: true})
        // The vertex sits on the seam; its faces on both sides are reachable through corners.
        expect(counts(bm)[0]).toBe(9)
    })
})
