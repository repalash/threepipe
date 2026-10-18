/**
 * Socket declarations - the subset of `nodes/NOD_node_declaration.hh` / `NOD_socket_declarations.hh`
 * the runtime needs: identifier, type, default, range, multi-input, availability, and the implicit
 * field an unlinked input stands for (`default_input_type`, e.g. Position on Set Position).
 *
 * Each node type declares its sockets as a function of its properties, as Blender's dynamic
 * declarations do (`node_declare` reading `node.storage`).
 */

import type {SocketType} from './types'

/** `NodeDefaultInputType` (`NOD_node_declaration.hh`): the field an unlinked hidden input reads. */
export type ImplicitInput = 'POSITION' | 'INDEX' | 'ID_OR_INDEX' | 'NORMAL' | 'INSTANCE_TRANSFORM' | 'HANDLE_LEFT' | 'HANDLE_RIGHT'

/** Blender's structure type of a socket value: single value only, field allowed, or inferred. */
export type Structure = 'single' | 'field' | 'dynamic' | 'geometry' | 'list'

export interface SocketDecl {
    identifier: string
    name: string
    type: SocketType
    default?: number | number[] | boolean | string
    min?: number
    max?: number
    subtype?: string
    multiInput?: boolean
    hideValue?: boolean
    /** `false` when the declaration makes the socket unavailable for the current properties. */
    available: boolean
    implicitInput?: ImplicitInput
    structure: Structure
}

export interface Declaration {
    inputs: SocketDecl[]
    outputs: SocketDecl[]
}

/** Fluent builder close to `NodeDeclarationBuilder` (`b.add_input<decl::Float>("Value").default_value(0.5f)`). */
export class DeclarationBuilder {
    readonly decl: Declaration = {inputs: [], outputs: []}

    input(type: SocketType, name: string, identifier = name): SocketBuilder {
        const s: SocketDecl = {identifier, name, type, available: true, structure: defaultStructure(type), default: declDefault(type)}
        this.decl.inputs.push(s)
        return new SocketBuilder(s)
    }

    output(type: SocketType, name: string, identifier = name): SocketBuilder {
        const s: SocketDecl = {identifier, name, type, available: true, structure: defaultStructure(type)}
        this.decl.outputs.push(s)
        return new SocketBuilder(s)
    }
}

/**
 * The default value of each socket declaration class before `.default_value()` (`NOD_socket_declarations.hh`:
 * Float 0 :34, Int 0 :64, Vector 0 :94, Bool false :162, Color (0.8, 0.8, 0.8, 1) :185, Rotation identity
 * Euler :209, String "" :251).
 */
function declDefault(type: SocketType): SocketDecl['default'] {
    switch (type) {
    case 'FLOAT': case 'INT': return 0
    case 'BOOLEAN': return false
    case 'VECTOR': return [0, 0, 0]
    case 'RGBA': return [0.8, 0.8, 0.8, 1]
    case 'ROTATION': return [0, 0, 0]
    case 'STRING': return ''
    default: return undefined
    }
}

function defaultStructure(type: SocketType): Structure {
    switch (type) {
    case 'FLOAT': case 'INT': case 'BOOLEAN': case 'VECTOR': case 'RGBA': case 'ROTATION': case 'MATRIX':
        return 'dynamic'
    case 'GEOMETRY':
        return 'geometry'
    default:
        return 'single'
    }
}

export class SocketBuilder {
    constructor(readonly s: SocketDecl) {}

    default(v: SocketDecl['default']): this {
        this.s.default = v
        return this
    }

    min(v: number): this {
        this.s.min = v
        return this
    }

    max(v: number): this {
        this.s.max = v
        return this
    }

    subtype(v: string): this {
        this.s.subtype = v
        return this
    }

    multiInput(): this {
        this.s.multiInput = true
        return this
    }

    hideValue(): this {
        this.s.hideValue = true
        return this
    }

    /** `default_input_type(...)`: unlinked, the input is this field. Implies a hidden value. */
    implicit(field: ImplicitInput): this {
        this.s.implicitInput = field
        this.s.hideValue = true
        return this
    }

    /** `.available(false)` / `make_available` rules computed by the node. */
    available(v: boolean): this {
        this.s.available = v
        return this
    }

    /** Only a single value is accepted (`StructureType::Single`, e.g. counts, seeds of some nodes). */
    single(): this {
        this.s.structure = 'single'
        return this
    }

    /** A list (`StructureType::List`): unlinked, there is no list. */
    list(): this {
        this.s.structure = 'list'
        return this
    }

    /** A field evaluated on the node's geometry (`field_on_all()`, `evaluated_geometry_field()`). */
    field(): this {
        this.s.structure = 'field'
        return this
    }
}

/** The data type of a field-capable socket type. */
export function socketDataType(type: SocketType): import('../geometry/dataTypes').DataType | undefined {
    switch (type) {
    case 'FLOAT': return 'float'
    case 'INT': return 'int32'
    case 'BOOLEAN': return 'bool'
    case 'VECTOR': return 'float3'
    case 'RGBA': return 'float4'
    case 'ROTATION': return 'quaternion'
    case 'MATRIX': return 'float4x4'
    default: return undefined
    }
}

/** `bke::socket_type_to_custom_data_type` inverse: attribute data type to socket type. */
export function dataTypeSocket(type: import('../geometry/dataTypes').DataType): SocketType {
    switch (type) {
    case 'float': return 'FLOAT'
    case 'int32': case 'int8': return 'INT'
    case 'bool': return 'BOOLEAN'
    case 'float3': return 'VECTOR'
    case 'float4': case 'byteColor': return 'RGBA'
    case 'quaternion': return 'ROTATION'
    case 'float4x4': return 'MATRIX'
    case 'float2': return 'VECTOR'
    default: throw new Error(`procedural: no socket type for attribute type ${type}`)
    }
}
