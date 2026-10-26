import {
    AViewerPluginSync,
    GridHelper,
    IObject3D,
    Material,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'
import {AnnotationsPlugin} from './AnnotationsPlugin'
import {SceneOverrides} from './SceneOverrides'

export interface EditorToolbarOptions {
    /** Add a floor grid the toolbar can show and hide */
    grid?: boolean
    /** Elements hidden by "Expand canvas" (Shift+Space), e.g. side panels */
    expandHides?: () => HTMLElement[]
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

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
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
        viewer.forPlugin(AnnotationsPlugin, a => {
            a.addEventListener('annotationChange', this.render)
            a.editable = !this._viewMode
        }, a => a.removeEventListener('annotationChange', this.render))
        this._wasLegacy = !this._uxTools
        this.render()
    }

    private _wasLegacy = false
    /** A mode change to or from "Current" moves the active tool between the classic gizmo and the selection UX */
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
        window.removeEventListener('keydown', this._onKey)
        window.removeEventListener('pointerdown', this._closeMenuOutside, true)
        viewer.scene.removeEventListener('mainCameraChange', this.render)
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

    /** True when the selection plugin draws its own handles (any mode but "Current"): V W E R switch its tools then */
    private get _uxTools() {
        const ux = this._viewer?.getPlugin(SelectionUxPlugin)
        return ux && ux.enabled && ux.settings.visual !== 'legacy' ? ux : undefined
    }

    /**
     * V: select. W/E/R: move, rotate, scale. With the new selection UX these are its on-canvas tools;
     * in the "Current" mode (and without the plugin) they are the classic transform gizmo.
     */
    setGizmo(mode: 'off' | 'translate' | 'rotate' | 'scale') {
        if (!this._viewer) return
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
        viewer.getPlugin(SelectionUxPlugin)?.select([obj])
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

    setBackground(on: boolean) {
        const rp = this._viewer?.renderManager.renderPass
        if (rp) rp.renderBackground = on
        this._viewer?.setDirty()
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
        const notes = viewer.getPlugin(AnnotationsPlugin)
        if (notes) notes.editable = !view
        if (this._grid) this._grid.visible = !view && this._gridOn
        viewer.setDirty()
        this.render()
    }

    private get _gridOn() {
        return this._grid ? this._grid.userData.toolbarOn !== false : false
    }

    private _containerStyle: string | null = null

    /** The canvas fills the window, the panels in {@link EditorToolbarOptions.expandHides} hide */
    setExpanded(v: boolean) {
        if (v === this._expanded) return
        this._expanded = v
        for (const el of this._options.expandHides?.() || []) el.style.display = v ? 'none' : ''
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
        else a.startAdding()
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
        const g = ({KeyV: 'off', KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale'} as const)[e.code as 'KeyV']
        if (g) this.setGizmo(g)
    }

    // endregion

    // region drawing

    render = () => {
        const el = this.element
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
        if (!v) {
            newGroup()
            const g = this._uxTools ? '' : ' gizmo'
            btn(I.pointer, 'Select', 'V', () => this.setGizmo('off'), 'tool', this._gizmo === 'off')
            btn(I.move, 'Move' + g, 'W', () => this.setGizmo('translate'), 'tool', this._gizmo === 'translate')
            btn(I.rotate, 'Rotate' + g, 'E', () => this.setGizmo('rotate'), 'tool', this._gizmo === 'rotate')
            btn(I.scale, 'Scale' + g, 'R', () => this.setGizmo('scale'), 'tool', this._gizmo === 'scale')
            if (!this._uxTools) btn(I.dots, 'Gizmo space and size', '', b => this._openMenu(b, this._gizmoMenu()), 'menu', false, this._gizmo === 'off')
            newGroup()
            btn(I.plus, 'Add an object', '', b => this._openMenu(b, this._addMenu()), 'menu', false, !viewer?.getPlugin(Object3DGeneratorPlugin))
            const notes = viewer?.getPlugin(AnnotationsPlugin)
            if (notes) btn(I.pin, notes.adding ? 'Click a surface to place it (Esc cancels)' : 'Add an annotation: a note on a surface, with this camera view', 'N', () => this.annotate(), 'toggle', notes.adding)
        }
        const tour = viewer?.getPlugin(AnnotationsPlugin)
        if (v && tour?.getAnnotations().length) {
            newGroup()
            btn(tour.touring ? I.stop : I.play, tour.touring ? 'Stop the tour' : 'Tour: go through the annotations', '', () => {
                if (tour.touring) tour.stopTour()
                else tour.playTour(4500)
                this.render()
            }, 'toggle', tour.touring)
        }
        newGroup()
        btn(I.camera, 'Camera', '0', b => this._openMenu(b, this._cameraMenu()), 'menu', viewer?.scene.mainCamera !== viewer?.scene.defaultCamera)
        btn(I.eye, 'View as: debug views, lights and environment', '', b => this._openMenu(b, this._viewMenu()), 'menu', this._view !== 'shaded' || this.overrides.active)
        if (!v) {
            newGroup()
            btn(I.sparkle, 'Effects (post-processing)', '', () => this.setEffects(this._effectsOff), 'toggle', !this._effectsOff)
            btn(I.widget, 'Widgets: 3D helpers of lights, cameras, lines', '', () => this.setWidgets(this._widgetsOff), 'toggle', !this._widgetsOff, !viewer?.getPlugin(Object3DWidgetsPlugin))
            btn(I.grid, 'Grid', '', () => {
                if (this._grid) this._grid.userData.toolbarOn = !this._gridOn
                this.setGrid(this._gridOn)
            }, 'toggle', this._gridOn, !this._grid)
            btn(I.background, 'Background', '', () => this.setBackground(!viewer?.renderManager.renderPass.renderBackground), 'toggle', !!viewer?.renderManager.renderPass.renderBackground)
        }
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
        newGroup()
        btn(I.save, 'Save .glb, with the scene notes', '', () => void this.saveGlb())
        for (const [icon, title, fn] of this._options.extra || []) btn(icon, title, '', fn)
        btn(this._expanded ? I.shrink : I.expand, this._expanded ? 'Show the panels' : 'Expand the canvas', 'Shift Space', () => this.setExpanded(!this._expanded), 'toggle', this._expanded)
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
        if (this._menu && !this._menu.contains(e.target as Node)) this._closeMenu()
    }

    private _menuAnchor?: HTMLElement

    private _closeMenu() {
        this._menu?.remove()
        this._menu = undefined
        this._menuAnchor?.classList.remove('open')
        this._menuAnchor = undefined
    }

    /** items: [label, action, active?] or '-' for a separator or '#title' for a heading */
    private _openMenu(anchor: HTMLElement, items: ([string, () => void, boolean?] | string)[]) {
        this._closeMenu()
        this._hideTip()
        const m = document.createElement('div')
        m.className = 'tb-menu' + (this._options.theme === 'dark' ? ' tb-dark' : '')
        m.setAttribute('role', 'menu')
        for (const it of items) {
            if (typeof it === 'string') {
                const d = document.createElement('div')
                d.className = it === '-' ? 'tb-menu-sep' : 'tb-menu-title'
                if (it !== '-') d.textContent = it.slice(1)
                m.appendChild(d)
                continue
            }
            const [label, fn, on] = it
            const d = document.createElement('div')
            d.className = 'tb-menu-item' + (on ? ' on' : '')
            d.setAttribute('role', 'menuitem')
            d.innerHTML = `<span class="tb-check">${on ? I.check : ''}</span><span class="tb-label">${label}</span>`
            d.addEventListener('click', () => {
                fn()
                this._closeMenu()
            })
            m.appendChild(d)
        }
        document.body.appendChild(m)
        const r = anchor.getBoundingClientRect()
        const mr = m.getBoundingClientRect()
        m.style.left = Math.max(8, Math.min(innerWidth - mr.width - 8, r.left)) + 'px'
        m.style.top = r.bottom + 8 + 'px'
        anchor.classList.add('open')
        this._menu = m
        this._menuAnchor = anchor
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
            ;(groups[group] ||= []).push([name[0].toUpperCase() + name.slice(1), () => this.addObject(key)])
        }
        const items: ([string, () => void] | string)[] = []
        for (const [g, list] of Object.entries(groups)) items.push('#' + g, ...list)
        return items
    }

    private _cameraMenu() {
        const viewer = this._viewer
        if (!viewer) return []
        const main = viewer.scene.mainCamera
        const items: ([string, () => void, boolean?] | string)[] = ['#Editor', ['Editor camera <kbd>0</kbd>', () => viewer.scene.defaultCamera.activateMain(), main === viewer.scene.defaultCamera]]
        const cams: IObject3D[] = []
        viewer.scene.modelRoot.traverse(o => {
            if ((o as IObject3D).isCamera && (o as any).activateMain) cams.push(o as IObject3D)
        })
        if (cams.length) items.push('#Look through', ...cams.map(c => [c.name || c.type, () => (c as any).activateMain(), main === c] as [string, () => void, boolean]))
        const ux = viewer.getPlugin(SelectionUxPlugin)
        if (ux && cams.length) {
            items.push('-', ['Move the selected camera to this view <kbd>Ctrl Alt 0</kbd>', () => ux.alignCameraToView()])
            if (ux.viewCamera) items.push([(ux.lockCameraToView ? 'Unlock' : 'Lock') + ' camera to view <kbd>L</kbd>', () => ux.setLockCameraToView(!ux.lockCameraToView), ux.lockCameraToView])
        }
        return items
    }

    private _viewMenu() {
        const ov = this.overrides
        const items: ([string, () => void, boolean?] | string)[] = ['#Materials']
        const names: Record<string, string> = {shaded: 'Shaded (the real materials)', clay: 'Clay', wireframe: 'Wireframe'}
        for (const [k, l] of Object.entries(names)) items.push([l, () => this.setView(k), this._view === k && !ov.material])
        for (const m of ov.materialTypes) {
            items.push([ov.labelOf(m) + (m.key === 'uv' && ov.material === 'uv' ? ' <kbd>again: next set</kbd>' : ''), () => {
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
  font: 500 11px/1 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
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
body.tpTheme-black .tb-root, body.tpTheme-dark .tb-root, body.tpTheme-blue .tb-root,
body.tpTheme-black .tb-menu, body.tpTheme-dark .tb-menu, body.tpTheme-blue .tb-menu {
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
.tb-menu-item:hover { background: var(--tb-hover); }
.tb-check { width: 16px; height: 16px; flex: none; color: var(--tb-accent); }
.tb-label { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.tb-menu kbd, .tb-tip kbd { font: inherit; font-size: 10px; color: var(--tb-dim); background: var(--tb-track); border-radius: 4px; padding: 2px 5px; margin-left: 4px; }
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
