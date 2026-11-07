import {BufferGeometry, Mesh, Object3D} from 'three'
import {onChange, serialize} from 'ts-browser-helpers'
import {uiButton, uiFolderContainer, uiInput, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IGeometry, IObject3D, IObjectExtension} from '../../core'

/**
 * When a mesh gets a BVH: `auto` from {@link BVHPlugin.autoMinTriangles} triangles, `on` always, `off` never.
 * Set in `object.userData.bvh` (saved with the object).
 */
export type BVHMode = 'auto' | 'on' | 'off'

/**
 * The part of a `MeshBVH` of three-mesh-bvh that the plugin uses. Cast it to `MeshBVH` for the full API.
 */
export interface IMeshBVH {
    refit(): void
}

/**
 * The parts of the three-mesh-bvh module that the plugin uses. The module itself (`import('three-mesh-bvh')`) fits this type.
 * threepipe does not depend on three-mesh-bvh, its types included.
 */
export interface ThreeMeshBVH {
    MeshBVH: {
        new (geometry: BufferGeometry, options?: {indirect?: boolean, setBoundingBox?: boolean}): IMeshBVH
        /** With `cloneBuffers: false`, the buffers of the tree itself (the plugin reads their size) */
        serialize(bvh: IMeshBVH, options: {cloneBuffers: boolean}): {roots: ArrayBufferLike[], indirectBuffer?: ArrayBufferView | null}
    }
    acceleratedRaycast: Mesh['raycast']
    /** Shows the boxes of `mesh.geometry.boundsTree`, to `depth` levels */
    BVHHelper: new (mesh: Object3D, depth?: number) => Object3D & {dispose(): void}
}

export interface BVHPluginOptions {
    /**
     * The three-mesh-bvh module, when the page already has it: `import * as bvh from 'three-mesh-bvh'`, then `{lib: bvh}`.
     */
    lib?: ThreeMeshBVH
    /**
     * Loads three-mesh-bvh when the plugin is added. With a bundler: `() => import('three-mesh-bvh')`, the bundler puts it
     * in its own chunk.
     * Default: a native `import('three-mesh-bvh')` that bundlers do not see, which needs an import map entry for
     * `three-mesh-bvh` (see {@link BVHPlugin}).
     */
    load?: () => Promise<ThreeMeshBVH>
}

export interface BVHPluginEventMap extends AViewerPluginEventMap {
    bvhBuilt: {geometry: IGeometry, bvh: IMeshBVH, ms: number}
    bvhDisposed: {geometry: IGeometry}
}

// the parts of a MeshBVH that hasDrawnTriangles reads, in a tree from outside
interface MeshBVHTree extends IMeshBVH {
    // goes down the tree: intersectsRange gets the positions of the triangles of a leaf, true stops
    shapecast(callbacks: {intersectsBounds: () => boolean, intersectsRange: (offset: number, count: number) => boolean}): boolean
    // the triangle at a position of the tree. Only a MeshBVH has it: three-mesh-bvh types `geometry.boundsTree` as a
    // GeometryBVH, which can also be a SkinnedMeshBVH, PointsBVH or LineSegmentsBVH
    resolveTriangleIndex?(i: number): number
}

type BVHGeometry = IGeometry & {boundsTree?: MeshBVHTree}

interface BVHStats {
    // the tree the plugin built: a different boundsTree on the geometry is a tree from outside
    tree: MeshBVHTree
    triangles: number
    // what the tree was built from (buildKey): a refit cannot change which triangles are in it
    key: string
    bytes: number
    ms: number
}

// the options of every tree. indirect: the index keeps its order. setBoundingBox false: a box from a tree of part of
// the geometry (draw range, groups) would cull the raycasts of three.js later.
const buildOptions = {indirect: true, setBoundingBox: false}

