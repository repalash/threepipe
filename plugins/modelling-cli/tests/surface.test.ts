import {describe, expect, it} from 'vitest'
import {NodeSession} from '../src/node/NodeSession'

/** `uv`, `material {preset, relief}` and `decal` in a Node session (no rasteriser: decals are geometry only). */
describe('surface commands', () => {
    it('uv cube-projects, and a relief preset puts a shared tiling normal map on the material', async() => {
        const s = new NodeSession()
        expect((await s.run({op: 'primitive', type: 'cube', name: 'a', size: 8})).ok).toBe(true)
        expect((await s.run({op: 'primitive', type: 'cube', name: 'b', size: 8, position: [20, 0, 0]})).ok).toBe(true)
        const uv = await s.run({op: 'uv', object: ['a', 'b'], size: 4})
        expect(uv.ok).toBe(true)
        const m = await s.run({op: 'material', object: ['a', 'b'], preset: 'leather-black'})
        expect(m.ok).toBe(true)
        // Node cannot encode textures, so the relief is left out with a warning (the browser test checks it on)
        expect(String(m.warnings)).toMatch(/need a browser session/)
        const viewer = (s as any).viewer
        const mats = ['a', 'b'].map(n => viewer.scene.getObjectByName(n).material)
        expect(mats[0].normalMap ?? null).toBeNull()
        expect(mats[0].roughness).toBeCloseTo(0.53)
        expect((await s.exportGlb()).byteLength).toBeGreaterThan(100)
        // an override wins over the preset, and relief none removes the map
        await s.run({op: 'material', object: 'a', preset: 'glass', roughness: 0.1})
        expect(mats[0].transmission).toBe(1)
        expect(mats[0].roughness).toBeCloseTo(0.1)
        expect(mats[0].normalMap).toBeNull()
        s.dispose()
    })

    it('material relief in Node warns instead of making an unsavable texture', async() => {
        const s = new NodeSession()
        await s.run({op: 'lathe', name: 'l', axis: 'y', segments: 8, profile: [[0, 0], [1, 0], [1, 1], [0, 1]]})
        const m = await s.run({op: 'material', object: 'l', relief: {pattern: 'grain', strength: 0.2}})
        expect(m.ok).toBe(true)
        expect(String(m.warnings)).toMatch(/browser session/)
        s.dispose()
    })

    it('decal plane / wrap / project build quad grids with UVs where they should', async() => {
        const s = new NodeSession()
        const plane = await s.run({op: 'decal', name: 'p', at: [0, 0, 1], normal: [0, 0, 1], size: [10, 2], content: {text: {text: 'Canon'}}})
        expect(plane.ok).toBe(true)
        expect(String(plane.warnings)).toMatch(/cannot rasterise/)
        let b = (await s.run({op: 'inspect', object: 'p'})).data as any
        expect(b.bounds.size[0]).toBeCloseTo(10)
        expect(b.bounds.size[1]).toBeCloseTo(2)
        expect(b.worldBounds.min[2]).toBeCloseTo(1.05)
        // wrap round the z axis at radius 10: the print stays on the cylinder r = 10.05
        const wrap = await s.run({op: 'decal', name: 'w', mode: 'wrap', at: [0, 10, 0], up: [0, 0, 1], size: [Math.PI * 5, 2],
            wrap: {axis: [0, 0, 1], center: [0, 0, 0]}, content: {text: {text: 'EF 24-105'}}, segments: [16, 1]})
        expect(wrap.ok).toBe(true)
        const d = (await s.run({op: 'inspect', object: 'w', detail: true})).data as any
        for (const v of d.vertices) expect(Math.hypot(v[0], v[1])).toBeCloseTo(10.05, 4)
        // text reads from outside: with up +z at +y, u (and the text) runs towards -x
        const xs = d.vertices.map((v: number[]) => v[0])
        expect(xs[0]).toBeGreaterThan(0)
        expect(xs[16]).toBeLessThan(0)
        // project onto a sphere: the grid follows its surface
        await s.run({op: 'primitive', type: 'sphere', name: 'ball', radius: 10, segments: 48, rings: 24})
        const proj = await s.run({op: 'decal', name: 'q', mode: 'project', object: 'ball', at: [0, 0, 10], normal: [0, 0, 1], size: [8, 4], content: {text: {text: 'x'}}})
        expect(proj.ok).toBe(true)
        const q = (await s.run({op: 'inspect', object: 'q', detail: true})).data as any
        for (const v of q.vertices) expect(Math.hypot(...v as [number, number, number])).toBeGreaterThan(9.8)
        b = q.bounds
        expect(b.size[2]).toBeGreaterThan(0.5) // curved, not flat
        // larger than the ball: the cells that miss it are left out, nothing floats on the plane
        const big = await s.run({op: 'decal', name: 'big', mode: 'project', object: 'ball', at: [0, 0, 10], normal: [0, 0, 1], size: [30, 30], content: {text: {text: 'x'}}, segments: [12, 12]})
        expect(String(big.warnings)).toMatch(/left out/)
        const bg = (await s.run({op: 'inspect', object: 'big', detail: true})).data as any
        expect(bg.faces).toBeLessThan(144)
        for (const v of bg.vertices) expect(Math.hypot(...v as [number, number, number])).toBeCloseTo(10.05, 0)
        s.dispose()
    })
})
