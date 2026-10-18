/**
 * Compare (`FunctionNodeCompare`) - `nodes/function/nodes/node_fn_compare.cc`: declaration :44-83 (the A/B
 * sockets take the node's data type, so their identifiers are `A`/`B` for every type), `node_init` :95,
 * functions `get_multi_function` :239-691, the operation coercion of `data_type_update` :699-725.
 *
 * STRING and data-block (Object, Collection, Material, Image) comparisons are single-value functions over
 * `std::string` / `ID *` (:636-688); they are evaluated in {@link compareSingleValues}.
 */

import {f32} from '../../blender/f32'
import {dot3, length3} from '../../blender/math/vec'
import {MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import type {IDRef, SocketType} from '../../runtime/types'
import {colormanagementLuminance, elementwiseBool} from '../util'
import {angleV3V3} from '../../blender/math/vec'

const FLOAT_TYPES = new Set(['FLOAT', 'VECTOR', 'RGBA'])
const DATA_BLOCK_TYPES = new Set(['OBJECT', 'IMAGE', 'COLLECTION', 'MATERIAL', 'FONT', 'SOUND'])

/**
 * The operation Blender keeps after `data_type_update` (`node_fn_compare.cc:699-725`): setting the data
 * type coerces an operation the type does not offer to EQUAL. A stored node never holds another combination.
 */
export function compareOperation(dataType: string, operation: string): string {
    const colorOps = operation === 'BRIGHTER' || operation === 'DARKER'
    const eqOps = operation === 'EQUAL' || operation === 'NOT_EQUAL'
    if (dataType === 'RGBA' && !eqOps && !colorOps) return 'EQUAL'
    if ((dataType === 'STRING' || DATA_BLOCK_TYPES.has(dataType)) && !eqOps) return 'EQUAL'
    if (dataType !== 'RGBA' && colorOps) return 'EQUAL'
    return operation
}

/** `component_average` (`node_fn_compare.cc:207`). */
const componentAverage = (a: number[]) => f32(f32(f32(a[0] + a[1]) + a[2]) / 3)

type V = number[]
const cmpF: Record<string, (a: number, b: number) => boolean> = {
    LESS_THAN: (a, b) => a < b,
    LESS_EQUAL: (a, b) => a <= b,
    GREATER_THAN: (a, b) => a > b,
    GREATER_EQUAL: (a, b) => a >= b,
}

function floatFunction(op: string): MultiFunction {
    // :248-288.
    if (op === 'EQUAL') return elementwiseBool('Equal', ['float', 'float', 'float'], (a, b, e) => Math.abs(f32(a[0] - b[0])) <= e[0])
    if (op === 'NOT_EQUAL') return elementwiseBool('Not Equal', ['float', 'float', 'float'], (a, b, e) => Math.abs(f32(a[0] - b[0])) > e[0])
    const c = cmpF[op]
    return elementwiseBool(op, ['float', 'float'], (a, b) => c(a[0], b[0]))
}

function intFunction(op: string): MultiFunction {
    // :289-325.
    if (op === 'EQUAL') return elementwiseBool('Equal', ['int32', 'int32'], (a, b) => a[0] === b[0])
    if (op === 'NOT_EQUAL') return elementwiseBool('Not Equal', ['int32', 'int32'], (a, b) => a[0] !== b[0])
    const c = cmpF[op]
    return elementwiseBool(op, ['int32', 'int32'], (a, b) => c(a[0], b[0]))
}

function vectorFunction(op: string, mode: string): MultiFunction {
    const v2 = ['float3', 'float3'] as const
    const v3 = ['float3', 'float3', 'float'] as const
    const v4 = ['float3', 'float3', 'float', 'float'] as const
    if (op === 'EQUAL' || op === 'NOT_EQUAL') {
        const eq = op === 'EQUAL'
        // :484-583. Note DOT_PRODUCT NOT_EQUAL uses `>=` (:549).
        switch (mode) {
        case 'AVERAGE': return elementwiseBool(`${op} - Average`, v3, (a, b, e) => {
            const d = Math.abs(f32(componentAverage(a) - componentAverage(b)))
            return eq ? d <= e[0] : d > e[0]
        })
        case 'DOT_PRODUCT': return elementwiseBool(`${op} - Dot Product`, v4, (a, b, c, e) => {
            const d = Math.abs(f32(dot3(a, b) - c[0]))
            return eq ? d <= e[0] : d >= e[0]
        })
        case 'DIRECTION': return elementwiseBool(`${op} - Direction`, v4, (a, b, angle, e) => {
            const d = Math.abs(f32(angleV3V3(a, b) - angle[0]))
            return eq ? d <= e[0] : d > e[0]
        })
        case 'ELEMENT': return elementwiseBool(`${op} - Element-wise`, v3, (a, b, e) => eq
            ? Math.abs(f32(a[0] - b[0])) <= e[0] && Math.abs(f32(a[1] - b[1])) <= e[0] && Math.abs(f32(a[2] - b[2])) <= e[0]
            : Math.abs(f32(a[0] - b[0])) > e[0] || Math.abs(f32(a[1] - b[1])) > e[0] || Math.abs(f32(a[2] - b[2])) > e[0])
        case 'LENGTH': return elementwiseBool(`${op} - Length`, v3, (a, b, e) => {
            const d = Math.abs(f32(length3(a) - length3(b)))
            return eq ? d <= e[0] : d > e[0]
        })
        }
        throw new Error(`procedural: Compare mode ${mode} is not supported`)
    }
    // :327-483.
    const c = cmpF[op]
    if (!c) throw new Error(`procedural: Compare operation ${op} is not supported for vectors`)
    switch (mode) {
    case 'AVERAGE': return elementwiseBool(`${op} - Average`, v2, (a, b) => c(componentAverage(a), componentAverage(b)))
    case 'DOT_PRODUCT': return elementwiseBool(`${op} - Dot Product`, v3, (a, b, k) => c(dot3(a, b), k[0]))
    case 'DIRECTION': return elementwiseBool(`${op} - Direction`, v3, (a, b, angle) => c(angleV3V3(a, b), angle[0]))
    case 'ELEMENT': return elementwiseBool(`${op} - Element-wise`, v2, (a, b) => c(a[0], b[0]) && c(a[1], b[1]) && c(a[2], b[2]))
    case 'LENGTH': return elementwiseBool(`${op} - Length`, v2, (a, b) => c(length3(a), length3(b)))
    }
    throw new Error(`procedural: Compare mode ${mode} is not supported`)
}

function colorFunction(op: string): MultiFunction {
    // :589-635. Equality ignores alpha.
    const c3 = ['float4', 'float4', 'float'] as const
    switch (op) {
    case 'EQUAL': return elementwiseBool('Equal', c3, (a: V, b: V, e: V) =>
        Math.abs(f32(a[0] - b[0])) <= e[0] && Math.abs(f32(a[1] - b[1])) <= e[0] && Math.abs(f32(a[2] - b[2])) <= e[0])
    case 'NOT_EQUAL': return elementwiseBool('Not Equal', c3, (a: V, b: V, e: V) =>
        Math.abs(f32(a[0] - b[0])) > e[0] || Math.abs(f32(a[1] - b[1])) > e[0] || Math.abs(f32(a[2] - b[2])) > e[0])
    case 'BRIGHTER': return elementwiseBool('Brighter', ['float4', 'float4'], (a, b) => colormanagementLuminance(a) > colormanagementLuminance(b))
    case 'DARKER': return elementwiseBool('Darker', ['float4', 'float4'], (a, b) => colormanagementLuminance(a) < colormanagementLuminance(b))
    }
    throw new Error(`procedural: Compare operation ${op} is not supported for colors`)
}

const cache = new Map<string, MultiFunction>()

/** `get_multi_function` (`node_fn_compare.cc:239`) for the field data types. */
export function compareFunction(dataType: string, operation: string, mode: string): MultiFunction {
    const op = compareOperation(dataType, operation)
    const key = `${dataType}:${op}:${dataType === 'VECTOR' ? mode : ''}`
    let fn = cache.get(key)
    if (!fn) {
        switch (dataType) {
        case 'FLOAT': fn = floatFunction(op); break
        case 'INT': fn = intFunction(op); break
        case 'VECTOR': fn = vectorFunction(op, mode); break
        case 'RGBA': fn = colorFunction(op); break
        default: throw new Error(`procedural: Compare of ${dataType} is not a field function (node_fn_compare.cc:636-688 compares single values)`)
        }
        cache.set(key, fn)
    }
    return fn
}

/**
 * STRING (`:636-656`, `std::string ==`) and data-block (`:657-688`, `DEG_get_original(a) == DEG_get_original(b)`,
 * here: same ID type and name, or both empty) comparisons.
 */
export function compareSingleValues(dataType: string, operation: string, a: string | IDRef | null, b: string | IDRef | null): boolean {
    const op = compareOperation(dataType, operation)
    let equal: boolean
    if (dataType === 'STRING') {
        equal = a === b
    } else if (DATA_BLOCK_TYPES.has(dataType)) {
        const x = a as IDRef | null, y = b as IDRef | null
        equal = x === y || (!!x && !!y && x._ref === y._ref && x.name === y.name)
    } else {
        throw new Error(`procedural: Compare of ${dataType} is a field function`)
    }
    if (op === 'EQUAL') return equal
    if (op === 'NOT_EQUAL') return !equal
    throw new Error(`procedural: Compare operation ${op} is not supported for ${dataType}`)
}

registerNodeType({
    idname: 'FunctionNodeCompare',
    label: 'Compare',
    // `node_init` (:95-102).
    properties: {operation: 'GREATER_THAN', data_type: 'FLOAT', mode: 'ELEMENT'},
    declare(b, node) {
        // :44-83.
        const dataType = node.prop<string>('data_type')
        const operation = compareOperation(dataType, node.prop<string>('operation'))
        const mode = node.prop<string>('mode')
        if (dataType === 'FONT' || dataType === 'SOUND') throw new Error(`procedural: Compare of ${dataType} needs ${dataType} sockets, which the runtime does not have`)
        const type = dataType as SocketType
        const isVector = dataType === 'VECTOR'
        const a = b.input(type, 'A')
        const bb = b.input(type, 'B')
        // `b.add_input(data_type, ...)` uses the type's declaration default (`NOD_socket_declarations.hh`).
        if (dataType === 'RGBA') {
            a.default([0.8, 0.8, 0.8, 1])
            bb.default([0.8, 0.8, 0.8, 1])
        }
        if (isVector && mode === 'DOT_PRODUCT') b.input('FLOAT', 'C').default(0.9)
        if (isVector && mode === 'DIRECTION') b.input('FLOAT', 'Angle').default(0.0872665).subtype('ANGLE')
        if (FLOAT_TYPES.has(dataType) && (operation === 'EQUAL' || operation === 'NOT_EQUAL')) b.input('FLOAT', 'Epsilon').default(0.001)
        b.output('BOOLEAN', 'Result')
    },
    multiFunction(node) {
        return compareFunction(node.prop<string>('data_type'), node.prop<string>('operation'), node.prop<string>('mode'))
    },
})
