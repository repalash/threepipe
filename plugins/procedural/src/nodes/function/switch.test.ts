/**
 * Switch nodes read only the selected input when the selector is a single value
 * (`LazyFunctionForSwitchNode::execute_single`, `node_geo_switch.cc:157`; Index Switch :331; Menu Switch :340),
 * and every input when it is a field (`execute_field`).
 */
import {describe, expect, it} from 'vitest'
import {GeometryNodesEvaluator} from '../../runtime/evaluator'
import {getNodeType, registerNodeType} from '../../runtime/registry'
import type {NodeJSON, NodeTreeJSON} from '../../runtime/types'
import {evaluateConstantField} from '../../fields/evaluate'
import {GField} from '../../fields/field'
import '../index'

const runs: Record<string, number> = {}
if (!getNodeType('TestSwitchProbe')) {
    registerNodeType({
        idname: 'TestSwitchProbe',
        label: 'Probe',
        declare(b) {
            b.input('FLOAT', 'Value')
            b.output('FLOAT', 'Value')
        },
        execute(p) {
            runs[p.node.name] = (runs[p.node.name] ?? 0) + 1
            p.set('Value', p.get('Value'))
        },
    })
}

function run(switchNode: NodeJSON, links: [string, string][]): number[] {
    for (const k of Object.keys(runs)) delete runs[k]
    const tree: NodeTreeJSON = {
        name: 'T',
        interface: [{inOut: 'OUTPUT', name: 'Out', identifier: 'Out', socketType: 'NodeSocketFloat'}],
        nodes: [
            {name: 'p0', type: 'TestSwitchProbe', inputs: {Value: 10}},
            {name: 'p1', type: 'TestSwitchProbe', inputs: {Value: 11}},
            {name: 'p2', type: 'TestSwitchProbe', inputs: {Value: 12}},
            {name: 'index', type: 'GeometryNodeInputIndex'},
            {...switchNode, name: 'sw'},
            {name: 'out', type: 'NodeGroupOutput'},
        ],
        links: [...links.map(([from, to]) => ({from: [from, from === 'index' ? 'Index' : 'Value'] as [string, string], to: ['sw', to] as [string, string]})),
            {from: ['sw', 'Output'], to: ['out', 'Out']}],
    }
    const v = new GeometryNodesEvaluator({T: tree}, 'T').evaluate().outputs.Out as GField
    return v.dependsOnInput ? [] : [...evaluateConstantField(v)]
}

describe('switch laziness', () => {
    it('Switch reads only the selected branch for a single condition', () => {
        expect(run({name: 'sw', type: 'GeometryNodeSwitch', inputs: {Switch: true}}, [['p0', 'False'], ['p1', 'True']])).toEqual([11])
        expect(runs).toEqual({p1: 1})
    })
    it('Switch reads both branches for a field condition', () => {
        // The Index field converted to a boolean: the output is a field over both inputs.
        expect(run({name: 'sw', type: 'GeometryNodeSwitch'}, [['p0', 'False'], ['p1', 'True'], ['index', 'Switch']])).toEqual([])
        expect(runs).toEqual({p0: 1, p1: 1})
    })
    it('Index Switch reads only the indexed item, none when out of range', () => {
        const items = {index_switch_items: [{identifier: 0}, {identifier: 1}, {identifier: 2}]}
        expect(run({name: 'sw', type: 'GeometryNodeIndexSwitch', items, inputs: {Index: 2}}, [['p0', 'Item_0'], ['p1', 'Item_1'], ['p2', 'Item_2']])).toEqual([12])
        expect(runs).toEqual({p2: 1})
        expect(run({name: 'sw', type: 'GeometryNodeIndexSwitch', items, inputs: {Index: 3}}, [['p0', 'Item_0'], ['p1', 'Item_1'], ['p2', 'Item_2']])).toEqual([0])
        expect(runs).toEqual({})
    })
    it('Menu Switch reads only the chosen item', () => {
        const items = {enum_items: [{name: 'X', identifier: 0}, {name: 'Y', identifier: 1}]}
        expect(run({name: 'sw', type: 'GeometryNodeMenuSwitch', properties: {data_type: 'FLOAT'}, items, inputs: {Menu: 'Y'}}, [['p0', 'Item_0'], ['p1', 'Item_1']])).toEqual([11])
        expect(runs).toEqual({p1: 1})
    })
})
