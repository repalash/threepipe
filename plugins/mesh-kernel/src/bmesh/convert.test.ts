import {describe, expect, it} from 'vitest'
import {MeshData} from '../MeshData'
import {AttrDomain, AttrName, ElemFlag, SelectMode} from '../constants'
import {bmFromMesh, bmToMesh} from './convert'
import {edgeIsManifold, radialLength} from './structure'
import {BMFace} from './types'

function cubeMesh(): MeshData {
    const s = 0.5
    return MeshData.fromFaces({
        positions: [
            -s, -s, -s, -s, -s, s, -s, s, -s, -s, s, s,
            s, -s, -s, s, -s, s, s, s, -s, s, s, s,
        ],
        faces: [
            [0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4],
            [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5],
        ],
    })
}

/** Compare two meshes on everything the conversion is supposed to preserve. */
function expectSameMesh(a: MeshData, b: MeshData) {
    expect(b.validate()).toEqual([])
    expect(b.vertsNum).toBe(a.vertsNum)
    expect(b.edgesNum).toBe(a.edgesNum)
    expect(b.facesNum).toBe(a.facesNum)
    expect(b.cornersNum).toBe(a.cornersNum)
    expect([...b.positions]).toEqual([...a.positions])
    expect([...b.faceOffsets]).toEqual([...a.faceOffsets])
    expect([...b.cornerVerts]).toEqual([...a.cornerVerts])
}

describe('bmFromMesh', () => {
    it('reproduces the topology of a cube', () => {
        const bm = bmFromMesh(cubeMesh())
        expect(bm.describe()).toBe('verts 8, edges 12, faces 6, loops 24')
        expect(bm.validate()).toEqual([])
        for (const e of bm.edges) expect(edgeIsManifold(e)).toBe(true)
    })

    it('rejects an invalid MeshData rather than producing a broken BMesh', () => {
        const mesh = cubeMesh()
        mesh.cornerVerts[0] = 99
        expect(() => bmFromMesh(mesh)).toThrow(/cannot convert an invalid MeshData/)
    })

    it('reuses the mesh edge indices rather than creating parallel edges', () => {
        const bm = bmFromMesh(cubeMesh())
        expect(bm.totedge).toBe(12)
        for (const e of bm.edges) expect(radialLength(e)).toBe(2)
    })
})