/**
 * BVH Plugin
 *
 * Builds a bounding volume hierarchy ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)) for mesh
 * geometries, so a raycast tests a few boxes and triangles instead of every triangle: picking, hover, snapping and
 * placing things on surfaces stay fast on big models. Other plugins can use the same trees with {@link getBVH}.
 *
 * - Meshes in `auto` mode get a BVH from {@link autoMinTriangles} triangles. `object.userData.bvh` sets `on` or `off`
 *   per object (the object's UI has a BVH section).
 * - Trees are built after the frame, within {@link buildBudget} ms per frame, and kept in `geometry.boundsTree`.
 *   The geometry is not changed (`indirect` trees: the index keeps its order).
 * - A mesh with a tree raycasts with `acceleratedRaycast`. The Raycaster API does not change.
 * - A geometry update refits the tree when it would have the same triangles (the same index or position count, draw
 *   range and groups), else builds it again.
 * - A mesh that gets a geometry with a tree raycasts with that tree, when the tree has the triangles that the mesh draws
 *   (a tree made with the `range` option of three-mesh-bvh, or before a draw range change, can have fewer or others).
 * - Not for skinned or morphed meshes, instanced or batched meshes, or meshes with their own raycast (fat lines).
 *
 * threepipe does not depend on three-mesh-bvh: install it (`npm i three-mesh-bvh`, 0.9.5 or newer) and give it to the
 * plugin. With a bundler, pass a loader: `new BVHPlugin(true, {load: () => import('three-mesh-bvh')})` (a separate chunk,
 * loaded when the plugin is added), or the module: `{lib: bvh}`. Without options, the plugin loads `three-mesh-bvh`
 * with a native dynamic import that bundlers do not process: map `three-mesh-bvh` in an import map (CDN builds).
 *
 * @category Plugins
 */
@uiFolderContainer('BVH (fast raycasts)')
export class BVHPlugin extends AViewerPluginSync<BVHPluginEventMap> {
    public static readonly PluginType = 'BVHPlugin'

    @uiToggle('Enabled')
    @serialize()
    @onChange(BVHPlugin.prototype.refreshAll)
        enabled = true

    /**
     * Meshes in `auto` mode with at least this many triangles get a BVH
     */
    @uiInput('Auto: from triangles')
    @serialize()
    @onChange(BVHPlugin.prototype.refreshAll)
        autoMinTriangles = 1000

    /**
     * Time for building trees after each frame, in ms. A geometry that takes longer is still built whole.
     */
    @uiInput('Build time per frame (ms)')
    @serialize()
        buildBudget = 6

    /** The number of geometries with a tree built by the plugin */
    @uiInput('Geometries with a BVH', {readOnly: true})
    get builtCount() {
        return this._stats.size
    }

    /** The memory of the trees built by the plugin, in MB */
    @uiInput('Memory (MB)', {readOnly: true})
    get memoryMB() {
        let b = 0
        this._stats.forEach(s => b += s.bytes)
        return Math.round(b / 1e5) / 10
    }

    /** The time it took to build the trees, in ms */
    @uiInput('Build time, all (ms)', {readOnly: true})
    get buildMs() {
        let t = 0
        this._stats.forEach(s => t += s.ms)
        return Math.round(t)
    }

    /** three-mesh-bvh, once loaded. Trees are built after it is. */
    lib?: ThreeMeshBVH

    private _load: () => Promise<ThreeMeshBVH>
    private _queue = new Set<BVHGeometry>()
    private _stats = new Map<BVHGeometry, BVHStats>()
    // the geometries whose updates the plugin follows: every geometry of the scene, with a tree or not, so an update can
    // also give a geometry a tree (it grows past autoMinTriangles, the gaps in its groups close)
    private _watched = new Set<BVHGeometry>()
    // the trees that the plugin did not build, with the build key of the geometry when the plugin first saw them: an
    // update with the same key refits them, another key drops them (they no longer fit), and the plugin builds its own.
    // covers: the tree has the triangles that the meshes draw, else they keep the raycast of three.js
    private _adopted = new Map<BVHGeometry, {tree: MeshBVHTree, key: string, covers: boolean}>()
    // the helper of each mesh, with the geometry that it was made for
    private _helpers = new Map<IObject3D, {helper: Object3D & {dispose(): void}, geometry: IGeometry}>()

    constructor(enabled = true, options: BVHPluginOptions = {}) {
        super()
        this.enabled = enabled
        this.lib = options.lib
        this._load = options.load ?? loadThreeMeshBVH
        this._postFrame = this._postFrame.bind(this)
        this._geometryUpdate = this._geometryUpdate.bind(this)
    }

