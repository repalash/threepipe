/**
 * Random Value (`FunctionNodeRandomValue`, `nodes/function/nodes/node_fn_random_value.cc`: dynamic
 * declaration :19, `node_init` :70, `node_build_multi_function` :131) and Hash Value
 * (`FunctionNodeHashValue`, `node_fn_hash_value.cc`: declaration :21, `node_init` :39,
 * `get_multi_function` :44, RNA items `node_rna` :149). Jenkins hashes of `blenlib/intern/noise.cc` (`src/blender/noise.ts`).
 *
 * The hash argument order differs per type and is kept: FLOAT and FLOAT_VECTOR hash `(seed, id[, axis])`,
 * INT hashes `(id, seed)`, BOOLEAN `(id, seed)`.
 */

import {f32} from '../../blender/f32'
import {evaluateConstantField} from '../../fields/evaluate'
import {hash1, hash2, hash4, hashFloat1, hashFloat3, hashFloat4, hashToFloat2, hashToFloat3} from '../../blender/noise'
import {elementwise, GField, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import type {SocketType} from '../../runtime/types'

/** `Random Vector` (:139): `float3(x, y, z) * (max - min) + min`. */
const randomVector = elementwise('Random Vector', ['float3', 'float3', 'int32', 'int32'], ['float3'], ([min, max, id, seed], [o]) => {
    for (let k = 0; k < 3; k++) {
        const r = hashToFloat3(seed[0], id[0], k)
        o[k] = f32(f32(r * f32(max[k] - min[k])) + min[k])
    }
})

/** `Random Float` (:152). */
const randomFloat = elementwise('Random Float', ['float', 'float', 'int32', 'int32'], ['float'], ([min, max, id, seed], [o]) => {
    const r = hashToFloat2(seed[0], id[0])
    o[0] = f32(f32(r * f32(max[0] - min[0])) + min[0])
})

/** `Random Int` (:163): unsigned range arithmetic, `hash(id, seed) % range`. */
const randomInt = elementwise('Random Int', ['int32', 'int32', 'int32', 'int32'], ['int32'], ([minV, maxV, id, seed], [o]) => {
    let min = minV[0], max = maxV[0]
    if (min > max) {
        const t = min
        min = max
        max = t
    }
    const hash = hash2(id[0], seed[0]) >>> 0
    const range = ((max >>> 0) - (min >>> 0) + 1) >>> 0
    const modulo = range === 0 ? hash : hash % range
    o[0] = ((min >>> 0) + modulo) | 0
})

/** `Random Bool` (:185): `hash_to_float(id, seed) <= probability`. */
const randomBool = elementwise('Random Bool', ['float', 'int32', 'int32'], ['bool'], ([p, id, seed], [o]) => {
    o[0] = hashToFloat2(id[0], seed[0]) <= p[0] ? 1 : 0
})

const RANDOM: Record<string, MultiFunction> = {FLOAT_VECTOR: randomVector, FLOAT: randomFloat, INT: randomInt, BOOLEAN: randomBool}
const RANDOM_SOCKET: Record<string, SocketType> = {FLOAT_VECTOR: 'VECTOR', FLOAT: 'FLOAT', INT: 'INT', BOOLEAN: 'BOOLEAN'}

registerNodeType({
    idname: 'FunctionNodeRandomValue',
    label: 'Random Value',
    properties: {data_type: 'FLOAT'},
    // `rna_enum_attribute_type_items` filtered by `random_value_type_supported` (`makesrna/intern/rna_nodetree.cc:2372`).
    enums: {data_type: ['FLOAT', 'INT', 'BOOLEAN', 'FLOAT_VECTOR']},
    declare(b, node) {
        const dataType = node.prop<string>('data_type')
        switch (dataType) {
        case 'FLOAT_VECTOR':
            b.input('VECTOR', 'Min')
            b.input('VECTOR', 'Max').default([1, 1, 1])
            break
        case 'FLOAT':
            b.input('FLOAT', 'Min')
            b.input('FLOAT', 'Max').default(1)
            break
        case 'INT':
            b.input('INT', 'Min')
            b.input('INT', 'Max').default(100)
            break
        case 'BOOLEAN':
            b.input('FLOAT', 'Probability').min(0).max(1).default(0.5).subtype('FACTOR')
            break
        default:
            throw new Error(`procedural: Random Value of ${dataType} is not a Blender data type for this node`)
        }
        // `structure_type(Dynamic)`, `default_input_type(NODE_DEFAULT_INPUT_ID_INDEX_FIELD)`.
        b.input('INT', 'ID').implicit('ID_OR_INDEX')
        b.input('INT', 'Seed')
        b.output(RANDOM_SOCKET[dataType], 'Value')
    },
    multiFunction: node => RANDOM[node.prop<string>('data_type')],
})

/**
 * `BLI_hash_string` (`blenlib/BLI_hash.h:69`) over the UTF-8 bytes. Blender builds with `-funsigned-char` on every
 * platform (`build_files/cmake/platform/platform_apple.cmake:161`, `platform_unix.cmake:898`, `platform_win32.cmake:207`).
 */
export function hashString(s: string): number {
    let i = 0
    for (const byte of new TextEncoder().encode(s)) {
        i = (Math.imul(i, 37) + byte) >>> 0
    }
    return i
}

const hashMF = (name: string, type: import('../../geometry/dataTypes').DataType, h: (v: number[]) => number) =>
    elementwise(name, [type, 'int32'], ['int32'], ([v, seed], [o]) => {
        o[0] = hash2(h(v), seed[0]) | 0
    })

/** `get_multi_function` (`node_fn_hash_value.cc:44-100`). */
const HASH: Record<string, MultiFunction> = {
    FLOAT: hashMF('Hash Float', 'float', v => hashFloat1(v[0])),
    VECTOR: hashMF('Hash Vector', 'float3', v => hashFloat3(v[0], v[1], v[2])),
    // `float4(ColorGeometry4f)`: r, g, b, a.
    RGBA: hashMF('Hash Color', 'float4', v => hashFloat4(v[0], v[1], v[2], v[3])),
    INT: hashMF('Hash Integer', 'int32', v => hash1(v[0])),
    // `float4(Quaternion)`: w, x, y, z (`BLI_math_quaternion_types.hh:77`).
    ROTATION: hashMF('Hash Rotation', 'quaternion', v => hashFloat4(v[0], v[1], v[2], v[3])),
    // `hash_float(const float4x4 &)` (`noise.cc:220`): the four column hashes.
    MATRIX: hashMF('Hash Matrix', 'float4x4', v => hash4(
        hashFloat4(v[0], v[1], v[2], v[3]), hashFloat4(v[4], v[5], v[6], v[7]),
        hashFloat4(v[8], v[9], v[10], v[11]), hashFloat4(v[12], v[13], v[14], v[15]))),
}

registerNodeType({
    idname: 'FunctionNodeHashValue',
    label: 'Hash Value',
    properties: {data_type: 'INT'},
    // `rna_enum_node_socket_data_type_items` filtered in `node_rna` (:149).
    enums: {data_type: ['FLOAT', 'INT', 'VECTOR', 'RGBA', 'ROTATION', 'MATRIX', 'STRING']},
    declare(b, node) {
        b.input(node.prop<string>('data_type') as SocketType, 'Value')
        b.input('INT', 'Seed')
        b.output('INT', 'Hash')
    },
    // "Hash String" (:67) is a function of `std::string`; strings are single values in this runtime.
    singleValueFunction(node) {
        if (node.prop<string>('data_type') !== 'STRING') return undefined
        // The evaluator rejects a field Seed here: Blender would build a string field (`socket_type_supports_fields`
        // includes SOCK_STRING, `nodes/intern/node_socket.cc:656`), which this runtime does not have.
        return ([value, seed]) => {
            const s = evaluateConstantField(seed as GField)[0]
            return [GField.constant('int32', [hash2(hashString(typeof value === 'string' ? value : ''), s) | 0])]
        }
    },
    multiFunction(node) {
        const type = node.prop<string>('data_type')
        const fn = HASH[type]
        if (!fn) throw new Error(`procedural: Hash Value of ${type} is not supported`)
        return fn
    },
})

