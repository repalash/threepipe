import {
    animateCameraToViewSpherical,
    AnimationResult,
    AViewerPluginEventMap,
    AViewerPluginSync,
    EasingFunctions,
    ICamera,
    ICameraView,
    IObject3D,
    ISerializedConfig,
    MathUtils,
    Matrix3,
    PopmotionPlugin,
    Quaternion,
    Raycaster,
    serialize,
    SerializationMetaType,
    ThreeViewer,
    UndoManagerPlugin,
    Vector2,
    Vector3,
} from 'threepipe'

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
    /** uuid of the object. The .glb export keeps object uuids (userData.gltfUUID), so this finds the object after a reload */
    uuid: string
    /** Fallback when the uuid is not found: names from the model root, e.g. "Ring#0/Band#0" (#n: n-th sibling with that name) */
    path: string
    /** Object name, for lists */
    name: string
    point: number[]
    normal: number[]
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
    point: Vector3 // world
    localPoint: Vector3
    localNormal: Vector3
}

/**
 * 3D annotations ("hotspots"), like Sketchfab: numbered markers on the model. Click one: the camera goes to the view
 * saved with it and a card shows its title and text, with ‹ prev / next › (also ←/→, Esc closes).
 *
 * - Saved in the .glb: {@link annotations} is a serialized property, so `viewer.exportScene({viewerConfig: true})` writes
 *   it into the file's viewer config and loading the file restores it.
 * - Markers are attached to an object (local point + normal), so they follow the object when it moves or animates.
 * - Markers behind geometry or on a surface that faces away are dimmed. The occlusion test casts a few rays per frame,
 *   only after the camera, an anchor or the scene changed.
 * - {@link editable}: {@link startAdding} (then click a surface), edit title/text in the card, "Update view", delete,
 *   and drag a marker to another surface point. All edits are undoable with {@link UndoManagerPlugin}.
 * - Tour: {@link goTo}, {@link next}, {@link prev}, {@link playTour}; events `annotationChange` and `annotationSelect`
 *   for an outside list.
 */
export class AnnotationsPlugin extends AViewerPluginSync<AnnotationsPluginEventMap> {
    static readonly PluginType = 'AnnotationsPlugin'
    dependencies = [PopmotionPlugin]
    enabled = true

    /** All annotations in tour order. Saved with the scene (in the .glb). Change them through the methods. */
    @serialize()
        annotations: Annotation[] = []

    /** Camera animation time in ms for a large move (short moves are faster) */
    animDuration = 900
    /** Max rays per frame for the occlusion test (it also stops after ~2 ms) */
    occlusionRaysPerFrame = 8

    private _editable: boolean
    private _layer!: HTMLDivElement
    private _card!: HTMLDivElement
    private _cardEls!: {
        num: HTMLElement, title: HTMLElement, titleIn: HTMLInputElement, text: HTMLElement, textIn: HTMLTextAreaElement,
        pos: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement,
    }
    private _place: HTMLDivElement | null = null
    private _markers = new Map<string, MarkerState>()
    private _objCache = new Map<string, {obj: IObject3D | null, gen: number}>()
    private _cacheGen = 0
    private _openId: string | null = null
    private _raf = 0
    private _anim: AnimationResult | null = null
    private _animCam: ICamera | null = null
    private _occlDirty = true
    private _occlQueue: string[] = []
    private _lastKey = NaN
    private _ray = new Raycaster()
    private _nm = new Matrix3()
    private _down: {x: number, y: number, canvas: boolean} | null = null
    private _drag: {id: string, pointerId: number, x: number, y: number, moved: boolean, before: AnnotationAnchor} | null = null
    private _tour = 0
    private _cardSize = {w: 0, h: 0}

    constructor(options: AnnotationsPluginOptions = {}) {
        super()
        this._editable = !!options.editable
    }

    get editable() {
        return this._editable
    }

    set editable(v: boolean) {
        if (this._editable === v) return
        this._editable = v
        if (!v) this.cancelAdding()
        this._layer?.classList.toggle('anp-editable', v)
        this._renderCard()
    }

    /** id of the open annotation, or null */
    get openId() {
        return this._openId
    }

    get adding() {
        return !!this._place
    }

    get touring() {
        return !!this._tour
    }

