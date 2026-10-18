import {expect, it} from 'vitest'
import {geometryNodes, n} from '../dsl/builder'
import {GeometryNodesEvaluator} from '../runtime/evaluator'
import '../nodes'

// The examples/procedural-terrain graph, evaluated headless: counts, cache reuse on an input change.
it('evaluates the terrain example graph and re-runs only what an input reaches', () => {
    const terrain = geometryNodes('Terrain', g => {
        g.input.geometry('Geometry')
        const size = g.input.float('Size', {default: 20})
        const resolution = g.input.int('Resolution', {default: 96})
        const height = g.input.float('Height', {default: 4})
        const seed = g.input.float('Seed', {default: 0})
        const grid = n.MeshGrid({sizeX: size, sizeY: size, verticesX: resolution, verticesY: resolution})
        const noise = n.NoiseTexture({noiseDimensions: '4D', w: seed, scale: 0.12, detail: 6, roughness: 0.55})
        const lifted = n.SetPosition({geometry: grid.mesh, offset: n.CombineXYZ({z: noise.fac.sub(0.5).mul(height)}).vector})
        g.output.geometry('Geometry', n.SetShadeSmooth({geometry: lifted.geometry}).geometry)
    })
    const ev = new GeometryNodesEvaluator(terrain.toJSON(), 'Terrain')
    let t = performance.now()
    const r1 = ev.evaluate()
    const first = performance.now() - t
    expect(r1.geometry!.mesh!.vertsNum).toBe(96 * 96)
    ev.setInput('Height', 6)
    t = performance.now()
    const r2 = ev.evaluate()
    const second = performance.now() - t
    // The grid is not rebuilt for a height change.
    expect(r2.stats.reused).toBeGreaterThan(0)
    console.log(`terrain 96x96: first ${first.toFixed(0)} ms, height change ${second.toFixed(0)} ms, executed ${r2.stats.executed}, reused ${r2.stats.reused}`)
})
