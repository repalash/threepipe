import {describe, expect, test, vi} from 'vitest'
// through the index: importing core files one by one hits an import cycle (iLightCommons before iObjectCommons)
import {BoxGeometry, Mesh, PerspectiveCamera2, RootScene} from '../../index'

function makeScene() {
    const camera = new PerspectiveCamera2('', undefined, 45)
    camera.position.set(0, 0, 10)
    const scene = new RootScene(camera)
    scene.flushSceneBounds()
    return {scene, camera}
}

describe('RootScene scene bounds', () => {
    test('adding many objects computes the bounds once, at the flush', () => {
        const {scene} = makeScene()
        const getBounds = vi.spyOn(scene, 'getBounds')
        const updates = vi.fn()
        scene.addEventListener('sceneUpdate', updates)
        for (let i = 0; i < 20; i++) {
            const m = new Mesh(new BoxGeometry(1, 1, 1))
            m.position.set(i, 0, 0)
            scene.addObject(m)
        }
        // the events still fire for every add, as before
        expect(updates.mock.calls.length).toBeGreaterThanOrEqual(20)
        // but nothing walked the scene yet
        expect(getBounds).not.toHaveBeenCalled()
        // one flush: the near/far bounds and the scene bounds, two walks for all 20 adds
        expect(scene.flushSceneBounds()).toBe(true)
        expect(getBounds).toHaveBeenCalledTimes(2)
        // nothing changed since: no work
        expect(scene.flushSceneBounds()).toBe(false)
        expect(getBounds).toHaveBeenCalledTimes(2)
    })

    test('the flushed values follow the scene', () => {
        const {scene, camera} = makeScene()
        const m = new Mesh(new BoxGeometry(2, 2, 2))
        scene.addObject(m)
        scene.flushSceneBounds()
        const uniforms = {sceneBoundingRadius: {value: 0}}
        scene.updateShaderProperties({defines: {}, uniforms})
        expect(uniforms.sceneBoundingRadius.value).toBeCloseTo(Math.sqrt(12) / 2, 5)
        const far1 = camera.far
        // a far away object grows the bounds: the radius and the camera's far plane update at the next flush (or read)
        const n = new Mesh(new BoxGeometry(2, 2, 2))
        n.position.set(0, 0, -200)
        scene.addObject(n)
        scene.updateShaderProperties({defines: {}, uniforms})
        expect(uniforms.sceneBoundingRadius.value).toBeGreaterThan(100)
        expect(camera.far).toBeGreaterThan(far1)
    })
})
