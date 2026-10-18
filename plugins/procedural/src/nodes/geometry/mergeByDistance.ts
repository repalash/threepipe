/**
 * Merge by Distance (`node_geo_merge_by_distance.cc`): point clouds through `point_merge_by_distance`
 * (`src/geometry/pointMerge.ts`), meshes through the weld code of `mesh_merge_verts.cc`
 * (`src/geometry/meshMergeVerts.ts`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation} from '../../fields'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {meshMergeByDistanceAll, meshMergeByDistanceConnected} from '../../geometry/meshMergeVerts'
import {pointMergeByDistance} from '../../geometry/pointMerge'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeMergeByDistance',
    label: 'Merge by Distance',
    // `node_declare` (:33).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        // Menu values are the item names (`mode_items` :17: All, Connected).
        b.input('MENU', 'Mode').default('All')
        b.input('FLOAT', 'Distance').default(0.001).min(0).subtype('DISTANCE')
    },
    // `node_geo_exec` (:95).
    execute(p) {
        const mode = p.string('Mode')
        if (mode !== 'All' && mode !== 'Connected') throw new Error(`Merge by Distance: mode '${mode}' is not a menu item`)
        const selectionField = p.field('Selection')
        const distance = p.float('Distance')
        const out = foreachRealGeometry(p.geometry('Geometry'), g => {
            const pc = g.pointCloud
            if (pc && mode === 'All') {
                // `pointcloud_merge_by_distance` (:47).
                const sel = new FieldEvaluation(new FieldContext('pointcloud', pc, AttrDomain.Point), pc.pointsNum).evaluate(selectionField)
                const selection: number[] = []
                for (let i = 0; i < pc.pointsNum; i++) if (sel.get(i)) selection.push(i)
                if (selection.length) g.setPointCloud(pointMergeByDistance(pc, distance, selection))
            }
            const mesh = g.mesh
            if (mesh) {
                const sel = new FieldEvaluation(new FieldContext('mesh', mesh, AttrDomain.Point), mesh.vertsNum).evaluate(selectionField)
                let result
                if (mode === 'All') {
                    // `mesh_merge_by_distance_all` (:74).
                    const selection: number[] = []
                    for (let i = 0; i < mesh.vertsNum; i++) if (sel.get(i)) selection.push(i)
                    result = selection.length ? meshMergeByDistanceAll(mesh, selection, distance) : undefined
                } else {
                    // `mesh_merge_by_distance_connected` (:63).
                    const bools = new Uint8Array(mesh.vertsNum)
                    for (let i = 0; i < mesh.vertsNum; i++) bools[i] = sel.get(i) ? 1 : 0
                    result = meshMergeByDistanceConnected(mesh, bools, distance)
                }
                if (result) g.setMesh(result)
            }
        }, p.options.scene)
        p.set('Geometry', out)
    },
})
