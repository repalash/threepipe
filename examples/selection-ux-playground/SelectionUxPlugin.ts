import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    Box3,
    duplicateObjects,
    filterTopmostAncestors,
    Group2,
    IObject3D,
    Matrix4,
    GeometryGeneratorPlugin,
    MOUSE,
    Object3D,
    Object3DWidgetsPlugin,
    PickingPlugin,
    Plane,
    Quaternion,
    Raycaster,
    ThreeViewer,
    UndoManagerPlugin,
    Vector2,
    Vector3,
    Vector4,
} from 'threepipe'

/**
 * Prototype of a Figma-like selection UX for threepipe.
 * It replaces the click/drag handling of PickingPlugin (PickingPlugin still owns the selection state, undo and the
 * clipboard/delete/hide hotkeys) and draws the selection as a crisp screen-space SVG overlay with handles.
 */

export type SelVisual = 'figma2d' | 'box3d' | 'brackets' | 'hybrid' | 'minimal' | 'legacy'

/** ground = the floor (XZ), xy = front wall, yz = side wall, view = facing the camera */
export type MovePlaneKind = 'ground' | 'xy' | 'yz' | 'view'

export interface SelectionUxSettings {
    /** How the selection is drawn */
    visual: SelVisual
    /** Box aligned to the object (rotates with it) or to the world axes */
    boxSpace: 'local' | 'world'
    /** What a left-drag on empty space does */
    emptyDrag: 'orbit' | 'marquee'
    /** Which objects can be dragged directly to move them */
    dragMove: 'any' | 'selected' | 'off'
    /** Plane used when moving by dragging */
    movePlane: 'auto' | MovePlaneKind
    /** Point that stays fixed when scaling from a corner */
    scalePivot: 'base' | 'center' | 'opposite'
    /** Side/face handles that stretch one axis */
    stretchHandles: boolean
    /** How rotation is offered */
    rotate: 'corners' | 'knob' | 'ring' | 'off'
    /** Axis for corner/knob rotation. The ring always turns around up. Free: horizontal drag turns, vertical drag tilts. */
    rotateAxis: 'up' | 'view' | 'free'
    /** Snap to other objects while moving, and show guides */
    smartGuides: boolean
    hover: boolean
    showName: boolean
    showDims: boolean
    /** Draw hidden box edges dashed */
    xray: boolean
    marquee: 'touch' | 'contain'
    /** Length of 1 scene unit, for the size label */
    unit: 'mm' | 'cm' | 'm'
    accent: string
    /** Pipeline outline (SelectionOutlinePlugin) around the selected meshes */
    outlineSelected: boolean
    /** Pipeline outline around the hovered object, replaces the hover box */
    outlineHover: boolean
    /** Outline width in px */
    outlineWidth: number
    /** Dashed outline where the selection is behind other objects */
    outlineXray: boolean
    /** Thin lines between the parts of a selected group (what a double-click would select) */
    outlineParts: boolean
    /** Tint the selected meshes */
    fillTint: boolean
    /** Dim everything that is not selected */
    dimOthers: boolean
    /** Show the hint line at the bottom of the viewport (see {@link SelectionUxPlugin.getHint}) */
    showHints: boolean
    /** Lights and cameras: the new overlay (icons, aim lines, frustum), the 3D widgets of Object3DWidgetsPlugin, or both */
    objectHelpers: 'overlay' | 'widgets' | 'both'
}

export const defaultSelectionUxSettings: SelectionUxSettings = {
    visual: 'figma2d',
    boxSpace: 'local',
    emptyDrag: 'orbit',
    dragMove: 'any',
    movePlane: 'auto',
    scalePivot: 'base',
    stretchHandles: false,
    rotate: 'corners',
    rotateAxis: 'up',
    smartGuides: true,
    hover: true,
    showName: true,
    showDims: true,
    xray: true,
    marquee: 'touch',
    unit: 'cm',
    accent: '#0d99ff',
    outlineSelected: false,
    outlineHover: false,
    outlineWidth: 2,
    outlineXray: true,
    outlineParts: true,
    fillTint: false,
    dimOthers: false,
    showHints: true,
    objectHelpers: 'overlay',
}

/** A named set of settings. Built-in ones are below; more can be added with {@link SelectionUxPlugin.registerMode}. */
export interface SelectionUxMode {
    id: string
    label: string
    /** One or two characters for compact menus */
    short?: string
    description?: string
    /** Applied on top of the defaults; the person's own choices ({@link SelectionUxPlugin.PersonalKeys}) are kept */
    settings: Partial<SelectionUxSettings>
}

export const builtinSelectionUxModes: SelectionUxMode[] = [
    {id: 'figma2d', short: 'A', label: 'Figma 2D', description: 'Screen box, corner scale, rotate outside corners, hover outline', settings: {visual: 'figma2d', rotate: 'corners', rotateAxis: 'up', scalePivot: 'base', stretchHandles: false, outlineHover: true}},
    {id: 'box3d', short: 'B', label: '3D box', description: 'Line box, corner dots, face stretch, turn ring', settings: {visual: 'box3d', rotate: 'ring', scalePivot: 'opposite', stretchHandles: true, xray: true}},
    {id: 'brackets', short: 'C', label: 'Brackets', description: 'Minimal corner brackets, rotate knob', settings: {visual: 'brackets', rotate: 'knob', rotateAxis: 'up', scalePivot: 'base', stretchHandles: false, xray: false}},
    {id: 'hybrid', short: 'D', label: 'Hybrid', description: '3D box + 2D handles, side stretch, free rotate', settings: {visual: 'hybrid', rotate: 'corners', rotateAxis: 'free', scalePivot: 'base', stretchHandles: true, xray: true}},
    {id: 'outline', short: 'E', label: 'Outline', description: 'Mesh outline + part lines from the render pipeline, handles only', settings: {visual: 'minimal', rotate: 'corners', rotateAxis: 'up', scalePivot: 'base', outlineSelected: true, outlineHover: true, outlineParts: true, outlineXray: true}},
    {id: 'focus', short: 'F', label: 'Focus', description: 'Outline, dims the rest (colors of the selection stay), turn ring', settings: {visual: 'minimal', rotate: 'ring', scalePivot: 'base', outlineSelected: true, outlineHover: true, outlineParts: true, outlineXray: true, dimOthers: true}},
    {id: 'current', short: '—', label: 'Current', description: 'Existing PickingPlugin box and clicks', settings: {visual: 'legacy'}},
]

export interface SelectionUxPluginOptions {
    /** localStorage key to save and restore the settings and the mode. Off when not set. */
    persistKey?: string
    /** Modes to offer, defaults to {@link builtinSelectionUxModes} */
    modes?: SelectionUxMode[]
    /** Mode to start in when nothing is restored */
    mode?: string
    /**
     * In geometry editing, select the geometry in PickingPlugin (so an editor shows the geometry and generator UI),
     * instead of keeping the object selected.
     */
    selectGeometryInEdit?: boolean
}

export interface SelectionUxPluginEventMap extends AViewerPluginEventMap {
    /** Selection, hover or transform changed. Used by the panels. */
    uxUpdate: {reason: string}
    /** Short message for a toast */
    toast: {message: string}
}

interface BoxInfo {
    /** Maps the unit cube [-0.5, 0.5]^3 to world space */
    matrix: Matrix4
    corners: Vector3[]
    center: Vector3
    base: Vector3
    /** World length along each box axis */
    size: Vector3
    /** World unit axes of the box */
    axes: Vector3[]
}

interface ScreenPt {x: number, y: number, behind: boolean}

export interface TransformSnapshot {obj: IObject3D, position: Vector3, quaternion: Quaternion, scale: Vector3, world: Matrix4}

type HandleData =
    {kind: 'scale', pivot: Vector3} |
    {kind: 'stretch', axis: number, side: number} |
    {kind: 'rotate', axis: 'up' | 'view' | 'free', ring?: boolean} |
    {kind: 'crumb', obj: IObject3D} |
    {kind: 'icon', obj: IObject3D} |
    {kind: 'aim', obj: IObject3D} |
    {kind: 'cp', obj: IObject3D, index: number} |
    {kind: 'param', key: string}

type DragState =
    {kind: 'press', start: Vector2, leaf: IObject3D | null, hitPoint: Vector3 | null, passthrough: boolean, shift: boolean, deep: boolean, alt: boolean, target?: IObject3D} |
    {kind: 'aim', start: Vector2, obj: IObject3D, plane: Plane, snaps: TransformSnapshot[], camTarget?: Vector3} |
    {kind: 'cp', start: Vector2, obj: IObject3D, point: CurvePoint, before: number[], plane: Plane} |
    {kind: 'move', start: Vector2, hitPoint: Vector3, plane: Plane, planeKind: MovePlaneKind, baseDelta: Vector3, lastDelta: Vector3, snaps: TransformSnapshot[], startBox: Box3, others: Box3[], lockAxis: 0 | 1 | 2 | -1, viewRight: Vector3, viewUp: Vector3} |
    {kind: 'scale', start: Vector2, pivot: Vector3, pivotS: Vector2, dir: Vector2, d0: number, snaps: TransformSnapshot[]} |
    {kind: 'stretch', start: Vector2, obj: IObject3D, axis: number, pivotLocal: Vector3, pivotS: Vector2, dir: Vector2, d0: number, snaps: TransformSnapshot[], boxToObj: Matrix4} |
    {kind: 'rotate', start: Vector2, center: Vector3, axis: Vector3, centerS: Vector2, a0: number, mode: 'plane' | 'screen' | 'dx' | 'free', sign: number, snaps: TransformSnapshot[]} |
    {kind: 'marquee', start: Vector2, cur: Vector2, base: IObject3D[], candidates: IObject3D[]}

/** An editable control point of a curve in `geometry.userData.generationParams.curve` (object local space) */
interface CurvePoint {vec: {x: number, y: number, z?: number, toArray: () => number[], fromArray: (a: number[]) => void}, key: string}

/** The control points of a three.js curve: v0..v3 (lines, beziers), points[] (splines), curves[] (paths) */
function curvePoints(curve: any, prefix = ''): CurvePoint[] {
    const res: CurvePoint[] = []
    if (!curve) return res
    for (const k of ['v0', 'v1', 'v2', 'v3']) if (curve[k]?.toArray) res.push({vec: curve[k], key: prefix + k})
    if (Array.isArray(curve.points)) curve.points.forEach((p: any, i: number) => res.push({vec: p, key: prefix + 'points.' + i}))
    if (Array.isArray(curve.curves)) curve.curves.forEach((c: any, i: number) => res.push(...curvePoints(c, prefix + 'curves.' + i + '.')))
    return res
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const UNIT_CUBE: Vector3[] = Array.from({length: 8}, (_, i) => new Vector3((i & 1) - 0.5, (i >> 1 & 1) - 0.5, (i >> 2 & 1) - 0.5))
const BOX_EDGES: [number, number][] = []
for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) BOX_EDGES.push([i, i | b])

/** Keyed element pool, so elements under the pointer survive redraws (hover, cursors) */
class ElPool<T extends Element> {
    private _els = new Map<string, T>()
    private _used = new Set<string>()
    constructor(public root: Element, private _create: (tag: string) => T) {}
    begin() {
        this._used.clear()
    }
    get(key: string, tag: string, attrs: Record<string, string | number | undefined>): T {
        let e = this._els.get(key)
        if (!e || e.tagName.toLowerCase() !== tag) {
            e?.remove()
            e = this._create(tag)
            this.root.appendChild(e)
            this._els.set(key, e)
        }
        this._used.add(key)
        for (const [k, v] of Object.entries(attrs)) {
            const s = v === undefined ? null : String(v)
            if (s === null) e.removeAttribute(k)
            else if (e.getAttribute(k) !== s) e.setAttribute(k, s)
        }
        return e
    }
    end() {
        for (const [k, e] of this._els) if (!this._used.has(k)) {
            e.remove()
            this._els.delete(k)
        }
    }
}

export class SelectionUxPlugin extends AViewerPluginSync<SelectionUxPluginEventMap> {
    static readonly PluginType = 'SelectionUxPlugin'
    enabled = true
    dependencies = [PickingPlugin]

    settings: SelectionUxSettings = {...defaultSelectionUxSettings}

    /** Modes offered in menus. Use {@link registerMode} to add one. */
    modes: SelectionUxMode[]
    /** Current mode id, null when the settings were changed away from every mode */
    mode: string | null = null
    /** localStorage key for the settings and the mode, null to not save them */
    persistKey: string | null
    private _initialMode?: string

    /** Settings that belong to the person, not to a mode: they stay when the mode changes */
    static PersonalKeys: (keyof SelectionUxSettings)[] = ['emptyDrag', 'dragMove', 'unit', 'accent', 'outlineWidth', 'showHints', 'objectHelpers']

    /**
     * Replaces the hint text at the bottom of the viewport. Return HTML, or '' to show nothing.
     * Hints can also be turned off with `settings.showHints`.
     */
    hintProvider: ((ux: SelectionUxPlugin) => string) | null = null

    constructor(options: SelectionUxPluginOptions = {}) {
        super()
        this.persistKey = options.persistKey ?? null
        this.modes = [...options.modes ?? builtinSelectionUxModes]
        this._initialMode = options.mode
        this.selectGeometryInEdit = options.selectGeometryInEdit ?? false
    }

    /** The object whose geometry is being edited (Figma's vector edit), or null */
    geometryEdit: IObject3D | null = null
    selectGeometryInEdit: boolean

    /** Add a mode, or replace the one with the same id */
    registerMode(mode: SelectionUxMode) {
        const i = this.modes.findIndex(m => m.id === mode.id)
        if (i >= 0) this.modes[i] = mode
        else this.modes.push(mode)
        this._emit('settings')
    }

    unregisterMode(id: string) {
        this.modes = this.modes.filter(m => m.id !== id)
        if (this.mode === id) this.mode = null
        this._emit('settings')
    }

    setMode(id: string) {
        const m = this.modes.find(x => x.id === id)
        if (!m) return
        const personal: Partial<SelectionUxSettings> = {}
        for (const k of SelectionUxPlugin.PersonalKeys) (personal as any)[k] = this.settings[k]
        Object.assign(this.settings, defaultSelectionUxSettings, personal, m.settings)
        this.applySettings()
    }

