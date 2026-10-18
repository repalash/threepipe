/**
 * Set Position (`GeometryNodeSetPosition`) - `nodes/geometry/nodes/node_geo_set_position.cc` (declaration
 * :20, `set_points_position` :45, `set_curves_position` :58, `set_instances_position` :106,
 * `node_geo_exec` :127).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry, FieldContext, FieldEvaluation, FieldOperation, GField, lookupMultiFunction} from '../../fields'
import {registerNodeType} from '../../runtime/registry'

registerNodeType({
    idname: 'GeometryNodeSetPosition',
    label: 'Set Position',
    declare(b) {
        b.input('GEOMETRY', 'Geometry')
        b.output('GEOMETRY', 'Geometry')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Position').implicit('POSITION').field()
        b.input('VECTOR', 'Offset').subtype('TRANSLATION').field()
    },
    execute(p) {
        const geometry = p.geometry('Geometry')
        const selection = p.field('Selection')
        const add = lookupMultiFunction('float3 + float3')
        const position = new FieldOperation(add, [p.field('Position'), p.field('Offset')]).output(0)
        if (geometry.meshForWrite()) captureFieldsOnGeometry(geometry, 'mesh', ['position'], AttrDomain.Point, selection, [position])
        if (geometry.pointCloudForWrite()) captureFieldsOnGeometry(geometry, 'pointcloud', ['position'], AttrDomain.Point, selection, [position])
        const curves = geometry.curvesForWrite()
        if (curves) {
            // :58-80: handles move with their point; Bezier auto handles are then recalculated.
            const names = ['position']
            const fields: GField[] = [position]
            if (curves.attributes.has('handle_right') && curves.attributes.has('handle_left')) {
                throw new Error('procedural: Set Position on Bezier curves (handles, calculate_bezier_auto_handles) is not ported yet')
            }
            captureFieldsOnGeometry(geometry, 'curves', names, AttrDomain.Point, selection, fields)
        }
        const instances = geometry.instancesForWrite()
        if (instances) {
            // :106-125.
            const n = instances.instancesNum
            const e = new FieldEvaluation(new FieldContext('instances', instances, AttrDomain.Instance), n)
            const sel = e.evaluate(selection)
            const result = e.evaluate(position)
            const t = instances.transforms
            for (let i = 0; i < n; i++) {
                if (!sel.get(i, 0)) continue
                t[i * 16 + 12] = result.get(i, 0)
                t[i * 16 + 13] = result.get(i, 1)
                t[i * 16 + 14] = result.get(i, 2)
            }
        }
        p.set('Geometry', geometry)
    },
})


