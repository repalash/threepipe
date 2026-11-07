import {
    animateCameraToViewSpherical,
    AnimationResult,
    AViewerPluginEventMap,
    AViewerPluginSync,
    bindActions,
    type CommandAction,
    createStyles,
    EasingFunctions,
    ICamera,
    ICameraView,
    Intersection,
    isTextTarget,
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
    /**
     * Values of the app (a price, a product id…) for {@link AnnotationsPlugin.renderCardContent}. Plain JSON: saved with
     * the annotation (viewer config, .glb) and loaded as is. The default card never shows it. Change it with
     * {@link AnnotationsPlugin.update} (a new object, undoable), not in place.
     */
    data?: Record<string, any>
}

/**
 * Renders the content of the card for an annotation: the title and the text area ({@link AnnotationsPlugin.renderCardContent}).
 * A string is set as the HTML of the content as is: escape the values that come from a file or a user
 * (`escapeHtml`, `renderAnnotationText`). An element is put in the content. `undefined` or `null`: the default content.
 */
export type AnnotationCardRenderer = (annotation: Annotation, context: {
    /** The place of the annotation in the tour */
    index: number
    /** The number of annotations */
    count: number
    plugin: AnnotationsPlugin
}) => string | HTMLElement | null | undefined

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
    /** Editable: only the open annotation can be dragged ({@link AnnotationsPlugin.dragOnlySelected}). Default true */
    dragOnlySelected?: boolean
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

/** A press on a marker: it becomes a drag (editable) when the pointer moves 4px */
interface MarkerDrag {
    id: string
    pointerId: number
    x: number
    y: number
    moved: boolean
    before: AnnotationAnchor
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
 *   view", "Delete", and drag a marker to another surface point ({@link dragOnlySelected}: the open one only). All
 *   edits are undoable with {@link UndoManagerPlugin}, and so is the selection: opening an annotation or closing the
 *   card is one undo step, as the selection of the PickingPlugin.
 * - The card stays open until it is closed (its close button, Esc) or a click (no drag) on the canvas. With
 *   {@link closeOnCanvasInteraction}, any interaction with the canvas closes it: also a drag (orbit) or a wheel zoom.
 * - Tour: {@link goTo}, {@link next}, {@link prev}, {@link playTour}; events `annotationChange` and `annotationSelect`
 *   for an outside list.
 * - {@link renderCardContent}: the app renders the content of the card (not in editable mode), for example from the
 *   values in {@link Annotation.data}.
 * - {@link compactCard}: the card shows the title and the text only, and a tour bar at the bottom centre has ‹ the title
 *   of the open annotation ›. The bar fades while the user moves the camera ({@link tourBar}). {@link showCloseButton}
 *   hides the ✕ of the card.
 *
 * The markers and the card are in a layer over the canvas, in the viewer container (which must be positioned, for
 * example `position: relative`). The UI folder (Annotations) has Editable, Drag only selected, Close on canvas
 * interaction, Close button, Compact card, Add, Play tour and Remove all.
 *
 * @category Plugins
 */
export class AnnotationsPlugin extends AViewerPluginSync<AnnotationsPluginEventMap> {
    static readonly PluginType = 'AnnotationsPlugin'
    /** Adds the stylesheet of the `anp-` classes to the page when the first plugin is added. Off: the page styles them. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    /** The plugins on the page: with the focus on the page (not in a viewer), the one used last takes the keys */
    private static _added = new Set<AnnotationsPlugin>()
    private static _uses = 0
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
    /**
     * Any interaction with the canvas closes the open card: a click, a drag (orbit, pan with a finger, a pinch: as soon as
     * the pointer moves 4px) and a wheel zoom. Primary button and touch only; not while placing or dragging a marker.
     * Default false: only a click (no drag) on the canvas closes it, and the card stays while the camera orbits.
     * Not saved with the scene, like {@link editable}.
     */
    closeOnCanvasInteraction = false

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Annotations',
        children: [
            {type: 'checkbox', label: 'Editable', property: [this, 'editable']},
            {type: 'checkbox', label: 'Drag only selected', property: [this, 'dragOnlySelected'], hidden: () => !this.editable},
            {type: 'checkbox', label: 'Close on canvas interaction', property: [this, 'closeOnCanvasInteraction']},
            {type: 'checkbox', label: 'Close button', property: [this, 'showCloseButton']},
            {type: 'checkbox', label: 'Compact card', property: [this, 'compactCard']},
            {type: 'button', label: 'Add annotation', value: () => this.startAdding(), hidden: () => !this.editable},
            {type: 'button', label: 'Play tour', value: () => this.playTour()},
            {type: 'button', label: 'Remove all', value: () => this.clear(), hidden: () => !this.editable},
        ],
    }

