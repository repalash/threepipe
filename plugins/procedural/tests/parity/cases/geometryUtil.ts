/**
 * Parity cases for Rename Attribute (single and prefix, overwrite, built-ins that cannot be renamed, missing names),
 * Get Geometry Component, Set Geometry Name, Warning (pass-through) and Instance Bounds (geometry, object and empty
 * references, radius).
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const str = (string: string) => n.String({string}).string

export function geometryUtilCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, SHAPE_SCENE, build))

    add('rename-single', 'Rename Attribute (single): plain, onto an existing name with and without overwrite, built-ins, missing', () => {
        let g = attributed(testMeshes())
        g = n.RenameAttribute({geometry: g, old: str('pf'), new: str('renamed')}).geometry
        g = n.RenameAttribute({geometry: g, old: str('pi'), new: str('pv')}).geometry
        g = n.RenameAttribute({geometry: g, old: str('ei'), new: str('fv'), overwrite: true}).geometry
        g = n.RenameAttribute({geometry: g, old: str('position'), new: str('p2')}).geometry
        g = n.RenameAttribute({geometry: g, old: str('fb'), new: str('sharp_face')}).geometry
        g = n.RenameAttribute({geometry: g, old: str('cf'), new: str('sharp_edge')}).geometry
        return n.RenameAttribute({geometry: g, old: str('missing'), new: str('x')}).geometry
    })
    add('rename-prefix', 'Rename Attribute (prefix) across a mesh, a point cloud and instances', () => {
        const pts = store(n.MeshToPoints({mesh: n.MeshGrid({verticesX: 3, verticesY: 2}).mesh}).points, 'POINT', 'p_extra', index())
        const inst = store(n.InstanceOnPoints({points: n.MeshLine({count: 3}).mesh, instance: n.MeshCube().mesh}).instances, 'INSTANCE', 'p_inst', index())
        const all = n.JoinGeometry({geometry: [attributed(testMeshes()), pts, inst]}).geometry
        return n.RenameAttribute({geometry: all, mode: 'Prefix', old: str('p'), new: str('q_')}).geometry
    })
    add('get-component', 'Get Geometry Component of each type, kept and removed, joined back with Exists stored', () => {
        const all = n.JoinGeometry({geometry: [testMeshes(), n.MeshToPoints({mesh: n.MeshGrid().mesh}).points, n.CurveCircle({resolution: 4}).curve]}).geometry
        const curve = n.GetGeometryComponent({geometry: all, type: 'Curve'})
        const mesh = n.GetGeometryComponent({geometry: curve.geometry, type: 'Mesh', remove: false})
        const inst = n.GetGeometryComponent({geometry: all, type: 'Instances'})
        const flagged = store(store(mesh.component, 'POINT', 'curve_exists', curve.exists), 'POINT', 'inst_exists', inst.exists)
        const named = n.SetGeometryName({geometry: mesh.geometry, name: str('rest')}).geometry
        return n.JoinGeometry({geometry: [flagged, named, curve.component]}).geometry
    })
    add('warning-and-bounds', 'Warning passes Show through; Instance Bounds of geometry, empty and point cloud references', () => {
        const show = n.Warning({show: true, message: str('hi')}).show
        const refs = n.GeometryToInstance({geometry: [n.MeshCube({size: [1, 2, 3]}).mesh, n.MeshToPoints({mesh: n.MeshGrid({sizeX: 4}).mesh, radius: 0.3}).points]}).instances
        const empty = n.GeometryToInstance({geometry: [n.MeshLine({count: 0}).mesh]}).instances
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 5}).mesh, instance: n.JoinGeometry({geometry: [refs, empty]}).geometry,
            pickInstance: true, instanceIndex: mod(index(), 3)}).instances
        let g = store(inst, 'INSTANCE', 'min_r', n.InstanceBounds().min)
        g = store(g, 'INSTANCE', 'max_r', n.InstanceBounds().max)
        g = store(g, 'INSTANCE', 'max', n.InstanceBounds({useRadius: false}).max)
        return store(g, 'INSTANCE', 'show', show)
    })
    add('instance-reference', 'Instance Reference: the reference index of each instance, after picking instances', () => {
        const refs = n.GeometryToInstance({geometry: [n.MeshCube().mesh, n.MeshCone().mesh, n.MeshGrid().mesh]}).instances
        const inst = n.InstanceOnPoints({points: n.MeshLine({count: 7}).mesh, instance: refs, pickInstance: true, instanceIndex: mod(index().mul(5), 3)}).instances
        return store(inst, 'INSTANCE', 'ref', n.InstanceReference().referenceIndex)
    })
    return cases
}
