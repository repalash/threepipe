import {describe, expect, it} from 'vitest'
import {NodeSession} from '../src/node/NodeSession'

/**
 * `light {position, target}` aims the light at a world point. threepipe's directional and spot lights keep their target
 * as a child at (0, 0, -1) (glTF KHR_lights_punctual: a light shines down its -z), so the command turns the light; it
 * used to write the world point into the child's local position, which left the light pointing elsewhere - with
 * `target: [0, 0, 0]` at itself, lighting nothing.
 */
describe('light target', () => {
    const dir = (s: NodeSession, name: string) => {
        const light = s.viewer.scene.modelRoot.children.find(c => c.name === name) as any
        light.updateMatrixWorld(true)
        const from = light.getWorldPosition(light.position.clone())
        const to = light.target.getWorldPosition(light.position.clone())
        return to.sub(from).normalize().toArray().map((v: number) => +v.toFixed(5))
    }
    const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map(x => +(x / l).toFixed(5)) }

    it('turns a directional light to face the target', async() => {
        const s = new NodeSession()
        expect((await s.run({op: 'light', name: 'sun', type: 'directional', position: [3, 5, 2], target: [0, 0, 0]})).ok).toBe(true)
        expect(dir(s, 'sun')).toEqual(unit([-3, -5, -2]))
        // a new target, and then a new position with the same target
        await s.run({op: 'light', name: 'sun', target: [1, 0, -1]})
        expect(dir(s, 'sun')).toEqual(unit([-2, -5, -3]))
        await s.run({op: 'light', name: 'sun', position: [-4, 6, 0]})
        expect(dir(s, 'sun')).toEqual(unit([5, -6, -1]))
        s.dispose()
    })

    it('turns a spot light to face the target', async() => {
        const s = new NodeSession()
        await s.run({op: 'light', name: 'spot', type: 'spot', position: [0, 4, 4], target: [0, 0, 0]})
        expect(dir(s, 'spot')).toEqual(unit([0, -4, -4]))
        s.dispose()
    })
})
