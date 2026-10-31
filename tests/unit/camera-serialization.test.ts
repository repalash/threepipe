import {describe, expect, test} from 'vitest'
import {OrthographicCamera2, PerspectiveCamera2} from '../../src'

// a camera made the main camera, as RootScene does
function mainCamera(camera: PerspectiveCamera2 | OrthographicCamera2) {
    camera.activateMain(undefined, true)
    return camera
}

describe.each([
    ['PerspectiveCamera2', () => new PerspectiveCamera2()],
    ['OrthographicCamera2', () => new OrthographicCamera2()],
])('%s serialization', (_name, make) => {
    test('the main camera state is not saved', () => {
        const camera = mainCamera(make())
        expect(camera.isMainCamera).toBe(true)
        const json = camera.toJSON()
        expect(json.userData.__isMainCamera).toBeUndefined()
        expect(json.userData.__lastScale).toBeUndefined()
        expect(camera.isMainCamera).toBe(true) // the camera keeps it
    })

    test('a load keeps the main camera state of the camera, not the one in the data (an older file saved it)', () => {
        const saved = mainCamera(make()).toJSON()
        // a file saved before the fix: the camera was the main camera then
        saved.userData = {...saved.userData, __isMainCamera: true, __lastScale: {isVector3: true, x: 2, y: 2, z: 2}}
        const camera = make()
        camera.fromJSON(saved)
        expect(camera.isMainCamera).toBe(false)
        expect(camera.userData.__lastScale).toBeUndefined()

        // and the main camera stays the main camera when the data says it is not
        const main = mainCamera(make())
        main.fromJSON({...saved, userData: {...saved.userData, __isMainCamera: false}})
        expect(main.isMainCamera).toBe(true)
    })
})
