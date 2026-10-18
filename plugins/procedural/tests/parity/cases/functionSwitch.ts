/**
 * Parity cases for Switch, Index Switch and Menu Switch: every field type with single and field selectors,
 * geometry and string values (single selectors; a field selector over geometry is Blender's "Type cannot be
 * switched by a field" path), out-of-range indices (type default for fields, socket default for single
 * values), more than the two default items, renamed menu items and the menu's boolean outputs.
 * The DSL has no argument for dynamic items, so items and the links into the extra item sockets are added
 * to the built node JSON; links out of extra item sockets use sockets made by hand.
 */

import {geometryNodes, GroupBuilder, Socket} from '../../../src/dsl/builder'
import type {JSONValue, LinkJSON, NodeGroupLibrary, NodeJSON} from '../../../src/runtime/types'
import {Inputs, outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

const N = 64

interface Patch {
    items?: NodeJSON['items']
    inputs?: Record<string, JSONValue>
    links?: [Socket, string][]
}

type PatchFn = (name: string, p: Patch) => void

function applyPatches(library: NodeGroupLibrary, id: string, patches: Map<string, Patch>): void {
    const tree = library[id]
    for (const node of tree.nodes as NodeJSON[]) {
        const p = patches.get(node.name)
        if (!p) continue
        if (p.items) node.items = p.items
        if (p.inputs) node.inputs = {...node.inputs, ...p.inputs}
        for (const [from, to] of p.links ?? []) tree.links.push({from: [from.node, from.identifier], to: [node.name, to]} satisfies LinkJSON)
    }
}

/** A points case (outputs stored as attributes) whose nodes are patched after the tree is built. */
function patchedCase(id: string, description: string, count: number, body: (v: Inputs, g: GroupBuilder, patch: PatchFn) => Record<string, Socket>): ParityCase {
    const patches = new Map<string, Patch>()
    const c = pointsCase(id, description, count, (v, g) => body(v, g, (name, p) => patches.set(name, p)))
    applyPatches(c.library, id, patches)
    return c
}

/** A case whose output is the geometry `make` returns; `a`, `b`, `c` are point clouds of 3, 5, 7 points with `origin` = 1, 2, 3. */
function geometryCase(id: string, description: string, make: (g: GroupBuilder, a: Socket, b: Socket, c: Socket, patch: PatchFn) => Socket): ParityCase {
    const patches = new Map<string, Patch>()
    const points = (g: GroupBuilder, count: number, value: number) => g.node('GeometryNodeStoreNamedAttribute', {
        dataType: 'FLOAT', domain: 'POINT', name: 'origin', value, geometry: g.node('GeometryNodePoints', {count}).outputs.geometry,
    }).outputs.geometry
    const group = geometryNodes(id, g => {
        g.output.geometry('Geometry', make(g, points(g, 3, 1), points(g, 5, 2), points(g, 7, 3), (name, p) => patches.set(name, p)))
    })
    const library = group.toJSON() as NodeGroupLibrary
    applyPatches(library, id, patches)
    return {id, description, library, group: id, input: 'empty'}
}

const FIELD_TYPES = ['FLOAT', 'INT', 'BOOLEAN', 'VECTOR', 'RGBA', 'ROTATION', 'MATRIX']

/** A field of the given socket type that varies per point (`seed` picks the variation). */
function valueOf(v: Inputs, type: string, seed: number): Socket {
    const euler = (s: number) => v.g.node('FunctionNodeEulerToRotation', {euler: v.noiseVector(s, -3, 3)}).outputs.rotation
    switch (type) {
    case 'FLOAT': return v.noise(seed, -3, 3)
    case 'INT': return v.g.node('FunctionNodeIntegerMath', {operation: 'MULTIPLY_ADD', value: v.index(), value1: 3 + seed, value2: -20}).outputs.value
    case 'BOOLEAN': return v.g.node('FunctionNodeCompare', {dataType: 'FLOAT', operation: 'GREATER_THAN', a: v.noise(seed, 0, 1), b: 0.5}).outputs.result
    case 'VECTOR': return v.noiseVector(seed, -3, 3)
    case 'RGBA': return v.g.node('FunctionNodeCombineColor', {red: v.noise(seed, 0, 1), green: v.noise(seed + 1, 0, 1), blue: v.noise(seed + 2, 0, 1), alpha: v.noise(seed + 3, 0, 1)}).outputs.color
    case 'ROTATION': return euler(seed)
    case 'MATRIX': return v.g.node('FunctionNodeCombineTransform', {translation: v.noiseVector(seed, -3, 3), rotation: euler(seed + 5), scale: v.noiseVector(seed + 9, 0.5, 2)}).outputs.transform
    }
    throw new Error(`no values for ${type}`)
}

const boolField = (v: Inputs, seed: number) => v.g.node('FunctionNodeCompare', {dataType: 'FLOAT', operation: 'GREATER_THAN', a: v.noise(seed, 0, 1), b: 0.4}).outputs.result

function fieldTypeCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const type of FIELD_TYPES) {
        const t = type.toLowerCase()
        cases.push(patchedCase(`switch-${t}`, `Switch ${type}: single true/false and a field condition`, N, (v, g) => ({
            ...outputsOf(g.node('GeometryNodeSwitch', {inputType: type, switch: true, false: valueOf(v, type, 1), true: valueOf(v, type, 2)}), 'on_'),
            ...outputsOf(g.node('GeometryNodeSwitch', {inputType: type, switch: false, false: valueOf(v, type, 3), true: valueOf(v, type, 4)}), 'off_'),
            ...outputsOf(g.node('GeometryNodeSwitch', {inputType: type, switch: boolField(v, 5), false: valueOf(v, type, 6), true: valueOf(v, type, 7)}), 'field_'),
        })))
        const items = {index_switch_items: [0, 1, 2, 3].map(identifier => ({identifier}))}
        cases.push(patchedCase(`index-switch-${t}`, `Index Switch ${type}: four items, single and field indices including out of range`, N, (v, g, patch) => {
            const out: Record<string, Socket> = {}
            // Field indices -1..4: both ends out of range (the type's default value).
            const fieldIndex = g.node('FunctionNodeIntegerMath', {operation: 'SUBTRACT',
                value: g.node('FunctionNodeIntegerMath', {operation: 'MODULO', value: v.index(), value1: 6}).outputs.value, value1: 1}).outputs.value
            for (const [set, index] of [['two', 2], ['field', fieldIndex]] as [string, Socket | number][]) {
                const node = g.node('GeometryNodeIndexSwitch', {dataType: type, index, item0: valueOf(v, type, 10), item1: valueOf(v, type, 11)})
                patch(node.name, {items, links: [[valueOf(v, type, 12), 'Item_2'], [valueOf(v, type, 13), 'Item_3']]})
                Object.assign(out, outputsOf(node, `${set}_`))
            }
            return out
        }))
        // A single out-of-range index gives the output socket's default (`set_default_remaining_node_outputs`).
        cases.push(patchedCase(`index-switch-${t}-out-of-range`, `Index Switch ${type}: single index 7 of 2 items`, 1, (v, g) => ({
            ...outputsOf(g.node('GeometryNodeIndexSwitch', {dataType: type, index: 7, item0: valueOf(v, type, 14), item1: valueOf(v, type, 15)}), 'out_'),
        })))
    }
    // Menu Switch of floats: renamed items, a third item, each menu value, the boolean outputs.
    for (const menu of ['Low', 'Mid', 'High']) {
        cases.push(patchedCase(`menu-switch-float-${menu.toLowerCase()}`, `Menu Switch FLOAT with menu ${menu}`, N, (v, g, patch) => {
            const node = g.node('GeometryNodeMenuSwitch', {dataType: 'FLOAT', item0: v.noise(20, -1, 1), item1: v.noise(21, 2, 3)})
            patch(node.name, {
                items: {enum_items: [{name: 'Low', identifier: 0}, {name: 'Mid', identifier: 1}, {name: 'High', identifier: 2}]},
                inputs: {Menu: menu}, links: [[v.noise(22, 5, 6), 'Item_2']],
            })
            const output = node.outputs.output
            // The third item's boolean output, which the DSL does not know about.
            return {...outputsOf(node, 'm_'), m_high: new Socket(output.builder, node.name, 'Item_2', 'BOOLEAN')}
        }))
    }
    cases.push(patchedCase('menu-switch-vector-default-items', 'Menu Switch VECTOR with the default items A/B and menu B', N, (v, g) => ({
        ...outputsOf(g.node('GeometryNodeMenuSwitch', {dataType: 'VECTOR', menu: 'B', item0: v.noiseVector(30, -1, 1), item1: v.noiseVector(31, -1, 1)}), 'm_'),
    })))
    return cases
}

function geometryCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const sw of [true, false]) {
        cases.push(geometryCase(`switch-geometry-${sw}`, `Switch GEOMETRY ${sw}`, (g, a, b) =>
            g.node('GeometryNodeSwitch', {inputType: 'GEOMETRY', switch: sw, false: a, true: b}).outputs.output))
    }
    cases.push(geometryCase('switch-geometry-field-condition', 'Switch GEOMETRY with a field condition: an error, the False input', (g, a, b) => {
        const cond = g.node('FunctionNodeCompare', {dataType: 'INT', operation: 'GREATER_THAN', a: g.node('GeometryNodeInputIndex').outputs.index, b: 0}).outputs.result
        return g.node('GeometryNodeSwitch', {inputType: 'GEOMETRY', switch: cond, false: a, true: b}).outputs.output
    }))
    cases.push(geometryCase('switch-string', 'Switch STRING names the stored attribute', (g, a) => {
        const name = g.node('GeometryNodeSwitch', {inputType: 'STRING', switch: true, false: 'off', true: 'picked'}).outputs.output
        return g.node('GeometryNodeStoreNamedAttribute', {dataType: 'FLOAT', domain: 'POINT', geometry: a, name, value: 4.5}).outputs.geometry
    }))
    for (const index of [0, 2, 5, -1]) {
        cases.push(geometryCase(`index-switch-geometry-${index < 0 ? 'neg' : index}`, `Index Switch GEOMETRY index ${index}`, (g, a, b, c, patch) => {
            const node = g.node('GeometryNodeIndexSwitch', {dataType: 'GEOMETRY', index, item0: a, item1: b})
            patch(node.name, {items: {index_switch_items: [{identifier: 0}, {identifier: 1}, {identifier: 2}]}, links: [[c, 'Item_2']]})
            return node.outputs.output
        }))
    }
    // A field index cannot switch geometry per element: Blender reads `get<int>()` of the field, 0.
    cases.push(geometryCase('index-switch-geometry-field-index', 'Index Switch GEOMETRY with a field index: item 0', (g, a, b) =>
        g.node('GeometryNodeIndexSwitch', {dataType: 'GEOMETRY', index: g.node('GeometryNodeInputIndex').outputs.index, item0: b, item1: a}).outputs.output))
    for (const menu of ['A', 'B']) {
        cases.push(geometryCase(`menu-switch-geometry-${menu.toLowerCase()}`, `Menu Switch GEOMETRY menu ${menu}`, (g, a, b) =>
            g.node('GeometryNodeMenuSwitch', {menu, item0: a, item1: b}).outputs.output))
    }
    return cases
}

export function functionSwitchCases(): ParityCase[] {
    return [...fieldTypeCases(), ...geometryCases()]
}
