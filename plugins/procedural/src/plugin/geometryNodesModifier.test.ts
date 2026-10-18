import {describe, expect, it} from 'vitest'
import {MeshData} from '@threepipe/mesh-kernel'
import type {ModellingDocument, ModifierContext} from '@threepipe/plugin-modelling'
import {geometryNodes, n} from '../dsl/builder'
import {geometryNodesModifierType} from './geometryNodesModifier'
import {nodeGroupCommand} from './nodeGroupCommand'
import '../nodes'

/** The document surface the modifier and command use: data slots and object lookup. */
function fakeDocument() {
    const data = new Map<string, unknown>()
    return {
        getData: (k: string) => data.get(k),
        setData: (k: string, v: unknown) => { data.set(k, JSON.parse(JSON.stringify(v))) },
        find: () => undefined,
    } as unknown as ModellingDocument
}

const grid = geometryNodes('Grid Heights', g => {
    const geometry = g.input.geometry('Geometry')
    const vx = g.input.int('Vertices', {default: 3, min: 2})
    const h = g.input.float('Height', {default: 1})
    const grid = n.MeshGrid({sizeX: 2, sizeY: 2, verticesX: vx, verticesY: vx}).mesh
    const lifted = n.SetPosition({geometry: grid, offset: n.CombineXYZ({z: n.Index().index.mul(h)}).vector}).geometry
    g.output.geometry('Geometry', n.JoinGeometry({geometry: [geometry, lifted]}).geometry)
})

describe('geometryNodes modifier', () => {
    it('evaluates a document node group on the stack input, with inputs by name, reusing its evaluator', () => {
        const doc = fakeDocument()
        const ctx = {doc, index: 0, state: new Map(), warn: () => undefined} as unknown as ModifierContext
        nodeGroupCommand.run({library: grid.toJSON()}, {doc} as never)
        const input = MeshData.fromFaces({positions: [0, 0, 5, 1, 0, 5, 0, 1, 5], faces: [[0, 1, 2]]})

        const spec = geometryNodesModifierType.read!({type: 'geometryNodes', group: 'Grid Heights', inputs: {Vertices: 4, Height: 0.5}})
        geometryNodesModifierType.check(spec)
        const out = geometryNodesModifierType.evaluate(input, spec, ctx) as {mesh: MeshData}
        // The input triangle joined with a 4x4 grid.
        expect(out.mesh.vertsNum).toBe(3 + 16)
        expect(out.mesh.positions[(3 + 15) * 3 + 2]).toBeCloseTo(7.5)
        const evaluator = ctx.state.get('geometryNodes:0')
        // A changed input keeps the evaluator; inputs left out return to their defaults.
        geometryNodesModifierType.evaluate(input, {...spec, inputs: {Height: 2}}, ctx)
        expect(ctx.state.get('geometryNodes:0')).toBe(evaluator)
        const again = geometryNodesModifierType.evaluate(input, {...spec, inputs: {Height: 2}}, ctx) as {mesh: MeshData}
        expect(again.mesh.vertsNum).toBe(3 + 9)
        expect(geometryNodesModifierType.describe(spec)).toBe('geometry nodes "Grid Heights" (Vertices=4, Height=0.5)')
    })

    it('fails with useful messages', () => {
        const doc = fakeDocument()
        const ctx = {doc, index: 0, state: new Map()} as unknown as ModifierContext
        const mesh = new MeshData()
        expect(() => geometryNodesModifierType.check({type: 'geometryNodes', group: ''})).toThrow(/needs a `group`/)
        expect(() => geometryNodesModifierType.evaluate(mesh, {type: 'geometryNodes', group: 'X'}, ctx)).toThrow(/node group "X" does not exist/)
        nodeGroupCommand.run({library: grid.toJSON()}, {doc} as never)
        expect(() => geometryNodesModifierType.evaluate(mesh, {type: 'geometryNodes', group: 'Grid Heights', inputs: {Hieght: 1}}, ctx))
            .toThrow(/has no input "Hieght" \(inputs: Geometry, Vertices, Height\)/)
        expect(() => nodeGroupCommand.run({name: 'Bad', tree: {name: 'Bad', interface: [], nodes: [{name: 'x', type: 'GeometryNodeNope'}], links: []}}, {doc} as never))
            .toThrow(/GeometryNodeNope/)
    })

    it('describes groups for agents, with code', () => {
        const doc = fakeDocument()
        nodeGroupCommand.run({library: grid.toJSON()}, {doc} as never)
        const out = nodeGroupCommand.run({name: 'Grid Heights', describe: true, code: true}, {doc} as never) as {data: {inputs: {name: string}[], code: string}[]}
        expect(out.data[0].inputs.map(i => i.name)).toEqual(['Geometry', 'Vertices', 'Height'])
        expect(out.data[0].code).toContain('geometryNodes("Grid Heights"')
    })
})
