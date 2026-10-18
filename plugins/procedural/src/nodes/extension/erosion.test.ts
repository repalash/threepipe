import {describe, expect, it} from 'vitest'
import {geometryNodes, n} from '../../dsl/builder'
import {erode} from '../../extension/erosion'
import {GeometryNodesEvaluator} from '../../runtime/evaluator'
import '..'

/** A 24 x 24 grid with noise heights, eroded by the node; the masks stored as named attributes. */
function graph(seed: number, thermal = false) {
    return geometryNodes('Eroded', g => {
        const grid = n.MeshGrid({sizeX: 10, sizeY: 10, verticesX: 24, verticesY: 24}).mesh
        const h = n.NoiseTexture({scale: 0.4}).fac
        const hilly = n.SetPosition({geometry: grid, offset: n.CombineXYZ({z: h.mul(3)}).vector}).geometry
        const er = n.ThreepipeErosion({mesh: hilly, seed, thermal, dropletsPerCell: 3})
        let out = n.StoreNamedAttribute({geometry: er.mesh, name: 'flow', value: er.flow}).geometry
        out = n.StoreNamedAttribute({geometry: out, name: 'talus', value: er.talus}).geometry
        g.output.geometry('Geometry', out)
    })
}

const evaluate = (seed: number, thermal = false) => new GeometryNodesEvaluator(graph(seed, thermal).json, 'Eroded').evaluate().geometry!.mesh!

describe('ThreepipeErosion', () => {
    it('erodes the grid heights exactly as the kit does, in Grid-node vertex order', () => {
        const before = new GeometryNodesEvaluator(geometryNodes('Hills', g => {
            const grid = n.MeshGrid({sizeX: 10, sizeY: 10, verticesX: 24, verticesY: 24}).mesh
            g.output.geometry('Geometry', n.SetPosition({geometry: grid, offset: n.CombineXYZ({z: n.NoiseTexture({scale: 0.4}).fac.mul(3)}).vector}).geometry)
        }).json, 'Hills').evaluate().geometry!.mesh!
        const N = 24, step = 10 / 23
        const hs = new Float32Array(N * N)
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) hs[j * N + i] = before.positions[(i * N + j) * 3 + 2]
        // Float sockets hold float32 values: the kit's defaults as the node passes them.
        const f = Math.fround
        const masks = erode(hs, N, step, {hydraulic: {seed: 7, dropletsPerCell: 3, radius: 3, inertia: f(0.05), capacity: 4, minCapacity: f(0.01),
            erodeSpeed: f(0.3), depositSpeed: f(0.3), evaporateSpeed: f(0.01), gravity: 4, lifetime: 30}, weight: () => 1})
        const after = evaluate(7)
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                expect(after.positions[(i * N + j) * 3 + 2]).toBe(hs[j * N + i])
                expect((after.attributes.get('flow')!.data as Float32Array)[i * N + j]).toBe(masks.flow[j * N + i])
            }
        }
        // x and y untouched, something eroded.
        expect(Array.from(after.positions).filter((_, k) => k % 3 !== 2)).toEqual(Array.from(before.positions).filter((_, k) => k % 3 !== 2))
        expect(Array.from(after.positions).some((v, k) => v !== before.positions[k])).toBe(true)
    })

    it('is reactive and deterministic', () => {
        expect(Array.from(evaluate(1).positions)).toEqual(Array.from(evaluate(1).positions))
        expect(Array.from(evaluate(1).positions)).not.toEqual(Array.from(evaluate(2).positions))
        const thermal = evaluate(1, true)
        expect(Array.from(thermal.attributes.get('talus')!.data).some(v => v > 0)).toBe(true)
    })

    it('rejects meshes that are not square grids', () => {
        const group = geometryNodes('Bad', g => {
            g.output.geometry('Geometry', n.ThreepipeErosion({mesh: n.MeshGrid({verticesX: 5, verticesY: 4}).mesh}).mesh)
        })
        expect(() => new GeometryNodesEvaluator(group.json, 'Bad').evaluate()).toThrow(/square grid/)
    })
})
