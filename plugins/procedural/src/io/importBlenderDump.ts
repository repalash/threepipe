/**
 * Import of node-tree dumps written by Blender:
 * - v2: `porting/blender/dump_blend.py` (`format: "threepipe-procedural-dump/2"`): flat node groups,
 *   multi-input link order (`multi_input_sort_id`), modifier inputs, input/output geometry, the scene.
 * - v1: the March `proc` branch's `extract_geo_nodes.py` (`trees[]` with nested `sub_tree`). v1 has no
 *   multi-input sort ids; links into one multi-input socket are taken newest-first in list order,
 *   which is Blender's order only if the links were never reordered by hand.
 *
 * The result is a {@link NodeGroupLibrary} plus, per object, the modifier stack's group and inputs.
 */

import type {InterfaceItemJSON, InterfaceSocketJSON, JSONValue, LinkJSON, NodeGroupLibrary, NodeJSON, NodeTreeJSON} from '../runtime/types'
import {getNodeType, NodeInstance} from '../runtime/registry'
import type {ExpectedGeometry} from '../testing/compareGeometry'
import type {DumpReferenced} from './geometryFromDump'

/** A modifier input as dumped (`mod.properties.inputs.<identifier>`). */
export interface DumpModifierInput {
    name: string
    socketType?: string
    value?: JSONValue
    /** `VALUE`, `ATTRIBUTE`, ... (`GeometryNodesInputType`). */
    type?: string
    attribute_name?: string
}

export interface ImportedModifier {
    object: string
    name: string
    group: string
    enabled: boolean
    /** By interface identifier. */
    inputs: Record<string, DumpModifierInput>
}

export interface ImportedDump {
    blender: string
    library: NodeGroupLibrary
    modifiers: ImportedModifier[]
}

// region v2

interface V2Socket {
    identifier: string
    name: string
    type: string
    enabled?: boolean
    linked?: boolean
    default?: JSONValue
    multiInput?: boolean
}

interface V2Node {
    name: string
    type: string
    label?: string
    mute?: boolean
    location?: [number, number]
    properties?: Record<string, JSONValue>
    inputs?: V2Socket[]
    outputs?: V2Socket[]
    items?: Record<string, Record<string, JSONValue>[]>
    pairedOutput?: string
    group?: string
    colorRamp?: unknown
    curveMapping?: unknown
}

interface V2Link {
    from: [string, string]
    to: [string, string]
    muted?: boolean
    valid?: boolean
    sortId?: number
}

interface V2Tree {
    name: string
    description?: string
    interface: (Record<string, JSONValue> & {itemType: string, name: string})[]
    nodes: V2Node[]
    links: V2Link[]
}

export interface DumpV2 {
    format: string
    blender: string
    node_groups: Record<string, V2Tree>
    hash?: string
    blend_file?: string
    /** The scene's time for Scene Time (`frame_current_final`, `render.fps`, `render.fps_base`). */
    scene_time?: {ctime: number, fps: number, fpsBase: number}
    objects: {
        name: string
        type?: string
        matrix_world?: number[]
        modifiers: {name: string, type: string, enabled: boolean, nodeGroup: string | null, inputs: Record<string, DumpModifierInput> | null}[]
        /** Geometry entering the first enabled nodes modifier (`geometry_dump.py` format). */
        input_geometry?: ExpectedGeometry | null
        /** The evaluated object (all modifiers applied). */
        output_geometry?: ExpectedGeometry | null
    }[]
    referenced?: DumpReferenced
    /** Objects the depsgraph did not evaluate (their geometry is empty in Blender too). */
    unevaluated_objects?: string[]
}

function importInterfaceV2(items: V2Tree['interface']): InterfaceItemJSON[] {
    return items.map(item => {
        if (item.itemType !== 'SOCKET') {
            return {itemType: 'PANEL', name: item.name, description: item.description as string | undefined, panel: item.panel as string | undefined}
        }
        const {itemType: _t, inOut, identifier, socketType, ...rest} = item as Record<string, JSONValue>
        void _t
        return {...rest, inOut, identifier, socketType} as unknown as InterfaceSocketJSON
    })
}

/** Links in evaluation order: multi-input sockets newest first (`node_runtime.cc:141`). */
function orderLinks(links: V2Link[]): LinkJSON[] {
    const kept = links.filter(l => l.valid !== false)
    const bySocket = new Map<string, V2Link[]>()
    for (const l of kept) {
        const key = `${l.to[0]}\u0000${l.to[1]}`
        let g = bySocket.get(key)
        if (!g) bySocket.set(key, g = [])
        g.push(l)
    }
    const out: LinkJSON[] = []
    for (const group of bySocket.values()) {
        const sorted = group.length > 1 ? [...group].sort((a, b) => (b.sortId ?? 0) - (a.sortId ?? 0)) : group
        for (const l of sorted) out.push({from: l.from, to: l.to, muted: !!l.muted})
    }
    return out
}

