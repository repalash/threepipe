import {describe, expect, it} from 'vitest'
import {geometryNodes, n, NodeGroup} from '../dsl/builder'
import {toCode} from '../dsl/toCode'
import {GeometryNodesEvaluator} from './evaluator'
import {zoneCases} from '../../tests/parity/cases/zones'
import '../nodes'

const positions = (group: NodeGroup | {library: any, group: string}) => {
    const [library, name] = group instanceof NodeGroup ? [group.json, group.name] : [group.library, group.group]
    return Array.from(new GeometryNodesEvaluator(library, name).evaluate().geometry!.mesh?.positions ?? [])
}

describe('repeat zones', () => {
    it('re-runs the zone only when a value it reads changes', () => {
        const group = geometryNodes('Zone', g => {
            const shift = g.input.float('Shift', {default: 0.5})
            const lift = g.input.float('Lift', {default: 0})
            const zone = g.repeatZone({Geometry: n.MeshLine({count: 3}).mesh}, 4)
            const moved = n.SetPosition({geometry: zone.input.Geometry, offset: n.CombineXYZ({x: shift, y: zone.iteration}).vector}).geometry
            const out = zone.output({Geometry: moved})
            g.output.geometry('Geometry', n.SetPosition({geometry: out.Geometry, offset: n.CombineXYZ({z: lift}).vector}).geometry)
        })
        const ev = new GeometryNodesEvaluator(group.json, 'Zone')
        const first = ev.evaluate()
        const p0 = Array.from(first.geometry!.mesh!.positions)
        // 4 iterations of +0.5 in x and +iteration in y (0+1+2+3).
        expect(p0.slice(0, 3)).toEqual([2, 6, 0])
        expect(ev.evaluate().stats.executed).toBe(0)
        // Only the node after the zone reads Lift: the zone is reused.
        ev.setInput('Lift', 1)
        const lifted = ev.evaluate()
        expect(Array.from(lifted.geometry!.mesh!.positions).slice(0, 3)).toEqual([2, 6, 1])
        expect(lifted.stats.executed).toBeLessThan(4)
        // Shift is read inside the body (a border link): the zone runs again.
        ev.setInput('Shift', 1)
        const shifted = ev.evaluate()
        expect(Array.from(shifted.geometry!.mesh!.positions).slice(0, 3)).toEqual([4, 6, 1])
        expect(shifted.stats.executed).toBeGreaterThan(first.stats.executed / 2)
    })

    it('prints as code that rebuilds the same zones', () => {
        for (const c of zoneCases()) {
            const code = toCode(c.library, c.group)
            expect(code).toContain('g.repeatZone(')
            // The root group is printed last.
            const v = [...code.matchAll(/const (\w+) = geometryNodes\(/g)].pop()![1]
            const rebuilt = new Function('geometryNodes', 'n', `${code}\nreturn ${v}`)(geometryNodes, n) as NodeGroup
            expect(positions(rebuilt), c.id).toEqual(positions(c))
        }
    })
})
