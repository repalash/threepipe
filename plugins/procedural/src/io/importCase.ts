/**
 * Import of single-tree parity cases (`{nodes: [{name, type, properties, inputs}], links: [{from, to}],
 * output: [node, socket]}`): the format of `porting/blender/run_cases.py` and of the geonodes-kit
 * reference cases in `tests/parity/geonodes-kit/`.
 */

import type {IDRef, JSONValue, NodeGroupLibrary, NodeJSON, NodeTreeJSON} from '../runtime/types'
import {getNodeType, NodeInstance} from '../runtime/registry'

export interface CaseNodeJSON {
    name: string
    type: string
    properties?: Record<string, JSONValue>
    inputs?: Record<string, JSONValue>
    items?: Record<string, Record<string, JSONValue>[]>
    pairedOutput?: string
    group?: string
}

export interface CaseTreeJSON {
    nodes: CaseNodeJSON[]
    links: {from: [string, string], to: [string, string]}[]
    output: [string, string]
}

export interface CaseObjectJSON {
    name: string
    mesh?: 'cube' | 'plane' | 'empty' | {positions: number[], faces: number[][]}
    location?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
}

export interface CaseJSON {
    id: string
    description?: string
    tree?: CaseTreeJSON
    library?: NodeGroupLibrary
    group?: string
    inputs?: Record<string, JSONValue>
    input?: CaseObjectJSON['mesh']
    scene?: {collection: string, objects: CaseObjectJSON[]}[]
    objects?: CaseObjectJSON[]
}

const ID_SOCKETS: Record<string, IDRef['_ref']> = {
    OBJECT: 'OBJECT', COLLECTION: 'COLLECTION', MATERIAL: 'MATERIAL', IMAGE: 'IMAGE',
}

/**
 * Inputs given as plain names on ID sockets (`"Object": "A"`) become ID references; everything else
 * is kept. Needs the node's declaration, so the node type must be registered.
 */
function normaliseInputs(node: CaseNodeJSON): Record<string, JSONValue> | undefined {
    if (!node.inputs) return undefined
    const def = getNodeType(node.type)
    if (!def) return node.inputs
    const inst = new NodeInstance({name: node.name, type: node.type, properties: node.properties}, def)
    const out: Record<string, JSONValue> = {}
    for (const [id, v] of Object.entries(node.inputs)) {
        const decl = inst.decl.inputs.find(d => d.identifier === id)
        const ref = decl ? ID_SOCKETS[decl.type] : undefined
        out[id] = ref && typeof v === 'string' ? {_ref: ref, name: v} : v
    }
    return out
}

/**
 * Cases list links in creation order (`tree.links.new` one after the other). Blender evaluates the
 * links of a multi-input socket newest first (`multi_input_sort_id`, `node_runtime.cc:141`), while
 * {@link NodeTreeJSON} lists them in evaluation order, so links into one multi-input socket are
 * reversed.
 */
function evaluationOrder(tree: CaseTreeJSON): CaseTreeJSON['links'] {
    const isMulti = (nodeName: string, socket: string) => {
        const n = tree.nodes.find(x => x.name === nodeName)
        const def = n && getNodeType(n.type)
        if (!def) return false
        return new NodeInstance({name: n!.name, type: n!.type, properties: n!.properties}, def).decl.inputs
            .some(d => d.identifier === socket && d.multiInput)
    }
    const out = [...tree.links]
    const groups = new Map<string, number[]>()
    out.forEach((l, i) => {
        if (!isMulti(l.to[0], l.to[1])) return
        const key = `${l.to[0]}\u0000${l.to[1]}`
        let g = groups.get(key)
        if (!g) groups.set(key, g = [])
        g.push(i)
    })
    for (const idx of groups.values()) {
        const reversed = idx.map(i => tree.links[i]).reverse()
        idx.forEach((pos, k) => { out[pos] = reversed[k] })
    }
    return out
}

/** One case to a library with a single group named after the case. */
export function importCase(c: CaseJSON): {library: NodeGroupLibrary, group: string} {
    if (c.library && c.group) return {library: c.library, group: c.group}
    const tree = c.tree
    if (!tree) throw new Error(`case ${c.id}: no tree`)
    const nodes: NodeJSON[] = tree.nodes.map(n => {
        // The case format puts `mute` among the properties (it is set with `setattr` like them).
        const {mute, ...properties} = (n.properties ?? {}) as Record<string, JSONValue> & {mute?: boolean}
        return {
            name: n.name, type: n.type, properties, inputs: normaliseInputs(n), items: n.items,
            pairedOutput: n.pairedOutput, group: n.group, mute: !!mute,
        }
    })
    nodes.push({name: '__out', type: 'NodeGroupOutput'})
    const group: NodeTreeJSON = {
        name: c.id,
        interface: [{inOut: 'OUTPUT', name: 'Geometry', identifier: 'Geometry', socketType: 'NodeSocketGeometry'}],
        nodes,
        links: [...evaluationOrder(tree), {from: tree.output, to: ['__out', 'Geometry']}],
    }
    return {library: {[c.id]: group}, group: c.id}
}
