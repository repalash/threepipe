import {BufferGeometry, Mesh, Object3D} from 'three'
import type {BVHHelper, MeshBVH} from 'three-mesh-bvh'
import {onChange, serialize} from 'ts-browser-helpers'
import {uiButton, uiFolderContainer, uiInput, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IGeometry, IObject3D, IObjectExtension} from '../../core'

/**
 * When a mesh gets a BVH: `auto` from {@link BVHPlugin.autoMinTriangles} triangles, `on` always, `off` never.
 * Set in `object.userData.bvh` (saved with the object).
 */
export type BVHMode = 'auto' | 'on' | 'off'

export interface BVHPluginEventMap extends AViewerPluginEventMap {
    bvhBuilt: {geometry: IGeometry, bvh: MeshBVH, ms: number}
    bvhDisposed: {geometry: IGeometry}
}

/** The three-mesh-bvh module (or the parts of it this plugin uses) */
export type ThreeMeshBVH = typeof import('three-mesh-bvh')

export interface BVHPluginOptions {
    /** Loads three-mesh-bvh. Default: `import('three-mesh-bvh')` */
    load?: () => Promise<ThreeMeshBVH>
}

interface BVHStats {
    triangles: number
    bytes: number
    ms: number
}

/**
 * BVH Plugin
 *
 * Builds a bounding volume hierarchy ([three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)) for mesh
 * geometries, so a raycast tests a few boxes and triangles instead of every triangle: picking, hover, snapping and
 * placing things on surfaces stay fast on big models. Other plugins can use the same trees with {@link getBVH}
 * (physics, closest point queries, path tracing, shaders).
 *
 * - Meshes in `auto` mode get a BVH from {@link autoMinTriangles} triangles; `object.userData.bvh` sets `on` or `off`
 *   per object (the object's UI has a BVH section).
 * - Trees are built after the frame, within {@link buildBudget} ms per frame, and kept in `geometry.boundsTree`.
 *   The geometry is not changed (`indirect` trees: the index keeps its order).
 * - A mesh with a tree raycasts with `acceleratedRaycast`; the Raycaster API does not change.
 * - A geometry update refits the tree when the vertex and index counts are the same, else rebuilds it.
 * - Not for skinned or morphed meshes, instanced or batched meshes, or meshes with their own raycast (fat lines).
 *
 * three-mesh-bvh is loaded when the plugin is added (a dynamic import, external in the threepipe builds): a bundler puts
 * it in its own chunk, which a page that never adds BVHPlugin never loads. Without a bundler (the CDN build), map
 * `three-mesh-bvh` in an import map, or pass {@link BVHPluginOptions.load}.
 *
 * @category Plugins
 */
@uiFolderContainer('BVH (fast raycasts)')
export class BVHPlugin extends AViewerPluginSync<BVHPluginEventMap> {
    public static readonly PluginType = 'BVHPlugin'

    @uiToggle()
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

    @uiInput('Geometries with a BVH', {readOnly: true})
    get builtCount() {
        return this._stats.size
    }

    @uiInput('Memory (MB)', {readOnly: true})
    get memoryMB() {
        let b = 0
        this._stats.forEach(s => b += s.bytes)
        return Math.round(b / 1e5) / 10
    }

    @uiInput('Build time, all (ms)', {readOnly: true})
    get buildMs() {
        let t = 0
        this._stats.forEach(s => t += s.ms)
        return Math.round(t)
    }

    private _queue = new Set<IGeometry>()
    private _stats = new Map<IGeometry, BVHStats>()
    private _helpers = new Map<Object3D, BVHHelper>()

    /** three-mesh-bvh, once loaded. Trees are built after it is. */
    lib?: ThreeMeshBVH
    private _load: () => Promise<ThreeMeshBVH>

    constructor(enabled = true, options: BVHPluginOptions = {}) {
        super()
        this.enabled = enabled
        this._load = options.load ?? (async() => import('three-mesh-bvh'))
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
                        (o.userData as {bvh?: BVHMode}).bvh = v
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
        viewer.addEventListener('postFrame', this._postFrame)
        if (!this.lib) this._load().then(lib => {
            this.lib = lib
            this.refreshAll()
        }).catch(e => viewer.console.error('BVHPlugin: could not load three-mesh-bvh', e))
        this.refreshAll()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.unregisterObjectExtension(this._extension)
        viewer.object3dManager.removeEventListener('geometryAdd', this._geometryAdd)
        viewer.object3dManager.removeEventListener('geometryRemove', this._geometryRemove)
        viewer.removeEventListener('postFrame', this._postFrame)
        for (const g of [...this._stats.keys()]) this._dispose(g)
        this._queue.clear()
        super.onRemove(viewer)
    }

