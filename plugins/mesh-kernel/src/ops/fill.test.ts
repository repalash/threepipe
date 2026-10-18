import {describe, expect, it} from 'vitest'
import {bmFromMesh} from '../bmesh/convert'
import {primitiveCube, primitiveGrid} from '../generate/primitives'
import {edgeSelectSet, faceSelectSet, selectNone, vertSelectSet} from '../bmesh/marking'
import {ElemFlag, SelectMode} from '../constants'
import {faceCalcNormal} from '../bmesh/polygon'
import {edgeloopFill, fillSelection} from './fill'

describe('fillSelection', () => {
    it('two vertices make an edge, without doubling one that exists', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        selectNone(bm)
        // Two vertices across a face diagonal: no edge joins them yet.
        const a = [...bm.verts].find(v => v.x > 0 && v.y > 0 && v.z > 0)!
        const b = [...bm.verts].find(v => v.x < 0 && v.y < 0 && v.z > 0)!
        vertSelectSet(bm, a, true)
        vertSelectSet(bm, b, true)
        const before = bm.totedge
        const r = fillSelection(bm)
        expect(r?.edges).toHaveLength(1)
        expect(bm.totedge).toBe(before + 1)
        // Again: two vertices plus their edge is no longer the two-vertex case, and one edge is no
        // loop, so F does nothing - as in Blender.
        expect(fillSelection(bm)).toBeNull()
        expect(bm.totedge).toBe(before + 1)
    })

    it('a closed loop of four selected edges makes a face wound like its neighbours (edgeloop_fill)', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        // Open the cube: remove the +Z face, keeping its rim.
        const top = [...bm.faces].find(f => [...f.eachLoop()].every(l => l.v.z > 0))!
        bm.faceKill(top)
        expect(bm.totface).toBe(5)
        selectNone(bm)
        bm.selectMode = SelectMode.Edge
        const rim = [...bm.edges].filter(e => e.v1.z > 0 && e.v2.z > 0)
        expect(rim).toHaveLength(4)
        for (const e of rim) edgeSelectSet(bm, e, true)
        const r = fillSelection(bm)
        expect(r?.face).toBeTruthy()
        expect(bm.totface).toBe(6)
        expect(bm.validate()).toEqual([])
        // Wound against the side faces: the new face's normal points out of the cube (+Z).
        expect(faceCalcNormal(r!.face!)[2]).toBeGreaterThan(0.99)
        expect(r!.face!.hflag & ElemFlag.Select).toBeTruthy()
    })

    it('does not make a face that already exists', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        const rim = [...bm.edges].filter(e => e.v1.z > 0 && e.v2.z > 0)
        expect(edgeloopFill(bm, rim)).toEqual([])
        expect(bm.totface).toBe(6)
    })

    it('selected faces dissolve into one region', () => {
        const bm = bmFromMesh(primitiveGrid({xSegments: 2, ySegments: 1}))
        selectNone(bm)
        bm.selectMode = SelectMode.Face
        for (const f of bm.faces) faceSelectSet(bm, f, true)
        const r = fillSelection(bm)
        expect(r?.faces).toHaveLength(1)
        expect(bm.totface).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('returns null for a selection nothing can be made from', () => {
        const bm = bmFromMesh(primitiveCube({size: 2}))
        selectNone(bm)
        vertSelectSet(bm, [...bm.verts][0], true)
        expect(fillSelection(bm)).toBeNull()
    })
})
