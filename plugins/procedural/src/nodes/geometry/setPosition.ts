/**
 * Set Position (`GeometryNodeSetPosition`) - `nodes/geometry/nodes/node_geo_set_position.cc` (declaration
 * :20, `set_points_position` :45, `set_curves_position` :58, `set_instances_position` :106,
 * `node_geo_exec` :127).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {captureFieldsOnGeometry, FieldContext, FieldEvaluation, FieldOperation, GField, lookupMultiFunction} from '../../fields'
import {AttributeFieldInput} from '../../fields/inputs'
import {calculateBezierAutoHandles} from '../../geometry/curvesEdit'
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
            // `set_curves_position` (:58): handles move with their point, then Bezier auto handles are recalculated.
            if (curves.attributes.has('handle_right') && curves.attributes.has('handle_left')) {
                // `try_capture_fields_on_geometry` evaluates every field before writing any of them
                // (`geometry_fields.cc:1083`), so the handle deltas read the old positions.
                const sub = lookupMultiFunction('float3 - float3')
                const delta = new FieldOperation(sub, [position, GField.fromInput(new AttributeFieldInput('position', 'float3'))]).output(0)
                const names = ['position', 'handle_left', 'handle_right']
                const fields: GField[] = [position, ...names.slice(1).map(n =>
                    new FieldOperation(add, [GField.fromInput(new AttributeFieldInput(n, 'float3')), delta]).output(0))]
                const n = curves.pointsNum
                const e = new FieldEvaluation(new FieldContext('curves', curves, AttrDomain.Point), n)
                const sel = e.evaluate(selection)
                const values = fields.map(f => e.evaluate(f))
                names.forEach((name, i) => {
                    const data = curves.attributes.get(name)!.data
                    for (let p = 0; p < n; p++) {
                        if (!sel.get(p, 0)) continue
                        for (let k = 0; k < 3; k++) data[p * 3 + k] = values[i].get(p, k)
                    }
                })
            } else {
                captureFieldsOnGeometry(geometry, 'curves', ['position'], AttrDomain.Point, selection, [position])
            }
            calculateBezierAutoHandles(curves)
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


