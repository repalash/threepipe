/**
 * GPUPickingPlugin.pick: the camera narrowed to the pixel under the point, the object ids, the hit point from the read
 * depth and the normal (perspective and orthographic cameras), the filter, and the renderer and layer state put back
 * after a pick. The renderer is a stand-in: its render() raycasts through the centre of the picking camera's view and
 * writes what the GPU would for the front hit: the id, the view depth, and the view-space normal (normal matrix,
 * flipped on a back face) octahedral-encoded in blue and alpha. Like the GPU, it culls each draw (mesh, or geometry
 * group of a multi-material mesh) by the `side` that the override material has after its onBeforeRender.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {
    BackSide,
    BoxGeometry,
    BufferGeometry,
    Camera,
    Color,
    DoubleSide,
    FrontSide,
    Intersection,
    Material,
    Matrix3,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Vector2,
    Vector3,
} from 'three'

// Deferred import: threepipe core has circular static-init dependencies that only resolve once the graph is loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

const W = 200, H = 100
const doubleSided = new MeshBasicMaterial({side: DoubleSide})

/** Octahedral encoding of a unit vector into [-1, 1]², as the fragment shader of the plugin writes it */
function octEncode(n: Vector3): [number, number] {
    const s = Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z)
    const x = n.x / s, y = n.y / s
    if (n.z >= 0) return [x, y]
    return [(1 - Math.abs(y)) * (x >= 0 ? 1 : -1), (1 - Math.abs(x)) * (y >= 0 ? 1 : -1)]
}

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
    const state = {target: 'screen' as any, clearAlpha: 0.5, renders: 0, layerMeshes: [] as string[], flatNormal: null as boolean | null}
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
            rc.layers.mask = cam.layers.mask // what the picking camera draws
            rc.setFromCamera(new Vector2(0, 0), cam) // the centre of the 1×1 view
            // all the faces along the ray, both sides (the meshes' own materials swapped for double-sided ones)
            const own = meshes.map(m => m.material)
            meshes.forEach(m => m.material = Array.isArray(m.material) ? m.material.map(() => doubleSided) : doubleSided)
            const hits = rc.intersectObjects(meshes, false)
            meshes.forEach((m, i) => m.material = own[i])
            renderer.pixel = [0, 0, 0, 0]
            const mat = scene.overrideMaterial
            const rayView = rc.ray.direction.clone().transformDirection(cam.matrixWorldInverse)
            for (const hit of hits) {
                const mesh = hit.object as Mesh
                // three passes the geometry group of a multi-material mesh, else null
                mat.onBeforeRender(renderer, scene, cam, mesh.geometry, mesh, Array.isArray(mesh.material) ? {materialIndex: hit.face!.materialIndex} : null)
                // the vertex shader: normalMatrix (of the model-view matrix) times the object normal
                const modelView = new Matrix4().multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld)
                const n = hit.face!.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(modelView)).normalize()
                const front = n.dot(rayView) < 0
                if (mat.side === FrontSide && !front || mat.side === BackSide && front) continue // culled
                state.flatNormal = mat.uniforms.flatNormal.value
                const viewZ = -hit.point.clone().applyMatrix4(cam.matrixWorldInverse).z
                // gl_FrontFacing: three draws a back-sided material with the front-face winding turned (setFlipSided), so
                // its visible faces are front facing there. The fragment shader flips the normal by gl_FrontFacing and the
                // flipSided uniform.
                const frontFacing = front !== (mat.side === BackSide)
                if (!frontFacing) n.negate()
                if (mat.uniforms.flipSided.value) n.negate()
                renderer.pixel = [mat.uniforms.objectId.value, viewZ, ...octEncode(n)]
                return
            }
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
    const hit = rc.intersectObjects(meshes, false)[0] as Intersection | undefined
    return hit && {...hit, ray: rc.ray.direction.clone()}
}

/**
 * The world normal of the raycast face, from its corners in world space (not from a normal matrix), toward the ray's
 * origin side: the face as the camera sees it.
 */
