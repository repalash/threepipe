import {describe, expect, it} from 'vitest'
import {GeometryNodesEvaluator} from './evaluator'
import {registerNodeType, getNodeType} from './registry'
import {GeometrySet} from '../geometry/GeometrySet'
import {NodeTreeJSON} from './types'
import {GField} from '../fields/field'
import {evaluateConstantField} from '../fields/evaluate'
import '../nodes'

// A test-only node that counts executions and passes a float through.
const runs: Record<string, number> = {}
if (!getNodeType('TestNodeCount')) {
    registerNodeType({
        idname: 'TestNodeCount',
        label: 'Count',
        declare(b) {
            b.input('FLOAT', 'Value').default(0)
            b.output('FLOAT', 'Value')
        },
        execute(p) {
            runs[p.node.name] = (runs[p.node.name] ?? 0) + 1
            p.set('Value', p.field('Value'))
        },
    })
}

const floatOut = (id = 'Out') => ({inOut: 'OUTPUT' as const, name: id, identifier: id, socketType: 'NodeSocketFloat'})
const floatIn = (name: string, id: string, def = 0) => ({inOut: 'INPUT' as const, name, identifier: id, socketType: 'NodeSocketFloat', default: def})

function valueOf(ev: GeometryNodesEvaluator, id = 'Out'): number {
    return evaluateConstantField(ev.evaluate().outputs[id] as GField)[0]
}

