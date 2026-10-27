import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    IObject3D,
    Object3D,
    PickingPlugin,
    Raycaster,
    ThreeViewer,
    TransformControlsPlugin,
    Vector2,
    Vector3,
} from 'threepipe'
import {
    childTargets,
    isFrame,
    parentTarget,
    resolveTarget,
    scopeObjects,
    SelectionLevel,
    selectionLevels,
    siblingTarget,
    toggleSelected,
} from './selectionHierarchy'

export interface SelectionUxPluginEventMap extends AViewerPluginEventMap {
    /** The selection (`reason: 'selection'`) or the hovered object (`reason: 'hover'`) changed */
    uxUpdate: {reason: string}
}

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
 * The selection is the selection of the {@link PickingPlugin} (added as a dependency): its events, its undo steps and its
 * box widget stay as they are. While enabled, this plugin takes over the clicks and keys that select.
 * Each selection change is one undo step, when the viewer has an `UndoManagerPlugin`.
 */
export class SelectionUxPlugin extends AViewerPluginSync<SelectionUxPluginEventMap> {
    static readonly PluginType = 'SelectionUxPlugin'
    enabled = true
    dependencies = [PickingPlugin]

    /** Pointer movement in pixels after which a press is a drag, not a click */
    static ClickDistance = 4
    /**
     * A second click on the same spot after this time (ms) selects the object behind, this time after that click (a press
     * in between makes it a double click); a quicker second click is a double click
     */
    static ClickAgainDelay = 400

    private _picking?: PickingPlugin
    private _raycaster = new Raycaster()
    private _pointer = new Vector2()
    private _pointerInside = false
    private _pointerDirty = false
    private _deepKey = false
    private _hover: IObject3D | null = null
    private _state: DragState | null = null
    private _lastClick: {p: Vector2, t: number, tgt: IObject3D} | null = null
    /** A click behind that waits until a double click is ruled out (a press within {@link ClickAgainDelay} cancels it) */
    private _clickBehind?: ReturnType<typeof setTimeout>
    private _nextHoverAt = 0

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
        viewer.addEventListener('preFrame', this._onPreFrame)
        this._picking.addEventListener('hitObject', this._onPickerHit)
        this._picking.addEventListener('selectedObjectChanged', this._onSelectionChanged)
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
        viewer.removeEventListener('preFrame', this._onPreFrame)
        this._picking?.removeEventListener('hitObject', this._onPickerHit)
        this._picking?.removeEventListener('selectedObjectChanged', this._onSelectionChanged)
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

    private _rayFromScreen(sx: number, sy: number) {
        const {w, h} = this._size()
        this._raycaster.setFromCamera(new Vector2(sx / w * 2 - 1, -(sy / h) * 2 + 1), this._viewer!.scene.mainCamera)
    }

