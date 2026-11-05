import type {BufferGeometry} from 'three'
import {uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {IMaterial} from '../../core'
import {
    MaterialPreviewGenerator,
    MaterialPreviewOptions,
    materialPreviewOptionsFromViewer,
    MaterialPreviewShape,
} from '../../three/utils/MaterialPreviewGenerator'

/**
 * Options of {@link MaterialPreviewPlugin.request}.
 */
export interface MaterialPreviewRequestOptions {
    /**
     * Default `sphere`. `mesh` renders {@link geometry} alone (like the geometry of the selected mesh).
     */
    shape?: MaterialPreviewShape
    /**
     * Geometry for the `mesh` shape.
     */
    geometry?: BufferGeometry
    /**
     * Size in pixels. Default {@link MaterialPreviewPlugin.size}
     */
    size?: number
}

/**
 * A material preview made by {@link MaterialPreviewPlugin}.
 */
export interface MaterialPreview {
    readonly material: IMaterial
    readonly shape: string
    readonly size: number
    /**
     * Canvas with the preview. The plugin draws the next preview of the same material, shape and size into the same canvas:
     * put the canvas in the page and it updates in place, or copy it (`drawImage`, {@link toDataURL}) in the callback.
     */
    readonly canvas: HTMLCanvasElement
    /**
     * The material's change counter when the preview was rendered (counts its `materialUpdate` events).
     */
    readonly version: number
    /**
     * Time of the render and read back in ms.
     */
    readonly renderTime: number
    /**
     * A png data url of the canvas, for an `<img>`. Encoded on the first call.
     */
    toDataURL(): string
}

export type MaterialPreviewCallback = (preview: MaterialPreview) => void

/**
 * Returned by {@link MaterialPreviewPlugin.request}.
 */
export interface MaterialPreviewHandle {
    /**
     * The callback is not called after this. Does nothing when it was already called.
     */
    cancel(): void
}

// one record per material for the life of the material (or the plugin), so the change counter and the drag state
// do not restart when the requests of a material are cancelled and made again (like in its own materialUpdate listener)
interface MaterialState {
    version: number
    // the last materialUpdate is part of a continuous change: a drag, an animation or a transition
    continuous: boolean
    lastChange: number
    lastRender: number
    refs: number
    listener: (e: {last?: boolean, uiChangeEvent?: {last?: boolean}}) => void
}

interface Job {
    material: IMaterial
    shape: MaterialPreviewShape
    geometry?: BufferGeometry
    size: number
    entries: Set<{callback: MaterialPreviewCallback}>
}

interface CacheEntry {
    preview: MaterialPreview
    settings: string
}

class Preview implements MaterialPreview {
    private _dataUrl?: string
    constructor(
        readonly material: IMaterial,
        readonly shape: string,
        readonly size: number,
        readonly canvas: HTMLCanvasElement,
        readonly version: number,
        readonly renderTime: number,
    ) {}
    toDataURL() {
        return this._dataUrl ??= this.canvas.toDataURL('image/png')
    }
}

/**
 * Makes material previews for an inspector: request a preview on every material change, and the plugin renders it in the
 * viewer's next `preFrame`, at most {@link maxPerFrame} per frame. Its settings are in its UI (`Material Previews`).
 *
 * - The previews render offscreen with {@link MaterialPreviewGenerator.renderToCanvas}, with the viewer's environment map and tone mapping
 *   ({@link materialPreviewOptionsFromViewer}), so the colours match the viewport. The canvas is not changed: a preview does not
 *   call `viewer.setDirty()` and does not restart the progressive rendering.
 * - While a material changes continuously, its preview renders at most once every {@link dragInterval} ms, and the last
 *   change renders too. A change is continuous when its `materialUpdate` has `last: false` (uiconfig sends it while a
 *   slider moves), or when it comes less than {@link dragInterval} ms after the previous change and has no `last`
 *   (an animation or a material transition changes the material in every frame). Other changes, and a change with
 *   `last: true` (the release of a slider), render in the next frame. See https://threepipe.org/notes/frame-updates.html
 * - Requests for the same material, shape, geometry and size share one render.
 * - Previews are cached by material uuid, shape, geometry, size and the material's change counter (and the viewer's environment and tone mapping),
 *   so a request for an unchanged material returns the cached preview in the next frame, without a render.
 *
 * ```ts
 * const previews = viewer.addPluginSync(MaterialPreviewPlugin)
 * let handle: MaterialPreviewHandle | undefined
 * function showPreview(material: IMaterial) {
 *     handle?.cancel()
 *     handle = previews.request(material, {shape: 'sphere'}, p => img.src = p.toDataURL())
 * }
 * material.addEventListener('materialUpdate', () => showPreview(material))
 * ```
 */
@uiFolderContainer('Material Previews')
export class MaterialPreviewPlugin extends AViewerPluginSync {
    static readonly PluginType = 'MaterialPreviewPlugin'
    /**
     * While it is disabled, requests wait and nothing renders.
     */
    @uiToggle('Enabled') enabled = true
    /**
     * The previews are made on request; their settings are not saved with the viewer.
     */
    serializeWithViewer = false
    /**
     * Default size of the previews in pixels.
     */
    @uiSlider('Size (px)', [32, 1024], 32) size = 256
    /**
     * Maximum number of previews rendered in one frame. Cached previews do not count.
     */
    @uiSlider('Max per frame', [1, 8], 1) maxPerFrame = 1
    /**
     * While a material changes continuously (a drag, an animation, a transition), the minimum time in ms between two
     * previews of the material. Other changes render in the next frame. 0: one preview per frame.
     */
    @uiSlider('Drag interval (ms)', [0, 500], 10) dragInterval = 100
    /**
     * Number of previews kept in the cache (the least recently used is removed first).
     */
    @uiSlider('Cache size', [0, 128], 1) maxCacheSize = 32
    /**
     * Clock in ms, for {@link dragInterval}.
     */
    now: () => number = () => performance.now()

    readonly generator: MaterialPreviewGenerator

    private readonly _ownsGenerator: boolean
    private _jobs = new Map<string, Job>()
    private _cache = new Map<string, CacheEntry>()
    private _states = new WeakMap<IMaterial, MaterialState>()
    private _tracked = new Set<IMaterial>() // materials with the listener added

    /**
     * @param generator - the generator to render with. Default a new one, disposed with the plugin
     */
    constructor(generator?: MaterialPreviewGenerator) {
        super()
        this.generator = generator ?? new MaterialPreviewGenerator()
        this._ownsGenerator = !generator
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.addEventListener('preFrame', this._preFrame)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('preFrame', this._preFrame)
        this._clear()
        super.onRemove(viewer)
    }

    /**
     * Requests a preview of the material. The callback is called once, in a later `preFrame` of the viewer
     * (in the next one when a preview of the unchanged material is cached).
     * @param material
     * @param options - shape, geometry and size, see {@link MaterialPreviewRequestOptions}
     * @param callback - called with the preview
     * @returns a handle to cancel the request
     */
    request(material: IMaterial, options: MaterialPreviewRequestOptions, callback: MaterialPreviewCallback): MaterialPreviewHandle {
        if (!this._viewer) throw new Error('MaterialPreviewPlugin: not added to a viewer')
        const shape = options.shape ?? 'sphere'
        const geometry = shape === 'mesh' ? options.geometry : undefined
        const size = options.size ?? this.size
        const key = cacheKey(material, shape, geometry, size)
        let job = this._jobs.get(key)
        if (!job) {
            job = {material, shape, geometry, size, entries: new Set()}
            this._jobs.set(key, job)
            this._track(material)
        }
        const entry = {callback}
        job.entries.add(entry)
        const j = job
        return {
            cancel: () => {
                if (!j.entries.delete(entry) || j.entries.size || this._jobs.get(key) !== j) return
                this._jobs.delete(key)
                this._untrack(material)
            },
        }
    }

    /**
     * Removes the cached previews of the material (all of them without a material), so that the next requests render again.
     * Changes of the material, the environment map and the tone mapping are detected without it.
     * @param material
     */
    invalidate(material?: IMaterial) {
        for (const [key, entry] of [...this._cache]) {
            if (material && entry.preview.material !== material) continue
            this._cache.delete(key)
            this._untrack(entry.preview.material)
        }
    }

    /**
     * Number of requests waiting for a render.
     */
    get pending() {
        return this._jobs.size
    }

    dispose() {
        if (this._viewer) this.onRemove(this._viewer)
        this._clear()
        if (this._ownsGenerator) this.generator.dispose()
        super.dispose()
    }

    /** Drops the requests and the cached previews, and stops listening to the materials */
    private _clear() {
        this._jobs.clear()
        this._cache.clear()
        for (const material of this._tracked) {
            const state = this._states.get(material)
            if (state) material.removeEventListener('materialUpdate', state.listener)
        }
        this._tracked.clear()
        this._states = new WeakMap()
    }

    private _preFrame = () => {
        const viewer = this._viewer
        if (!viewer || !this._jobs.size || !viewer.renderEnabled || this.isDisabled()) return
        const now = this.now()
        let rendered = 0
        for (const [key, job] of [...this._jobs]) {
            if (this._jobs.get(key) !== job) continue // cancelled or replaced in a callback
            const state = this._states.get(job.material)
            if (!state) continue // tracked while the job exists
            // per material: the tone mapping follows the material's opt-out, like the viewport
            const viewerOptions = materialPreviewOptionsFromViewer(viewer, job.material)
            const settings = settingsKey(viewerOptions)
            const cached = this._cache.get(key)
            if (cached && cached.preview.version === state.version && cached.settings === settings) {
                this._cache.delete(key) // most recently used last
                this._cache.set(key, cached)
                this._finish(key, job, cached.preview)
                continue
            }
            if (rendered >= this.maxPerFrame) continue
            if (state.continuous && now - state.lastRender < this.dragInterval) continue
            rendered++
            state.lastRender = now
            let preview: MaterialPreview
            try {
                const start = this.now()
                const canvas = this.generator.renderToCanvas(job.material, viewer.renderManager.renderer, {
                    ...viewerOptions,
                    shape: job.shape,
                    geometry: job.geometry,
                    size: job.size,
                }, cached?.preview.canvas)
                preview = new Preview(job.material, job.shape, job.size, canvas, state.version, this.now() - start)
            } catch (e) {
                console.error('MaterialPreviewPlugin: unable to render the preview of', job.material, e)
                this._jobs.delete(key)
                this._untrack(job.material)
                continue
            }
            if (cached) this._cache.delete(key)
            else this._track(job.material)
            this._cache.set(key, {preview, settings})
            this._evict()
            this._finish(key, job, preview)
        }
    }

    private _finish(key: string, job: Job, preview: MaterialPreview) {
        this._jobs.delete(key)
        this._untrack(job.material)
        for (const entry of job.entries) {
            try {
                entry.callback(preview)
            } catch (e) {
                console.error('MaterialPreviewPlugin: error in a preview callback', e)
            }
        }
    }

    private _evict() {
        for (const [key, entry] of this._cache) {
            if (this._cache.size <= Math.max(0, this.maxCacheSize)) break
            this._cache.delete(key) // the oldest first
            this._untrack(entry.preview.material)
        }
    }

    // the material is tracked (its materialUpdate counted) while a job or a cached preview uses it
    private _track(material: IMaterial) {
        let state = this._states.get(material)
        if (!state) {
            const s: MaterialState = {version: 0, continuous: false, lastChange: -Infinity, lastRender: -Infinity, refs: 0, listener: (e) => {
                const now = this.now()
                const last = e.last ?? e.uiChangeEvent?.last
                s.version++
                // an animation or a transition sends a change in every frame, without last
                s.continuous = last === false || (last === undefined && now - s.lastChange < this.dragInterval)
                s.lastChange = now
            }}
            this._states.set(material, s)
            state = s
        }
        if (state.refs++ === 0) {
            material.addEventListener('materialUpdate', state.listener)
            this._tracked.add(material)
        }
    }

    private _untrack(material: IMaterial) {
        const state = this._states.get(material)
        if (!state || --state.refs > 0) return
        material.removeEventListener('materialUpdate', state.listener)
        this._tracked.delete(material)
    }
}

/**
 * Cache key of a preview: material, shape, geometry and size.
 */
function cacheKey(material: IMaterial, shape: string, geometry: BufferGeometry | undefined, size: number) {
    return material.uuid + '|' + shape + '|' + (geometry?.uuid ?? '') + '|' + size
}

/**
 * The viewer settings that change a preview: environment map and tone mapping.
 */
function settingsKey(o: Pick<MaterialPreviewOptions, 'environment' | 'environmentIntensity' | 'environmentRotation' | 'toneMapping' | 'outputColorSpace'>) {
    const r = o.environmentRotation
    const t = o.toneMapping
    return [
        o.environment?.uuid ?? '', o.environmentIntensity, r ? r.x + ',' + r.y + ',' + r.z : '',
        t ? [t.toneMapping, t.exposure, t.contrast, t.saturation].join(',') : '', o.outputColorSpace,
    ].join('|')
}