describe('GeometryNodesEvaluator', () => {
    it('evaluates only what the output needs and reuses unchanged nodes', () => {
        for (const k of Object.keys(runs)) delete runs[k]
        const tree: NodeTreeJSON = {
            name: 'T',
            interface: [floatIn('A', 'Socket_0', 1), floatIn('B', 'Socket_1', 2), floatOut()],
            nodes: [
                {name: 'in', type: 'NodeGroupInput'},
                {name: 'ca', type: 'TestNodeCount'},
                {name: 'cb', type: 'TestNodeCount'},
                {name: 'unused', type: 'TestNodeCount'},
                {name: 'add', type: 'ShaderNodeMath', properties: {operation: 'ADD'}},
                {name: 'out', type: 'NodeGroupOutput'},
            ],
            links: [
                {from: ['in', 'Socket_0'], to: ['ca', 'Value']},
                {from: ['in', 'Socket_1'], to: ['cb', 'Value']},
                {from: ['in', 'Socket_1'], to: ['unused', 'Value']},
                {from: ['ca', 'Value'], to: ['add', 'Value']},
                {from: ['cb', 'Value'], to: ['add', 'Value_001']},
                {from: ['add', 'Value'], to: ['out', 'Out']},
            ],
        }
        const ev = new GeometryNodesEvaluator({T: tree}, 'T')
        expect(valueOf(ev)).toBe(3)
        expect(runs).toEqual({ca: 1, cb: 1})
        // Nothing changed: nothing re-runs.
        expect(valueOf(ev)).toBe(3)
        expect(runs).toEqual({ca: 1, cb: 1})
        // Changing A re-runs `ca` and `add`, not `cb`.
        ev.setInput('A', 10)
        expect(valueOf(ev)).toBe(12)
        expect(runs).toEqual({ca: 2, cb: 1})
        // Setting an equal value keeps the old value object: nothing re-runs.
        ev.setInput('A', 10)
        valueOf(ev)
        expect(runs).toEqual({ca: 2, cb: 1})
    })

    it('a Switch-like lazy node pulls only the branch it reads', () => {
        for (const k of Object.keys(runs)) delete runs[k]
        if (!getNodeType('TestLazySwitch')) {
            registerNodeType({
                idname: 'TestLazySwitch',
                label: 'Lazy Switch',
                declare(b) {
                    b.input('BOOLEAN', 'Switch').default(false)
                    b.input('FLOAT', 'False')
                    b.input('FLOAT', 'True')
                    b.output('FLOAT', 'Output')
                },
                execute(p) {
                    p.set('Output', p.field(p.bool('Switch') ? 'True' : 'False'))
                },
            })
        }
        const tree: NodeTreeJSON = {
            name: 'S',
            interface: [{inOut: 'INPUT', name: 'S', identifier: 'Socket_0', socketType: 'NodeSocketBool', default: false}, floatOut()],
            nodes: [
                {name: 'in', type: 'NodeGroupInput'},
                {name: 'f', type: 'TestNodeCount', inputs: {Value: 1}},
                {name: 't', type: 'TestNodeCount', inputs: {Value: 2}},
                {name: 'sw', type: 'TestLazySwitch'},
                {name: 'out', type: 'NodeGroupOutput'},
            ],
            links: [
                {from: ['in', 'Socket_0'], to: ['sw', 'Switch']},
                {from: ['f', 'Value'], to: ['sw', 'False']},
                {from: ['t', 'Value'], to: ['sw', 'True']},
                {from: ['sw', 'Output'], to: ['out', 'Out']},
            ],
        }
        const ev = new GeometryNodesEvaluator({S: tree}, 'S')
        expect(valueOf(ev)).toBe(1)
        expect(runs).toEqual({f: 1})
        ev.setInput('S', true)
        expect(valueOf(ev)).toBe(2)
        expect(runs).toEqual({f: 1, t: 1})
        ev.setInput('S', false)
        expect(valueOf(ev)).toBe(1)
        expect(runs).toEqual({f: 1, t: 1})
    })

    it('evaluates node groups in their own call context and re-runs them only on changed inputs', () => {
        for (const k of Object.keys(runs)) delete runs[k]
        const inner: NodeTreeJSON = {
            name: 'Inner',
            interface: [floatIn('X', 'Socket_0'), floatOut()],
            nodes: [
                {name: 'in', type: 'NodeGroupInput'},
                {name: 'c', type: 'TestNodeCount'},
                {name: 'mul', type: 'ShaderNodeMath', properties: {operation: 'MULTIPLY'}, inputs: {Value_001: 2}},
                {name: 'out', type: 'NodeGroupOutput'},
            ],
            links: [
                {from: ['in', 'Socket_0'], to: ['c', 'Value']},
                {from: ['c', 'Value'], to: ['mul', 'Value']},
                {from: ['mul', 'Value'], to: ['out', 'Out']},
            ],
        }
        const outer: NodeTreeJSON = {
            name: 'Outer',
            interface: [floatIn('A', 'Socket_0', 3), floatOut()],
            nodes: [
                {name: 'in', type: 'NodeGroupInput'},
                {name: 'g1', type: 'GeometryNodeGroup', group: 'Inner'},
                {name: 'g2', type: 'GeometryNodeGroup', group: 'Inner', inputs: {Socket_0: 5}},
                {name: 'add', type: 'ShaderNodeMath', properties: {operation: 'ADD'}},
                {name: 'out', type: 'NodeGroupOutput'},
            ],
            links: [
                {from: ['in', 'Socket_0'], to: ['g1', 'Socket_0']},
                {from: ['g1', 'Out'], to: ['add', 'Value']},
                {from: ['g2', 'Out'], to: ['add', 'Value_001']},
                {from: ['add', 'Value'], to: ['out', 'Out']},
            ],
        }
        const ev = new GeometryNodesEvaluator({Inner: inner, Outer: outer}, 'Outer')
        expect(valueOf(ev)).toBe(16)
        expect(runs).toEqual({c: 2})
        ev.setInput('A', 4)
        expect(valueOf(ev)).toBe(18)
        expect(runs).toEqual({c: 3})
    })

    it('throws for node types that are not ported, naming the node', () => {
        const tree: NodeTreeJSON = {name: 'X', interface: [], nodes: [{name: 'n', type: 'GeometryNodeDoesNotExist'}], links: []}
        expect(() => new GeometryNodesEvaluator({X: tree}, 'X')).toThrow(/GeometryNodeDoesNotExist \('n' in 'X'\) is not ported/)
    })

    it('feeds the modifier geometry to the first geometry input and strips anonymous attributes', () => {
        const tree: NodeTreeJSON = {
            name: 'G',
            interface: [
                {inOut: 'INPUT', name: 'Geometry', identifier: 'Socket_0', socketType: 'NodeSocketGeometry'},
                {inOut: 'OUTPUT', name: 'Geometry', identifier: 'Socket_1', socketType: 'NodeSocketGeometry'},
            ],
            nodes: [{name: 'in', type: 'NodeGroupInput'}, {name: 'grid', type: 'GeometryNodeMeshGrid'}, {name: 'j', type: 'GeometryNodeJoinGeometry'}, {name: 'out', type: 'NodeGroupOutput'}],
            links: [{from: ['in', 'Socket_0'], to: ['j', 'Geometry']}, {from: ['grid', 'Mesh'], to: ['j', 'Geometry']}, {from: ['j', 'Geometry'], to: ['out', 'Socket_1']}],
        }
        const ev = new GeometryNodesEvaluator({G: tree}, 'G')
        ev.setInputGeometry(new GeometrySet())
        const r = ev.evaluate()
        expect(r.geometry!.mesh!.vertsNum).toBe(9)
    })
})
