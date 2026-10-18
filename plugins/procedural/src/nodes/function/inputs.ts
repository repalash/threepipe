/**
 * Constant input nodes: `FunctionNodeInputInt` (`nodes/function/nodes/node_fn_input_int.cc`),
 * `FunctionNodeInputBool` (`node_fn_input_bool.cc`), `FunctionNodeInputVector` (`node_fn_input_vector.cc`),
 * `FunctionNodeInputColor` (`node_fn_input_color.cc`), `FunctionNodeInputRotation`
 * (`node_fn_input_rotation.cc`) and `ShaderNodeValue` (`nodes/shader/nodes/node_shader_value.cc`).
 * Each builds an `mf::CustomMF_Constant` of its stored value; RNA names from `makesrna/intern/rna_nodetree.cc`
 * (`def_fn_input_*` :5080-5166).
 */

import {DataType} from '../../geometry/dataTypes'
import {MultiFunction} from '../../fields/field'
import {eulerToQuat} from '../../blender/math/matrix'
import {registerNodeType} from '../../runtime/registry'
import type {JSONValue, NodeJSON} from '../../runtime/types'

/** `mf::CustomMF_Constant<T>` (`FN_multi_function_builder.hh`): no inputs, one output. */
export function constantFunction(type: DataType, value: readonly number[]): MultiFunction {
    return {
        name: `Constant ${type}`, inputs: [], outputs: [type],
        call(size, _ins, outs) {
            const c = value.length
            for (let i = 0; i < size; i++) for (let k = 0; k < c; k++) outs[0][i * c + k] = value[k]
        },
    }
}

const num = (v: JSONValue | JSONValue[], k = 0): number => {
    const x = Array.isArray(v) ? v[k] : v
    return typeof x === 'boolean' ? (x ? 1 : 0) : typeof x === 'number' ? x : 0
}

registerNodeType({
    idname: 'FunctionNodeInputInt',
    label: 'Integer',
    // `NodeInputInt::integer`, zero-initialised by `node_init` (`node_fn_input_int.cc` node_init).
    properties: {integer: 0},
    declare(b) {
        b.output('INT', 'Integer')
    },
    // `node_build_multi_function` (`node_fn_input_int.cc:40-45`).
    multiFunction: node => constantFunction('int32', [num(node.prop('integer'))]),
})

registerNodeType({
    idname: 'FunctionNodeInputBool',
    label: 'Boolean',
    properties: {boolean: false},
    declare(b) {
        b.output('BOOLEAN', 'Boolean')
    },
    // `node_build_multi_function` (`node_fn_input_bool.cc:39-44`).
    multiFunction: node => constantFunction('bool', [num(node.prop('boolean')) ? 1 : 0]),
})

registerNodeType({
    idname: 'FunctionNodeInputVector',
    label: 'Vector',
    // `NodeInputVector` (`DNA_node_types.h:3046`): `vector[4] = {}`, `dimensions = 3`; RNA `vector`,
    // `vector_dimensions` (`rna_nodetree.cc:5144`).
    properties: {vector: [0, 0, 0], vector_dimensions: 3},
    declare(b, node) {
        const dims = node.prop<number>('vector_dimensions')
        if (dims !== 3) throw new Error(`procedural: Vector input with ${dims} dimensions needs ${dims}D vector sockets, which the runtime does not have`)
        b.output('VECTOR', 'Vector')
    },
    // `node_build_multi_function` (`node_fn_input_vector.cc:51-72`), the 3D case.
    multiFunction(node) {
        const v = node.prop<number[]>('vector')
        return constantFunction('float3', [num(v, 0), num(v, 1), num(v, 2)])
    },
})

registerNodeType({
    idname: 'FunctionNodeInputColor',
    label: 'Color',
    // `node_init` (`node_fn_input_color.cc`): `copy_v4_fl4(data->color, 0.5f, 0.5f, 0.5f, 1.0f)`; RNA `value`.
    properties: {value: [0.5, 0.5, 0.5, 1]},
    declare(b) {
        b.output('RGBA', 'Color')
    },
    // `node_build_multi_function` (`node_fn_input_color.cc:27-33`).
    multiFunction(node) {
        const v = node.prop<number[]>('value')
        return constantFunction('float4', [num(v, 0), num(v, 1), num(v, 2), v.length > 3 ? num(v, 3) : 1])
    },
})

registerNodeType({
    idname: 'FunctionNodeInputRotation',
    label: 'Rotation',
    // `NodeInputRotation::rotation_euler`, zero-initialised; RNA `rotation_euler` (`rna_nodetree.cc:5132`).
    properties: {rotation_euler: [0, 0, 0]},
    declare(b) {
        b.output('ROTATION', 'Rotation')
    },
    // `node_build_multi_function` (`node_fn_input_rotation.cc:30-39`): `math::to_quaternion(EulerXYZ)`.
    multiFunction(node) {
        const e = node.prop<number[]>('rotation_euler')
        return constantFunction('quaternion', eulerToQuat([num(e, 0), num(e, 1), num(e, 2)]))
    },
})

/**
 * Output socket default values of a node. `ShaderNodeValue` keeps its value in its output socket
 * (`bNodeSocketValueFloat` of `outputs.first`); {@link NodeJSON} carries it as `outputs.Value`.
 */
type WithOutputs = NodeJSON & {outputs?: Record<string, JSONValue>}

registerNodeType({
    idname: 'ShaderNodeValue',
    label: 'Value',
    declare(b) {
        // `decl::Float` default 0 (`NOD_socket_declarations.hh:34`).
        b.output('FLOAT', 'Value').default(0)
    },
    // `sh_node_value_build_multi_function` (`node_shader_value.cc:46-52`).
    multiFunction(node) {
        const v = (node.json as WithOutputs).outputs?.Value
        return constantFunction('float', [v === undefined || v === null ? 0 : num(v)])
    },
})
