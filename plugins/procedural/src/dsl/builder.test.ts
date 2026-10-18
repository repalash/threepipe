import {describe, expect, it} from 'vitest'
import {geometryNodes, n, dslKey, NodeGroup} from './builder'
import {toCode} from './toCode'
import {GeometryNodesEvaluator} from '../runtime/evaluator'
import '../nodes'

function heights(group: NodeGroup, inputs: Record<string, number> = {}): number[] {
    const ev = new GeometryNodesEvaluator(group.toJSON(), group.name)
    for (const [k, v] of Object.entries(inputs)) ev.setInput(ev.interfaceInputs.find(s => s.name === k)!.identifier, v)
    const mesh = ev.evaluate().geometry!.mesh!
    return Array.from(mesh.attributes.get('h')!.data)
}

const build = () => geometryNodes('Heights', g => {
    const size = g.input.float('Size', {default: 2, min: 0})
    const grid = n.MeshGrid({sizeX: size, sizeY: 1, verticesX: 3, verticesY: 2})
    const h = n.Index().index.mul(0.5).add(size)
    const stored = n.StoreNamedAttribute({geometry: grid.mesh, name: 'h', value: h})
    g.output.geometry('Geometry', stored.geometry)
})

describe('DSL', () => {
    it('maps Blender names to camelCase keys', () => {
        expect(dslKey('Size X')).toBe('sizeX')
        expect(dslKey('Value_001')).toBe('value1')
        expect(dslKey('noise_dimensions')).toBe('noiseDimensions')
        expect(dslKey('UV Map')).toBe('uVMap')
    })

    it('builds a tree that evaluates, and follows group inputs', () => {
        const group = build()
        expect(group.tree.nodes.map(x => x.type).sort()).toEqual([
            'GeometryNodeInputIndex', 'GeometryNodeMeshGrid', 'GeometryNodeStoreNamedAttribute', 'NodeGroupInput',
            'NodeGroupOutput', 'ShaderNodeMath', 'ShaderNodeMath'].sort())
        expect(heights(group)).toEqual([2, 2.5, 3, 3.5, 4, 4.5])
        expect(heights(group, {Size: 1})).toEqual([1, 1.5, 2, 2.5, 3, 3.5])
    })

    it('rejects unknown inputs, bad enum values and impossible links, naming them', () => {
        expect(() => geometryNodes('X', () => { n.MeshGrid({sizeZ: 1}) })).toThrow(/Grid has no input or property 'sizeZ'/)
        expect(() => geometryNodes('X', () => { n.Math({operation: 'NOPE'}) })).toThrow(/operation must be one of ADD/)
        expect(() => geometryNodes('X', () => { n.Math({value: n.MeshGrid().mesh}) })).toThrow(/cannot link GEOMETRY/)
        expect(() => n.MeshGrid()).toThrow(/inside geometryNodes/)
    })

    it('uses node groups', () => {
        const inner = geometryNodes('Double', g => {
            const x = g.input.float('X')
            g.output.float('Y', x.mul(2))
        })
        const outer = geometryNodes('Outer', g => {
            const grid = n.MeshGrid({verticesX: 2, verticesY: 2})
            const y = g.group(inner, {x: n.Index().index}).outputs.y
            g.output.geometry('Geometry', n.StoreNamedAttribute({geometry: grid.mesh, name: 'h', value: y}).geometry)
        })
        expect(Object.keys(outer.toJSON()).sort()).toEqual(['Double', 'Outer'])
        expect(heights(outer)).toEqual([0, 2, 4, 6])
    })

    it('prints code that rebuilds an equivalent tree', () => {
        const inner = geometryNodes('Double', g => {
            g.output.float('Y', g.input.float('X', {default: 3}).mul(2))
        })
        const group = geometryNodes('Outer', g => {
            const size = g.input.float('Size', {default: 2})
            const grid = n.MeshGrid({sizeX: size, verticesX: 3, verticesY: 2})
            const y = g.group(inner, {x: n.Index().index}).outputs.y
            g.output.geometry('Geometry', n.StoreNamedAttribute({geometry: grid.mesh, name: 'h', value: y.add(size)}).geometry)
        })
        const code = toCode(group.toJSON(), 'Outer')
        expect(code).toContain('const double = geometryNodes("Double"')
        // verticesX: 3 is the socket default, so it is not printed.
        expect(code).toContain('n.MeshGrid({sizeX: size, verticesY: 2})')
        const rebuilt = new Function('geometryNodes', 'n', `${code}\nreturn outer`)(geometryNodes, n) as NodeGroup
        expect(heights(rebuilt)).toEqual(heights(group))
        expect(heights(rebuilt, {Size: 5})).toEqual(heights(group, {Size: 5}))
    })
})
