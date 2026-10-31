/**
 * userData keys that start with `_` or `__` are private: they are not saved by `toJSON`, and the cameras do not
 * load them in `fromJSON`. See the note on `IObject3D.userData`.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {Mesh, Object3D} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

/** All the keys in a JSON value, at every depth. */
function allKeys(value: any, keys: string[] = []): string[] {
    if (!value || typeof value !== 'object') return keys
    for (const [k, v] of Object.entries(value)) {
        if (!Array.isArray(value)) keys.push(k)
        allKeys(v, keys)
    }
    return keys
}
const privateKeys = (json: any) => allKeys(JSON.parse(JSON.stringify(json))).filter(k => k.startsWith('_'))

const userData = () => ({
    keep: 'value',
    nested: {a: 1, _b: 2, __c: 3},
    _private: 'kept on clone',
    __runtime: 'not kept on clone',
})

describe.each([
    ['PerspectiveCamera2', () => new tp.PerspectiveCamera2()],
    ['OrthographicCamera2', () => new tp.OrthographicCamera2()],
] as const)('%s userData', (_, create) => {
    function mainCamera() {
        const camera = create()
        Object.assign(camera.userData, userData())
        camera.activateMain(undefined, true)
        expect(camera.isMainCamera).toBe(true)
        expect(camera.userData.__lastScale).toBeDefined()
        return camera
    }

    test('toJSON of a main camera has no private key, and keeps the other keys', () => {
        const camera = mainCamera()
        const json = camera.toJSON()
        expect(privateKeys(json)).toEqual([])
        expect(json.userData.keep).toBe('value')
        expect(json.userData.nested).toEqual({a: 1})
        expect(json.object.userData.keep).toBe('value')
        expect(json.object.userData.nested).toEqual({a: 1})
    })

    test('toJSON does not change the camera', () => {
        const camera = mainCamera()
        const ud = camera.userData
        camera.toJSON()
        expect(camera.userData).toBe(ud)
        expect(camera.isMainCamera).toBe(true)
        expect(camera.userData.__lastScale).toBeDefined()
        expect(camera.userData._private).toBe('kept on clone')
        expect(camera.userData.nested).toEqual({a: 1, _b: 2, __c: 3})
    })

    test('fromJSON does not make a camera the main camera', () => {
        const data = mainCamera().toJSON()
        // files saved before the fix carry the private keys
        data.userData = {...data.userData, __isMainCamera: true, __lastScale: {x: 2, y: 2, z: 2, isVector3: true}, _private: 'old'}

        const camera = create()
        camera.fromJSON(data)
        expect(camera.isMainCamera).toBe(false)
        expect(camera.userData.__lastScale).toBeUndefined()
        expect(camera.userData._private).toBeUndefined()
        expect(camera.userData.keep).toBe('value')
    })

    test('fromJSON keeps the main camera the main camera', () => {
        const data = create().toJSON()
        data.userData = {...data.userData, __isMainCamera: false, keep: 'new'}

        const camera = mainCamera()
        const lastScale = camera.userData.__lastScale
        camera.fromJSON(data)
        expect(camera.isMainCamera).toBe(true)
        expect(camera.userData.__lastScale).toBe(lastScale)
        expect(camera.userData._private).toBe('kept on clone')
        expect(camera.userData.keep).toBe('new')
    })
})

describe('Object3D toJSON userData', () => {
    test('a light does not save private keys', () => {
        const light = new tp.DirectionalLight2()
        Object.assign(light.userData, userData())
        expect(light.userData.__autoBubbleToParentEvents).toBeDefined() // set by upgradeObject3D

        const json = light.toJSON()
        expect(privateKeys(json.object.userData)).toEqual([])
        expect(json.object.userData.keep).toBe('value')
        expect(json.object.userData.nested).toEqual({a: 1})
        expect(light.userData.__runtime).toBe('not kept on clone')
    })

    test('a mesh and its children do not save private keys', () => {
        const mesh = new Mesh()
        tp.iObjectCommons.upgradeObject3D.call(mesh as any)
        Object.assign(mesh.userData, userData())
        const child = new Object3D()
        Object.assign(child.userData, userData())
        mesh.add(child) // upgraded when added

        const json = mesh.toJSON()
        expect(privateKeys(json.object.userData)).toEqual([])
        expect(privateKeys(json.object.children[0].userData)).toEqual([])
        expect(json.object.userData).toEqual({keep: 'value', nested: {a: 1}})
        expect(json.object.children[0].userData).toEqual({keep: 'value', nested: {a: 1}})
        expect(mesh.userData).toMatchObject(userData())
    })

    test('an object without public keys saves no userData', () => {
        const object = new tp.Object3D2()
        object.userData.__runtime = true
        expect(object.toJSON().object.userData).toBeUndefined()
    })

    test('clone still keeps _ keys and drops __ keys', () => {
        const object = new tp.Object3D2()
        Object.assign(object.userData, userData())
        const clone = object.clone()
        expect(clone.userData._private).toBe('kept on clone')
        expect(clone.userData.__runtime).toBeUndefined()
        expect(clone.userData.nested).toEqual({a: 1, _b: 2})
    })
})
