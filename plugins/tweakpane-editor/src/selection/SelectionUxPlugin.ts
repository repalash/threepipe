import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    IObject3D,
    Object3D,
    onChange,
    PickingPlugin,
    Raycaster,
    ThreeViewer,
    uiDropdown,
    uiFolderContainer,
    uiInput,
    uiToggle,
    Vector2,
    Vector3,
} from 'threepipe'
import type {TransformControlsPlugin} from 'threepipe'
import {
    childTargets,
    isFrame,
    levelTarget,
    parentTarget,
    resolveTarget,
    scopeObjects,
    SelectionLevel,
    selectionLevels,
    siblingTarget,
    toggleSelected,
    wrappedChain,
} from './selectionHierarchy'
import {boxEdgesPath, boxInfo, BoxInfo, boxScreenRect, bracketsPath, frontFaces, ScreenPoint, ScreenRect, toScreen} from './selectionBox'
import {ElementPool} from './ElementPool'

export interface SelectionUxPluginEventMap extends AViewerPluginEventMap {
    /** The selection (`reason: 'selection'`) or the hovered object (`reason: 'hover'`) changed */
    uxUpdate: {reason: string}
}

/** How the overlay draws the box of the selection: a screen rectangle (as in Figma), the 3D box, or the corners of the 3D box */
export type SelectionBoxStyle = 'rect' | 'box' | 'brackets'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A press of the left button on the canvas, until it is released (a click) or moves (then the camera controls have it) */
interface DragState {kind: 'press', start: Vector2, leaf: IObject3D | null, shift: boolean, deep: boolean}

/** Lines and points: thin targets that win over a surface at about the same depth */
function isThin(o: any) {
    return !!(o.isLine || o.isLine2 || o.isLineSegments2 || o.isPoints)
}

/**
 * Figma-like selection in the viewport, for an editor:
 * - A click selects the outermost group under the pointer. A group with a single child is one level with that child
 *   (glTF wrappers), and a top-level object that holds a whole file (a frame) passes the click to its parts.
 * - A click on the selected group keeps it, a double click selects one level deeper. When a part of a group is
 *   selected, a click on another part of that group selects that part.
 * - A click again on the same spot (not a double click) selects the next object behind, at the same level.
 * - Shift+click adds or removes an object. Ctrl/Cmd+click selects the deepest object under the pointer.
 * - Keys: Esc or Shift+Enter select the parent, Enter the children, Tab / Shift+Tab the next / previous sibling,
 *   Ctrl/Cmd+A all objects at the level of the selection.
 * - A drag is not a click: the camera controls keep it.
 *
 * The selection is the selection of the {@link PickingPlugin} (added as a dependency): its events and its undo steps stay
 * as they are. While enabled, this plugin takes over the clicks and keys that select.
 * Each selection change is one undo step, when the viewer has an `UndoManagerPlugin`.
 *
 * The overlay ({@link overlay}) draws the selection over the canvas: its box ({@link boxStyle}), the boxes of the
 * objects of a multiple selection, the box of the hovered object, the name with its parent levels (a click on a parent
 * selects it) and the size. While it draws, the box and the hover box of the PickingPlugin are off.
 *
 * An editor setting: it is not saved in the viewer config.
 */
@uiFolderContainer('Selection UX')
export class SelectionUxPlugin extends AViewerPluginSync<SelectionUxPluginEventMap> {
    static readonly PluginType = 'SelectionUxPlugin'
    /** Off: the PickingPlugin selects on click as without this plugin */
    @uiToggle()
        enabled = true
    dependencies = [PickingPlugin]
    toJSON: any = undefined

    /** Pointer movement in pixels after which a press is a drag, not a click */
    static ClickDistance = 4
    /**
     * A second click on the same spot after this time (ms) selects the object behind, this time after that click (a press
     * in between makes it a double click); a quicker second click is a double click
     */
    static ClickAgainDelay = 400

    /**
     * Draw the overlay over the canvas: the boxes of the selection and of the hovered object, the name and the size.
     * While it draws, the box and the hover box of the PickingPlugin are off (they come back when it stops).
     */
    @uiToggle('Overlay')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        overlay = true
    /** How the box of the selection is drawn: a screen rectangle (as in Figma), the 3D box, or the corners of the 3D box */
    @uiDropdown('Box style', ['rect', 'box', 'brackets'].map(label => ({label})))
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        boxStyle: SelectionBoxStyle = 'rect'
    /** The box of one object turns with it (`local`) or follows the world axes (`world`); a box of several objects follows the world axes */
    @uiDropdown('Box space', ['local', 'world'].map(label => ({label})))
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        boxSpace: 'local' | 'world' = 'local'
    /** With the `box` style, draw the edges that face away from the camera dashed */
    @uiToggle('X-ray')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        xray = true
    /** Draw the box of the hovered object (see {@link hovered}) */
    @uiToggle('Show hover')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        showHover = true
    /** Show the name above the selection, after the names of its parent levels; a click on a parent name selects it */
    @uiToggle('Show name')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        showName = true
    /** Show the size of the box below the selection, in scene units (see {@link unit}) */
    @uiToggle('Show size')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        showSize = true
    /** The unit after the size, like `'cm'`; empty for none */
    @uiInput('Unit')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        unit = ''
    /** The colour of the overlay, a CSS colour */
    @uiInput('Accent')
    @onChange(SelectionUxPlugin.prototype.redrawOverlay)
        accent = '#0d99ff'

