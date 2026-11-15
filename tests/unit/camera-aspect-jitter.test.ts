/**
 * The jitter of SSAAPlugin calls `setViewOffset` with the render size times the render scale. three sets the camera's
 * aspect to that ratio, which at a fractional scale can differ from the canvas ratio in the last bit. With autoAspect,
 * that is not a change: the camera must not be marked dirty, or progressive rendering restarts on every frame.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

// 1000 x 639 at scale 1.5656: (1000 * 1.5656) / (639 * 1.5656) is 1 ulp above 1000 / 639
const canvas = {clientWidth: 1000, clientHeight: 639} as HTMLCanvasElement
const scale = 1.5656

function aspectDirtyCalls(spy: ReturnType<typeof vi.fn>) {
    return spy.mock.calls.filter(c => c[0]?.change === 'aspect').length
}

describe('PerspectiveCamera2 aspect', () => {
    test('the scaled ratio really differs from the canvas ratio (the case under test)', () => {
        expect((canvas.clientWidth * scale) / (canvas.clientHeight * scale)).not.toBe(canvas.clientWidth / canvas.clientHeight)
    })

    test('setViewOffset with the scaled render size does not mark an autoAspect camera dirty', () => {
        const camera = new tp.PerspectiveCamera2('', canvas)
        expect(camera.autoAspect).toBe(true)
        expect(camera.aspect).toBe(canvas.clientWidth / canvas.clientHeight)
        const setDirty = vi.spyOn(camera, 'setDirty')
        const w = canvas.clientWidth * scale, h = canvas.clientHeight * scale
        for (let i = 0; i < 4; i++) { // a few jittered frames
            camera.setViewOffset(w, h, 0.25 - i * 0.1, -0.25 + i * 0.1, w, h)
            camera.clearViewOffset()
        }
        expect(aspectDirtyCalls(setDirty as any)).toBe(0)
    })

    test('a real aspect change on an autoAspect camera is still reset to the canvas ratio and marks it dirty', () => {
        const camera = new tp.PerspectiveCamera2('', canvas)
        const setDirty = vi.spyOn(camera, 'setDirty')
        camera.aspect = 2
        expect(camera.aspect).toBe(canvas.clientWidth / canvas.clientHeight)
        expect(aspectDirtyCalls(setDirty as any)).toBeGreaterThan(0)
    })

    test('without autoAspect, any aspect change marks the camera dirty and is kept', () => {
        const camera = new tp.PerspectiveCamera2('', canvas, false)
        const setDirty = vi.spyOn(camera, 'setDirty')
        const next = (canvas.clientWidth * scale) / (canvas.clientHeight * scale)
        camera.aspect = next
        expect(camera.aspect).toBe(next)
        expect(aspectDirtyCalls(setDirty as any)).toBe(1)
    })
})
