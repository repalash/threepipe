import {describe, expect, it} from 'vitest'
import {NodeSession} from '../src/node/NodeSession'

describe('part', () => {
    it('builds, places, regenerates, and refuses to regenerate after an edit', async() => {
        const s = new NodeSession()
        const list = await s.run({op: 'part', list: true})
        expect((list.data as any).parts.map((p: any) => p.id)).toContain('product/knurled-ring')
        const r = await s.run({op: 'part', type: 'product/knurled-ring', name: 'focus', params: {radius: 38, length: 14, ribs: 72}, position: [0, 0, 10], rotation: [Math.PI / 2, 0, 0]})
        expect(r.ok).toBe(true)
        expect((r.data as any).groups.knurl.faces).toBe(288)
        let i = (await s.run({op: 'inspect', object: 'focus'})).data as any
        expect(i.worldBounds.size[2]).toBeCloseTo(14, 4) // the +y axis turned onto +z
        expect((await s.run({op: 'validate', object: 'focus'})).ok).toBe(true)
        const again = await s.run({op: 'part', name: 'focus', params: {length: 20}})
        expect(again.ok).toBe(true)
        i = (await s.run({op: 'inspect', object: 'focus'})).data as any
        expect(i.worldBounds.size[2]).toBeCloseTo(20, 4)
        expect((again.data as any).params.ribs).toBe(72) // kept
        await s.run({op: 'bevel', object: 'focus', edges: [0], offset: 0.1})
        const refused = await s.run({op: 'part', name: 'focus', params: {length: 10}})
        expect(refused.ok).toBe(false)
        expect(refused.error).toMatch(/edited/)
        const bad = await s.run({op: 'part', type: 'product/dial', params: {radius: 10}})
        expect(bad.ok).toBe(false)
        expect(bad.error).toMatch(/needs `height`/)
        s.dispose()
    })
})
