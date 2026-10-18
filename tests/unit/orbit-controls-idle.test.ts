/**
 * An idle `OrbitControls3.update()` leaves the camera exactly where it was (Node).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {PerspectiveCamera} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

function controls(position: [number, number, number], target: [number, number, number]) {
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
    // The listeners OrbitControls attaches; nothing here dispatches events.
    const noop = () => undefined
    const root = {addEventListener: noop, removeEventListener: noop}
    const element = {style: {}, addEventListener: noop, removeEventListener: noop, getRootNode: () => root,
        ownerDocument: root, setPointerCapture: noop, releasePointerCapture: noop} as unknown as HTMLElement
    const c = new tp.OrbitControls3(camera, element)
    c.throttleUpdate = 0
    // placed the way a viewer places it: position and target set, then the controls update each frame
    camera.position.set(...position)
    c.target.set(...target)
    camera.lookAt(c.target)
    return {camera, c}
}

describe('OrbitControls3 idle updates', () => {
    it('do not move the camera by rounding', () => {
        // [6, 4, 6] about [0, 0.5, 0] came back as [6, 4, 6.000000000000001] after one frame.
        const {camera, c} = controls([6, 4, 6], [0, 0.5, 0])
        for (let i = 0; i < 10; i++) c.update()
        expect(camera.position.toArray()).toEqual([6, 4, 6])
        expect(c.target.toArray()).toEqual([0, 0.5, 0])
    })

    it('still apply limits to an idle camera', () => {
        const {camera, c} = controls([0, 0, 0.1], [0, 0, 0])
        c.minDistance = 1
        c.update()
        expect(camera.position.length()).toBeCloseTo(1, 6)
    })
})
