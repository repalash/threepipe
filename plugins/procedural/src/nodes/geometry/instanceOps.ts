/**
 * Instances to Points (`node_geo_instances_to_points.cc`) and Rotate Instances (`node_geo_rotate_instances.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {f32} from '../../blender/f32'
import {mat3ToEuler, mat4Multiply, quatToMat3, transformPoint} from '../../blender/math/matrix'
import {mat3FromAxisAngle, mat3Multiply, mat4FromMat3} from '../../blender/math/matrix3'
import {normalize3} from '../../blender/math/vec'
import {FieldContext, FieldEvaluation} from '../../fields'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {Instances, PointCloud} from '../../geometry/components'
import {ComponentType} from '../../geometry/GeometrySet'
import {registerNodeType} from '../../runtime/registry'

function evaluateOnInstances(instances: Instances, fields: Parameters<FieldEvaluation['evaluate']>[0][]) {
    const n = instances.instancesNum
    const e = new FieldEvaluation(new FieldContext('instances', instances, AttrDomain.Instance), n)
    return fields.map(f => e.evaluate(f))
}

registerNodeType({
    idname: 'GeometryNodeInstancesToPoints',
    label: 'Instances to Points',
    // `node_declare` (:16).
    declare(b) {
        b.input('GEOMETRY', 'Instances')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('VECTOR', 'Position').implicit('POSITION').field()
        b.input('FLOAT', 'Radius').default(0.05).min(0).subtype('DISTANCE').field()
        b.output('GEOMETRY', 'Points')
    },
    // `node_geo_exec` (:112) and `convert_instances_to_points` (:36).
    execute(p) {
        const geometry = p.geometry('Instances')
        const instances = geometry.instances
        // `has_instances()`: at least one instance; otherwise the output is empty (`set_default_remaining_outputs`).
        if (!instances || instances.instancesNum < 1) return
        const [sel, positions, radii] = evaluateOnInstances(instances, [p.field('Selection'), p.field('Position'), p.field('Radius')])
        const selection: number[] = []
        for (let i = 0; i < instances.instancesNum; i++) if (sel.get(i)) selection.push(i)
        if (selection.length) {
            const pc = new PointCloud(selection.length)
            const pos = pc.positions
            selection.forEach((s, d) => { for (let k = 0; k < 3; k++) pos[d * 3 + k] = positions.get(s, k) })
            const dst = pc.accessor()
            if (radii.isSingle) {
                dst.add('radius', AttrDomain.Point, 'float', [radii.single[0]])
            } else {
                const r = new Float32Array(selection.length)
                selection.forEach((s, d) => { r[d] = radii.get(s) })
                dst.add('radius', AttrDomain.Point, 'float', r)
            }
            // :76: every instance attribute except built-ins the point cloud lacks and position/radius.
            const src = instances.accessor()
            for (const name of src.names()) {
                if (src.isBuiltin(name) && !dst.isBuiltin(name)) continue
                if (name === 'position' || name === 'radius') continue
                const layer = instances.attributes.get(name)!
                const type = layer.type as DataType
                const c = DATA_TYPES[type].components
                const data = new DATA_TYPES[type].array(selection.length * c)
                selection.forEach((s, d) => { for (let k = 0; k < c; k++) data[d * c + k] = layer.data[s * c + k] })
                dst.add(name, AttrDomain.Point, type, data)
            }
            geometry.setPointCloud(pc)
        }
        // `keep_only({PointCloud, Edit})`.
        for (const type of ['mesh', 'curves', 'instances'] as ComponentType[]) geometry.remove(type)
        p.set('Points', geometry)
    },
})

registerNodeType({
    idname: 'GeometryNodeRotateInstances',
    label: 'Rotate Instances',
    // `node_declare` (:15).
    declare(b) {
        b.input('GEOMETRY', 'Instances')
        b.output('GEOMETRY', 'Instances')
        b.input('BOOLEAN', 'Selection').default(true).hideValue().field()
        b.input('ROTATION', 'Rotation').field()
        b.input('VECTOR', 'Pivot Point').subtype('TRANSLATION').field()
        b.input('BOOLEAN', 'Local Space').default(true).field()
    },
    // `node_geo_exec` (:95) and `rotate_instances` (:34).
    execute(p) {
        const geometry = p.geometry('Instances')
        const instances = geometry.instancesForWrite()
        if (instances) {
            const [sel, rotations, pivots, locals] = evaluateOnInstances(instances,
                [p.field('Selection'), p.field('Rotation'), p.field('Pivot Point'), p.field('Local Space')])
            const t = instances.transforms
            for (let i = 0; i < instances.instancesNum; i++) {
                if (!sel.get(i)) continue
                const pivot = [pivots.get(i, 0), pivots.get(i, 1), pivots.get(i, 2)]
                const q = [rotations.get(i, 0), rotations.get(i, 1), rotations.get(i, 2), rotations.get(i, 3)]
                const m = t.slice(i * 16, i * 16 + 16)
                let rotation: Float32Array
                let usedPivot: number[]
                if (locals.get(i)) {
                    // :62-79: rotations about the instance's own (normalised) axes by the Euler angles, Z * Y * X.
                    const euler = mat3ToEuler(quatToMat3(q))
                    const rx = mat3FromAxisAngle(normalize3([m[0], m[1], m[2]]), euler[0])
                    const ry = mat3FromAxisAngle(normalize3([m[4], m[5], m[6]]), euler[1])
                    const rz = mat3FromAxisAngle(normalize3([m[8], m[9], m[10]]), euler[2])
                    rotation = mat4FromMat3(mat3Multiply(mat3Multiply(rz, ry), rx))
                    usedPivot = [0, 0, 0]
                    transformPoint(m, pivot[0], pivot[1], pivot[2], usedPivot)
                } else {
                    usedPivot = pivot
                    rotation = mat4FromMat3(quatToMat3(q))
                }
                // :86-90.
                for (let k = 0; k < 3; k++) m[12 + k] = f32(m[12 + k] - usedPivot[k])
                const r = mat4Multiply(rotation, m)
                for (let k = 0; k < 3; k++) r[12 + k] = f32(r[12 + k] + usedPivot[k])
                t.set(r, i * 16)
            }
        }
        p.set('Instances', geometry)
    },
})
