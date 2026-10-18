/**
 * Parity cases for Raycast (`node_geo_raycast.cc`): rays from a grid onto the test meshes straight down, at an
 * angle per point, axis-aligned in each direction, limited by Ray Length, with a zero direction, a single ray, and the
 * Attribute output interpolated and from the nearest corner for several types.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

/** Ray origins: a grid above the test meshes (points of a mesh, so fields run per point). */
function origins(): Socket<'GEOMETRY'> {
    const grid = n.MeshGrid({sizeX: 9, sizeY: 11, verticesX: 19, verticesY: 23}).mesh
    return n.MeshToPoints({mesh: n.TransformGeometry({geometry: grid, translation: [0.4, 0.6, 4], rotation: [0.05, -0.03, 0.2]}).geometry}).points
}

type Ray = ReturnType<typeof n.Raycast>

function storeRay(points: Socket<'GEOMETRY'>, r: Ray, attribute = false): Socket<'GEOMETRY'> {
    let g = store(points, 'POINT', 'hit', r.isHit)
    g = store(g, 'POINT', 'p', r.hitPosition)
    g = store(g, 'POINT', 'no', r.hitNormal)
    g = store(g, 'POINT', 'd', r.hitDistance)
    return attribute ? store(g, 'POINT', 'a', r.attribute) : g
}

export function raycastCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    add('raycast-down', 'Straight down onto the test meshes', () => storeRay(origins(), n.Raycast({targetGeometry: testMeshes()})))
    add('raycast-angled', 'A direction per point (not normalized: the node normalizes it)', () =>
        storeRay(origins(), n.Raycast({targetGeometry: testMeshes(), rayDirection: n.CombineXYZ({x: n.Math({operation: 'SINE', value: index()}).value, y: 0.3, z: -2}).vector})))
    for (const [name, dir] of [['x', [1, 0, 0]], ['neg-y', [0, -1, 0]], ['diagonal', [1, 1, -1]]] as const) {
        add(`raycast-axis-${name}`, `Rays along ${name} from inside and around the meshes`, () => {
            const pts = n.MeshToPoints({mesh: n.TransformGeometry({geometry: n.MeshGrid({sizeX: 8, sizeY: 8, verticesX: 9, verticesY: 9}).mesh, translation: [-3.5, 0.5, 0.4], rotation: [1.2, 0.4, 0]}).geometry}).points
            return storeRay(pts, n.Raycast({targetGeometry: testMeshes(), rayDirection: [...dir]}))
        })
    }
    add('raycast-length', 'Ray Length per point cuts some rays short', () =>
        storeRay(origins(), n.Raycast({targetGeometry: testMeshes(), rayLength: n.Math({operation: 'MULTIPLY', value: index(), value1: 0.02}).value})))
    add('raycast-zero-direction', 'A zero direction (normalizes to zero)', () =>
        storeRay(origins(), n.Raycast({targetGeometry: testMeshes(), rayDirection: [0, 0, 0]})))
    add('raycast-single', 'One ray from a single origin: single outputs', () =>
        storeRay(n.MeshLine({count: 2}).mesh, n.Raycast({targetGeometry: testMeshes(), sourcePosition: [0.3, 0.4, 5], rayDirection: [0.05, 0, -1]})))
    for (const interpolation of ['Interpolated', 'Nearest'] as const) {
        for (const [dataType, value] of [['FLOAT', () => n.Math({operation: 'MULTIPLY', value: index(), value1: 0.37}).value],
            ['FLOAT_VECTOR', () => n.Position().position], ['INT', () => index()]] as const) {
            add(`raycast-attribute-${interpolation.toLowerCase()}-${dataType.toLowerCase()}`, `Attribute ${dataType} ${interpolation}`, () =>
                storeRay(origins(), n.Raycast({targetGeometry: attributed(testMeshes()), dataType, attribute: value(), interpolation} as never) as Ray, true))
        }
    }
    add('raycast-no-faces', 'A target without faces: an error and default outputs', () =>
        storeRay(origins(), n.Raycast({targetGeometry: n.MeshLine({count: 3}).mesh})))
    return cases
}
