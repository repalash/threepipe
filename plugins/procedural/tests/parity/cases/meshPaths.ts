/**
 * Parity cases for Shortest Edge Paths, Edge Paths to Selection / Curves, Edges to Face Groups and Face Group
 * Boundaries: several end vertices, ties (a regular grid with unit costs), zero and negative edge costs,
 * unreachable islands, out-of-range next indices, and every output domain.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function meshPathCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))
    const grid = () => n.MeshGrid({sizeX: 3, sizeY: 2, verticesX: 7, verticesY: 5}).mesh

    add('shortest-paths-grid', 'Shortest Edge Paths on a grid with unit costs (ties), two end vertices, on every domain', () => {
        const paths = n.ShortestEdgePaths({endVertex: index().eq(0).or(index().eq(23))})
        let g = store(grid(), 'POINT', 'next', paths.nextVertexIndex)
        g = store(g, 'POINT', 'cost', paths.totalCost)
        g = store(g, 'EDGE', 'next_e', paths.nextVertexIndex)
        g = store(g, 'FACE', 'cost_f', paths.totalCost)
        return store(g, 'CORNER', 'cost_c', paths.totalCost)
    })
    add('shortest-paths-costs', 'Shortest Edge Paths with edge lengths, zero and negative costs; unreachable islands', () => {
        const verts = n.EdgeVertices()
        const cost = n.Switch({inputType: 'FLOAT', switch: mod(index(), 5).eq(0), false: verts.position1.sub(verts.position2).length(), true: index().mul(-0.1)}).output as Socket<'FLOAT'>
        const paths = n.ShortestEdgePaths({endVertex: index().eq(2), edgeCost: cost})
        const g = store(attributed(testMeshes()), 'POINT', 'next', paths.nextVertexIndex)
        return store(g, 'POINT', 'cost', paths.totalCost)
    })
    add('shortest-paths-none', 'No end vertex: next is the index, cost zero', () => {
        const paths = n.ShortestEdgePaths()
        return store(store(grid(), 'POINT', 'next', paths.nextVertexIndex), 'EDGE', 'cost', paths.totalCost)
    })
    add('edge-paths-selection', 'Edge Paths to Selection from shortest paths, start vertices every 5th, on edges and points', () => {
        const paths = n.ShortestEdgePaths({endVertex: index().eq(17)})
        const sel = n.EdgePathsToSelection({startVertices: mod(index(), 5).eq(0), nextVertexIndex: paths.nextVertexIndex})
        return store(store(grid(), 'EDGE', 'sel', sel.selection), 'POINT', 'sel_p', sel.selection)
    })
    add('edge-paths-curves', 'Edge Paths to Curves: shortest paths, a loop through next indices, out-of-range indices', () => {
        const paths = n.ShortestEdgePaths({endVertex: index().eq(17)})
        const a = n.EdgePathsToCurves({mesh: attributed(grid()), startVertices: mod(index(), 4).eq(1), nextVertexIndex: paths.nextVertexIndex}).curves
        // A cycle (i -> i + 1 mod 6 on the first six) and an out-of-range jump.
        const next = n.Switch({inputType: 'INT', switch: index().lt(6), false: index().add(100), true: mod(index().add(1), 6)}).output as Socket<'INT'>
        const b = n.EdgePathsToCurves({mesh: grid(), startVertices: index().lt(8), nextVertexIndex: next}).curves
        return n.JoinGeometry({geometry: [a, b]}).geometry
    })
    add('face-groups', 'Edges to Face Groups and Face Group Boundaries on every domain', () => {
        const groups = n.EdgesToFaceGroups({boundaryEdges: mod(index(), 3).eq(0)}).faceGroupID
        let g = store(attributed(testMeshes()), 'FACE', 'group', groups)
        g = store(g, 'POINT', 'group_p', groups)
        const boundaries = n.FaceGroupBoundaries({faceGroupID: mod(index(), 3)}).boundaryEdges
        g = store(g, 'EDGE', 'boundary', boundaries)
        g = store(g, 'FACE', 'boundary_f', boundaries)
        return store(g, 'EDGE', 'single', n.FaceGroupBoundaries({faceGroupID: 2}).boundaryEdges)
    })
    return cases
}