    private _matchMode() {
        const m = this.modes.find(x => Object.entries(x.settings).every(([k, v]) => (this.settings as any)[k] === v))
        this.mode = m ? m.id : null
    }

    /** Save settings and mode to localStorage (only with {@link persistKey}) */
    save() {
        if (!this.persistKey) return
        try {
            localStorage.setItem(this.persistKey, JSON.stringify({mode: this.mode, settings: this.settings}))
        } catch (e) {
            // private mode or storage full
        }
    }

    /** Restore from localStorage (only with {@link persistKey}). Returns false when nothing was saved. */
    load(): boolean {
        if (!this.persistKey) return false
        try {
            const d = JSON.parse(localStorage.getItem(this.persistKey) || 'null')
            if (!d?.settings) return false
            Object.assign(this.settings, defaultSelectionUxSettings, d.settings)
            return true
        } catch (e) {
            return false
        }
    }

    /** Object highlighted from outside, e.g. a hovered row in a layers panel */
    externalHover: IObject3D | null = null

    /** View-only mode: selection works, nothing can be moved, scaled, grouped or deleted */
    editingLocked = false

    /** Locked objects (userData.locked on it or a parent) cannot be picked or moved in the viewport, like in Figma */
    isLocked(o: IObject3D) {
        let p: IObject3D | null = o
        while (p && p !== this._viewer?.scene.modelRoot) {
            if (p.userData.locked) return true
            p = p.parent as IObject3D | null
        }
        return false
    }

    /** Whether the current selection can be transformed */
    get canEdit() {
        return !this.editingLocked && !this.selected.some(o => this.isLocked(o))
    }

    setEditingLocked(v: boolean) {
        this.editingLocked = v
        this._emit('settings')
        this._toast(v ? 'Editing locked: select and look only' : 'Editing unlocked')
    }

    private _picking?: PickingPlugin
    private _root?: HTMLDivElement
    private _lines?: ElPool<SVGElement>
    private _handles?: ElPool<SVGElement>
    private _labels?: ElPool<HTMLElement>
    private _raycaster = new Raycaster()
    private _pointer = new Vector2()
    private _pointerInside = false
    private _pointerDirty = false
    private _hover: IObject3D | null = null
    private _state: DragState | null = null
    private _handleMap = new Map<string, HandleData>()
    private _keys = {shift: false, alt: false, ctrl: false, space: false}
    private _guides: {a: Vector3, b: Vector3}[] = []
    private _liveLabel = ''
    private _raf = 0
    private _lastExternalHover: IObject3D | null = null
    private _savedMouseButtons?: {LEFT: MOUSE, MIDDLE: MOUSE, RIGHT: MOUSE}

    // region lifecycle

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._picking = viewer.getPlugin(PickingPlugin)!

        const root = document.createElement('div')
        root.className = 'sux-overlay'
        root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;'
        const svg = document.createElementNS(SVG_NS, 'svg')
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;'
        const gLines = document.createElementNS(SVG_NS, 'g')
        const gHandles = document.createElementNS(SVG_NS, 'g')
        svg.append(gLines, gHandles)
        const labels = document.createElement('div')
        labels.style.cssText = 'position:absolute;inset:0;'
        root.append(svg, labels)
        viewer.container.appendChild(root)
        this._root = root
        this._lines = new ElPool(gLines, t => document.createElementNS(SVG_NS, t) as SVGElement)
        this._handles = new ElPool(gHandles, t => document.createElementNS(SVG_NS, t) as SVGElement)
        this._labels = new ElPool(labels, t => document.createElement(t))

        const c = viewer.container
        c.addEventListener('pointerdown', this._onPointerDown, {capture: true})
        c.addEventListener('pointermove', this._onPointerMoveInside)
        c.addEventListener('pointerleave', this._onPointerLeave)
        c.addEventListener('dblclick', this._onDblClick, {capture: true})
        window.addEventListener('pointermove', this._onPointerMove)
        window.addEventListener('pointerup', this._onPointerUp)
        window.addEventListener('pointercancel', this._onPointerUp)
        window.addEventListener('keydown', this._onKeyDown, {capture: true})
        window.addEventListener('keyup', this._onKeyUp, {capture: true})
        window.addEventListener('blur', this._onBlur)

