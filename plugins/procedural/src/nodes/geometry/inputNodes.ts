/**
 * Simple input nodes: Radius, Curve Tilt, Is Spline Cyclic, Spline Resolution (built-in attribute fields,
 * `node_geo_input_radius.cc` & co.), Instance Rotation / Scale / Transform (`node_geo_input_instance_*.cc`), Is Viewport
 * (`node_geo_is_viewport.cc`), Self Object (`node_geo_self_object.cc`) and the ID inputs Object, Collection, Material,
 * Image (`node_geo_input_object.cc` & co.: the node's ID pointer, `node.id`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {mat3FromMat4, mat3ToQuat, mat4ToScale, normalizeAndGetSize3} from '../../blender/math/matrix'
import {AttributeFieldInput, FieldContext, FieldInput, GField} from '../../fields'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'
import type {SocketType} from '../../runtime/types'

for (const [idname, label, out, type, attribute, dataType] of [
    // `AttributeFieldInput::get_field<float, "radius">()`; the output's own default (1.0) is only its socket value.
    ['GeometryNodeInputRadius', 'Radius', 'Radius', 'FLOAT', 'radius', 'float'],
    ['GeometryNodeInputCurveTilt', 'Curve Tilt', 'Tilt', 'FLOAT', 'tilt', 'float'],
    ['GeometryNodeInputSplineCyclic', 'Is Spline Cyclic', 'Cyclic', 'BOOLEAN', 'cyclic', 'bool'],
    ['GeometryNodeInputSplineResolution', 'Spline Resolution', 'Resolution', 'INT', 'resolution', 'int32'],
    // `node_geo_input_instance_reference.cc`: `AttributeFieldInput::get_field<int, ".reference_index">()`.
    ['GeometryNodeInputInstanceReference', 'Instance Reference', 'Reference Index', 'INT', '.reference_index', 'int32'],
] as const) {
    registerNodeType({
        idname,
        label,
        declare(b) {
            const o = b.output(type as SocketType, out).field()
            if (idname === 'GeometryNodeInputRadius') o.default(1)
        },
        execute(p) {
            p.set(out, GField.fromInput(new AttributeFieldInput(attribute, dataType)))
        },
    })
}

/** `bke::InstancesFieldInput`: per-instance values from the transforms; undefined outside instance contexts. */
class InstanceTransformInput extends FieldInput {
    constructor(readonly what: 'rotation' | 'scale' | 'transform') {
        super(what === 'rotation' ? 'quaternion' : what === 'scale' ? 'float3' : 'float4x4', `Instance ${what}`)
    }

    key(): string {
        return `instance:${this.what}`
    }

    getVArray(context: FieldContext): GVArray | undefined {
        const inst = context.instances
        if (!inst || context.domain !== AttrDomain.Instance) return undefined
        const t = inst.transforms, n = inst.instancesNum
        if (this.what === 'transform') return GVArray.fromArray('float4x4', Float32Array.from(t.subarray(0, n * 16)))
        const c = this.what === 'rotation' ? 4 : 3
        const out = new Float32Array(n * c)
        for (let i = 0; i < n; i++) {
            const m = t.subarray(i * 16, i * 16 + 16)
            // `math::to_quaternion(math::normalize(transform))` / `math::to_scale<true>(transform)`.
            out.set(this.what === 'rotation' ? mat3ToQuat(normalizeAndGetSize3(mat3FromMat4(m)).m) : mat4ToScale(m, true), i * c)
        }
        return GVArray.fromArray(this.what === 'rotation' ? 'quaternion' : 'float3', out)
    }
}

for (const [idname, label, out, type, what] of [
    ['GeometryNodeInputInstanceRotation', 'Instance Rotation', 'Rotation', 'ROTATION', 'rotation'],
    ['GeometryNodeInputInstanceScale', 'Instance Scale', 'Scale', 'VECTOR', 'scale'],
    ['GeometryNodeInstanceTransform', 'Instance Transform', 'Transform', 'MATRIX', 'transform'],
] as const) {
    registerNodeType({
        idname,
        label,
        declare(b) {
            b.output(type, out).field()
        },
        execute(p) {
            p.set(out, GField.fromInput(new InstanceTransformInput(what)))
        },
    })
}

registerNodeType({
    idname: 'GeometryNodeIsViewport',
    label: 'Is Viewport',
    declare(b) {
        b.output('BOOLEAN', 'Is Viewport')
    },
    // `DEG_get_mode(depsgraph) == DAG_EVAL_VIEWPORT`: evaluations here are viewport ones unless `render` is set.
    execute(p) {
        p.set('Is Viewport', GField.constant('bool', [p.options.render ? 0 : 1]))
    },
})

registerNodeType({
    idname: 'GeometryNodeSelfObject',
    label: 'Self Object',
    declare(b) {
        b.output('OBJECT', 'Self Object')
    },
    execute(p) {
        const name = p.options.selfObject
        if (name) p.set('Self Object', {_ref: 'OBJECT', name})
    },
})

for (const [idname, label, out, type, prop] of [
    ['GeometryNodeInputObject', 'Object', 'Object', 'OBJECT', 'object'],
    ['GeometryNodeInputCollection', 'Collection', 'Collection', 'COLLECTION', 'collection'],
    ['GeometryNodeInputMaterial', 'Material', 'Material', 'MATERIAL', 'material'],
    ['GeometryNodeInputImage', 'Image', 'Image', 'IMAGE', 'image'],
] as const) {
    registerNodeType({
        idname,
        label,
        properties: {[prop]: null},
        declare(b) {
            b.output(type, out)
        },
        execute(p) {
            const ref = p.node.prop(prop) as {_ref?: string, name?: string} | null
            if (ref && typeof ref === 'object' && ref.name) p.set(out, {_ref: type, name: ref.name})
        },
    })
}
