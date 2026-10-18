/**
 * Parity cases for Split to Instances: every domain and component, partial selections, and many group IDs (negative,
 * large, colliding in the hash table) so the instance order exercises `blender::Map`'s slot order and growth.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

/** Split, then store the Group ID output on the instances. */
function split(geometry: Socket<'GEOMETRY'>, domain: 'POINT' | 'EDGE' | 'FACE' | 'CURVE' | 'INSTANCE', groupID: Socket<'INT' | 'FLOAT'> | number, selection?: Socket<'BOOLEAN'>): Socket<'GEOMETRY'> {
    const s = n.SplitToInstances({geometry, domain, groupID, selection})
    return store(s.instances, 'INSTANCE', 'group', s.groupID)
}

export function meshSplitCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, {...SHAPE_SCENE, materials: ['Mat']}, build))

    add('split-faces', 'Split faces into three groups, every fourth face unselected', () =>
        split(attributed(testMeshes()), 'FACE', mod(index(), 3), mod(index(), 4).eq(0).not()))
    add('split-edges-points', 'Split edges, and points (single group ID: one instance sharing nothing selected away)', () =>
        n.JoinGeometry({geometry: [split(attributed(testMeshes()), 'EDGE', mod(index(), 2).mul(5)), split(testMeshes(), 'POINT', 3)]}).geometry)
    add('split-many-groups', 'Split grid points into 23 groups with negative and large IDs: instance order is the hash map\'s', () => {
        const id = n.Math({operation: 'MULTIPLY', value: n.Math({operation: 'SUBTRACT', value: mod(index().mul(37), 23), value1: 11}).value, value1: 1000003}).value
        return split(n.MeshGrid({verticesX: 10, verticesY: 10}).mesh, 'POINT', id)
    })
    add('split-points-curves', 'Split a point cloud and curves (by point and by curve) together: shared group IDs merge', () => {
        const pts = n.MeshToPoints({mesh: n.MeshGrid({verticesX: 4, verticesY: 3}).mesh}).points
        const curves = n.JoinGeometry({geometry: [n.CurveCircle({resolution: 6}).curve, n.CurveLine().curve,
            n.ResampleCurve({curve: n.CurveLine({end: [0, 2, 1]}).curve, count: 4}).curve]}).geometry
        const c = n.SetMaterial({geometry: store(curves, 'POINT', 'pi', index()), material: {_ref: 'MATERIAL', name: 'Mat'}}).geometry
        const both = n.JoinGeometry({geometry: [pts, c]}).geometry
        return n.JoinGeometry({geometry: [split(both, 'POINT', mod(index(), 3)), split(c, 'CURVE', mod(index(), 2))]}).geometry
    })
    add('split-instances', 'Split instances by group: unused references removed per group', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 7, offset: [0.5, 0, 0]}).mesh,
            instance: n.GeometryToInstance({geometry: [n.MeshCube({size: [0.1, 0.1, 0.1]}).mesh, n.MeshCone().mesh, n.MeshGrid().mesh]}).instances,
            pickInstance: true, instanceIndex: index()}).instances
        return split(store(inst, 'INSTANCE', 'io', index()), 'INSTANCE', mod(index(), 3).mul(-2), index().lt(6))
    })
    return cases
}