        viewer.scene.addEventListener('sceneUpdate', this._markSpecials)
        viewer.scene.addEventListener('addSceneObject', this._markSpecials)
        this._picking.addEventListener('hitObject', this._onPickerHit)
        this._picking.addEventListener('selectedObjectChanged', this._onSelectionChanged)
        if (this.load()) this.applySettings()
        else if (this._initialMode || this.modes[0]) this.setMode(this._initialMode || this.modes[0].id)
        else this.applySettings()
        this._raf = requestAnimationFrame(this._tick)
    }

    onRemove(viewer: ThreeViewer) {
        cancelAnimationFrame(this._raf)
        const c = viewer.container
        c.removeEventListener('pointerdown', this._onPointerDown, {capture: true})
        c.removeEventListener('pointermove', this._onPointerMoveInside)
        c.removeEventListener('pointerleave', this._onPointerLeave)
        c.removeEventListener('dblclick', this._onDblClick, {capture: true})
        window.removeEventListener('pointermove', this._onPointerMove)
        window.removeEventListener('pointerup', this._onPointerUp)
        window.removeEventListener('pointercancel', this._onPointerUp)
        window.removeEventListener('keydown', this._onKeyDown, {capture: true})
        window.removeEventListener('keyup', this._onKeyUp, {capture: true})
        window.removeEventListener('blur', this._onBlur)
        viewer.scene.removeEventListener('sceneUpdate', this._markSpecials)
        viewer.scene.removeEventListener('addSceneObject', this._markSpecials)
        this._picking?.removeEventListener('hitObject', this._onPickerHit)
        this._picking?.removeEventListener('selectedObjectChanged', this._onSelectionChanged)
        this._root?.remove()
        super.onRemove(viewer)
    }

    /** Call after changing {@link settings} */
    applySettings() {
        const p = this._picking
        if (!p || !this._viewer) return
        const legacy = this.settings.visual === 'legacy' || !this.enabled
        p.widgetEnabled = legacy
        p.hoverEnabled = legacy
        const controls = this._viewer.scene.mainCamera.controls as any
        if (controls?.mouseButtons) {
            if (!this._savedMouseButtons) this._savedMouseButtons = {...controls.mouseButtons}
            // Figma-like: left-drag on empty space is the marquee, so orbit moves to the right button
            controls.mouseButtons = this.settings.emptyDrag === 'marquee' && !legacy ?
                {LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE} : {...this._savedMouseButtons}
        }
        this._root && (this._root.style.display = legacy ? 'none' : '')
        this._root?.style.setProperty('--sux-accent', this.settings.accent)
        const widgets = this._viewer.getPlugin(Object3DWidgetsPlugin)
        if (widgets) widgets.enabled = legacy || this.settings.objectHelpers !== 'overlay'
        this._matchMode()
        this.save()
        this._emit('settings')
    }

    /** The hint line for the bottom of the viewport (HTML), from {@link hintProvider} or the built-in text */
    getHint(): string {
        if (!this.settings.showHints) return ''
        if (this.hintProvider) return this.hintProvider(this)
        const st = this.settings
        const k = (s: string) => `<kbd>${s}</kbd>`
        if (st.visual === 'legacy') return 'Current behaviour: click to select, Shift/Ctrl+click to add'
        if (this.geometryEdit) return `Editing the geometry of “${this.displayName(this.geometryEdit)}” · drag the points or change the parameters · ${k('Esc')} done`
        const sel = this.selected
        if (!sel.length) {
            const nav = st.emptyDrag === 'orbit' ? `Drag empty space to orbit · ${k('Shift')}+drag to box-select` : `Drag empty space to box-select · ${k('Space')}+drag or right-drag to orbit`
            return `Click an object to select · ${nav} · ${k('?')} shortcuts`
        }
        if (!this.canEdit) return `${this.editingLocked ? 'Editing is locked' : 'Locked layer'} · ${k('Esc')} deselects`
        const L = this.levels(sel[0])
        const i = L.findIndex(l => l.includes(sel[0]))
        const hasKids = !!L[i] && L[i][L[i].length - 1].children.length > 0 && !sel[0].geometry
        return [
            st.dragMove === 'off' ? '' : 'Drag to move',
            'Corners scale',
            st.rotate === 'corners' ? 'Just outside a corner rotates' : st.rotate === 'knob' ? 'Knob rotates' : st.rotate === 'ring' ? 'Ring turns it' : '',
            hasKids ? 'Double-click to go inside' : sel[0].geometry ? `Double-click or ${k('Enter')} to edit the geometry` : '',
            i > 0 ? `${k('Esc')} selects parent` : `${k('Esc')} deselects`,
        ].filter(Boolean).join(' · ')
    }

    private get _active() {
        return this.enabled && this.settings.visual !== 'legacy' && !!this._viewer && !!this._picking?.enabled
    }

    private _emit(reason: string) {
        this.dispatchEvent({type: 'uxUpdate', reason})
    }

    private _toast(message: string) {
        this.dispatchEvent({type: 'toast', message})
    }

    // endregion

    // region selection model

    get selected(): IObject3D[] {
        return (this._picking?.getSelectedObjects() || []).filter(o => (o as IObject3D)?.isObject3D) as IObject3D[]
    }

    get hovered(): IObject3D | null {
        return this._hover
    }

    select(objs: IObject3D[], record = true) {
        const p = this._picking?.picker
        if (!p) return
        p.setSelected(objs.length ? objs.length === 1 ? objs[0] : objs as any : null, record)
    }

    private get _modelRoot(): IObject3D {
        return this._viewer!.scene.modelRoot
    }

    private _isHelper(o: IObject3D) {
        return o.assetType === 'widget' || o.userData.isWidgetRoot || o.userData.userSelectable === false || o.userData.isMultiSelectDummy ||
            (o.parent as any)?.target === o // the target child of a directional or spot light
    }

    private _contentChildren(o: IObject3D): IObject3D[] {
        return (o.children as IObject3D[]).filter(c => !this._isHelper(c))
    }

    /**
     * The levels of the hierarchy from the model root down to `node`.
     * Each level is a chain: a group with a single child is merged with that child (glTF wrappers like "Scene" > "root"),
     * so one click never selects a wrapper that looks the same as its only child.
     */
    levels(node: IObject3D): IObject3D[][] {
        const root = this._modelRoot
        const path: IObject3D[] = []
        let o: IObject3D | null = node
        while (o && o !== root) {
            path.unshift(o)
            o = o.parent as IObject3D | null
        }
        if (o !== root) return []
        const levels: IObject3D[][] = []
        let chain: IObject3D[] = []
        for (const n of path) {
            chain.push(n)
            const wrapper = !n.geometry && this._contentChildren(n).length === 1
            if (!wrapper) {
                levels.push(chain)
                chain = []
            }
        }
        if (chain.length) levels.push(chain)
        return levels
    }

    /** The object to select for a level (outermost of the chain) */
    private _rep(level: IObject3D[]) {
        return level[0]
    }

    /** The objects at the same level as the primary selection, or the top level */
    scopeObjects(): IObject3D[] {
        const primary = this.selected[0]
        let parent = this._modelRoot
        if (primary) {
            const L = this.levels(primary)
            const i = L.findIndex(l => l.includes(primary))
            if (i > 0) parent = L[i - 1][L[i - 1].length - 1]
        }
        return this._contentChildren(parent).filter(o => o.visible && this._hasContent(o))
    }

    private _hasContent(o: IObject3D) {
        let has = false
        o.traverse(c => {
            if ((c as IObject3D).geometry || (c as IObject3D).isLight || (c as IObject3D).isCamera) has = true
        })
        return has
    }

    /** Figma rules: keep the selected group, stay among siblings, else the top-level object. Deep goes to the leaf. */
    resolveTarget(leaf: IObject3D, deep: boolean, drill: boolean): IObject3D | null {
        const L = this.levels(leaf)
        if (!L.length) return null
        if (deep) return this._rep(L[L.length - 1])
        const sel = this.selected
        for (let i = L.length - 1; i >= 0; i--) {
            const s = L[i].find(n => sel.includes(n))
            if (s) return drill ? this._rep(L[Math.min(i + 1, L.length - 1)]) : s
        }
        const primary = sel[0]
        if (primary) {
            const PL = this.levels(primary)
            const pi = PL.findIndex(l => l.includes(primary))
            // same parent group as the primary selection: select the sibling under the pointer
            if (pi > 0 && L[pi - 1] && this._rep(L[pi - 1]) === this._rep(PL[pi - 1]) && L[pi]) return this._rep(L[pi])
        }
        return this._rep(L[0])
    }

    selectParent() {
        const primary = this.selected[0]
        if (!primary) return
        const L = this.levels(primary)
        const i = L.findIndex(l => l.includes(primary))
        if (i > 0) this.select([this._rep(L[i - 1])])
        else this.select([])
    }

    selectChildren() {
        const sel = this.selected
        if (!sel.length) return
        const children: IObject3D[] = []
        for (const s of sel) {
            const L = this.levels(s)
            const level = L.find(l => l.includes(s))
            const deepest = level ? level[level.length - 1] : s
            children.push(...this._contentChildren(deepest).filter(c => c.visible && this._hasContent(c)))
        }
        if (children.length) this.select(children)
    }

    selectSibling(dir: 1 | -1) {
        const primary = this.selected[0]
        const scope = this.scopeObjects()
        if (!scope.length) return
        const i = primary ? scope.indexOf(primary) : -1
        const next = scope[((i < 0 ? dir > 0 ? -1 : 0 : i) + dir + scope.length) % scope.length]
        this.select([next])
    }

    selectAllInScope() {
        const scope = this.scopeObjects()
        if (scope.length) this.select(scope)
    }

    // endregion

    // region geometry helpers

    private _camera() {
        return this._viewer!.scene.mainCamera
    }

    private _size() {
        const r = this._viewer!.container.getBoundingClientRect()
        return {w: r.width, h: r.height, left: r.left, top: r.top}
    }

    private _v4 = new Vector4()
    toScreen(v: Vector3): ScreenPt {
        const cam = this._camera()
        const {w, h} = this._size()
        const p = this._v4.set(v.x, v.y, v.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix)
        const behind = p.w <= 0
        const iw = 1 / Math.abs(p.w || 1e-6)
        return {x: (p.x * iw + 1) / 2 * w, y: (1 - p.y * iw) / 2 * h, behind}
    }

    private _rayFromScreen(sx: number, sy: number) {
        const {w, h} = this._size()
        this._raycaster.setFromCamera(new Vector2(sx / w * 2 - 1, -(sy / h) * 2 + 1), this._camera())
        return this._raycaster.ray
    }

    /** The visible leaf object under a screen point */
    raycastLeaf(sx: number, sy: number): {leaf: IObject3D, point: Vector3} | null {
        if (!this._viewer || !this._picking?.picker) return null
        this._rayFromScreen(sx, sy)
        const cam = this._camera() as any
        this._raycaster.params.Line = {threshold: this._worldPerPixel(cam.target ?? new Vector3()) * 5}
        // the 3D widgets of lights, cameras and lines stand for their object
        const roots = [this._modelRoot, ...this.settings.objectHelpers !== 'overlay' ? this._picking.picker.extraObjects : []]
        const hits = this._raycaster.intersectObjects(roots, true)
        const cond = this._picking.picker.selectionCondition
        for (const hit of hits) {
            const o = hit.object as IObject3D
            let w: any = o
            while (w && !(w.assetType === 'widget' && w.object)) w = w.parent
            if (w) {
                const t = w.object as IObject3D
                if (t.visible && !this.isLocked(t) && this.levels(t).length) return {leaf: t, point: hit.point.clone()}
                continue
            }
            if (!cond(o) || this.isLocked(o)) continue
            return {leaf: o, point: hit.point.clone()}
        }
        return null
    }

    /** Box of the object in its own frame */
    private _localBox(obj: IObject3D): Box3 {
        const box = new Box3()
        obj.updateWorldMatrix(true, true)
        const inv = obj.matrixWorld.clone().invert()
        const m = new Matrix4()
        obj.traverseVisible(c => {
            const g = (c as IObject3D).geometry
            if (!g || this._isHelper(c as IObject3D)) return
            if (!g.boundingBox) g.computeBoundingBox()
            if (!g.boundingBox) return
            m.multiplyMatrices(inv, c.matrixWorld)
            box.union(g.boundingBox.clone().applyMatrix4(m))
        })
        return box
    }

    worldBox(objs: IObject3D[]): Box3 {
        const box = new Box3()
        for (const o of objs) {
            const lb = this._localBox(o)
            if (lb.isEmpty()) box.expandByPoint(o.getWorldPosition(new Vector3()))
            else box.union(lb.applyMatrix4(o.matrixWorld))
        }
        return box
    }

    boxInfo(objs: IObject3D[], space = this.settings.boxSpace): BoxInfo {
        const m = new Matrix4()
        if (objs.length === 1 && space === 'local') {
            const o = objs[0]
            const lb = this._localBox(o)
            if (lb.isEmpty()) lb.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1).multiplyScalar(this._fallbackSize(o)))
            const size = lb.getSize(new Vector3()).max(new Vector3(1e-6, 1e-6, 1e-6))
            m.copy(o.matrixWorld).multiply(new Matrix4().compose(lb.getCenter(new Vector3()), new Quaternion(), size))
        } else {
            const wb = this.worldBox(objs)
            if (wb.isEmpty()) wb.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1))
            const size = wb.getSize(new Vector3())
            if (size.lengthSq() < 1e-12) size.setScalar(this._fallbackSize(objs[0]))
            m.compose(wb.getCenter(new Vector3()), new Quaternion(), size.max(new Vector3(1e-6, 1e-6, 1e-6)))
        }
        const corners = UNIT_CUBE.map(c => c.clone().applyMatrix4(m))
        const center = new Vector3().setFromMatrixPosition(m)
        const axes = [0, 1, 2].map(i => new Vector3().setFromMatrixColumn(m, i))
        const size = new Vector3(axes[0].length(), axes[1].length(), axes[2].length())
        axes.forEach(a => a.normalize())
        const minY = Math.min(...corners.map(c => c.y))
        const base = new Vector3(center.x, minY, center.z)
        return {matrix: m, corners, center, base, size, axes}
    }

    private _fallbackSize(o?: IObject3D) {
        // lights and empties: a small box that keeps a readable size on screen
        const cam = this._camera()
        const p = o ? o.getWorldPosition(new Vector3()) : new Vector3()
        return Math.max(1e-3, cam.position.distanceTo(p) * 0.05)
    }

    private _worldPerPixel(at: Vector3) {
        const cam = this._camera() as any
        const {h} = this._size()
        const d = cam.position.distanceTo(at)
        if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h
        return 2 * d * Math.tan((cam.fov || 45) * Math.PI / 360) / h
    }

    snapshot(objs: IObject3D[]): TransformSnapshot[] {
        return filterTopmostAncestors(objs).map(obj => {
            obj.updateWorldMatrix(true, false)
            return {obj, position: obj.position.clone(), quaternion: obj.quaternion.clone(), scale: obj.scale.clone(), world: obj.matrixWorld.clone()}
        })
    }

    private _restore(snaps: {obj: IObject3D, position: Vector3, quaternion: Quaternion, scale: Vector3}[]) {
        for (const s of snaps) {
            s.obj.position.copy(s.position)
            s.obj.quaternion.copy(s.quaternion)
            s.obj.scale.copy(s.scale)
            s.obj.updateMatrixWorld(true)
            s.obj.setDirty?.({change: 'transform', frameFade: false})
        }
        this._viewer?.setDirty()
        this._emit('transform')
    }

    /** Apply a world-space matrix on top of the snapshot transforms */
    transformSnaps(snaps: TransformSnapshot[], m: Matrix4) {
        for (const sn of snaps) this._setWorld(sn.obj, m.clone().multiply(sn.world))
        this._viewer?.setDirty()
        this._emit('transform')
    }

    private _setWorld(obj: IObject3D, world: Matrix4) {
        const local = world.clone()
        if (obj.parent) {
            obj.parent.updateWorldMatrix(true, false)
            local.premultiply(obj.parent.matrixWorld.clone().invert())
        }
        local.decompose(obj.position, obj.quaternion, obj.scale)
        obj.updateMatrixWorld(true)
        obj.setDirty?.({change: 'transform', frameFade: false})
    }

    /** Record an undo step that goes back to `before` */
    recordTransform(before: TransformSnapshot[], label: string) {
        const after = before.map(s => ({obj: s.obj, position: s.obj.position.clone(), quaternion: s.obj.quaternion.clone(), scale: s.obj.scale.clone()}))
        const changed = before.some((s, i) => !s.position.equals(after[i].position) || !s.quaternion.equals(after[i].quaternion) || !s.scale.equals(after[i].scale))
        if (!changed) return
        const um = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        um?.record({
            undo: () => this._restore(before),
            redo: () => this._restore(after),
        })
        this._emit(label)
    }

    // endregion

    // region pointer

    private _onPickerHit = (e: any) => {
        // this plugin owns clicks; PickingPlugin keeps the state
        if (this._active) e.intersects.consumed = true
    }

    private _onSelectionChanged = () => {
        const g = this.geometryEdit
        const v = this._picking?.picker?.selectedObject
        if (g && v !== g && v !== g.geometry) {
            this.geometryEdit = null
            this._buildParamsPanel()
        }
        this._emit('selection')
    }

    private _local(e: PointerEvent | MouseEvent) {
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
        // the camera controls prevent default, so a text field keeps focus and gets Ctrl+Z. Move focus to the scene.
        const ae = document.activeElement as HTMLElement | null
        if (ae && ae !== document.body && ae !== this._viewer?.canvas && (e.target as Element)?.closest?.('.sux-overlay, canvas')) ae.blur()
        if (!this._active || e.isPrimary === false) return
        this._syncMods(e)
        const p = this._local(e)
        this._pointer.copy(p)
        const target = e.target as Element
        const hk = target?.getAttribute?.('data-sux')
        if (hk && e.button === 0) {
            const data = this._handleMap.get(hk)
            if (data?.kind === 'icon') { // light or camera icon: click selects, drag moves
                e.stopPropagation()
                e.preventDefault()
                this._state = {kind: 'press', start: p, leaf: null, hitPoint: data.obj.getWorldPosition(new Vector3()), passthrough: false, shift: e.shiftKey, deep: false, alt: e.altKey, target: data.obj}
                return
            }
            if (data?.kind === 'param') return // inputs in the parameters panel
            if (data && (data.kind === 'crumb' || this.canEdit)) {
                e.stopPropagation()
                e.preventDefault()
                this._startHandleDrag(data, p)
                return
            }
        }
        if (target !== this._viewer!.canvas) return
        if (e.button !== 0) return
        const navigate = this._keys.space || this.settings.emptyDrag === 'marquee' && e.altKey
        if (navigate) return // orbit with the camera controls
        const hit = this.raycastLeaf(p.x, p.y)
        const deep = e.ctrlKey || e.metaKey
        if (hit) {
            const tgt = this.resolveTarget(hit.leaf, deep, false)
            const sel = this.selected
            const canMove = !this.editingLocked && (this.settings.dragMove === 'any' || this.settings.dragMove === 'selected' && !!tgt && sel.includes(tgt))
            this._state = {kind: 'press', start: p, leaf: hit.leaf, hitPoint: hit.point, passthrough: !canMove, shift: e.shiftKey, deep, alt: e.altKey}
            if (canMove) e.stopPropagation()
        } else {
            const marquee = this.settings.emptyDrag === 'marquee' || e.shiftKey
            this._state = {kind: 'press', start: p, leaf: null, hitPoint: null, passthrough: !marquee, shift: e.shiftKey, deep, alt: e.altKey}
            if (marquee) e.stopPropagation()
        }
    }

    private _onPointerMove = (e: PointerEvent) => {
        if (!this._active || e.isPrimary === false) return
        this._syncMods(e)
        const p = this._local(e)
        this._pointer.copy(p)
        this._pointerDirty = true
        const s = this._state
        if (!s) return
        if (s.kind === 'press') {
            if (s.start.distanceTo(p) < 4) return
            if (s.passthrough) { // camera is orbiting
                this._state = null
                return
            }
            if (s.leaf || s.target) {
                if (this.editingLocked) {
                    this._state = null
                    return
                }
                this._beginMove(s)
            } else this._beginMarquee(s)
        }
        this._updateDrag(p)
    }

    private _onPointerUp = (e: PointerEvent) => {
        if (!this._active || e.isPrimary === false) return
        const s = this._state
        this._state = null
        this._guides = []
        this._liveLabel = ''
        if (!s) return
        if (s.kind === 'press') this._click(s)
        else this._endDrag(s)
        this._pointerDirty = true
    }

    private _onDblClick = (e: MouseEvent) => {
        if (!this._active || e.target !== this._viewer?.canvas) return
        const p = this._local(e)
        const hit = this.raycastLeaf(p.x, p.y)
        if (!hit) return
        const tgt = this.resolveTarget(hit.leaf, false, true)
        const sel = this.selected
        // already at the deepest level: go from object to geometry editing, like Figma's vector edit
        if (tgt && sel.length === 1 && sel[0] === tgt && this._canEditGeometry(tgt)) this.enterGeometryEdit(tgt)
        else if (tgt) {
            this.select([tgt])
            this._toast(`Selected “${this.displayName(tgt)}” — Esc to go back up`)
        }
        e.stopPropagation()
    }

    private _click(s: Extract<DragState, {kind: 'press'}>) {
        if (!s.leaf && !s.target) {
            if (!s.shift) this.select([])
            return
        }
        const tgt = s.target ?? this.resolveTarget(s.leaf!, s.deep, false)
        if (!tgt) return
        const sel = this.selected
        if (s.shift) {
            const i = sel.indexOf(tgt)
            const next = [...sel]
            if (i >= 0) next.splice(i, 1)
            else next.unshift(tgt)
            this.select(next)
        } else if (!(sel.length === 1 && sel[0] === tgt)) {
            this.select([tgt])
        }
    }

    private _beginMove(s: Extract<DragState, {kind: 'press'}>) {
        let tgt = s.target ?? this.resolveTarget(s.leaf!, s.deep, false)
        if (!tgt) return
        let sel = this.selected
        if (!sel.includes(tgt)) {
            sel = s.shift ? [tgt, ...sel] : [tgt]
            this.select(sel)
        }
        if (s.alt) { // alt-drag duplicates, like Figma
            const res = duplicateObjects(sel)
            if (res.clones.length) {
                const um = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
                const prev = [...sel]
                um?.record({undo: () => {
                    res.undo()
                    this.select(prev, false)
                }, redo: () => {
                    res.redo()
                    this.select(res.clones, false)
                }})
                sel = res.clones
                tgt = sel[0]
                this.select(sel, false)
                this._toast(`Duplicated ${sel.length} object${sel.length > 1 ? 's' : ''}`)
            }
        }
        const cam = this._camera()
        const camDir = cam.getWorldDirection(new Vector3())
        const hit = s.hitPoint!.clone()
        let mode = this.settings.movePlane
        // the floor only when looking down at it from above; from below or the side, move facing the camera
        // from the side: the axis-aligned wall that faces the camera most
        if (mode === 'auto') mode = camDir.y < -0.3 && cam.getWorldPosition(new Vector3()).y > hit.y ? 'ground' : Math.abs(camDir.z) >= Math.abs(camDir.x) ? 'xy' : 'yz'
        const planeKind: MovePlaneKind = mode
        const plane = this._movePlane(planeKind, hit)
        const viewRight = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize()
        const viewUp = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize()
        const snaps = this.snapshot(sel)
        const selSet = new Set(sel)
        const others: Box3[] = []
        if (this.settings.smartGuides) {
            const candidates = new Set<IObject3D>([...this._contentChildren(this._modelRoot), ...this.scopeObjects()])
            for (const o of candidates) {
                let related = false
                for (const so of sel) {
                    let a: IObject3D | null = so
                    while (a) {
                        if (a === o) related = true
                        a = a.parent as IObject3D | null
                    }
                    o.traverse(c => {
                        if (c === so) related = true
                    })
                }
                if (related || selSet.has(o) || !o.visible) continue
                const b = this.worldBox([o])
                if (!b.isEmpty()) others.push(b)
            }
        }
        this._state = {kind: 'move', start: s.start, hitPoint: hit, plane, planeKind, baseDelta: new Vector3(), lastDelta: new Vector3(), snaps, startBox: this.worldBox(sel), others, lockAxis: -1, viewRight, viewUp}
        this._viewer!.canvas.style.cursor = 'move'
    }

    private _movePlane(kind: MovePlaneKind, through: Vector3) {
        const n = kind === 'ground' ? new Vector3(0, 1, 0) : kind === 'xy' ? new Vector3(0, 0, 1) : kind === 'yz' ? new Vector3(1, 0, 0) : this._camera().getWorldDirection(new Vector3()).negate()
        return new Plane().setFromNormalAndCoplanarPoint(n, through)
    }

    /** Two unit vectors that span the plane */
    private _planeAxes(kind: MovePlaneKind): [Vector3, Vector3] {
        if (kind === 'ground') return [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]
        if (kind === 'xy') return [new Vector3(1, 0, 0), new Vector3(0, 1, 0)]
        if (kind === 'yz') return [new Vector3(0, 0, 1), new Vector3(0, 1, 0)]
        const m = this._camera().matrixWorld
        return [new Vector3().setFromMatrixColumn(m, 0).normalize(), new Vector3().setFromMatrixColumn(m, 1).normalize()]
    }

    /** World axis that the plane does not move along, -1 for the camera plane */
    private _normalAxis(kind: MovePlaneKind) {
        return kind === 'ground' ? 1 : kind === 'xy' ? 2 : kind === 'yz' ? 0 : -1
    }

    static readonly PlaneLabels: Record<MovePlaneKind, string> = {
        ground: 'On the floor (XZ)',
        xy: 'On the front wall (XY)',
        yz: 'On the side wall (YZ)',
        view: 'Facing you',
    }

    /** Tab while moving: continue on the other plane from where the object is now */
    private _switchMovePlane() {
        const s = this._state
        if (s?.kind !== 'move') return
        s.hitPoint = s.hitPoint.clone().add(s.lastDelta).sub(s.baseDelta)
        s.baseDelta.copy(s.lastDelta)
        const order: MovePlaneKind[] = ['ground', 'xy', 'yz', 'view']
        s.planeKind = order[(order.indexOf(s.planeKind) + 1) % order.length]
        s.plane = this._movePlane(s.planeKind, s.hitPoint)
        s.lockAxis = -1
        this._updateDrag(this._pointer)
    }

    private _beginMarquee(s: Extract<DragState, {kind: 'press'}>) {
        this._state = {kind: 'marquee', start: s.start, cur: s.start.clone(), base: s.shift ? this.selected : [], candidates: this.scopeObjects()}
    }

    private _startHandleDrag(data: HandleData, p: Vector2) {
        const sel = this.selected
        if (data.kind === 'crumb') {
            this.select([data.obj])
            return
        }
        if (data.kind === 'aim') {
            const o = data.obj
            const aim = this._aimPoint(o)
            const cam = this._camera()
            const camDir = cam.getWorldDirection(new Vector3())
            // aim on the floor (at the aim height) when looking down at it, else on a plane facing the camera
            const plane = camDir.y < -0.3 ? new Plane(new Vector3(0, 1, 0), -aim.y) : new Plane().setFromNormalAndCoplanarPoint(camDir.negate(), aim)
            this._state = {kind: 'aim', start: p, obj: o, plane, snaps: this.snapshot([o]), camTarget: (o as any).isCamera && (o as any).target?.isVector3 ? (o as any).target.clone() : undefined}
            return
        }
        if (data.kind === 'cp') {
            const pts = curvePoints(genParams(data.obj)?.curve)
            const pt = pts[data.index]
            if (!pt) return
            const world = this._cpWorld(data.obj, pt)
            const camDir = this._camera().getWorldDirection(new Vector3())
            this._state = {kind: 'cp', start: p, obj: data.obj, point: pt, before: pt.vec.toArray(), plane: new Plane().setFromNormalAndCoplanarPoint(camDir.negate(), world)}
            return
        }
        if (!sel.length) return
        const snaps = this.snapshot(sel)
        if (data.kind === 'scale') {
            const info = this.boxInfo(sel)
            const pivot = this._keys.alt ? info.center.clone() : data.pivot.clone()
            let ps = this.toScreen(pivot)
            let dir = new Vector2(p.x - ps.x, p.y - ps.y)
            if (dir.length() < 12) { // pivot under the pointer: measure from the center instead
                ps = this.toScreen(info.center)
                dir = new Vector2(p.x - ps.x, p.y - ps.y)
            }
            const d0 = Math.max(1, dir.length())
            this._state = {kind: 'scale', start: p, pivot, pivotS: new Vector2(ps.x, ps.y), dir: dir.normalize(), d0, snaps}
        } else if (data.kind === 'stretch') {
            const obj = sel[0]
            const lb = this._localBox(obj)
            if (lb.isEmpty()) return
            const size = lb.getSize(new Vector3())
            const center = lb.getCenter(new Vector3())
            const pivotLocal = center.clone()
            pivotLocal.setComponent(data.axis, center.getComponent(data.axis) - data.side * size.getComponent(data.axis) / 2)
            const faceLocal = center.clone()
            faceLocal.setComponent(data.axis, center.getComponent(data.axis) + data.side * size.getComponent(data.axis) / 2)
            const pw = pivotLocal.clone().applyMatrix4(obj.matrixWorld)
            const fw = faceLocal.clone().applyMatrix4(obj.matrixWorld)
            const ps = this.toScreen(pw)
            const fs = this.toScreen(fw)
            const dir = new Vector2(fs.x - ps.x, fs.y - ps.y)
            if (dir.length() < 2) return
            dir.normalize()
            const d0 = Math.max(1, new Vector2(p.x - ps.x, p.y - ps.y).dot(dir))
            this._state = {kind: 'stretch', start: p, obj, axis: data.axis, pivotLocal, pivotS: new Vector2(ps.x, ps.y), dir, d0, snaps, boxToObj: new Matrix4()}
        } else if (data.kind === 'rotate') {
            const info = this.boxInfo(sel, 'world')
            const cam = this._camera()
            const camDir = cam.getWorldDirection(new Vector3())
            const axisMode: 'up' | 'view' | 'free' = data.ring ? 'up' : data.axis
            const center = axisMode === 'up' ? info.base.clone().setY(info.center.y) : info.center.clone()
            const cs = this.toScreen(center)
            const centerS = new Vector2(cs.x, cs.y)
            if (axisMode === 'free') {
                // horizontal drag turns around up (front follows the pointer), vertical drag tilts around the screen x axis
                const toCam = cam.position.clone().sub(center).setY(0)
                if (toCam.lengthSq() < 1e-9) toCam.set(0, 0, 1)
                toCam.normalize().multiplyScalar(Math.max(info.size.x, info.size.z) / 2 || 1)
                const f0 = this.toScreen(center.clone().add(toCam))
                const f1 = this.toScreen(center.clone().add(toCam.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.05)))
                const sign = Math.sign(f1.x - f0.x) || 1
                const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize()
                this._state = {kind: 'rotate', start: p, center: info.center.clone(), axis: right, centerS, a0: 0, mode: 'free', sign, snaps}
            } else if (axisMode === 'view') {
                const a0 = Math.atan2(p.y - cs.y, p.x - cs.x)
                this._state = {kind: 'rotate', start: p, center, axis: camDir.clone().negate(), centerS, a0, mode: 'screen', sign: -1, snaps}
            } else if (Math.abs(camDir.y) > 0.2) {
                const hp = this._planeHit(p, new Plane(new Vector3(0, 1, 0), -center.y))
                const a0 = hp ? Math.atan2(hp.z - center.z, hp.x - center.x) : 0
                this._state = {kind: 'rotate', start: p, center, axis: new Vector3(0, 1, 0), centerS, a0, mode: hp ? 'plane' : 'dx', sign: 1, snaps}
            } else {
                // looking from the side: horizontal drag turns the object, front follows the pointer
                const toCam = cam.position.clone().sub(center).setY(0).normalize().multiplyScalar(Math.max(info.size.x, info.size.z) / 2 || 1)
                const f0 = this.toScreen(center.clone().add(toCam))
                const f1 = this.toScreen(center.clone().add(toCam.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.05)))
                const sign = Math.sign(f1.x - f0.x) || 1
                this._state = {kind: 'rotate', start: p, center, axis: new Vector3(0, 1, 0), centerS, a0: 0, mode: 'dx', sign, snaps}
            }
        }
    }

    private _planeHit(p: Vector2, plane: Plane) {
        const ray = this._rayFromScreen(p.x, p.y)
        return ray.intersectPlane(plane, new Vector3())
    }

    private _updateDrag(p: Vector2) {
        const s = this._state
        if (!s || !this._viewer) return
        if (s.kind === 'move') this._updateMove(s, p)
        else if (s.kind === 'scale') {
            let f = new Vector2(p.x - s.pivotS.x, p.y - s.pivotS.y).dot(s.dir) / s.d0
            f = Math.max(0.01, f)
            if (this._keys.shift) f = Math.max(0.05, Math.round(f * 20) / 20)
            else if (Math.abs(f - 1) < 0.02) f = 1
            const m = new Matrix4().makeTranslation(s.pivot.x, s.pivot.y, s.pivot.z)
                .multiply(new Matrix4().makeScale(f, f, f))
                .multiply(new Matrix4().makeTranslation(-s.pivot.x, -s.pivot.y, -s.pivot.z))
            for (const sn of s.snaps) this._setWorld(sn.obj, m.clone().multiply(sn.world))
            this._liveLabel = `×${f.toFixed(2)}`
        } else if (s.kind === 'stretch') {
            let f = new Vector2(p.x - s.pivotS.x, p.y - s.pivotS.y).dot(s.dir) / s.d0
            f = Math.max(0.01, f)
            // Shift keeps the proportions, like in Figma
            const uniform = this._keys.shift
            const sc = uniform ? new Vector3(f, f, f) : new Vector3(1, 1, 1).setComponent(s.axis, f)
            const pl = s.pivotLocal
            const m = new Matrix4().makeTranslation(pl.x, pl.y, pl.z)
                .multiply(new Matrix4().makeScale(sc.x, sc.y, sc.z))
                .multiply(new Matrix4().makeTranslation(-pl.x, -pl.y, -pl.z))
            const sn = s.snaps.find(x => x.obj === s.obj) || s.snaps[0]
            this._setWorld(sn.obj, sn.world.clone().multiply(m))
            this._liveLabel = uniform ? `uniform ×${f.toFixed(2)}` : `${'XYZ'[s.axis]} ×${f.toFixed(2)} · Shift: uniform`
        } else if (s.kind === 'rotate' && s.mode === 'free') {
            const k = Math.PI * 2 / 500
            let yaw = s.sign * (p.x - s.start.x) * k
            let pitch = (p.y - s.start.y) * k
            const step = Math.PI / 12
            if (this._keys.shift) {
                yaw = Math.round(yaw / step) * step
                pitch = Math.round(pitch / step) * step
            }
            const c = s.center
            const m = new Matrix4().makeTranslation(c.x, c.y, c.z)
                .multiply(new Matrix4().makeRotationAxis(s.axis, pitch))
                .multiply(new Matrix4().makeRotationAxis(new Vector3(0, 1, 0), yaw))
                .multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z))
            for (const sn of s.snaps) this._setWorld(sn.obj, m.clone().multiply(sn.world))
            this._liveLabel = `turn ${Math.round(yaw * 180 / Math.PI)}° · tilt ${Math.round(pitch * 180 / Math.PI)}°`
        } else if (s.kind === 'rotate') {
            let a = 0
            if (s.mode === 'screen') a = s.sign * (Math.atan2(p.y - s.centerS.y, p.x - s.centerS.x) - s.a0)
            else if (s.mode === 'plane') {
                const hp = this._planeHit(p, new Plane(new Vector3(0, 1, 0), -s.center.y))
                if (hp) a = -(Math.atan2(hp.z - s.center.z, hp.x - s.center.x) - s.a0)
            } else a = s.sign * (p.x - s.start.x) * Math.PI * 2 / 500
            a = Math.atan2(Math.sin(a), Math.cos(a))
            const step = Math.PI / 12
            if (this._keys.shift) a = Math.round(a / step) * step
            const c = s.center
            const m = new Matrix4().makeTranslation(c.x, c.y, c.z)
                .multiply(new Matrix4().makeRotationAxis(s.axis, a))
                .multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z))
            for (const sn of s.snaps) this._setWorld(sn.obj, m.clone().multiply(sn.world))
            this._liveLabel = `${Math.round(a * 180 / Math.PI)}°`
        } else if (s.kind === 'marquee') {
            s.cur.copy(p)
            this._updateMarquee(s)
        } else if (s.kind === 'aim') {
            const hp = this._planeHit(p, s.plane)
            if (hp) this._setAim(s.obj, hp)
        } else if (s.kind === 'cp') {
            const hp = this._planeHit(p, s.plane)
            if (hp) {
                const local = s.obj.worldToLocal(hp.clone())
                const arr = s.point.vec.toArray()
                s.point.vec.fromArray(arr.length === 2 ? [local.x, local.y] : [local.x, local.y, local.z])
                s.obj.geometry?.setDirty?.({regenerate: true} as any)
                this._liveLabel = `${s.point.key}: ${local.toArray().map(v => this._fmt(v)).join(', ')}`
            }
        }
        this._viewer.setDirty()
        this._emit('drag')
    }

    private _updateMove(s: Extract<DragState, {kind: 'move'}>, p: Vector2) {
        const hp = this._planeHit(p, s.plane)
        if (!hp) return
        const delta = hp.sub(s.hitPoint).add(s.baseDelta)
        // keep grazing-angle drags from shooting to the horizon
        const maxD = Math.max(s.startBox.getSize(new Vector3()).length(), 1e-3) * 50
        if (delta.length() > maxD) delta.setLength(maxD)
        if (this._keys.shift) {
            const na = this._normalAxis(s.planeKind)
            if (na >= 0) {
                // the two world axes of the plane: keep the one moved most
                const [a0, a1] = [0, 1, 2].filter(i => i !== na) as [0 | 1 | 2, 0 | 1 | 2]
                if (s.lockAxis < 0 && delta.length() > this._worldPerPixel(s.hitPoint) * 6) s.lockAxis = Math.abs(delta.getComponent(a0)) > Math.abs(delta.getComponent(a1)) ? a0 : a1
                if (s.lockAxis === a0) delta.setComponent(a1, 0)
                else if (s.lockAxis === a1) delta.setComponent(a0, 0)
            } else {
                const r = delta.dot(s.viewRight), u = delta.dot(s.viewUp)
                delta.copy(Math.abs(r) > Math.abs(u) ? s.viewRight.clone().multiplyScalar(r) : s.viewUp.clone().multiplyScalar(u))
            }
        } else s.lockAxis = -1
        this._guides = []
        if (this.settings.smartGuides && !this._keys.ctrl) this._snapMove(s, delta)
        for (const sn of s.snaps) {
            const m = new Matrix4().makeTranslation(delta.x, delta.y, delta.z).multiply(sn.world)
            this._setWorld(sn.obj, m)
        }
        s.lastDelta.copy(delta)
        const u = this._unitScale()
        this._liveLabel = `${SelectionUxPlugin.PlaneLabels[s.planeKind]} · Tab: switch   Δ ${this._fmt(delta.x * u)}, ${this._fmt(delta.y * u)}, ${this._fmt(delta.z * u)} ${this._unitLabel()}`
    }

    /** Snap the moving box edges/centers to other objects on x and z (and to the floor on y) */
    private _snapMove(s: Extract<DragState, {kind: 'move'}>, delta: Vector3) {
        const box = s.startBox.clone().translate(delta)
        const center = box.getCenter(new Vector3())
        const th = this._worldPerPixel(center) * 7
        const vals = (b: Box3, axis: number) => [b.min.getComponent(axis), (b.min.getComponent(axis) + b.max.getComponent(axis)) / 2, b.max.getComponent(axis)]
        for (const axis of [0, 2, 1]) {
            if (s.lockAxis >= 0 && s.lockAxis !== axis) continue
            if (axis === this._normalAxis(s.planeKind)) continue // the plane keeps this coordinate
            const mine = vals(box, axis)
            let best: {d: number, other: Box3 | null, v: number} | null = null
            const targets: {b: Box3 | null, v: number[]}[] = s.others.map(b => ({b, v: vals(b, axis)}))
            targets.push({b: null, v: [0]}) // world origin / floor
            for (const t of targets) for (const v of t.v) for (const m of mine) {
                const d = v - m
                if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = {d, other: t.b, v}
            }
            if (!best) continue
            delta.setComponent(axis, delta.getComponent(axis) + best.d)
            box.translate(new Vector3().setComponent(axis, best.d))
            // guide line from the moving box to the target, along the other ground axis
            const o = best.other
            if (axis === 1) {
                const y = best.v
                this._guides.push({a: new Vector3(box.min.x, y, box.max.z), b: new Vector3(box.max.x, y, box.max.z)})
                continue
            }
            const other = axis === 0 ? 2 : 0
            const lo = Math.min(box.min.getComponent(other), o ? o.min.getComponent(other) : 0)
            const hi = Math.max(box.max.getComponent(other), o ? o.max.getComponent(other) : 0)
            const y = Math.min(box.min.y, o ? o.min.y : box.min.y)
            const a = new Vector3().setComponent(axis, best.v).setComponent(other, lo).setY(y)
            const b = new Vector3().setComponent(axis, best.v).setComponent(other, hi).setY(y)
            this._guides.push({a, b})
        }
    }

    private _updateMarquee(s: Extract<DragState, {kind: 'marquee'}>) {
        const minX = Math.min(s.start.x, s.cur.x), maxX = Math.max(s.start.x, s.cur.x)
        const minY = Math.min(s.start.y, s.cur.y), maxY = Math.max(s.start.y, s.cur.y)
        const picked: IObject3D[] = []
        for (const o of s.candidates) {
            const r = this._screenRect(this.boxInfo([o], 'local').corners)
            if (!r) continue
            const inside = r.minX >= minX && r.maxX <= maxX && r.minY >= minY && r.maxY <= maxY
            const touch = r.maxX >= minX && r.minX <= maxX && r.maxY >= minY && r.minY <= maxY
            if (this.settings.marquee === 'contain' ? inside : touch) picked.push(o)
        }
        const next = [...s.base]
        for (const o of picked) if (!next.includes(o)) next.push(o)
        this.select(next, false)
    }

    private _endDrag(s: DragState) {
        const um = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        if (s.kind === 'aim') {
            if (s.camTarget) {
                const o = s.obj as any, before = s.camTarget.clone(), after = o.target.clone()
                um?.record({undo: () => this._setAim(o, before), redo: () => this._setAim(o, after)})
            } else this.recordTransform(s.snaps, 'aim')
        } else if (s.kind === 'cp') {
            const pt = s.point, g = s.obj.geometry, before = s.before, after = pt.vec.toArray()
            const set = (a: number[]) => {
                pt.vec.fromArray(a)
                g?.setDirty?.({regenerate: true} as any)
                this._viewer?.setDirty()
            }
            um?.record({undo: () => set(before), redo: () => set(after)})
        } else if (s.kind === 'move' || s.kind === 'scale' || s.kind === 'stretch' || s.kind === 'rotate') {
            this.recordTransform(s.snaps, s.kind)
        } else if (s.kind === 'marquee') {
            const final = this.selected
            const before = s.base
            if (final.length !== before.length || final.some((o, i) => o !== before[i])) um?.record({
                undo: () => this.select(before, false),
                redo: () => this.select(final, false),
            })
        }
        this._viewer?.setDirty()
    }

    // endregion

    // region keyboard

    private _syncMods(e: {shiftKey: boolean, altKey: boolean, ctrlKey: boolean, metaKey: boolean}) {
        this._keys.shift = e.shiftKey
        this._keys.alt = e.altKey
        this._keys.ctrl = e.ctrlKey || e.metaKey
    }

    private _onBlur = () => {
        this._keys = {shift: false, alt: false, ctrl: false, space: false}
    }

    private _onKeyUp = (e: KeyboardEvent) => {
        this._syncMods(e)
        if (e.code === 'Space') this._keys.space = false
        if (e.code.startsWith('Arrow') && this._nudgeUndo) this._nudgeUndo.final = true
        this._pointerDirty = true
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        this._syncMods(e)
        this._pointerDirty = true
        if (!this._active) return
        const t = e.target as HTMLElement
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        // a focused list (the layers panel) uses the arrow keys itself, like in Figma
        if (e.code.startsWith('Arrow') && t?.closest?.('[data-own-arrows]')) return
        const ctrl = e.ctrlKey || e.metaKey
        const own = () => {
            e.preventDefault()
            e.stopPropagation()
        }
        if (e.code === 'Space') {
            if (!this._keys.space) this._toast('Space held: drag to orbit')
            this._keys.space = true
            own()
            return
        }
        const sel = this.selected
        if (e.code === 'Tab' && this._state?.kind === 'move') {
            own()
            this._switchMovePlane()
            return
        }
        const editKey = ctrl && ['KeyD', 'KeyX', 'KeyV', 'KeyG'].includes(e.code) || ['Delete', 'Backspace'].includes(e.code) || e.code.startsWith('Arrow') && !ctrl
        if (editKey && sel.length && !this.canEdit) {
            own()
            this._toast(this.editingLocked ? 'Editing is locked' : 'The selection is locked')
            return
        }
        if (e.code === 'Escape') {
            own()
            if (this._state) { // cancel the drag
                const s = this._state
                if ('snaps' in s) this._restore(s.snaps)
                this._state = null
                this._guides = []
                return
            }
            if (this.geometryEdit) this.exitGeometryEdit()
            else this.selectParent()
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            own()
            if (e.shiftKey) this.selectParent()
            else if (sel.length === 1 && !this._contentChildren(sel[0]).length && this._canEditGeometry(sel[0])) this.enterGeometryEdit(sel[0])
            else this.selectChildren()
        } else if (e.code === 'Tab') {
            own()
            this.selectSibling(e.shiftKey ? -1 : 1)
        } else if (ctrl && e.code === 'KeyA') {
            own()
            this.selectAllInScope()
        } else if (ctrl && e.code === 'KeyG') {
            own()
            if (e.shiftKey) this.ungroupSelected()
            else this.groupSelected()
        } else if (e.shiftKey && e.code === 'Digit1') {
            own()
            this._viewer!.fitToView(undefined, 1.25, 800, 'easeOut')
        } else if (e.shiftKey && e.code === 'Digit2') {
            own()
            if (sel.length) this._viewer!.fitToView(sel, 1.25, 800, 'easeOut')
        } else if (e.code.startsWith('Arrow') && sel.length && !ctrl) {
            own()
            this.nudge(e.code, e.shiftKey, e.altKey)
        }
    }

    /** Arrow keys move along the world axis closest to the screen direction. Alt+Up/Down moves vertically. */
    nudge(code: string, big: boolean, vertical: boolean) {
        const sel = this.selected
        if (!sel.length) return
        const info = this.boxInfo(sel, 'world')
        const maxS = Math.max(info.size.x, info.size.y, info.size.z) || 1
        let step = Math.pow(10, Math.floor(Math.log10(maxS / 10)))
        if (big) step *= 10
        const cam = this._camera()
        const snapAxis = (v: Vector3) => {
            v.y = 0
            return Math.abs(v.x) > Math.abs(v.z) ? new Vector3(Math.sign(v.x), 0, 0) : new Vector3(0, 0, Math.sign(v.z))
        }
        const right = snapAxis(new Vector3().setFromMatrixColumn(cam.matrixWorld, 0))
        const fwd = snapAxis(cam.getWorldDirection(new Vector3()))
        let d = new Vector3()
        if (vertical && (code === 'ArrowUp' || code === 'ArrowDown')) d.set(0, code === 'ArrowUp' ? 1 : -1, 0)
        else if (code === 'ArrowRight') d = right
        else if (code === 'ArrowLeft') d = right.negate()
        else if (code === 'ArrowUp') d = fwd
        else if (code === 'ArrowDown') d = fwd.negate()
        d.multiplyScalar(step)
        const snaps = this.snapshot(sel)
        for (const sn of snaps) this._setWorld(sn.obj, new Matrix4().makeTranslation(d.x, d.y, d.z).multiply(sn.world))
        this._recordNudge(snaps)
        this._viewer?.setDirty()
        this._emit('transform')
    }

    private _nudgeUndo?: {cmd: {undo: () => void, redo: () => void}, time: number, key: string, before: TransformSnapshot[], final: boolean}

    /**
     * Nudges while a key is held (or pressed again quickly) become one undo step, like the value edits in
     * UndoManagerPlugin: the last step is replaced while it is recent and not final. Key up makes it final.
     */
    private _recordNudge(snaps: TransformSnapshot[]) {
        const um = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        if (!um) return
        const key = snaps.map(sn => sn.obj.uuid).join()
        const now = performance.now()
        const after = snaps.map(sn => ({obj: sn.obj, position: sn.obj.position.clone(), quaternion: sn.obj.quaternion.clone(), scale: sn.obj.scale.clone()}))
        const last = this._nudgeUndo
        const merge = last && !last.final && last.key === key && um.peek() === last.cmd && now - last.time < 1000
        const before = merge ? last.before : snaps
        const cmd = {undo: () => this._restore(before), redo: () => this._restore(after)}
        if (merge) um.replaceLast(cmd)
        else um.record(cmd)
        this._nudgeUndo = {cmd, time: now, key, before, final: false}
    }

    groupSelected() {
        const sel = filterTopmostAncestors(this.selected)
        if (!sel.length || !this._viewer) return
        const parent = (sel[0].parent || this._modelRoot) as IObject3D
        const index = parent.children.indexOf(sel[0])
        const info = this.boxInfo(sel, 'world')
        const group = new Group2()
        group.name = 'Group ' + ++SelectionUxPlugin._groupCount
        parent.add(group)
        parent.children.splice(parent.children.indexOf(group), 1)
        parent.children.splice(index, 0, group)
        parent.updateWorldMatrix(true, false)
        group.position.copy(parent.worldToLocal(info.base.clone()))
        group.updateMatrixWorld(true)
        const prev = sel.map(o => ({obj: o, parent: o.parent!, index: o.parent!.children.indexOf(o)}))
        const doGroup = () => {
            if (!group.parent) parent.add(group)
            for (const o of sel) group.attach(o)
            this._sceneChanged()
            this.select([group], false)
        }
        const undoGroup = () => {
            for (const p of [...prev].reverse()) {
                p.parent.attach(p.obj)
                const ch = p.parent.children
                ch.splice(ch.indexOf(p.obj), 1)
                ch.splice(Math.min(p.index, ch.length), 0, p.obj)
            }
            group.removeFromParent()
            this._sceneChanged()
            this.select(sel, false)
        }
        doGroup()
        this._viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: undoGroup, redo: doGroup})
        this._toast(`Grouped ${sel.length} object${sel.length > 1 ? 's' : ''} — Ctrl+Shift+G to ungroup`)
    }

    ungroupSelected() {
        const groups = this.selected.filter(o => !o.geometry && this._contentChildren(o).length)
        if (!groups.length || !this._viewer) return
        const records = groups.map(g => ({g, parent: g.parent!, index: g.parent!.children.indexOf(g), children: [...g.children] as IObject3D[]}))
        const doUngroup = () => {
            const freed: IObject3D[] = []
            for (const r of records) {
                for (const c of r.children) {
                    r.parent.attach(c)
                    if (!this._isHelper(c)) freed.push(c)
                }
                r.g.removeFromParent()
            }
            this._sceneChanged()
            this.select(freed, false)
        }
        const undo = () => {
            for (const r of records) {
                r.parent.add(r.g)
                const ch = r.parent.children
                ch.splice(ch.indexOf(r.g), 1)
                ch.splice(Math.min(r.index, ch.length), 0, r.g)
                for (const c of r.children) r.g.attach(c)
            }
            this._sceneChanged()
            this.select(groups, false)
        }
        doUngroup()
        this._viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo, redo: doUngroup})
        this._toast('Ungrouped')
    }

    private static _groupCount = 0

    private _sceneChanged() {
        this._viewer?.scene.setDirty({refreshScene: true})
        this._emit('hierarchy')
    }

    // endregion

    // region drawing

    displayName(o: IObject3D) {
        const L = this.levels(o)
        const level = L.find(l => l.includes(o))
        // a merged wrapper chain shows the most specific name
        const chain = level ? [...level].reverse() : [o]
        const named = chain.find(n => n.name && !/^(scene|root|rootnode|gltf|group)$/i.test(n.name))
        return named?.name || o.name || o.type
    }

    private _tick = () => {
        this._raf = requestAnimationFrame(this._tick)
        if (!this._viewer || !this._root) return
        if (!this._active) {
            if (this._hover) this._hover = null
            return
        }
        if (this._pointerDirty && !this._state) {
            this._pointerDirty = false
            this._updateHover()
        }
        const ext = this.externalHover
        if (ext !== this._lastExternalHover) {
            this._lastExternalHover = ext
            this._emit('hover')
        }
        this._draw()
    }

    private _updateHover() {
        let h: IObject3D | null = null
        if (this._pointerInside && this.settings.hover) {
            const hit = this.raycastLeaf(this._pointer.x, this._pointer.y)
            const tgt = hit ? this.resolveTarget(hit.leaf, this._keys.ctrl, false) : null
            h = tgt
            // inside a selected group, hover previews the part that a double-click selects
            if (hit && tgt && this.selected.includes(tgt)) h = this.resolveTarget(hit.leaf, false, true)
            const canvas = this._viewer!.canvas
            const canMove = tgt && (this.settings.dragMove === 'any' || this.settings.dragMove === 'selected' && this.selected.includes(tgt))
            canvas.style.cursor = this._keys.space ? 'grab' : canMove ? 'move' : tgt ? 'pointer' : this.settings.emptyDrag === 'marquee' ? 'crosshair' : 'grab'
        }
        if (h !== this._hover) {
            this._hover = h
            this._emit('hover')
        }
    }

    private _screenRect(corners: Vector3[]) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        let anyFront = false
        for (const c of corners) {
            const s = this.toScreen(c)
            if (s.behind) continue
            anyFront = true
            minX = Math.min(minX, s.x)
            maxX = Math.max(maxX, s.x)
            minY = Math.min(minY, s.y)
            maxY = Math.max(maxY, s.y)
        }
        return anyFront ? {minX, minY, maxX, maxY} : null
    }

    /** Which box faces point to the camera */
    private _frontFaces(info: BoxInfo) {
        const camPos = this._camera().getWorldPosition(new Vector3())
        const res: boolean[] = [] // index = axis * 2 + (side > 0 ? 1 : 0)
        for (let a = 0; a < 3; a++) for (const side of [-1, 1]) {
            const n = info.axes[a].clone().multiplyScalar(side)
            const fc = info.center.clone().addScaledVector(info.axes[a], side * info.size.getComponent(a) / 2)
            res.push(n.dot(camPos.clone().sub(fc)) > 0)
        }
        return res
    }

    private _handle(key: string, data: HandleData) {
        this._handleMap.set(key, data)
        return key
    }

    private _draw() {
        const L = this._lines!, H = this._handles!, T = this._labels!
        L.begin()
        H.begin()
        T.begin()
        this._handleMap.clear()
        const st = this.settings
        const sel = this.selected
        const dragging = !!this._state && this._state.kind !== 'press' && this._state.kind !== 'marquee'

        const hover = this.externalHover || this._hover
        if (hover && st.hover && !st.outlineHover && !sel.includes(hover) && !dragging) this._drawOutline('hover', [hover], 1, 1)
        if (st.objectHelpers !== 'widgets') this._drawSpecialObjects(sel, hover)
        if (this.geometryEdit) this._drawGeometryEdit(this.geometryEdit)
        else {
            if (sel.length > 1 && !st.outlineSelected) sel.forEach((o, i) => this._drawOutline('sub' + i, [o], 1, 0.55))
            const boxSel = st.objectHelpers === 'widgets' ? sel : sel.filter(o => !this._isSpecial(o))
            if (boxSel.length) this._drawSelection(boxSel, dragging)
        }

        const s = this._state
        if (s?.kind === 'marquee') {
            const x = Math.min(s.start.x, s.cur.x), y = Math.min(s.start.y, s.cur.y)
            L.get('marquee', 'rect', {
                x, y, width: Math.abs(s.cur.x - s.start.x), height: Math.abs(s.cur.y - s.start.y),
                fill: 'color-mix(in srgb, var(--sux-accent) 12%, transparent)', stroke: 'var(--sux-accent)', 'stroke-width': 1,
            })
        }
        if (s?.kind === 'move') this._drawMovePlane(s)
        this._guides.forEach((g, i) => {
            const a = this.toScreen(g.a), b = this.toScreen(g.b)
            if (a.behind || b.behind) return
            L.get('guide' + i, 'line', {x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#f24822', 'stroke-width': 1})
            for (const [k, q] of [['a', a], ['b', b]] as const) L.get(`guide${i}${k}`, 'path', {d: `M${q.x - 3} ${q.y - 3}L${q.x + 3} ${q.y + 3}M${q.x + 3} ${q.y - 3}L${q.x - 3} ${q.y + 3}`, stroke: '#f24822', 'stroke-width': 1})
        })
        L.end()
        H.end()
        T.end()
    }

    /** While moving: the plane as a grid patch, and a drop line to the floor with a mark where it lands */
    private _drawMovePlane(s: Extract<DragState, {kind: 'move'}>) {
        const L = this._lines!
        const box = s.startBox.clone().translate(s.lastDelta)
        const size = box.getSize(new Vector3())
        const c = box.getCenter(new Vector3())
        const base = new Vector3(c.x, box.min.y, c.z)
        const ext = Math.max(size.x, size.z, size.y * 0.5) * 1.6 || 1
        const step = Math.pow(10, Math.floor(Math.log10(ext / 2)))
        const n = Math.ceil(ext / step)
        const seg = (a: Vector3, b: Vector3) => {
            const p = this.toScreen(a), q = this.toScreen(b)
            return p.behind || q.behind ? '' : `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`
        }
        let d = ''
        // grid on the plane through the box, lines on a world grid for the axis-aligned planes
        const [ax, ay] = this._planeAxes(s.planeKind)
        const origin = s.planeKind === 'ground' ? base.clone() : c.clone()
        if (s.planeKind !== 'view') {
            for (const v of [ax, ay]) {
                const comp = Math.abs(v.x) > 0.5 ? 'x' : Math.abs(v.y) > 0.5 ? 'y' : 'z'
                origin[comp] = Math.round(origin[comp] / step) * step
            }
        }
        for (let i = -n; i <= n; i++) {
            d += seg(origin.clone().addScaledVector(ax, i * step).addScaledVector(ay, -n * step), origin.clone().addScaledVector(ax, i * step).addScaledVector(ay, n * step))
            d += seg(origin.clone().addScaledVector(ay, i * step).addScaledVector(ax, -n * step), origin.clone().addScaledVector(ay, i * step).addScaledVector(ax, n * step))
        }
        L.get('move-grid', 'path', {d, fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': 1, opacity: 0.28})
        // drop line and the floor mark show the height and where the object is over the floor
        const floor = new Vector3(base.x, 0, base.z)
        const r = Math.max(size.x, size.z) / 2
        let ring = ''
        for (let i = 0; i <= 32; i++) {
            const a = i / 32 * Math.PI * 2
            const p = this.toScreen(new Vector3(floor.x + Math.cos(a) * r, 0, floor.z + Math.sin(a) * r))
            if (p.behind) {
                ring = ''
                break
            }
            ring += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
        }
        L.get('move-floor', 'path', {d: ring, fill: 'color-mix(in srgb, var(--sux-accent) 14%, transparent)', stroke: 'var(--sux-accent)', 'stroke-width': 1, opacity: 0.7})
        L.get('move-drop', 'path', {d: Math.abs(base.y) > 1e-4 ? seg(base, floor) : '', stroke: 'var(--sux-accent)', 'stroke-width': 1, 'stroke-dasharray': '3 3'})
    }


    // region lights and cameras

    private _specials: IObject3D[] = []
    private _specialsDirty = true
    private _markSpecials = () => {
        this._specialsDirty = true
    }

    private _isSpecial(o: IObject3D) {
        return !!(o.isLight || o.isCamera)
    }

    /** Lights and cameras in the model root */
    private _getSpecials() {
        if (this._specialsDirty && this._viewer) {
            this._specialsDirty = false
            this._specials = []
            this._modelRoot.traverse(o => {
                if (this._isSpecial(o as IObject3D) && !this._isHelper(o as IObject3D) && o !== this._viewer!.scene.mainCamera) this._specials.push(o as IObject3D)
            })
        }
        return this._specials
    }

    private _visibleChain(o: Object3D) {
        let p: Object3D | null = o
        while (p) {
            if (!p.visible) return false
            p = p.parent
        }
        return true
    }

    /** Where a light or camera points: the camera target, the floor under a light, or a few units ahead */
    private _aimPoint(o: IObject3D) {
        const t = (o as any).target
        if (o.isCamera && t?.isVector3) return t.clone() as Vector3
        const pos = o.getWorldPosition(new Vector3())
        const dir = new Vector3(0, 0, -1).transformDirection(o.matrixWorld)
        if (dir.y < -0.05) {
            const d = -pos.y / dir.y
            if (d > 0 && d < 100) return pos.addScaledVector(dir, d)
        }
        return pos.addScaledVector(dir, 3)
    }

    /** A length that reads well on screen at this point (about 90 px) */
    private _detailLength(at: Vector3) {
        return this._worldPerPixel(at) * 90
    }

    private _setAim(o: IObject3D, p: Vector3) {
        const t = (o as any).target
        if (o.isCamera && t?.isVector3) {
            t.copy(p)
            o.setDirty?.()
        } else {
            o.lookAt(p)
            o.updateMatrixWorld(true)
            o.setDirty?.({change: 'transform', frameFade: false})
        }
        this._viewer?.setDirty()
    }

    private _drawSpecialObjects(sel: IObject3D[], hover: IObject3D | null) {
        const H = this._handles!, T = this._labels!
        for (const o of this._getSpecials()) {
            if (!this._visibleChain(o)) continue
            const pos = o.getWorldPosition(new Vector3())
            const sp = this.toScreen(pos)
            if (sp.behind) continue
            const isSel = sel.includes(o) || this.geometryEdit === o
            if (isSel || hover === o) this._drawObjectDetails(o, pos, isSel)
            const key = 'ic-' + o.uuid
            const hk = this._handle(key, {kind: 'icon', obj: o})
            const fg = isSel ? '#fff' : '#3a3f47'
            H.get(key + '-bg', 'circle', {cx: sp.x, cy: sp.y, r: 11, fill: isSel ? 'var(--sux-accent)' : 'rgba(255,255,255,.92)', stroke: isSel || hover === o ? 'var(--sux-accent)' : 'rgba(0,0,0,.25)', 'stroke-width': 1.5, 'data-sux': hk, style: 'pointer-events:all;cursor:pointer'})
            H.get(key, 'path', {d: iconPath(o), fill: 'none', stroke: fg, 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: `translate(${(sp.x - 8).toFixed(1)} ${(sp.y - 8).toFixed(1)})`, style: 'pointer-events:none'})
            if (isSel && this.settings.showName) {
                const tag = T.get(key + '-name', 'div', {class: 'sux-name'})
                tag.textContent = this.displayName(o)
                tag.style.transform = `translate(${sp.x + 15}px, ${sp.y - 8}px)`
            }
        }
    }

    /** Aim line + handle, spot cone, camera frustum, point light range, rect light size */
    private _drawObjectDetails(o: IObject3D, pos: Vector3, isSel: boolean) {
        const L = this._lines!, H = this._handles!
        const color = isSel ? 'var(--sux-accent)' : '#8a8f98'
        const k = 'od-' + o.uuid
        const sc = (v: Vector3) => this.toScreen(v)
        const path = (pts: Vector3[], close = false) => {
            const ss = pts.map(sc)
            if (ss.some(q => q.behind)) return ''
            return ss.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('') + (close ? 'Z' : '')
        }
        const local = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(o.matrixWorld)
        const ol = o as any
        const hasAim = ol.isDirectionalLight || ol.isSpotLight || ol.isCamera || ol.isRectAreaLight
        let d = ''
        if (hasAim) {
            const aim = this._aimPoint(o)
            // the cone and the frustum are drawn short; the aim line goes all the way to the aim point
            const dist = Math.min(Math.max(1e-3, pos.distanceTo(aim)), this._detailLength(pos))
            if (ol.isSpotLight) {
                // cone: circle at the aim distance, four lines from the apex
                const r = Math.tan(Math.min(ol.angle ?? Math.PI / 6, 1.3)) * dist
                const ring: Vector3[] = []
                for (let i = 0; i <= 40; i++) {
                    const a = i / 40 * Math.PI * 2
                    ring.push(local(Math.cos(a) * r, Math.sin(a) * r, -dist))
                }
                d += path(ring)
                for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) d += path([pos, local(Math.cos(a) * r, Math.sin(a) * r, -dist)])
            } else if (ol.isCamera && ol.isPerspectiveCamera) {
                // frustum to the target distance (capped), and a small triangle on top for "up"
                const depth = Math.min(dist, ol.far ?? dist)
                const hh = Math.tan((ol.fov ?? 45) * Math.PI / 360) * depth, hw = hh * (ol.aspect || 1)
                const c = [local(-hw, -hh, -depth), local(hw, -hh, -depth), local(hw, hh, -depth), local(-hw, hh, -depth)]
                d += path(c, true)
                for (const q of c) d += path([pos, q])
                d += path([local(-hw * 0.3, hh * 1.08, -depth), local(0, hh * 1.35, -depth), local(hw * 0.3, hh * 1.08, -depth)], true)
            } else if (ol.isRectAreaLight) {
                const w = (ol.width ?? 1) / 2, h = (ol.height ?? 1) / 2
                d += path([local(-w, -h, 0), local(w, -h, 0), local(w, h, 0), local(-w, h, 0)], true)
            }
            const aimS = sc(aim)
            L.get(k + '-aim', 'path', {d: path([pos, aim]), fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: isSel ? 1 : 0.7})
            if (isSel && this.canEdit && !aimS.behind) {
                const hk = this._handle(k + '-aimh', {kind: 'aim', obj: o})
                H.get(k + '-aimh-hit', 'circle', {cx: aimS.x, cy: aimS.y, r: 11, fill: 'transparent', 'data-sux': hk, style: 'pointer-events:all;cursor:crosshair'})
                H.get(k + '-aimh', 'circle', {cx: aimS.x, cy: aimS.y, r: 5, fill: '#fff', stroke: color, 'stroke-width': 1.5, style: 'pointer-events:none'})
                H.get(k + '-aimh2', 'circle', {cx: aimS.x, cy: aimS.y, r: 1.8, fill: color, style: 'pointer-events:none'})
            }
        } else if (ol.isPointLight && ol.distance > 0) {
            const sp = sc(pos)
            if (!sp.behind) {
                const r = ol.distance / this._worldPerPixel(pos)
                L.get(k + '-range', 'circle', {cx: sp.x, cy: sp.y, r: Math.min(r, 4000), fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.6})
            }
        }
        L.get(k, 'path', {d, fill: 'none', stroke: color, 'stroke-width': 1, opacity: isSel ? 0.9 : 0.6, 'stroke-linejoin': 'round'})
    }

    // endregion

    // region geometry editing

    private _canEditGeometry(o: IObject3D) {
        return !!o.geometry && !this.editingLocked && !this.isLocked(o)
    }

    /** Go from the object to its geometry: curve points in the view and the generator parameters in a panel */
    enterGeometryEdit(o: IObject3D) {
        if (!this._canEditGeometry(o)) return
        this.geometryEdit = o
        if (this.selectGeometryInEdit && o.geometry) this._picking?.picker?.setSelected(o.geometry as any, false)
        else if (!(this.selected.length === 1 && this.selected[0] === o)) this.select([o], false)
        this._buildParamsPanel()
        this._emit('geometryEdit')
        this._viewer?.setDirty()
        this._toast(genParams(o) ? 'Editing the geometry — Esc when done' : 'This geometry has no parameters — Esc to go back')
    }

    exitGeometryEdit() {
        const o = this.geometryEdit
        this.geometryEdit = null
        this._buildParamsPanel()
        if (o) this.select([o], false)
        this._emit('geometryEdit')
        this._viewer?.setDirty()
    }

    private _cpWorld(o: IObject3D, pt: CurvePoint) {
        const a = pt.vec.toArray()
        return new Vector3(a[0], a[1], a[2] ?? 0).applyMatrix4(o.matrixWorld)
    }

    private _paramsEl?: HTMLDivElement
    private _paramInputs = new Map<string, HTMLInputElement>()
    private _paramUndo?: {cmd: {undo: () => void, redo: () => void}, time: number, key: string, before: any}

    /** Change one generator parameter, regenerate, and record undo (quick edits of the same parameter merge) */
    setGeometryParam(o: IObject3D, key: string, value: any) {
        const g = o.geometry
        const params = genParams(o)
        if (!g || !params || params[key] === value) return
        const gen = this._viewer?.getPlugin(GeometryGeneratorPlugin)
        const apply = (v: any) => {
            if (gen) gen.updateGeometry(g, {[key]: v})
            else {
                params[key] = v
                g.setDirty?.({regenerate: true} as any)
            }
            (g as any).uiConfig?.uiRefresh?.(true, 'postFrame')
            this._refreshParamInputs()
            this._viewer?.setDirty()
            this._emit('transform')
        }
        const um = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        const uid = g.uuid + key
        const now = performance.now()
        const last = this._paramUndo
        const merge = um && last && last.key === uid && um.peek() === last.cmd && now - last.time < 1000
        const before = merge ? last.before : params[key]
        apply(value)
        const cmd = {undo: () => apply(before), redo: () => apply(value)}
        if (um) {
            if (merge) um.replaceLast(cmd)
            else um.record(cmd)
        }
        this._paramUndo = {cmd, time: now, key: uid, before}
    }

    private _refreshParamInputs() {
        const params = genParams(this.geometryEdit)
        if (!params) return
        for (const [k, input] of this._paramInputs) {
            if (document.activeElement === input) continue
            if (input.type === 'checkbox') input.checked = !!params[k]
            else input.value = String(+(+params[k]).toFixed(4))
        }
    }

    /** Floating panel next to the object with the generator parameters */
    private _buildParamsPanel() {
        this._paramsEl?.remove()
        this._paramsEl = undefined
        this._paramInputs.clear()
        const o = this.geometryEdit
        if (!o || !this._root) return
        const g = o.geometry
        const params = genParams(o)
        const el = document.createElement('div')
        el.className = 'sux-params'
        el.style.pointerEvents = 'auto'
        el.innerHTML = `<div class="sux-params-head"><b>Geometry</b><span>${params?.type ?? 'mesh'}</span><button>Done</button></div>`
        el.querySelector('button')!.addEventListener('click', () => this.exitGeometryEdit())
        // keys typed in the panel stay there
        el.addEventListener('keydown', e => {
            e.stopPropagation()
            if (e.key === 'Escape') this.exitGeometryEdit()
        })
        if (!params) {
            const n = g?.attributes?.position?.count ?? 0
            el.insertAdjacentHTML('beforeend', `<div class="sux-params-note">Not parametric (${n.toLocaleString()} vertices). Shapes made with the geometry generator have their parameters here.</div>`)
        } else {
            for (const [k, v] of Object.entries(params)) {
                if (k === 'type') continue
                if (k === 'curve' && v && typeof v === 'object') {
                    const n = curvePoints(v).length
                    el.insertAdjacentHTML('beforeend', `<div class="sux-params-note">Curve: ${n} point${n === 1 ? '' : 's'}. Drag them in the view.</div>`)
                    continue
                }
                if (typeof v !== 'number' && typeof v !== 'boolean') continue
                const row = document.createElement('label')
                row.className = 'sux-params-row'
                const name = document.createElement('span')
                name.textContent = k.replace(/([A-Z])/g, ' $1').toLowerCase()
                const input = document.createElement('input')
                if (typeof v === 'boolean') {
                    input.type = 'checkbox'
                    input.checked = v
                    input.addEventListener('change', () => this.setGeometryParam(o, k, input.checked))
                } else {
                    input.type = 'number'
                    const isInt = Number.isInteger(v) && /segment|count|sides|detail|points|tubular|radial|height[sS]eg|width[sS]eg/i.test(k)
                    input.step = isInt ? '1' : 'any'
                    input.value = String(+v.toFixed(4))
                    input.addEventListener('change', () => {
                        const n = parseFloat(input.value)
                        if (isFinite(n)) this.setGeometryParam(o, k, isInt ? Math.round(n) : n)
                    })
                    // scrub: drag the name left or right
                    name.style.cursor = 'ew-resize'
                    name.addEventListener('pointerdown', e => {
                        e.preventDefault()
                        name.setPointerCapture(e.pointerId)
                        const x0 = e.clientX
                        const v0 = +params[k]
                        const step = isInt ? 0.25 : Math.max(0.001, Math.abs(v0) * 0.01 || 0.01)
                        const move = (ev: PointerEvent) => {
                            let n = v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : 1)
                            if (isInt) n = Math.max(1, Math.round(n))
                            this.setGeometryParam(o, k, n)
                        }
                        const up = () => {
                            name.removeEventListener('pointermove', move)
                            name.removeEventListener('pointerup', up)
                            if (this._paramUndo) this._paramUndo.time = 0 // the next edit is a new undo step
                        }
                        name.addEventListener('pointermove', move)
                        name.addEventListener('pointerup', up)
                    })
                }
                this._paramInputs.set(k, input)
                row.append(name, input)
                el.appendChild(row)
            }
        }
        this._root.appendChild(el)
        this._paramsEl = el
    }

    private _drawGeometryEdit(o: IObject3D) {
        const L = this._lines!, H = this._handles!, T = this._labels!
        const info = this.boxInfo([o], 'local')
        const rect = this._screenRect(info.corners)
        if (!rect) return
        L.get('ge-rect', 'rect', {x: rect.minX, y: rect.minY, width: rect.maxX - rect.minX, height: rect.maxY - rect.minY, fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.7})
        const tag = T.get('ge-name', 'div', {class: 'sux-name'})
        const label = `${this.displayName(o)} · Geometry`
        if (tag.textContent !== label) tag.textContent = label
        tag.style.transform = `translate(${rect.minX}px, ${rect.minY - 4}px) translateY(-100%)`
        if (this._paramsEl) {
            const {w} = this._size()
            const left = rect.maxX + 14 + 220 > w ? Math.max(4, rect.minX - 14 - 220) : rect.maxX + 14
            this._paramsEl.style.transform = `translate(${left}px, ${Math.max(4, rect.minY)}px)`
        }
        const curve = genParams(o)?.curve
        const pts = curvePoints(curve)
        if (!pts.length) return
        // the curve itself, then the tangent lines of beziers, then the points
        const toW = (a: number[]) => new Vector3(a[0], a[1], a[2] ?? 0).applyMatrix4(o.matrixWorld)
        let d = ''
        try {
            const samples = (curve.getPoints(80) as any[]).map(q => this.toScreen(toW(q.toArray())))
            if (!samples.some(q => q.behind)) d = samples.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('')
        } catch (e) {
            d = ''
        }
        L.get('ge-curve', 'path', {d, fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': 2})
        const sp = pts.map(pt => this.toScreen(this._cpWorld(o, pt)))
        let t = ''
        const tangent = (a: number, b: number) => {
            if (sp[a] && sp[b] && !sp[a].behind && !sp[b].behind) t += `M${sp[a].x.toFixed(1)} ${sp[a].y.toFixed(1)}L${sp[b].x.toFixed(1)} ${sp[b].y.toFixed(1)}`
        }
        pts.forEach((pt, i) => {
            if (pt.key.endsWith('v1')) tangent(i - 1, i)
            if (pt.key.endsWith('v3')) tangent(i - 1, i)
            if (pt.key.endsWith('v2') && !pts[i + 1]?.key.endsWith('v3')) tangent(i - 1, i)
        })
        L.get('ge-tangents', 'path', {d: t, fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': 1, opacity: 0.6})
        const editing = this._state?.kind === 'cp' ? this._state.point : null
        sp.forEach((q, i) => {
            if (q.behind) return
            const key = 'cp' + i
            const hk = this._handle(key, {kind: 'cp', obj: o, index: i})
            const on = editing === pts[i]
            H.get(key + '-hit', 'circle', {cx: q.x, cy: q.y, r: 10, fill: 'transparent', 'data-sux': hk, style: 'pointer-events:all;cursor:move'})
            H.get(key, 'rect', {x: q.x - 4, y: q.y - 4, width: 8, height: 8, rx: 4, fill: on ? 'var(--sux-accent)' : '#fff', stroke: 'var(--sux-accent)', 'stroke-width': 1.5, style: 'pointer-events:none'})
        })
    }

    // endregion

    private _boxEdgesPath(info: BoxInfo, front: boolean[], which: 'visible' | 'hidden') {
        const sc = info.corners.map(c => this.toScreen(c))
        let d = ''
        for (const [i, j] of BOX_EDGES) {
            const axis = [1, 2, 4].indexOf(i ^ j)
            // the two faces that share this edge
            const faces: number[] = []
            for (let a = 0; a < 3; a++) {
                if (a === axis) continue
                const bit = 1 << a
                faces.push(a * 2 + (i & bit ? 1 : 0))
            }
            const visible = faces.some(f => front[f])
            if (which === 'visible' !== visible) continue
            if (sc[i].behind || sc[j].behind) continue
            d += `M${sc[i].x.toFixed(1)} ${sc[i].y.toFixed(1)}L${sc[j].x.toFixed(1)} ${sc[j].y.toFixed(1)}`
        }
        return d
    }

    private _drawOutline(key: string, objs: IObject3D[], width: number, opacity: number) {
        const st = this.settings
        const info = this.boxInfo(objs)
        const L = this._lines!
        if (st.visual === 'figma2d' || st.visual === 'minimal') {
            const r = this._screenRect(info.corners)
            if (!r) return
            L.get(key, 'rect', {x: r.minX, y: r.minY, width: r.maxX - r.minX, height: r.maxY - r.minY, fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': width, opacity})
        } else {
            const front = this._frontFaces(info)
            L.get(key, 'path', {d: this._boxEdgesPath(info, front, 'visible'), fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': width, opacity, 'stroke-linejoin': 'round'})
        }
    }

    private _drawSelection(sel: IObject3D[], dragging: boolean) {
        const st = this.settings
        const L = this._lines!, H = this._handles!
        const info = this.boxInfo(sel)
        const rect = this._screenRect(info.corners)
        if (!rect) return
        const sc = info.corners.map(c => this.toScreen(c))
        const front = this._frontFaces(info)
        const accent = 'var(--sux-accent)'
        const handleSize = matchMedia('(pointer: coarse)').matches ? 12 : 8
        const hs = handleSize / 2
        const showHandles = (!dragging || this._state?.kind !== 'move') && this.canEdit

        const drawSquare = (key: string, x: number, y: number, cursor: string, data: HandleData, round = false) => {
            const hk = this._handle(key, data)
            // big transparent hit area, small visible square
            H.get(key + '-hit', 'rect', {x: x - 10, y: y - 10, width: 20, height: 20, fill: 'transparent', 'data-sux': hk, style: `pointer-events:all;cursor:${cursor}`})
            if (round) H.get(key, 'circle', {cx: x, cy: y, r: hs * 0.8, fill: '#fff', stroke: accent, 'stroke-width': 1.5, style: 'pointer-events:none'})
            else H.get(key, 'rect', {x: x - hs, y: y - hs, width: handleSize, height: handleSize, rx: 1.5, fill: '#fff', stroke: accent, 'stroke-width': 1.5, style: 'pointer-events:none'})
        }

        const visual = st.visual
        const use2dRect = visual === 'figma2d' || visual === 'hybrid' || visual === 'minimal'
        if (use2dRect) {
            L.get('sel-rect', 'rect', {
                x: rect.minX, y: rect.minY, width: rect.maxX - rect.minX, height: rect.maxY - rect.minY, fill: 'none', stroke: accent,
                'stroke-width': visual === 'figma2d' ? 1.5 : 1, opacity: visual === 'figma2d' ? 1 : visual === 'hybrid' ? 0.5 : 0.35,
                'stroke-dasharray': visual === 'minimal' ? '4 4' : undefined,
            })
        }
        if (visual === 'box3d' || visual === 'hybrid') {
            L.get('sel-box', 'path', {d: this._boxEdgesPath(info, front, 'visible'), fill: 'none', stroke: accent, 'stroke-width': 1.5, 'stroke-linejoin': 'round'})
            if (st.xray) L.get('sel-box-hidden', 'path', {d: this._boxEdgesPath(info, front, 'hidden'), fill: 'none', stroke: accent, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.6})
        }
        if (visual === 'brackets') {
            let d = ''
            for (let i = 0; i < 8; i++) {
                if (sc[i].behind) continue
                for (const b of [1, 2, 4]) {
                    const j = i ^ b
                    if (sc[j].behind) continue
                    const dx = sc[j].x - sc[i].x, dy = sc[j].y - sc[i].y
                    const len = Math.hypot(dx, dy)
                    const l = Math.min(16, len * 0.28)
                    if (len < 1e-3) continue
                    d += `M${sc[i].x.toFixed(1)} ${sc[i].y.toFixed(1)}l${(dx / len * l).toFixed(1)} ${(dy / len * l).toFixed(1)}`
                }
            }
            L.get('sel-brackets', 'path', {d, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-linecap': 'round'})
            if (st.xray) L.get('sel-box-hidden', 'path', {d: this._boxEdgesPath(info, front, 'visible'), fill: 'none', stroke: accent, 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: 0.45})
        }

        if (showHandles) {
            if (use2dRect) {
                // 2D corners. The fixed point is a 3D point: base/center, or the box corner drawn closest to the opposite 2D corner
                const c2 = [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]]
                const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize']
                c2.forEach(([x, y], i) => {
                    const [ox, oy] = c2[(i + 2) % 4]
                    let pivot = st.scalePivot === 'center' ? info.center : info.base
                    if (st.scalePivot === 'opposite') {
                        let best = 0, bd = Infinity
                        sc.forEach((s, k) => {
                            const dd = (s.x - ox) ** 2 + (s.y - oy) ** 2
                            if (dd < bd) {
                                bd = dd
                                best = k
                            }
                        })
                        pivot = info.corners[best]
                    }
                    if (st.rotate === 'corners') this._rotateZone('rot' + i, x, y, i)
                    drawSquare('c' + i, x, y, cursors[i], {kind: 'scale', pivot})
                })
                if (st.stretchHandles && sel.length === 1) {
                    // each side stretches the box axis that looks most like that side's direction on screen
                    const center = this.toScreen(info.center)
                    const sides: [number, number, number, number, string][] = [
                        [(rect.minX + rect.maxX) / 2, rect.minY, 0, -1, 'ns-resize'],
                        [rect.maxX, (rect.minY + rect.maxY) / 2, 1, 0, 'ew-resize'],
                        [(rect.minX + rect.maxX) / 2, rect.maxY, 0, 1, 'ns-resize'],
                        [rect.minX, (rect.minY + rect.maxY) / 2, -1, 0, 'ew-resize'],
                    ]
                    const local = this.boxInfo(sel, 'local')
                    sides.forEach(([x, y, dx, dy, cur], i) => {
                        let best = 0, bdot = 0, side = 1
                        for (let a = 0; a < 3; a++) {
                            const tip = this.toScreen(local.center.clone().addScaledVector(local.axes[a], local.size.getComponent(a) / 2))
                            const v = new Vector2(tip.x - center.x, tip.y - center.y)
                            const len = v.length()
                            if (len < 1) continue
                            const dt = (v.x * dx + v.y * dy) / len
                            if (Math.abs(dt) > Math.abs(bdot)) {
                                bdot = dt
                                best = a
                                side = Math.sign(dt)
                            }
                        }
                        const hk = this._handle('e' + i, {kind: 'stretch', axis: best, side})
                        const w = dx ? 5 : 14, h = dx ? 14 : 5
                        H.get('e' + i + '-hit', 'rect', {x: x - (dx ? 6 : 12), y: y - (dx ? 12 : 6), width: dx ? 12 : 24, height: dx ? 24 : 12, fill: 'transparent', 'data-sux': hk, style: `pointer-events:all;cursor:${cur}`})
                        H.get('e' + i, 'rect', {x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 2.5, fill: '#fff', stroke: accent, 'stroke-width': 1.5, style: 'pointer-events:none'})
                    })
                }
            } else {
                // 3D corner handles: the fixed point is the opposite corner, or base/center
                const cs0 = this.toScreen(info.center)
                const centerS = {x: cs0.x, y: cs0.y}
                for (let i = 0; i < 8; i++) {
                    if (sc[i].behind) continue
                    const faces = [0, 1, 2].map(a => a * 2 + (i & 1 << a ? 1 : 0))
                    const visible = faces.some(f => front[f])
                    if (!visible && !st.xray) continue
                    const pivot = st.scalePivot === 'opposite' ? info.corners[i ^ 7] : st.scalePivot === 'center' ? info.center : info.base
                    if (!visible) {
                        const hk = this._handle('c' + i, {kind: 'scale', pivot})
                        H.get('c' + i + '-hit', 'circle', {cx: sc[i].x, cy: sc[i].y, r: 8, fill: 'transparent', 'data-sux': hk, style: `pointer-events:all;cursor:${resizeCursor(sc[i].x - centerS.x, sc[i].y - centerS.y)}`})
                        H.get('c' + i, 'circle', {cx: sc[i].x, cy: sc[i].y, r: 2.5, fill: accent, opacity: 0.6, style: 'pointer-events:none'})
                        continue
                    }
                    drawSquare('c' + i, sc[i].x, sc[i].y, resizeCursor(sc[i].x - centerS.x, sc[i].y - centerS.y), {kind: 'scale', pivot}, true)
                }
                if (st.stretchHandles && sel.length === 1) {
                    const local = st.boxSpace === 'local' ? info : this.boxInfo(sel, 'local')
                    const lf = this._frontFaces(local)
                    for (let a = 0; a < 3; a++) for (const side of [-1, 1]) {
                        if (!lf[a * 2 + (side > 0 ? 1 : 0)]) continue
                        const fc = this.toScreen(local.center.clone().addScaledVector(local.axes[a], side * local.size.getComponent(a) / 2))
                        if (fc.behind) continue
                        const key = `f${a}${side}`
                        const hk = this._handle(key, {kind: 'stretch', axis: a, side})
                        H.get(key + '-hit', 'circle', {cx: fc.x, cy: fc.y, r: 10, fill: 'transparent', 'data-sux': hk, style: `pointer-events:all;cursor:${resizeCursor(fc.x - centerS.x, fc.y - centerS.y)}`})
                        H.get(key, 'rect', {x: fc.x - 4, y: fc.y - 4, width: 8, height: 8, transform: `rotate(45 ${fc.x} ${fc.y})`, fill: accent, stroke: '#fff', 'stroke-width': 1.5, style: 'pointer-events:none'})
                    }
                }
                if (st.rotate === 'corners') {
                    const c2 = [[rect.minX, rect.minY], [rect.maxX, rect.minY], [rect.maxX, rect.maxY], [rect.minX, rect.maxY]]
                    c2.forEach(([x, y], i) => this._rotateZone('rot' + i, x, y, i))
                }
            }
            if (st.rotate === 'knob') {
                const cx = (rect.minX + rect.maxX) / 2
                const y = rect.minY - 26
                L.get('knob-line', 'line', {x1: cx, y1: rect.minY, x2: cx, y2: y + 6, stroke: accent, 'stroke-width': 1})
                const hk = this._handle('knob', {kind: 'rotate', axis: st.rotateAxis})
                H.get('knob-hit', 'circle', {cx, cy: y, r: 12, fill: 'transparent', 'data-sux': hk, style: `pointer-events:all;cursor:${ROTATE_CURSOR}`})
                H.get('knob', 'circle', {cx, cy: y, r: 6, fill: '#fff', stroke: accent, 'stroke-width': 1.5, style: 'pointer-events:none'})
                H.get('knob-icon', 'path', {d: `M${cx - 2.5} ${y - 1}a2.6 2.6 0 1 0 2.5 -1.6`, fill: 'none', stroke: accent, 'stroke-width': 1.2, style: 'pointer-events:none'})
            } else if (st.rotate === 'ring') this._drawRing(sel)
        }
        this._drawLabels(sel, info, rect)
    }

    private _rotateZone(key: string, x: number, y: number, corner: number) {
        // invisible zone just outside each corner, like Figma
        const ox = corner === 0 || corner === 3 ? -1 : 1
        const oy = corner < 2 ? -1 : 1
        const hk = this._handle(key, {kind: 'rotate', axis: this.settings.rotateAxis})
        this._handles!.get(key, 'rect', {x: x + ox * 12 - 11, y: y + oy * 12 - 11, width: 22, height: 22, rx: 11, fill: 'transparent', 'data-sux': hk, style: `pointer-events:all;cursor:${ROTATE_CURSOR}`})
    }

    private _drawRing(sel: IObject3D[]) {
        const info = this.boxInfo(sel, 'world')
        const r = Math.hypot(info.size.x, info.size.z) / 2 * 1.12 + this._worldPerPixel(info.base) * 6
        const c = info.base
        const pts: ScreenPt[] = []
        for (let i = 0; i <= 64; i++) {
            const a = i / 64 * Math.PI * 2
            pts.push(this.toScreen(new Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r)))
        }
        if (pts.some(p => p.behind)) return
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')
        const hk = this._handle('ring', {kind: 'rotate', axis: 'up', ring: true})
        const H = this._handles!
        H.get('ring-hit', 'path', {d, fill: 'none', stroke: 'transparent', 'stroke-width': 16, 'data-sux': hk, style: `pointer-events:stroke;cursor:${ROTATE_CURSOR}`})
        H.get('ring', 'path', {d, fill: 'none', stroke: 'var(--sux-accent)', 'stroke-width': 1.5, opacity: 0.85, style: 'pointer-events:none'})
        // grip on the side nearest to the camera
        const camPos = this._camera().getWorldPosition(new Vector3())
        const dir = camPos.clone().sub(c).setY(0)
        if (dir.lengthSq() < 1e-9) return
        dir.normalize().multiplyScalar(r)
        const g = this.toScreen(c.clone().add(dir))
        H.get('ring-grip', 'circle', {cx: g.x, cy: g.y, r: 5, fill: '#fff', stroke: 'var(--sux-accent)', 'stroke-width': 1.5, 'data-sux': hk, style: `pointer-events:all;cursor:${ROTATE_CURSOR}`})
    }

    private _unitScale() {
        return 1
    }

    private _unitLabel() {
        return this.settings.unit
    }

    private _fmt(v: number) {
        const a = Math.abs(v)
        return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
    }

    formatSize(size: Vector3) {
        return `${this._fmt(size.x)} × ${this._fmt(size.y)} × ${this._fmt(size.z)} ${this._unitLabel()}`
    }

    private _drawLabels(sel: IObject3D[], info: BoxInfo, rect: {minX: number, minY: number, maxX: number, maxY: number}) {
        const st = this.settings
        const T = this._labels!
        if (st.showName) {
            const tag = T.get('name', 'div', {class: 'sux-name'})
            tag.style.transform = `translate(${rect.minX}px, ${rect.minY - 4}px) translateY(-100%)`
            let html: string
            if (sel.length > 1) html = `<span class="sux-crumb-cur">${sel.length} selected</span>`
            else {
                const L = this.levels(sel[0])
                const i = L.findIndex(l => l.includes(sel[0]))
                const crumbs = L.slice(0, i + 1).map((l, k) => ({obj: this._rep(l), name: this.displayName(this._rep(l)), cur: k === i}))
                html = crumbs.map((c, k) => c.cur ? `<span class="sux-crumb-cur">${esc(c.name)}</span>` : `<span class="sux-crumb" data-sux="crumb${k}">${esc(c.name)}</span>`).join('<span class="sux-sep">/</span>')
                crumbs.forEach((c, k) => {
                    if (!c.cur) this._handle('crumb' + k, {kind: 'crumb', obj: c.obj})
                })
            }
            if (tag.dataset.html !== html) {
                tag.innerHTML = html
                tag.dataset.html = html
            }
        }
        if (st.showDims || this._liveLabel) {
            const pill = T.get('dims', 'div', {class: 'sux-dims'})
            const text = [st.showDims ? this.formatSize(info.size) : '', this._liveLabel].filter(Boolean).join('   ')
            if (pill.textContent !== text) pill.textContent = text
            pill.style.transform = `translate(${(rect.minX + rect.maxX) / 2}px, ${rect.maxY + 8}px) translateX(-50%)`
        }
    }

    // endregion
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 14a7 7 0 1 0 2-7" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M6 14a7 7 0 1 0 2-7" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round"/><path d="M4 3v6h6" fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="M4 3v6h6" fill="none" stroke="black" stroke-width="1.6" stroke-linejoin="round"/></svg>')}") 12 12, alias`

/** The generator parameters of an object's geometry (GeometryGeneratorPlugin), if any */
function genParams(o?: IObject3D | null): Record<string, any> | undefined {
    return o?.geometry?.userData?.generationParams as any
}

/** 16×16 icon paths for lights and cameras */
function iconPath(o: IObject3D) {
    const ol = o as any
    if (ol.isCamera) return 'M2 5.5h8.5v6H2zM10.5 7.5l3.5-2v6l-3.5-2'
    if (ol.isSpotLight) return 'M5.5 3h5l3 8.5h-11zM6 13.5h4'
    if (ol.isDirectionalLight) return 'M8 5.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4'
    if (ol.isPointLight) return 'M8 2.5a4 4 0 0 1 2.5 7.1V11h-5V9.6A4 4 0 0 1 8 2.5M6 13.5h4'
    if (ol.isRectAreaLight) return 'M2.5 4.5h11v7h-11zM5 14h6'
    return 'M2.5 10a5.5 5.5 0 0 1 11 0zM2 12.5h12' // ambient, hemisphere
}

/** Resize cursor that points along a screen direction */
function resizeCursor(dx: number, dy: number) {
    const a = (Math.atan2(dy, dx) * 180 / Math.PI % 180 + 180) % 180
    return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize'
}

function esc(s: string) {
    return s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'} as any)[c])
}
