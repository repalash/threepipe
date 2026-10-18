/**
 * Evaluating one node in isolation, for the function-node unit tests: the node is put into a group
 * whose outputs are the node's outputs, so declaration, availability, defaults, implicit conversions
 * and the single-value folding of the evaluator are all exercised.
 */

import {GeometryNodesEvaluator} from '../../runtime/evaluator'
import {getNodeType, NodeInstance} from '../../runtime/registry'
import type {InterfaceSocketJSON, JSONValue, LinkJSON, NodeJSON, SocketType} from '../../runtime/types'
import {GField, MultiFunction} from '../../fields/field'
import {evaluateConstantField} from '../../fields/evaluate'
import {GVArray} from '../../geometry/varray'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import type {SocketValue} from '../../runtime/values'

const IDNAMES: Partial<Record<SocketType, string>> = {
    FLOAT: 'NodeSocketFloat', INT: 'NodeSocketInt', BOOLEAN: 'NodeSocketBool', VECTOR: 'NodeSocketVector',
    RGBA: 'NodeSocketColor', ROTATION: 'NodeSocketRotation', MATRIX: 'NodeSocketMatrix', GEOMETRY: 'NodeSocketGeometry',
    STRING: 'NodeSocketString', MENU: 'NodeSocketMenu',
}

export interface NodeSpec {
    properties?: NodeJSON['properties']
    inputs?: Record<string, JSONValue>
    items?: NodeJSON['items']
    colorRamp?: unknown
    curveMapping?: unknown
    /** Extra nodes feeding the node under test (links to `node`). */
    nodes?: NodeJSON[]
    links?: LinkJSON[]
}

/** All available outputs of a node of `type`, evaluated as a group. */
export function evalNodeOutputs(type: string, spec: NodeSpec = {}): Record<string, SocketValue> {
    const def = getNodeType(type)
    if (!def) throw new Error(`no node type ${type}`)
    const json: NodeJSON = {
        name: 'node', type, properties: spec.properties ?? {}, inputs: spec.inputs ?? {}, items: spec.items,
        colorRamp: spec.colorRamp, curveMapping: spec.curveMapping,
    }
    const inst = new NodeInstance(json, def)
    const outs = inst.decl.outputs.filter(o => o.available)
    const iface: InterfaceSocketJSON[] = outs.map(o => ({inOut: 'OUTPUT', name: o.identifier, identifier: o.identifier, socketType: IDNAMES[o.type]!}))
    const ev = new GeometryNodesEvaluator({T: {
        name: 'T', interface: iface,
        nodes: [...(spec.nodes ?? []), json, {name: 'out', type: 'NodeGroupOutput'}],
        links: [...(spec.links ?? []), ...outs.map((o): LinkJSON => ({from: ['node', o.identifier], to: ['out', o.identifier]}))],
    }}, 'T')
    return ev.evaluate().outputs
}

/** The constant value of every available field output. */
export function evalNode(type: string, spec: NodeSpec = {}): Record<string, number[]> {
    const outs = evalNodeOutputs(type, spec)
    const r: Record<string, number[]> = {}
    for (const [k, v] of Object.entries(outs)) if (v instanceof GField) r[k] = [...evaluateConstantField(v)]
    return r
}

/** The node's multi-function called on arrays (not single values), one row per element. */
export function callSpans(fn: MultiFunction, columns: number[][][]): number[][][] {
    const size = columns[0].length
    const ins = fn.inputs.map((t, i) => {
        const c = DATA_TYPES[t].components
        const a = new DATA_TYPES[t].array(size * c)
        columns[i].forEach((v, e) => { for (let k = 0; k < c; k++) a[e * c + k] = v[k] })
        return GVArray.fromArray(t, a)
    })
    const outs = fn.outputs.map(t => new DATA_TYPES[t].array(size * DATA_TYPES[t].components))
    fn.call(size, ins, outs)
    return fn.outputs.map((t, o) => {
        const c = DATA_TYPES[t].components
        return Array.from({length: size}, (_, e) => Array.from(outs[o].subarray(e * c, e * c + c)))
    })
}

/** The multi-function a node of `type` builds for `properties`. */
export function nodeFunction(type: string, properties: NodeJSON['properties'] = {}, extra: Partial<NodeJSON> = {}): MultiFunction {
    const def = getNodeType(type)!
    return def.multiFunction!(new NodeInstance({name: 'node', type, properties, ...extra}, def))
}

export type {DataType}