    private _worldPerPixel(at: Vector3) {
        const cam = this._viewer!.scene.mainCamera
        const c = cam as any // orthographic or perspective
        const {h} = this._size()
        if (c.isOrthographicCamera) return (c.top - c.bottom) / c.zoom / h
        return 2 * cam.position.distanceTo(at) * Math.tan((c.fov || 45) * Math.PI / 360) / h
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
     * The object that a press at a screen point is on. The selection wins over what is in front of it, like in Figma,
     * and a line or point wins over a surface at about the same depth. `handle` is set when the press is on a widget
     * handle (a curve point): the PickingPlugin selects it, so the transform gizmo can move it.
     * @param sx - x in pixels from the left of the viewer canvas
     * @param sy - y in pixels from the top of the viewer canvas
     */
    raycastLeaf(sx: number, sy: number): {leaf: IObject3D, point: Vector3, handle?: Object3D} | null {
        if (!this._viewer || !this._picking?.picker) return null
        this._rayFromScreen(sx, sy)
        const wpp = this._worldPerPixel((this._viewer.scene.mainCamera as any).target ?? new Vector3())
        this._raycaster.params.Line = {threshold: wpp * 5}
        this._raycaster.params.Line2 = {threshold: 8} // fat lines: pixels added to the line width
        const hits = this._raycaster.intersectObjects(this._rayRoots(), true)
        // a line on a surface is hit at about the surface's distance: lines and points win within a few pixels of depth
        const tol = wpp * 12
        const depth = (h: typeof hits[number]) => h.distance - (isThin(h.object) ? tol : 0)
        hits.sort((a, b) => depth(a) - depth(b))
        const sel = this.selected
        const inSelection = (o: Object3D | null) => {
            for (let p = o; p; p = p.parent) if (sel.includes(p as IObject3D)) return true
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
        this._rayFromScreen(x, y)
        const out: IObject3D[] = []
        for (const hit of this._raycaster.intersectObjects(this._rayRoots(), true)) {
            const leaf = this._hitLeaf(hit.object as IObject3D)
            const t = leaf && this.resolveTarget(leaf, deep, false)
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
        if (!this._active || e.isPrimary === false || e.target !== this._viewer!.canvas) return
        // the camera controls prevent the default, so a focused text field would keep the focus and the keys
        const ae = document.activeElement as HTMLElement | null
        if (ae && ae !== document.body && ae !== this._viewer!.canvas) ae.blur()
        if (e.button !== 0) return
        // the second press of a double click: the click behind of the first one does not happen
        this._cancelClickBehind()
        // the transform gizmo gets the press when the pointer is on one of its axes
        const tc = this._viewer!.getPlugin(TransformControlsPlugin)
        if (tc && !tc.isDisabled() && tc.transformControls?.axis) return
        const p = this._local(e)
        this._pointer.copy(p)
        const hit = this.raycastLeaf(p.x, p.y)
        // a widget handle (a curve point): the PickingPlugin selects it with its intersection, for the transform gizmo
        if (hit?.handle) return
        this._state = {kind: 'press', start: p, leaf: hit?.leaf ?? null, shift: e.shiftKey, deep: e.ctrlKey || e.metaKey}
    }

    private _onPointerMove = (e: PointerEvent) => {
        if (!this._active || e.isPrimary === false) return
        this._deepKey = e.ctrlKey || e.metaKey
        const p = this._local(e)
        this._pointer.copy(p)
        // a held button moves the camera: no hover while it moves (a raycast per frame costs frames on a big model)
        if (!e.buttons) this._pointerDirty = true
        // a drag: the camera controls have it
        if (this._state && this._state.start.distanceTo(p) >= SelectionUxPlugin.ClickDistance) this._state = null
    }

    private _onPointerUp = (e: PointerEvent) => {
        if (e.isPrimary === false) return
        const s = this._state
        this._state = null
        this._pointerDirty = true
        if (s && this._active) this._click(s)
    }

    private _onPointerCancel = () => {
        this._state = null
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

    private _hoverTarget(): IObject3D | null {
        if (!this._pointerInside) return null
        // over a panel or a button on top of the canvas
        const {left, top} = this._size()
        if (document.elementFromPoint(this._pointer.x + left, this._pointer.y + top) !== this._viewer!.canvas) return null
        const hit = this.raycastLeaf(this._pointer.x, this._pointer.y)
        if (!hit) return null
        const tgt = this.resolveTarget(hit.leaf, this._deepKey, false)
        // inside a selected group: the part that a double click selects
        return tgt && this.selected.includes(tgt) ? this.resolveTarget(hit.leaf, false, true) : tgt
    }

    private _setHover(h: IObject3D | null) {
        if (h === this._hover) return
        this._hover = h
        this._emit('hover')
    }

    // endregion

    // region keyboard

    private _onBlur = () => {
        this._deepKey = false
    }

    private _onKeyUp = (e: KeyboardEvent) => {
        this._deepKey = e.ctrlKey || e.metaKey
        this._pointerDirty = true
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        this._deepKey = e.ctrlKey || e.metaKey
        this._pointerDirty = true
        if (!this._active) return
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
        const enter = e.code === 'Enter' || e.code === 'NumpadEnter'
        // a control reached with the keyboard (a toolbar button, a menu item) presses with Enter itself
        if (enter && t?.matches?.(':focus-visible') && t.closest?.('button, select, a[href], [role="menuitem"]')) return
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