    private _extension: IObjectExtension = {
        uuid: 'BVHPlugin',
        isCompatible: o => !!o.isMesh,
        onRegister: o => this._queueObject(o),
        getUiConfig: (o): UiObjectConfig[] | undefined => {
            if (!o.isMesh) return undefined
            return [{
                type: 'folder',
                label: 'BVH',
                children: [{
                    type: 'dropdown',
                    label: 'Mode',
                    children: (['auto', 'on', 'off'] as BVHMode[]).map(v => ({label: v, value: v})),
                    getValue: () => this.modeOf(o),
                    setValue: (v: BVHMode) => {
                        o.userData.bvh = v
                        this.refreshObject(o)
                    },
                }, {
                    type: 'input',
                    label: 'Status',
                    readOnly: true,
                    getValue: () => this.statusOf(o),
                }, {
                    type: 'button',
                    label: 'Rebuild',
                    onClick: () => {
                        const g = o.geometry
                        if (g) this._dispose(g)
                        this.refreshObject(o)
                    },
                }, {
                    type: 'checkbox',
                    label: 'Show boxes',
                    getValue: () => this._helpers.has(o),
                    setValue: (v: boolean) => this.showHelper(o, v),
                }],
            }]
        },
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.object3dManager.registerObjectExtension(this._extension)
        viewer.object3dManager.addEventListener('geometryAdd', this._geometryAdd)
        viewer.object3dManager.addEventListener('geometryRemove', this._geometryRemove)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.scene.addEventListener('geometryChanged', this._objectGeometryChanged)
        viewer.scene.addEventListener('materialChanged', this._objectMaterialChanged)
        viewer.addEventListener('postFrame', this._postFrame)
        if (!this.lib) this._load().then(lib => {
            this.lib = lib
            this.refreshAll()
        }).catch(e => viewer.console.error('BVHPlugin: could not load three-mesh-bvh. Pass it in the options, like new BVHPlugin(true, {load: () => import(\'three-mesh-bvh\')}), or map it in an import map', e))
        this.refreshAll()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.unregisterObjectExtension(this._extension)
        viewer.object3dManager.removeEventListener('geometryAdd', this._geometryAdd)
        viewer.object3dManager.removeEventListener('geometryRemove', this._geometryRemove)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.scene.removeEventListener('geometryChanged', this._objectGeometryChanged)
        viewer.scene.removeEventListener('materialChanged', this._objectMaterialChanged)
        viewer.removeEventListener('postFrame', this._postFrame)
        for (const g of [...this._stats.keys()]) this._dispose(g)
        // the trees from outside stay, but the meshes get the raycast of three.js back: nothing keeps those trees up to date
        for (const g of this._adopted.keys()) for (const o of g.appliedMeshes ?? [])
            if (Object.prototype.hasOwnProperty.call(o, 'raycast') && o.raycast === this.lib?.acceleratedRaycast) delete (o as Partial<IObject3D>).raycast
        this._adopted.clear()
        for (const g of [...this._watched]) this._unwatch(g)
        for (const o of [...this._helpers.keys()]) this._removeHelper(o)
        this._queue.clear()
        super.onRemove(viewer)
    }

    /** The mode of an object: its `userData.bvh`, else `auto` */
    modeOf(o: IObject3D): BVHMode {
        const m = o.userData.bvh
        return m === 'on' || m === 'off' ? m : 'auto'
    }

    /** Whether a mesh can use a BVH for raycasts */
    canUse(o: Object3D) {
        const m = o as Mesh & {isSkinnedMesh?: boolean, isInstancedMesh?: boolean, isBatchedMesh?: boolean}
        return !!m.isMesh && !!m.geometry && !m.isSkinnedMesh && !m.isInstancedMesh && !m.isBatchedMesh &&
            !Object.keys(m.geometry.morphAttributes).length &&
            // a tree covers only the groups, but three.js raycasts the whole draw range of a mesh with one material
            (Array.isArray(m.material) || !groupsLeaveGaps(m.geometry)) &&
            (m.raycast === Mesh.prototype.raycast || !!this.lib && m.raycast === this.lib.acceleratedRaycast)
    }

