/**
 * Parity cases for Geometry Proximity (`node_geo_proximity.cc`): every target element type on meshes with n-gons,
 * loose edges and loose vertices, group ids (with a sample group that does not exist), point cloud targets, a mesh
 * and a point cloud together, a single sample position, and an empty target.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

/** Sample points around the test meshes: a grid lifted and turned so the queries hit every kind of element. */
function samples(): Socket<'GEOMETRY'> {
    const grid = n.MeshGrid({sizeX: 9, sizeY: 11, verticesX: 10, verticesY: 13}).mesh
    return n.MeshToPoints({mesh: n.TransformGeometry({geometry: grid, translation: [0.4, 0.6, 0.35], rotation: [0.3, 0.2, 0.1]}).geometry}).points
}

function storeProximity(points: Socket<'GEOMETRY'>, p: {position: Socket<'VECTOR'>, distance: Socket<'FLOAT'>, isValid: Socket<'BOOLEAN'>}): Socket<'GEOMETRY'> {
    let g = store(points, 'POINT', 'p', p.position)
    g = store(g, 'POINT', 'd', p.distance)
    return store(g, 'POINT', 'v', p.isValid)
}

export function proximityCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>, scene = true) =>
        cases.push(meshCase(id, description, scene ? SHAPE_SCENE : {}, build))

    for (const target of ['POINTS', 'EDGES', 'FACES'] as const) {
        add(`proximity-${target.toLowerCase()}`, `Nearest ${target.toLowerCase()} of the test meshes`, () =>
            storeProximity(samples(), n.GeometryProximity({targetElement: target, geometry: testMeshes()})))
        add(`proximity-${target.toLowerCase()}-groups`, `${target} in groups by index % 3, sampled with group index % 4 (group 3 is empty)`, () =>
            storeProximity(samples(), n.GeometryProximity({targetElement: target, geometry: testMeshes(), groupID: mod(index(), 3), sampleGroupID: mod(index(), 4)})))
    }
    const cloud = () => n.MeshToPoints({mesh: n.MeshCube({size: [2, 1.5, 1], verticesX: 3, verticesY: 4, verticesZ: 2}).mesh}).points
    add('proximity-pointcloud', 'Point cloud target (Points)', () =>
        storeProximity(samples(), n.GeometryProximity({targetElement: 'POINTS', geometry: cloud()})), false)
    for (const target of ['POINTS', 'FACES'] as const) {
        add(`proximity-mesh-and-points-${target.toLowerCase()}`, `Mesh and point cloud together (${target}: points only count for Points)`, () =>
            storeProximity(samples(), n.GeometryProximity({targetElement: target, geometry: n.JoinGeometry({geometry: [testMeshes(), cloud()]}).geometry})))
    }
    add('proximity-single', 'A single sample position: single outputs', () =>
        storeProximity(n.MeshLine({count: 2}).mesh, n.GeometryProximity({targetElement: 'FACES', geometry: testMeshes(), sourcePosition: [0.3, -0.7, 1.9]})))
    add('proximity-empty', 'No mesh or point cloud in the target: default outputs', () =>
        storeProximity(samples(), n.GeometryProximity({geometry: n.CurveLine().curve})), false)
    return cases
}