    private _picking?: PickingPlugin
    private _raycaster = new Raycaster()
    private _ndc = new Vector2()
    /** The last pointer position, in client pixels (no layout read per pointer move) */
    private _client = new Vector2()
    private _pointerInside = false
    private _pointerDirty = false
    /** A button is held while the pointer moves: the camera controls move the view */
    private _pointerHeld = false
    private _deepKey = false
    private _hover: IObject3D | null = null
    private _state: DragState | null = null
    private _lastClick: {p: Vector2, t: number, tgt: IObject3D} | null = null
    /** A click behind that waits until a double click is ruled out (a press within {@link ClickAgainDelay} cancels it) */
    private _clickBehind?: ReturnType<typeof setTimeout>
    private _nextHoverAt = 0
    private _root?: HTMLDivElement
    private _lines?: ElementPool<SVGElement>
    private _labels?: ElementPool<HTMLElement>
    /** The objects of the parent names in the name label, by their index in `data-sux-crumb` */
    private _crumbs: IObject3D[] = []
    /** The box and hover settings of the PickingPlugin while the overlay draws, to restore them after */
    private _pickingSaved?: {widget: boolean, hover: boolean}
    /** The overlay draws on the next frame: the view, the selection, the hover or a setting changed */
    private _overlayDirty = true
    /** The overlay is on the screen */
    private _overlayShown = false

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this._raycaster.params.Line2 = {threshold: 8} // fat lines: pixels added to the line width
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._picking = viewer.getPlugin(PickingPlugin)!
        const c = viewer.container
        c.addEventListener('pointerdown', this._onPointerDown, {capture: true})
        c.addEventListener('pointermove', this._onPointerMoveInside)
        c.addEventListener('pointerleave', this._onPointerLeave)
        c.addEventListener('dblclick', this._onDblClick, {capture: true})
        window.addEventListener('pointermove', this._onPointerMove)
        window.addEventListener('pointerup', this._onPointerUp)
        window.addEventListener('pointercancel', this._onPointerCancel)
        window.addEventListener('keydown', this._onKeyDown, {capture: true})
        window.addEventListener('keyup', this._onKeyUp, {capture: true})
        window.addEventListener('blur', this._onBlur)
        // a scroll of any element (scroll does not bubble: the capture phase sees it) or a resize can move the canvas in
        // the containing block of the overlay (a scrolled container between them), with no render
        window.addEventListener('scroll', this._onMoved, {capture: true, passive: true})
        window.addEventListener('resize', this._onMoved)
        viewer.addEventListener('preFrame', this._onPreFrame)
        viewer.addEventListener('postFrame', this._onPostFrame)
        viewer.addEventListener('preRender', this._onPreRender)
        this._picking.addEventListener('hitObject', this._onPickerHit)
        this._picking.addEventListener('selectedObjectChanged', this._onSelectionChanged)