    /** Whether a geometry should have a tree: one of its meshes wants one */
    wants(g: IGeometry) {
        if (this.isDisabled()) return false
        for (const o of g.appliedMeshes ?? []) {
            if (!this.canUse(o)) continue
            const mode = this.modeOf(o)
            if (mode === 'on' || mode === 'auto' && triangleCount(g) >= this.autoMinTriangles) return true
        }
        return false
    }

    /** The BVH state of an object, as text for the UI */
    statusOf(o: IObject3D) {
        const g = o.geometry
        if (!g) return 'No geometry'
        if (!this.canUse(o)) return 'Not supported (skinned, morphed, instanced, own raycast, or one material with groups that leave out triangles)'
        const s = this._stats.get(g)
        if (s) return `${s.triangles.toLocaleString()} triangles · ${(s.bytes / 1e6).toFixed(2)} MB · built in ${s.ms.toFixed(1)} ms`
        // before the queue: a disabled plugin builds nothing, the geometries in the queue wait for it
        if (this.isDisabled()) return 'Off (the plugin is disabled)'
        if (this._queue.has(g)) return this.lib ? 'Queued' : 'Loading three-mesh-bvh…'
        return this.modeOf(o) === 'off' ? 'Off' : `None (under ${this.autoMinTriangles} triangles)`
    }

    /**
     * The tree of a mesh or geometry, built now when it has none (for physics, queries, path tracing).
     * Undefined until three-mesh-bvh is loaded, and for geometries without positions.
     */
    getBVH(meshOrGeometry: IObject3D | IGeometry): IMeshBVH | undefined {
        const g: BVHGeometry | undefined = (meshOrGeometry as IObject3D).isObject3D ? (meshOrGeometry as IObject3D).geometry : meshOrGeometry as IGeometry
        if (!g || !g.attributes.position) return undefined
        if (!g.boundsTree) this._build(g)
        return g.boundsTree
    }

