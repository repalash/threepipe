/**
 * BVHPlugin: meshes in `auto` mode from `autoMinTriangles` triangles get a three-mesh-bvh tree after a frame, and their
 * raycasts give the same hits as without it. `userData.bvh` (`on`, `off`), `enabled` and geometry updates build, refit
 * or drop the trees.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Intersection, Mesh, MeshBasicMaterial, Object3D, Raycaster, TorusKnotGeometry, Vector3} from 'three'
import * as threeMeshBVH from 'three-mesh-bvh'

// Deferred import: threepipe core has circular static-init dependencies that only resolve once the graph is loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

/** A viewer with the parts the plugin uses: the object manager, the model root and the postFrame event */
function setup(options: ConstructorParameters<typeof tp.BVHPlugin>[1] = {lib: threeMeshBVH}) {
    const modelRoot = new Object3D()
    const object3dManager = new tp.Object3DManager()
    const viewer = Object.assign(new EventDispatcher<any>(), {
        object3dManager,
        scene: {modelRoot, add: (o: Object3D) => modelRoot.add(o)},
        console: {error: vi.fn(), warn: vi.fn(), log: vi.fn()},
        setDirty: vi.fn(),
    }) as any
    const plugin = new tp.BVHPlugin(true, options)
    plugin.onAdded(viewer)
    const add = (tubular: number, radial: number) => {
        const m = new Mesh(new TorusKnotGeometry(1, 0.3, tubular, radial), new MeshBasicMaterial()) as any as import('threepipe').IObject3D
        modelRoot.add(m)
        object3dManager.registerObject(m)
        return m
    }
    const frame = () => viewer.dispatchEvent({type: 'postFrame'})
    return {viewer, plugin, add, frame}
}

/** Rays from around the knot towards its centre */
function rays() {
    const list: Raycaster[] = []
    for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2
        const origin = new Vector3(Math.cos(a) * 4, Math.sin(a * 3) * 0.5, Math.sin(a) * 4)
        list.push(new Raycaster(origin, new Vector3(0.1 * Math.sin(a * 5), 0, 0).sub(origin).normalize()))
    }
    return list
}

const hits = (m: Object3D, r: Raycaster) => r.intersectObject(m, false)
    .map((h: Intersection) => ({distance: +h.distance.toFixed(6), faceIndex: h.faceIndex, object: h.object}))

