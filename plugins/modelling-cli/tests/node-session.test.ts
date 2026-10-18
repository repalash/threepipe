import {describe, expect, it} from 'vitest'
import {NodeSession} from '../src/node/NodeSession'

describe('NodeSession', () => {
    it('runs commands on a real viewer with no WebGL', async() => {
        const s = new NodeSession()
        const r = await s.run({op: 'primitive', type: 'cube', name: 'box', size: 2})
        expect(r.ok).toBe(true)
        const i = await s.run({op: 'inspect', object: 'box', detail: true})
        expect(i.ok).toBe(true)
        expect((i.data as any).edgeVerts.length).toBe(12)
        const look = await s.run({op: 'look'})
        expect(look.ok).toBe(false)
        expect(look.error).toContain('cannot render')
        const glb = await s.exportGlb()
        expect(glb.byteLength).toBeGreaterThan(100)
        s.dispose()
    })
})
