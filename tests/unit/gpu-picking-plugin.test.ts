/**
 * GPUPickingPlugin.pick: the camera narrowed to the pixel under the point, the object ids, the hit point from the read
 * depth (perspective and orthographic cameras), the filter, and the renderer and layer state put back after a pick.
 * The renderer is a stand-in: its render() raycasts through the centre of the picking camera's view and writes the id
 * and the view depth of the front hit, as the GPU would.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {BoxGeometry, Camera, Color, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PerspectiveCamera, Raycaster, Vector2} from 'three'

// Deferred import: threepipe core has circular static-init dependencies that only resolve once the graph is loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

const W = 200, H = 100

function setup(camera: Camera) {
    const modelRoot = new Object3D()
    const near = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    near.name = 'near'
    near.position.set(0, 0, 1)
    const far = new Mesh(new BoxGeometry(4, 4, 1), new MeshBasicMaterial())
    far.name = 'far'
    far.position.set(0, 0, -3)
    modelRoot.add(near, far)
    modelRoot.updateMatrixWorld(true)
    camera.position.set(0, 0, 10)
    camera.updateMatrixWorld(true)

    const scene = {modelRoot, mainCamera: camera, overrideMaterial: null as any}
    const clearColor = new Color(0x336699)
    const state = {target: 'screen' as any, clearAlpha: 0.5, renders: 0, layerMeshes: [] as string[]}
    const renderer = {
        userData: {} as any,
        getRenderTarget: () => state.target,
        setRenderTarget: (t: any) => state.target = t,
        getClearColor: (c: Color) => c.copy(clearColor),
        getClearAlpha: () => state.clearAlpha,
        setClearColor: (c: any, a: number) => {
            clearColor.set(c)
            state.clearAlpha = a
        },
        clear: () => undefined,
        renderWithModes: (_ud: any, fn: () => void) => fn(),
        pixel: [0, 0, 0, 0],
        render: (_s: any, cam: PerspectiveCamera | OrthographicCamera) => {
            state.renders++
            const meshes = modelRoot.children.filter(o => o.layers.test(cam.layers)) as Mesh[]
            state.layerMeshes = meshes.map(m => m.name)
            const rc = new Raycaster()
            rc.setFromCamera(new Vector2(0, 0), cam) // the centre of the 1×1 view
            const hit = rc.intersectObjects(meshes, false)[0]
            renderer.pixel = [0, 0, 0, 0]
            if (!hit) return
            const mat = scene.overrideMaterial
            mat.onBeforeRender(renderer, scene, cam, (hit.object as Mesh).geometry, hit.object)
            const viewZ = -hit.point.clone().applyMatrix4(cam.matrixWorldInverse).z
            renderer.pixel = [mat.uniforms.objectId.value, viewZ, 0, 1]
        },
        readRenderTargetPixels: (_t: any, _x: number, _y: number, _w: number, _h: number, out: Float32Array) => out.set(renderer.pixel),
    }
    const viewer = {canvas: {clientWidth: W, clientHeight: H}, scene, renderManager: {renderer}, addEventListener: () => undefined, removeEventListener: () => undefined} as any
    const plugin = new tp.GPUPickingPlugin()
    plugin.onAdded(viewer)
    return {plugin, near, far, state, clearColor, renderer, camera}
}

/** The front hit of a three.js raycast through a canvas point, for comparison */
function raycast(camera: Camera, meshes: Object3D[], x: number, y: number) {
    const rc = new Raycaster()
    rc.setFromCamera(new Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera)
    return rc.intersectObjects(meshes, false)[0]
}

describe('GPUPickingPlugin', () => {
    for (const [name, make] of [
        ['perspective', () => new PerspectiveCamera(50, W / H, 0.1, 100)],
        ['orthographic', () => new OrthographicCamera(-4, 4, 2, -2, 0.1, 100)],
    ] as const) {
        test(`${name}: the front-most mesh and the point and distance of the raycast`, () => {
            const {plugin, near, far, camera} = setup(make())
            const picked = new Set<Object3D | null>()
            for (const [x, y] of [[100.5, 50.5], [101.5, 48.5], [85.5, 40.5], [60.5, 30.5], [140.5, 70.5], [3.5, 3.5]]) {
                const result = plugin.pick(x, y)
                const ref = raycast(camera, [near, far], x, y)
                expect(result?.object ?? null).toBe(ref?.object ?? null)
                picked.add(result?.object ?? null)
                if (!result || !ref) continue
                expect(result.distance).toBeCloseTo(ref.distance, 5)
                expect(result.point.distanceTo(ref.point)).toBeLessThan(1e-5)
            }
            expect(picked).toEqual(new Set([near, far, null]))
        })
    }

    test('the filter leaves meshes out; hidden meshes and meshes outside the model root are not drawn', () => {
        const {plugin, near, far, state} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        expect(plugin.pick(100.5, 50.5, o => o !== near)?.object).toBe(far)
        expect(state.layerMeshes).toEqual(['far'])
        near.visible = false
        expect(plugin.pick(100.5, 50.5)?.object).toBe(far)
        expect(state.layerMeshes).toEqual(['far'])
    })

    test('the render target, clear color, override material and layers are put back', () => {
        const {plugin, near, far, state, clearColor} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        far.layers.enable(tp.GPUPickingPlugin.Layer) // set by someone else: kept
        plugin.pick(100.5, 50.5)
        expect(state.target).toBe('screen')
        expect(clearColor.getHex()).toBe(0x336699)
        expect(state.clearAlpha).toBe(0.5)
        expect(near.layers.isEnabled(tp.GPUPickingPlugin.Layer)).toBe(false)
        expect(far.layers.isEnabled(tp.GPUPickingPlugin.Layer)).toBe(true)
        expect(plugin.lastPickMs).toBeGreaterThanOrEqual(0)
    })

    test('disabled: no render, null', () => {
        const {plugin, state} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        plugin.enabled = false
        expect(plugin.pick(100.5, 50.5)).toBeNull()
        expect(state.renders).toBe(0)
    })
})
