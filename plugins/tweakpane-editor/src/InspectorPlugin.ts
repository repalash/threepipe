import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    createStyles,
    IEvent,
    IGeometry,
    IMaterial,
    IObject3D,
    ITexture,
    IViewerEvent,
    MaterialPreviewHandle,
    materialPreviewOptionsFromViewer,
    MaterialPreviewPlugin,
    materialPreviewSettingsKey,
    MaterialPreviewShape,
    onChange,
    PickingPlugin,
    safeSetProperty,
    ThreeViewer,
    uiDropdown,
    uiFolderContainer,
    uiToggle,
    UiObjectConfig,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import type {EditorFrameAreaOptions} from './frame/EditorFrame'
import styles from './InspectorPlugin.css?inline'

/** The tabs of the inspector: the parts of the selection that it shows, one at a time */
export type InspectorTab = 'object' | 'material' | 'geometry' | 'texture'

/** The events of {@link InspectorPlugin} */
export interface InspectorPluginEventMap extends AViewerPluginEventMap {
    /** The panel is turned on or off (`enabled`, `enable`, `disable`): the app that placed {@link InspectorPlugin.element} can take it out or put it back */
    enabledChange: {enabled: boolean}
    /**
     * The selection changed, and the inspector shows it ({@link InspectorPlugin.hasSelection}). An app that swaps the
     * inspector in place of the mode settings (`TweakpaneEditorPlugin.setPanelSection` with `swap`) sets
     * `panelSwapped` from it.
     */
    selectionChange: {hasSelection: boolean}
}

/** The view of the large material preview: the angles around the object and the distance ({@link MaterialPreviewPlugin.request}) */
interface PreviewView {
    yaw: number
    pitch: number
    distance: number
}

const DEFAULT_VIEW: PreviewView = {yaw: 0.5, pitch: 0.25, distance: 1}

const TAB_NAMES: Record<InspectorTab, string> = {object: 'Object', material: 'Material', geometry: 'Geometry', texture: 'Texture'}
const SHAPES: [MaterialPreviewShape, string][] = [['sphere', 'Sphere'], ['cube', 'Cube'], ['mesh', 'This mesh']]

/** The entry of the inspector in the mode bar of the editor frame: 16 px, the line icons of the frame */
const AREA_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/></svg>'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string) {
    const e = document.createElement(tag)
    e.className = className
    return e
}

/**
 * The Tweakpane renderer of the inspector: its container is not `#tweakpaneUiContainer`, which the editor CSS places as
 * the fixed panel of the page (the main Tweakpane UI has that id).
 */
class InspectorUiRenderer extends TweakpaneUiPlugin {
    protected _createUiContainer() {
        const container = super._createUiContainer()
        container.removeAttribute('id')
        container.className = 'isp-ui'
        return container
    }
}

/**
 * Inspector Plugin
 *
 * The settings of the selection of the {@link PickingPlugin}, like the inspector of Unity or the properties panel of
 * Blender: a head with the name of the selection, tabs for its parts (Object, Material, Geometry; Texture for a selected
 * texture), and the uiConfig of the open tab. A pick of another object keeps the open tab when the new selection has it.
 *
 * - The Material tab has a large live preview of the material (with the {@link MaterialPreviewPlugin}): a sphere, a cube
 *   or the selected mesh alone ({@link previewShape}). A drag on it turns it, the wheel zooms, a double-click resets the
 *   view. A mesh with more than one material has a list of its materials.
 * - The settings render in a second Tweakpane renderer, inside {@link element}, with the theme of the page. The plugin
 *   turns off the selection UI of the PickingPlugin while it is added ({@link PickingPlugin.selectionUi}), since a
 *   uiConfig renders in one UI at a time.
 * - Escape (the PickingPlugin) clears the selection.
 *
 * Where the panel goes: in the `container` given to the constructor, else the app puts {@link element} in the page.
 * In the editor frame there are three places, and the app picks one:
 *
 * ```ts
 * const inspector = viewer.addPluginSync(InspectorPlugin)
 * // swap: the right panel shows the inspector while something is selected, the mode settings when nothing is
 * editor.setPanelSection(inspector.element, {swap: true})
 * inspector.addEventListener('selectionChange', e => editor.panelSwapped = e.hasSelection)
 * // or above the mode settings, in the right panel
 * editor.setPanelSection(inspector.element)
 * // or under the layers panel, in the left area
 * editor.setArea('left', [layers.element, inspector.element], LayersPanelPlugin.AreaEntry)
 * ```
 *
 * On the `enabledChange` event, the app takes the inspector out of its place or puts it back.
 */