describe('BVHPlugin', () => {
    test('a big mesh gets a tree after a frame and raycasts with the same hits', () => {
        const {plugin, add, frame} = setup()
        const m = add(200, 32) // 12800 triangles
        const expected = rays().map(r => hits(m, r))
        expect(m.geometry!.boundsTree).toBeUndefined()

        frame()
        expect(m.geometry!.boundsTree).toBeInstanceOf(threeMeshBVH.MeshBVH)
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        expect(plugin.builtCount).toBe(1)
        expect(plugin.statusOf(m)).toContain('12,800 triangles')

        const actual = rays().map(r => hits(m, r))
        expect(expected.some(h => h.length > 0)).toBe(true)
        expect(actual).toEqual(expected)
    })

    test('a small mesh gets no tree in auto mode; userData.bvh on and off build and drop it', () => {
        const {plugin, add, frame} = setup()
        const m = add(20, 8) // 320 triangles
        frame()
        expect(m.geometry!.boundsTree).toBeUndefined()
        expect(plugin.modeOf(m)).toBe('auto')

        m.userData.bvh = 'on'
        plugin.refreshObject(m)
        frame()
        expect(m.geometry!.boundsTree).toBeDefined()
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)

        m.userData.bvh = 'off'
        plugin.refreshObject(m)
        expect(m.geometry!.boundsTree).toBeUndefined()
        expect(m.raycast).toBe(Mesh.prototype.raycast)
        expect(Object.prototype.hasOwnProperty.call(m, 'raycast')).toBe(false)
    })

    test('enabled false drops the trees, true builds them again', () => {
        const {plugin, add, frame} = setup()
        const m = add(200, 32)
        frame()
        expect(m.geometry!.boundsTree).toBeDefined()

        plugin.enabled = false
        expect(m.geometry!.boundsTree).toBeUndefined()
        expect(m.raycast).toBe(Mesh.prototype.raycast)
        frame()
        expect(m.geometry!.boundsTree).toBeUndefined()

        plugin.enabled = true
        frame()
        expect(m.geometry!.boundsTree).toBeDefined()
    })

    test('a geometry update refits the tree when the triangle count is the same, else builds it again', () => {
        const {plugin, add, frame} = setup()
        const m = add(200, 32)
        frame()
        const g = m.geometry!
        const tree = g.boundsTree!
        const refit = vi.spyOn(tree, 'refit')

        g.translate(0, 1, 0)
        g.setDirty()
        expect(refit).toHaveBeenCalledTimes(1)
        expect(g.boundsTree).toBe(tree)
        // the refitted tree has the moved triangles: the same hits as the raycast of three.js without a tree
        const moved = rays().map(r => (r.ray.origin.y += 1, r))
        const expected = moved.map(r => {
            const list: Intersection[] = []
            Mesh.prototype.raycast.call(m, r, list)
            return list.sort((a, b) => a.distance - b.distance)
                .map(h => ({distance: +h.distance.toFixed(6), faceIndex: h.faceIndex, object: h.object}))
        })
        expect(expected.some(h => h.length > 0)).toBe(true)
        expect(moved.map(r => hits(m, r))).toEqual(expected)

        g.setIndex(Array.from(g.index!.array.slice(0, 3000)))
        g.setDirty()
        expect(g.boundsTree).toBeUndefined()
        frame()
        expect(g.boundsTree).toBeDefined()
        expect(g.boundsTree).not.toBe(tree)
        expect(plugin.statusOf(m)).toContain('1,000 triangles')
    })

    test('skinned and instanced meshes are not supported', () => {
        const {plugin} = setup()
        const skinned = Object.assign(new Mesh(new TorusKnotGeometry()), {isSkinnedMesh: true})
        const instanced = Object.assign(new Mesh(new TorusKnotGeometry()), {isInstancedMesh: true})
        const ownRaycast = Object.assign(new Mesh(new TorusKnotGeometry()), {raycast: () => undefined})
        expect(plugin.canUse(new Mesh(new TorusKnotGeometry()))).toBe(true)
        expect(plugin.canUse(skinned)).toBe(false)
        expect(plugin.canUse(instanced)).toBe(false)
        expect(plugin.canUse(ownRaycast)).toBe(false)
    })

    test('getBVH builds the tree at once; onRemove drops all trees', () => {
        const {viewer, plugin, add} = setup()
        const m = add(20, 8)
        const tree = plugin.getBVH(m)
        expect(tree).toBeInstanceOf(threeMeshBVH.MeshBVH)
        expect(m.geometry!.boundsTree).toBe(tree)

        plugin.onRemove(viewer)
        expect(m.geometry!.boundsTree).toBeUndefined()
        expect(m.raycast).toBe(Mesh.prototype.raycast)
    })

    test('the module from load() is used once it resolves; a failed load logs an error', async() => {
        const ok = setup({load: async() => threeMeshBVH})
        const m = ok.add(200, 32)
        ok.frame()
        expect(m.geometry!.boundsTree).toBeUndefined()
        await vi.waitFor(() => expect(ok.plugin.lib).toBe(threeMeshBVH))
        ok.frame()
        expect(m.geometry!.boundsTree).toBeDefined()

        const failed = setup({load: async() => Promise.reject(new Error('not installed'))})
        await vi.waitFor(() => expect(failed.viewer.console.error).toHaveBeenCalled())
        expect(failed.plugin.lib).toBeUndefined()
    })
})