function importTreeV2(t: V2Tree): NodeTreeJSON {
    return {
        name: t.name,
        description: t.description,
        interface: importInterfaceV2(t.interface),
        nodes: t.nodes.map((n): NodeJSON => {
            const inputs: Record<string, JSONValue> = {}
            for (const s of n.inputs ?? []) if (!s.linked && s.default !== undefined) inputs[s.identifier] = s.default
            const json: NodeJSON = {name: n.name, type: n.type, properties: n.properties ?? {}, inputs, mute: !!n.mute}
            if (n.label) json.label = n.label
            if (n.location) json.location = n.location
            if (n.items) json.items = n.items
            if (n.pairedOutput) json.pairedOutput = n.pairedOutput
            if (n.group) json.group = n.group
            if (n.colorRamp) json.colorRamp = n.colorRamp
            if (n.curveMapping) json.curveMapping = n.curveMapping
            if (n.type === 'NodeReroute' && !json.properties!.socket_idname) {
                const s = n.inputs?.[0]
                if (s) json.properties!.socket_idname = s.type
            }
            return json
        }),
        links: orderLinks(t.links),
    }
}

function importV2(d: DumpV2): ImportedDump {
    const library: NodeGroupLibrary = {}
    for (const [name, t] of Object.entries(d.node_groups)) library[name] = importTreeV2(t)
    const modifiers: ImportedModifier[] = []
    for (const o of d.objects) {
        for (const m of o.modifiers) {
            if (m.type !== 'NODES' || !m.nodeGroup) continue
            modifiers.push({object: o.name, name: m.name, group: m.nodeGroup, enabled: m.enabled, inputs: m.inputs ?? {}})
        }
    }
    return {blender: d.blender, library, modifiers}
}

// endregion

// region v1

interface V1Socket {
    name: string
    identifier: string
    bl_socket_idname?: string
    socket_type?: string
    is_linked?: boolean
    default_value?: JSONValue
}

interface V1Node {
    id: string
    bl_idname: string
    label?: string
    location?: [number, number]
    mute?: boolean
    properties?: Record<string, JSONValue>
    pointer_refs?: Record<string, JSONValue>
    inputs?: Record<string, V1Socket>
    outputs?: Record<string, V1Socket>
    sub_tree?: V1Tree | {name: string, _deduped: true}
    color_ramp?: {interpolation: string, color_mode: string, elements: {position: number, color: number[]}[]}
    curve_mapping?: {clip_min_x: number, clip_min_y: number, clip_max_x: number, clip_max_y: number, use_clip: boolean, curves: {points: {x: number, y: number, handle_type: string}[]}[]}
}

interface V1Tree {
    name: string
    nodes: V1Node[]
    links: {from_node: string, from_socket: string, to_node: string, to_socket: string}[]
    group_inputs: (Record<string, JSONValue> & {name: string, identifier: string})[]
    group_outputs: (Record<string, JSONValue> & {name: string, identifier: string})[]
}

export interface DumpV1 {
    blender_version: number[]
    trees: V1Tree[]
    modifiers: {object_name: string, modifier_name: string, node_group: string, input_overrides: Record<string, JSONValue>}[]
}

function v1Interface(t: V1Tree): InterfaceSocketJSON[] {
    const conv = (s: Record<string, JSONValue> & {name: string, identifier: string}, inOut: 'INPUT' | 'OUTPUT'): InterfaceSocketJSON => {
        const {bl_socket_idname, socket_type, default_value, ...rest} = s
        return {
            ...(rest as Record<string, JSONValue>), inOut, name: s.name, identifier: s.identifier,
            socketType: (bl_socket_idname || socket_type) as string, default: default_value,
        } as unknown as InterfaceSocketJSON
    }
    return [...t.group_inputs.map(s => conv(s, 'INPUT')), ...t.group_outputs.map(s => conv(s, 'OUTPUT'))]
}

function isMultiInput(n: V1Node, socket: string): boolean {
    const def = getNodeType(n.bl_idname)
    if (!def) return n.bl_idname === 'GeometryNodeJoinGeometry'
    try {
        return new NodeInstance({name: n.id, type: n.bl_idname, properties: n.properties}, def).decl.inputs.some(d => d.identifier === socket && d.multiInput)
    } catch {
        return false
    }
}