@uiFolderContainer('Inspector')
export class InspectorPlugin extends AViewerPluginSync<InspectorPluginEventMap> {
    static readonly PluginType = 'InspectorPlugin'
    /** Add the CSS of the panel to the page when the first panel is made. Off: the app brings its own styles. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    /** The size in px of the large preview of the material */
    static PreviewSize = 256
    /** The entry of the panel in the mode bar of the editor frame, for `TweakpaneEditorPlugin.setArea` */
    static AreaEntry: EditorFrameAreaOptions = {name: 'Inspector', icon: AREA_ICON, color: '#0ea5e9'}

    // the settings of the panel are not part of the scene: nothing to save
    toJSON: any = undefined

    dependencies = [PickingPlugin, MaterialPreviewPlugin]

    /** Off: the panel is hidden, and the `enabledChange` event tells the app (which can take it out of its place) */
    @onChange(InspectorPlugin.prototype.setDirty)
    @uiToggle('Enabled')
        enabled = true

    /** The Material tab shows a large live preview of the material */
    @onChange(InspectorPlugin.prototype._requestPreview)
    @uiToggle('Material preview')
        preview = true

    /** The shape of the material preview: a sphere, a cube, or the selected mesh alone (`mesh`) */
    @onChange(InspectorPlugin.prototype._shapeChanged)
    @uiDropdown('Preview shape', SHAPES.map(([value, label]) => ({label, value})))
        previewShape: MaterialPreviewShape = 'sphere'

    readonly element: HTMLDivElement
    readonly container?: HTMLElement

    private _title: HTMLDivElement
    private _tabsEl: HTMLDivElement
    private _materialList: HTMLSelectElement
    private _previewEl: HTMLDivElement
    private _canvas: HTMLCanvasElement
    private _shapesEl: HTMLDivElement
    private _body: HTMLDivElement
    private _empty: HTMLDivElement

    private _ui?: InspectorUiRenderer
    /** The uiConfigs in the renderer: the actions of the open tab, then the uiConfig of its part */
    private _shown: UiObjectConfig[] = []
    /** The actions of the PickingPlugin for the selected object: Focus and Select Parent, and the material actions */
    private _objectActions: UiObjectConfig[] = []
    private _materialActions: UiObjectConfig[] = []
    private _picking?: PickingPlugin
    /** The value of {@link PickingPlugin.selectionUi} before this plugin turned it off */
    private _pickingSelectionUi = true
    private _selected?: IObject3D | IMaterial | IGeometry | ITexture
    private _object?: IObject3D
    private _materials: IMaterial[] = []
    private _material?: IMaterial
    private _geometry?: IGeometry
    private _texture?: ITexture
    private _tab: InspectorTab = 'object'
    private _hasSelection = false
    private _view: PreviewView = {...DEFAULT_VIEW}
    private _handle?: MaterialPreviewHandle
    /** The material whose `materialUpdate` the preview listens to */
    private _watched?: IMaterial
    /** The viewer settings of the last preview request (environment map, tone mapping), see {@link materialPreviewSettingsKey} */
    private _settings = ''
    /** On or off at the last `enabledChange` (set in the constructor, after the first set of `enabled`) */
    private _on?: boolean

    /**
     * @param container - the element that holds the panel while the plugin is added. Without it, the app puts
     * {@link element} in the page (in the editor frame: `TweakpaneEditorPlugin.setPanelSection` or `setArea`).
     */
    constructor(container?: HTMLElement) {
        super()
        this.container = container
        if (InspectorPlugin.InjectStyles && !InspectorPlugin._styles?.isConnected) InspectorPlugin._styles = createStyles(styles)
        this.element = el('div', 'isp-root')
        this._title = this.element.appendChild(el('div', 'isp-title'))
        this._tabsEl = this.element.appendChild(el('div', 'isp-tabs'))
        this._tabsEl.setAttribute('role', 'tablist')
        this._materialList = this.element.appendChild(el('select', 'isp-materials'))
        this._materialList.setAttribute('aria-label', 'Material of the mesh')
        this._materialList.addEventListener('change', () => this._pickMaterial(Number(this._materialList.value)))
        this._previewEl = this.element.appendChild(el('div', 'isp-preview'))
        this._canvas = this._previewEl.appendChild(el('canvas', 'isp-preview-canvas'))
        this._canvas.width = this._canvas.height = InspectorPlugin.PreviewSize
        this._canvas.title = 'Drag to turn, wheel to zoom, double-click to reset'
        this._canvas.setAttribute('aria-label', 'Material preview')
        this._shapesEl = this._previewEl.appendChild(el('div', 'isp-shapes'))
        for (const [shape, name] of SHAPES) {
            const b = this._shapesEl.appendChild(el('button', 'isp-shape'))
            b.type = 'button'
            b.dataset.shape = shape
            b.textContent = name
            b.addEventListener('click', () => {
                this.previewShape = shape
                this.uiConfig?.uiRefresh?.(true)
            })
        }
        this._body = this.element.appendChild(el('div', 'isp-body'))
        this._empty = this.element.appendChild(el('div', 'isp-empty'))
        this._empty.textContent = 'Select an object in the viewport or in the layers'
        this._setupPreviewControls()
        this._shapeChanged()
        this._render()
        this._on = !this.isDisabled()
    }

