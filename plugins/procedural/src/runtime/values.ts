/**
 * Socket values: what flows along links. Field-capable sockets carry a {@link GField} (single values
 * are constant fields, Blender's `SocketValueVariant`); geometry sockets carry a {@link GeometrySet};
 * strings and menus a string; ID sockets an {@link IDRef} or null.
 */

import {DATA_TYPES, DataType} from '../geometry/dataTypes'
import {GeometrySet} from '../geometry/GeometrySet'
import {convertElement, isConvertible} from '../geometry/typeConversions'
import {FieldConstant, FieldOperation, GField, MultiFunction} from '../fields/field'
import {AttributeFieldInput, IDAttributeFieldInput, IndexFieldInput, NormalFieldInput} from '../fields/inputs'
import {eulerToQuat} from '../blender/math/matrix'
import {ImplicitInput, SocketDecl, socketDataType} from './declaration'
import type {IDRef, JSONValue, SocketType} from './types'

export type SocketValue = GField | GeometrySet | string | IDRef | null

export function isField(v: unknown): v is GField {
    return v instanceof GField
}

/** A JSON socket default turned into a value of `type` (`bNodeSocketValue*` → `SocketValueVariant`). */
export function valueFromJSON(type: SocketType, v: JSONValue | undefined): SocketValue {
    const dt = socketDataType(type)
    if (dt) {
        let comps: number[]
        if (v === undefined || v === null) comps = [...DATA_TYPES[dt].defaultValue]
        else if (typeof v === 'boolean') comps = [v ? 1 : 0]
        else if (typeof v === 'number') comps = [v]
        else if (Array.isArray(v)) comps = v
        else throw new Error(`procedural: cannot use ${JSON.stringify(v)} as a ${type} value`)
        if (type === 'ROTATION') {
            // Rotation sockets store an Euler (`bNodeSocketValueRotation::value_euler`).
            comps = comps.length === 4 ? comps : eulerToQuat(comps.length === 3 ? comps : [0, 0, 0])
        }
        if (type === 'MATRIX' && comps.length !== 16) comps = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        if (type === 'VECTOR' && comps.length === 2) comps = [comps[0], comps[1], 0]
        if (type === 'RGBA' && comps.length === 3) comps = [comps[0], comps[1], comps[2], 1]
        if (comps.length !== DATA_TYPES[dt].components) {
            throw new Error(`procedural: ${JSON.stringify(v)} is not a ${type} value (${DATA_TYPES[dt].components} components)`)
        }
        return GField.constant(dt, comps)
    }
    switch (type) {
    case 'GEOMETRY': return new GeometrySet()
    case 'STRING': case 'MENU': return v === undefined || v === null ? '' : String(v)
    case 'OBJECT': case 'COLLECTION': case 'MATERIAL': case 'IMAGE':
        if (v && typeof v === 'object' && !Array.isArray(v)) return v
        return null
    default:
        return null
    }
}

/** The field an unlinked implicit input stands for (`NodeDefaultInputType`). */
export function implicitField(kind: ImplicitInput): GField {
    switch (kind) {
    case 'POSITION': return GField.fromInput(new AttributeFieldInput('position', 'float3'))
    case 'INDEX': return GField.fromInput(new IndexFieldInput())
    case 'ID_OR_INDEX': return GField.fromInput(new IDAttributeFieldInput())
    case 'NORMAL': return GField.fromInput(new NormalFieldInput())
    case 'INSTANCE_TRANSFORM': return GField.fromInput(new AttributeFieldInput('instance_transform', 'float4x4'))
    case 'HANDLE_LEFT': return GField.fromInput(new AttributeFieldInput('handle_left', 'float3'))
    case 'HANDLE_RIGHT': return GField.fromInput(new AttributeFieldInput('handle_right', 'float3'))
    }
}

/** The value of an unlinked input socket: its implicit field, its stored value, or its declared default. */
export function unlinkedInputValue(decl: SocketDecl, stored: JSONValue | undefined): SocketValue {
    if (decl.implicitInput) return implicitField(decl.implicitInput)
    return valueFromJSON(decl.type, stored !== undefined ? stored : decl.default as JSONValue | undefined)
}

const conversionFns = new Map<string, MultiFunction>()

function conversionFn(from: DataType, to: DataType): MultiFunction {
    const key = `${from}->${to}`
    let fn = conversionFns.get(key)
    if (!fn) {
        fn = {
            name: `Convert ${key}`,
            inputs: [from],
            outputs: [to],
            call(size, ins, outs) {
                const src = ins[0].isSingle ? ins[0].single : ins[0].materialize()
                for (let i = 0; i < size; i++) convertElement(from, to, src, ins[0].isSingle ? 0 : i, outs[0], i)
            },
        }
        conversionFns.set(key, fn)
    }
    return fn
}

const converted = new WeakMap<GField, Map<DataType, GField>>()

/**
 * `LazyFunctionForImplicitConversion` (`geometry_nodes_lazy_function.cc:573`): a field converted to
 * another data type. Cached per source field so repeated pulls return the same object, which keeps
 * the evaluator's identity-based caching intact.
 */
export function convertField(field: GField, to: DataType): GField {
    if (field.type === to) return field
    let m = converted.get(field)
    if (!m) converted.set(field, m = new Map())
    let out = m.get(to)
    if (!out) {
        if (field.node instanceof FieldConstant) {
            const dst = new DATA_TYPES[to].array(DATA_TYPES[to].components)
            convertElement(field.type, to, field.node.value, 0, dst, 0)
            out = GField.constant(to, Array.from(dst))
        } else {
            out = new FieldOperation(conversionFn(field.type, to), [field]).output(0)
        }
        m.set(to, out)
    }
    return out
}

/**
 * The value of a link from a socket of type `from` into one of type `to`, or undefined when Blender
 * would mark the link invalid (`bke::node_link_is_valid`, implicit conversions only between
 * field-capable types; otherwise equal types).
 */
export function convertLinkValue(value: SocketValue, from: SocketType, to: SocketType): SocketValue | undefined {
    if (from === to) return value
    const a = socketDataType(from), b = socketDataType(to)
    if (a && b && value instanceof GField) {
        if (!isConvertible(a, b)) return undefined
        return convertField(value, b)
    }
    if ((from === 'MENU' && to === 'STRING') || (from === 'STRING' && to === 'MENU')) return undefined
    return undefined
}
