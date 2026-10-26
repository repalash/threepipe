import {
    AViewerPluginSync,
    GridHelper,
    IObject3D,
    Material,
    MeshBasicMaterial,
    MeshDepthMaterial,
    MeshNormalMaterial,
    MeshStandardMaterial,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    ShaderMaterial,
    ThreeViewer,
    TransformControlsPlugin,
    UndoManagerPlugin,
    Vector3,
} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'

export interface EditorToolbarOptions {
    /** Add a floor grid the toolbar can show and hide */
    grid?: boolean
    /** Elements hidden by "Expand canvas" (Shift+Space), e.g. side panels */
    expandHides?: () => HTMLElement[]
    /** Extra buttons at the end: [label or svg, title, action] */
    extra?: [string, string, () => void][]
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

    constructor(options: EditorToolbarOptions = {}) {
        super()
        this._options = options
        injectStyles()
        this.element = document.createElement('div')
        this.element.className = 'tb-root'
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
            viewer.scene.add(this._grid)
        }
        window.addEventListener('keydown', this._onKey)
        window.addEventListener('pointerdown', this._closeMenuOutside, true)
        viewer.scene.addEventListener('mainCameraChange', this.render)
        this.render()
    }

    onRemove(viewer: ThreeViewer) {
        window.removeEventListener('keydown', this._onKey)
        window.removeEventListener('pointerdown', this._closeMenuOutside, true)
        viewer.scene.removeEventListener('mainCameraChange', this.render)
        this._grid?.removeFromParent()
        this.element.remove()
        super.onRemove(viewer)
    }

    // region actions

    private get _tc() {
        return this._viewer?.getPlugin(TransformControlsPlugin)
    }

    /** V: select only. W/E/R: the transform gizmo in that mode */
    setGizmo(mode: 'off' | 'translate' | 'rotate' | 'scale') {
        if (!this._viewer) return
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

    private _viewMaterials: Record<string, () => Material | undefined> = {
        shaded: () => undefined,
        clay: () => new MeshStandardMaterial({color: 0xd8d8d8, roughness: 0.65, metalness: 0}),
        normals: () => new MeshNormalMaterial(),
        wireframe: () => new MeshBasicMaterial({color: 0x333a44, wireframe: true}),
        depth: () => new MeshDepthMaterial(),
        uv: () => new ShaderMaterial({
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'varying vec2 vUv; void main(){ vec2 c = floor(fract(vUv) * 8.); float k = mod(c.x + c.y, 2.); gl_FragColor = vec4(mix(vec3(vUv, 0.), vec3(1.), k * .25), 1.); }',
        }),
    }

    /** Draw every mesh with one material: normals, clay, wireframe, depth, UV checker; "shaded" is the real materials */
    setView(view: string) {
        const rp = this._viewer?.renderManager.renderPass as any
        if (!rp) return
        rp.overrideMaterial?.dispose?.()
        rp.overrideMaterial = this._viewMaterials[view]?.() ?? null
        this._view = view
        this._viewer?.setDirty()
        this.render()
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
        if (this._grid) this._grid.visible = !view && this._gridOn
        viewer.setDirty()
        this.render()
    }

    private get _gridOn() {
        return this._grid ? this._grid.userData.toolbarOn !== false : false
    }

    setExpanded(v: boolean) {
        this._expanded = v
        for (const el of this._options.expandHides?.() || []) el.style.display = v ? 'none' : ''
        document.body.classList.toggle('tb-expanded', v)
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
        const g = ({KeyV: 'off', KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale'} as const)[e.code as 'KeyV']
        if (g) this.setGizmo(g)
    }

    // endregion

    // region drawing

    render = () => {
        const el = this.element
        el.innerHTML = ''
        el.appendChild(this.slot)
        const sep = () => el.appendChild(Object.assign(document.createElement('span'), {className: 'tb-sep'}))
        const btn = (icon: string, title: string, fn: (b: HTMLButtonElement) => void, on = false, disabled = false) => {
            const b = document.createElement('button')
            b.className = 'tb-btn' + (on ? ' on' : '')
            b.innerHTML = icon
            b.title = title
            b.disabled = disabled
            b.addEventListener('pointerdown', e => e.preventDefault()) // keep the focus where it is
            b.addEventListener('click', () => fn(b))
            el.appendChild(b)
            return b
        }
        const v = this._viewMode
        sep()
        if (!v) {
            btn(I.pointer, 'Select (V)', () => this.setGizmo('off'), this._gizmo === 'off')
            btn(I.move, 'Move gizmo (W)', () => this.setGizmo('translate'), this._gizmo === 'translate')
            btn(I.rotate, 'Rotate gizmo (E)', () => this.setGizmo('rotate'), this._gizmo === 'rotate')
            btn(I.scale, 'Scale gizmo (R)', () => this.setGizmo('scale'), this._gizmo === 'scale')
            btn(I.dots, 'Gizmo space and size', b => this._openMenu(b, this._gizmoMenu()), false, this._gizmo === 'off')
            sep()
            btn(I.plus, 'Add an object', b => this._openMenu(b, this._addMenu()), false, !this._viewer?.getPlugin(Object3DGeneratorPlugin))
            sep()
        }
        btn(I.camera, 'Camera', b => this._openMenu(b, this._cameraMenu()), this._viewer?.scene.mainCamera !== this._viewer?.scene.defaultCamera)
        btn(I.eye, 'View as (overrides the materials)', b => this._openMenu(b, this._viewMenu()), this._view !== 'shaded')
        if (!v) {
            btn(I.sparkle, 'Effects (post-processing)', () => this.setEffects(this._effectsOff), !this._effectsOff)
            btn(I.widget, 'Widgets (3D helpers of lights, cameras, lines)', () => this.setWidgets(this._widgetsOff), !this._widgetsOff, !this._viewer?.getPlugin(Object3DWidgetsPlugin))
            btn(I.grid, 'Grid', () => {
                if (this._grid) this._grid.userData.toolbarOn = !this._gridOn
                this.setGrid(this._gridOn)
            }, this._gridOn, !this._grid)
            btn(I.background, 'Background', () => this.setBackground(!this._viewer?.renderManager.renderPass.renderBackground), !!this._viewer?.renderManager.renderPass.renderBackground)
        }
        sep()
        const seg = document.createElement('span')
        seg.className = 'tb-seg'
        for (const [label, val] of [['Edit', false], ['View', true]] as const) {
            const b = document.createElement('button')
            b.textContent = label
            b.className = v === val ? 'on' : ''
            b.title = val ? 'View: the scene as a visitor sees it' : 'Edit: select and change things'
            b.addEventListener('click', () => this.setViewMode(val))
            seg.appendChild(b)
        }
        el.appendChild(seg)
        sep()
        btn(I.focus, 'Zoom to selection (F) · to all (Shift+1)', () => {
            const p = this._viewer?.getPlugin(PickingPlugin)
            if (p?.getSelectedObject()) p.focusSelected()
            else this._viewer?.fitToView(undefined, 1.25, 800, 'easeOut')
        })
        if (!v) {
            btn(I.undo, 'Undo (Ctrl+Z)', () => this._undo())
            btn(I.redo, 'Redo (Ctrl+Shift+Z)', () => this._undo(true))
        }
        btn(I.save, 'Save .glb (with the scene notes)', () => void this.saveGlb())
        for (const [icon, title, fn] of this._options.extra || []) btn(icon, title, fn)
        btn(this._expanded ? I.shrink : I.expand, 'Expand the canvas (Shift+Space)', () => this.setExpanded(!this._expanded), this._expanded)
    }

    private _closeMenuOutside = (e: Event) => {
        if (this._menu && !this._menu.contains(e.target as Node)) this._closeMenu()
    }

    private _closeMenu() {
        this._menu?.remove()
        this._menu = undefined
    }

    /** items: [label, action, active?] or '-' for a separator or '#title' for a heading */
    private _openMenu(anchor: HTMLElement, items: ([string, () => void, boolean?] | string)[]) {
        this._closeMenu()
        const m = document.createElement('div')
        m.className = 'tb-menu'
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
            d.innerHTML = label
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
        m.style.top = r.bottom + 6 + 'px'
        this._menu = m
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
        const items: ([string, () => void, boolean?] | string)[] = ['#Editor', ['Editor camera', () => viewer.scene.defaultCamera.activateMain(), main === viewer.scene.defaultCamera]]
        const cams: IObject3D[] = []
        viewer.scene.modelRoot.traverse(o => {
            if ((o as IObject3D).isCamera && (o as any).activateMain) cams.push(o as IObject3D)
        })
        if (cams.length) items.push('#Scene cameras', ...cams.map(c => [c.name || c.type, () => (c as any).activateMain(), main === c] as [string, () => void, boolean]))
        return items
    }

    private _viewMenu() {
        const names: Record<string, string> = {shaded: 'Shaded (materials)', clay: 'Clay', normals: 'Normals', wireframe: 'Wireframe', depth: 'Depth', uv: 'UV checker'}
        return Object.entries(names).map(([k, l]) => [l, () => this.setView(k), this._view === k] as [string, () => void, boolean])
    }

    // endregion
}

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const I = {
    pointer: svg('<path d="M4 2.5l8 5.2-3.6.8 2.1 4.2-1.6.8-2.1-4.2L4 12z"/>'),
    move: svg('<path d="M8 1.5v13M1.5 8h13M8 1.5L6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2"/>'),
    rotate: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M12 1.8v2.8H9.2"/>'),
    scale: svg('<path d="M2.5 9.5v4h4M2.5 13.5l5-5M13.5 6.5v-4h-4M13.5 2.5l-5 5"/>'),
    dots: svg('<circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/>'),
    plus: svg('<path d="M8 3v10M3 8h10"/>'),
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
.tb-root {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 12; display: flex; align-items: center; gap: 2px;
  background: rgba(30,30,30,.94); color: #e6e6e6; padding: 4px; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.2);
  font: 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; max-width: calc(100% - 20px);
}
.tb-slot { display: flex; align-items: center; }
.tb-slot:empty { display: none; }
.tb-slot:empty + .tb-sep { display: none; }
.tb-btn { border: 0; background: transparent; color: #cfcfcf; width: 30px; height: 30px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none; padding: 0; }
.tb-btn:hover:not(:disabled) { background: #3a3a3a; color: #fff; }
.tb-btn.on { background: #0d99ff; color: #fff; }
.tb-btn:disabled { opacity: .35; cursor: default; }
.tb-sep { width: 1px; align-self: stretch; background: #444; margin: 3px 4px; flex: none; }
.tb-seg { display: inline-flex; background: #2a2a2a; border-radius: 7px; padding: 2px; flex: none; }
.tb-seg button { border: 0; background: transparent; color: #bbb; padding: 6px 9px; border-radius: 5px; font: inherit; cursor: pointer; }
.tb-seg button.on { background: #505050; color: #fff; }
.tb-menu { position: fixed; z-index: 1000; min-width: 170px; background: #1e1e1e; color: #fff; border-radius: 9px; padding: 6px; box-shadow: 0 8px 28px rgba(0,0,0,.3);
  font: 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; max-height: 70vh; overflow: auto; }
.tb-menu-item { padding: 7px 9px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.tb-menu-item:hover { background: #2f2f2f; }
.tb-menu-item.on { background: #0d99ff; }
.tb-menu-title { color: #8a8a8a; padding: 8px 9px 3px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.tb-menu-sep { height: 1px; background: #333; margin: 4px 2px; }
`
    document.head.appendChild(st)
}