    /** Something is selected, and the inspector shows it */
    get hasSelection() {
        return this._hasSelection
    }

    /** The open tab. A tab that the selection does not have opens when a selection has it. */
    get tab() {
        return this._tab
    }

    /** Opens a tab ({@link InspectorTab}), when the selection has it */
    setTab(tab: InspectorTab) {
        this._tab = tab
        this._render()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // a second Tweakpane renderer, for the inspector only (the main one shows the modes), with the theme of the page
        this._ui = new InspectorUiRenderer(true, false, this._body, viewer.getPlugin(TweakpaneUiPlugin)?.colorMode)
        this._ui.onAdded(viewer)
        viewer.scene.addEventListener('materialChanged', this._onPartsChanged)
        viewer.scene.addEventListener('geometryChanged', this._onPartsChanged)
        viewer.scene.addEventListener('objectUpdate', this._onObjectUpdate)
        viewer.addEventListener('update', this._onViewerUpdate)
        // the PickingPlugin can be removed and added again
        viewer.addPluginListener('add', this._onPluginAdded, 'PickingPlugin')
        viewer.addPluginListener('remove', this._onPluginRemoved, 'PickingPlugin')
        this._setPicking(viewer.getPlugin(PickingPlugin))
        this._place()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('materialChanged', this._onPartsChanged)
        viewer.scene.removeEventListener('geometryChanged', this._onPartsChanged)
        viewer.scene.removeEventListener('objectUpdate', this._onObjectUpdate)
        viewer.removeEventListener('update', this._onViewerUpdate)
        viewer.removePluginListener('add', this._onPluginAdded)
        viewer.removePluginListener('remove', this._onPluginRemoved)
        this._setPicking(undefined)
        this._show(undefined, true)
        this._unwatch()
        // put the undo manager of the viewer back before dispose, which disposes the one it has
        this._ui?.onRemove(viewer)
        this._ui?.dispose()
        this._ui = undefined
        this.element.remove()
        super.onRemove(viewer)
    }

    /** Called when {@link enabled} changes (and by `enable` / `disable`): shows or hides the panel, and sends `enabledChange` */
    setDirty() {
        const on = !this.isDisabled()
        // undefined at the first set of enabled, in the constructor
        if (this._on !== undefined && on !== this._on) {
            this._on = on
            this.dispatchEvent({type: 'enabledChange', enabled: on})
        }
        this._place()
        this._requestPreview()
    }

    private _place() {
        if (!this._viewer) return
        const on = !this.isDisabled()
        this.element.style.display = on ? '' : 'none'
        if (this.container && on && this.element.parentElement !== this.container) this.container.appendChild(this.element)
    }

    private _setPicking(picking: PickingPlugin | undefined) {
        if (picking === this._picking) return
        if (this._picking) {
            this._picking.removeEventListener('selectedObjectChanged', this._onSelection)
            this._picking.selectionUi = this._pickingSelectionUi
        }
        this._picking = picking
        if (picking) {
            this._pickingSelectionUi = picking.selectionUi
            picking.selectionUi = false
            picking.addEventListener('selectedObjectChanged', this._onSelection)
        }
        this._onSelection()
    }

    private _onPluginAdded = () => this._setPicking(this._viewer?.getPlugin(PickingPlugin))

    // the removed plugin is still the one getPlugin returns at this point
    private _onPluginRemoved = (e: IViewerEvent) => {
        if (e.plugin === this._picking) this._setPicking(undefined)
    }

    private _onSelection = () => {
        this._show(this._picking?.getSelectedObject() ?? undefined, true)
    }

    /** The selected object took another material or geometry: show the new ones */
    private _onPartsChanged = (e: IEvent<any> & {object?: IObject3D}) => {
        if (e.object && e.object === this._object) this._show(this._object)
    }

