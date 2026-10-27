import {
    AViewerPluginSync,
    CameraViewPlugin,
    GridHelper,
    IObject3D,
    Material,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    PivotControlsPlugin,
    PivotEditPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'
import {AnnotationsPlugin} from './AnnotationsPlugin'
import {SceneOverrides} from './SceneOverrides'
import {PenToolPlugin} from './PenToolPlugin'
import {TimelineBarPlugin} from './TimelineBarPlugin'
import {CameraPathPlugin} from './CameraPathPlugin'
import {confirmBox} from './motionUi'
import {EditorCameraPlugin} from './EditorCameraPlugin'

export interface EditorToolbarOptions {
    /** Add a floor grid the toolbar can show and hide */
    grid?: boolean
    /** Elements hidden by "Expand canvas" (Shift+Space), e.g. side panels */
    expandHides?: () => HTMLElement[]
    /** Elements hidden in View mode (what a visitor sees), e.g. the layers and the inspector */
    viewHides?: () => HTMLElement[]
    /** Extra buttons at the end: [label or svg, title, action] */
    extra?: [string, string, () => void][]
    /** Light (default, like the layers panel) or dark */
    theme?: 'light' | 'dark'
}

/** Post-processing plugin types that the "Effects" toggle turns off while editing */
const EFFECT_PLUGINS = ['Bloom', 'DepthOfField', 'SSContactShadows', 'SSGIPlugin', 'SSReflectionPlugin', 'TAA', 'SSAOPlugin', 'Vignette', 'ChromaticAberration', 'FilmicGrain']

const KEY = 'EditorToolbar'

/**
 * Edit-mode toolbar for threepipe editors, after the blueprint editor's canvas toolbars, plain DOM.
 *
 * Select / Move / Rotate / Scale (V W E R; the gizmo is TransformControlsPlugin), gizmo space and size, Add menu
 * (Object3DGeneratorPlugin), camera switch, "view as" overrides, effects / widgets / grid / background toggles,
 * Edit ↔ View, focus, undo/redo, save .glb (with the scene notes), expand canvas (Shift+Space).
 * {@link slot} is free space at the start for other controls (the selection mode menu).
 */
export class EditorToolbarPlugin extends AViewerPluginSync {
    static readonly PluginType = 'EditorToolbarPlugin'
    enabled = true
    dependencies = [PickingPlugin]

    readonly element: HTMLDivElement
    /** Space at the start of the toolbar for other controls */
    readonly slot: HTMLDivElement
    private _menu?: HTMLDivElement
    private _grid?: GridHelper
    private _viewMode = false
    /** View (what a visitor sees) or Edit */
    get viewMode() {
        return this._viewMode
    }
    private _view = 'shaded'
    private _expanded = false
    private _gizmo: 'off' | 'translate' | 'rotate' | 'scale' = 'off'
    private _effectsOff = false
    private _widgetsOff = false
    private _options: EditorToolbarOptions
    /** Debug views and lighting from the blueprint editor: unlit, depth, normals, material ID, UV; light and environment presets */
    readonly overrides = new SceneOverrides()
    private _tip: HTMLDivElement
    private _tipTimer = 0

    constructor(options: EditorToolbarOptions = {}) {
        super()
        this._options = options
        injectStyles()
        this.element = document.createElement('div')
        this.element.className = 'tb-root' + (options.theme === 'dark' ? ' tb-dark' : '')
        this._tip = document.createElement('div')
        this._tip.className = 'tb-tip' + (options.theme === 'dark' ? ' tb-dark' : '')
        this.slot = document.createElement('div')
        this.slot.className = 'tb-slot'
    }

    /** A narrow view: smaller buttons, and the selection mode as its number only, so every button stays reachable */
    private _fit = () => {
        const el = this.element
        if (!el.isConnected) return
        el.classList.remove('tb-compact')
        if (el.scrollWidth > el.clientWidth + 1) el.classList.add('tb-compact')
    }

    private _fitObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._fit()) : undefined

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._fitObserver?.observe(viewer.container)
        if (this._options.grid) {
            this._grid = new GridHelper(40, 40, 0x8f97a3, 0xb7bdc6)
            this._grid.name = 'Editor Grid'
            this._grid.userData.userSelectable = false
            this._grid.userData.bboxVisible = false
            ;(this._grid.material as Material).allowOverride = false // the grid keeps its look in the debug views
            viewer.scene.add(this._grid)
        }
        window.addEventListener('keydown', this._onKey)
        window.addEventListener('pointerdown', this._closeMenuOutside, true)
        viewer.scene.addEventListener('mainCameraChange', this.render)
        this.overrides.viewer = viewer
        this.overrides.addEventListener('change', this._onOverrides)
        viewer.forPlugin(SelectionUxPlugin, ux => ux.addEventListener('uxUpdate', this._onUxUpdate), ux => ux.removeEventListener('uxUpdate', this._onUxUpdate))
        viewer.forPlugin(PenToolPlugin, p => p.addEventListener('change', this.render), p => p.removeEventListener('change', this.render))
        viewer.forPlugin(TimelineBarPlugin, p => p.addEventListener('change', this.render), p => p.removeEventListener('change', this.render))
        // the Play button follows the timeline, also when the bar or the end of the timeline stops it
        viewer.timeline.addEventListener('start', this.render)
        viewer.timeline.addEventListener('stop', this.render)
        // the checkerboard follows the scene's background (transparent or not)
        viewer.scene.addEventListener('backgroundChanged', this.render)
        viewer.forPlugin(AnnotationsPlugin, a => {
            a.addEventListener('annotationChange', this.render)
            a.addEventListener('addingChange', this.render)
            a.editable = !this._viewMode
        }, a => {
            a.removeEventListener('annotationChange', this.render)
            a.removeEventListener('addingChange', this.render)
        })
        this._wasLegacy = !this._uxTools
        this.render()
    }

    private _wasLegacy = false
    /** A mode change to or from "Classic" moves the active tool between the classic gizmo and the selection UX */
    private _onUxUpdate = (e: {reason?: string}) => {
        if (e.reason !== 'settings' && e.reason !== 'camera' && e.reason !== 'tool') return
        const legacy = !this._uxTools
        if (e.reason === 'settings' && legacy !== this._wasLegacy) {
            this._wasLegacy = legacy
            const mode = this._gizmo
            this._viewer?.getPlugin(SelectionUxPlugin)?.setTool('select')
            if (this._tc?.enabled) this._tc.enabled = false
            this._gizmo = 'off'
            if (mode !== 'off') this.setGizmo(mode)
        }
        this.render()
    }

    onRemove(viewer: ThreeViewer) {
        this._fitObserver?.disconnect()
        window.removeEventListener('keydown', this._onKey)
        window.removeEventListener('pointerdown', this._closeMenuOutside, true)
        viewer.scene.removeEventListener('mainCameraChange', this.render)
        viewer.timeline.removeEventListener('start', this.render)
        viewer.timeline.removeEventListener('stop', this.render)
        viewer.scene.removeEventListener('backgroundChanged', this.render)
        viewer.getPlugin(SelectionUxPlugin)?.removeEventListener('uxUpdate', this._onUxUpdate)
        viewer.getPlugin(AnnotationsPlugin)?.removeEventListener('annotationChange', this.render)
        this._grid?.removeFromParent()
        this.overrides.removeEventListener('change', this._onOverrides)
        this.overrides.dispose()
        this._tip.remove()
        this.element.remove()
        super.onRemove(viewer)
    }

    // region actions

    private get _tc() {
        return this._viewer?.getPlugin(TransformControlsPlugin)
    }

    /** True when the selection plugin draws its own handles (any mode but "Classic"): V W E R switch its tools then */
    private get _uxTools() {
        const ux = this._viewer?.getPlugin(SelectionUxPlugin)
        return ux && ux.enabled && ux.settings.visual !== 'legacy' ? ux : undefined
    }

    /**
     * V: select. W/E/R: move, rotate, scale. With the new selection UX these are its on-canvas tools;
     * in the "Classic" mode (and without the plugin) they are the classic transform gizmo.
     */
    setGizmo(mode: 'off' | 'translate' | 'rotate' | 'scale') {
        if (!this._viewer) return
        const pen = this._viewer.getPlugin(PenToolPlugin)
        if (pen?.active) pen.finish() // another tool: keep what was drawn
        const ux = this._uxTools
        if (ux) {
            this._gizmo = mode
            ux.setTool(({off: 'select', translate: 'move', rotate: 'rotate', scale: 'scale'} as const)[mode])
            if (this._tc?.enabled) this._tc.enabled = false
            this.render()
            return
        }
        let tc = this._tc
        if (mode !== 'off' && !tc) tc = this._viewer.addPluginSync(TransformControlsPlugin)
        this._gizmo = mode
        if (tc) {
            tc.enabled = mode !== 'off'
            if (mode !== 'off') tc.transformControls?.setMode(mode)
            // re-attach to the current selection
            const picking = this._viewer.getPlugin(PickingPlugin)
            const s = picking?.getSelectedObject()
            if (s && picking) {
                picking.setSelectedObject(undefined, false, false)
                picking.setSelectedObject(s, false, false)
            }
        }
        this.render()
    }

    /** Create an object with Object3DGeneratorPlugin, inside the selected group if any, at the camera target */
    addObject(type: string) {
        const viewer = this._viewer
        const gen = viewer?.getPlugin(Object3DGeneratorPlugin)
        if (!viewer || !gen) return
        const obj = gen.generate(type, {}, false, false, false)
        if (!obj) return
        // "box" → "Box", "TubeShape" → "Tube Shape", like the lights and cameras
        if (obj.name) obj.name = (obj.name[0].toUpperCase() + obj.name.slice(1)).replace(/([a-z])([A-Z])/g, '$1 $2')
        // a new line is white and 1 px on a white floor: make it a visible path, like the pen's
        const lm = (obj as any).isLine2 ? (obj as any).material : undefined
        if (lm?.color) {
            lm.color.set('#ff6b3d')
            if ('linewidth' in lm) lm.linewidth = 3
        }
        const sel = viewer.getPlugin(PickingPlugin)?.getSelectedObject() as IObject3D | undefined
        const parent = sel?.isObject3D && !sel.geometry && !sel.isLight && !sel.isCamera ? sel : viewer.scene.modelRoot
        if (!obj.isLight && !obj.isCamera) {
            const t = (viewer.scene.mainCamera as any).target as Vector3 | undefined
            if (t) obj.position.copy(parent.worldToLocal(new Vector3(t.x, 0, t.z)))
        }
        const redo = () => {
            parent.add(obj)
            viewer.scene.setDirty({refreshScene: true})
        }
        const undo = () => {
            obj.removeFromParent()
            viewer.scene.setDirty({refreshScene: true})
        }
        redo()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo, redo})
        // selected without an undo step of its own: one undo removes the new object
        viewer.getPlugin(PickingPlugin)?.setSelectedObject(obj, false, false)
    }

    // lit views; the debug views (normals, depth, UV...) are in SceneOverrides
    private _viewMaterials: Record<string, () => Material | undefined> = {
        shaded: () => undefined,
        clay: () => new MeshStandardMaterial({color: 0xd8d8d8, roughness: 0.65, metalness: 0}),
        wireframe: () => new MeshBasicMaterial({color: 0x333a44, wireframe: true}),
    }

    /** Draw every mesh with one material: clay or wireframe; "shaded" is the real materials. Clears a debug view. */
    setView(view: string) {
        const rp = this._viewer?.renderManager.renderPass as any
        if (!rp) return
        if (view !== 'shaded' && this.overrides.material) this.overrides.setMaterial(null)
        rp.overrideMaterial?.dispose?.()
        rp.overrideMaterial = this._viewMaterials[view]?.() ?? null
        this._view = view
        this._syncLines()
        this._viewer?.setDirty()
        this.render()
    }

    private _onOverrides = () => {
        this._syncLines()
        this.render()
    }

    private _syncLines() {
        if (this._viewer) keepLinesOutOfOverride(this._viewer, this._view !== 'shaded' || !!this.overrides.material)
    }

    setEffects(on: boolean) {
        this._effectsOff = !on
        for (const t of EFFECT_PLUGINS) {
            const p = this._viewer?.getPlugin(t) as any
            if (!p?.disable) continue
            if (on) p.enable(KEY)
            else p.disable(KEY)
        }
        this._viewer?.setDirty()
        this.render()
    }

    setWidgets(on: boolean) {
        this._widgetsOff = !on
        const w = this._viewer?.getPlugin(Object3DWidgetsPlugin)
        if (w) on ? w.enable(KEY) : w.disable(KEY)
        this._viewer?.setDirty()
        this.render()
    }

    setGrid(on: boolean) {
        if (this._grid) this._grid.visible = on
        this._viewer?.setDirty()
        this.render()
    }

    private _bgHidden = false
    private _bgClip = false

    /** Whether the scene has no background (transparent): a scene setting, saved in the .glb (the inspector's Scene section) */
    get transparentBackground() {
        const sc = this._viewer?.scene
        return !!sc && !sc.background && !sc.backgroundColor
    }

    /**
     * A view setting, for editing and previewing: hide the background (a checkerboard shows instead). The scene is not
     * changed, so saving and export are not affected. The screen pass clips the background with the G-buffer depth,
     * which works with and without RGBM.
     */
    setBackground(on: boolean) {
        const viewer = this._viewer
        if (!viewer || on === !this._bgHidden) return
        const sp = viewer.renderManager.screenPass
        if (!on) this._bgClip = sp.clipBackground
        sp.clipBackground = on ? this._bgClip : true
        this._bgHidden = !on
        viewer.setDirty()
        this.render()
    }

    /** View: what the visitor sees. No selection UX, gizmo, widgets, grid or picking; Edit brings them back. */
    setViewMode(view: boolean) {
        const viewer = this._viewer
        if (!viewer) return
        this._viewMode = view
        const ux = viewer.getPlugin(SelectionUxPlugin)
        const picking = viewer.getPlugin(PickingPlugin)
        if (view) {
            // back from a camera view first: its moves become one undo step and it gets its controls back
            ux?.exitCameraView()
            picking?.setSelectedObject(undefined)
            picking?.disable(KEY)
            this._tc?.disable(KEY)
            viewer.getPlugin(Object3DWidgetsPlugin)?.disable(KEY + 'View')
            if (ux) ux.enabled = false
        } else {
            picking?.enable(KEY)
            this._tc?.enable(KEY)
            viewer.getPlugin(Object3DWidgetsPlugin)?.enable(KEY + 'View')
            if (ux) ux.enabled = true
        }
        ux?.applySettings()
        // View looks through the start view with its own controls (limits, damping); Edit through the editor camera
        viewer.getPlugin(EditorCameraPlugin)?.setActive(!view)
        const notes = viewer.getPlugin(AnnotationsPlugin)
        if (notes) notes.editable = !view
        if (this._grid) this._grid.visible = !view && this._gridOn
        this._syncPanels()
        document.body.classList.toggle('tb-view', view)
        viewer.setDirty()
        this.render()
    }

    /** Panels show in Edit mode with the canvas not expanded */
    private _syncPanels() {
        const hidden = new Set([...this._expanded ? this._options.expandHides?.() || [] : [], ...this._viewMode ? this._options.viewHides?.() || [] : []])
        for (const el of new Set([...this._options.expandHides?.() || [], ...this._options.viewHides?.() || []])) el.style.display = hidden.has(el) ? 'none' : ''
    }

    private get _gridOn() {
        return this._grid ? this._grid.userData.toolbarOn !== false : false
    }

    private _containerStyle: string | null = null

    /** The canvas fills the window, the panels in {@link EditorToolbarOptions.expandHides} hide */
    setExpanded(v: boolean) {
        if (v === this._expanded) return
        this._expanded = v
        this._syncPanels()
        document.body.classList.toggle('tb-expanded', v)
        // inline and important: page styles size the container with id selectors and !important (the tweakpane editor does)
        const c = this._viewer?.container
        if (c) {
            if (v) {
                this._containerStyle = c.getAttribute('style')
                const full = {'position': 'fixed', 'inset': '0', 'width': 'auto', 'height': 'auto', 'margin': '0', 'border-radius': '0', 'box-shadow': 'none', 'z-index': '50'}
                for (const [k, val] of Object.entries(full)) c.style.setProperty(k, val, 'important')
            } else if (this._containerStyle === null) c.removeAttribute('style')
            else c.setAttribute('style', this._containerStyle)
            this._viewer!.canvas.style.setProperty('border-radius', v ? '0' : '')
        }
        this.render()
    }

    async saveGlb() {
        const viewer = this._viewer
        if (!viewer) return
        const blob = await viewer.exportScene({viewerConfig: true})
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'scene.glb'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }

    /** N: place an annotation on the next surface clicked (AnnotationsPlugin); again: cancel */
    annotate() {
        const a = this._viewer?.getPlugin(AnnotationsPlugin)
        if (!a || this._viewMode) return
        if (a.adding) a.cancelAdding()
        else {
            // one placing tool at a time: the pen ends (its path is made from the points so far)
            this._viewer?.getPlugin(PenToolPlugin)?.finish()
            a.startAdding()
        }
        this.render()
    }

    private _undo(redo = false) {
        const um = this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager
        if (redo) um?.redo()
        else um?.undo()
    }

    private _onKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        if (e.code === 'Space' && e.shiftKey) {
            e.preventDefault()
            this.setExpanded(!this._expanded)
            return
        }
        if (e.ctrlKey || e.metaKey || e.altKey || this._viewMode) return
        if (e.code === 'KeyN') {
            this.annotate()
            return
        }
        if (e.code === 'KeyP') {
            this._viewer?.getPlugin(PenToolPlugin)?.toggle()
            return
        }
        // F zooms to the selection (PickingPlugin); with nothing selected, to everything, like the button
        if (e.code === 'KeyF' && !e.shiftKey && !this._viewer?.getPlugin(PickingPlugin)?.getSelectedObject()) {
            this._viewer?.fitToView(undefined, 1.25, 800, 'easeOut')
            return
        }
        const g = ({KeyV: 'off', KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale'} as const)[e.code as 'KeyV']
        if (g) this.setGizmo(g)
    }

    // endregion

    // region drawing

    render = () => {
        const el = this.element
        requestAnimationFrame(this._fit)
        // a checkerboard where the background is transparent: hidden in the view, or none in the scene
        this._viewer?.container.classList.toggle('tb-checker', this._bgHidden || this.transparentBackground)
        el.innerHTML = ''
        el.appendChild(this.slot)
        let group = el
        const newGroup = () => {
            group = el.appendChild(Object.assign(document.createElement('div'), {className: 'tb-group'}))
        }
        /**
         * kind: 'tool' (one of a set, solid when on), 'toggle' (soft when on), 'menu' (caret; a dot when not the default),
         * 'action' (no state)
         */
        const btn = (icon: string, tip: string, keys: string, fn: (b: HTMLButtonElement) => void,
            kind: 'tool' | 'toggle' | 'menu' | 'action' = 'action', on = false, disabled = false) => {
            const b = document.createElement('button')
            b.className = `tb-btn tb-k-${kind}` + (on ? ' on' : '')
            b.innerHTML = icon + (kind === 'menu' ? I.caret : '')
            b.setAttribute('aria-label', tip)
            if (kind === 'tool' || kind === 'toggle') b.setAttribute('aria-pressed', String(on))
            b.disabled = disabled
            b.addEventListener('pointerdown', e => e.preventDefault()) // keep the focus where it is
            b.addEventListener('click', () => {
                this._hideTip()
                fn(b)
            })
            b.addEventListener('pointerenter', () => this._showTip(b, tip, keys))
            b.addEventListener('pointerleave', () => this._hideTip())
            group.appendChild(b)
            return b
        }
        const v = this._viewMode
        const viewer = this._viewer
        const notes = viewer?.getPlugin(AnnotationsPlugin)
        // 1. tools: what a drag does
        if (!v) {
            newGroup()
            const g = this._uxTools ? '' : ' gizmo'
            const pen = viewer?.getPlugin(PenToolPlugin)
            btn(I.pointer, 'Select', 'V', () => this.setGizmo('off'), 'tool', this._gizmo === 'off' && !pen?.active)
            btn(I.move, 'Move' + g, 'W', () => this.setGizmo('translate'), 'tool', this._gizmo === 'translate')
            btn(I.rotate, 'Rotate' + g, 'E', () => this.setGizmo('rotate'), 'tool', this._gizmo === 'rotate')
            btn(I.scale, 'Scale' + g, 'R', () => this.setGizmo('scale'), 'tool', this._gizmo === 'scale')
            if (!this._uxTools) btn(I.dots, 'Gizmo space and size', '', b => this._openMenu(b, this._gizmoMenu()), 'menu', false, this._gizmo === 'off')
            if (pen) btn(I.pen, pen.active ? 'Pen: Enter or click here to finish the path' : 'Pen: draw a path (curve) point by point', 'P', () => pen.toggle(), 'tool', pen.active)
            if (notes) btn(I.pin, notes.adding ? 'Click a surface to place it (Esc cancels)' : 'Annotate: a note on a surface, with this camera view', 'N', () => this.annotate(), 'toggle', notes.adding)
            // 2. create
            newGroup()
            btn(I.plus, 'Add an object', '', b => this._openMenu(b, this._addMenu()), 'menu', false, !viewer?.getPlugin(Object3DGeneratorPlugin))
        }
        // 3. how the view looks: camera, shading, overlays
        newGroup()
        btn(I.camera, 'Camera', '0', b => this._openMenu(b, () => this._cameraMenu()), 'menu', !!viewer?.getPlugin(SelectionUxPlugin)?.viewCamera)
        btn(I.shading, 'Shading: lit, clay, wireframe, debug views, lights and environment', '', b => this._openMenu(b, () => this._viewMenu()), 'menu', this._view !== 'shaded' || this.overrides.active)
        btn(I.overlays, 'Overlays: grid, icons, outlines, labels, effects', '', b => this._openMenu(b, () => this._overlaysMenu()), 'menu', this._overlaysChanged())
        // 4. edit or present
        newGroup()
        const seg = document.createElement('div')
        seg.className = 'tb-seg' + (v ? ' tb-seg-2' : '')
        seg.setAttribute('role', 'radiogroup')
        for (const [label, val, tip] of [['Edit', false, 'Select and change things'], ['View', true, 'The scene as a visitor sees it']] as const) {
            const b = document.createElement('button')
            b.textContent = label
            b.className = v === val ? 'on' : ''
            b.setAttribute('role', 'radio')
            b.setAttribute('aria-checked', String(v === val))
            b.addEventListener('click', () => {
                this._hideTip()
                this.setViewMode(val)
            })
            b.addEventListener('pointerenter', () => this._showTip(b, tip, ''))
            b.addEventListener('pointerleave', () => this._hideTip())
            seg.appendChild(b)
        }
        group.appendChild(seg)
        // 5. history and focus
        newGroup()
        btn(I.focus, 'Zoom to the selection, or to everything', 'F', () => {
            const p = viewer?.getPlugin(PickingPlugin)
            if (p?.getSelectedObject()) p.focusSelected()
            else viewer?.fitToView(undefined, 1.25, 800, 'easeOut')
        })
        if (!v) {
            btn(I.undo, 'Undo', 'Ctrl Z', () => this._undo())
            btn(I.redo, 'Redo', 'Ctrl Shift Z', () => this._undo(true))
        }
        // 6. motion: animations, auto-rotate, annotation tour
        newGroup()
        const playing = !!viewer?.timeline.running
        btn(playing ? I.pause : I.play, playing ? 'Pause the animations' : 'Play the animations (timeline)', '', () => {
            const t = viewer!.timeline
            if (t.running) t.stop()
            else {
                // from where it is; from the start when it is at the end
                if (t.endTime > 0 && t.time >= t.endTime - 1e-3) t.setTime(0)
                t.start()
            }
        }, 'toggle', playing)
        const bar = viewer?.getPlugin(TimelineBarPlugin)
        if (bar) {
            btn(I.timeline, 'Timeline: the animations, camera paths and Record', '', () => {
                bar.toggle()
                this.render()
            }, 'toggle', bar.visible)
            btn(I.record, 'Record a video of the timeline', '', () => bar.openRecordDialog())
        }
        const controls = viewer?.scene.mainCamera.controls as any
        btn(I.orbit, 'Auto-rotate the camera', '', () => {
            if (controls?.autoRotate === undefined) return
            controls.autoRotate = !controls.autoRotate
            this.render()
        }, 'toggle', !!controls?.autoRotate, controls?.autoRotate === undefined)
        if (v && notes?.getAnnotations().length) btn(notes.touring ? I.stop : I.tour, notes.touring ? 'Stop the tour' : 'Tour: go through the annotations', '', () => {
            if (notes.touring) notes.stopTour()
            else notes.playTour(4500)
            this.render()
        }, 'toggle', notes.touring)
        // 7. output and the rest
        newGroup()
        btn(I.snapshot, 'Snapshot: save a PNG of the view', '', () => void this.snapshot())
        btn(I.save, 'Save .glb, with the scene notes and annotations', '', () => void this.saveGlb())
        btn(I.dots, 'More', '', b => this._openMenu(b, () => this._moreMenu()), 'menu')
        btn(this._expanded ? I.shrink : I.expand, this._expanded ? 'Show the panels' : 'Expand the canvas', 'Shift Space', () => this.setExpanded(!this._expanded), 'toggle', this._expanded)
    }

    /** Download a PNG of the canvas */
    /** Remove every object and annotation; one undo step brings them back (nothing is disposed) */
    clearScene() {
        const viewer = this._viewer
        if (!viewer) return
        const root = viewer.scene.modelRoot
        const kids = [...root.children]
        const notes = viewer.getPlugin(AnnotationsPlugin)
        const saved = notes ? notes.toJSON() : undefined
        viewer.getPlugin(PickingPlugin)?.setSelectedObject(undefined, false, false)
        const apply = () => {
            notes?.clear()
            for (const k of kids) k.removeFromParent()
            viewer.scene.setDirty({refreshScene: true})
        }
        const revert = () => {
            for (const k of kids) root.add(k)
            if (notes && saved) notes.fromJSON(saved)
            viewer.scene.setDirty({refreshScene: true})
        }
        apply()
        viewer.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo: revert, redo: apply})
    }

    /** A PNG of the view as a visitor sees it: for that frame no selection (outline, gizmo), grid or 3D widgets */
    async snapshot() {
        const viewer = this._viewer
        if (!viewer) return
        const picking = viewer.getPlugin(PickingPlugin)
        const sel = (picking?.getSelectedObjects?.() ?? []) as IObject3D[]
        const widgets = viewer.getPlugin(Object3DWidgetsPlugin)
        const grid = this._grid?.visible
        picking?.setSelectedObject(undefined, false, false)
        widgets?.disable(KEY + 'Snapshot')
        this._tc?.disable(KEY + 'Snapshot')
        if (this._grid) this._grid.visible = false
        viewer.setDirty()
        await viewer.doOnce('postFrame')
        const blob = await viewer.getScreenshotBlob({mimeType: 'image/png'})
        if (this._grid && grid !== undefined) this._grid.visible = grid
        widgets?.enable(KEY + 'Snapshot')
        this._tc?.enable(KEY + 'Snapshot')
        if (sel.length) viewer.getPlugin(SelectionUxPlugin)?.select(sel)
        viewer.setDirty()
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'snapshot.png'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }

    /** Like Blender's overlays and Unity's gizmos menu: what is drawn over the scene, toggled without closing the menu */
    private _overlaysMenu(): MenuItem[] {
        const viewer = this._viewer
        if (!viewer) return []
        const ux = viewer.getPlugin(SelectionUxPlugin)
        const st = ux?.settings
        const set = (k: keyof NonNullable<typeof st>, val: any) => {
            if (!ux) return
            const settings: Record<string, any> = ux.settings
            settings[k] = val
            ux.applySettings()
        }
        const notes = viewer.getPlugin(AnnotationsPlugin)
        const perf = viewer.getPlugin('PerfPanelPlugin') as any
        const items: MenuItem[] = ['#Viewport']
        if (this._grid) items.push(['Grid', () => {
            this._grid!.userData.toolbarOn = !this._gridOn
            this.setGrid(this._gridOn)
        }, this._gridOn, true])
        items.push(['Background', () => this.setBackground(this._bgHidden), !this._bgHidden, true])
        if (EFFECT_PLUGINS.some(t => viewer.getPlugin(t))) items.push(['Effects (post-processing)', () => this.setEffects(this._effectsOff), !this._effectsOff, true])
        items.push('#Lights and cameras')
        if (ux) {
            items.push(['Icons', () => ux.setObjectHelpers(!ux.iconsShown, ux.widgetsShown), ux.iconsShown, true])
            items.push(['3D widgets', () => ux.setObjectHelpers(ux.iconsShown, !ux.widgetsShown), ux.widgetsShown, true])
        } else items.push(['3D widgets', () => this.setWidgets(this._widgetsOff), !this._widgetsOff, true])
        if (notes) items.push(['Annotations', () => {
            notes.enabled = !notes.enabled
            this.render()
        }, notes.enabled, true])
        if (st) {
            items.push('#Selection')
            items.push(['Outline the selection', () => set('outlineSelected', !st.outlineSelected), st.outlineSelected, true])
            items.push(['Outline on hover', () => set('outlineHover', !st.outlineHover), st.outlineHover, true])
            items.push(['Names', () => set('showName', !st.showName), st.showName, true])
            items.push(['Sizes', () => set('showDims', !st.showDims), st.showDims, true])
            items.push(['Smart guides', () => set('smartGuides', !st.smartGuides), st.smartGuides, true])
            items.push(['Hints at the bottom', () => set('showHints', !st.showHints), st.showHints, true])
        }
        if (perf) {
            items.push('#Info')
            items.push(['Performance', () => {
                perf.enabled = !perf.enabled
                this.render()
            }, perf.enabled, true])
        }
        return items
    }

    /** Whether an overlay is off that is on by default (the button shows a dot then) */
    private _overlaysChanged() {
        const viewer = this._viewer
        const ux = viewer?.getPlugin(SelectionUxPlugin)
        const st = ux?.settings
        const notes = viewer?.getPlugin(AnnotationsPlugin)
        const perf = viewer?.getPlugin('PerfPanelPlugin') as any
        return this._effectsOff || !!this._grid && !this._gridOn || !!ux && (!ux.iconsShown || !ux.widgetsShown) ||
            this._bgHidden || !!notes && !notes.enabled ||
            !!st && (!st.showHints || !st.outlineHover || !st.showName || !st.showDims || !st.smartGuides) || !!perf && !perf.enabled
    }

    private _moreMenu(): MenuItem[] {
        const viewer = this._viewer
        if (!viewer) return []
        const items: MenuItem[] = []
        const pivot = viewer.getPlugin(PivotControlsPlugin)
        if (pivot) items.push(['Pivot controls', () => {
            pivot.enabled = !pivot.enabled
            const edit = viewer.getPlugin(PivotEditPlugin)
            if (edit) edit.enabled = pivot.enabled
        }, pivot.enabled])
        for (const [, title, fn] of this._options.extra || []) items.push([title, fn])
        if (items.length) items.push('-')
        items.push(['Reset all settings…', async() => {
            if (!await confirmBox('Reset all plugin settings to their defaults?', 'Reset', true)) return
            for (const p of Object.values(viewer.plugins)) await (p as any)?.resetDefaults?.()
        }])
        items.push(['Clear the scene…', async() => {
            if (!await confirmBox('Remove all objects and annotations from the scene? Undo brings them back.', 'Clear', true)) return
            this.clearScene()
        }])
        return items
    }

    private _showTip(anchor: HTMLElement, text: string, keys: string) {
        clearTimeout(this._tipTimer)
        // the first tooltip waits a little; moving along the bar shows the next at once
        const delay = this._tip.classList.contains('show') ? 0 : 450
        this._tipTimer = window.setTimeout(() => {
            if (this._menu || !anchor.isConnected) return
            this._tip.innerHTML = text + (keys ? keys.split(' ').map(k => `<kbd>${k}</kbd>`).join('') : '')
            if (!this._tip.isConnected) document.body.appendChild(this._tip)
            const r = anchor.getBoundingClientRect()
            const tr = this._tip.getBoundingClientRect()
            this._tip.style.left = Math.max(8, Math.min(innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2)) + 'px'
            this._tip.style.top = r.bottom + 8 + 'px'
            this._tip.classList.add('show')
        }, delay)
    }

    private _hideTip() {
        clearTimeout(this._tipTimer)
        // stay "warm" briefly so the next button shows its tooltip without the delay
        this._tipTimer = window.setTimeout(() => this._tip.classList.remove('show'), 120)
    }

    private _closeMenuOutside = (e: Event) => {
        if (!this._menu || this._menu.contains(e.target as Node)) return
        // a press on the open menu's own button closes it; the click that follows must not open it again
        if (this._menuAnchor?.contains(e.target as Node)) this._closedByAnchor = {anchor: this._menuAnchor, time: performance.now()}
        this._closeMenu()
    }

    private _closedByAnchor?: {anchor: HTMLElement, time: number}

    private _menuAnchor?: HTMLElement

    private _closeMenu() {
        const m = this._menu
        // the focus goes back to the page, so the scene keys work again
        if (m?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
        m?.remove()
        this._menu = undefined
        this._menuAnchor?.classList.remove('open')
        this._menuAnchor = undefined
    }

    /**
     * items: [label, action, active?, keepOpen?] or '-' for a separator or '#title' for a heading.
     * Pass a function to rebuild the items after a keep-open item (a toggle in the Overlays menu) is clicked.
     */
    private _openMenu(anchor: HTMLElement, list: MenuItem[] | (() => MenuItem[])) {
        const c = this._closedByAnchor
        this._closedByAnchor = undefined
        if (c && c.anchor === anchor && performance.now() - c.time < 600) return
        const items = typeof list === 'function' ? list() : list
        // reopened after a toggle: keep its place (the toolbar re-rendered, so the anchor may be gone), no fade, the same item focused
        const reopen = !!this._menu
        const left = this._menu?.style.left
        const top = this._menu?.style.top
        const focusIndex = this._menu ? Array.from(this._menu.querySelectorAll('[role^="menuitem"]')).indexOf(document.activeElement!) : -1
        const keyboard = !reopen && anchor.matches(':focus-visible')
        this._closeMenu()
        this._hideTip()
        const m = document.createElement('div')
        m.className = 'tb-menu' + (this._options.theme === 'dark' ? ' tb-dark' : '') + (reopen ? ' tb-noanim' : '')
        m.setAttribute('role', 'menu')
        // the open menu has the keys: arrows move, Enter or Space choose, Esc closes (the scene does not see them)
        m.tabIndex = -1
        m.dataset.ownKeys = ''
        for (const it of items) {
            if (typeof it === 'string') {
                const d = document.createElement('div')
                d.className = it === '-' ? 'tb-menu-sep' : 'tb-menu-title'
                if (it !== '-') d.textContent = it.slice(1)
                m.appendChild(d)
                continue
            }
            const [label, fn, on, keep] = it
            const d = document.createElement('div')
            d.className = 'tb-menu-item' + (on ? ' on' : '') + (keep ? ' tb-menu-toggle' : '')
            d.setAttribute('role', keep ? 'menuitemcheckbox' : 'menuitem')
            d.tabIndex = -1
            if (keep) d.setAttribute('aria-checked', String(!!on))
            d.innerHTML = keep ?
                `<span class="tb-label">${label}</span><span class="tb-switch${on ? ' on' : ''}"></span>` :
                `<span class="tb-check">${on ? I.check : ''}</span><span class="tb-label">${label}</span>`
            d.addEventListener('click', () => {
                fn()
                if (keep) this._openMenu(anchor, list) // the same menu, updated, at the same place
                else this._closeMenu()
            })
            m.appendChild(d)
        }
        document.body.appendChild(m)
        const r = anchor.getBoundingClientRect()
        const mr = m.getBoundingClientRect()
        m.style.left = left ?? Math.max(8, Math.min(innerWidth - mr.width - 8, r.left)) + 'px'
        if (items.some(it => typeof it !== 'string' && it[3])) m.classList.add('tb-menu-toggles')
        m.style.top = top ?? r.bottom + 8 + 'px'
        anchor.classList.add('open')
        this._menu = m
        this._menuAnchor = anchor
        const entries = Array.from(m.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
        m.addEventListener('keydown', e => {
            e.stopPropagation()
            const i = entries.indexOf(document.activeElement as HTMLElement)
            if (e.key === 'Escape' || e.key === 'Tab') {
                e.preventDefault()
                this._closeMenu()
                if (anchor.isConnected) anchor.focus()
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const n = entries.length
                const step = e.key === 'ArrowDown' ? 1 : -1
                const from = i >= 0 ? i : step > 0 ? -1 : 0
                entries[(from + step + n) % n]?.focus()
            } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
                e.preventDefault()
                entries[i].click()
            }
        })
        const target = entries[focusIndex] ?? (keyboard ? entries[0] : m)
        target.focus({preventScroll: true})
    }

    private _gizmoMenu() {
        const tc = this._tc?.transformControls
        const items: ([string, () => void, boolean?] | string)[] = ['#Space']
        if (!tc) return items
        items.push(['World', () => tc.setSpace('world'), tc.space === 'world'], ['Local', () => tc.setSpace('local'), tc.space === 'local'], '-', '#Size')
        items.push(['Bigger', () => tc.setSize(tc.size + 0.1)], ['Smaller', () => tc.setSize(Math.max(0.1, tc.size - 0.1))])
        return items
    }

    private _addMenu() {
        const gen = this._viewer?.getPlugin(Object3DGeneratorPlugin)
        const groups: Record<string, [string, () => void][]> = {}
        for (const key of Object.keys(gen?.generators || {})) {
            const [g, ...rest] = key.split('-')
            const name = rest.join(' ') || g
            const group = g === 'geometry' ? 'Shapes' : g[0].toUpperCase() + g.slice(1) + 's'
            ;(groups[group] ||= []).push([(name[0].toUpperCase() + name.slice(1)).replace(/([a-z])([A-Z])/g, '$1 $2'), () => this.addObject(key)])
        }
        const items: ([string, () => void] | string)[] = []
        for (const [g, list] of Object.entries(groups)) items.push('#' + g, ...list)
        return items
    }

    private _cameraMenu() {
        const viewer = this._viewer
        if (!viewer) return []
        const main = viewer.scene.mainCamera
        const ux = viewer.getPlugin(SelectionUxPlugin)
        const edCam = viewer.getPlugin(EditorCameraPlugin)
        const home = edCam?.homeCamera ?? viewer.scene.defaultCamera
        const items: ([string, () => void, boolean?] | string)[] = ['#Editor', ['Editor camera <kbd>0</kbd>', () => home.activateMain(), main === home]]
        // with an editor camera, the default camera is the start view: what a visitor sees first, saved in the file
        const start = edCam?.startCamera as IObject3D | undefined
        const cams: IObject3D[] = start ? [start] : []
        viewer.scene.modelRoot.traverse(o => {
            if ((o as IObject3D).isCamera && (o as any).activateMain) cams.push(o as IObject3D)
        })
        const camName = (c: IObject3D) => c === start ? 'Start view' : c.name || c.type
        if (cams.length) items.push('#Look through', ...cams.map(c => [camName(c), () => (c as any).activateMain(), main === c] as [string, () => void, boolean]))
        if (start && ux && main === home) items.push('-', ['Set the start view to this view', () => ux.alignCameraToView(start)])
        const views = viewer.getPlugin(CameraViewPlugin)
        // only with saved views: without them the loop has nothing to play
        if (views?.cameraViews.length) items.push('-', ['Loop the saved camera views', () => {
            views.viewLooping = !views.viewLooping
        }, views.viewLooping])
        // the camera it moves: the selected one, else the last one looked through; named, so the item says what it does
        const moveCam = ux?.selected.find(o => o.isCamera) ?? ux?.lastViewCamera
        if (ux && cams.length && moveCam && moveCam !== start && main !== moveCam as any) {
            items.push('-', [`Move ${moveCam.name || 'the camera'} to this view <kbd>Ctrl Alt 0</kbd>`, () => ux.alignCameraToView(moveCam)])
            if (ux.viewCamera) items.push([(ux.lockCameraToView ? 'Unlock' : 'Lock') + ' camera to view <kbd>L</kbd>', () => ux.setLockCameraToView(!ux.lockCameraToView), ux.lockCameraToView])
        }
        const cp = viewer.getPlugin(CameraPathPlugin)
        if (cp) items.push('-', ['Animate a camera along a path…', () => cp.openDialog()])
        return items
    }

    private _viewMenu() {
        const ov = this.overrides
        const items: ([string, () => void, boolean?] | string)[] = ['#Materials']
        const names: Record<string, string> = {shaded: 'Shaded (the real materials)', clay: 'Clay', wireframe: 'Wireframe'}
        for (const [k, l] of Object.entries(names)) items.push([l, () => this.setView(k), this._view === k && !ov.material])
        for (const m of ov.materialTypes) {
            items.push([ov.labelOf(m) + (m.key === 'uv' && ov.material === 'uv' ? ' <kbd>click: next set</kbd>' : ''), () => {
                if (this._view !== 'shaded') this.setView('shaded')
                ov.setMaterial(m.key)
            }, ov.material === m.key])
        }
        const presets = (group: 'lights' | 'env') => ov.lightingPresets.filter(p => p.group === group).map(p => [
            ov.loading === p.key ? p.label + ' …' : p.label,
            () => void ov.setLighting(ov.lighting === p.key ? null : p.key),
            ov.lighting === p.key,
        ] as [string, () => void, boolean])
        items.push('-', '#Lights instead of the scene\'s', ...presets('lights'), '#Environment instead of the scene\'s', ...presets('env'))
        if (ov.lighting) items.push('-', ['Back to the scene\'s lighting', () => void ov.setLighting(null)])
        return items
    }

    // endregion
}