function faceNormal(hit: NonNullable<ReturnType<typeof raycast>>) {
    const pos = ((hit.object as Mesh).geometry as BufferGeometry).attributes.position
    const [a, b, c] = [hit.face!.a, hit.face!.b, hit.face!.c].map(i => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld))
    const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    if (n.dot(hit.ray) > 0) n.negate()
    return n
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
                expect(result.normal.angleTo(faceNormal(ref))).toBeLessThan(1e-5)
            }
            expect(picked).toEqual(new Set([near, far, null]))
        })

        test(`${name}: the world normal of a rotated, non-uniformly scaled mesh is the raycast face normal`, () => {
            const {plugin, near, far, camera} = setup(make())
            near.rotation.set(0.5, 0.7, 0.2)
            near.scale.set(1.6, 2.5, 0.6)
            near.updateMatrixWorld(true)
            const normals = new Set<string>()
            for (let x = 70.5; x < 130; x += 3) for (let y = 25.5; y < 75; y += 3) {
                const result = plugin.pick(x, y)
                const ref = raycast(camera, [near, far], x, y)
                expect(result?.object ?? null).toBe(ref?.object ?? null)
                if (result?.object !== near || !ref) continue
                expect(result.normal.length()).toBeCloseTo(1, 6)
                expect(result.normal.angleTo(faceNormal(ref))).toBeLessThan(1e-5)
                normals.add(result.normal.toArray().map(v => v.toFixed(3)).join())
            }
            expect(normals.size).toBe(3) // three faces of the box are seen
        })

        test(`${name}: a back face of a double-sided mesh gives the normal toward the camera`, () => {
            const {plugin, near, far, camera} = setup(make())
            near.geometry = new PlaneGeometry(2, 2)
            ;(near.material as MeshBasicMaterial).side = DoubleSide
            near.rotation.set(0.3, Math.PI * 0.8, 0) // its +z side faces away from the camera
            near.updateMatrixWorld(true)
            const front = new Vector3(0, 0, 1).transformDirection(near.matrixWorld)
            for (const [x, y] of [[100.5, 50.5], [95.5, 47.5], [104.5, 53.5]]) {
                const result = plugin.pick(x, y)
                const ref = raycast(camera, [near, far], x, y)
                expect(result?.object).toBe(near)
                expect(ref?.object).toBe(near)
                expect(result!.normal.angleTo(faceNormal(ref!))).toBeLessThan(1e-5)
                expect(result!.normal.angleTo(front.clone().negate())).toBeLessThan(1e-5)
                expect(result!.normal.dot(ref!.ray)).toBeLessThan(0)
            }
        })

        test(`${name}: an unseen back face of a front-sided mesh does not hide the mesh behind it`, () => {
            const {plugin, near, far, camera} = setup(make())
            near.geometry = new PlaneGeometry(2, 2) // FrontSide (the default)
            near.rotation.set(0.3, Math.PI * 0.8, 0) // its front faces away from the camera
            near.updateMatrixWorld(true)
            for (const [x, y] of [[100.5, 50.5], [95.5, 47.5], [104.5, 53.5]]) {
                const result = plugin.pick(x, y)
                const ref = raycast(camera, [near, far], x, y)
                expect(ref?.object).toBe(far)
                expect(result?.object).toBe(far)
                expect(result!.point.distanceTo(ref!.point)).toBeLessThan(1e-5)
                expect(result!.normal.angleTo(faceNormal(ref!))).toBeLessThan(1e-5)
            }
        })

        test(`${name}: a back-sided mesh is hit on its far side, with the normal toward the camera`, () => {
            const {plugin, near, far, camera} = setup(make())
            ;(near.material as MeshBasicMaterial).side = BackSide
            for (const [x, y] of [[100.5, 50.5], [97.5, 48.5], [102.5, 51.5]]) {
                const result = plugin.pick(x, y)
                const ref = raycast(camera, [near, far], x, y)
                expect(ref?.object).toBe(near)
                expect(result?.object).toBe(near)
                expect(result!.point.z).toBeCloseTo(0.5, 5) // the inside of the far face of the box
                expect(result!.point.distanceTo(ref!.point)).toBeLessThan(1e-5)
                expect(result!.normal.angleTo(faceNormal(ref!))).toBeLessThan(1e-5)
                expect(result!.normal.angleTo(new Vector3(0, 0, 1))).toBeLessThan(1e-5)
            }
        })

        test(`${name}: each geometry group of a multi-material mesh is culled by the side of its own material`, () => {
            const {plugin, near, far, camera} = setup(make())
            // the box groups: 0..5 = +x, -x, +y, -y, +z (toward the camera), -z
            const sides = (front: Material['side'], back: Material['side']) => {
                near.material = [0, 1, 2, 3, 4, 5].map(i => new MeshBasicMaterial({side: i === 4 ? front : i === 5 ? back : FrontSide}))
            }
            const check = (object: Mesh, z: number) => {
                for (const [x, y] of [[100.5, 50.5], [98.5, 49.5]]) {
                    const result = plugin.pick(x, y)
                    const ref = raycast(camera, [near, far], x, y)
                    expect(ref?.object).toBe(object)
                    expect(result?.object).toBe(object)
                    expect(result!.point.z).toBeCloseTo(z, 5)
                    expect(result!.normal.angleTo(faceNormal(ref!))).toBeLessThan(1e-5)
                    expect(result!.normal.angleTo(new Vector3(0, 0, 1))).toBeLessThan(1e-5)
                }
            }
            sides(BackSide, DoubleSide) // the near face is culled, the far face is seen from inside
            check(near, 0.5)
            sides(BackSide, FrontSide) // both culled: the box behind
            check(far, -2.5)
            sides(FrontSide, BackSide) // the near face
            check(near, 1.5)
        })
    }

    test('flat normals (from the screen derivatives of the position) for flat-shaded materials and meshes without normals', () => {
        const {plugin, near, state} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        plugin.pick(100.5, 50.5)
        expect(state.flatNormal).toBe(false)
        ;(near.material as MeshBasicMaterial).flatShading = true
        plugin.pick(100.5, 50.5)
        expect(state.flatNormal).toBe(true)
        ;(near.material as MeshBasicMaterial).flatShading = false
        near.geometry = near.geometry.clone().deleteAttribute('normal')
        plugin.pick(100.5, 50.5)
        expect(state.flatNormal).toBe(true)
    })

    test('the plugin is a GPU picker (IGPUPicker), found by isGPUPicker', () => {
        const {plugin} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        const picker: import('threepipe').IGPUPicker = plugin
        expect(picker.isGPUPicker).toBe(true)
    })

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

    test('a mesh on layers that the main camera does not see is not picked and does not hide others', () => {
        const {plugin, near, far} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        near.layers.set(2) // the camera sees layer 0
        expect(plugin.pick(100.5, 50.5)?.object).toBe(far)
        expect(near.layers.mask).toBe(1 << 2)
    })

    test('the point is at the centre of the picked pixel, also for coordinates inside a pixel (sloped surface)', () => {
        const {plugin, near, far, camera} = setup(new PerspectiveCamera(50, W / H, 0.1, 100))
        near.rotation.set(0.5, 0.7, 0)
        near.updateMatrixWorld(true)
        for (const [x, y] of [[100.2, 50.8], [101.9, 49.05], [98.7, 52.3]]) {
            const result = plugin.pick(x, y)
            const ref = raycast(camera, [near, far], Math.floor(x) + 0.5, Math.floor(y) + 0.5)
            expect(result?.object).toBe(near)
            expect(ref?.object).toBe(near)
            expect(result!.distance).toBeCloseTo(ref!.distance, 5)
            expect(result!.point.distanceTo(ref!.point)).toBeLessThan(1e-5)
        }
    })

    test('a camera with a fixed aspect that differs from the canvas: the pick sees what the canvas shows', () => {
        const {plugin, near, far, camera} = setup(new PerspectiveCamera(50, 1, 0.1, 100)) // canvas 2:1
        const picked = new Set<Object3D | null>()
        for (let x = 4.5; x < W; x += 8) for (let y = 4.5; y < H; y += 8) {
            const result = plugin.pick(x, y)
            const ref = raycast(camera, [near, far], x, y)
            expect(result?.object ?? null).toBe(ref?.object ?? null)
            if (result && ref) expect(result.point.distanceTo(ref.point)).toBeLessThan(1e-5)
            picked.add(result?.object ?? null)
        }
        expect(picked).toEqual(new Set([near, far, null]))
        expect((camera as PerspectiveCamera).aspect).toBe(1)
    })
})