    /** The mode of an object: its `userData.bvh`, else `auto` */
    modeOf(o: IObject3D): BVHMode {
        const m = (o.userData as {bvh?: BVHMode}).bvh
        return m === 'on' || m === 'off' ? m : 'auto'
    }

    /** Whether a mesh can use a BVH for raycasts */
    canUse(o: Object3D) {
        const m = o as Mesh & {isSkinnedMesh?: boolean, isInstancedMesh?: boolean, isBatchedMesh?: boolean}
        return !!m.isMesh && !!m.geometry && !m.isSkinnedMesh && !m.isInstancedMesh && !m.isBatchedMesh &&
            !Object.keys(m.geometry.morphAttributes).length &&
            (m.raycast === Mesh.prototype.raycast || !!this.lib && m.raycast === this.lib.acceleratedRaycast)
    }

    private _triangles(g: BufferGeometry) {
        return Math.floor((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3)
    }

    /** Whether a geometry should have a tree: one of its meshes wants one */
    wants(g: IGeometry) {
        if (this.isDisabled()) return false
        for (const o of g.appliedMeshes ?? []) {
            if (!this.canUse(o)) continue
            const mode = this.modeOf(o)
            if (mode === 'on' || mode === 'auto' && this._triangles(g) >= this.autoMinTriangles) return true
        }
        return false
    }

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
     * Undefined until three-mesh-bvh is loaded, and for geometries that cannot have one.
     */
    getBVH(meshOrGeometry: IObject3D | IGeometry): MeshBVH | undefined {
        const g = (meshOrGeometry as IObject3D).isObject3D ? (meshOrGeometry as IObject3D).geometry : meshOrGeometry as IGeometry
        if (!g || !g.attributes.position) return undefined
        if (!g.boundsTree) this._build(g)
        return g.boundsTree as MeshBVH | undefined
    }

    /** Build or drop the trees of all meshes again (after a change of the settings) */
    @uiButton('Refresh all')
    refreshAll() {
        const viewer = this._viewer
        if (!viewer) return
        for (const g of [...this._stats.keys()]) if (!this.wants(g)) this._dispose(g)
        viewer.scene.modelRoot.traverse(o => this._queueObject(o as IObject3D))
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
        o.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    /** Show the boxes of an object's tree (a BVHHelper in the scene, not saved) */
    showHelper(o: IObject3D, show: boolean) {
        const old = this._helpers.get(o)
        if (old) {
            old.removeFromParent()
            old.dispose?.()
            this._helpers.delete(o)
        }
        const bvh = show && o.geometry ? this.getBVH(o) : undefined
        if (bvh && this._viewer) {
            const h = new this.lib!.BVHHelper(o as Object3D as Mesh, bvh, 10)
            h.userData.userSelectable = false
            this._viewer.scene.add(h)
            this._helpers.set(o, h)
        }
        this._viewer?.setDirty()
    }

    private _queueObject(o: IObject3D) {
        const g = o.geometry
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

    // a geometry changed: refit when the counts are the same (vertices moved), else build again
    private _geometryUpdate(e: {geometry?: IGeometry}) {
        const g = e.geometry
        if (!g) return
        const bvh = g.boundsTree as MeshBVH | undefined
        const s = this._stats.get(g)
        if (bvh && s && this._triangles(g) === s.triangles) {
            bvh.refit()
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

    private _build(g: IGeometry) {
        if (!g.attributes.position || !this.lib) return
        const t = performance.now()
        const bvh = new this.lib.MeshBVH(g, {indirect: true})
        const ms = performance.now() - t
        g.boundsTree = bvh
        this._stats.set(g, {triangles: this._triangles(g), bytes: this.lib.estimateMemoryInBytes(bvh), ms})
        g.addEventListener('geometryUpdate', this._geometryUpdate)
        this._setRaycast(g)
        this.dispatchEvent({type: 'bvhBuilt', geometry: g, bvh, ms})
    }

    private _dispose(g: IGeometry) {
        if (!this._stats.has(g)) return
        g.removeEventListener('geometryUpdate', this._geometryUpdate)
        g.boundsTree = undefined
        this._stats.delete(g)
        this._setRaycast(g)
        for (const [o, h] of this._helpers) if ((o as IObject3D).geometry === g) {
            h.removeFromParent()
            this._helpers.delete(o)
        }
        this.dispatchEvent({type: 'bvhDisposed', geometry: g})
    }

    // meshes of a geometry with a tree raycast with it; the others get the default back
    private _setRaycast(g: IGeometry) {
        for (const o of g.appliedMeshes ?? []) {
            if (!this.canUse(o)) continue
            if (g.boundsTree && this.lib && this.modeOf(o) !== 'off') o.raycast = this.lib.acceleratedRaycast
            else if (Object.prototype.hasOwnProperty.call(o, 'raycast')) delete (o as any).raycast
        }
    }
}