/**
 * Fat lines (Line2, MeshLine) are instanced quads that only their line shader turns into lines; drawn with an override
 * material they show as big rectangles. While an override is on, line materials opt out of it and keep their own look.
 */
export function keepLinesOutOfOverride(viewer: ThreeViewer, on: boolean) {
    viewer.scene.traverse(o => {
        const mats = (o as any).material
        for (const m of Array.isArray(mats) ? mats : [mats]) if (m?.isLineMaterial) m.allowOverride = !on
    })
    viewer.setDirty()
}

type MenuItem = [string, () => void, boolean?, boolean?] | string

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const I = {
    caret: '<svg class="tb-caret" viewBox="0 0 8 8" width="7" height="7"><path d="M1.5 3l2.5 2.5L6.5 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: svg('<path d="M3.5 8.5l3 3 6-7"/>'),
    pointer: svg('<path d="M4 2.5l8 5.2-3.6.8 2.1 4.2-1.6.8-2.1-4.2L4 12z"/>'),
    move: svg('<path d="M8 1.5v13M1.5 8h13M8 1.5L6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2"/>'),
    rotate: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M12 1.8v2.8H9.2"/>'),
    scale: svg('<path d="M2.5 9.5v4h4M2.5 13.5l5-5M13.5 6.5v-4h-4M13.5 2.5l-5 5"/>'),
    dots: svg('<circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/>'),
    plus: svg('<path d="M8 3v10M3 8h10"/>'),
    pen: svg('<path d="M8 1.8l3.6 6.6L8 14.2 4.4 8.4z"/><circle cx="8" cy="8.6" r="1.1"/><path d="M8 1.8v5.7"/>'),
    shading: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>'),
    overlays: svg('<circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4"/>'),
    pause: svg('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
    orbit: svg('<ellipse cx="8" cy="8" rx="6" ry="2.6"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M12.6 4.6l1.4.8-.9 1.3"/>'),
    tour: svg('<path d="M3 13l3.5-4 3 2.5L13 6"/><circle cx="3" cy="13" r="1"/><circle cx="13" cy="6" r="1"/>'),
    snapshot: svg('<rect x="2" y="4.5" width="12" height="8.5" rx="1.5"/><circle cx="8" cy="8.8" r="2.2"/><path d="M5.5 4.5l1-1.8h3l1 1.8"/>'),
    pin: svg('<path d="M8 14s-4.5-4.2-4.5-7.5a4.5 4.5 0 0 1 9 0C12.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/>'),
    play: svg('<path d="M5 3.5l7.5 4.5L5 12.5z"/>'),
    stop: svg('<rect x="4" y="4" width="8" height="8" rx="1"/>'),
    camera: svg('<path d="M2 5.5h8.5v6H2zM10.5 7.5l3.5-2v6l-3.5-2"/>'),
    eye: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    sparkle: svg('<path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3zM12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"/>'),
    widget: svg('<path d="M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11M8 5.5v5M5.5 8h5"/>'),
    grid: svg('<path d="M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11"/>'),
    background: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 11l3.5-3.5 3 3 2-2L14 12"/>'),
    focus: svg('<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><circle cx="8" cy="8" r="2"/>'),
    undo: svg('<path d="M5 3.5L2.5 6 5 8.5"/><path d="M2.5 6h7a4 4 0 0 1 0 8h-3"/>'),
    redo: svg('<path d="M11 3.5L13.5 6 11 8.5"/><path d="M13.5 6h-7a4 4 0 0 0 0 8h3"/>'),
    save: svg('<path d="M3 2.5h8l2.5 2.5v8.5H3z"/><path d="M5.5 2.5v3.5h4.5V2.5M5.5 13.5V9.5h5v4"/>'),
    timeline: svg('<path d="M2 4.5h12M2 8h12M2 11.5h12" stroke-opacity=".3"/><path d="M3 3h6v3H3zM6 9.8h7v3H6z" fill="currentColor" stroke="none"/>'),
    record: svg('<circle cx="8" cy="8" r="4" fill="#ef4444" stroke="none"/><circle cx="8" cy="8" r="6.2"/>'),
    expand: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
    shrink: svg('<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/>'),
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.tb-root, .tb-menu, .tb-tip {
  --tb-bg: #ffffff; --tb-fg: #1e1e1e; --tb-icon: #444a52; --tb-dim: #8a8f97; --tb-line: #e9eaec; --tb-hover: #f2f3f5; --tb-press: #e8e9ec;
  --tb-accent: #0d99ff; --tb-accent-fg: #ffffff; --tb-soft: #e5f4ff; --tb-soft-fg: #0b84dd; --tb-track: #f0f1f3; --tb-thumb: #ffffff;
  --tb-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.10);
  /* the page's font: tweakpane's when it is there, so the toolbar matches the panels */
  font: 500 11px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif); -webkit-font-smoothing: antialiased;
}
.tb-dark.tb-root, .tb-dark.tb-menu, .tb-dark.tb-tip {
  --tb-bg: #2c2c2c; --tb-fg: #f0f0f0; --tb-icon: #d4d4d4; --tb-dim: #9a9a9a; --tb-line: #3d3d3d; --tb-hover: #383838; --tb-press: #444;
  --tb-soft: rgba(13,153,255,.22); --tb-soft-fg: #7cc6ff; --tb-track: #383838; --tb-thumb: #555;
  --tb-shadow: 0 0 0 1px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.35);
}
/* with the tweakpane UI on the page, take its theme colours (body.tpTheme-black / dark / blue / light / white) */
body[class*="tpTheme-"] .tb-root, body[class*="tpTheme-"] .tb-menu {
  --tb-bg: var(--tp-base-background-color, #1c2026); --tb-fg: var(--tp-container-foreground-color, #f0f0f0);
  --tb-icon: var(--tp-label-foreground-color, #d2d3d5); --tb-dim: var(--tp-monitor-foreground-color, #9a9a9a);
  --tb-line: var(--tp-container-border-color, rgba(255,255,255,.14)); --tb-hover: var(--tp-button-background-color-hover, rgba(255,255,255,.09));
  --tb-press: var(--tp-button-background-color-active, rgba(255,255,255,.15)); --tb-track: var(--tp-input-background-color, rgba(255,255,255,.07));
  --tb-thumb: var(--tp-button-background-color, rgba(255,255,255,.18)); --tb-soft: rgba(13,153,255,.2);
}
body.tpTheme-black .tb-root, body.tpTheme-dark .tb-root, body.tpTheme-blue .tb-root, body.tpTheme-figma-dark .tb-root,
body.tpTheme-black .tb-menu, body.tpTheme-dark .tb-menu, body.tpTheme-blue .tb-menu, body.tpTheme-figma-dark .tb-menu {
  --tb-soft-fg: #7cc6ff; --tb-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 6px 20px rgba(0,0,0,.3);
}
.tb-root {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 12; display: flex; align-items: center;
  background: var(--tb-bg); color: var(--tb-fg); padding: 4px; border-radius: 8px; box-shadow: var(--tb-shadow); max-width: calc(100% - 20px);
}
.tb-group { display: flex; align-items: center; gap: 2px; padding: 0 4px; position: relative; flex: none; }
.tb-group + .tb-group::before { content: ''; position: absolute; left: -.5px; top: 6px; bottom: 6px; width: 1px; background: var(--tb-line); }
.tb-slot { display: flex; align-items: center; padding-right: 4px; }
.tb-slot:empty { display: none; }
.tb-btn {
  position: relative; border: 0; background: transparent; color: var(--tb-icon); height: 32px; min-width: 32px; padding: 0 8px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; flex: none; transition: background-color .12s, color .12s;
}
.tb-btn svg { flex: none; }
.tb-k-menu { padding: 0 5px 0 8px; }
.tb-btn .tb-caret { opacity: .55; margin-left: 1px; }
.tb-btn:hover:not(:disabled) { background: var(--tb-hover); color: var(--tb-fg); }
.tb-btn:active:not(:disabled), .tb-btn.open { background: var(--tb-press); color: var(--tb-fg); }
.tb-btn:focus-visible, .tb-seg button:focus-visible { outline: 2px solid var(--tb-accent); outline-offset: 1px; }
.tb-btn:disabled { opacity: .3; cursor: default; }
/* a tool: one of a set, solid when it is the current one */
.tb-k-tool.on, .tb-k-tool.on:hover:not(:disabled) { background: var(--tb-accent); color: var(--tb-accent-fg); }
/* a toggle: soft when on, so a row of toggles does not shout */
.tb-k-toggle.on { color: var(--tb-soft-fg); }
.tb-k-toggle.on:hover:not(:disabled) { background: var(--tb-soft); color: var(--tb-soft-fg); }
/* a menu with a setting that is not the default: a small dot */
.tb-k-menu.on::after { content: ''; position: absolute; top: 5px; right: 5px; width: 5px; height: 5px; border-radius: 50%; background: var(--tb-accent); box-shadow: 0 0 0 1.5px var(--tb-bg); }
.tb-checker { background: repeating-conic-gradient(#e6e7ea 0 25%, #fafafa 0 50%) 0 0 / 16px 16px !important; }
body[class*="tpTheme-"]:not(.tpTheme-light):not(.tpTheme-white):not(.tpTheme-figma) .tb-checker { background: repeating-conic-gradient(#2a2a2e 0 25%, #333338 0 50%) 0 0 / 16px 16px !important; }
.tb-compact .tb-btn { min-width: 27px; padding: 0 5px; }
.tb-compact .tb-group { padding: 0 2px; }
.tb-compact .tb-seg button { padding: 0 7px; }
.tb-compact .sux-mode-label { display: none; }
body.tb-view .tb-slot { display: none; }
.tb-seg { display: inline-flex; background: var(--tb-track); border-radius: 5px; padding: 2px; position: relative; flex: none; }
.tb-seg button {
  position: relative; z-index: 1; border: 0; background: transparent; color: var(--tb-dim); height: 28px; padding: 0 11px; border-radius: 3px; font: inherit; cursor: pointer;
  transition: color .15s;
}
.tb-seg button:hover { color: var(--tb-fg); }
.tb-seg button.on { color: var(--tb-fg); background: var(--tb-thumb); box-shadow: 0 0 0 .5px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.12); }
.tb-menu {
  position: fixed; z-index: 1000; min-width: 200px; background: var(--tb-bg); color: var(--tb-fg); border-radius: 6px; padding: 4px;
  box-shadow: var(--tb-shadow); max-height: 70vh; overflow: auto; animation: tb-in .12s ease-out;
}
@keyframes tb-in { from { opacity: 0; transform: translateY(-3px); } }
.tb-menu-item { display: flex; align-items: center; gap: 6px; padding: 0 10px 0 4px; height: 30px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.tb-menu-item:hover, .tb-menu-item:focus { background: var(--tb-hover); outline: none; }
.tb-menu:focus { outline: none; }
.tb-menu.tb-noanim { animation: none; }
.tb-check { width: 16px; height: 16px; flex: none; color: var(--tb-accent); }
.tb-label { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.tb-menu kbd, .tb-tip kbd { font: inherit; font-size: 10px; color: var(--tb-dim); background: var(--tb-track); border-radius: 4px; padding: 2px 5px; margin-left: 4px; }
.tb-menu-toggle { padding: 0 8px 0 10px; }
.tb-menu-toggles .tb-menu-title { padding-left: 10px; }
.tb-menu-toggle .tb-label { justify-content: flex-start; }
.tb-switch { position: relative; width: 24px; height: 14px; border-radius: 7px; background: var(--tb-press); flex: none; transition: background-color .12s; }
.tb-switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .12s; }
.tb-switch.on { background: var(--tb-accent); }
.tb-switch.on::after { transform: translateX(10px); }
.tb-menu-title { color: var(--tb-dim); padding: 9px 10px 5px 26px; font-size: 10px; font-weight: 600; letter-spacing: .02em; }
.tb-menu-sep { height: 1px; background: var(--tb-line); margin: 5px 4px; }
.tb-tip {
  position: fixed; z-index: 1001; pointer-events: none; background: #1e1e1e; color: #fff; border-radius: 4px; padding: 6px 8px; white-space: nowrap;
  opacity: 0; transform: translateY(-2px); transition: opacity .1s, transform .1s; box-shadow: 0 4px 14px rgba(0,0,0,.18);
}
.tb-tip.show { opacity: 1; transform: none; }
.tb-tip kbd { color: #bdbdbd; background: #3a3a3a; }
.tb-root .sux-mode-btn { height: 32px; padding: 0 8px 0 10px; border-radius: 4px; background: transparent; color: var(--tb-fg); box-shadow: none; font-weight: 500; }
.tb-root .sux-mode-btn b { color: var(--tb-accent); }
.tb-root .sux-mode-btn:hover, .tb-root .sux-mode-btn.on { background: var(--tb-hover); color: var(--tb-fg); }
.tb-root .sux-menu { top: calc(100% + 12px); left: -4px; background: var(--tb-bg); color: var(--tb-fg); border-radius: 6px; box-shadow: var(--tb-shadow); }
.tb-root .sux-menu-item { border-radius: 4px; }
.tb-root .sux-menu-item:hover { background: var(--tb-hover); }
.tb-root .sux-menu-item.on { background: var(--tb-soft); }
.tb-root .sux-menu-item.on b, .tb-root .sux-menu-item.on .d { color: var(--tb-soft-fg); }
.tb-root .sux-menu-item > b { color: var(--tb-accent); }
.tb-root .sux-menu-item .d, .tb-root .sux-menu-plain kbd { color: var(--tb-dim); }
.tb-root .sux-menu-sep { background: var(--tb-line); }
`
    document.head.appendChild(st)
}
