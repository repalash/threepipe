/**
 * `measureMesh`, `diffMeshData` (edit locality) and `verifySpec` (three-valued checks).
 */

import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {AttrDomain} from '../src/constants'
import {bmFromMesh, bmToMesh} from '../src/bmesh/convert'
import {averageFaceNormal, extrudeFaceRegion, translateVerts} from '../src/ops/extrude'
import {primitiveCube, primitiveGrid, primitiveUVSphere} from '../src/generate/primitives'
import {primitiveTorus} from '../src/generate/lathe'
import {measureMesh} from '../src/analysis/measure'
import {diffMeshData} from '../src/analysis/diff'
import {verifySpec} from '../src/analysis/spec'

/** Extrude one face of a mesh and move the new cap; the classic local edit. */
function extrudeOne(mesh: MeshData, face: number, d = 0.5): MeshData {
    const bm = bmFromMesh(mesh)
    const f = bm.faceAt(face)
    const n = averageFaceNormal([f])!
    const r = extrudeFaceRegion(bm, [f])!
    translateVerts(r.verts, n[0] * d, n[1] * d, n[2] * d)
    return bmToMesh(bm)
}

describe('measureMesh', () => {
    it('measures a 2-unit cube', () => {
        const m = measureMesh(primitiveCube({size: 2}))
        expect([m.verts, m.edges, m.faces, m.tris]).toEqual([8, 12, 6, 12])
        expect(m.bounds!.size).toEqual([2, 2, 2])
        expect(m.area).toBeCloseTo(24, 6)
        expect(Math.abs(m.volume)).toBeCloseTo(8, 6)
        expect(m.volume).toBeGreaterThan(0) // outward winding
        expect(m.closed).toBe(true)
        expect(m.consistentWinding).toBe(true)
        expect(m.eulerCharacteristic).toBe(2)
        expect(m.genus).toBe(0)
        expect(m.components).toBe(1)
        expect(m.boundaryLoops).toBe(0)
    })

    it('applies a matrix before measuring', () => {
        // column-major: scale x by 3, translate y by 10
        const matrix = [3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1]
        const m = measureMesh(primitiveCube({size: 1}), {matrix})
        expect(m.bounds!.size[0]).toBeCloseTo(3, 6)
        expect(m.bounds!.center[1]).toBeCloseTo(10, 6)
        expect(Math.abs(m.volume)).toBeCloseTo(3, 6)
    })

    it('finds the genus of a torus and the hole of a grid', () => {
        const torus = measureMesh(primitiveTorus({}))
        expect(torus.closed).toBe(true)
        expect(torus.genus).toBe(1)
        const grid = measureMesh(primitiveGrid({xSegments: 3, ySegments: 3}))
        expect(grid.closed).toBe(false)
        expect(grid.boundaryLoops).toBe(1)
        expect(grid.genus).toBeNull()
    })

    it('flags a flipped face as inconsistent winding', () => {
        const cube = primitiveCube({size: 1})
        // reverse face 0's corners in place
        const s = cube.faceOffsets[0]
        const e = cube.faceOffsets[1]
        const verts = Array.from(cube.cornerVerts.subarray(s, e)).reverse()
        const flipped = MeshData.fromFaces({positions: cube.positions,
            faces: Array.from({length: cube.facesNum}, (_, f) => f === 0 ? verts : cube.faceVerts(f))})
        const m = measureMesh(flipped)
        expect(m.consistentWinding).toBe(false)
        expect(m.inconsistentEdges).toBe(4)
    })
})

