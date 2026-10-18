/**
 * Vector Math (`ShaderNodeVectorMath`) - `nodes/shader/nodes/node_shader_vector_math.cc` (declaration :31,
 * availability `node_shader_update_vector_math` :264, `get_multi_function` :310), the operation table
 * `get_float3_math_operation_info` (`nodes/intern/math_functions.cc:199`) and the registered functions
 * (`functions/intern/multi_function_common.cc:363-512`, in `fields/commonFunctions.ts`).
 */

import {lookupMultiFunction} from '../../fields/commonFunctions'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'

/** `get_float3_math_operation_info` (`nodes/intern/math_functions.cc:199-274`): operation -> registered function name. */
const FUNCTION_NAMES: Record<string, string> = {
    ADD: 'float3 + float3', SUBTRACT: 'float3 - float3', MULTIPLY: 'float3 * float3', DIVIDE: 'float3 / float3',
    CROSS_PRODUCT: 'cross_product(float3, float3)', PROJECT: 'project(float3, float3)', REFLECT: 'reflect(float3, float3)',
    DOT_PRODUCT: 'dot_product(float3, float3)', DISTANCE: 'distance(float3, float3)', LENGTH: 'length(float3)',
    SCALE: 'float3 * float', NORMALIZE: 'normalize(float3)', SNAP: 'snap(float3, float3)', ROUND: 'round(float3)',
    FLOOR: 'floor(float3)', CEIL: 'ceil(float3)', MODULO: 'float3 % float3', FRACTION: 'frac(float3)', ABSOLUTE: 'abs(float3)',
    MINIMUM: 'min(float3, float3)', MAXIMUM: 'max(float3, float3)', WRAP: 'wrap(float3, float3, float3)', SINE: 'sin(float3)',
    COSINE: 'cos(float3)', TANGENT: 'tan(float3)', REFRACT: 'refract(float3, float3, float)',
    FACEFORWARD: 'faceforward(float3, float3, float3)', MULTIPLY_ADD: 'float3 * float3 + float3', POWER: 'float3 ** float3',
    SIGN: 'sign(float3)',
}

/** `get_multi_function` (`node_shader_vector_math.cc:310`). */
export function vectorMathFunction(operation: string): MultiFunction {
    const name = FUNCTION_NAMES[operation]
    if (!name) throw new Error(`procedural: Vector Math operation ${operation} is not supported`)
    return lookupMultiFunction(name)
}

const NO_B = new Set(['SINE', 'COSINE', 'TANGENT', 'CEIL', 'SCALE', 'FLOOR', 'LENGTH', 'ABSOLUTE', 'FRACTION', 'NORMALIZE', 'SIGN', 'ROUND'])
const USES_C = new Set(['WRAP', 'FACEFORWARD', 'MULTIPLY_ADD'])
const USES_SCALE = new Set(['SCALE', 'REFRACT'])
const VALUE_OUT = new Set(['LENGTH', 'DISTANCE', 'DOT_PRODUCT'])

registerNodeType({
    idname: 'ShaderNodeVectorMath',
    label: 'Vector Math',
    properties: {operation: 'ADD'},
    // rna_enum_node_vec_math_items (`makesrna/intern/rna_nodetree.cc`), in RNA order.
    enums: {
        operation: ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD', 'CROSS_PRODUCT', 'PROJECT', 'REFLECT', 'REFRACT',
            'FACEFORWARD', 'DOT_PRODUCT', 'DISTANCE', 'LENGTH', 'SCALE', 'NORMALIZE', 'ABSOLUTE', 'POWER', 'SIGN', 'MINIMUM',
            'MAXIMUM', 'ROUND', 'FLOOR', 'CEIL', 'FRACTION', 'MODULO', 'WRAP', 'SNAP', 'SINE', 'COSINE', 'TANGENT'],
    },
    declare(b, node) {
        // :31-92, availability :264-307.
        const op = node.prop<string>('operation')
        b.input('VECTOR', 'Vector').min(-10000).max(10000)
        b.input('VECTOR', 'Vector', 'Vector_001').min(-10000).max(10000).available(!NO_B.has(op))
        b.input('VECTOR', 'Vector', 'Vector_002').min(-10000).max(10000).available(USES_C.has(op))
        b.input('FLOAT', 'Scale').default(1).min(-10000).max(10000).available(USES_SCALE.has(op))
        b.output('VECTOR', 'Vector').available(!VALUE_OUT.has(op))
        b.output('FLOAT', 'Value').available(VALUE_OUT.has(op))
    },
    multiFunction: node => vectorMathFunction(node.prop<string>('operation')),
})