function importTreeV1(t: V1Tree, library: NodeGroupLibrary): void {
    if (library[t.name]) return
    const tree: NodeTreeJSON = {name: t.name, interface: v1Interface(t), nodes: [], links: []}
    library[t.name] = tree
    for (const n of t.nodes) {
        const inputs: Record<string, JSONValue> = {}
        for (const s of Object.values(n.inputs ?? {})) {
            if (!s.is_linked && s.default_value !== undefined && s.identifier !== '__extend__') inputs[s.identifier] = s.default_value
        }
        const json: NodeJSON = {name: n.id, type: n.bl_idname, properties: {...(n.properties ?? {})}, inputs, mute: !!n.mute, label: n.label, location: n.location}
        if (n.sub_tree) {
            json.group = n.sub_tree.name
            if (!('_deduped' in n.sub_tree)) importTreeV1(n.sub_tree as V1Tree, library)
        }
        if (n.color_ramp) {
            json.colorRamp = {interpolation: n.color_ramp.interpolation, colorMode: n.color_ramp.color_mode, elements: n.color_ramp.elements}
        }
        if (n.curve_mapping) {
            const m = n.curve_mapping
            json.curveMapping = {
                clipMinX: m.clip_min_x, clipMinY: m.clip_min_y, clipMaxX: m.clip_max_x, clipMaxY: m.clip_max_y, useClip: m.use_clip,
                curves: m.curves.map(c => ({points: c.points.map(p => ({location: [p.x, p.y], handleType: p.handle_type}))})),
            }
        }
        for (const [k, v] of Object.entries(n.pointer_refs ?? {})) if (k !== 'node_tree') json.properties![k] = v
        tree.nodes.push(json)
    }
    // v1 lists links without sort ids; reverse the links of each multi-input socket (newest first).
    const byNode = new Map(t.nodes.map(n => [n.id, n]))
    const groups = new Map<string, number[]>()
    const links: LinkJSON[] = t.links.map(l => ({from: [l.from_node, l.from_socket], to: [l.to_node, l.to_socket]}))
    links.forEach((l, i) => {
        const node = byNode.get(l.to[0])
        if (!node || !isMultiInput(node, l.to[1])) return
        const key = `${l.to[0]}\u0000${l.to[1]}`
        let g = groups.get(key)
        if (!g) groups.set(key, g = [])
        g.push(i)
    })
    for (const idx of groups.values()) {
        const rev = idx.map(i => links[i]).reverse()
        idx.forEach((pos, k) => { links[pos] = rev[k] })
    }
    tree.links = links
}

function importV1(d: DumpV1): ImportedDump {
    const library: NodeGroupLibrary = {}
    for (const t of d.trees) importTreeV1(t, library)
    const modifiers: ImportedModifier[] = d.modifiers.map(m => {
        const inputs: Record<string, DumpModifierInput> = {}
        const tree = library[m.node_group]
        for (const s of tree.interface) {
            if (s.itemType === 'PANEL' || (s as InterfaceSocketJSON).inOut !== 'INPUT') continue
            const id = (s as InterfaceSocketJSON).identifier
            const useAttr = m.input_overrides[`${id}_use_attribute`]
            inputs[id] = {
                name: s.name,
                socketType: (s as InterfaceSocketJSON).socketType,
                value: m.input_overrides[id],
                type: useAttr ? 'ATTRIBUTE' : 'VALUE',
                attribute_name: m.input_overrides[`${id}_attribute_name`] as string | undefined,
            }
        }
        return {object: m.object_name, name: m.modifier_name, group: m.node_group, enabled: true, inputs}
    })
    return {blender: d.blender_version.join('.'), library, modifiers}
}

// endregion

/** Import a v1 or v2 dump. */
export function importBlenderDump(dump: DumpV1 | DumpV2): ImportedDump {
    // Bundles (`bundle_dump.py`) are v2 dumps without the evaluated output.
    const format = (dump as DumpV2).format
    if (format?.startsWith('threepipe-procedural-dump/') || format?.startsWith('threepipe-procedural-bundle/')) return importV2(dump as DumpV2)
    if ((dump as DumpV1).trees) return importV1(dump as DumpV1)
    throw new Error('procedural: not a geometry-nodes dump (expected dump_blend.py v2 or extract_geo_nodes.py v1)')
}

/** Every node type used in a library, with how many nodes use it. */
export function nodeTypesOf(library: NodeGroupLibrary): Map<string, number> {
    const m = new Map<string, number>()
    for (const t of Object.values(library)) for (const n of t.nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1)
    return m
}

/** {@link EvalOptions.time} of a dump: `frame_rate = double(fps) / double(fps_base)` (node_geo_input_scene_time.cc:22). */
export function dumpTime(dump: DumpV2): {ctime: number, frameRate: number} | undefined {
    const t = dump.scene_time
    return t ? {ctime: t.ctime, frameRate: t.fps / t.fpsBase} : undefined
}
