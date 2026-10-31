import {
    animateCameraToViewSpherical,
    AnimationResult,
    AViewerPluginEventMap,
    AViewerPluginSync,
    createStyles,
    EasingFunctions,
    ICamera,
    ICameraView,
    Intersection,
    IObject3D,
    ISerializedConfig,
    MathUtils,
    Matrix3,
    Matrix4,
    PopmotionPlugin,
    Quaternion,
    Raycaster,
    serialize,
    SerializationMetaType,
    ThreeViewer,
    UiObjectConfig,
    UndoManagerPlugin,
    Vector2,
    Vector3,
} from 'threepipe'
import styles from './AnnotationsPlugin.css?inline'
import {renderAnnotationText} from './render-text'

/** A saved camera view, in world space */
export interface AnnotationView {
    position: number[]
    target: number[]
    quaternion: number[]
    zoom: number
    /** Field of view of a perspective camera */
    fov?: number
}

/** Where an annotation sits: an object and a point + normal in that object's local space, so it moves with the object */
export interface AnnotationAnchor {
    /** uuid of the object. The glTF export keeps object uuids (`userData.gltfUUID`), so this finds the object after a reload */
    uuid: string
    /** Fallback when the uuid is not found: names from the model root, e.g. "Ring#0/Band#0" (#n: n-th sibling with that name) */
    path: string
    /** Object name, for lists */
    name: string
    point: number[]
    normal: number[]
    /** An instance of an InstancedMesh: `point` and `normal` are then in that instance's space, so it moves with the instance */
    instanceId?: number
}

export interface Annotation {
    id: string
    title: string
    /** Plain text with line breaks. **bold**, *italic*, [label](https://…) and bare https:// links are shown formatted */
    text: string
    anchor: AnnotationAnchor
    /** Camera view to go to when the annotation is opened. null: the camera stays */
    view: AnnotationView | null
}

export interface AnnotationsPluginEventMap extends AViewerPluginEventMap {
    /** The list or an annotation changed (also on undo/redo and on load from a file) */
    annotationChange: {reason: 'add' | 'remove' | 'update' | 'reorder' | 'load' | 'clear', annotation?: Annotation}
    /** Placing a new annotation started or ended (placed, or cancelled with Esc) */
    addingChange: {adding: boolean}
    /** An annotation was opened (annotation set) or the card was closed (annotation null) */
    annotationSelect: {annotation: Annotation | null, index: number}
}

export interface AnnotationsPluginOptions {
    /** Allow adding, editing, moving and deleting annotations. Default false (viewer) */
    editable?: boolean
}

interface MarkerState {
    el: HTMLDivElement
    world: Vector3
    ndc: Vector2
    x: number
    y: number
    onScreen: boolean
    occluded: boolean
    facing: boolean
}

interface Hit {
    object: IObject3D
    localPoint: Vector3
    localNormal: Vector3
    instanceId?: number
}

/**
 * Annotations Plugin
 *
 * 3D annotations ("hotspots"), like Sketchfab's: numbered markers on the model. Click one: the camera goes to the view
 * saved with it and a card shows its title and text, with ‹ prev / next › (also ←/→, Esc closes).
 *
 * - Saved with the scene: {@link annotations} is a serialized property, so the viewer config and
 *   `viewer.exportScene({viewerConfig: true})` (the .glb) hold it, and loading them restores it.
 * - Markers are attached to an object (local point + normal), so they follow the object when it moves or animates.
 * - Markers behind geometry or on a surface that faces away are dimmed. The occlusion test casts a few rays per frame,
 *   only after the camera, an anchor or the scene changed, and while frames render (an animation) at most every
 *   {@link occlusionRecheckInterval} ms.
 * - {@link editable}: {@link startAdding} (then click a surface), edit the title and the text in the card, "Update
 *   view", "Delete", and drag a marker to another surface point. All edits are undoable with {@link UndoManagerPlugin}.
 * - Tour: {@link goTo}, {@link next}, {@link prev}, {@link playTour}; events `annotationChange` and `annotationSelect`
 *   for an outside list.
 *
 * The markers and the card are in a layer over the canvas, in the viewer container (which must be positioned, for
 * example `position: relative`). The UI folder (Annotations) has Editable, Add, Play tour and Remove all.
 *
 * @category Plugins
 */
export class AnnotationsPlugin extends AViewerPluginSync<AnnotationsPluginEventMap> {
    static readonly PluginType = 'AnnotationsPlugin'
    /** Adds the stylesheet of the `anp-` classes to the page when the first plugin is added. Off: the page styles them. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    dependencies = [PopmotionPlugin]
    enabled = true

    /** All annotations in tour order. Saved with the scene (in the .glb). Change them through the methods. */
    @serialize()
        annotations: Annotation[] = []

