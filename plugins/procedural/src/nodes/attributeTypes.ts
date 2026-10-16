/**
 * RNA attribute type and domain names (`rna_enum_attribute_type_items`,
 * `rna_enum_attribute_domain_items`, `makesrna/intern/rna_attribute.cc`) and their mapping to this
 * package's data types and socket types (`bke::custom_data_type_to_socket_type`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import type {DataType} from '../geometry/dataTypes'
import type {SocketType} from '../runtime/types'

export const RNA_DATA_TYPES: Record<string, DataType> = {
    FLOAT: 'float', INT: 'int32', INT8: 'int8', FLOAT_VECTOR: 'float3', FLOAT2: 'float2', FLOAT_COLOR: 'float4',
    BYTE_COLOR: 'byteColor', BOOLEAN: 'bool', QUATERNION: 'quaternion', FLOAT4X4: 'float4x4', INT32_2D: 'int32x2',
    INT16_2D: 'int16x2',
}

export function dataTypeFromRNA(name: string): DataType {
    const t = RNA_DATA_TYPES[name]
    if (!t) throw new Error(`procedural: attribute data type ${name} is not supported`)
    return t
}

/** `bke::custom_data_type_to_socket_type` (`blenkernel/intern/node.cc`). */
export function socketTypeFromRNA(name: string): SocketType {
    switch (name) {
    case 'FLOAT': return 'FLOAT'
    case 'INT': case 'INT8': return 'INT'
    case 'FLOAT_VECTOR': case 'FLOAT2': return 'VECTOR'
    case 'FLOAT_COLOR': case 'BYTE_COLOR': return 'RGBA'
    case 'BOOLEAN': return 'BOOLEAN'
    case 'QUATERNION': return 'ROTATION'
    case 'FLOAT4X4': return 'MATRIX'
    case 'STRING': return 'STRING'
    default: throw new Error(`procedural: attribute data type ${name} has no socket type`)
    }
}

export const RNA_DOMAINS: Record<string, AttrDomain> = {
    POINT: AttrDomain.Point, EDGE: AttrDomain.Edge, FACE: AttrDomain.Face, CORNER: AttrDomain.Corner,
    CURVE: AttrDomain.Curve, INSTANCE: AttrDomain.Instance,
}

export function domainFromRNA(name: string): AttrDomain {
    const d = RNA_DOMAINS[name]
    if (d === undefined) throw new Error(`procedural: attribute domain ${name} is not supported`)
    return d
}

/** `bke::allow_procedural_attribute_access` (`blenkernel/intern/attribute_access.cc:208`). */
export function allowProceduralAttributeAccess(name: string): boolean {
    for (const p of ['.corner', '.edge', '.select', '.sculpt', '.hide', '.uv']) if (name.startsWith(p)) return false
    if (name === '.reference_index') return false
    // "." UV_PINNED_NAME "." with UV_PINNED_NAME "pn" (`BKE_customdata.hh:49`).
    if (name.startsWith('.pn.')) return false
    return true
}
