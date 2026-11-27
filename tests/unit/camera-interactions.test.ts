/**
 * Plugins that turn off the user interactions of a camera while they animate it turn them on again on the same camera,
 * also when another camera became the main camera in the meantime.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

// a camera with the parts that the plugins use; `disabledBy` is the set of keys that turned off its interactions
function camera() {
    const disabledBy = new Set<string>()
    return {
        disabledBy,
        userData: {autoLookAtTarget: true},
        position: new (tpVector())(0, 0, 5),
        target: new (tpVector())(),
        controls: {type: 'OrbitControls'},
        setInteractions: (enabled: boolean, key: string) => enabled ? disabledBy.delete(key) : disabledBy.add(key),
        setDirty: vi.fn(),
    }
}
const tpVector = () => tp.Vector3

describe('CameraViewPlugin', () => {
    test('animateToView turns the interactions on again on the camera it animated, not on a new main camera', async() => {
        const a = camera()
        const b = camera()
        const viewer: any = {scene: {mainCamera: a}, setDirty: vi.fn(), console}
        const popmotion = {animateCameraAsync: async() => {
            viewer.scene.mainCamera = b // the app (or the C key of the EditorCameraPlugin) changes the main camera during the animation
        }}
        viewer.getPlugin = (p: any) => p === tp.PopmotionPlugin ? popmotion : undefined
        const plugin = new tp.CameraViewPlugin()
        ;(plugin as any)._viewer = viewer
        await plugin.animateToView(new tp.CameraView('v', new tp.Vector3(1, 2, 3)), 10)
        expect([...a.disabledBy]).toEqual([])
        expect([...b.disabledBy]).toEqual([])
    })

    test('animateToView with a camera that is not the main camera turns its interactions on again', async() => {
        const main = camera()
        const other = camera()
        const viewer: any = {scene: {mainCamera: main}, setDirty: vi.fn(), console}
        viewer.getPlugin = (p: any) => p === tp.PopmotionPlugin ? {animateCameraAsync: async() => undefined} : undefined
        const plugin = new tp.CameraViewPlugin()
        ;(plugin as any)._viewer = viewer
        await plugin.animateToView(new tp.CameraView('v', new tp.Vector3(1, 2, 3)), 10, undefined, other as any)
        expect([...other.disabledBy]).toEqual([])
    })
})

describe('InteractionPromptPlugin', () => {
    function setup() {
        const a = camera()
        const b = camera()
        const viewer: any = {
            scene: {mainCamera: a, modelRoot: {children: [{}]}},
            container: {getBoundingClientRect: () => ({width: 100, height: 100})},
            doOnce: async() => undefined,
        }
        const plugin = new tp.InteractionPromptPlugin()
        ;(plugin as any)._viewer = viewer
        plugin.cursorEl = {style: {}} as any
        return {a, b, viewer, plugin}
    }

    test('stopAnimation turns the interactions on again on the camera it animated, not on a new main camera', async() => {
        const {a, b, viewer, plugin} = setup()
        plugin.startAnimation()
        expect([...a.disabledBy]).toEqual(['InteractionPromptPlugin'])
        viewer.scene.mainCamera = b
        await plugin.stopAnimation()
        expect([...a.disabledBy]).toEqual([])
        expect([...b.disabledBy]).toEqual([])
    })

    test('a new main camera stops the animation: the old camera is put back and its interactions are on', async() => {
        const {a, b, viewer, plugin} = setup()
        plugin.startAnimation()
        const start = a.position.clone()
        viewer.scene.mainCamera = b
        await (plugin as any)._preFrame({deltaTime: 16})
        expect(plugin.animationRunning).toBe(false)
        expect([...a.disabledBy]).toEqual([])
        expect(a.position.distanceTo(start)).toBeLessThan(1e-9) // put back (from spherical coordinates)
        expect(b.position.toArray()).toEqual([0, 0, 5]) // not moved by the animation
    })
})