    /** A rename of the selected object */
    private _onObjectUpdate = (e: IEvent<any> & {object?: IObject3D}) => {
        if (e.object && e.object === this._object) this._renderTitle()
    }

    /**
     * Shows a selection: its tabs, and the open tab. A change of the selection (`selectionChange`) sends
     * `selectionChange`; a new material or geometry of the selected object does not.
     */
    private _show(selected: IObject3D | IMaterial | IGeometry | ITexture | undefined, selectionChange = false) {
        this._selected = selected
        const object = (selected as IObject3D)?.isObject3D ? selected as IObject3D : undefined
        const m = object ? object.material : (selected as IMaterial)?.isMaterial ? selected as IMaterial : undefined
        this._object = object
        this._materials = (Array.isArray(m) ? m : m ? [m] : []).filter(Boolean) as IMaterial[]
        if (!this._material || !this._materials.includes(this._material)) this._material = this._materials[0]
        this._geometry = object ? object.geometry as IGeometry | undefined : (selected as IGeometry)?.isBufferGeometry ? selected as IGeometry : undefined
        this._texture = (selected as ITexture)?.isTexture ? selected as ITexture : undefined
        // made again for each object: they hold it
        this._objectActions = object && this._picking ? this._picking.objectSelectionUiConfig(object) : []
        this._materialActions = object && this._picking ? this._picking.objectMaterialManageUiConfig(object) : []
        this._render()
        this._hasSelection = !!selected
        // also for another selection after one: the app shows the inspector again (a click on a mode swapped it out)
        if (selectionChange) this.dispatchEvent({type: 'selectionChange', hasSelection: this._hasSelection})
    }

    /** The tabs of the selection, in order, with the part each shows */
    private _tabs(): [InspectorTab, {uiConfig?: UiObjectConfig}][] {
        const tabs: [InspectorTab, {uiConfig?: UiObjectConfig} | undefined][] = [
            ['object', this._object], ['material', this._material], ['geometry', this._geometry], ['texture', this._texture],
        ]
        return tabs.filter((t): t is [InspectorTab, {uiConfig?: UiObjectConfig}] => !!t[1])
    }

    private _render() {
        const tabs = this._tabs()
        this.element.classList.toggle('isp-has-selection', tabs.length > 0)
        this._renderTitle()
        this._tabsEl.replaceChildren()
        for (const [tab] of tabs) {
            const b = this._tabsEl.appendChild(el('button', 'isp-tab'))
            b.type = 'button'
            b.dataset.tab = tab
            b.textContent = TAB_NAMES[tab]
            b.setAttribute('role', 'tab')
            b.addEventListener('click', () => this.setTab(tab))
        }
        // keep the open tab when the new selection has it (a pick of another mesh keeps the Material tab)
        const open = tabs.find(t => t[0] === this._tab) ?? tabs[0]
        for (const b of Array.from(this._tabsEl.children)) {
            const on = (b as HTMLElement).dataset.tab === open?.[0]
            b.classList.toggle('isp-on', on)
            b.setAttribute('aria-selected', String(on))
        }
        // one tab: no tab bar
        this._tabsEl.style.display = tabs.length > 1 ? '' : 'none'

        const materialTab = open?.[0] === 'material'
        this._materialList.replaceChildren()
        this._materialList.style.display = materialTab && this._materials.length > 1 ? '' : 'none'
        if (materialTab && this._materials.length > 1) {
            this._materials.forEach((mat, i) => {
                const o = this._materialList.appendChild(document.createElement('option'))
                o.value = String(i)
                o.textContent = mat.name || `${mat.type} ${i + 1}`
            })
            this._materialList.value = String(this._materials.indexOf(this._material!))
        }

        // the actions of the PickingPlugin that its UI shows with the selection (the inspector turns that UI off): Focus
        // and Select Parent on the Object tab, Remove Material(s) and New ... Material on the Material tab
        const actions = open?.[0] === 'object' ? this._objectActions : materialTab ? this._materialActions : []
        const config = open?.[1].uiConfig
        const configs = config ? [...actions, config] : actions
        if (configs.length !== this._shown.length || configs.some((c, i) => c !== this._shown[i])) {
            for (const c of this._shown) this._ui?.removeChild(c)
            this._shown = []
            if (this._ui) for (const c of configs) {
                if (c.type === 'folder') safeSetProperty(c, 'expanded', true, true)
                this._ui.appendChild(c)
                this._shown.push(c)
            }
        }
        this._empty.style.display = tabs.length ? 'none' : ''
        this._requestPreview()
    }

