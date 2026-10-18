/**
 * Parity cases for the mesh field inputs (Face Area, Edge Neighbors, Mesh Island, Vertex Neighbors, Face
 * Neighbors, Is Face Planar, Edge Vertices): every output stored on every mesh domain of the joined test
 * meshes (`meshCommon.ts`), so the native values and Blender's domain adaptation of each are compared, plus
 * the inputs read on a point cloud (no mesh: the type's default).
 */

import {AnySocket, n, Socket} from '../../../src/dsl/builder'
import {meshCase, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const DOMAINS = ['POINT', 'EDGE', 'FACE', 'CORNER'] as const

type Outputs = () => Record<string, AnySocket>

const INPUTS: [string, string, Outputs][] = [
    ['face-area', 'Face Area', () => ({area: n.FaceArea().area})],
    ['edge-neighbors', 'Edge Neighbors', () => ({faces: n.EdgeNeighbors().faceCount})],
    ['mesh-island', 'Mesh Island', () => {
        const m = n.MeshIsland()
        return {island: m.islandIndex, islands: m.islandCount}
    }],
    ['vertex-neighbors', 'Vertex Neighbors', () => {
        const m = n.VertexNeighbors()
        return {verts: m.vertexCount, faces: m.faceCount}
    }],
    ['face-neighbors', 'Face Neighbors', () => {
        const m = n.FaceNeighbors()
        return {verts: m.vertexCount, faces: m.faceCount}
    }],
    ['face-is-planar', 'Is Face Planar (default threshold and a single threshold)', () => ({
        planar: n.IsFacePlanar().planar,
        planar03: n.IsFacePlanar({threshold: 0.3}).planar,
    })],
    ['edge-vertices', 'Edge Vertices', () => {
        const m = n.EdgeVertices()
        return {v1: m.vertexIndex1, v2: m.vertexIndex2, p1: m.position1, p2: m.position2}
    }],
]

export function meshInputCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const [id, label, outputs] of INPUTS) {
        cases.push(meshCase(`input-${id}`, `${label}: every output on every mesh domain`, SHAPE_SCENE, () => {
            let g = testMeshes()
            for (const domain of DOMAINS) {
                for (const [name, socket] of Object.entries(outputs())) g = store(g, domain, `${name}_${domain.toLowerCase()}`, socket)
            }
            return g
        }))
    }
    // Blender 5.2.2 bug: `PlanarFieldInput` returns a lazy VArray whose lambda reads the thresholds evaluated by a
    // FieldEvaluator that is destroyed when `get_varray_for_context` returns (node_geo_input_mesh_face_is_planar.cc:49-75),
    // so a threshold that is a field (not a single value) reads freed memory. Here every threshold is 10 (all faces
    // planar); this case records what Blender actually outputs.
    cases.push({
        ...meshCase('input-face-is-planar-field-threshold', 'Is Face Planar with a field threshold (index * 0 + 10): Blender reads freed memory',
            SHAPE_SCENE, () => store(testMeshes(), 'FACE', 'planar', n.IsFacePlanar({threshold: n.Index().index.mul(0).add(10)}).planar)),
        blenderBug: 'PlanarFieldInput reads a destroyed FieldEvaluator (issues/open/modelling-tools/procedural-blender-bug-face-is-planar-threshold.md)',
    })
    cases.push(meshCase('inputs-on-points', 'Mesh inputs on a point cloud read as defaults', {}, () => {
        let g: Socket<'GEOMETRY'> = n.Points({count: 3}).geometry
        for (const [id, , outputs] of INPUTS) {
            for (const [name, socket] of Object.entries(outputs())) g = store(g, 'POINT', `${id}_${name}`, socket)
        }
        return g
    }))
    return cases
}