    private _editable: boolean
    private _dragOnlySelected: boolean
    private _showCloseButton = true
    private _renderCardContent?: AnnotationCardRenderer
    private _compactCard = false
    private _layer?: HTMLDivElement
    private _card?: HTMLDivElement
    private _cardEls!: {
        head: HTMLElement, title: HTMLElement, titleIn: HTMLTextAreaElement, headBtns: HTMLElement, close: HTMLButtonElement,
        custom: HTMLElement, text: HTMLElement,
        textIn: HTMLTextAreaElement, nav: HTMLElement, pos: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement,
        tools: HTMLElement, view: HTMLButtonElement,
    }
    /** The tour bar of {@link compactCard}; its `data-state` is {@link tourBar} */
    private _bar?: {el: HTMLDivElement, title: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement}
    /** The user moves the camera (a drag or a wheel on the canvas), until `BAR_DELAY` ms after the end */
    private _camMoving = false
    /** The timer that ends `_camMoving` */
    private _camTimer = 0
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
    /** The last pointer down: where, on the canvas or not, with the primary button (or a touch) or not */
    private _down: {x: number, y: number, canvas: boolean, primary: boolean} | null = null
    private _drag: MarkerDrag | null = null
    private _tour = 0
    /** When this viewer was used last (a pointer down in it, a card opened, placing started), for the keys */
    private _usedAt = 0
    /** The size of the card, measured again when it changes (see `_resizer`), not on every frame */
    private _cardSize = {w: 0, h: 0}
    /** Watches the open card: a text that grows or wraps in a narrower viewer changes its size, then it is placed again */
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
        this._cardSize.w = 0
        if (this._editable) this._autosize() // a narrower card wraps the title and the text field on more lines
        this._positionCard()
    })

    constructor(options: AnnotationsPluginOptions = {}) {
        super()
        this._editable = !!options.editable
        this._dragOnlySelected = options.dragOnlySelected ?? true
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

    /**
     * Editable: only the open (selected) annotation can be dragged to another surface point. A press on another marker
     * opens it with a click, and a drag from it moves the camera, as a drag on the canvas does. Off: a drag on any
     * marker moves it. Default true: in an editor a drag that starts on a marker is often meant to orbit, and the markers
     * are small; with it on, a marker moves only after it was opened, and that move is one undo step. Not saved with
     * the scene, like {@link editable}.
     */
    get dragOnlySelected() {
        return this._dragOnlySelected
    }

    set dragOnlySelected(v: boolean) {
        if (this._dragOnlySelected === v) return
        this._dragOnlySelected = v
        this._layer?.classList.toggle('anp-drag-selected', v)
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    /** Show the ✕ in the card. Off: the card closes with Esc, a click on the canvas or from code ({@link close}). Default true. */
    get showCloseButton() {
        return this._showCloseButton
    }

    set showCloseButton(v: boolean) {
        if (this._showCloseButton === v) return
        this._showCloseButton = v
        this._renderCard()
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    /**
     * A hook for the app: renders the content of the card (in place of the title and the text) when `editable` is off.
     * The ✕, the ‹ › of the card and the tour bar of {@link compactCard} stay; in editable mode the default editor card
     * shows. It runs when an annotation opens, when the annotations change, and when it is set: set it again to render
     * the open card again (for app state it reads). Returning `undefined` gives the default content, and so does an
     * error (logged). A string is set as HTML as is, so escape what comes from a file or a user (`escapeHtml`,
     * `renderAnnotationText`). Clicks and keys in the content do not reach the viewer, as in the default card.
     * @example
     * ```ts
     * annotations.renderCardContent = (a, {index}) => a.data?.price === undefined ? undefined :
     *     `<h3>${escapeHtml(a.title)}</h3><p>${renderAnnotationText(a.text)}</p><b>$${escapeHtml(String(a.data.price))}</b>`
     * ```
     */
    get renderCardContent(): AnnotationCardRenderer | undefined {
        return this._renderCardContent
    }

    set renderCardContent(v: AnnotationCardRenderer | undefined) {
        this._renderCardContent = v
        this._renderCard()
    }

    /**
     * A compact card, for a viewer with a tour: the card shows the title and the text only (editable: Update view and
     * Delete at its top, before the ✕), and the tour bar at the bottom centre has ‹ the title of the open annotation ›.
     * The bar fades while the user moves the camera, see {@link tourBar}. Default false: the card has ‹ 1 / 3 › and
     * the tools in its bottom row. Not saved with the scene, like {@link editable}.
     */
    get compactCard() {
        return this._compactCard
    }

    set compactCard(v: boolean) {
        if (this._compactCard === v) return
        this._compactCard = v
        this._renderCard()
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    /**
     * The state of the tour bar of {@link compactCard}:
     * - `'hidden'`: the option is off, no annotation is open, a new one is being placed, or the plugin is disabled
     * - `'shown'`: an annotation is open (also during {@link playTour})
     * - `'faded'`: shown, but the user moves the camera (a drag past 4px or a wheel on the canvas); it shows again
     *   400 ms after the pointer up or the last wheel event
     */
    get tourBar(): 'hidden' | 'shown' | 'faded' {
        if (!this._compactCard || !this._bar || !this._openId || this._place || this.isDisabled()) return 'hidden'
        return this._camMoving ? 'faded' : 'shown'
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
        layer.classList.toggle('anp-drag-selected', this._dragOnlySelected)
        viewer.container.appendChild(layer)
        this._layer = layer
        this._buildBar(layer)
        this._buildCard(layer)
        AnnotationsPlugin._added.add(this)
        window.addEventListener('keydown', this._onKeyDown, {capture: true})
        this._unbindActions = bindActions(viewer, this.actions)
        window.addEventListener('pointerdown', this._onWindowDown, {capture: true})
        window.addEventListener('pointerup', this._onWindowUp, {capture: true})
        window.addEventListener('pointermove', this._onWindowMove, {capture: true})
        window.addEventListener('wheel', this._onWindowWheel, {capture: true})
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.addEventListener('addSceneObject', this._onHierarchy)
        this._syncMarkers()
        this._raf = requestAnimationFrame(this._tick)
    }

    onRemove(viewer: ThreeViewer) {
        cancelAnimationFrame(this._raf)
        AnnotationsPlugin._added.delete(this)
        this.stopTour()
        this._stopAnim()
        this.cancelAdding()
        window.removeEventListener('keydown', this._onKeyDown, {capture: true})
        this._unbindActions?.()
        this._unbindActions = undefined
        window.removeEventListener('pointerdown', this._onWindowDown, {capture: true})
        window.removeEventListener('pointerup', this._onWindowUp, {capture: true})
        window.removeEventListener('pointermove', this._onWindowMove, {capture: true})
        window.removeEventListener('wheel', this._onWindowWheel, {capture: true})
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.removeEventListener('addSceneObject', this._onHierarchy)
        this._resizer?.disconnect()
        window.clearTimeout(this._camTimer)
        this._camTimer = 0
        this._camMoving = false
        this._layer?.remove()
        this._layer = undefined
        this._card = undefined
        this._bar = undefined
        this._markers.clear()
        this._objCache.clear()
        this._openId = null
        this._drag = null
        super.onRemove(viewer)
    }

    toJSON(meta?: SerializationMetaType): ISerializedConfig {
        const json = super.toJSON(meta)
        // `data` is the app's plain JSON: copied as is (the serializer reads some keys, like `uuid` + `resource`, as its own)
        const list = json.annotations as any[] | undefined
        this.annotations.forEach((a, i) => {
            const item = list?.[i]
            if (!item) return
            if (isPlainObject(a.data)) item.data = jsonCopy(a.data)
            else delete item.data
        })
        return json
    }

    fromJSON(data: ISerializedConfig, meta?: SerializationMetaType): this | null {
        if (data.type !== AnnotationsPlugin.PluginType) return null
        // the deserializer fills an existing array in place and keeps extra items, so start from an empty one
        this.annotations = []
        if (!super.fromJSON(data, meta)) return null
        // `data` from the file as is, see toJSON
        const appData = new Map<string, unknown>((Array.isArray(data.annotations) ? data.annotations : []).map((r: any) => [String(r?.id), r?.data]))
        this.annotations = (this.annotations || []).filter(a => a && a.id && a.anchor && Array.isArray(a.anchor.point)).map(a => {
            const item: Annotation = {
                id: String(a.id),
                title: a.title || '',
                text: a.text || '',
                anchor: {...a.anchor, normal: Array.isArray(a.anchor.normal) ? a.anchor.normal : [0, 1, 0]},
                view: a.view && Array.isArray(a.view.position) ? a.view : null,
            }
            const d = appData.get(item.id)
            if (isPlainObject(d)) item.data = jsonCopy(d)
            return item
        })
        this.stopTour()
        // ThreeViewer.fromJSON loads the plugins before the scene: a flight would move the camera of the loaded config
        this._stopAnim()
        this._select(null)
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
        this._updateBar()
        if (!show) {
            this.cancelAdding() // the overlay is hidden with the layer
            return
        }
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
     * `content.data`: values of the app ({@link Annotation.data}). Undoable. Returns the new annotation.
     */
    add(object: IObject3D, localPoint: Vector3, localNormal: Vector3, view?: AnnotationView | null, content: {title?: string, text?: string, instanceId?: number, data?: Record<string, any>} = {}): Annotation {
        const a: Annotation = {
            id: MathUtils.generateUUID(),
            title: content.title ?? '',
            text: content.text ?? '',
            anchor: this._makeAnchor(object, localPoint, localNormal, content.instanceId),
            view: view === undefined ? this.captureView() : view,
        }
        if (content.data) a.data = content.data
        const index = this.annotations.length
        this._insert(a, index)
        this._record(() => this._delete(a.id), () => this._insert(a, index))
        return a
    }

    /** Remove an annotation. Undoable: the undo also opens it again when it was open. */
    remove(id: string) {
        const index = this.indexOf(id)
        if (index < 0) return
        const a = this.annotations[index]
        const open = this._openId === id
        this._delete(id)
        this._record(() => {
            this._insert(a, index)
            if (open) this._select(id, {fly: false})
        }, () => this._delete(id))
    }

    /** Remove all annotations. Undoable: the undo also opens the one that was open. */
    clear() {
        const before = [...this.annotations]
        if (!before.length) return
        const open = this._openId
        const set = (list: Annotation[]) => {
            this._select(null)
            this.annotations = [...list]
            this._changed('clear')
        }
        set([])
        this._record(() => {
            set(before)
            if (open) this._select(open, {fly: false})
        }, () => set([]))
    }

    /** Change the title, text, view or data of an annotation. Undoable. */
    update(id: string, patch: Partial<Pick<Annotation, 'title' | 'text' | 'view' | 'data'>>) {
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
     * Open an annotation: the camera goes to its saved view and the card opens. In {@link editable} mode, opening
     * another annotation is one undo step (the undo opens the one before, or closes the card), as a selection.
     * @param indexOrId - place in the tour or id
     * @param options - `fly: false` keeps the camera; `focusTitle` puts the cursor in the title (editable only)
     */
    goTo(indexOrId: number | string, options: {fly?: boolean, focusTitle?: boolean} = {}) {
        const a = this.get(indexOrId)
        if (a) this._select(a.id, options, true)
    }

    /** Open the next annotation (after the last: the first) */
    /**
     * The keys of the plugin, as actions (`bindActions`: a `CommandsPlugin` of the viewer lists them): → and ← open the
     * next and the previous annotation while a card is open, before the arrow keys of the camera controls on the canvas
     * (`capture`). With more viewers on the page, the viewer with the focus, or the one used last, takes the key. Escape
     * (close the card) stays a key of the card.
     */
    readonly actions: CommandAction[] = [
        {id: 'annotations.next', label: 'Next annotation', group: 'Annotations', shortcut: 'ArrowRight', capture: true, enabled: () => !this.isDisabled() && !!this._openId, run: () => this.next()},
        {id: 'annotations.prev', label: 'Previous annotation', group: 'Annotations', shortcut: 'ArrowLeft', capture: true, enabled: () => !this.isDisabled() && !!this._openId, run: () => this.prev()},
    ]
    private _unbindActions?: () => void

    next() {
        this._step(1, true)
    }

    /** Open the previous annotation (before the first: the last) */
    prev() {
        this._step(-1, true)
    }

    /** Close the card. In {@link editable} mode, one undo step (the undo opens it again), as a selection. */
    close() {
        this._select(null, {}, true)
    }

    /**
     * Go through the annotations one after another, like Sketchfab's autopilot. Any click or key stops it. The tour adds
     * no undo steps.
     */
    playTour(intervalMs = 5000) {
        this.stopTour()
        if (!this.annotations.length) return
        this._step(1, false)
        this._tour = window.setInterval(() => this._step(1, false), Math.max(1000, intervalMs))
    }

    stopTour() {
        if (this._tour) window.clearInterval(this._tour)
        this._tour = 0
    }

    /**
     * Editable only: the next click on a surface places a new annotation there, with the current camera view. Esc or a
     * right click cancels. Returns false when it did not start (not editable, not added, disabled, or already placing).
     */
    startAdding() {
        const layer = this._layer
        if (!this._editable || !this._viewer || !layer || this._place || this.isDisabled()) return false
        this.stopTour()
        this.close()
        this._used()
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
        this._updateBar()
        layer.classList.add('anp-adding')
        this.dispatchEvent({type: 'addingChange', adding: true})
        return true
    }

    /** Stop placing a new annotation ({@link startAdding}) */
    cancelAdding() {
        if (!this._place) return
        this._place.remove()
        this._place = null
        this._updateBar()
        this._layer?.classList.remove('anp-adding')
        this.dispatchEvent({type: 'addingChange', adding: false})
    }

    /**
     * The object an annotation is on, or null when it is not in the scene. Found by uuid, or by the path of names on the
     * first look up (after a load, where the uuids can be new). Once found, the annotation stays on that object: when
     * it leaves the scene, the marker hides (an object with the same path, like an unnamed sibling, does not take it),
     * and it shows again when the object, or one with its uuid, is back.
     */
    getObject(a: Annotation): IObject3D | null {
        const c = this._objCache.get(a.id)
        if (c?.obj && this._inScene(c.obj)) return c.obj
        if (c && c.gen === this._cacheGen) return null // looked up since the last hierarchy change
        const root = this._viewer?.scene.modelRoot
        const byUuid = root?.getObjectByProperty('uuid', a.anchor.uuid) as IObject3D | undefined
        const obj = byUuid || (c?.obj ? null : this._byPath(a.anchor.path))
        this._objCache.set(a.id, {obj: obj || c?.obj || null, gen: this._cacheGen})
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
        if (this._openId === id) this._select(null)
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

    // region selection

    /**
     * Opens an annotation (`id`; one that is not there: closes) or closes the card (`null`). With `record`, in
     * {@link editable} mode, a change of the open annotation is one undo step whose undo opens the one before, or none,
     * as the selection of the PickingPlugin. The undo and the redo keep the camera where it is.
     */
    private _select(id: string | null, options: {fly?: boolean, focusTitle?: boolean} = {}, record = false) {
        const prev = this._openId
        const a = id === null ? undefined : this.get(id)
        if (!a) {
            if (!prev) return
            this._commitEdit()
            if (this._card) this._resizer?.unobserve(this._card)
            this._openId = null
            this._renderCard()
            this._syncMarkers()
            this.dispatchEvent({type: 'annotationSelect', annotation: null, index: -1})
        } else {
            if (a.id !== prev) this._commitEdit() // the field edits the annotation it was focused for
            this._used()
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
        const next = this._openId
        if (!record || !this._editable || next === prev) return
        this._record(() => this._select(prev, {fly: false}), () => this._select(next, {fly: false}))
    }

    /** Opens the next (1) or the previous (-1) annotation, wrapping around; `record`: see {@link _select} */
    private _step(dir: 1 | -1, record: boolean) {
        const n = this.annotations.length
        if (!n) return
        const i = this._openId ? this.indexOf(this._openId) : dir > 0 ? -1 : 0
        this._select(this.annotations[(i + dir + n) % n].id, {}, record)
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
            // encoded, so a name with '/' or '#' stays one part of the path
            parts.unshift(`${encodeURIComponent(name)}#${same.indexOf(o)}`)
            o = o.parent as IObject3D
        }
        return parts.join('/')
    }

    private _byPath(path: string): IObject3D | null {
        let o: IObject3D | undefined = this._viewer?.scene.modelRoot
        if (!path || !o) return null
        for (const part of path.split('/')) {
            const k = part.lastIndexOf('#')
            const name = decodeURIComponent(part.slice(0, k))
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
            if (this._dragOnlySelected && d.id !== this._openId) {
                this._dragToCanvas(d, e)
                return
            }
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

    /**
     * {@link dragOnlySelected}: a drag on a marker that is not open moves the camera. The canvas gets a pointer down
     * where the press started, so its controls (they capture the pointer) and the window listeners take the drag from
     * there, as a drag that started on the canvas.
     */
    private _dragToCanvas(d: MarkerDrag, e: PointerEvent) {
        this._drag = null
        this._viewer?.canvas.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, composed: true,
            pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, button: 0, buttons: e.buttons,
            clientX: d.x, clientY: d.y, screenX: e.screenX - e.clientX + d.x, screenY: e.screenY - e.clientY + d.y,
            ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        }))
    }

    private _onMarkerUp = (e: PointerEvent) => {
        const d = this._drag
        if (!d || d.pointerId !== e.pointerId) return
        this._drag = null
        this._layer?.classList.remove('anp-dragging')
        const a = this.get(d.id)
        if (!a) return
        if (!d.moved) {
            if (e.type !== 'pointercancel') this.goTo(a.id) // a cancelled press is not a click
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

    /** The tour bar of {@link compactCard}: ‹ the title of the open annotation › at the bottom centre */
    private _buildBar(layer: HTMLDivElement) {
        const bar = el('div', 'anp-bar', layer)
        bar.dataset.state = 'hidden'
        const prev = button(bar, 'anp-bar-btn anp-bar-prev', ICONS.prev, 'Previous (←)', () => this.prev())
        const title = el('span', 'anp-bar-title', bar)
        const next = button(bar, 'anp-bar-btn anp-bar-next', ICONS.next, 'Next (→)', () => this.next())
        bar.addEventListener('pointerdown', e => {
            e.stopPropagation()
            this.stopTour()
        })
        bar.addEventListener('wheel', e => e.stopPropagation())
        this._bar = {el: bar, title, prev, next}
    }

    /** The bar shows {@link tourBar} in its `data-state` (the CSS shows, fades or hides it) and the open title */
    private _updateBar() {
        const bar = this._bar
        if (!bar) return
        const state = this.tourBar
        if (bar.el.dataset.state !== state) bar.el.dataset.state = state
        if (state === 'hidden') return
        const i = this._openId ? this.indexOf(this._openId) : -1
        const title = i < 0 ? '' : this.annotations[i].title || `Annotation ${i + 1}`
        if (bar.title.textContent !== title) bar.title.textContent = bar.title.title = title
        bar.prev.disabled = bar.next.disabled = this.annotations.length < 2
    }

    /**
     * The user starts (a drag past 4px, a wheel on the canvas) or ends (the pointer up, after each wheel event) moving
     * the camera: the tour bar fades, and shows again `BAR_DELAY` ms after the end
     */
    private _cameraMoving(start: boolean) {
        window.clearTimeout(this._camTimer)
        this._camTimer = 0
        if (start) {
            this._camMoving = true
        } else if (this._camMoving) {
            this._camTimer = window.setTimeout(() => {
                this._camTimer = 0
                this._camMoving = false
                this._updateBar()
            }, BAR_DELAY)
        }
        this._updateBar()
    }

    private _buildCard(layer: HTMLDivElement) {
        const card = el('div', 'anp-card', layer)
        card.tabIndex = -1
        const head = el('div', 'anp-head', card)
        const title = el('div', 'anp-title', head)
        // a textarea, not an input: the title wraps on the same lines as in the read-only card (one CSS box for both)
        const titleIn = el('textarea', 'anp-title-in', head)
        titleIn.rows = 1
        titleIn.placeholder = 'Title'
        titleIn.spellcheck = true
        // the buttons of the head, in one row: the ✕, and with compactCard the tools before it
        const headBtns = el('div', 'anp-head-btns', head)
        const close = button(headBtns, 'anp-btn anp-x', ICONS.close, 'Close (Esc)', () => this.close())
        // the content of renderCardContent, in place of the title and the text
        const custom = el('div', 'anp-custom', card)
        custom.style.display = 'none'
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
        this._cardEls = {head, title, titleIn, headBtns, close, custom, text, textIn, nav, pos, prev, next, tools, view}
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
    private _bindField(input: HTMLTextAreaElement, key: 'title' | 'text') {
        let before = ''
        let id = ''
        input.addEventListener('focus', () => {
            id = this._openId || ''
            before = this.get(id)?.[key] ?? ''
        })
        input.addEventListener('input', () => {
            const a = this.get(id)
            if (!a) return
            // the title is one paragraph: a pasted line break becomes a space (Enter goes to the text)
            if (key === 'title' && input.value.includes('\n')) input.value = input.value.replace(/\s*\n\s*/g, ' ')
            a[key] = input.value
            this._autosize()
            if (key === 'title') {
                this._syncMarkers()
                this._updateBar()
            }
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

    /** The fields are as tall as their text (with their 1px borders); the text field up to 240px, then it scrolls */
    private _autosize() {
        fitHeight(this._cardEls.titleIn, Infinity)
        fitHeight(this._cardEls.textIn, 240)
    }

    private _renderCard() {
        const card = this._card
        if (!card) return
        this._layoutCard(card)
        this._updateBar()
        const a = this._openId ? this.get(this._openId) : undefined
        card.classList.toggle('anp-open', !!a)
        if (!a) return
        const els = this._cardEls
        const i = this.indexOf(a.id)
        const n = this.annotations.length
        card.classList.toggle('anp-edit', this._editable)
        card.classList.toggle('anp-text-empty', !a.text.trim())
        const content = this._editable ? undefined : this._appContent(a, i, n)
        const custom = content !== undefined
        card.classList.toggle('anp-has-custom', custom)
        if (typeof content === 'string') els.custom.innerHTML = content
        else els.custom.replaceChildren(...content ? [content] : [])
        els.custom.style.display = custom ? '' : 'none'
        els.title.style.display = custom ? 'none' : ''
        els.title.textContent = a.title || `Annotation ${i + 1}`
        els.text.innerHTML = renderAnnotationText(a.text)
        els.text.style.display = a.text.trim() && !custom ? '' : 'none'
        if (document.activeElement !== els.titleIn && els.titleIn.value !== a.title) els.titleIn.value = a.title
        if (document.activeElement !== els.textIn && els.textIn.value !== a.text) els.textIn.value = a.text
        // now, not in the next frame: the title field shows with the height of its lines at once (no jump on a toggle)
        if (this._editable) this._autosize()
        els.pos.textContent = `${i + 1} / ${n}`
        els.prev.disabled = els.next.disabled = n < 2
        els.view.classList.toggle('anp-noview', !a.view)
        this._cardSize.w = 0 // measure again
    }

    /** The content of {@link renderCardContent} for an annotation, or undefined for the default content */
    private _appContent(a: Annotation, index: number, count: number): string | HTMLElement | undefined {
        const hook = this._renderCardContent
        if (!hook) return undefined
        try {
            return hook(a, {index, count, plugin: this}) ?? undefined
        } catch (e) {
            console.error('AnnotationsPlugin: renderCardContent failed, the default card is shown', e)
            return undefined
        }
    }

    /**
     * The ✕ ({@link showCloseButton}), and with {@link compactCard}: no bottom row, the tools in the head before the ✕,
     * in the same group (one gap between all the head buttons)
     */
    private _layoutCard(card: HTMLDivElement) {
        const els = this._cardEls
        const compact = this._compactCard
        card.classList.toggle('anp-compact', compact)
        card.classList.toggle('anp-no-close', !this._showCloseButton)
        els.close.style.display = this._showCloseButton ? '' : 'none'
        // an empty group takes no room: no gap after the title
        els.headBtns.style.display = this._showCloseButton || compact && this._editable ? '' : 'none'
        els.nav.style.display = compact ? 'none' : ''
        const parent = compact ? els.headBtns : els.nav
        if (parent.contains(els.tools)) return
        if (compact) els.headBtns.insertBefore(els.tools, els.close)
        else els.nav.appendChild(els.tools)
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
        // the fov before the pose, in each step and at the end: with camera.userData.dollyFov, a fov change moves the
        // camera to a distance that fits the model (RootScene.dollyActiveCameraFov), and the pose of the view must win
        const complete = () => {
            setFov(1)
            anim.onComplete?.()
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
                setFov(t)
                anim.onUpdate?.(t)
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

    /** Escape closes the open card or ends the adding (a popup key, so not an action); any key stops the tour */
    private _onKeyDown = (e: KeyboardEvent) => {
        if (this.isDisabled() || !this._layer) return
        const t = e.target as HTMLElement | null
        if (isTextTarget(t)) return
        this.stopTour()
        // only when the focus is in this viewer (its canvas, the card, the placing overlay) or on the page, not in another
        // viewer or panel. On the page, with more viewers, the one used last takes the key
        const mine = !!t && (t === this._viewer?.canvas || this._layer.contains(t))
        if (!mine && (t && t !== document.body || !this._usedLast())) return
        if (e.key === 'Escape' && (this._place || this._openId)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (this._place) this.cancelAdding()
            else this.close()
        }
    }

    /**
     * A click (no drag) on the canvas closes the card; dragging to orbit keeps it. With {@link closeOnCanvasInteraction},
     * a drag closes it when it moves 4px (`_onWindowMove`, or at the pointer up), and a wheel zoom too.
     */
    private _onWindowDown = (e: PointerEvent) => {
        const canvas = e.target === this._viewer?.canvas
        if (canvas) this.stopTour()
        if (canvas || this._layer?.contains(e.target as Node)) this._used()
        this._down = {x: e.clientX, y: e.clientY, canvas, primary: !(e.button > 0)}
    }

    private _onWindowUp = (e: PointerEvent) => {
        const d = this._down
        this._down = null
        if (this._camMoving) this._cameraMoving(false)
        if (!d || !d.canvas || !this._openId || this._drag || this._place) return
        const click = e.target === this._viewer?.canvas && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4
        if (click || d.primary && this._closesOnInteraction()) this.close()
    }

    private _onWindowMove = (e: PointerEvent) => {
        const d = this._down
        if (!d || !d.canvas || this._drag || this._place || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
        // a drag on the canvas moves the camera (also with another button: pan)
        if (this._compactCard && (!this._camMoving || this._camTimer)) this._cameraMoving(true)
        if (d.primary && this._closesOnInteraction()) this.close()
    }

    private _onWindowWheel = (e: WheelEvent) => {
        if (e.target !== this._viewer?.canvas) return
        if (this._compactCard) {
            this._cameraMoving(true)
            this._cameraMoving(false) // a wheel has no end event: shown again BAR_DELAY ms after the last one
        }
        if (!this._closesOnInteraction()) return
        this.stopTour()
        this.close()
    }

    private _used() {
        this._usedAt = ++AnnotationsPlugin._uses
    }

    /** No other plugin on the page with an open card or placing was used after this one */
    private _usedLast() {
        for (const p of AnnotationsPlugin._added) {
            if (p !== this && p._usedAt > this._usedAt && (p._openId || p._place) && !p.isDisabled()) return false
        }
        return true
    }

    /** {@link closeOnCanvasInteraction} is on and an interaction now would close the open card */
    private _closesOnInteraction() {
        return this.closeOnCanvasInteraction && !!this._openId && !this._drag && !this._place && !this.isDisabled()
    }

    // endregion
}

/** The tour bar shows again this long (ms) after the user stops moving the camera */
const BAR_DELAY = 400

/** The icons of the card (24 px grid, drawn with the text colour, shown at 14 px as the icons of the editor) */
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICONS = {
    close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    prev: svg('<path d="m15 18-6-6 6-6"/>'),
    next: svg('<path d="m9 18 6-6-6-6"/>'),
    // a viewfinder with a check: "set this view"
    view: svg('<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="m8.5 12 2.5 2.5 4.5-4.5"/>'),
    delete: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
}

/** An object, not an array or null */
function isPlainObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** A deep copy of plain JSON (functions and undefined values are dropped) */
function jsonCopy<T>(v: T): T {
    return JSON.parse(JSON.stringify(v))
}

/** Sets the height of a textarea to its text (the scroll height and the 1px borders), at most `max`. Hidden: left as is. */
function fitHeight(t: HTMLTextAreaElement, max: number) {
    if (!t.clientWidth) return
    t.style.height = 'auto'
    t.style.height = Math.min(max, t.scrollHeight + 2) + 'px'
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