describe('round trip', () => {
    it('preserves a bare cube exactly', () => {
        const before = cubeMesh()
        const after = bmToMesh(bmFromMesh(before))
        expectSameMesh(before, after)
    })

    it('preserves n-gons and mixed face sizes', () => {
        const before = MeshData.fromFaces({
            positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 0, 1, 0],
            faces: [[0, 1, 4, 5], [1, 2, 3, 4], [0, 1, 2, 3, 4, 5]],
        })
        const after = bmToMesh(bmFromMesh(before))
        expectSameMesh(before, after)
        expect(after.faceSize(2)).toBe(6)
    })

    it('preserves per-corner UVs, including a seam where two corners share a vertex', () => {
        const before = cubeMesh()
        const uv = before.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2'})
        // Distinct value per corner, so any reordering or vertex-welding shows up.
        for (let c = 0; c < before.cornersNum; c++) {
            uv.data[c * 2] = c / 100
            uv.data[c * 2 + 1] = 1 - c / 100
        }
        const expected = [...uv.data]

        const after = bmToMesh(bmFromMesh(before))
        expectSameMesh(before, after)
        const got = after.attributes.require('uv', AttrDomain.Corner, 'float2')
        expect([...got.data].map(v => +v.toFixed(5))).toEqual(expected.map(v => +v.toFixed(5)))
    })

    it('preserves selection flags on all three domains', () => {
        const before = cubeMesh()
        const sv = before.attributes.ensure(AttrName.selectVert, AttrDomain.Point, 'bool')
        const se = before.attributes.ensure(AttrName.selectEdge, AttrDomain.Edge, 'bool')
        const sf = before.attributes.ensure(AttrName.selectFace, AttrDomain.Face, 'bool')
        sv.data[0] = 1
        sv.data[3] = 1
        se.data[2] = 1
        sf.data[4] = 1
        before.select.mode = SelectMode.Edge | SelectMode.Face

        const after = bmToMesh(bmFromMesh(before))
        expect([...after.attributes.require(AttrName.selectVert, AttrDomain.Point, 'bool').data])
            .toEqual([...sv.data])
        expect([...after.attributes.require(AttrName.selectEdge, AttrDomain.Edge, 'bool').data])
            .toEqual([...se.data])
        expect([...after.attributes.require(AttrName.selectFace, AttrDomain.Face, 'bool').data])
            .toEqual([...sf.data])
        expect(after.select.mode).toBe(SelectMode.Edge | SelectMode.Face)
    })

    it('preserves sharp edges and flat faces, which BMesh stores inverted as smooth flags', () => {
        const before = cubeMesh()
        const sharpE = before.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool')
        const sharpF = before.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool')
        sharpE.data[1] = 1
        sharpE.data[5] = 1
        sharpF.data[0] = 1

        const bm = bmFromMesh(before)
        // Verify the inversion actually happened rather than trusting the round trip alone.
        const sharpCount = [...bm.edges].filter(e => !(e.hflag & ElemFlag.Smooth)).length
        expect(sharpCount).toBe(2)

        const after = bmToMesh(bm)
        expect([...after.attributes.require(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data])
            .toEqual([...sharpE.data])
        expect([...after.attributes.require(AttrName.sharpFace, AttrDomain.Face, 'bool').data])
            .toEqual([...sharpF.data])
    })

    it('preserves UV seams', () => {
        const before = cubeMesh()
        const seam = before.attributes.ensure(AttrName.uvSeam, AttrDomain.Edge, 'bool')
        seam.data[0] = 1
        seam.data[7] = 1
        const after = bmToMesh(bmFromMesh(before))
        expect([...after.attributes.require(AttrName.uvSeam, AttrDomain.Edge, 'bool').data])
            .toEqual([...seam.data])
    })

    it('preserves material indices and slot names', () => {
        const before = cubeMesh()
        const mat = before.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32')
        mat.data.set([0, 1, 2, 1, 0, 2])
        before.materials = ['red', 'green', 'blue']

        const after = bmToMesh(bmFromMesh(before))
        expect([...after.attributes.require(AttrName.materialIndex, AttrDomain.Face, 'int32').data])
            .toEqual([0, 1, 2, 1, 0, 2])
        expect(after.materials).toEqual(['red', 'green', 'blue'])
    })

    it('preserves hidden elements', () => {
        const before = cubeMesh()
        const hv = before.attributes.ensure(AttrName.hideVert, AttrDomain.Point, 'bool')
        hv.data[2] = 1
        const after = bmToMesh(bmFromMesh(before))
        expect([...after.attributes.require(AttrName.hideVert, AttrDomain.Point, 'bool').data])
            .toEqual([...hv.data])
    })

    it('preserves selection history order and the active face', () => {
        const before = cubeMesh()
        before.select.history = [{type: 'vert', index: 5}, {type: 'face', index: 2}, {type: 'edge', index: 1}]
        before.select.activeFace = 3

        const bm = bmFromMesh(before)
        expect(bm.selectHistory.length).toBe(3)
        expect(bm.actFace).toBeInstanceOf(BMFace)

        const after = bmToMesh(bm)
        expect(after.select.history).toEqual(before.select.history)
        expect(after.select.activeFace).toBe(3)
    })

    it('preserves generic point and face attributes of several types', () => {
        const before = cubeMesh()
        const weight = before.attributes.add({name: 'weight', domain: AttrDomain.Point, type: 'float'})
        const group = before.attributes.add({name: 'group', domain: AttrDomain.Face, type: 'int32'})
        const colour = before.attributes.add({name: 'col', domain: AttrDomain.Corner, type: 'float4'})
        for (let i = 0; i < before.vertsNum; i++) weight.data[i] = i * 0.25
        for (let i = 0; i < before.facesNum; i++) group.data[i] = i * 7
        for (let i = 0; i < before.cornersNum * 4; i++) colour.data[i] = (i % 10) / 10

        const after = bmToMesh(bmFromMesh(before))
        expect([...after.attributes.require('weight', AttrDomain.Point, 'float').data])
            .toEqual([...weight.data])
        expect([...after.attributes.require('group', AttrDomain.Face, 'int32').data])
            .toEqual([...group.data])
        expect([...after.attributes.require('col', AttrDomain.Corner, 'float4').data]
            .map(v => +v.toFixed(5)))
            .toEqual([...colour.data].map(v => +v.toFixed(5)))
    })

    it('omits flag layers entirely when nothing needs them', () => {
        // Blender only writes a select layer when something is selected; so do we.
        const after = bmToMesh(bmFromMesh(cubeMesh()))
        expect(after.attributes.has(AttrName.selectVert)).toBe(false)
        expect(after.attributes.has(AttrName.sharpEdge)).toBe(false)
        expect(after.attributes.has(AttrName.materialIndex)).toBe(false)
    })

    it('survives two full round trips unchanged', () => {
        const before = cubeMesh()
        const once = bmToMesh(bmFromMesh(before))
        const twice = bmToMesh(bmFromMesh(once))
        expectSameMesh(once, twice)
    })

    it('round-trips a mesh edited in BMesh form', () => {
        const bm = bmFromMesh(cubeMesh())
        // Remove one face; the edges and vertices stay, so the result has a hole.
        bm.faceKill(bm.faces.values().next().value!)
        const after = bmToMesh(bm)
        expect(after.validate()).toEqual([])
        expect(after.facesNum).toBe(5)
        expect(after.vertsNum).toBe(8)
        expect(after.edgesNum).toBe(12)
        expect(after.cornersNum).toBe(20)
    })
})