    private _renderTitle() {
        const s = this._selected as {name?: string, type?: string} | undefined
        const more = (this._picking?.getSelectedObjects().length ?? 0) - 1
        this._title.textContent = s ? (s.name || s.type || '') + (more > 0 ? `  +${more}` : '') : 'Inspector'
    }

    private _pickMaterial(i: number) {
        if (!this._materials[i]) return
        this._material = this._materials[i]
        this._render()
    }

    private _shapeChanged() {
        if (!this._shapesEl) return // the first set of the setting, before the constructor makes the elements
        for (const b of Array.from(this._shapesEl.children)) b.classList.toggle('isp-on', (b as HTMLElement).dataset.shape === this.previewShape)
        this._requestPreview()
    }

    private _previewShown() {
        const open = this._tabs().find(t => t[0] === this._tab) ?? this._tabs()[0]
        return !!this._viewer && !this.isDisabled() && this.preview && open?.[0] === 'material' && !!this._material
    }

    /** Asks the MaterialPreviewPlugin for the large preview, now and on each change of the material */
    private _requestPreview() {
        if (!this._previewEl) return // the first set of the settings, before the constructor makes the elements
        this._handle?.cancel()
        this._handle = undefined
        const shown = this._previewShown()
        this._previewEl.style.display = shown ? '' : 'none'
        if (this._watched !== (shown ? this._material : undefined)) {
            this._unwatch()
            if (shown) {
                this._watched = this._material
                this._watched?.addEventListener('materialUpdate', this._onMaterialUpdate)
            }
        }
        const previews = this._viewer?.getPlugin(MaterialPreviewPlugin)
        if (!shown || !previews || !this._material) return
        // the mesh shape renders the geometry of the selected mesh; a selected material alone has none: a sphere
        const shape = this.previewShape === 'mesh' && !this._geometry ? 'sphere' : this.previewShape
        const {yaw, pitch, distance} = this._view
        const size = InspectorPlugin.PreviewSize
        this._settings = this._viewer ? materialPreviewSettingsKey(materialPreviewOptionsFromViewer(this._viewer, this._material)) : ''
        this._handle = previews.request(this._material, {
            shape,
            geometry: shape === 'mesh' ? this._geometry : undefined,
            size,
            cameraDirection: new Vector3().setFromSphericalCoords(1, Math.PI / 2 - pitch, yaw),
            cameraDistance: distance,
            dragInterval: 0, // the large preview follows each frame of a drag
        }, p => {
            const ctx = this._canvas.getContext('2d')
            if (!ctx) return
            ctx.clearRect(0, 0, size, size)
            ctx.drawImage(p.canvas, 0, 0, size, size)
        })
    }

    private _onMaterialUpdate = () => this._requestPreview()

    /**
     * A change in the viewer: the environment map, its intensity or rotation, or the tone mapping change the preview, and
     * send no `materialUpdate`. Ask again when they changed (the preview plugin renders only then).
     */
    private _onViewerUpdate = () => {
        if (!this._handle || !this._viewer) return
        if (materialPreviewSettingsKey(materialPreviewOptionsFromViewer(this._viewer, this._material)) !== this._settings) this._requestPreview()
    }

    private _unwatch() {
        this._watched?.removeEventListener('materialUpdate', this._onMaterialUpdate)
        this._watched = undefined
    }

    /** A drag turns the preview, the wheel zooms, a double-click resets the view. `touch-action: none`: a finger turns it. */
    private _setupPreviewControls() {
        const c = this._canvas
        let drag: {x: number, y: number, id: number} | undefined
        c.addEventListener('pointerdown', e => {
            if (e.button !== 0) return
            drag = {x: e.clientX, y: e.clientY, id: e.pointerId}
            c.setPointerCapture(e.pointerId)
        })
        c.addEventListener('pointermove', e => {
            if (!drag || e.pointerId !== drag.id) return
            this._view.yaw -= (e.clientX - drag.x) * 0.01
            this._view.pitch = Math.max(-1.4, Math.min(1.4, this._view.pitch + (e.clientY - drag.y) * 0.01))
            drag.x = e.clientX
            drag.y = e.clientY
            this._requestPreview()
        })
        const end = (e: PointerEvent) => {
            if (drag?.id === e.pointerId) drag = undefined
        }
        c.addEventListener('pointerup', end)
        c.addEventListener('pointercancel', end)
        c.addEventListener('wheel', e => {
            e.preventDefault()
            this._view.distance = Math.max(0.4, Math.min(2.5, this._view.distance * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
            this._requestPreview()
        }, {passive: false})
        c.addEventListener('dblclick', () => {
            this._view = {...DEFAULT_VIEW}
            this._requestPreview()
        })
    }
}