describe('diffMeshData', () => {
    it('says nothing changed for a clone', () => {
        const a = primitiveUVSphere({})
        const d = diffMeshData(a, a.clone())
        expect(d.identical).toBe(true)
        expect(d.local).toBe(true)
    })

    it('keeps an extrude local to the claimed face', () => {
        const before = primitiveUVSphere({segments: 16, ringCount: 8})
        const after = extrudeOne(before, 40)
        const d = diffMeshData(before, after, {claim: {faces: [40]}})
        expect(d.faces.removed).toBe(1) // the original face moved up as the cap
        expect(d.faces.added).toBe(1 + before.faceVerts(40).length) // cap + sides
        expect(d.collateral.faceCount).toBe(0)
        expect(d.collateral.vertCount).toBe(0)
        expect(d.local).toBe(true)
    })

    it('reports collateral when the claim was a different face', () => {
        const before = primitiveUVSphere({segments: 16, ringCount: 8})
        const after = extrudeOne(before, 40)
        const d = diffMeshData(before, after, {claim: {faces: [100]}})
        expect(d.local).toBe(false)
        expect(d.collateral.faces).toEqual([40])
    })

    it('matches geometry, not indices, and reports renumbering', () => {
        const source = primitiveCube({size: 1})
        const cube = MeshData.fromFaces({positions: source.positions, faces: Array.from({length: 6}, (_, f) => source.faceVerts(f))})
        const order = [5, 4, 3, 2, 1, 0]
        const shuffled = MeshData.fromFaces({positions: cube.positions, faces: order.map(f => cube.faceVerts(f))})
        const d = diffMeshData(cube, shuffled, {claim: 'none'})
        expect(d.faces.kept).toBe(6)
        expect(d.faces.renumbered).toBe(6)
        expect(d.local).toBe(true)
        expect(d.identical).toBe(false)
    })

    it('catches a moved vertex outside the claim, and a lost or changed attribute layer', () => {
        // 4 x 4 quads, 5 x 5 vertices; vertex 0's ring is face 0 = (0, 1, 6, 5)
        const before = primitiveGrid({xSegments: 4, ySegments: 4})
        before.attributes.add({name: 'weight', domain: AttrDomain.Point, type: 'float',
            data: Array.from({length: before.vertsNum}, (_, i) => i)})
        const after = before.clone()
        after.positions[3 * 24 + 2] += 1 // vertex 24, far corner
        const w = after.attributes.get('weight')!.data
        w[0] = 99 // vertex 0, claimed below
        w[12] = 99 // vertex 12, the middle, not claimed
        const d = diffMeshData(before, after, {claim: {verts: [0]}})
        expect(d.collateral.verts).toEqual([24])
        const weight = d.layers.find(l => l.name === 'weight')!
        expect(weight.status).toBe('changed')
        expect(weight.changed).toBe(2)
        expect(weight.collateral).toBe(1)

        const dropped = before.clone()
        dropped.attributes.remove('weight')
        expect(diffMeshData(before, dropped).layers.find(l => l.name === 'weight')!.status).toBe('removed')
        expect(diffMeshData(before, dropped).local).toBe(false)
    })

    it('aligns corner attributes across a rotated face', () => {
        const quad = MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [[0, 1, 2, 3]]})
        quad.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2', data: [0, 0, 1, 0, 1, 1, 0, 1]})
        // the same face, starting at a different corner, with the UVs carried along
        const rotated = MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [[2, 3, 0, 1]]})
        rotated.attributes.add({name: 'uv', domain: AttrDomain.Corner, type: 'float2', data: [1, 1, 0, 1, 0, 0, 1, 0]})
        expect(diffMeshData(quad, rotated).layers[0].status).toBe('unchanged')
    })
})

describe('verifySpec', () => {
    it('passes a cube spec with measured and structural evidence', () => {
        const r = verifySpec(primitiveCube({size: 2}), {
            bbox: {size: [2, 2, 2]}, counts: {faces: 6}, volume: 8, manifold: {closed: true, orientable: true},
            valid: true, genus: 0,
        })
        expect(r.failed).toBe(0)
        expect(r.unverified).toBe(0)
        expect(r.conforms).toBe(true)
        expect(r.results.find(x => x.requirement === 'bbox.size.x')!.evidence).toBe('measured')
        expect(r.results.find(x => x.requirement === 'genus')!.evidence).toBe('derived')
        expect(r.results.find(x => x.requirement === 'valid')!.evidence).toBe('structural')
    })

    it('fails what is wrong and does not pass vacuously', () => {
        expect(verifySpec(primitiveCube({size: 2}), {bbox: {size: [3, null, null]}}).conforms).toBe(false)
        const empty = verifySpec(primitiveCube({size: 2}), {})
        expect(empty.passed).toBe(0)
        expect(empty.conforms).toBe(false)
    })

    it('leaves volume of an open mesh unverified, not failed', () => {
        const r = verifySpec(primitiveGrid({}), {volume: 0, counts: {verts: {min: 1}}})
        expect(r.results.find(x => x.requirement === 'volume')!.verdict).toBe('UNVERIFIED')
        expect(r.conforms).toBe(false)
    })

    it('checks that named groups survive an edit', () => {
        const before = primitiveUVSphere({segments: 16, ringCount: 8})
        const after = extrudeOne(before, 40)
        const spec = {groups: {target: {faces: [40]}, other: {faces: [100, 101]}}, unchanged: ['other']}
        expect(verifySpec(after, spec, {baseline: before}).conforms).toBe(true)
        const bad = verifySpec(after, {...spec, unchanged: ['target']}, {baseline: before})
        expect(bad.conforms).toBe(false)
        expect((bad.results[0].actual as {changedFaces: number[]}).changedFaces).toEqual([40])
        const noBaseline = verifySpec(after, spec)
        expect(noBaseline.results[0].verdict).toBe('UNVERIFIED')
    })
})