    /** Camera animation time in ms for a large move (short moves are faster) */
    animDuration = 900
    /** Max rays per frame for the occlusion test (it also stops after ~2 ms) */
    occlusionRaysPerFrame = 8
    /**
     * After rendered frames, the occlusion test runs again at most this often (ms), for geometry that moves without a
     * scene update (an animation). No frames: no test.
     */
    occlusionRecheckInterval = 200

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Annotations',
        children: [
            {type: 'checkbox', label: 'Editable', property: [this, 'editable']},
            {type: 'button', label: 'Add annotation', value: () => this.startAdding(), hidden: () => !this.editable},
            {type: 'button', label: 'Play tour', value: () => this.playTour()},
            {type: 'button', label: 'Remove all', value: () => this.clear(), hidden: () => !this.editable},
        ],
    }

    private _editable: boolean
    private _layer?: HTMLDivElement
    private _card?: HTMLDivElement
    private _cardEls!: {
        num: HTMLElement, title: HTMLElement, titleIn: HTMLInputElement, text: HTMLElement, textIn: HTMLTextAreaElement,
        view: HTMLButtonElement, pos: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement,
    }
    private _place: HTMLDivElement | null = null
    private _markers = new Map<string, MarkerState>()
    private _objCache = new Map<string, {obj: IObject3D | null, gen: number}>()
    /** Changes when the scene hierarchy changes: a cached "not found" is looked up again */
    private _cacheGen = 0
    private _openId: string | null = null
    private _raf = 0
    private _anim: AnimationResult | null = null
    private _animCam: ICamera | null = null
    private _occlDirty = true
    private _occlQueue: string[] = []
    /** A sum of the camera matrices and the anchor positions: a change starts a new occlusion test */
    private _lastKey = NaN
    /** A frame was rendered after the last occlusion test started */
    private _rendered = false
    /** When the last occlusion test started (performance.now) */
    private _occlTime = -Infinity
    private _ray = new Raycaster()
    private _nm = new Matrix3()
    private _am = new Matrix4()
    private _down: {x: number, y: number, canvas: boolean} | null = null
    private _drag: {id: string, pointerId: number, x: number, y: number, moved: boolean, before: AnnotationAnchor} | null = null
    private _tour = 0
    /** The size of the card, measured again when it changes (see `_resizer`), not on every frame */
    private _cardSize = {w: 0, h: 0}
    /** Watches the open card: a text that grows or wraps in a narrower viewer changes its size, then it is placed again */
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
        this._cardSize.w = 0
        this._positionCard()
    })

    constructor(options: AnnotationsPluginOptions = {}) {
        super()
        this._editable = !!options.editable
    }

    /** Allow adding, editing, moving and deleting annotations. Off: visitors open the annotations only. */
    get editable() {
        return this._editable
    }

    set editable(v: boolean) {
        if (this._editable === v) return
        this._editable = v
        if (!v) this.cancelAdding()
        this._layer?.classList.toggle('anp-editable', v)
        this._renderCard()
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    /** id of the open annotation, or null */
    get openId() {
        return this._openId
    }

    /** The next click on a surface places a new annotation ({@link startAdding}) */
    get adding() {
        return !!this._place
    }

    /** The tour of {@link playTour} runs */
    get touring() {
        return !!this._tour
    }

    // region lifecycle

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        if (AnnotationsPlugin.InjectStyles && !AnnotationsPlugin._styles?.isConnected) AnnotationsPlugin._styles = createStyles(styles)
        const layer = el('div', 'anp-layer')
        layer.classList.toggle('anp-editable', this._editable)
        viewer.container.appendChild(layer)
        this._layer = layer
        this._buildCard(layer)
        window.addEventListener('keydown', this._onKeyDown, {capture: true})
        window.addEventListener('pointerdown', this._onWindowDown, {capture: true})
        window.addEventListener('pointerup', this._onWindowUp, {capture: true})
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.addEventListener('addSceneObject', this._onHierarchy)
        this._syncMarkers()
        this._raf = requestAnimationFrame(this._tick)
    }

    onRemove(viewer: ThreeViewer) {
        cancelAnimationFrame(this._raf)
        this.stopTour()
        this._stopAnim()
        this.cancelAdding()
        window.removeEventListener('keydown', this._onKeyDown, {capture: true})
        window.removeEventListener('pointerdown', this._onWindowDown, {capture: true})
        window.removeEventListener('pointerup', this._onWindowUp, {capture: true})
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.removeEventListener('addSceneObject', this._onHierarchy)
        this._resizer?.disconnect()
        this._layer?.remove()
        this._layer = undefined
        this._card = undefined
        this._markers.clear()
        this._objCache.clear()
        this._openId = null
        this._drag = null
        super.onRemove(viewer)
    }

    fromJSON(data: ISerializedConfig, meta?: SerializationMetaType): this | null {
        if (data.type !== AnnotationsPlugin.PluginType) return null
        // the deserializer fills an existing array in place and keeps extra items, so start from an empty one
        this.annotations = []
        if (!super.fromJSON(data, meta)) return null
        this.annotations = (this.annotations || []).filter(a => a && a.id && a.anchor && Array.isArray(a.anchor.point)).map(a => ({
            id: String(a.id),
            title: a.title || '',
            text: a.text || '',
            anchor: {...a.anchor, normal: Array.isArray(a.anchor.normal) ? a.anchor.normal : [0, 1, 0]},
            view: a.view && Array.isArray(a.view.position) ? a.view : null,
        }))
        this.stopTour()
        if (this._openId) this.close()
        this._objCache.clear()
        this._changed('load')
        return this
    }

    protected _viewerListeners = {
        // markers in sync with the rendered frame (the rAF loop covers the frames that are not rendered)
        postFrame: () => this._updateScreen(),
        postRender: () => {
            this._rendered = true
        },
    }

    private _onSceneUpdate = (e: {hierarchyChanged?: boolean}) => {
        if (e?.hierarchyChanged) this._cacheGen++
        this._occlDirty = true
    }

    private _onHierarchy = () => {
        this._cacheGen++
        this._occlDirty = true
    }

    private _tick = () => {
        this._raf = requestAnimationFrame(this._tick)
        if (!this._viewer || !this._layer) return
        const show = !this.isDisabled()
        this._layer.style.display = show ? '' : 'none'
        if (!show) return
        this._updateScreen()
        this._updateOcclusion()
    }

    // endregion

    // region public API

    getAnnotations(): readonly Annotation[] {
        return this.annotations
    }

    /** An annotation by its place in the tour (a number) or its id */
    get(indexOrId: number | string): Annotation | undefined {
        return typeof indexOrId === 'number' ? this.annotations[indexOrId] : this.annotations.find(a => a.id === indexOrId)
    }

    indexOf(id: string) {
        return this.annotations.findIndex(a => a.id === id)
    }

    /** The current camera view, in world space */
    captureView(): AnnotationView {
        const cam = this._viewer!.scene.mainCamera
        const v = cam.getView(true)
        const view: AnnotationView = {position: v.position.toArray(), target: v.target.toArray(), quaternion: v.quaternion.toArray(), zoom: v.zoom}
        if ((cam as any).isPerspectiveCamera) view.fov = (cam as any).fov
        return view
    }

    /**
     * Add an annotation on `object` at a point and normal in its local space. `view` defaults to the current camera view.
     * `content.instanceId`: an instance of an InstancedMesh, the point and the normal are then in that instance's space.
     * Undoable. Returns the new annotation.
     */
    add(object: IObject3D, localPoint: Vector3, localNormal: Vector3, view?: AnnotationView | null, content: {title?: string, text?: string, instanceId?: number} = {}): Annotation {
        const a: Annotation = {
            id: MathUtils.generateUUID(),
            title: content.title ?? '',
            text: content.text ?? '',
            anchor: this._makeAnchor(object, localPoint, localNormal, content.instanceId),
            view: view === undefined ? this.captureView() : view,
        }
        const index = this.annotations.length
        this._insert(a, index)
        this._record(() => this._delete(a.id), () => this._insert(a, index))
        return a
    }

    /** Remove an annotation. Undoable. */
    remove(id: string) {
        const index = this.indexOf(id)
        if (index < 0) return
        const a = this.annotations[index]
        this._delete(id)
        this._record(() => this._insert(a, index), () => this._delete(id))
    }

    /** Remove all annotations. Undoable. */
    clear() {
        const before = [...this.annotations]
        if (!before.length) return
        const set = (list: Annotation[]) => {
            if (this._openId) this.close()
            this.annotations = [...list]
            this._changed('clear')
        }
        set([])
        this._record(() => set(before), () => set([]))
    }

    /** Change the title, text or view of an annotation. Undoable. */
    update(id: string, patch: Partial<Pick<Annotation, 'title' | 'text' | 'view'>>) {
        const a = this.get(id)
        if (!a) return
        const before: typeof patch = {}
        for (const k of Object.keys(patch) as (keyof typeof patch)[]) (before as any)[k] = a[k]
        this._patch(id, patch)
        this._record(() => this._patch(id, before), () => this._patch(id, patch))
    }

    /** Save the current camera view in the annotation (default: the open one). Undoable. */
    updateView(id = this._openId) {
        if (id) this.update(id, {view: this.captureView()})
    }

    /** Move an annotation to another place in the tour order. Undoable. */
    move(id: string, toIndex: number) {
        const from = this.indexOf(id)
        toIndex = Math.max(0, Math.min(this.annotations.length - 1, toIndex))
        if (from < 0 || from === toIndex) return
        const mv = (a: number, b: number) => {
            const [item] = this.annotations.splice(a, 1)
            this.annotations.splice(b, 0, item)
            this._changed('reorder', item)
        }
        mv(from, toIndex)
        this._record(() => mv(toIndex, from), () => mv(from, toIndex))
    }

    /**
     * Open an annotation: the camera goes to its saved view and the card opens.
     * @param indexOrId - place in the tour or id
     * @param options - `fly: false` keeps the camera; `focusTitle` puts the cursor in the title (editable only)
     */
    goTo(indexOrId: number | string, options: {fly?: boolean, focusTitle?: boolean} = {}) {
        const a = this.get(indexOrId)
        if (!a) return
        if (a.id !== this._openId) this._commitEdit() // the field edits the annotation it was focused for
        this._openId = a.id
        this._renderCard()
        this._syncMarkers()
        this._positionCard(true)
        if (this._card) this._resizer?.observe(this._card)
        if (options.fly !== false && a.view) this._flyTo(a.view)
        else this._stopAnim() // a flight to the annotation before ends here
        if (this._card) {
            if (options.focusTitle && this._editable) {
                this._cardEls.titleIn.focus({preventScroll: true})
            } else if (!this._card.contains(document.activeElement)) {
                this._card.focus({preventScroll: true}) // so ←/→ reach this card
            }
        }
        this.dispatchEvent({type: 'annotationSelect', annotation: a, index: this.indexOf(a.id)})
    }

    /** Open the next annotation (after the last: the first) */
    next() {
        const n = this.annotations.length
        if (!n) return
        const i = this._openId ? this.indexOf(this._openId) : -1
        this.goTo((i + 1) % n)
    }

    /** Open the previous annotation (before the first: the last) */
    prev() {
        const n = this.annotations.length
        if (!n) return
        const i = this._openId ? this.indexOf(this._openId) : 0
        this.goTo((i - 1 + n) % n)
    }

    /** Close the card */
    close() {
        if (!this._openId) return
        this._commitEdit()
        if (this._card) this._resizer?.unobserve(this._card)
        this._openId = null
        this._renderCard()
        this._syncMarkers()
        this.dispatchEvent({type: 'annotationSelect', annotation: null, index: -1})
    }

    /** Go through the annotations one after another, like Sketchfab's autopilot. Any click or key stops it. */
    playTour(intervalMs = 5000) {
        this.stopTour()
        if (!this.annotations.length) return
        this.next()
        this._tour = window.setInterval(() => this.next(), Math.max(1000, intervalMs))
    }

    stopTour() {
        if (this._tour) window.clearInterval(this._tour)
        this._tour = 0
    }

    /**
     * Editable only: the next click on a surface places a new annotation there, with the current camera view. Esc or a
     * right click cancels. Returns false when it did not start (not editable, not added, or already placing).
     */
    startAdding() {
        const layer = this._layer
        if (!this._editable || !this._viewer || !layer || this._place) return false
        this.stopTour()
        this.close()
        const place = el('div', 'anp-place')
        place.tabIndex = -1 // focused, so Esc reaches it
        const ghost = el('div', 'anp-ghost', place)
        ghost.textContent = '+'
        const hint = el('div', 'anp-hint', place)
        hint.innerHTML = 'Click a surface to place the annotation. The current view is saved with it. <b>Esc</b> cancels.'
        let down: {x: number, y: number} | null = null
        place.addEventListener('pointermove', e => {
            const hit = this._pick(e.clientX, e.clientY)
            const r = layer.getBoundingClientRect()
            ghost.style.display = hit ? 'flex' : 'none'
            ghost.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`
        })
        place.addEventListener('pointerdown', e => {
            e.stopPropagation()
            if (e.button === 0) down = {x: e.clientX, y: e.clientY}
        })
        place.addEventListener('pointerup', e => {
            e.stopPropagation()
            if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
            down = null
            const hit = this._pick(e.clientX, e.clientY)
            if (!hit) {
                place.classList.remove('anp-miss')
                void place.offsetWidth // restart the shake
                place.classList.add('anp-miss')
                return
            }
            this.cancelAdding()
            const a = this.add(hit.object, hit.localPoint, hit.localNormal, undefined, {instanceId: hit.instanceId})
            this.goTo(a.id, {fly: false, focusTitle: true})
        })
        // keep zooming possible while placing
        place.addEventListener('wheel', e => {
            e.preventDefault()
            this._viewer?.canvas.dispatchEvent(new WheelEvent('wheel', e))
        }, {passive: false})
        place.addEventListener('contextmenu', e => {
            e.preventDefault()
            this.cancelAdding()
        })
        layer.appendChild(place)
        place.focus({preventScroll: true})
        this._place = place
        layer.classList.add('anp-adding')
        this.dispatchEvent({type: 'addingChange', adding: true})
        return true
    }

    /** Stop placing a new annotation ({@link startAdding}) */
    cancelAdding() {
        if (!this._place) return
        this._place.remove()
        this._place = null
        this._layer?.classList.remove('anp-adding')
        this.dispatchEvent({type: 'addingChange', adding: false})
    }

    /** The object an annotation is on, or null when it is not in the scene */
    getObject(a: Annotation): IObject3D | null {
        const c = this._objCache.get(a.id)
        if (c && c.obj && this._inScene(c.obj)) return c.obj
        if (c && !c.obj && c.gen === this._cacheGen) return null
        const root = this._viewer?.scene.modelRoot
        const obj = (root?.getObjectByProperty('uuid', a.anchor.uuid) as IObject3D | undefined) || this._byPath(a.anchor.path) || null
        this._objCache.set(a.id, {obj, gen: this._cacheGen})
        return obj
    }

    // endregion

    // region data changes (no undo here)

    private _insert(a: Annotation, index: number) {
        this.annotations.splice(Math.min(index, this.annotations.length), 0, a)
        this._changed('add', a)
    }

    private _delete(id: string) {
        const i = this.indexOf(id)
        if (i < 0) return
        const [a] = this.annotations.splice(i, 1)
        if (this._openId === id) this.close()
        this._objCache.delete(id)
        this._changed('remove', a)
    }

    private _patch(id: string, patch: Partial<Annotation>) {
        const a = this.get(id)
        if (!a) return
        Object.assign(a, patch)
        if (patch.anchor) this._objCache.delete(id)
        this._changed('update', a)
    }

    private _changed(reason: AnnotationsPluginEventMap['annotationChange']['reason'], annotation?: Annotation) {
        this._occlDirty = true
        this._syncMarkers()
        this._renderCard()
        this.dispatchEvent({type: 'annotationChange', reason, annotation})
    }

    private _record(undo: () => void, redo: () => void) {
        this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo, redo})
    }

    // endregion

    // region objects and picking

    private _makeAnchor(object: IObject3D, localPoint: Vector3, localNormal: Vector3, instanceId?: number): AnnotationAnchor {
        const n = localNormal.clone()
        if (n.lengthSq() < 1e-12) n.set(0, 1, 0)
        const anchor: AnnotationAnchor = {
            uuid: object.uuid,
            path: this._pathOf(object),
            name: object.name || object.type,
            point: localPoint.toArray(),
            normal: n.normalize().toArray(),
        }
        if (instanceId !== undefined) anchor.instanceId = instanceId
        return anchor
    }

    /** The world matrix of an anchor's space: the object's, times the instance's for an instance of an InstancedMesh */
    private _anchorMatrix(o: IObject3D, anchor: AnnotationAnchor, target: Matrix4) {
        const mesh = o as any
        const id = anchor.instanceId
        if (id === undefined || !mesh.isInstancedMesh || id >= mesh.count) return target.copy(o.matrixWorld)
        mesh.getMatrixAt(id, target)
        return target.premultiply(o.matrixWorld)
    }

    private _pathOf(object: IObject3D) {
        const root = this._viewer?.scene.modelRoot
        const parts: string[] = []
        let o: IObject3D | null = object
        while (o && o !== root && o.parent) {
            const name = o.name
            const same = o.parent.children.filter(c => c.name === name)
            parts.unshift(`${name}#${same.indexOf(o)}`)
            o = o.parent as IObject3D
        }
        return parts.join('/')
    }

    private _byPath(path: string): IObject3D | null {
        let o: IObject3D | undefined = this._viewer?.scene.modelRoot
        if (!path || !o) return null
        for (const part of path.split('/')) {
            const k = part.lastIndexOf('#')
            const name = part.slice(0, k)
            const idx = parseInt(part.slice(k + 1)) || 0
            o = o.children.filter(c => c.name === name)[idx] as IObject3D | undefined
            if (!o) return null
        }
        return o
    }

    private _inScene(o: IObject3D | null) {
        const scene = this._viewer?.scene
        for (let p: any = o; p; p = p.parent) if (p === scene) return true
        return false
    }

    /** A hit on a visible mesh, and a face that is not hidden or a shadow catcher: it can hold an annotation and hide one */
    private _solid(hit: Intersection) {
        const o = hit.object as any
        if (!o?.isMesh) return false
        const m = Array.isArray(o.material) ? o.material[hit.face?.materialIndex ?? 0] : o.material
        if (!m || m.type === 'ShadowMaterial' || m.visible === false) return false
        for (let p = o; p; p = p.parent) if (!p.visible) return false
        return true
    }

    /** Surface under a client (page) point, or null */
    private _pick(clientX: number, clientY: number): Hit | null {
        const v = this._viewer
        if (!v) return null
        const r = v.canvas.getBoundingClientRect()
        const ndc = new Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1)
        const ray = this._ray
        ray.setFromCamera(ndc, v.scene.mainCamera)
        ray.near = 0
        ray.far = Infinity
        const h = ray.intersectObject(v.scene.modelRoot, true).find(x => this._solid(x))
        if (!h || h.object.userData.userSelectable === false) return null // nothing, or the ground
        const object = h.object as IObject3D
        object.updateWorldMatrix(true, false)
        // an instance of an InstancedMesh: the point and the normal in the instance's space (face.normal is in it)
        const instanceId = (object as any).isInstancedMesh ? h.instanceId : undefined
        const toLocal = this._anchorMatrix(object, {instanceId} as AnnotationAnchor, new Matrix4()).invert()
        const localPoint = h.point.clone().applyMatrix4(toLocal)
        let localNormal: Vector3
        if (h.face) {
            localNormal = h.face.normal.clone()
        } else {
            const toCam = ray.ray.direction.clone().negate()
            localNormal = toCam.transformDirection(toLocal)
        }
        return {object, localPoint, localNormal, instanceId}
    }

    // endregion

    // region markers

    private _syncMarkers() {
        const layer = this._layer
        if (!layer) return
        const ids = new Set(this.annotations.map(a => a.id))
        for (const [id, st] of this._markers) {
            if (ids.has(id)) continue
            st.el.remove()
            this._markers.delete(id)
        }
        this.annotations.forEach((a, i) => {
            let st = this._markers.get(a.id)
            if (!st) {
                const marker = el('div', 'anp-marker')
                marker.dataset.id = a.id
                marker.addEventListener('pointerdown', this._onMarkerDown)
                marker.addEventListener('pointermove', this._onMarkerMove)
                marker.addEventListener('pointerup', this._onMarkerUp)
                marker.addEventListener('pointercancel', this._onMarkerUp)
                layer.insertBefore(marker, this._card!)
                st = {el: marker, world: new Vector3(), ndc: new Vector2(), x: 0, y: 0, onScreen: false, occluded: false, facing: true}
                this._markers.set(a.id, st)
            }
            const num = String(i + 1)
            if (st.el.textContent !== num) st.el.textContent = num
            st.el.title = a.title || `Annotation ${num}`
            st.el.classList.toggle('anp-on', a.id === this._openId)
        })
    }

    /** Project every anchor to the screen and place the markers and the card */
    private _updateScreen() {
        const v = this._viewer
        const layer = this._layer
        if (!v || !layer || this.isDisabled()) return
        const cam = v.scene.mainCamera
        cam.updateMatrixWorld()
        const cr = v.canvas.getBoundingClientRect()
        const lr = layer.getBoundingClientRect()
        const ox = cr.left - lr.left, oy = cr.top - lr.top, w = cr.width, h = cr.height
        const camPos = cam.getWorldPosition(new Vector3())
        const viewDir = (cam as any).isOrthographicCamera ? cam.getWorldDirection(new Vector3()).negate() : null
        const ndc = new Vector3(), n = new Vector3(), toCam = new Vector3()
        let key = 0
        const me = cam.matrixWorld.elements, pe = cam.projectionMatrix.elements
        for (let i = 0; i < 16; i++) key += me[i] * (i + 1) + pe[i] * (i + 17)
        this.annotations.forEach((a, i) => {
            const st = this._markers.get(a.id)
            if (!st) return
            const o = this.getObject(a)
            let visible = !!o
            if (o) for (let p: any = o; p; p = p.parent) if (!p.visible) visible = false
            if (o && visible) {
                st.world.fromArray(a.anchor.point).applyMatrix4(this._anchorMatrix(o, a.anchor, this._am))
                ndc.copy(st.world).project(cam)
                visible = ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2
                st.ndc.set(ndc.x, ndc.y)
                key += (st.world.x * 1.1 + st.world.y * 1.3 + st.world.z * 1.7) * (i + 1)
            }
            if (!visible) {
                st.onScreen = false
                st.el.style.display = 'none'
                return
            }
            st.x = ox + (ndc.x + 1) / 2 * w
            st.y = oy + (1 - ndc.y) / 2 * h
            n.fromArray(a.anchor.normal).applyMatrix3(this._nm.getNormalMatrix(this._am)).normalize()
            toCam.copy(viewDir || toCam.subVectors(camPos, st.world))
            st.facing = n.dot(toCam) > 0
            st.onScreen = true
            st.el.style.display = ''
            st.el.style.transform = `translate(${st.x.toFixed(1)}px, ${st.y.toFixed(1)}px)`
            st.el.classList.toggle('anp-dim', st.occluded || !st.facing)
        })
        if (Math.abs(key - this._lastKey) > 1e-7 || isNaN(this._lastKey)) {
            this._lastKey = key
            this._occlDirty = true
        }
        this._positionCard()
    }

    /** A few rays per frame, round robin, only after something changed */
    private _updateOcclusion() {
        const v = this._viewer
        if (!v) return
        if (this._rendered && performance.now() - this._occlTime >= this.occlusionRecheckInterval) this._occlDirty = true
        if (this._occlDirty && !this._occlQueue.length) {
            this._occlDirty = false
            this._rendered = false
            this._occlTime = performance.now()
            this._occlQueue = this.annotations.map(a => a.id)
        }
        if (!this._occlQueue.length) return
        const cam = v.scene.mainCamera
        const ray = this._ray
        const t0 = performance.now()
        let budget = this.occlusionRaysPerFrame
        while (this._occlQueue.length && budget-- > 0 && performance.now() - t0 < 2) {
            const st = this._markers.get(this._occlQueue.shift()!)
            if (!st || !st.onScreen) continue
            ray.setFromCamera(st.ndc, cam)
            const dist = ray.ray.origin.distanceTo(st.world)
            ray.near = 0
            ray.far = Math.max(0, dist - Math.max(1e-4, dist * 0.004))
            st.occluded = ray.intersectObject(v.scene.modelRoot, true).some(hh => this._solid(hh))
            st.el.classList.toggle('anp-dim', st.occluded || !st.facing)
        }
    }

    private _onMarkerDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        const marker = e.currentTarget as HTMLDivElement
        const a = this.get(marker.dataset.id || '')
        if (!a) return
        this.stopTour()
        marker.setPointerCapture(e.pointerId)
        this._drag = {id: a.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, before: {...a.anchor}}
    }

    private _onMarkerMove = (e: PointerEvent) => {
        const d = this._drag
        if (!d || d.pointerId !== e.pointerId) return
        if (!d.moved) {
            if (!this._editable || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
            d.moved = true
            this._layer?.classList.add('anp-dragging')
        }
        const hit = this._pick(e.clientX, e.clientY)
        const a = this.get(d.id)
        if (!hit || !a) return
        // live move without an event or an undo step; the pointer up records one step
        a.anchor = this._makeAnchor(hit.object, hit.localPoint, hit.localNormal, hit.instanceId)
        this._objCache.delete(a.id)
        this._occlDirty = true
    }

    private _onMarkerUp = (e: PointerEvent) => {
        const d = this._drag
        if (!d || d.pointerId !== e.pointerId) return
        this._drag = null
        this._layer?.classList.remove('anp-dragging')
        const a = this.get(d.id)
        if (!a) return
        if (!d.moved) {
            this.goTo(a.id)
            return
        }
        const after = a.anchor
        if (JSON.stringify(after) === JSON.stringify(d.before)) return
        const before = d.before
        this._patch(a.id, {anchor: after}) // dispatch the change
        this._record(() => this._patch(a.id, {anchor: before}), () => this._patch(a.id, {anchor: after}))
    }

    // endregion

    // region card

    private _buildCard(layer: HTMLDivElement) {
        const card = el('div', 'anp-card', layer)
        card.tabIndex = -1
        const head = el('div', 'anp-head', card)
        const num = el('span', 'anp-num', head)
        const title = el('div', 'anp-title', head)
        const titleIn = el('input', 'anp-title-in', head)
        titleIn.placeholder = 'Title'
        titleIn.spellcheck = true
        button(head, 'anp-btn anp-x', ICONS.close, 'Close (Esc)', () => this.close())
        const text = el('div', 'anp-text', card)
        const textIn = el('textarea', 'anp-text-in', card)
        textIn.rows = 2
        textIn.placeholder = 'Description. **bold**, *italic*, [link](https://…)'
        textIn.spellcheck = true
        // the bar at the bottom: ‹ 1 / 3 › and, editable, the tools on the right
        const nav = el('div', 'anp-nav', card)
        const prev = button(nav, 'anp-btn anp-prev', ICONS.prev, 'Previous (←)', () => this.prev())
        const pos = el('span', 'anp-pos', nav)
        const next = button(nav, 'anp-btn anp-next', ICONS.next, 'Next (→)', () => this.next())
        const tools = el('div', 'anp-tools', nav)
        const view = button(tools, 'anp-btn anp-view', ICONS.view + '<span>Update view</span>', 'Save the current camera view in this annotation', () => this.updateView())
        button(tools, 'anp-btn anp-del', ICONS.delete, 'Delete this annotation', () => this._openId && this.remove(this._openId))
        this._cardEls = {num, title, titleIn, text, textIn, view, pos, prev, next}
        card.addEventListener('pointerdown', e => {
            e.stopPropagation()
            this.stopTour()
        })
        card.addEventListener('wheel', e => e.stopPropagation())
        this._bindField(titleIn, 'title')
        this._bindField(textIn, 'text')
        text.addEventListener('click', e => {
            if (!this._editable || (e.target as HTMLElement).closest('a')) return
            card.classList.add('anp-text-editing')
            textIn.focus()
            this._autosize()
        })
        textIn.addEventListener('blur', () => card.classList.remove('anp-text-editing'))
        this._card = card
        this._renderCard()
    }

    /** Live edit, one undo step per edit (focus → blur) */
    private _bindField(input: HTMLInputElement | HTMLTextAreaElement, key: 'title' | 'text') {
        let before = ''
        let id = ''
        input.addEventListener('focus', () => {
            id = this._openId || ''
            before = this.get(id)?.[key] ?? ''
        })
        input.addEventListener('input', () => {
            const a = this.get(id)
            if (!a) return
            a[key] = input.value
            if (key === 'text') this._autosize()
            if (key === 'title') this._syncMarkers()
            this.dispatchEvent({type: 'annotationChange', reason: 'update', annotation: a})
        })
        input.addEventListener('change', () => {
            const a = this.get(id)
            const after = input.value
            if (!a || after === before) return
            const b = before
            before = after
            this._renderCard() // the formatted text, shown after the blur
            this._record(() => this._patch(a.id, {[key]: b}), () => this._patch(a.id, {[key]: after}))
        })
        input.addEventListener('keydown', (ev: Event) => {
            const e = ev as KeyboardEvent
            e.stopPropagation() // keep typing (Ctrl+Z, Delete, arrows) away from the scene hotkeys
            if (e.key === 'Escape') {
                input.blur()
                this._card?.focus({preventScroll: true})
            } else if (e.key === 'Enter' && key === 'title') {
                e.preventDefault()
                this._card?.classList.add('anp-text-editing')
                this._cardEls.textIn.focus()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                input.blur()
                this._card?.focus({preventScroll: true})
            }
        })
    }

    /** Ends an edit in the card: the blur commits it as one undo step */
    private _commitEdit() {
        const active = document.activeElement as HTMLElement | null
        if (active && this._card?.contains(active)) active.blur()
    }

    private _autosize() {
        const t = this._cardEls.textIn
        t.style.height = 'auto'
        t.style.height = Math.min(240, t.scrollHeight + 2) + 'px'
    }

    private _renderCard() {
        const card = this._card
        if (!card) return
        const a = this._openId ? this.get(this._openId) : undefined
        card.classList.toggle('anp-open', !!a)
        if (!a) return
        const els = this._cardEls
        const i = this.indexOf(a.id)
        const n = this.annotations.length
        card.classList.toggle('anp-edit', this._editable)
        card.classList.toggle('anp-text-empty', !a.text.trim())
        els.num.textContent = String(i + 1)
        els.title.textContent = a.title || `Annotation ${i + 1}`
        els.text.innerHTML = renderAnnotationText(a.text)
        els.text.style.display = a.text.trim() ? '' : 'none'
        if (document.activeElement !== els.titleIn && els.titleIn.value !== a.title) els.titleIn.value = a.title
        if (document.activeElement !== els.textIn && els.textIn.value !== a.text) els.textIn.value = a.text
        if (this._editable) requestAnimationFrame(() => this._autosize())
        els.pos.textContent = `${i + 1} / ${n}`
        els.prev.disabled = els.next.disabled = n < 2
        els.view.classList.toggle('anp-noview', !a.view)
        this._cardSize.w = 0 // measure again
    }

    /** Next to the marker, flipped to the left when there is no room on the right */
    private _positionCard(force = false) {
        const id = this._openId
        const card = this._card
        const layer = this._layer
        if (!id || !card || !layer) return
        const st = this._markers.get(id)
        if (!st || !st.onScreen && !force) return
        if (!this._cardSize.w || force) this._cardSize = {w: card.offsetWidth, h: card.offsetHeight}
        const {w, h} = this._cardSize
        const W = layer.clientWidth, H = layer.clientHeight
        let x = st.x + 22
        if (x + w > W - 8) x = st.x - 22 - w
        x = Math.max(8, Math.min(W - w - 8, x))
        // the head of the card (1px border + 8px padding + half of its 24px row) level with the marker
        const y = Math.max(8, Math.min(H - h - 8, st.y - 21))
        card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }

    // endregion

    // region camera

    private _stopAnim() {
        this._anim?.stop()
        this._anim = null
        this._animCam?.setInteractions(true, AnnotationsPlugin.PluginType)
        this._animCam = null
    }

    private _flyTo(view: AnnotationView) {
        const v = this._viewer
        if (!v) return
        this._stopAnim()
        const cam = v.scene.mainCamera
        const cv = {
            name: '', position: new Vector3().fromArray(view.position), target: new Vector3().fromArray(view.target),
            quaternion: new Quaternion().fromArray(view.quaternion as [number, number, number, number]), zoom: view.zoom ?? 1,
        } as ICameraView
        const anim = animateCameraToViewSpherical(cam, cv)
        const persp = (cam as any).isPerspectiveCamera && typeof view.fov === 'number'
        const fov0: number = (cam as any).fov
        const setFov = (t: number) => {
            if (persp && Math.abs(fov0 - view.fov!) > 1e-4) (cam as any).fov = fov0 + (view.fov! - fov0) * t
        }
        const camPos = cam.getWorldPosition(new Vector3())
        const travel = camPos.distanceTo(cv.position) + cam.target.distanceTo(cv.target)
        const size = Math.max(camPos.distanceTo(cam.target), 0.1)
        const duration = Math.max(250, this.animDuration * Math.min(1, travel / size))
        // the animation turns the camera to the target. A camera without controls (that would turn it back) and without
        // autoLookAtTarget gets the rotation of the view at the end, so a roll in the view is kept
        const keepRoll = !cam.userData.autoLookAtTarget && !(cam.controls && (cam.controls as any).enabled !== false)
        const complete = () => {
            anim.onComplete?.()
            setFov(1)
            if (!keepRoll) return
            const q = cv.quaternion.clone() // world space
            if (cam.parent) q.premultiply(cam.parent.getWorldQuaternion(new Quaternion()).invert())
            if (q.angleTo(cam.quaternion) < 1e-6) return
            cam.quaternion.copy(q)
            cam.setDirty()
        }
        const pop = v.getPlugin(PopmotionPlugin)
        if (!pop || travel < 1e-5) {
            complete()
            return
        }
        cam.setInteractions(false, AnnotationsPlugin.PluginType)
        this._animCam = cam
        const done = () => {
            if (this._animCam === cam) {
                cam.setInteractions(true, AnnotationsPlugin.PluginType)
                this._animCam = null
                this._anim = null
            }
        }
        this._anim = pop.animate({
            from: 0, to: 1, duration, ease: EasingFunctions.easeInOutSine,
            onUpdate: (t: number) => {
                anim.onUpdate?.(t)
                setFov(t)
            },
            onComplete: () => {
                complete()
                done()
            },
            onStop: done,
        })
    }

    // endregion

    // region keys and clicks

    private _onKeyDown = (e: KeyboardEvent) => {
        if (this.isDisabled() || !this._layer) return
        const t = e.target as HTMLElement | null
        if (t && (t.isContentEditable || t.closest?.('input, textarea, select'))) return
        this.stopTour()
        if (e.key === 'Escape' && (this._place || this._openId)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (this._place) this.cancelAdding()
            else this.close()
            return
        }
        if (!this._openId || e.ctrlKey || e.metaKey || e.altKey) return
        // only when the focus is on the page, the canvas or this card, not in another panel
        const ok = !t || t === document.body || t === this._viewer?.canvas || this._layer.contains(t)
        if (!ok || e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === 'ArrowLeft') this.prev()
        else this.next()
    }

    /** A click (no drag) on the canvas closes the card; dragging to orbit keeps it */
    private _onWindowDown = (e: PointerEvent) => {
        const canvas = e.target === this._viewer?.canvas
        if (canvas) this.stopTour()
        this._down = {x: e.clientX, y: e.clientY, canvas}
    }

    private _onWindowUp = (e: PointerEvent) => {
        const d = this._down
        this._down = null
        if (!d || !d.canvas || !this._openId || this._drag || this._place) return
        if (e.target === this._viewer?.canvas && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.close()
    }

    // endregion
}

/** The icons of the card (24 px grid, drawn with the text colour, shown at 14 px as the icons of the editor) */
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICONS = {
    close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    prev: svg('<path d="m15 18-6-6 6-6"/>'),
    next: svg('<path d="m9 18 6-6-6-6"/>'),
    view: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>'),
    delete: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
}

/** A new element with a class, added to `parent` */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    e.className = className
    parent?.appendChild(e)
    return e
}

/** A button with an icon (and a label), a tooltip and a click action */
function button(parent: HTMLElement, className: string, html: string, title: string, onClick: () => void) {
    const b = el('button', className, parent)
    b.type = 'button'
    b.innerHTML = html
    b.title = title
    b.setAttribute('aria-label', title)
    b.addEventListener('click', onClick)
    return b
}
