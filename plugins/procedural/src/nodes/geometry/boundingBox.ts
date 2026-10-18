/** Bounding Box (`node_geo_bounding_box.cc`). */

import {GField} from '../../fields'
import {computeBoundboxWithoutInstances} from '../../geometry/meshBounds'
import {foreachRealGeometry} from '../../geometry/joinGeometries'
import {createCuboidMesh} from '../../geometry/meshPrimitives'
import {transformMesh} from '../../geometry/transform'
import {f32} from '../../blender/f32'
import {ComponentType} from '../../geometry/GeometrySet'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeBoundBox',
    label: 'Bounding Box',
    // `node_declare` (:11).
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Use Radius').default(true)
        b.output('GEOMETRY', 'Bounding Box')
        b.output('VECTOR', 'Min')
        b.output('VECTOR', 'Max')
    },
    // `node_geo_exec` (:24).
    execute(p) {
        const geometry = p.geometry('Geometry')
        const useRadius = p.bool('Use Radius')
        const bounds = computeBoundboxWithoutInstances(geometry, useRadius)
        p.set('Min', GField.constant('float3', bounds ? bounds.min : [0, 0, 0]))
        p.set('Max', GField.constant('float3', bounds ? bounds.max : [0, 0, 0]))
        if (!p.outputUsed('Bounding Box')) return
        // A box per real geometry, instanced ones included (:44).
        const out = foreachRealGeometry(geometry, g => {
            const sub = computeBoundboxWithoutInstances(g, useRadius)
            if (!sub) {
                for (const t of ['mesh', 'pointcloud', 'curves', 'instances'] as ComponentType[]) g.remove(t)
                return
            }
            const scale = [0, 1, 2].map(k => f32(sub.max[k] - sub.min[k]))
            const center = [0, 1, 2].map(k => f32(sub.min[k] + f32(scale[k] / 2)))
            const mesh = createCuboidMesh(scale, 2, 2, 2, 'uv_map')
            transformMesh(mesh, center, [1, 0, 0, 0], [1, 1, 1])
            g.setMesh(mesh)
            for (const t of ['pointcloud', 'curves', 'instances'] as ComponentType[]) g.remove(t)
        }, p.options.scene)
        p.set('Bounding Box', out)
    },
})
