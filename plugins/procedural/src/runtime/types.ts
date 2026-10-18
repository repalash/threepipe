/**
 * The serialisable node-tree model every front end produces (the TS DSL, the Blender dump importer,
 * the parity-case importer) and the runtime evaluates. It mirrors `bNodeTree` as Python sees it
 * (`bl_idname`, socket identifiers, RNA property names), so a Blender dump maps onto it directly.
 */

export type SocketType =
    | 'GEOMETRY' | 'FLOAT' | 'INT' | 'BOOLEAN' | 'VECTOR' | 'RGBA' | 'ROTATION' | 'MATRIX'
    | 'STRING' | 'MENU' | 'OBJECT' | 'COLLECTION' | 'MATERIAL' | 'IMAGE' | 'TEXTURE'
    | 'BUNDLE' | 'CLOSURE' | 'CUSTOM'

/** `bl_socket_idname` → socket type (`NodeSocketFloat`, `NodeSocketFloatDistance`, ...). */
export function socketTypeFromIdname(idname: string): SocketType {
    const base = idname.replace(/^NodeSocket/, '')
    if (base.startsWith('Float')) return 'FLOAT'
    if (base.startsWith('Int')) return 'INT'
    if (base.startsWith('Bool')) return 'BOOLEAN'
    if (base.startsWith('Vector')) return 'VECTOR'
    if (base.startsWith('Color')) return 'RGBA'
    if (base.startsWith('Rotation')) return 'ROTATION'
    if (base.startsWith('Matrix')) return 'MATRIX'
    if (base.startsWith('String')) return 'STRING'
    if (base.startsWith('Menu')) return 'MENU'
    if (base.startsWith('Geometry')) return 'GEOMETRY'
    if (base.startsWith('Object')) return 'OBJECT'
    if (base.startsWith('Collection')) return 'COLLECTION'
    if (base.startsWith('Material')) return 'MATERIAL'
    if (base.startsWith('Image')) return 'IMAGE'
    if (base.startsWith('Texture')) return 'TEXTURE'
    if (base.startsWith('Bundle')) return 'BUNDLE'
    if (base.startsWith('Closure')) return 'CLOSURE'
    if (base === 'Virtual') return 'CUSTOM'
    throw new Error(`procedural: unknown socket type '${idname}'`)
}

/** A reference to a Blender ID (object, collection, material, image) by name. */
export interface IDRef {
    _ref: 'OBJECT' | 'COLLECTION' | 'MATERIAL' | 'IMAGE'
    name: string
}

export type JSONValue = number | boolean | string | null | number[] | IDRef

export interface InterfaceSocketJSON {
    itemType?: 'SOCKET'
    inOut: 'INPUT' | 'OUTPUT'
    name: string
    identifier: string
    socketType: string
    default?: JSONValue
    min_value?: number
    max_value?: number
    subtype?: string
    description?: string
    /** `default_input`: VALUE, or an implicit field (POSITION, INDEX, NORMAL, ID, ...). */
    default_input?: string
    hide_value?: boolean
    hide_in_modifier?: boolean
    /** `structure_type`: AUTO, SINGLE, FIELD, DYNAMIC, ... */
    structure_type?: string
    attribute_domain?: string
    default_attribute_name?: string
    menu_expanded?: boolean
    panel?: string
}

export interface InterfacePanelJSON {
    itemType: 'PANEL'
    name: string
    description?: string
    default_closed?: boolean
    panel?: string
}

export type InterfaceItemJSON = InterfaceSocketJSON | InterfacePanelJSON

export interface NodeJSON {
    name: string
    /** `bl_idname`, e.g. `ShaderNodeMath`, `GeometryNodeSetPosition`. */
    type: string
    /** RNA properties: `operation`, `data_type`, `domain`, ... */
    properties?: Record<string, JSONValue | JSONValue[]>
    /** Unlinked input values by socket identifier. */
    inputs?: Record<string, JSONValue>
    /** Dynamic item lists (`capture_items`, `repeat_items`, `enum_items`, ...). */
    items?: Record<string, Record<string, JSONValue>[]>
    /** Zone input nodes: the paired output node. */
    pairedOutput?: string
    /** Group nodes: the node group name. */
    group?: string
    mute?: boolean
    label?: string
    location?: [number, number]
    /** Color Ramp elements, as dumped (`colorRamp`). */
    colorRamp?: unknown
    /** Float Curve / Vector Curve mapping, as dumped (`curveMapping`). */
    curveMapping?: unknown
}

export interface LinkJSON {
    from: [string, string]
    to: [string, string]
    muted?: boolean
}

export interface NodeTreeJSON {
    name: string
    description?: string
    interface: InterfaceItemJSON[]
    nodes: NodeJSON[]
    /** For multi-input sockets, links are listed in evaluation order. */
    links: LinkJSON[]
}

export type NodeGroupLibrary = Record<string, NodeTreeJSON>

export function isInterfaceSocket(item: InterfaceItemJSON): item is InterfaceSocketJSON {
    return item.itemType !== 'PANEL'
}