    /** Build or drop the trees of all meshes again (after a change of the settings) */
    @uiButton('Refresh all')
    refreshAll() {
        const viewer = this._viewer
        if (!viewer) return
        for (const g of [...this._stats.keys()]) if (!this.wants(g)) this._dispose(g)
        viewer.scene.modelRoot.traverse(o => {
            this._queueObject(o as IObject3D)
            // the Status of the object's BVH section, also of a mesh whose tree did not change (lib not loaded yet)
            if ((o as IObject3D).isMesh) (o as IObject3D).uiConfig?.uiRefresh?.(true, 'postFrame')
        })
        this._pruneHelpers()
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    /** Build or drop the tree of one object's geometry (after a change of its mode) */
    refreshObject(o: IObject3D) {
        const g = o.geometry
        if (!g) return
        if (!this.wants(g)) {
            this._dispose(g)
            this._setRaycast(g)
        } else this._queueObject(o)
        this._pruneHelpers()
        o.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    /**
     * Show the boxes of an object's tree (a BVHHelper in the scene, not saved). The helper belongs to the mesh: it goes
     * when the mesh leaves the scene, gets another geometry, is `off` or not supported, when the tree is dropped, and
     * when the plugin is disabled or removed.
     */
    showHelper(o: IObject3D, show: boolean) {
        this._removeHelper(o)
        const bvh = show && !this.isDisabled() && this.canUse(o) && this.modeOf(o) !== 'off' ? this.getBVH(o) : undefined
        if (bvh && o.geometry && this.lib && this._viewer) {
            const h = new this.lib.BVHHelper(o, 10)
            h.userData.userSelectable = false
            this._viewer.scene.addObject(h, {addToRoot: true, autoScale: false, autoCenter: false})
            this._helpers.set(o, {helper: h, geometry: o.geometry})
        }
        this._viewer?.setDirty()
    }

    // removes the helpers whose mesh does not show its tree any more
    private _pruneHelpers() {
        for (const [o, {geometry}] of [...this._helpers]) {
            const valid = !this.isDisabled() && o.geometry === geometry && !!(geometry as BVHGeometry).boundsTree &&
                this.canUse(o) && this.modeOf(o) !== 'off'
            if (!valid) this._removeHelper(o)
        }
    }

    // a mesh that leaves the scene: its helper goes, and it gets the raycast of three.js back. The plugin no longer keeps
    // its tree up to date for it (its geometry can keep the tree for other meshes). Added again, objectAdd sets it again.
    // every registration, also a mesh added again: the extension's onRegister runs only the first time (Object3DManager
    // keeps the extension on the object when it is unregistered)
    private _objectAdd = (e: {object: IObject3D}) => this._queueObject(e.object)

    private _objectRemove = (e: {object: IObject3D}) => {
        const o = e.object
        this._removeHelper(o)
        if (Object.prototype.hasOwnProperty.call(o, 'raycast') && o.raycast === this.lib?.acceleratedRaycast) delete (o as Partial<IObject3D>).raycast
    }

    private _removeHelper(o: IObject3D) {
        const entry = this._helpers.get(o)
        if (!entry) return
        entry.helper.removeFromParent()
        entry.helper.dispose()
        this._helpers.delete(o)
        this._viewer?.setDirty()
    }

    private _queueObject(o: IObject3D) {
        const g: BVHGeometry | undefined = o.geometry
        if (!g || !o.isMesh) return
        this._watch(g)
        // only this mesh: the other meshes of the geometry got theirs when they were queued (no N² for shared geometries)
        if (g.boundsTree) this._setMeshRaycast(o, g)
        else if (this.wants(g)) this._queue.add(g)
    }

    private _geometryAdd = (e: {geometry: IGeometry}) => {
        this._watch(e.geometry)
        if (this.wants(e.geometry)) this._queue.add(e.geometry)
    }

    private _geometryRemove = (e: {geometry: IGeometry}) => {
        this._queue.delete(e.geometry)
        this._dispose(e.geometry)
        this._unwatch(e.geometry)
        this._adopted.delete(e.geometry)
    }

    private _watch(g: BVHGeometry) {
        this._adopt(g)
        if (this._watched.has(g)) return
        this._watched.add(g)
        g.addEventListener('geometryUpdate', this._geometryUpdate)
    }

    private _adopt(g: BVHGeometry) {
        const tree = g.boundsTree
        // the plugin's own tree was replaced from outside: the new one is a tree from outside, checked like any other
        const own = this._stats.get(g)
        if (own && own.tree !== tree) this._stats.delete(g)
        // a tree that replaced the adopted one is checked again: it can have other triangles
        if (!tree || this._stats.has(g) || this._adopted.get(g)?.tree === tree) return
        this._adopted.set(g, {tree, key: buildKey(g), covers: hasDrawnTriangles(tree, g)})
    }

    private _unwatch(g: BVHGeometry) {
        if (!this._watched.delete(g)) return
        g.removeEventListener('geometryUpdate', this._geometryUpdate)
    }

    // a mesh got another geometry, maybe one that has a tree already (geometryAdd is only for new geometries).
    // The event bubbles to the scene before Object3DManager moves the mesh to the new geometry, so after it.
    private _objectGeometryChanged = (e: {object?: IObject3D}) => {
        const o = e.object
        if (!o?.isMesh) return
        this._pruneHelpers() // a helper made for the old geometry
        const viewer = this._viewer
        queueMicrotask(() => {
            // the plugin was removed, or the mesh left the viewer, in the same task: nothing to set up
            if (!viewer || this._viewer !== viewer || viewer.object3dManager.getObject(o.uuid) !== o) return
            const g: BVHGeometry | undefined = o.geometry
            if (g) this._watch(g)
            if (g?.boundsTree) this._setRaycast(g)
            else if (g && this.wants(g)) this._queue.add(g)
            if (!g?.boundsTree && Object.prototype.hasOwnProperty.call(o, 'raycast') && o.raycast === this.lib?.acceleratedRaycast)
                delete (o as Partial<IObject3D>).raycast
        })
    }

    // a mesh got another material: one material and a material array raycast different triangles when the groups leave
    // gaps (canUse), so the mesh is checked again. The event comes after the new material is set.
    private _objectMaterialChanged = (e: {object?: IObject3D}) => {
        const o = e.object
        if (o?.isMesh && o.geometry) this.refreshObject(o)
    }

    // a geometry changed: refit when the tree would have the same triangles (vertices moved), else drop it, and build a
    // tree when the geometry wants one (also one that had none)
    private _geometryUpdate(e: {geometry?: BVHGeometry}) {
        const g = e.geometry
        if (!g) return
        this._adopt(g) // a replaced tree is not the plugin's any more
        const s = this._stats.get(g)
        const adoptedKey = !s && g.boundsTree ? this._adopted.get(g)?.key : undefined
        const key = buildKey(g)
        // the update can also change which meshes can use a tree (morph targets added): refit a tree of the plugin only
        // when the geometry still wants one, a tree from outside while it fits, and set the raycasts again on every path
        if (g.boundsTree && (s ? s.key === key && this.wants(g) : adoptedKey === key)) {
            g.boundsTree.refit()
            this._setRaycast(g)
            this._pruneHelpers()
            return
        }
        if (adoptedKey !== undefined) {
            // a tree from outside that no longer fits the geometry (other triangles): it goes, the plugin builds its own
            g.boundsTree = undefined
            this._adopted.delete(g)
            this._pruneHelpers()
        }
        this._dispose(g)
        if (this.wants(g)) this._queue.add(g)
        else this._setRaycast(g) // also a mesh of a tree that the plugin did not build
    }

    private _postFrame() {
        if (!this._queue.size || this.isDisabled() || !this.lib) return
        const end = performance.now() + this.buildBudget
        for (const g of this._queue) {
            this._queue.delete(g)
            // an error here would leave the postFrame listener and stop the animation loop of the viewer (three.js asks
            // for the next frame after the callback returns): the geometry keeps the raycast of three.js
            if (this.wants(g) && !g.boundsTree) {
                try {
                    this._build(g)
                } catch (e) {
                    this._viewer?.console.error('BVHPlugin: error in the build of a tree', g, e)
                }
            }
            if (performance.now() > end) break
        }
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    private _build(g: BVHGeometry) {
        if (!g.attributes.position || !this.lib) return
        const t = performance.now()
        this._adopted.delete(g)
        const bvh = new this.lib.MeshBVH(g, buildOptions)
        const ms = performance.now() - t
        this._stats.set(g, {
            tree: bvh as MeshBVHTree, triangles: triangleCount(g), key: buildKey(g),
            bytes: treeBytes(this.lib, bvh), ms,
        })
        g.boundsTree = bvh as BVHGeometry['boundsTree']
        this._watch(g) // also a geometry outside the scene (getBVH)
        this._setRaycast(g)
        this._refreshMeshUi(g)
        this.dispatchEvent({type: 'bvhBuilt', geometry: g, bvh, ms})
    }

    private _dispose(g: BVHGeometry) {
        const s = this._stats.get(g)
        if (!s) return
        // only the plugin's own tree: a tree that replaced it from outside stays on the geometry
        if (g.boundsTree === s.tree) g.boundsTree = undefined
        this._stats.delete(g)
        this._setRaycast(g)
        this._pruneHelpers()
        this._refreshMeshUi(g)
        this.dispatchEvent({type: 'bvhDisposed', geometry: g})
    }

    // the BVH section (Status) of the meshes of a geometry that got or lost its tree
    private _refreshMeshUi(g: BVHGeometry) {
        for (const o of g.appliedMeshes ?? []) o.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    // meshes of a geometry with a tree raycast with it, the others get the default back (also a mesh that can no
    // longer use the tree, e.g. its groups now leave out triangles)
    private _setRaycast(g: BVHGeometry) {
        for (const o of g.appliedMeshes ?? []) this._setMeshRaycast(o, g)
    }

    private _setMeshRaycast(o: IObject3D, g: BVHGeometry) {
        this._adopt(g)
        const accelerated = this.lib?.acceleratedRaycast
        const fits = this._stats.has(g) || !!this._adopted.get(g)?.covers
        // a disabled plugin does not use the trees from outside either
        if (g.boundsTree && fits && accelerated && !this.isDisabled() && this.canUse(o) && this.modeOf(o) !== 'off') o.raycast = accelerated
        else if (Object.prototype.hasOwnProperty.call(o, 'raycast') && o.raycast === accelerated) delete (o as Partial<IObject3D>).raycast
    }
}

/**
 * Whether the groups of a geometry leave out triangles of its draw range. A tree has only the triangles in the groups
 * (three-mesh-bvh 0.9: getRootPrimitiveRanges), and three.js raycasts only the groups of a mesh with a material array,
 * but the whole draw range of a mesh with one material.
 */
function groupsLeaveGaps(g: BufferGeometry) {
    if (!g.groups.length) return false
    const count = g.index ? g.index.count : g.attributes.position?.count ?? 0
    const start = Math.max(0, g.drawRange.start)
    const end = Math.min(count, g.drawRange.start + g.drawRange.count)
    let covered = start
    for (const gr of [...g.groups].sort((a, b) => a.start - b.start)) {
        if (covered >= end) break
        if (gr.start > covered) return true
        covered = Math.max(covered, gr.start + gr.count)
    }
    return covered < end
}

/**
 * What a tree reads from a geometry when it is built (three-mesh-bvh 0.9: GeometryBVH.init, getRootPrimitiveRanges and
 * generateIndirectBuffer): whether there is an index, the index or position count, the draw range, the groups' ranges,
 * and the options. A refit only moves the bounds, so a tree with another key must be built again.
 */
function buildKey(g: BufferGeometry) {
    const count = g.index ? g.index.count : g.attributes.position?.count ?? 0
    const groups = g.groups.map(gr => gr.start + ':' + gr.count).join(',')
    return [g.index ? 'index' : 'positions', count, g.drawRange.start, g.drawRange.count, groups, buildOptions.indirect].join('|')
}

/**
 * Whether a tree has exactly the triangles that a tree of the plugin would have: the draw range, and in it the groups
 * when there are any (what three.js raycasts, see {@link groupsLeaveGaps}). A tree made with the `range` option of
 * three-mesh-bvh, or before a change of the draw range, can have fewer or others. Reads each triangle of the tree once.
 */
function hasDrawnTriangles(bvh: MeshBVHTree, g: BufferGeometry) {
    // a tree without triangle indices (not a MeshBVH) cannot be checked: the meshes keep the raycast of three.js
    const resolveTriangleIndex = bvh.resolveTriangleIndex?.bind(bvh)
    if (!resolveTriangleIndex) return false
    const n = triangleCount(g)
    const start = Math.max(0, Math.floor(g.drawRange.start / 3))
    const end = Math.min(n, Math.floor((g.drawRange.start + g.drawRange.count) / 3))
    // 1: drawn and not found in the tree yet
    const drawn = new Uint8Array(n)
    if (!g.groups.length) drawn.fill(1, start, end)
    for (const gr of g.groups) drawn.fill(1, Math.max(start, gr.start / 3), Math.min(end, (gr.start + gr.count) / 3))
    // stops at a triangle that is not drawn, or that the tree has twice
    const other = bvh.shapecast({
        intersectsBounds: () => true,
        intersectsRange: (offset, count) => {
            for (let i = offset; i < offset + count; i++) {
                const t = resolveTriangleIndex(i)
                if (!drawn[t]) return true
                drawn[t] = 0
            }
            return false
        },
    })
    return !other && drawn.every(v => !v)
}

/**
 * The memory of a tree: its node buffers and its indirect buffer. Not estimateMemoryInBytes of three-mesh-bvh, which
 * follows every property from the tree, also its geometry and all that the geometry links to (its UI config, after a UI
 * showed it, links up to the viewer), and throws at an object without a constructor (a module namespace).
 */
function treeBytes(lib: ThreeMeshBVH, bvh: IMeshBVH) {
    const {roots, indirectBuffer} = lib.MeshBVH.serialize(bvh, {cloneBuffers: false})
    return roots.reduce((s, r) => s + r.byteLength, 0) + (indirectBuffer?.byteLength ?? 0)
}

/** The number of triangles of a geometry (its index or its positions) */
function triangleCount(g: BufferGeometry) {
    return Math.floor((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3)
}

/**
 * The default loader: a native `import('three-mesh-bvh')`. The specifier is in a variable, so bundlers leave the import as
 * it is and do not need three-mesh-bvh installed. The browser resolves it with an import map.
 */
async function loadThreeMeshBVH(): Promise<ThreeMeshBVH> {
    const id = 'three-mesh-bvh'
    return import(/* @vite-ignore */ /* webpackIgnore: true */ id)
}
