import type {BufferGeometry, Vector3} from 'three'
import {type ChangeEvent, uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {IMaterial} from '../../core'
import {
    MaterialPreviewGenerator,
    MaterialPreviewOptions,
    materialPreviewOptionsFromViewer,
    MaterialPreviewShape,
} from '../../three/utils/MaterialPreviewGenerator'

/**
 * The `materialUpdate` event of a material, as {@link MaterialPreviewPlugin.ignoreChange} gets it: the options of `setDirty`.
 */
export interface MaterialChangeEvent {
    change?: string
    key?: string
    last?: boolean
    uiChangeEvent?: ChangeEvent
}

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
    /**
     * Direction from the object to the camera, to turn the preview (a drag on the preview can set it). See
     * {@link MaterialPreviewOptions.cameraDirection}. Part of the cache key.
     */
    cameraDirection?: Vector3
    /**
     * Distance of the camera as a factor of the default framing (1). See {@link MaterialPreviewOptions.cameraDistance}. Part of the cache key.
     */
    cameraDistance?: number
    /**
     * The minimum time in ms between two previews of this request while its material changes continuously, in place of
     * {@link MaterialPreviewPlugin.dragInterval}. When requests for the same preview give different values, the smallest is used.
     */
    dragInterval?: number
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
    // the time of the last render of each preview of the material (by cache key: shape, geometry, size), so that two
    // previews of one material (a small card and a large view) are throttled each on its own
    lastRender: Map<string, number>
    refs: number
    // when the last job or cached preview of the material went away; it is listened to a while longer (LISTEN_AFTER_USE)
    unusedSince: number
    listener: (e: MaterialChangeEvent) => void
}

