import {describe, expect, it} from 'vitest'
import {GeometryNodesEvaluator} from '../runtime/evaluator'
import {geometryNodes, n} from '../dsl/builder'
import {realizeInstances} from '../geometry/realizeInstances'
import {flattenInstances} from './flattenInstances'
import '../nodes'

describe('flattenInstances', () => {
    it('draws each referenced component once per (nested) instance, at the composed transforms', () => {
        const group = geometryNodes('Nested', g => {
            const cubes = n.InstanceOnPoints({points: n.MeshLine({count: 3, offset: [1, 0, 0]}).mesh, instance: n.MeshCube({size: [0.2, 0.2, 0.2]}).mesh})
            const rows = n.InstanceOnPoints({points: n.MeshLine({count: 2, offset: [0, 2, 0]}).mesh, instance: cubes.instances, rotation: [0, 0, 0.5], scale: 2})
            g.output.geometry('Geometry', n.JoinGeometry({geometry: [rows.instances, n.MeshGrid().mesh]}).geometry)
        })
        const geometry = new GeometryNodesEvaluator(group.toJSON(), 'Nested').evaluate().geometry!
        const list = flattenInstances(geometry)
        // The grid at the root, and the one cube mesh shared by 2 x 3 instances.
        expect(list.meshes.map(m => m.count).sort()).toEqual([1, 6])
        expect(list.draws).toBe(7)
        // Same placement as Blender's realization: the realized vertices are the cube's under each transform.
        const cube = list.meshes.find(m => m.count === 6)!
        const realized = realizeInstances(geometry).mesh!
        const p = cube.component.positions
        const placed: number[] = []
        for (let i = 0; i < cube.count; i++) {
            const t = cube.transforms.subarray(i * 16, i * 16 + 16)
            for (let v = 0; v < cube.component.vertsNum; v++) {
                const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2]
                placed.push(t[0] * x + t[4] * y + t[8] * z + t[12], t[1] * x + t[5] * y + t[9] * z + t[13], t[2] * x + t[6] * y + t[10] * z + t[14])
            }
        }
        // Realization puts the root's own mesh (the grid) first, then the instances in order.
        const grid = list.meshes.find(m => m.count === 1)!.component.vertsNum
        const fromRealized = Array.from(realized.positions.slice(grid * 3, grid * 3 + placed.length))
        expect(realized.vertsNum * 3).toBe(grid * 3 + placed.length)
        placed.forEach((v, i) => expect(v).toBeCloseTo(fromRealized[i], 5))
    })
})
