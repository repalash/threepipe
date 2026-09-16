import {describe, expect, it} from 'vitest'
import {BMesh} from '../bmesh/BMesh'
import {BMVert} from '../bmesh/types'
import {edgeIsManifold} from '../bmesh/structure'
import {faceSelectSet, selectAll, selectNone, vertSelectSet} from '../bmesh/marking'
import {SelectMode} from '../constants'
import {deleteSelection, duplicateGeometry, duplicateSelection, mergeSelectedVerts, splitSelection} from './duplicate'
import {translateVerts} from './extrude'

function cube() {
    const bm = new BMesh()
    const s = 0.5
    const co: [number,number,number][] = [
        [-s,-s,-s],[-s,-s,s],[-s,s,-s],[-s,s,s],[s,-s,-s],[s,-s,s],[s,s,-s],[s,s,s]]
    const verts = co.map(c => bm.vertCreate(...c))
    for (const f of [[0,1,3,2],[2,3,7,6],[6,7,5,4],[4,5,1,0],[2,6,4,0],[7,3,1,5]]) bm.faceCreate(f.map(i=>verts[i]))
    return {bm, verts}
}

function quad() {
    const bm = new BMesh()
    const v = [bm.vertCreate(0,0,0), bm.vertCreate(1,0,0), bm.vertCreate(1,1,0), bm.vertCreate(0,1,0)]
    const f = bm.faceCreate(v)
    return {bm, v, f}
}

describe('duplicateGeometry', () => {
    it('copies a whole cube, doubling every count and leaving both valid', () => {
        const {bm} = cube()
        const res = duplicateGeometry(bm, {faces: [...bm.faces]})
        expect(bm.totvert).toBe(16)
        expect(bm.totedge).toBe(24)
        expect(bm.totface).toBe(12)
        expect(res.faces.length).toBe(6)
        expect(bm.validate()).toEqual([])
        // The copy is a separate closed shell, so every edge still has two faces.
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
    })

    it('pulls in the vertices and edges a face needs without being told', () => {
        const {bm, f} = quad()
        const res = duplicateGeometry(bm, {faces: [f]})
        expect(res.verts.length).toBe(4)
        expect(res.edges.length).toBe(4)
        expect(bm.validate()).toEqual([])
    })

    it('places copies exactly on the originals, for the caller to move', () => {
        const {bm, v} = quad()
        const res = duplicateGeometry(bm, {faces: [...bm.faces]})
        const copy = res.vertMap.get(v[0])!
        expect([copy.x, copy.y, copy.z]).toEqual([v[0].x, v[0].y, v[0].z])
        translateVerts(res.verts, 5, 0, 0)
        expect(copy.x).toBe(5)
        expect(v[0].x).toBe(0) // the original did not move
    })

    it('selects the copy, so a following move acts on it', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        const res = duplicateGeometry(bm, {faces: [...bm.faces]})
        expect(bm.totfacesel).toBe(6)
        for (const f of res.faces) expect(f.hflag & 1).toBeTruthy()
    })

    it('duplicates loose vertices with no faces', () => {
        const bm = new BMesh()
        const a = bm.vertCreate(0,0,0)
        const res = duplicateGeometry(bm, {verts: [a]})
        expect(bm.totvert).toBe(2)
        expect(res.verts.length).toBe(1)
        expect(bm.validate()).toEqual([])
    })
})

describe('duplicateSelection', () => {
    it('kit-bashes: duplicate and offset five times gives six separate boxes', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        selectAll(bm)
        for (let i = 0; i < 5; i++) {
            const res = duplicateSelection(bm)!
            translateVerts(res.verts, 2, 0, 0)
            expect(bm.validate()).toEqual([])
        }
        expect(bm.totface).toBe(36)
        expect(bm.totvert).toBe(48)
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
    })

    it('returns null with nothing selected', () => {
        const {bm} = cube()
        selectNone(bm)
        expect(duplicateSelection(bm)).toBeNull()
    })
})

describe('splitSelection', () => {
    it('detaches the selection, leaving the rest behind', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        const face = [...bm.faces][0]
        faceSelectSet(bm, face, true)
        const res = splitSelection(bm)!
        expect(res.faces.length).toBe(1)
        expect(bm.totface).toBe(6) // one removed, one added
        expect(bm.validate()).toEqual([])
    })
})

describe('deleteSelection', () => {
    it('verts context takes the surrounding faces with it', () => {
        const {bm, verts} = cube()
        vertSelectSet(bm, verts[0], true)
        deleteSelection(bm, 'verts')
        expect(bm.totvert).toBe(7)
        expect(bm.totface).toBe(3)
        expect(bm.validate()).toEqual([])
    })

    it('onlyFaces leaves the rim, opening a hole', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        faceSelectSet(bm, [...bm.faces][0], true)
        deleteSelection(bm, 'onlyFaces')
        expect(bm.totface).toBe(5)
        expect(bm.totvert).toBe(8) // rim kept
        expect(bm.totedge).toBe(12)
        expect(bm.validate()).toEqual([])
    })

    it('faces context cleans up edges and verts left unused', () => {
        const {bm} = cube()
        bm.selectMode = SelectMode.Face
        selectAll(bm)
        deleteSelection(bm, 'faces')
        expect(bm.totface).toBe(0)
        expect(bm.totedge).toBe(0)
        expect(bm.totvert).toBe(0)
        expect(bm.validate()).toEqual([])
    })

    it('edges context keeps the vertices that survive', () => {
        const {bm} = quad()
        bm.selectMode = SelectMode.Edge
        const e = [...bm.edges][0]
        e.hflag |= 1
        deleteSelection(bm, 'edgesFaces')
        expect(bm.totface).toBe(0)
        expect(bm.totvert).toBe(4)
        expect(bm.validate()).toEqual([])
    })
})

describe('mergeSelectedVerts', () => {
    it('merges two vertices of a quad into one, leaving a triangle', () => {
        const {bm, v} = quad()
        vertSelectSet(bm, v[0], true)
        vertSelectSet(bm, v[1], true)
        const kept = mergeSelectedVerts(bm)!
        expect(bm.totvert).toBe(3)
        expect(bm.totface).toBe(1)
        expect(bm.faceAt(0).len).toBe(3)
        // Merged at the midpoint of the two.
        expect(kept.x).toBeCloseTo(0.5, 6)
        expect(bm.validate()).toEqual([])
    })

    it('merges at the first vertex when asked', () => {
        const {bm, v} = quad()
        vertSelectSet(bm, v[0], true)
        vertSelectSet(bm, v[1], true)
        const kept = mergeSelectedVerts(bm, 'first')!
        expect(kept.x).toBeCloseTo(0, 6)
        expect(bm.validate()).toEqual([])
    })

    it('needs at least two vertices', () => {
        const {bm, v} = quad()
        vertSelectSet(bm, v[0], true)
        expect(mergeSelectedVerts(bm)).toBeNull()
    })
})
