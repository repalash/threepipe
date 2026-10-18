/**
 * Parity cases for repeat zones (`node_geo_repeat.cc`, `geometry_nodes_repeat_zone.cc`): items of several types
 * carried through iterations, zero and negative counts, the count and other values read from outside the zone
 * (border links), fields carried as items, anonymous attributes made per iteration (each iteration's compute
 * context, carried to the next iteration), nested zones and group nodes inside a zone.
 */

import {geometryNodes, n} from '../../../src/dsl/builder'
import {meshCase, store} from './meshCommon'
import {ParityCase} from './types'

/** A float socket with a constant (Value's own value lives in its output socket, which the DSL does not set). */
const num = (x: number) => n.Math({operation: 'ADD', value: x, value1: 0}).value

export function zoneCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, build: Parameters<typeof meshCase>[3]) => cases.push(meshCase(id, description, {}, build))

    add('repeat-items', 'Geometry, int, float, vector and boolean items through 5 iterations, using the iteration index', g => {
        const zone = g.repeatZone({
            Geometry: n.MeshGrid({verticesX: 4, verticesY: 3}).mesh,
            Count: n.Integer({integer: 2}).integer,
            Sum: num(0.25),
            Offset: n.CombineXYZ({x: 0.1}).vector,
            Flag: n.Boolean({boolean: false}).boolean,
        }, 5)
        const i = zone.iteration
        const moved = n.SetPosition({geometry: zone.input.Geometry, offset: n.CombineXYZ({z: i.mul(0.1), x: zone.input.Sum}).vector}).geometry
        const out = zone.output({
            Geometry: moved,
            Count: n.IntegerMath({operation: 'MULTIPLY', value: zone.input.Count, value1: i.add(1)}).value,
            Sum: zone.input.Sum.add(i.mul(0.5)),
            Offset: n.VectorMath({operation: 'SCALE', vector: zone.input.Offset, scale: 1.5}).vector,
            Flag: n.BooleanMath({operation: 'NOT', boolean: zone.input.Flag}).boolean,
        })
        let geo = store(out.Geometry, 'POINT', 'count', out.Count)
        geo = store(geo, 'POINT', 'sum', out.Sum)
        geo = store(geo, 'POINT', 'offset', out.Offset)
        return store(geo, 'POINT', 'flag', out.Flag)
    })
    for (const count of [0, -3]) {
        add(`repeat-count-${count < 0 ? 'negative' : 'zero'}`, `${count} iterations: the inputs pass through`, g => {
            const zone = g.repeatZone({Geometry: n.MeshCube().mesh, Value: num(3)}, count)
            const out = zone.output({Geometry: n.MeshLine().mesh, Value: zone.input.Value.mul(2)})
            return store(out.Geometry, 'POINT', 'v', out.Value)
        })
    }
    add('repeat-border', 'The count and a value inside the body come from outside the zone', g => {
        const steps = n.IntegerMath({operation: 'ADD', value: n.Integer({integer: 2}).integer, value1: 1}).value
        const outside = num(0.3)
        const zone = g.repeatZone({Geometry: n.MeshLine({count: 3}).mesh}, steps)
        const out = zone.output({Geometry: n.TransformGeometry({geometry: zone.input.Geometry, translation: n.CombineXYZ({y: outside}).vector, scale: [1.2, 1, 1]}).geometry})
        return out.Geometry
    })
    add('repeat-field-item', 'A field carried as an item grows by one operation per iteration, evaluated after the loop', g => {
        const zone = g.repeatZone({Field: n.Position().position.z, Geometry: n.MeshGrid({verticesX: 5, verticesY: 5, sizeX: 2, sizeY: 2}).mesh}, 4)
        const next = n.Math({operation: 'SINE', value: zone.input.Field.add(n.Position().position.x)}).value
        const out = zone.output({Field: next, Geometry: zone.input.Geometry})
        return store(out.Geometry, 'POINT', 'f', out.Field)
    })
    add('repeat-anonymous', 'Extrude Mesh in the body, its Top field carried to the next iteration as the selection', g => {
        const zone = g.repeatZone({Geometry: n.MeshGrid({verticesX: 3, verticesY: 3}).mesh, Selection: n.Boolean({boolean: true}).boolean}, 3)
        const ex = n.ExtrudeMesh({mesh: zone.input.Geometry, offsetScale: 0.2, selection: zone.input.Selection})
        const out = zone.output({Geometry: ex.mesh, Selection: ex.top})
        return store(out.Geometry, 'FACE', 'top', out.Selection)
    })
    add('repeat-nested', 'A zone inside a zone, the inner count read from the outer iteration', g => {
        const outer = g.repeatZone({Geometry: n.MeshLine({count: 1}).mesh}, 3)
        const inner = g.repeatZone({Geometry: outer.input.Geometry}, n.IntegerMath({operation: 'ADD', value: outer.iteration, value1: 1}).value)
        const cube = n.TransformGeometry({geometry: n.MeshCube({size: [0.2, 0.2, 0.2]}).mesh, translation: n.CombineXYZ({x: outer.iteration, y: inner.iteration}).vector}).geometry
        const innerOut = inner.output({Geometry: n.JoinGeometry({geometry: [inner.input.Geometry, cube]}).geometry})
        const out = outer.output({Geometry: innerOut.Geometry})
        return out.Geometry
    })
    const step = geometryNodes('Grow', g => {
        const geometry = g.input.geometry('Geometry')
        const amount = g.input.float('Amount', {default: 0.1})
        g.output.geometry('Geometry', n.ExtrudeMesh({mesh: geometry, mode: 'EDGES', offset: [0, 0, 1], offsetScale: amount}).mesh)
    })
    add('repeat-group', 'A node group in the body, called once per iteration', g => {
        const zone = g.repeatZone({Geometry: n.MeshLine({count: 4, offset: [0.5, 0, 0]}).mesh}, 3)
        const out = zone.output({Geometry: g.group(step, {geometry: zone.input.Geometry, amount: zone.iteration.add(1).mul(0.25)}).outputs.geometry})
        return out.Geometry
    })
    return cases
}
