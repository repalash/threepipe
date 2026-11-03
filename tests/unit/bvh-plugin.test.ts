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
    const helperRoot = new Object3D() // where scene.addObject puts the BVH helpers (addToRoot)
    const object3dManager = new tp.Object3DManager()
    const viewer = Object.assign(new EventDispatcher<any>(), {
        object3dManager,
        // the model root is the scene here: the object events that bubble to the scene reach it
        scene: Object.assign(modelRoot, {modelRoot, addObject: (o: Object3D) => helperRoot.add(o) && o}),
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
    return {viewer, plugin, add, frame, helperRoot}
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

    test('a draw range change rebuilds the tree: the triangles that it adds are hit', () => {
        const {add, frame} = setup()
        const m = add(200, 32)
        const g = m.geometry!
        g.setDrawRange(0, 3000) // the first 1000 triangles
        frame()
        const tree = g.boundsTree
        expect(tree).toBeDefined()
        const brute = (r: Raycaster) => {
            const list: Intersection[] = []
            Mesh.prototype.raycast.call(m, r, list)
            return list.sort((a, b) => a.distance - b.distance)
                .map(h => ({distance: +h.distance.toFixed(6), faceIndex: h.faceIndex, object: h.object}))
        }
        expect(rays().map(r => hits(m, r))).toEqual(rays().map(brute))

        g.setDrawRange(0, Infinity)
        g.setDirty()
        frame()
        expect(g.boundsTree).not.toBe(tree)
        const expected = rays().map(brute)
        expect(expected.flat().length).toBeGreaterThan(0)
        expect(rays().map(r => hits(m, r))).toEqual(expected)
    })

    test('a mesh that switches to a geometry with a tree raycasts with it', async() => {
        const {add, frame} = setup()
        const big = add(200, 32)
        const small = add(20, 8)
        frame()
        expect(big.geometry!.boundsTree).toBeDefined()
        expect(small.raycast).toBe(Mesh.prototype.raycast)

        small.geometry = big.geometry
        await Promise.resolve()
        expect(small.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        const r = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
        expect(hits(small, r).map(h => h.distance)).toEqual(hits(big, r).map(h => h.distance))

        small.geometry = new TorusKnotGeometry(1, 0.3, 20, 8) as any
        await Promise.resolve()
        expect(small.raycast).toBe(Mesh.prototype.raycast)
    })

    test('Show boxes: the helper goes when its mesh switches geometry, and all helpers go when the plugin is removed', async() => {
        const {viewer, plugin, add, frame, helperRoot} = setup()
        const big = add(200, 32)
        const small = add(20, 8)
        frame()
        plugin.showHelper(big, true)
        expect(helperRoot.children.length).toBe(1)

        big.geometry = small.geometry
        await Promise.resolve()
        expect(helperRoot.children.length).toBe(0)

        // a tree that the plugin did not build (not in its stats)
        const other = add(20, 8)
        other.geometry!.boundsTree = new threeMeshBVH.MeshBVH(other.geometry!)
        plugin.showHelper(other, true)
        plugin.showHelper(big, true)
        expect(helperRoot.children.length).toBe(2)
        plugin.onRemove(viewer)
        expect(helperRoot.children.length).toBe(0)
    })

    test('Show boxes: a helper belongs to its mesh; it goes when the mesh leaves, is off or unsupported, or the plugin is disabled', () => {
        const {viewer, plugin, add, frame, helperRoot} = setup()
        const a = add(200, 32)
        const shared = new Mesh(a.geometry as any, a.material as any) as any as import('threepipe').IObject3D
        viewer.scene.modelRoot.add(shared)
        viewer.object3dManager.registerObject(shared)
        frame()
        const tree = a.geometry!.boundsTree
        expect(tree).toBeDefined()

        // the mesh with the helper leaves the scene; the geometry keeps its other mesh and its tree
        plugin.showHelper(a, true)
        expect(helperRoot.children.length).toBe(1)
        viewer.scene.modelRoot.remove(a)
        viewer.object3dManager.unregisterObject(a)
        expect(helperRoot.children.length).toBe(0)
        expect(shared.geometry!.boundsTree).toBe(tree)
        expect(shared.raycast).toBe(threeMeshBVH.acceleratedRaycast)

        // userData.bvh off on the mesh
        plugin.showHelper(shared, true)
        expect(helperRoot.children.length).toBe(1)
        shared.userData.bvh = 'off'
        plugin.refreshObject(shared)
        expect(helperRoot.children.length).toBe(0)
        plugin.showHelper(shared, true) // no helper for a mesh that is off
        expect(helperRoot.children.length).toBe(0)
        shared.userData.bvh = 'auto'
        plugin.refreshObject(shared)
        frame()

        // unsupported (an own raycast), noticed on refreshAll
        plugin.showHelper(shared, true)
        expect(helperRoot.children.length).toBe(1)
        shared.raycast = () => undefined
        plugin.refreshAll()
        expect(helperRoot.children.length).toBe(0)
        delete (shared as any).raycast

        // disabled: also the helper of a tree that the plugin did not build
        const other = add(20, 8)
        other.geometry!.boundsTree = new threeMeshBVH.MeshBVH(other.geometry!)
        plugin.showHelper(other, true)
        expect(helperRoot.children.length).toBe(1)
        plugin.enabled = false
        expect(helperRoot.children.length).toBe(0)
    })

    test('a change of the groups rebuilds the tree: the triangles that they add are hit', () => {
        const {add, frame} = setup()
        const m = add(200, 32)
        m.material = [new MeshBasicMaterial(), new MeshBasicMaterial()] as any // three.js raycasts only the groups with an array
        const g = m.geometry!
        g.addGroup(0, 3000, 0) // the first 1000 triangles
        frame()
        const tree = g.boundsTree
        expect(tree).toBeDefined()
        const brute = (r: Raycaster) => {
            const list: Intersection[] = []
            Mesh.prototype.raycast.call(m, r, list)
            return list.sort((a, b) => a.distance - b.distance)
                .map(h => ({distance: +h.distance.toFixed(6), faceIndex: h.faceIndex, object: h.object}))
        }
        expect(rays().map(r => hits(m, r))).toEqual(rays().map(brute))
        const hitsBefore = rays().map(r => hits(m, r)).flat().length

        g.clearGroups()
        g.addGroup(0, 3000, 0)
        g.addGroup(3000, g.index!.count - 3000, 1) // the same triangle count and draw range, more triangles in groups
        g.setDirty()
        frame()
        expect(g.boundsTree).not.toBe(tree)
        const expected = rays().map(brute)
        expect(expected.flat().length).toBeGreaterThan(hitsBefore)
        expect(rays().map(r => hits(m, r))).toEqual(expected)
    })

    test('a mesh with one material whose groups leave out triangles keeps the raycast of three.js, which ignores the groups', () => {
        const {plugin, add, frame} = setup()
        const m = add(200, 32)
        const g = m.geometry!
        // a tree covers only the groups; three.js raycasts the whole draw range of a mesh with one material
        g.addGroup(0, 3000, 0)
        const expected = rays().map(r => hits(m, r))
        frame()
        expect(plugin.canUse(m)).toBe(false)
        expect(plugin.statusOf(m)).toContain('Not supported')
        expect(m.raycast).toBe(Mesh.prototype.raycast)
        expect(rays().map(r => hits(m, r))).toEqual(expected)

        // groups that cover the draw range: the tree has every triangle
        const m2 = add(200, 32)
        const g2 = m2.geometry!
        g2.addGroup(0, 3000, 0)
        g2.addGroup(3000, Infinity, 0)
        const expected2 = rays().map(r => hits(m2, r))
        frame()
        expect(m2.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        expect(rays().map(r => hits(m2, r))).toEqual(expected2)

        // an update that leaves a gap: the tree is dropped and the mesh gets the raycast of three.js back
        g2.clearGroups()
        g2.addGroup(0, 3000, 0)
        g2.setDirty()
        frame()
        expect(Object.prototype.hasOwnProperty.call(m2, 'raycast')).toBe(false)
        expect(rays().map(r => hits(m2, r))).toEqual(expected2)
    })

    test('a material change checks the mesh again: one material on groups with gaps gets the raycast of three.js back, a material array the tree', () => {
        const {add, frame} = setup()
        const m = add(200, 32)
        const array = [new MeshBasicMaterial(), new MeshBasicMaterial()]
        m.material = array as any // three.js raycasts only the groups of a mesh with an array
        m.geometry!.addGroup(0, 3000, 0)
        frame()
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        // one material (as PickingPlugin.removeMaterial sets): three.js raycasts the whole draw range, the tree does not
        m.material = new MeshBasicMaterial() as any
        expect(Object.prototype.hasOwnProperty.call(m, 'raycast')).toBe(false)
        m.material = array as any
        frame()
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
    })

    test('a geometry update can give a tree to a geometry that had none: it grows past autoMinTriangles, or a gap in its groups closes, also after it lost its tree', () => {
        const {add, frame, plugin} = setup()
        // small: no tree in auto mode
        const small = add(10, 4)
        frame()
        expect(small.geometry!.boundsTree).toBeUndefined()
        small.geometry!.copy(new TorusKnotGeometry(1, 0.3, 200, 32))
        small.geometry!.setDirty()
        frame()
        expect(small.geometry!.boundsTree).toBeInstanceOf(threeMeshBVH.MeshBVH)
        expect(small.raycast).toBe(threeMeshBVH.acceleratedRaycast)

        // one material on groups with a gap: no tree; the gap closes: a tree; it opens again and closes again: a tree
        const m = add(200, 32)
        const g = m.geometry!
        const groups = (full: boolean) => {
            g.clearGroups()
            g.addGroup(0, 3000, 0)
            if (full) g.addGroup(3000, Infinity, 0)
            g.setDirty()
            frame()
        }
        groups(false)
        expect(m.raycast).toBe(Mesh.prototype.raycast)
        groups(true)
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        groups(false)
        expect(m.raycast).toBe(Mesh.prototype.raycast)
        groups(true)
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        expect(plugin.builtCount).toBe(2)
    })

    test('a geometry update that keeps the triangles but makes the mesh unsupported (morph targets) gives it the raycast of three.js back', () => {
        const {add, frame} = setup()
        const m = add(200, 32)
        frame()
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        const g = m.geometry!
        g.morphAttributes.position = [g.attributes.position.clone()] // the same counts, draw range and groups
        g.setDirty()
        frame()
        expect(Object.prototype.hasOwnProperty.call(m, 'raycast')).toBe(false)
        expect(g.boundsTree).toBeUndefined()
    })

    test('a tree from outside: refitted when the vertices move, replaced when the triangles change; disabled or removed, the plugin stops using it', () => {
        const {viewer, plugin, add, frame} = setup()
        const m = add(200, 32)
        const g = m.geometry!
        const outside = new threeMeshBVH.MeshBVH(g)
        g.boundsTree = outside as any
        plugin.refreshAll()
        expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        const brute = (r: Raycaster) => {
            const list: Intersection[] = []
            Mesh.prototype.raycast.call(m, r, list)
            return list.sort((a, b) => a.distance - b.distance)
                .map(h => ({distance: +h.distance.toFixed(6), faceIndex: h.faceIndex, object: h.object}))
        }
        // the vertices move: the same tree, refitted
        const pos = g.attributes.position
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + 0.7, pos.getY(i) + 0.4, pos.getZ(i)) // out of the old boxes
        pos.needsUpdate = true
        g.computeBoundingSphere()
        g.computeBoundingBox()
        g.setDirty()
        frame()
        expect(g.boundsTree).toBe(outside)
        expect(rays().map(r => hits(m, r))).toEqual(rays().map(brute))
        // other triangles (the draw range): the old tree no longer fits, the plugin builds its own
        g.setDrawRange(0, 3000)
        g.setDirty()
        frame()
        expect(g.boundsTree).toBeDefined()
        expect(g.boundsTree).not.toBe(outside)
        expect(rays().map(r => hits(m, r))).toEqual(rays().map(brute))

        // disabled, then removed: a tree from outside stays on the geometry, the mesh gets the raycast of three.js back
        const o2 = add(200, 32)
        const t2 = new threeMeshBVH.MeshBVH(o2.geometry!)
        o2.geometry!.boundsTree = t2 as any
        plugin.refreshAll()
        expect(o2.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        plugin.enabled = false
        expect(Object.prototype.hasOwnProperty.call(o2, 'raycast')).toBe(false)
        expect(o2.geometry!.boundsTree).toBe(t2)
        plugin.enabled = true
        expect(o2.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        plugin.onRemove(viewer)
        expect(Object.prototype.hasOwnProperty.call(o2, 'raycast')).toBe(false)
        expect(o2.geometry!.boundsTree).toBe(t2)
    })

    test('a tree from outside without the drawn triangles (the range option, a later draw range) is not used for raycasts; one with them is', () => {
        const {plugin, add, frame} = setup()
        const brute = (m: Object3D) => (r: Raycaster) => {
            const list: Intersection[] = []
            Mesh.prototype.raycast.call(m, r, list)
            return list.sort((a, b) => a.distance - b.distance)
                .map(h => ({distance: +h.distance.toFixed(6), faceIndex: h.faceIndex, object: h.object}))
        }
        const half = 6400 * 3 // the knot has 12800 triangles
        const fallsBack = (drawCount: number, range?: {start: number, count: number}, indirect = false) => {
            const m = add(200, 32)
            const g = m.geometry!
            const tree = new threeMeshBVH.MeshBVH(g, {range, indirect})
            g.boundsTree = tree as any
            g.setDrawRange(0, drawCount)
            plugin.refreshAll()
            frame()
            expect(m.raycast).toBe(Mesh.prototype.raycast)
            expect(g.boundsTree).toBe(tree) // the tree stays: it is not the plugin's
            const expected = rays().map(brute(m))
            expect(expected.flat().length).toBeGreaterThan(0)
            expect(rays().map(r => hits(m, r))).toEqual(expected)
        }
        // fewer triangles than the mesh draws: the first half, in the index or in an indirect buffer
        fallsBack(Infinity, {start: 0, count: half})
        fallsBack(Infinity, {start: 0, count: half}, true)
        // the same number, other triangles: the mesh draws the first half, the tree has the second
        fallsBack(half, {start: half, count: half})
        // more triangles than the mesh draws: the tree was built before the draw range changed
        fallsBack(half)

        // exactly the drawn triangles, from a range: used
        const exact = add(200, 32)
        exact.geometry!.boundsTree = new threeMeshBVH.MeshBVH(exact.geometry!, {range: {start: 0, count: half}, indirect: true}) as any
        exact.geometry!.setDrawRange(0, half)
        plugin.refreshAll()
        expect(exact.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        const expected = rays().map(brute(exact))
        expect(expected.flat().length).toBeGreaterThan(0)
        expect(rays().map(r => hits(exact, r))).toEqual(expected)

        // a tree that replaces an adopted one is checked again: a full tree, then one with half the triangles
        const swap = add(200, 32)
        swap.geometry!.boundsTree = new threeMeshBVH.MeshBVH(swap.geometry!) as any
        plugin.refreshAll()
        expect(swap.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        swap.geometry!.boundsTree = new threeMeshBVH.MeshBVH(swap.geometry!, {range: {start: 0, count: half}}) as any
        plugin.refreshAll()
        expect(swap.raycast).toBe(Mesh.prototype.raycast)

        // the same for a tree of the plugin that is replaced from outside
        const own = add(200, 32)
        frame()
        expect(plugin.statusOf(own)).toMatch(/triangles/)
        expect(own.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        own.geometry!.boundsTree = new threeMeshBVH.MeshBVH(own.geometry!, {range: {start: 0, count: half}}) as any
        plugin.refreshAll()
        expect(own.raycast).toBe(Mesh.prototype.raycast)
    })

    test('a mesh added to a shared geometry with a tree: only that mesh is checked, not every mesh of the geometry', () => {
        const {plugin, viewer, add, frame} = setup()
        const a = add(200, 32)
        frame()
        const others = Array.from({length: 20}, () => {
            const m = new Mesh(a.geometry!, a.material as any) as any
            viewer.scene.modelRoot.add(m)
            viewer.object3dManager.registerObject(m)
            return m
        })
        expect(others.every(m => m.raycast === threeMeshBVH.acceleratedRaycast)).toBe(true)
        const canUse = vi.spyOn(plugin, 'canUse')
        const last = new Mesh(a.geometry!, a.material as any) as any
        viewer.scene.modelRoot.add(last)
        viewer.object3dManager.registerObject(last)
        expect(last.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        expect(canUse.mock.calls.filter(c => c[0] === last).length).toBeGreaterThan(0)
        // none of the other meshes of the geometry is checked again (it was every one of them, N² for N meshes)
        expect(canUse.mock.calls.filter(c => others.includes(c[0])).length).toBe(0)
    })

    test('a mesh that leaves the scene gets the raycast of three.js back, also when its geometry keeps the tree; added again, it uses the tree', async() => {
        const {viewer, add, frame} = setup()
        const a = add(200, 32)
        const b = add(20, 8)
        b.geometry = a.geometry // the two meshes share the geometry and its tree
        await Promise.resolve() // the geometry switch acts in a microtask
        frame()
        expect(b.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        viewer.scene.modelRoot.remove(b)
        viewer.object3dManager.unregisterObject(b)
        expect(Object.prototype.hasOwnProperty.call(b, 'raycast')).toBe(false)
        expect(a.raycast).toBe(threeMeshBVH.acceleratedRaycast)
        viewer.scene.modelRoot.add(b)
        viewer.object3dManager.registerObject(b)
        expect(b.raycast).toBe(threeMeshBVH.acceleratedRaycast)
    })

    test('a geometry switch and a removal of the plugin in the same task: the deferred handling does nothing after the removal', async() => {
        const {viewer, plugin, add} = setup()
        const a = add(200, 32)
        const b = add(20, 8)
        a.geometry!.boundsTree = new threeMeshBVH.MeshBVH(a.geometry!) as any // a tree from outside
        b.geometry = a.geometry
        plugin.onRemove(viewer)
        await Promise.resolve() // the deferred handling of the geometry switch
        expect(Object.prototype.hasOwnProperty.call(b, 'raycast')).toBe(false)
        expect(a.geometry!.hasEventListener('geometryUpdate', (plugin as any)._geometryUpdate)).toBe(false)
    })

    describe('enabled off, then on', () => {
        /** The state after a toggle: off has no tree, the raycast of three.js and an Off status; on has them back */
        function expectOff(plugin: import('threepipe').BVHPlugin, m: import('threepipe').IObject3D) {
            expect(plugin.isDisabled()).toBe(true)
            expect(m.geometry!.boundsTree).toBeUndefined()
            expect(plugin.builtCount).toBe(0)
            expect(m.raycast).toBe(Mesh.prototype.raycast)
            expect(plugin.statusOf(m)).toBe('Off (the plugin is disabled)')
        }
        function expectOn(plugin: import('threepipe').BVHPlugin, m: import('threepipe').IObject3D) {
            expect(plugin.isDisabled()).toBe(false)
            expect(m.geometry!.boundsTree).toBeInstanceOf(threeMeshBVH.MeshBVH)
            expect(plugin.builtCount).toBe(1)
            expect(m.raycast).toBe(threeMeshBVH.acceleratedRaycast)
            expect(plugin.statusOf(m)).toContain('12,800 triangles')
        }

        test('the trees, the accelerated raycasts, the events and the status follow each toggle', () => {
            const {plugin, add, frame} = setup()
            const m = add(200, 32)
            const expected = rays().map(r => hits(m, r))
            const events: string[] = []
            plugin.addEventListener('bvhBuilt', () => events.push('built'))
            plugin.addEventListener('bvhDisposed', () => events.push('disposed'))
            frame()
            expectOn(plugin, m)
            for (let i = 0; i < 3; i++) {
                plugin.enabled = false
                expectOff(plugin, m)
                frame()
                expectOff(plugin, m)
                plugin.enabled = true
                expect(plugin.statusOf(m)).toBe('Queued')
                frame()
                expectOn(plugin, m)
                expect(rays().map(r => hits(m, r))).toEqual(expected)
            }
            expect(events).toEqual(['built', 'disposed', 'built', 'disposed', 'built', 'disposed', 'built'])
        })

        test('quick toggles before a frame, an odd number: off, also in the status of a mesh that was queued; on again builds the tree', () => {
            const {plugin, add, frame} = setup()
            const m = add(200, 32)
            for (let i = 0; i < 7; i++) plugin.enabled = !plugin.enabled // queued, then toggled before the build
            expectOff(plugin, m)
            frame()
            expectOff(plugin, m)
            plugin.enabled = true
            frame()
            expectOn(plugin, m)
        })

        test('toggles while three-mesh-bvh loads: the state when the module arrives decides', async() => {
            const sequences: ((p: import('threepipe').BVHPlugin) => void)[] = [
                p => { p.enabled = false; p.enabled = true }, // off and on before the load: on
                p => { p.enabled = false }, // off during the load: off, then on after it
                p => { for (let i = 0; i < 6; i++) p.enabled = !p.enabled }, // quick toggles, an even number: on
            ]
            for (const toggle of sequences) {
                let resolve!: (lib: typeof threeMeshBVH) => void
                const {plugin, add, frame} = setup({load: async() => new Promise(r => resolve = r)})
                const m = add(200, 32)
                frame() // no module yet: nothing is built
                expect(plugin.statusOf(m)).toBe('Loading three-mesh-bvh…')
                toggle(plugin)
                if (plugin.enabled) expect(plugin.statusOf(m)).toBe('Loading three-mesh-bvh…')
                else expectOff(plugin, m)
                resolve(threeMeshBVH)
                await vi.waitFor(() => expect(plugin.lib).toBe(threeMeshBVH))
                frame()
                if (!plugin.enabled) {
                    expectOff(plugin, m)
                    plugin.enabled = true
                    frame()
                }
                expectOn(plugin, m)
            }
        })

        test('off and on after the UI showed the mesh: the tree is built again, its memory is the tree only', () => {
            const {plugin, add, frame} = setup()
            const m = add(200, 32)
            frame()
            expectOn(plugin, m)
            // a UI that shows the selected mesh links its geometry's config to the parent configs (uiconfig-tweakpane
            // sets __uiParent), up to the plugin, its viewer and lib: a module namespace, an object without a constructor
            const g = m.geometry as any
            g.uiConfig = {type: 'folder', children: [], __uiParent: {children: [{property: [plugin, 'enabled']}]}}
            plugin.enabled = false
            plugin.enabled = true
            expect(() => frame()).not.toThrow()
            expectOn(plugin, m)
            const {roots, indirectBuffer} = threeMeshBVH.MeshBVH.serialize(g.boundsTree, {cloneBuffers: false})
            const bytes = roots.reduce((s, r) => s + r.byteLength, 0) + (indirectBuffer?.byteLength ?? 0)
            expect(plugin.statusOf(m)).toContain(`${(bytes / 1e6).toFixed(2)} MB`)
            expect(plugin.memoryMB).toBe(Math.round(bytes / 1e5) / 10)
        })

        test('a build that throws: the error is logged, the frame goes on and the other trees are built', () => {
            const {viewer, plugin, add, frame} = setup()
            const a = add(200, 32)
            const b = add(150, 32)
            const lib = plugin.lib!
            plugin.lib = {...lib, MeshBVH: Object.assign(function(this: any, geometry: any, options: any) {
                if (geometry === a.geometry) throw new Error('no tree')
                return new lib.MeshBVH(geometry, options)
            }, {serialize: lib.MeshBVH.serialize}) as any}
            expect(() => frame()).not.toThrow()
            expect(viewer.console.error).toHaveBeenCalledTimes(1)
            expect(a.geometry!.boundsTree).toBeUndefined()
            expect(a.raycast).toBe(Mesh.prototype.raycast)
            expect(b.geometry!.boundsTree).toBeInstanceOf(threeMeshBVH.MeshBVH)
            expect(plugin.builtCount).toBe(1)
        })
    })
})