        // the overlay: SVG lines, and HTML labels on top, over the canvas; only the parent names take the pointer
        const root = document.createElement('div')
        root.className = 'sux-overlay'
        root.setAttribute('style', 'position:absolute;pointer-events:none;overflow:hidden;display:none;' +
            'font:11px/16px var(--tp-font-family, ui-sans-serif, system-ui, sans-serif);')
        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;')
        const labels = document.createElement('div')
        labels.setAttribute('style', 'position:absolute;inset:0;')
        root.appendChild(svg)
        root.appendChild(labels)
        // next to the canvas: the same containing block, transforms and clip as the canvas
        const canvas = viewer.canvas
        if (canvas.parentElement) canvas.parentElement.insertBefore(root, canvas.nextSibling)
        else c.appendChild(root)
        this._root = root
        this._lines = new ElementPool(svg, t => document.createElementNS(SVG_NS, t) as SVGElement)
        this._labels = new ElementPool(labels, t => document.createElement(t))
    }

    onRemove(viewer: ThreeViewer) {
        const c = viewer.container
        c.removeEventListener('pointerdown', this._onPointerDown, {capture: true})
        c.removeEventListener('pointermove', this._onPointerMoveInside)
        c.removeEventListener('pointerleave', this._onPointerLeave)
        c.removeEventListener('dblclick', this._onDblClick, {capture: true})
        window.removeEventListener('pointermove', this._onPointerMove)
        window.removeEventListener('pointerup', this._onPointerUp)
        window.removeEventListener('pointercancel', this._onPointerCancel)
        window.removeEventListener('keydown', this._onKeyDown, {capture: true})
        window.removeEventListener('keyup', this._onKeyUp, {capture: true})
        window.removeEventListener('blur', this._onBlur)
        window.removeEventListener('scroll', this._onMoved, {capture: true})
        window.removeEventListener('resize', this._onMoved)
        viewer.removeEventListener('preFrame', this._onPreFrame)
        viewer.removeEventListener('postFrame', this._onPostFrame)
        viewer.removeEventListener('preRender', this._onPreRender)
        this._picking?.removeEventListener('hitObject', this._onPickerHit)
        this._picking?.removeEventListener('selectedObjectChanged', this._onSelectionChanged)
        this._takeOverPickingBox(false)
        this._root?.remove()
        this._root = this._lines = this._labels = undefined
        this._overlayShown = false
        this._overlayDirty = true
        this._crumbs = []
        this._picking = undefined
        this._state = null
        this._lastClick = null
        this._cancelClickBehind()
        this._hover = null
        super.onRemove(viewer)
    }

    /**
     * On, with the PickingPlugin on and picking objects. When the picker picks materials, geometries or textures, the
     * core picker keeps the clicks.
     */
    private get _active() {
        const picker = this._picking?.picker
        const mode = picker?.pickingMode === 'auto' ? picker.selectionMode : picker?.pickingMode
        return !this.isDisabled() && !!this._viewer && !!this._picking && !this._picking.isDisabled() && mode === 'object'
    }

    private _emit(reason: string) {
        this.dispatchEvent({type: 'uxUpdate', reason})
    }

    // region selection model

    /** The selected objects, the primary first (materials or other assets selected in the PickingPlugin are left out) */
    get selected(): IObject3D[] {
        return (this._picking?.getSelectedObjects() || []).filter(o => (o as IObject3D)?.isObject3D) as IObject3D[]
    }

    /** The object that a click at the pointer would select, null when there is none or the pointer is not on the canvas */
    get hovered(): IObject3D | null {
        return this._hover
    }

    /**
     * Set the selection, the primary object first.
     * @param objs - the objects, empty to select nothing
     * @param record - add an undo step (when the viewer has an `UndoManagerPlugin` and the selection changes)
     */
    select(objs: IObject3D[], record = true) {
        this._picking?.picker?.setSelected(objs.length ? objs.length === 1 ? objs[0] : objs as any : null, record)
    }

    private get _modelRoot(): IObject3D {
        return this._viewer!.scene.modelRoot
    }

    /**
     * The levels of the hierarchy from the model root down to `node`, outermost first; empty when `node` is not in the
     * model. Each level is a chain that selects as one: a group with a single child is merged with that child
     * (glTF wrappers like "Scene" > "root"). A click selects the first object of a level.
     */
    levels(node: IObject3D): SelectionLevel[] {
        return selectionLevels(this._modelRoot, node)
    }

    /**
     * Whether `o` is a frame: a top-level object that holds a whole file (an imported file root, or the only top-level
     * object with meshes) with two or more parts. A click selects its parts, like a top-level frame in Figma.
     */
    isFrame(o: IObject3D): boolean {
        return isFrame(this._modelRoot, o)
    }

    /** The objects at the level of the primary selection. With nothing selected: the top level, a frame stands for its parts. */
    scopeObjects(): IObject3D[] {
        return scopeObjects(this._modelRoot, this.selected)
    }

    /**
     * The object that a click on `leaf` selects with the current selection, null when `leaf` is not in the model.
     * The selected level of the leaf stays selected (with `drill`: the next level inside it), a leaf in the same group as
     * the primary selection selects its sibling, else the top level (a frame passes the click to its part).
     * @param leaf - the object under the pointer (see {@link raycastLeaf})
     * @param deep - the deepest level (Ctrl/Cmd+click)
     * @param drill - one level inside a selected group (double click)
     */
    resolveTarget(leaf: IObject3D, deep: boolean, drill: boolean): IObject3D | null {
        return resolveTarget(this._modelRoot, this.selected, leaf, deep, drill)
    }

    /** Select the parent level of the primary selection, or nothing at the top level */
    selectParent() {
        if (!this.selected.length) return
        const p = parentTarget(this._modelRoot, this.selected)
        this.select(p ? [p] : [])
    }

    /** Whether more than one object can be selected: the Multi-Select setting of the PickingPlugin */
    private get _multi() {
        return this._picking?.picker?.multiSelectEnabled !== false
    }

    /** Select the children of the selected objects (with Multi-Select off in the PickingPlugin: the first child) */
    selectChildren() {
        const children = childTargets(this._modelRoot, this.selected)
        if (children.length) this.select(this._multi ? children : children.slice(0, 1))
    }

    /** Select the next (1) or previous (-1) object at the level of the primary selection */
    selectSibling(dir: 1 | -1) {
        const next = siblingTarget(this._modelRoot, this.selected, dir)
        if (next) this.select([next])
    }

    /**
     * Select all objects at the level of the primary selection (with nothing selected: the top level). Does nothing with
     * Multi-Select off in the PickingPlugin, as its `selectAll()`.
     */
    selectAllInScope() {
        if (!this._multi) return
        const scope = this.scopeObjects()
        if (scope.length) this.select(scope)
    }

    // endregion

    // region raycast

    /** The canvas rectangle: the rendered view (it can be smaller than the container, or offset in it) */
    private _size() {
        const r = this._viewer!.canvas.getBoundingClientRect()
        return {w: r.width, h: r.height, left: r.left, top: r.top}
    }

    /**
     * The size of a pixel in world units at the camera target (the origin when the camera has none)
     * @param h - the canvas height in pixels
     */
    private _worldPerPixel(h: number) {
        const cam = this._viewer!.scene.mainCamera
        const c = cam as any // orthographic or perspective
        if (c.isOrthographicCamera) return (c.top - c.bottom) / c.zoom / h
        const dist = c.target ? cam.position.distanceTo(c.target) : cam.position.length()
        return 2 * dist * Math.tan((c.fov || 45) * Math.PI / 360) / (c.zoom || 1) / h
    }

    /** The objects to raycast: the model, and the widget roots of the PickingPlugin (a widget stands for its object) */
    private _rayRoots(): Object3D[] {
        return [this._modelRoot, ...this._picking?.picker?.extraObjects ?? []]
    }

    /**
     * The selectable object of a raycast hit: the object of a widget, else the hit object or its first parent that the
     * PickingPlugin can select (as the core picker does)
     */
    private _hitLeaf(o: IObject3D): IObject3D | null {
        // a raycast also hits hidden objects: an object that is hidden, or in a hidden parent, is not on the screen
        for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return null
        let w: any = o
        while (w && !(w.assetType === 'widget' && w.object)) w = w.parent
        let leaf: IObject3D | null = w ? w.object.visible ? w.object : null : o
        if (!w) while (leaf && !this._picking?.picker?.selectionCondition(leaf)) leaf = leaf.parent as IObject3D | null
        return leaf && this.levels(leaf).length ? leaf : null
    }

    /**
     * The raycast hits at a screen point, front to back as a click sees them: a line or a point is hit within a few
     * pixels, and wins over a surface at about the same depth (a line on a surface is hit at about the surface's distance)
     */
    private _intersect(sx: number, sy: number, {w, h}: {w: number, h: number}) {
        this._raycaster.setFromCamera(this._ndc.set(sx / w * 2 - 1, -(sy / h) * 2 + 1), this._viewer!.scene.mainCamera)
        const wpp = this._worldPerPixel(h)
        this._raycaster.params.Line.threshold = wpp * 5
        this._raycaster.params.Points.threshold = wpp * 5
        const hits = this._raycaster.intersectObjects(this._rayRoots(), true)
        const tol = wpp * 12
        const depth = (hit: typeof hits[number]) => hit.distance - (isThin(hit.object) ? tol : 0)
        return hits.sort((a, b) => depth(a) - depth(b))
    }

    /**
     * The object that a press at a screen point is on. The selection wins over what is in front of it, like in Figma,
     * and a line or point wins over a surface at about the same depth. `handle` is set when the press is on a widget
     * handle (a curve point): the PickingPlugin selects it, so the transform gizmo can move it.
     * @param sx - x in pixels from the left of the viewer canvas
     * @param sy - y in pixels from the top of the viewer canvas
     */
    raycastLeaf(sx: number, sy: number): {leaf: IObject3D, point: Vector3, handle?: Object3D} | null {
        if (!this._viewer || !this._picking?.picker) return null
        return this._raycastLeaf(sx, sy, this._size(), this.selected)
    }

    /** {@link raycastLeaf} with the canvas size and the selection, read once by the caller */
    private _raycastLeaf(sx: number, sy: number, size: {w: number, h: number}, sel: IObject3D[]) {
        const hits = this._intersect(sx, sy, size)
        const selSet = new Set<Object3D>(sel)
        const inSelection = (o: Object3D | null) => {
            for (let p = o; p; p = p.parent) if (selSet.has(p)) return true
            return false
        }
        let first: {leaf: IObject3D, point: Vector3, handle?: Object3D} | null = null
        for (const hit of hits) {
            const leaf = this._hitLeaf(hit.object as IObject3D)
            if (!leaf) continue
            const handle = hit.object.userData.isWidgetHandle ? hit.object : undefined
            if (!sel.length || inSelection(leaf)) return {leaf, point: hit.point.clone(), handle}
            first ??= {leaf, point: hit.point.clone(), handle}
        }
        return first
    }

    /**
     * The objects under a screen point, front to back, as a click selects them (one per object, at the click's level)
     * @param x - x in pixels from the left of the viewer canvas
     * @param y - y in pixels from the top of the viewer canvas
     * @param deep - the deepest level (as Ctrl/Cmd+click)
     */
    targetsAt(x: number, y: number, deep = false): IObject3D[] {
        if (!this._viewer || !this._picking?.picker) return []
        const out: IObject3D[] = []
        const sel = this.selected
        for (const hit of this._intersect(x, y, this._size())) {
            const leaf = this._hitLeaf(hit.object as IObject3D)
            const t = leaf && resolveTarget(this._modelRoot, sel, leaf, deep, false)
            if (t && !out.includes(t)) out.push(t)
        }
        return out
    }

    // endregion

    // region pointer

    private _onPickerHit = (e: {intersects: {consumed?: boolean, selectedHandle?: unknown}}) => {
        // this plugin selects on click; the PickingPlugin keeps the state, and selects a widget handle itself
        if (this._active && !e.intersects.selectedHandle) e.intersects.consumed = true
    }

    private _onSelectionChanged = () => {
        // the hover target depends on the selection (inside a selected group: the part a double click selects)
        this._pointerDirty = true
        this._overlayDirty = true
        this._emit('selection')
    }

    private _local(e: MouseEvent) {
        const {left, top} = this._size()
        return new Vector2(e.clientX - left, e.clientY - top)
    }

    private _onPointerMoveInside = () => {
        this._pointerInside = true
    }

    private _onPointerLeave = () => {
        this._pointerInside = false
        this._pointerDirty = true
    }

    private _onPointerDown = (e: PointerEvent) => {
        if (e.isPrimary === false) {
            // a second touch: a pinch or a two-finger pan of the camera, not a click; no hover until the release
            this._state = null
            this._pointerHeld = true
            return
        }
        if (!this._active) return
        // a parent name in the name label of the overlay: select that parent
        const crumb = (e.target as Element | null)?.getAttribute?.('data-sux-crumb')
        if (crumb != null && e.button === 0) {
            e.stopPropagation()
            e.preventDefault()
            const o = this._crumbs[Number(crumb)]
            if (o) this.select([o])
            return
        }
        if (e.target !== this._viewer!.canvas) return
        // the camera controls prevent the default, so a focused text field would keep the focus and the keys
        const ae = document.activeElement as HTMLElement | null
        if (ae && ae !== document.body && ae !== this._viewer!.canvas) ae.blur()
        if (e.button !== 0) return
        // the second press of a double click: the click behind of the first one does not happen
        this._cancelClickBehind()
        // the transform gizmo gets the press when the pointer is on one of its axes
        const tc = this._viewer!.getPlugin<TransformControlsPlugin>('TransformControlsPlugin')
        if (tc && !tc.isDisabled() && tc.transformControls?.axis) return
        const p = this._local(e)
        this._client.set(e.clientX, e.clientY)
        const hit = this.raycastLeaf(p.x, p.y)
        // a widget handle (a curve point): the PickingPlugin selects it with its intersection, for the transform gizmo
        if (hit?.handle) return
        this._state = {kind: 'press', start: p, leaf: hit?.leaf ?? null, shift: e.shiftKey, deep: e.ctrlKey || e.metaKey}
    }

    private _onPointerMove = (e: PointerEvent) => {
        if (!this._active || e.isPrimary === false) return
        this._setDeepKey(e.ctrlKey || e.metaKey)
        this._client.set(e.clientX, e.clientY)
        // a held button moves the camera: no hover while it moves (a raycast per frame costs frames on a big model)
        this._pointerHeld = !!e.buttons
        if (!e.buttons) this._pointerDirty = true
        // a drag: the camera controls have it
        if (this._state && this._state.start.distanceTo(this._local(e)) >= SelectionUxPlugin.ClickDistance) this._state = null
    }

    private _onPointerUp = (e: PointerEvent) => {
        if (e.isPrimary === false) return
        const s = this._state
        this._state = null
        this._pointerHeld = false
        this._pointerDirty = true
        if (s && this._active) this._click(s)
    }

    private _onPointerCancel = () => {
        this._state = null
        this._pointerHeld = false
    }

    private _onDblClick = (e: MouseEvent) => {
        if (!this._active || e.target !== this._viewer!.canvas) return
        const p = this._local(e)
        const hit = this.raycastLeaf(p.x, p.y)
        if (!hit || hit.handle) return
        // one level inside the selected group
        const tgt = this.resolveTarget(hit.leaf, false, true)
        if (tgt) this.select([tgt])
        e.stopPropagation()
    }

    private _cancelClickBehind() {
        clearTimeout(this._clickBehind)
        this._clickBehind = undefined
    }

    private _click(s: DragState) {
        if (!s.leaf) {
            // the PickingPlugin also clears the selection on a quick click on empty space
            this.select([])
            this._lastClick = null
            return
        }
        const tgt = this.resolveTarget(s.leaf, s.deep, false)
        if (!tgt) return
        // with Multi-Select off in the PickingPlugin, Shift+click is a click, as in the core picker
        const shift = s.shift && this._multi
        // a click again on the same spot (not a double click) goes behind: the next object under the pointer, like Blender
        const now = performance.now()
        const last = this._lastClick
        const sel = this.selected
        if (!shift && last && last.p.distanceTo(s.start) < SelectionUxPlugin.ClickDistance && now - last.t > SelectionUxPlugin.ClickAgainDelay &&
            sel.length === 1 && sel[0] === last.tgt) {
            const under = this.targetsAt(s.start.x, s.start.y, s.deep)
            if (under.length > 1) {
                const behind = under[(under.indexOf(last.tgt) + 1) % under.length]
                this._lastClick = {p: s.start.clone(), t: now, tgt: last.tgt}
                // it can be the first click of a double click (which goes one level in): wait until that is ruled out
                this._cancelClickBehind()
                const from = last.tgt
                this._clickBehind = setTimeout(() => {
                    this._clickBehind = undefined
                    // the selection changed meanwhile (Esc, Tab, another panel) or the plugin is off: that wins
                    const current = this.selected
                    if (!this._active || current.length !== 1 || current[0] !== from) return
                    if (this._lastClick) this._lastClick.tgt = behind
                    this.select([behind])
                }, SelectionUxPlugin.ClickAgainDelay)
                return
            }
        }
        this._lastClick = {p: s.start.clone(), t: now, tgt}
        if (shift) this.select(toggleSelected(sel, tgt))
        else if (!(sel.length === 1 && sel[0] === tgt)) this.select([tgt])
    }

    // endregion

    // region hover

    private _onPreFrame = () => {
        if (!this._active) {
            this._setHover(null)
            return
        }
        if (!this._pointerDirty || this._state || performance.now() < this._nextHoverAt) return
        this._pointerDirty = false
        const t = performance.now()
        this._setHover(this._hoverTarget())
        // a heavy scene: hover less often, so the raycast does not take every frame
        const dt = performance.now() - t
        this._nextHoverAt = dt > 4 ? performance.now() + dt * 3 : 0
    }

    private _onPreRender = () => {
        // the view changed under a still pointer (a zoom, a camera view transition, the damping after a release, a moved
        // object): the viewer resets the frame count on a change, not on the progressive frames of the same view
        if (this._viewer!.renderManager.frameCount !== 0) return
        if (this._pointerInside && !this._pointerHeld) this._pointerDirty = true
        this._overlayDirty = true
    }

    private _hoverTarget(): IObject3D | null {
        if (!this._pointerInside || !this._picking?.picker) return null
        // over a panel or a button on top of the canvas
        const {x, y} = this._client
        if (document.elementFromPoint(x, y) !== this._viewer!.canvas) return null
        const size = this._size()
        const sel = this.selected
        const hit = this._raycastLeaf(x - size.left, y - size.top, size, sel)
        if (!hit) return null
        const tgt = resolveTarget(this._modelRoot, sel, hit.leaf, this._deepKey, false)
        // inside a selected group: the part that a double click selects
        return tgt && sel.includes(tgt) ? resolveTarget(this._modelRoot, sel, hit.leaf, false, true) : tgt
    }

    private _setHover(h: IObject3D | null) {
        if (h === this._hover) return
        this._hover = h
        this._overlayDirty = true
        this._emit('hover')
    }

    // endregion

    // region overlay

    /**
     * The name shown for an object. For a chain of wrappers that selects as one (glTF "Scene" > "root" > "Watch"): the
     * innermost name that is not a generic one (Scene, root, RootNode, glTF, group). Else its name, or its type.
     */
    displayName(o: IObject3D): string {
        // the levels end at `o`: the chain goes on below it
        const level = this.levels(o).find(l => l.includes(o)) ?? [o]
        const chain = [...level, ...wrappedChain(o).slice(1)]
        const named = chain.reverse().find(n => n.name && !/^(scene|root|rootnode|gltf|group)$/i.test(n.name))
        return named?.name || o.name || o.type
    }

    /**
     * The box around objects, as the overlay draws it
     * @param space - default: {@link boxSpace}
     */
    boxInfo(objs: IObject3D[], space = this.boxSpace): BoxInfo {
        return boxInfo(objs, space, this._pointSize)
    }

    /** The point on the canvas, in pixels from its top left corner, where the main camera shows a world point */
    toScreen(v: Vector3): ScreenPoint {
        const {w, h} = this._size()
        return toScreen(v, this._viewer!.scene.mainCamera, w, h)
    }

    /** A light, a camera or an empty object is a cube of about 5% of its distance to the camera, so it keeps a size on screen */
    private _pointSize = (o: IObject3D) => Math.max(1e-3, this._eye().distanceTo(o.getWorldPosition(new Vector3())) * 0.05)

    private _eye() {
        return this._viewer!.scene.mainCamera.getWorldPosition(new Vector3())
    }

    /** The faces of a box that face the main camera; an orthographic camera by its view direction (see {@link frontFaces}) */
    private _frontFaces(info: BoxInfo) {
        const cam = this._viewer!.scene.mainCamera
        return frontFaces(info, this._eye(), (cam as any).isOrthographicCamera ? cam.getWorldDirection(new Vector3()) : undefined)
    }

    /** While the overlay draws, the box and the hover box of the PickingPlugin are off; after, they are as before */
    private _takeOverPickingBox(on: boolean) {
        const p = this._picking
        if (!p || on === !!this._pickingSaved) return
        if (on) {
            this._pickingSaved = {widget: p.widgetEnabled, hover: p.hoverEnabled}
            // a hover box shown now: clear it while the PickingPlugin still updates its box (it stops once the widget is off)
            p.picker?.setHoverObject(null)
            p.widgetEnabled = false
            p.hoverEnabled = false
        } else {
            p.widgetEnabled = this._pickingSaved!.widget
            p.hoverEnabled = this._pickingSaved!.hover
            this._pickingSaved = undefined
        }
    }

    /** The canvas can move on the page without a render: place the overlay again on the next frame, when it is shown */
    private _onMoved = () => {
        if (this._overlayShown) this._overlayDirty = true
    }

    /**
     * An element without the overlay is fullscreen (the canvas itself, as `FullScreenPlugin.enter()` does): the page
     * shows only that element, so the overlay cannot show and the box of the PickingPlugin draws the selection instead
     */
    private _fullscreenHides(root: HTMLElement) {
        const fs = document.fullscreenElement || (document as any).webkitFullscreenElement as Element | null | undefined
        return !!fs && !fs.contains(root)
    }

    private _onPostFrame = () => {
        const root = this._root
        if (!root) return
        const on = this.overlay && this._active && !this._fullscreenHides(root)
        this._takeOverPickingBox(on)
        if (on !== this._overlayShown) {
            this._overlayShown = on
            root.style.display = on ? '' : 'none'
            this._overlayDirty = true
        }
        // a frame with no change (a progressive frame, or no render) leaves the overlay as it is: no layout read, no DOM write
        if (!on || !this._overlayDirty) return
        this._overlayDirty = false
        // over the canvas, in its CSS px (they do not change with a transform). The layout box of the canvas places the
        // overlay in most pages (a scrolled parent, a static body, a transform), as they are siblings. A container
        // between the overlay and its containing block can still move the canvas (a scrolled container, a table cell):
        // the difference of their boxes on the screen, in the scale of the overlay, corrects that.
        const canvas = this._viewer!.canvas
        const w = canvas.offsetWidth, h = canvas.offsetHeight
        root.style.left = px(canvas.offsetLeft)
        root.style.top = px(canvas.offsetTop)
        root.style.width = px(w)
        root.style.height = px(h)
        const c = canvas.getBoundingClientRect(), r = root.getBoundingClientRect()
        const dx = (c.left - r.left) / (r.width / w || 1), dy = (c.top - r.top) / (r.height / h || 1)
        if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
            root.style.left = px(canvas.offsetLeft + dx)
            root.style.top = px(canvas.offsetTop + dy)
        }
        this._draw(w, h)
    }

    /**
     * Draw the overlay on the next frame. It draws by itself when the view renders after a change, the selection or the
     * hover changes, or a setting of the overlay changes; call this after a change that it does not see, like the name of
     * a selected object.
     */
    redrawOverlay() {
        this._overlayDirty = true
    }

    /**
     * The canvas points of box corners, for a canvas of `w`×`h` pixels (measured once per draw, see {@link toScreen})
     */
    private _project(corners: Vector3[], w: number, h: number) {
        const cam = this._viewer!.scene.mainCamera
        return corners.map(c => toScreen(c, cam, w, h))
    }

    private _draw(w: number, h: number) {
        const L = this._lines!, T = this._labels!
        L.begin()
        T.begin()
        this._crumbs = []
        const sel = this.selected
        const hover = this._hover
        if (hover && this.showHover && !sel.includes(hover)) this._drawBox('hover', [hover], 1, 1, w, h)
        // each object of a multiple selection in a thin box
        if (sel.length > 1) sel.forEach((o, i) => this._drawBox('part' + i, [o], 1, 0.55, w, h))
        if (sel.length) this._drawSelection(sel, w, h)
        L.end()
        T.end()
    }

    /** A thin box: the screen rectangle (`rect` style), else the edges of the 3D box that face the camera */
    private _drawBox(key: string, objs: IObject3D[], width: number, opacity: number, w: number, h: number) {
        const info = this.boxInfo(objs)
        const stroke = {fill: 'none', stroke: this.accent, strokeWidth: width, opacity}
        if (this.boxStyle !== 'rect') {
            const sc = this._project(info.corners, w, h)
            this._lines!.get(key, 'path', {...stroke, strokeLinejoin: 'round', d: boxEdgesPath(sc, this._frontFaces(info), 'visible')})
            return
        }
        const r = boxScreenRect(info.corners, this._viewer!.scene.mainCamera, w, h)
        if (r) this._lines!.get(key, 'rect', {...stroke, ...rectAttrs(r)})
    }

    private _drawSelection(sel: IObject3D[], w: number, h: number) {
        const L = this._lines!
        const info = this.boxInfo(sel)
        const sc = this._project(info.corners, w, h)
        // clipped at the near plane: a selection that reaches behind the camera covers the screen, not its front corners
        const rect = boxScreenRect(info.corners, this._viewer!.scene.mainCamera, w, h)
        if (!rect) return
        const stroke = {fill: 'none', stroke: this.accent}
        if (this.boxStyle === 'rect') L.get('sel', 'rect', {...stroke, strokeWidth: 1.5, ...rectAttrs(rect)})
        else if (this.boxStyle === 'brackets') L.get('sel', 'path', {...stroke, strokeWidth: 2, strokeLinecap: 'round', d: bracketsPath(sc)})
        else {
            const front = this._frontFaces(info)
            L.get('sel', 'path', {...stroke, strokeWidth: 1.5, strokeLinejoin: 'round', d: boxEdgesPath(sc, front, 'visible')})
            if (this.xray) L.get('sel-hidden', 'path', {...stroke, strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.6, d: boxEdgesPath(sc, front, 'hidden')})
        }
        this._drawLabels(sel, info, rect)
    }

    /** The name with its parent levels above the box, and the size below it */
    private _drawLabels(sel: IObject3D[], info: BoxInfo, rect: ScreenRect) {
        const T = this._labels!
        const label = 'position:absolute;left:0;top:0;white-space:nowrap;'
        if (this.showName) {
            const tag = T.get('name', 'div', {style: `${label}font-weight:500;color:${this.accent};transform:translate(${px(rect.minX)}, ${px(rect.minY - 4)}) translateY(-100%);`})
            if (sel.length === 1) {
                const levels = this.levels(sel[0])
                this._crumbs = levels.slice(0, Math.max(0, levels.findIndex(l => l.includes(sel[0])))).map(levelTarget)
            }
            const names = sel.length > 1 ? [`${sel.length} selected`] : [...this._crumbs, sel[0]].map(o => this.displayName(o))
            const key = names.join('\n')
            // the elements change only with the names, so a parent name under the pointer stays the same element
            if (tag.getAttribute('data-names') !== key) {
                tag.setAttribute('data-names', key)
                const parts: HTMLElement[] = []
                names.forEach((n, k) => {
                    if (k) parts.push(span('/', 'opacity:.4;margin:0 4px;'))
                    const parent = k < this._crumbs.length
                    const s = span(n, parent ? 'opacity:.65;cursor:pointer;pointer-events:auto;' : '')
                    if (parent) s.setAttribute('data-sux-crumb', String(k))
                    parts.push(s)
                })
                tag.replaceChildren(...parts)
            }
        }
        if (this.showSize) {
            const s = info.size
            const text = `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)}${this.unit ? ' ' + this.unit : ''}`
            const pill = T.get('size', 'div', {style: `${label}color:#fff;background:${this.accent};border-radius:3px;padding:0 5px;font-variant-numeric:tabular-nums;` +
                    `transform:translate(${px((rect.minX + rect.maxX) / 2)}, ${px(rect.maxY + 8)}) translateX(-50%);`})
            if (pill.textContent !== text) pill.textContent = text
        }
    }

    // endregion

    // region keyboard

    /** Ctrl/Cmd is down: the hover shows the deepest object. A change updates the hover, other keys do not raycast. */
    private _setDeepKey(deep: boolean) {
        if (deep === this._deepKey) return
        this._deepKey = deep
        this._pointerDirty = true
    }

    private _onBlur = () => {
        this._setDeepKey(false)
    }

    private _onKeyUp = (e: KeyboardEvent) => {
        this._setDeepKey(e.ctrlKey || e.metaKey)
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        this._setDeepKey(e.ctrlKey || e.metaKey)
        if (!this._active) return
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
        const enter = e.code === 'Enter' || e.code === 'NumpadEnter'
        // a control reached with the keyboard (a toolbar button, a menu item) presses with Enter itself, and Tab moves
        // the focus on; after a mouse click the focus stays on the control, not visible: the keys go to the selection
        if ((enter || e.code === 'Tab') && t?.matches?.(':focus-visible') && t.closest?.('button, select, a[href], [role="menuitem"]')) return
        const selectAll = (e.ctrlKey || e.metaKey) && e.code === 'KeyA'
        // with Multi-Select off, Ctrl/Cmd+A stays for the page
        if (selectAll && !this._multi) return
        if (selectAll) this.selectAllInScope()
        // with nothing selected, Esc, Enter and Tab keep their usual use (close a dialog, move the focus)
        else if (!this.selected.length) return
        else if (e.code === 'Escape' || enter && e.shiftKey) this.selectParent()
        else if (enter) this.selectChildren()
        else if (e.code === 'Tab') this.selectSibling(e.shiftKey ? -1 : 1)
        else return
        e.preventDefault()
        e.stopPropagation()
    }

    // endregion
}

/** A CSS length in pixels */
function px(v: number) {
    return v.toFixed(1) + 'px'
}

/** The attributes of an SVG rect */
function rectAttrs(r: ScreenRect) {
    return {x: r.minX.toFixed(1), y: r.minY.toFixed(1), width: (r.maxX - r.minX).toFixed(1), height: (r.maxY - r.minY).toFixed(1)}
}

/** A length with 3 significant digits at most: 123, 12.3, 1.23 */
function fmt(v: number) {
    const a = Math.abs(v)
    return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
}

/** A span element of a label */
function span(text: string, style: string) {
    const s = document.createElement('span')
    s.textContent = text
    if (style) s.setAttribute('style', style)
    return s
}