    // region lifecycle

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        injectStyles()
        const layer = document.createElement('div')
        layer.className = 'anp-layer' + (this._editable ? ' anp-editable' : '')
        viewer.container.appendChild(layer)
        this._layer = layer
        this._buildCard()
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
        this._layer?.remove()
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
        // markers in sync with the rendered frame (the rAF loop covers frames that are not rendered)
        postFrame: () => this._updateScreen(),
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
        if (!this._viewer) return
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
     * Undoable. Returns the new annotation.
     */
    add(object: IObject3D, localPoint: Vector3, localNormal: Vector3, view?: AnnotationView | null, content: {title?: string, text?: string} = {}): Annotation {
        const a: Annotation = {
            id: MathUtils.generateUUID(),
            title: content.title ?? '',
            text: content.text ?? '',
            anchor: this._makeAnchor(object, localPoint, localNormal),
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

    /** Open an annotation: the camera goes to its saved view and the card opens */
    goTo(indexOrId: number | string, options: {fly?: boolean, focusTitle?: boolean} = {}) {
        const a = this.get(indexOrId)
        if (!a) return
        this._openId = a.id
        this._renderCard()
        this._syncMarkers()
        this._positionCard(true)
        if (options.fly !== false && a.view) this._flyTo(a.view)
        if (options.focusTitle && this._editable) {
            this._cardEls.titleIn.focus({preventScroll: true})
        } else if (!this._card.contains(document.activeElement)) {
            this._card.focus({preventScroll: true}) // so ←/→ reach this card and not an arrow-key nudge
        }
        this.dispatchEvent({type: 'annotationSelect', annotation: a, index: this.indexOf(a.id)})
    }

    next() {
        const n = this.annotations.length
        if (!n) return
        const i = this._openId ? this.indexOf(this._openId) : -1
        this.goTo((i + 1) % n)
    }

    prev() {
        const n = this.annotations.length
        if (!n) return
        const i = this._openId ? this.indexOf(this._openId) : 0
        this.goTo((i - 1 + n) % n)
    }

    close() {
        if (!this._openId) return
        const active = document.activeElement as HTMLElement | null
        if (active && this._card.contains(active)) active.blur() // commits an edit in progress
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

    /** Editable only: the next click on a surface places a new annotation there, with the current camera view. Esc cancels. */
    startAdding() {
        if (!this._editable || !this._viewer || this._place) return false
        this.stopTour()
        this.close()
        const place = document.createElement('div')
        place.className = 'anp-place'
        // focused, so Esc cancels here and does not also reach SelectionUxPlugin
        place.tabIndex = -1
        place.setAttribute('data-own-keys', '')
        place.innerHTML = '<div class="anp-ghost">+</div><div class="anp-hint">Click a surface to place the annotation. The current view is saved with it. <b>Esc</b> cancels.</div>'
        const ghost = place.querySelector<HTMLElement>('.anp-ghost')!
        let down: {x: number, y: number} | null = null
        place.addEventListener('pointermove', e => {
            const hit = this._pick(e.clientX, e.clientY)
            const r = this._layer.getBoundingClientRect()
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
            const a = this.add(hit.object, hit.localPoint, hit.localNormal)
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
        this._layer.appendChild(place)
        place.focus({preventScroll: true})
        this._place = place
        this._layer.classList.add('anp-adding')
        return true
    }

    cancelAdding() {
        if (!this._place) return
        this._place.remove()
        this._place = null
        this._layer?.classList.remove('anp-adding')
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

    private _makeAnchor(object: IObject3D, localPoint: Vector3, localNormal: Vector3): AnnotationAnchor {
        const n = localNormal.clone()
        if (n.lengthSq() < 1e-12) n.set(0, 1, 0)
        return {
            uuid: object.uuid,
            path: this._pathOf(object),
            name: object.name || object.type,
            point: localPoint.toArray(),
            normal: n.normalize().toArray(),
        }
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
        let p = o as any
        while (p) {
            if (p === scene) return true
            p = p.parent
        }
        return false
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

    private _solid(o: any) {
        if (!o?.isMesh) return false
        const m = Array.isArray(o.material) ? o.material[0] : o.material
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
        const h = ray.intersectObject(v.scene.modelRoot, true).find(x => this._solid(x.object))
        if (!h || h.object.userData.userSelectable === false) return null // nothing, or the ground
        const object = h.object as IObject3D
        object.updateWorldMatrix(true, false)
        const localPoint = object.worldToLocal(h.point.clone())
        let localNormal: Vector3
        if (h.face) {
            localNormal = h.face.normal.clone()
        } else {
            const toCam = ray.ray.direction.clone().negate()
            localNormal = toCam.transformDirection(object.matrixWorld.clone().invert())
        }
        return {object, point: h.point.clone(), localPoint, localNormal}
    }

    // endregion

    // region markers

    private _syncMarkers() {
        if (!this._layer) return
        const ids = new Set(this.annotations.map(a => a.id))
        for (const [id, st] of this._markers) {
            if (ids.has(id)) continue
            st.el.remove()
            this._markers.delete(id)
        }
        this.annotations.forEach((a, i) => {
            let st = this._markers.get(a.id)
            if (!st) {
                const el = document.createElement('div')
                el.className = 'anp-marker'
                el.dataset.id = a.id
                el.addEventListener('pointerdown', this._onMarkerDown)
                el.addEventListener('pointermove', this._onMarkerMove)
                el.addEventListener('pointerup', this._onMarkerUp)
                el.addEventListener('pointercancel', this._onMarkerUp)
                this._layer.insertBefore(el, this._card)
                st = {el, world: new Vector3(), ndc: new Vector2(), x: 0, y: 0, onScreen: false, occluded: false, facing: true}
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
        if (!v || !this._layer || this.isDisabled()) return
        const cam = v.scene.mainCamera
        cam.updateMatrixWorld()
        const cr = v.canvas.getBoundingClientRect()
        const lr = this._layer.getBoundingClientRect()
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
                st.world.fromArray(a.anchor.point).applyMatrix4(o.matrixWorld)
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
            n.fromArray(a.anchor.normal).applyMatrix3(this._nm.getNormalMatrix(o!.matrixWorld)).normalize()
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
        if (this._occlDirty && !this._occlQueue.length) {
            this._occlDirty = false
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
            st.occluded = ray.intersectObject(v.scene.modelRoot, true).some(hh => this._solid(hh.object))
            st.el.classList.toggle('anp-dim', st.occluded || !st.facing)
        }
    }

    private _onMarkerDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        const el = e.currentTarget as HTMLDivElement
        const a = this.get(el.dataset.id || '')
        if (!a) return
        this.stopTour()
        el.setPointerCapture(e.pointerId)
        this._drag = {id: a.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, before: {...a.anchor}}
    }

    private _onMarkerMove = (e: PointerEvent) => {
        const d = this._drag
        if (!d || d.pointerId !== e.pointerId) return
        if (!d.moved) {
            if (!this._editable || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
            d.moved = true
            this._layer.classList.add('anp-dragging')
        }
        const hit = this._pick(e.clientX, e.clientY)
        const a = this.get(d.id)
        if (!hit || !a) return
        a.anchor = this._makeAnchor(hit.object, hit.localPoint, hit.localNormal)
        this._objCache.delete(a.id)
        this._occlDirty = true
    }

    private _onMarkerUp = (e: PointerEvent) => {
        const d = this._drag
        if (!d || d.pointerId !== e.pointerId) return
        this._drag = null
        this._layer.classList.remove('anp-dragging')
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

    private _buildCard() {
        const card = document.createElement('div')
        card.className = 'anp-card'
        card.tabIndex = -1
        card.setAttribute('data-own-keys', '') // SelectionUxPlugin leaves all keys (arrows, Esc) to a focused element with this
        card.innerHTML = `
<div class="anp-head"><span class="anp-num"></span><div class="anp-title"></div><input class="anp-title-in" placeholder="Title" spellcheck="true"><button class="anp-x" title="Close (Esc)">×</button></div>
<div class="anp-text"></div>
<textarea class="anp-text-in" rows="2" placeholder="Description. **bold**, *italic*, [link](https://…)" spellcheck="true"></textarea>
<div class="anp-tools"><button data-act="view" title="Save the current camera view in this annotation">Update view</button><button data-act="del" title="Delete this annotation">Delete</button></div>
<div class="anp-nav"><button data-act="prev" title="Previous (←)">‹</button><span class="anp-pos"></span><button data-act="next" title="Next (→)">›</button></div>`
        const q = <T extends HTMLElement>(s: string) => card.querySelector<T>(s)!
        this._cardEls = {
            num: q('.anp-num'), title: q('.anp-title'), titleIn: q<HTMLInputElement>('.anp-title-in'),
            text: q('.anp-text'), textIn: q<HTMLTextAreaElement>('.anp-text-in'),
            pos: q('.anp-pos'), prev: q<HTMLButtonElement>('[data-act=prev]'), next: q<HTMLButtonElement>('[data-act=next]'),
        }
        card.addEventListener('pointerdown', e => {
            e.stopPropagation()
            this.stopTour()
        })
        card.addEventListener('wheel', e => e.stopPropagation())
        q('.anp-x').addEventListener('click', () => this.close())
        this._cardEls.prev.addEventListener('click', () => this.prev())
        this._cardEls.next.addEventListener('click', () => this.next())
        q('[data-act=view]').addEventListener('click', () => this.updateView())
        q('[data-act=del]').addEventListener('click', () => this._openId && this.remove(this._openId))
        this._bindField(this._cardEls.titleIn, 'title')
        this._bindField(this._cardEls.textIn, 'text')
        this._cardEls.text.addEventListener('click', e => {
            if (!this._editable || (e.target as HTMLElement).closest('a')) return
            this._card.classList.add('anp-text-editing')
            this._cardEls.textIn.focus()
            this._autosize()
        })
        this._cardEls.textIn.addEventListener('blur', () => this._card.classList.remove('anp-text-editing'))
        this._layer.appendChild(card)
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
            this._record(() => this._patch(a.id, {[key]: b}), () => this._patch(a.id, {[key]: after}))
        })
        input.addEventListener('keydown', (ev: Event) => {
            const e = ev as KeyboardEvent
            e.stopPropagation() // keep typing (Ctrl+Z, Delete, arrows) away from the scene hotkeys
            if (e.key === 'Escape') {
                input.blur()
                this._card.focus({preventScroll: true})
            } else if (e.key === 'Enter' && key === 'title') {
                e.preventDefault()
                this._card.classList.add('anp-text-editing')
                this._cardEls.textIn.focus()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                input.blur()
                this._card.focus({preventScroll: true})
            }
        })
    }

    private _autosize() {
        const t = this._cardEls.textIn
        t.style.height = 'auto'
        t.style.height = Math.min(240, t.scrollHeight + 2) + 'px'
    }

    private _renderCard() {
        if (!this._card) return
        const a = this._openId ? this.get(this._openId) : undefined
        this._card.classList.toggle('anp-open', !!a)
        if (!a) return
        const els = this._cardEls
        const i = this.indexOf(a.id)
        const n = this.annotations.length
        this._card.classList.toggle('anp-edit', this._editable)
        this._card.classList.toggle('anp-text-empty', !a.text.trim())
        els.num.textContent = String(i + 1)
        els.title.textContent = a.title || `Annotation ${i + 1}`
        els.text.innerHTML = renderText(a.text)
        els.text.style.display = a.text.trim() ? '' : 'none'
        if (document.activeElement !== els.titleIn && els.titleIn.value !== a.title) els.titleIn.value = a.title
        if (document.activeElement !== els.textIn && els.textIn.value !== a.text) els.textIn.value = a.text
        if (this._editable) requestAnimationFrame(() => this._autosize())
        els.pos.textContent = `${i + 1} / ${n}`
        els.prev.disabled = els.next.disabled = n < 2
        this._card.querySelector<HTMLButtonElement>('[data-act=view]')!.classList.toggle('anp-noview', !a.view)
        this._cardSize.w = 0 // measure again
    }

    /** Next to the marker, flipped to the left when there is no room on the right */
    private _positionCard(force = false) {
        const id = this._openId
        if (!id) return
        const st = this._markers.get(id)
        if (!st || !st.onScreen && !force) return
        if (!this._cardSize.w || force) this._cardSize = {w: this._card.offsetWidth, h: this._card.offsetHeight}
        const {w, h} = this._cardSize
        const W = this._layer.clientWidth, H = this._layer.clientHeight
        let x = st.x + 22
        if (x + w > W - 8) x = st.x - 22 - w
        x = Math.max(8, Math.min(W - w - 8, x))
        const y = Math.max(8, Math.min(H - h - 8, st.y - 18))
        this._card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
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
        const pop = v.getPlugin(PopmotionPlugin)
        if (!pop || travel < 1e-5) {
            anim.onComplete?.()
            setFov(1)
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
                anim.onComplete?.()
                setFov(1)
                done()
            },
            onStop: done,
        })
    }

    // endregion

    // region keys and clicks

    private _onKeyDown = (e: KeyboardEvent) => {
        if (this.isDisabled()) return
        const t = e.target as HTMLElement
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
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
        if (e.target === this._viewer?.canvas) this.stopTour()
        this._down = {x: e.clientX, y: e.clientY, canvas: e.target === this._viewer?.canvas}
    }

    private _onWindowUp = (e: PointerEvent) => {
        const d = this._down
        this._down = null
        if (!d || !d.canvas || !this._openId || this._drag || this._place) return
        if (e.target === this._viewer?.canvas && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.close()
    }

    // endregion
}

function esc(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function inline(s: string) {
    return esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>')
}

/** Plain text → HTML: line breaks, "- " bullets, **bold**, *italic*, [label](https://…) and bare https:// links */
export function renderText(text: string) {
    const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g
    const link = (href: string, label: string) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    return text.split('\n').map(line => {
        let out = ''
        let last = 0
        const bullet = /^\s*[-•]\s+/.exec(line)
        if (bullet) line = line.slice(bullet[0].length)
        for (const m of line.matchAll(re)) {
            out += inline(line.slice(last, m.index))
            out += m[1] ? link(m[2], inline(m[1])) : link(m[3], esc(m[3]))
            last = m.index! + m[0].length
        }
        out += inline(line.slice(last))
        return bullet ? `<span class="anp-li">${out}</span>` : out
    }).join('<br>')
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.anp-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 6;
  --anp-bg: #ffffff; --anp-fg: #1e1e1e; --anp-dim: #757575; --anp-line: #e6e6e6; --anp-hover: #f5f5f5; --anp-accent: #0d99ff;
  --anp-mk-bg: rgba(255,255,255,.95); --anp-mk-fg: #1e1e1e; --anp-mk-ring: rgba(0,0,0,.18);
  font: 12px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--anp-fg); }
body.tpTheme-dark .anp-layer, body.tpTheme-black .anp-layer, body.tpTheme-blue .anp-layer {
  --anp-bg: #2c2c2c; --anp-fg: #f0f0f0; --anp-dim: #a0a0a0; --anp-line: #444; --anp-hover: #383838;
  --anp-mk-bg: rgba(30,30,30,.92); --anp-mk-fg: #fff; --anp-mk-ring: rgba(255,255,255,.35); }
body.tpTheme-black .anp-layer { --anp-bg: #141414; --anp-line: #333; --anp-hover: #222; }
body.tpTheme-blue .anp-layer { --anp-bg: #1f2a3a; --anp-line: #34465e; --anp-hover: #2a3a50; }

.anp-marker { position: absolute; left: 0; top: 0; width: 24px; height: 24px; margin: -12px 0 0 -12px; box-sizing: border-box;
  border-radius: 50%; background: var(--anp-mk-bg); color: var(--anp-mk-fg); box-shadow: 0 0 0 1.5px var(--anp-mk-ring), 0 1px 4px rgba(0,0,0,.3);
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 11px; cursor: pointer;
  pointer-events: auto; user-select: none; touch-action: none; transition: opacity .2s, box-shadow .12s, background .12s; }
.anp-marker:hover { box-shadow: 0 0 0 2px var(--anp-accent), 0 1px 5px rgba(0,0,0,.35); }
.anp-marker.anp-on { background: var(--anp-accent); color: #fff; box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px var(--anp-accent), 0 1px 6px rgba(0,0,0,.35); z-index: 1; }
.anp-marker.anp-dim { opacity: .38; }
.anp-marker.anp-dim:hover, .anp-marker.anp-on.anp-dim { opacity: .75; }
.anp-editable .anp-marker { cursor: grab; }
.anp-dragging, .anp-dragging .anp-marker { cursor: grabbing !important; }
.anp-dragging .anp-marker { transition: none; }
.anp-adding .anp-marker { pointer-events: none; }

.anp-card { position: absolute; left: 0; top: 0; width: 260px; max-width: calc(100% - 16px); box-sizing: border-box; display: none;
  background: var(--anp-bg); color: var(--anp-fg); border: 1px solid var(--anp-line); border-radius: 6px;
  box-shadow: 0 4px 18px rgba(0,0,0,.18); pointer-events: auto; outline: none; user-select: text; z-index: 2; }
.anp-card.anp-open { display: block; }
.anp-head { display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px 10px; }
.anp-num { flex: none; width: 20px; height: 20px; border-radius: 50%; background: var(--anp-accent); color: #fff; font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; }
.anp-title, .anp-title-in { flex: 1; min-width: 0; font: inherit; font-weight: 600; font-size: 13px; color: inherit; }
.anp-title { overflow-wrap: anywhere; }
.anp-title-in, .anp-text-in { display: none; border: 1px solid transparent; background: transparent; border-radius: 4px; outline: none; padding: 2px 4px; margin: -3px 0; }
.anp-title-in:hover, .anp-text-in:hover { border-color: var(--anp-line); }
.anp-title-in:focus, .anp-text-in:focus { border-color: var(--anp-accent); background: var(--anp-bg); }
.anp-x { flex: none; border: 0; background: transparent; color: var(--anp-dim); font-size: 16px; line-height: 1; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
.anp-x:hover { background: var(--anp-hover); color: var(--anp-fg); }
.anp-text { padding: 2px 12px 8px 38px; color: var(--anp-fg); overflow-wrap: anywhere; max-height: 240px; overflow: auto; }
.anp-text a { color: var(--anp-accent); }
.anp-li { display: inline-block; padding-left: 12px; text-indent: -12px; }
.anp-li::before { content: "• "; }
.anp-text-in { box-sizing: border-box; width: calc(100% - 44px); margin: 0 6px 6px 34px; font: inherit; color: inherit; resize: none; min-height: 40px; }
.anp-tools { display: none; gap: 6px; padding: 0 10px 8px 38px; }
.anp-edit .anp-title { display: none; }
.anp-edit .anp-title-in { display: block; }
/* the text reads formatted; a click turns it into the raw editor (empty text: the editor with its placeholder) */
.anp-edit .anp-text { cursor: text; }
.anp-edit.anp-text-editing .anp-text-in, .anp-edit.anp-text-empty .anp-text-in { display: block; }
.anp-edit.anp-text-editing .anp-text { display: none !important; }
.anp-edit .anp-tools { display: flex; }
.anp-card button[data-act] { font: inherit; font-size: 11px; color: var(--anp-fg); background: transparent; border: 1px solid var(--anp-line);
  border-radius: 4px; padding: 3px 8px; cursor: pointer; }
.anp-card button[data-act]:hover:not(:disabled) { background: var(--anp-hover); }
.anp-card button[data-act=del]:hover { color: #e5484d; border-color: #e5484d; }
.anp-card button.anp-noview { border-color: var(--anp-accent); color: var(--anp-accent); }
.anp-nav { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--anp-line); padding: 4px 6px; color: var(--anp-dim); font-size: 11px; }
.anp-nav button[data-act] { border: 0; font-size: 15px; line-height: 1; padding: 2px 10px; }
.anp-nav button:disabled { opacity: .35; cursor: default; }

.anp-place { position: absolute; inset: 0; pointer-events: auto; cursor: crosshair; z-index: 3; }
.anp-ghost { position: absolute; left: 0; top: 0; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; box-sizing: border-box;
  border: 1.5px dashed var(--anp-accent); background: rgba(13,153,255,.15); color: var(--anp-accent); display: none;
  align-items: center; justify-content: center; font-weight: 600; pointer-events: none; }
.anp-hint { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); max-width: calc(100% - 32px); box-sizing: border-box;
  background: var(--anp-bg); color: var(--anp-fg); border: 1px solid var(--anp-line); border-radius: 6px; padding: 6px 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.15); font-size: 11px; pointer-events: none; text-align: center; }
.anp-miss .anp-hint { animation: anp-shake .3s; border-color: #e5484d; }
@keyframes anp-shake { 25% { margin-left: -4px } 75% { margin-left: 4px } }
`
    document.head.appendChild(st)
}