interface Job {
    material: IMaterial
    shape: MaterialPreviewShape
    geometry?: BufferGeometry
    size: number
    cameraDirection?: Vector3
    cameraDistance?: number
    // the smallest dragInterval of the requests, else the plugin's
    dragInterval?: number
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
    @uiSlider('Drag interval (ms)', [0, 500], 1) dragInterval = 32
    /**
     * Number of previews kept in the cache (the least recently used is removed first).
     */
    @uiSlider('Cache size', [0, 128], 1) maxCacheSize = 32
    /**
     * A change of a material that does not change its look: it does not count as a change, so the cached previews stay
     * and no preview renders. Default: a rename (`change` or `key` `'name'`, or the name field of the material's UI).
     * Set a function to skip other changes, from the `change` and `key` of `setDirty`.
     */
    ignoreChange: (e: MaterialChangeEvent) => boolean = e => {
        const property = e.uiChangeEvent?.config?.property // [target, key], or a function that returns it
        return (e.change ?? e.key ?? (Array.isArray(property) ? property[1] : undefined)) === 'name'
    }
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
        const {cameraDirection, cameraDistance} = options
        const key = cacheKey(material, shape, geometry, size, cameraDirection, cameraDistance)
        let job = this._jobs.get(key)
        if (!job) {
            job = {material, shape, geometry, size, cameraDirection: cameraDirection?.clone(), cameraDistance, entries: new Set()}
            this._jobs.set(key, job)
            this._track(material)
        }
        if (options.dragInterval !== undefined) job.dragInterval = Math.min(job.dragInterval ?? Infinity, options.dragInterval)
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
        if (!viewer) return
        this._stopIdleListeners()
        if (!this._jobs.size || !viewer.renderEnabled || this.isDisabled()) return
        const now = this.now()
        let rendered = 0
        // the preview rendered longest ago first: a material that changes in every frame asks again each time, and its
        // new request would else always come before the others, which then never render (with maxPerFrame)
        const lastRender = (key: string, job: Job) => this._states.get(job.material)?.lastRender.get(key) ?? -Infinity
        const jobs = [...this._jobs].sort(([ka, a], [kb, b]) => lastRender(ka, a) - lastRender(kb, b))
        for (const [key, job] of jobs) {
            if (this._jobs.get(key) !== job) continue // cancelled or replaced in a callback
            const state = this._states.get(job.material)
            if (!state) continue // tracked while the job exists
            // per material: the tone mapping follows the material's opt-out, like the viewport
            const viewerOptions = materialPreviewOptionsFromViewer(viewer, job.material)
            const settings = materialPreviewSettingsKey(viewerOptions)
            const cached = this._cache.get(key)
            if (cached && cached.preview.version === state.version && cached.settings === settings) {
                this._cache.delete(key) // most recently used last
                this._cache.set(key, cached)
                this._finish(key, job, cached.preview)
                continue
            }
            if (rendered >= this.maxPerFrame) continue
            if (state.continuous && now - (state.lastRender.get(key) ?? -Infinity) < (job.dragInterval ?? this.dragInterval)) continue
            rendered++
            state.lastRender.set(key, now)
            let preview: MaterialPreview
            try {
                const start = this.now()
                const canvas = this.generator.renderToCanvas(job.material, viewer.renderManager.renderer, {
                    ...viewerOptions,
                    shape: job.shape,
                    geometry: job.geometry,
                    size: job.size,
                    cameraDirection: job.cameraDirection,
                    cameraDistance: job.cameraDistance,
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

    // the material is tracked (its materialUpdate counted) while a job or a cached preview uses it, and LISTEN_AFTER_USE ms
    // after that. The next request often comes from the app's own materialUpdate listener: a listener added during that
    // dispatch would miss the change, so with no cache (or an evicted preview) a drag would never count as continuous
    private _track(material: IMaterial) {
        let state = this._states.get(material)
        if (!state) {
            const s: MaterialState = {version: 0, continuous: false, lastChange: -Infinity, lastRender: new Map(), refs: 0, unusedSince: Infinity, listener: (e) => {
                if (this.ignoreChange(e)) return // the look of the material is the same: the cached previews stay
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
        state.refs++
        state.unusedSince = Infinity
        if (!this._tracked.has(material)) {
            material.addEventListener('materialUpdate', state.listener)
            this._tracked.add(material)
        }
    }

    private _untrack(material: IMaterial) {
        const state = this._states.get(material)
        if (!state || --state.refs > 0) return
        state.unusedSince = this.now()
    }

    /**
     * Removes the listener of the materials that no job or cached preview used, and that did not change, for
     * LISTEN_AFTER_USE ms. Also drops the render times of the previews that no request waits for, after the throttling
     * window: a new view (cameraDirection, cameraDistance) is a new key, so they would else grow while a preview is turned.
     */
    private _stopIdleListeners() {
        const now = this.now()
        const keep = Math.max(LISTEN_AFTER_USE, this.dragInterval)
        for (const material of this._tracked) {
            const state = this._states.get(material)
            if (state) for (const [key, time] of state.lastRender) if (now - time > keep && !this._jobs.has(key)) state.lastRender.delete(key)
            if (state && (state.refs > 0 || now - Math.max(state.unusedSince, state.lastChange) < LISTEN_AFTER_USE)) continue
            if (state) {
                material.removeEventListener('materialUpdate', state.listener)
                state.lastRender.clear()
            }
            this._tracked.delete(material)
        }
    }
}

/** How long in ms a material is still listened to after its last job or cached preview, and after its last change */
const LISTEN_AFTER_USE = 1000

/**
 * Cache key of a preview: material, shape, geometry and size.
 */
function cacheKey(material: IMaterial, shape: string, geometry: BufferGeometry | undefined, size: number, direction?: Vector3, distance?: number) {
    const view = direction ? [direction.x, direction.y, direction.z].map(v => v.toFixed(4)).join(',') : ''
    return material.uuid + '|' + shape + '|' + (geometry?.uuid ?? '') + '|' + size + '|' + view + '|' + (distance ?? '')
}

/**
 * A key of the viewer settings that change a preview: the environment map (with its intensity and rotation), the tone
 * mapping and the output colour space, from {@link materialPreviewOptionsFromViewer}. The cache of
 * {@link MaterialPreviewPlugin} uses it; a caller that shows a preview can compare it after a viewer `update` and ask
 * again when it changed.
 */
export function materialPreviewSettingsKey(o: Pick<MaterialPreviewOptions, 'environment' | 'environmentIntensity' | 'environmentRotation' | 'toneMapping' | 'outputColorSpace'>) {
    const r = o.environmentRotation
    const t = o.toneMapping
    return [
        o.environment?.uuid ?? '', o.environmentIntensity, r ? r.x + ',' + r.y + ',' + r.z : '',
        t ? [t.toneMapping, t.exposure, t.contrast, t.saturation].join(',') : '', o.outputColorSpace,
    ].join('|')
}
