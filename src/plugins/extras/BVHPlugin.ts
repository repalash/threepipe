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
    MeshBVH: new (geometry: BufferGeometry, options?: {indirect?: boolean, setBoundingBox?: boolean}) => IMeshBVH
    acceleratedRaycast: Mesh['raycast']
    estimateMemoryInBytes(bvh: IMeshBVH): number
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

type BVHGeometry = IGeometry & {boundsTree?: IMeshBVH}

interface BVHStats {
    triangles: number
    // the draw range at build time: the tree has only the triangles in it
    drawStart: number
    drawCount: number
    bytes: number
    ms: number
}

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
 * - A geometry update refits the tree when the triangle count and the draw range are the same, else builds it again.
 * - A mesh that gets a geometry with a tree raycasts with that tree.
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
        viewer.scene.addEventListener('geometryChanged', this._objectGeometryChanged)
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
        viewer.scene.removeEventListener('geometryChanged', this._objectGeometryChanged)
        viewer.removeEventListener('postFrame', this._postFrame)
        for (const g of [...this._stats.keys()]) this._dispose(g)
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
        if (!this.canUse(o)) return 'Not supported (skinned, morphed, instanced or own raycast)'
        const s = this._stats.get(g)
        if (s) return `${s.triangles.toLocaleString()} triangles · ${(s.bytes / 1e6).toFixed(2)} MB · built in ${s.ms.toFixed(1)} ms`
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
        viewer.scene.modelRoot.traverse(o => this._queueObject(o as IObject3D))
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

    private _objectRemove = (e: {object: IObject3D}) => this._removeHelper(e.object)

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
        if (g.boundsTree) this._setRaycast(g)
        else if (this.wants(g)) this._queue.add(g)
    }

    private _geometryAdd = (e: {geometry: IGeometry}) => {
        if (this.wants(e.geometry)) this._queue.add(e.geometry)
    }

    private _geometryRemove = (e: {geometry: IGeometry}) => {
        this._queue.delete(e.geometry)
        this._dispose(e.geometry)
    }

    // a mesh got another geometry, maybe one that has a tree already (geometryAdd is only for new geometries).
    // The event bubbles to the scene before Object3DManager moves the mesh to the new geometry, so after it.
    private _objectGeometryChanged = (e: {object?: IObject3D}) => {
        const o = e.object
        if (!o?.isMesh) return
        this._pruneHelpers() // a helper made for the old geometry
        queueMicrotask(() => {
            const g: BVHGeometry | undefined = o.geometry
            if (g?.boundsTree) this._setRaycast(g)
            else if (g && this.wants(g)) this._queue.add(g)
            if (!g?.boundsTree && Object.prototype.hasOwnProperty.call(o, 'raycast') && o.raycast === this.lib?.acceleratedRaycast)
                delete (o as Partial<IObject3D>).raycast
        })
    }

    // a geometry changed: refit when the triangle count and the draw range are the same (vertices moved), else build again
    private _geometryUpdate(e: {geometry?: BVHGeometry}) {
        const g = e.geometry
        if (!g) return
        const s = this._stats.get(g)
        if (g.boundsTree && s && triangleCount(g) === s.triangles &&
            g.drawRange.start === s.drawStart && g.drawRange.count === s.drawCount) {
            g.boundsTree.refit()
            return
        }
        this._dispose(g)
        if (this.wants(g)) this._queue.add(g)
    }

    private _postFrame() {
        if (!this._queue.size || this.isDisabled() || !this.lib) return
        const end = performance.now() + this.buildBudget
        for (const g of this._queue) {
            this._queue.delete(g)
            if (this.wants(g) && !g.boundsTree) this._build(g)
            if (performance.now() > end) break
        }
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    private _build(g: BVHGeometry) {
        if (!g.attributes.position || !this.lib) return
        const t = performance.now()
        // setBoundingBox false: a box from a tree of part of the draw range would cull the raycasts of three.js later
        const bvh = new this.lib.MeshBVH(g, {indirect: true, setBoundingBox: false})
        const ms = performance.now() - t
        g.boundsTree = bvh as BVHGeometry['boundsTree']
        this._stats.set(g, {
            triangles: triangleCount(g), drawStart: g.drawRange.start, drawCount: g.drawRange.count,
            bytes: this.lib.estimateMemoryInBytes(bvh), ms,
        })
        g.addEventListener('geometryUpdate', this._geometryUpdate)
        this._setRaycast(g)
        this.dispatchEvent({type: 'bvhBuilt', geometry: g, bvh, ms})
    }

    private _dispose(g: BVHGeometry) {
        if (!this._stats.has(g)) return
        g.removeEventListener('geometryUpdate', this._geometryUpdate)
        g.boundsTree = undefined
        this._stats.delete(g)
        this._setRaycast(g)
        this._pruneHelpers()
        this.dispatchEvent({type: 'bvhDisposed', geometry: g})
    }

    // meshes of a geometry with a tree raycast with it, the others get the default back
    private _setRaycast(g: BVHGeometry) {
        for (const o of g.appliedMeshes ?? []) {
            if (!this.canUse(o)) continue
            if (g.boundsTree && this.lib && this.modeOf(o) !== 'off') o.raycast = this.lib.acceleratedRaycast
            else if (Object.prototype.hasOwnProperty.call(o, 'raycast')) delete (o as Partial<IObject3D>).raycast
        }
    }
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
