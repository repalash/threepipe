import {describe, expect, test, vi} from 'vitest'
import {PerspectiveCamera2, RootScene, TonemapPlugin} from 'threepipe'

describe('RootScene background', () => {
    test('backgroundBlurriness is saved and loaded with the scene', () => {
        const scene = new RootScene(new PerspectiveCamera2())
        expect(scene.backgroundBlurriness).toBe(0)
        scene.backgroundBlurriness = 0.4
        const json = scene.toJSON()
        expect(json.backgroundBlurriness).toBe(0.4)
        const scene2 = new RootScene(new PerspectiveCamera2())
        scene2.fromJSON(json)
        expect(scene2.backgroundBlurriness).toBe(0.4)
    })
    test('a change of backgroundBlurriness marks the scene dirty', () => {
        const scene = new RootScene(new PerspectiveCamera2())
        const onUpdate = vi.fn()
        scene.addEventListener('sceneUpdate', onUpdate)
        scene.backgroundBlurriness = 0.5
        expect(onUpdate).toHaveBeenCalled()
    })
})

describe('TonemapPlugin background tone mapping', () => {
    // the define function of the screen pass extension, with a viewer that has or has not a primary GBuffer
    const define = (backgroundTonemap: boolean, hasGBuffer: boolean) => {
        const plugin = new TonemapPlugin()
        ;(plugin as any)._viewer = {
            scene: {backgroundTonemap},
            renderManager: {gbufferUnpackExtension: hasGBuffer ? {extraDefines: {HAS_GBUFFER: () => 1}} : undefined},
        }
        return {plugin, value: () => (plugin as any).extraDefines.TONEMAP_BACKGROUND()}
    }
    test('scene.backgroundTonemap false turns the background tone mapping off', () => {
        expect(define(true, true).value()).toBe('1')
        expect(define(false, true).value()).toBe('0')
    })
    test('without a GBuffer it warns once, since the screen pass cannot find the background pixels', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const d = define(false, false)
        d.value(); d.value()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(String(warn.mock.calls[0][0])).toMatch(/GBufferPlugin or DepthBufferPlugin/)
        warn.mockClear()
        define(false, true).value()
        define(true, false).value()
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
    })
})
