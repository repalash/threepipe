/**
 * Parity cases for Flip Faces (corner attributes of every type reversed with the winding, normals after), Separate
 * Components, Set Point Radius and Set Instance Transform (fields with selections, instanced point clouds).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index

export function geometryOpCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    add('flip-faces', 'Flip Faces on every other face: corner attributes, edges and normals follow', () => {
        const flipped = n.FlipFaces({mesh: attributed(testMeshes()), selection: mod(index(), 2).eq(0)}).mesh
        return store(store(flipped, 'FACE', 'nf', n.Normal().normal), 'POINT', 'nv', n.Normal().normal)
    })
    add('flip-faces-all-instanced', 'Flip Faces reaches meshes inside instances', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: attributed(testMeshes())}).instances
        return n.RealizeInstances({geometry: n.FlipFaces({mesh: inst}).mesh}).geometry
    })
    add('separate-components', 'Separate Components, joined back in another order', () => {
        const all = n.JoinGeometry({geometry: [testMeshes(), n.MeshToPoints({mesh: n.MeshGrid().mesh}).points, n.CurveCircle({resolution: 4}).curve,
            n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: n.MeshCube().mesh}).instances]}).geometry
        const s = n.SeparateComponents({geometry: all})
        return n.JoinGeometry({geometry: [s.instances, s.curve, s.pointCloud, s.mesh]}).geometry
    })
    add('set-point-radius', 'Set Point Radius with a selection, on a point cloud and an instanced one', () => {
        const pts = n.MeshToPoints({mesh: n.MeshGrid({verticesX: 4, verticesY: 3}).mesh}).points
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 2}).mesh, instance: pts}).instances
        const all = n.JoinGeometry({geometry: [pts, inst]}).geometry
        return n.RealizeInstances({geometry: n.SetPointRadius({points: all, radius: index().mul(0.01), selection: mod(index(), 3).lt(2)}).points}).geometry
    })
    add('set-instance-transform', 'Set Instance Transform from a matrix field, with a selection', () => {
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 4, offset: [1, 0, 0]}).mesh, instance: n.MeshCube({size: [0.2, 0.2, 0.2]}).mesh}).instances
        const m = n.CombineTransform({translation: n.CombineXYZ({x: index(), y: index().mul(0.5)}).vector, scale: [1, 2, 0.5]}).transform
        return n.SetInstanceTransform({instances: inst, transform: m, selection: index().gt(0)}).instances
    })
    return cases
}
