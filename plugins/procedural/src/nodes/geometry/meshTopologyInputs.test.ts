import {describe, expect, it} from 'vitest'
import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField} from '../../fields'
import {evalNodeOutputs} from '../function/testing'
import {faceAreaCalc} from '../../geometry/meshEvaluate'
import '../index'

/** Two triangles sharing edge 1-2, a separate quad, and a loose vertex (islands 0, 1, 2). */
function mesh(): MeshData {
    return MeshData.fromFaces({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.5, 5, 0, 0, 6, 0, 0, 6, 1, 0.1, 5, 1, 0, 9, 9, 9],
        faces: [[0, 1, 2], [1, 3, 2], [4, 5, 6, 7]],
    })
}

function evalOn(m: MeshData, type: string, output: string, domain: AttrDomain, inputs = {}): number[] {
    const f = evalNodeOutputs(type, {inputs})[output] as GField
    const ctx = new FieldContext('mesh', m, domain)
    const v = new FieldEvaluation(ctx, ctx.size).evaluate(f)
    return Array.from(v.materialize())
}

describe('mesh topology inputs', () => {
    it('Face Area: area_tri_v3 for triangles, Newell (area_poly_v3) otherwise', () => {
        const m = mesh()
        const areas = evalOn(m, 'GeometryNodeInputMeshFaceArea', 'Area', AttrDomain.Face)
        expect(areas[0]).toBe(Math.fround(0.5))
        // Non-planar quad: half the length of the Newell normal.
        expect(areas[2]).toBe(faceAreaCalc(m.positions, m.cornerVerts, 6, 10))
        expect(areas[2]).toBeCloseTo(1, 2)
    })

    it('Edge Neighbors counts corner edges', () => {
        const m = mesh()
        const counts = evalOn(m, 'GeometryNodeInputMeshEdgeNeighbors', 'Face Count', AttrDomain.Edge)
        expect(counts.reduce((a, b) => a + b, 0)).toBe(10)
        expect(counts.filter(c => c === 2).length).toBe(1)
    })

    it('Mesh Island numbers islands by first vertex (calc_reduced_ids) and counts them', () => {
        const m = mesh()
        expect(evalOn(m, 'GeometryNodeInputMeshIsland', 'Island Index', AttrDomain.Point)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2])
        expect(evalOn(m, 'GeometryNodeInputMeshIsland', 'Island Count', AttrDomain.Face)).toEqual([3, 3, 3])
        expect(evalOn(m, 'GeometryNodeInputMeshIsland', 'Island Index', AttrDomain.Face)).toEqual([0, 0, 1])
    })

    it('Vertex Neighbors: edges and corners per vertex, nothing off the point domain', () => {
        const m = mesh()
        expect(evalOn(m, 'GeometryNodeInputMeshVertexNeighbors', 'Vertex Count', AttrDomain.Point)).toEqual([2, 3, 3, 2, 2, 2, 2, 2, 0])
        expect(evalOn(m, 'GeometryNodeInputMeshVertexNeighbors', 'Face Count', AttrDomain.Point)).toEqual([1, 2, 2, 1, 1, 1, 1, 1, 0])
        expect(evalOn(m, 'GeometryNodeInputMeshVertexNeighbors', 'Face Count', AttrDomain.Face)).toEqual([0, 0, 0])
    })

    it('Face Neighbors: corners and distinct neighbouring faces', () => {
        const m = mesh()
        expect(evalOn(m, 'GeometryNodeInputMeshFaceNeighbors', 'Vertex Count', AttrDomain.Face)).toEqual([3, 3, 4])
        expect(evalOn(m, 'GeometryNodeInputMeshFaceNeighbors', 'Face Count', AttrDomain.Face)).toEqual([1, 1, 0])
    })

    it('Is Face Planar: triangles always, quads by the spread of dot(normal, position) against threshold / 2', () => {
        const m = mesh()
        expect(evalOn(m, 'GeometryNodeInputMeshFaceIsPlanar', 'Planar', AttrDomain.Face)).toEqual([1, 1, 0])
        expect(evalOn(m, 'GeometryNodeInputMeshFaceIsPlanar', 'Planar', AttrDomain.Face, {Threshold: 1})).toEqual([1, 1, 1])
    })

    it('Edge Vertices: indices on edges only, positions adapted', () => {
        const m = mesh()
        const ev = Array.from(m.edgeVerts)
        expect(evalOn(m, 'GeometryNodeInputMeshEdgeVertices', 'Vertex Index 1', AttrDomain.Edge)).toEqual(ev.filter((_, i) => i % 2 === 0))
        expect(evalOn(m, 'GeometryNodeInputMeshEdgeVertices', 'Vertex Index 2', AttrDomain.Point)).toEqual(new Array(9).fill(0))
        const p2 = evalOn(m, 'GeometryNodeInputMeshEdgeVertices', 'Position 2', AttrDomain.Edge)
        expect(p2.slice(0, 3)).toEqual(Array.from(m.positions.slice(ev[1] * 3, ev[1] * 3 + 3)))
    })
})
