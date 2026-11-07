import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    createStyles,
    CustomContextMenu,
    getOrCall,
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
     * The selection changed, and the inspector shows it ({@link InspectorPlugin.hasSelection}). An app that shows the
     * inspector in place of the mode settings while something is selected (swap) hides or shows the mode settings from
     * it (`EditorFrame.setModeSettingsHidden`).
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

/** The search icon of the Layers panel (14 px, the line icons of the frame) */
const SEARCH_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>'

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
 * - The Object tab has a card for each material of the selected mesh, with a small preview and the name: a click opens
 *   the Material tab on that material.
 * - The Material tab has a large live preview of the material (with the {@link MaterialPreviewPlugin}): a sphere, a cube
 *   or the selected mesh alone ({@link previewShape}). A drag on it turns it, the wheel zooms, a double-click resets the
 *   view. A mesh with more than one material has a list of its materials.
 * - The settings render in a second Tweakpane renderer, inside {@link element}, with the theme of the page. While the
 *   inspector is in the page and enabled, the plugin turns off the selection UI of the PickingPlugin
 *   ({@link PickingPlugin.selectionUi}), since a uiConfig renders in one UI at a time; out of the page (the classic
 *   layout of the editor) the PickingPlugin shows the selection again, from the next change of the selection.
 * - A search field above the settings shows only the settings whose name has the text, and the folders whose title has
 *   it (with all their settings); the folders open while it has text. Escape in it clears it.
 * - A right-click on a setting (a long press on a touch screen) offers Reset to default, when its value is not the default
 *   of its class (the value of a new object of the same class), with undo; not on a disabled or read-only setting.
 * - Escape (the PickingPlugin) clears the selection.
 *
 * Where the panel goes: in the `container` given to the constructor, else the app puts {@link element} in the page.
 * In the editor frame it is a panel in one of the three places, and the person can move it with the menu of its entry:
 *
 * ```ts
 * const inspector = viewer.addPluginSync(InspectorPlugin)
 * const editor = viewer.getPlugin(TweakpaneEditorPlugin)!
 *
 * // right: in the right sidebar, the top of the panel above the mode settings, with its entry in the mode bar
 * editor.addPanel('inspector', inspector.element, {...InspectorPlugin.AreaEntry, area: 'right'})
 *
 * // swap: also in the right sidebar; while something is selected it takes the whole panel (the mode settings hide)
 * inspector.addEventListener('selectionChange', e => {
 *     const frame = editor.frame
 *     if (!frame || frame.panelArea('inspector') !== 'right') return // the person moved it
 *     frame.setPanelHidden('inspector', !e.hasSelection)
 *     frame.setModeSettingsHidden(e.hasSelection)
 * })
 *
 * // or under the layers panel, in the left sidebar (a stack, in the order the panels are added)
 * editor.addPanel('layers', layers.element, {...LayersPanelPlugin.AreaEntry, area: 'left'})
 * editor.addPanel('inspector', inspector.element, {...InspectorPlugin.AreaEntry, area: 'left'})
 * ```
 *
 * On the `enabledChange` event, the app takes the inspector out of its place or puts it back (`editor.removePanel`, `editor.addPanel`).
 */
@uiFolderContainer('Inspector')
export class InspectorPlugin extends AViewerPluginSync<InspectorPluginEventMap> {
    static readonly PluginType = 'InspectorPlugin'
    /** Add the CSS of the panel to the page when the first panel is made. Off: the app brings its own styles. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    /** The objects with the default values of each class, for Reset to default: a new object of the class, made once (`null`: it needs arguments) */
    private static _defaults = new Map<Function, Record<string, unknown> | null>()
    /** The size in px of the large preview of the material */
    static PreviewSize = 256
    /** The time in ms of a touch on a setting that opens its menu (Reset to default) */
    static LongPressTime = 500
    /** The size in px of the previews in the material cards of the Object tab (twice the size on screen, for a sharp 2x screen) */
    static CardPreviewSize = 64
    /** The entry of the panel in the mode bar of the editor frame, for `TweakpaneEditorPlugin.addPanel` */
    static AreaEntry: EditorFrameAreaOptions = {name: 'Inspector', icon: AREA_ICON, color: '#0ea5e9'}

    // the settings of the panel are not part of the scene: nothing to save
    toJSON: any = undefined

    dependencies = [PickingPlugin, MaterialPreviewPlugin]

    /** Off: the panel is hidden, and the `enabledChange` event tells the app (which can take it out of its place) */
    @onChange(InspectorPlugin.prototype.setDirty)
    @uiToggle('Enabled')
        enabled = true

    /** The Material tab shows a large live preview of the material. Off: only its head, which a click opens again. */
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
    private _cardsEl: HTMLDivElement
    /** The previews of the material cards, cancelled when the cards are made again or hide */
    private _cardHandles: MaterialPreviewHandle[] = []
    /** The materials of the cards and their `materialUpdate` listeners, removed with the cards */
    private _cardListeners: [IMaterial, () => void][] = []
    /** The viewer settings of the last previews of the cards ({@link _cardsKey}) */
    private _cardSettings = ''
    private _materialList: HTMLSelectElement
    private _previewEl: HTMLDivElement
    private _previewHead: HTMLButtonElement
    private _previewBody: HTMLDivElement
    private _canvas: HTMLCanvasElement
    private _shapesEl: HTMLDivElement
    private _search: HTMLInputElement
    private _body: HTMLDivElement
    private _noMatch: HTMLDivElement
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
    /** In the page and enabled, at the last check ({@link _updateInPage}): the settings of the selection show here */
    private _inPage = false

    /**
     * @param container - the element that holds the panel while the plugin is added. Without it, the app puts
     * {@link element} in the page (in the editor frame: `TweakpaneEditorPlugin.addPanel`).
     */
    constructor(container?: HTMLElement) {
        super()
        this.container = container
        if (InspectorPlugin.InjectStyles && !InspectorPlugin._styles?.isConnected) InspectorPlugin._styles = createStyles(styles)
        this.element = el('div', 'isp-root')
        this._title = this.element.appendChild(el('div', 'isp-title'))
        this._tabsEl = this.element.appendChild(el('div', 'isp-tabs'))
        this._tabsEl.setAttribute('role', 'tablist')
        this._cardsEl = this.element.appendChild(el('div', 'isp-cards'))
        this._materialList = this.element.appendChild(el('select', 'isp-materials'))
        this._materialList.setAttribute('aria-label', 'Material of the mesh')
        this._materialList.addEventListener('change', () => this._pickMaterial(Number(this._materialList.value)))
        this._previewEl = this.element.appendChild(el('div', 'isp-preview'))
        // the head folds the preview: in a short place the settings under it get the room
        this._previewHead = this._previewEl.appendChild(el('button', 'isp-preview-head'))
        this._previewHead.type = 'button'
        this._previewHead.textContent = 'Preview'
        this._previewHead.addEventListener('click', () => {
            this.preview = !this.preview
            this.uiConfig?.uiRefresh?.(true)
        })
        this._previewBody = this._previewEl.appendChild(el('div', 'isp-preview-body'))
        this._canvas = this._previewBody.appendChild(el('canvas', 'isp-preview-canvas'))
        this._canvas.width = this._canvas.height = InspectorPlugin.PreviewSize
        this._canvas.title = 'Drag to turn, wheel to zoom, double-click to reset'
        this._canvas.setAttribute('aria-label', 'Material preview')
        this._shapesEl = this._previewBody.appendChild(el('div', 'isp-shapes'))
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
        // the search field of the Layers panel: an icon and the field in a label
        const search = this.element.appendChild(el('label', 'isp-search'))
        search.appendChild(el('span', 'isp-search-icon')).innerHTML = SEARCH_ICON
        this._search = search.appendChild(el('input', 'isp-search-input'))
        this._search.type = 'search'
        this._search.placeholder = 'Search settings'
        this._search.setAttribute('aria-label', 'Search the settings of the selection')
        this._search.addEventListener('input', () => this._applySearch())
        this._search.addEventListener('keydown', (e: KeyboardEvent) => {
            // Escape clears the text first; the next one clears the selection (the PickingPlugin)
            if (e.key !== 'Escape' || !this._search.value) return
            e.stopPropagation()
            this._search.value = ''
            this._applySearch()
        })
        this._body = this.element.appendChild(el('div', 'isp-body'))
        // the renderer builds and rebuilds its rows (a refresh, a dynamic folder): the search applies to the new ones too
        if (typeof MutationObserver !== 'undefined') new MutationObserver(() => this._applySearch()).observe(this._body, {childList: true, subtree: true})
        this._noMatch = this.element.appendChild(el('div', 'isp-empty'))
        this._noMatch.textContent = 'No settings match the search'
        this._noMatch.style.display = 'none'
        this._empty = this.element.appendChild(el('div', 'isp-empty'))
        this._empty.textContent = 'Select an object in the viewport or in the layers'
        this._setupPreviewControls()
        this._setupReset()
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
        viewer.scene.addEventListener('geometryUpdate', this._onGeometryUpdate)
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
        viewer.scene.removeEventListener('geometryUpdate', this._onGeometryUpdate)
        viewer.removeEventListener('update', this._onViewerUpdate)
        viewer.removePluginListener('add', this._onPluginAdded)
        viewer.removePluginListener('remove', this._onPluginRemoved)
        this._setPicking(undefined)
        this._show(undefined, true)
        this._unwatch()
        this._cancelCards()
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
        // in or out of the page renders again, with the previews
        if (!this._updateInPage()) {
            this._requestPreview()
            this._renderCards()
        }
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
        // before the inspector renders the selection: a uiConfig renders in one UI at a time
        this._updateInPage(true)
        this._show(this._picking?.getSelectedObject() ?? undefined, true)
    }

    /**
     * The inspector shows the settings of the selection only while it is in the page and enabled; else the PickingPlugin
     * shows them in its own UI (the classic layout of the editor has no areas, or the app took the inspector out). A
     * uiConfig renders in one UI at a time, so the one that lets go of it does that first. Checked at each change of the
     * selection and of {@link enabled}, and at each viewer `update` (a change of the layout resizes the canvas). An
     * inspector in a collapsed area is in the page.
     * @param sync - set the PickingPlugin even when nothing changed
     * @returns whether it rendered the inspector again
     */
    private _updateInPage(sync = false) {
        if (!this._viewer) return false // the first set of enabled, in the constructor
        const inPage = !this.isDisabled() && this.element.isConnected
        if (inPage === this._inPage && !sync) return false
        const changed = inPage !== this._inPage
        this._inPage = inPage
        // out of the page: let go of the settings first; in the page: the PickingPlugin lets go first
        if (changed && !inPage) this._render()
        const picking = this._picking
        const selectionUi = inPage ? false : this._pickingSelectionUi
        if (picking && picking.selectionUi !== selectionUi) picking.selectionUi = selectionUi
        if (changed && inPage) this._render()
        return changed
    }

    /** The selected object took another material or geometry: show the new ones */
    private _onPartsChanged = (e: IEvent<any> & {object?: IObject3D}) => {
        if (e.object && e.object === this._object) this._show(this._object)
    }

    /**
     * The selected geometry changed in place (a geometry generator, the Geometry tab): the cached previews of the "This
     * mesh" shape are old, and the cache keys on the geometry uuid, which stays. Drop the cached previews of the materials
     * of the object, also while another tab is open, and ask again when the preview shows.
     */
    private _onGeometryUpdate = (e: IEvent<any> & {geometry?: IGeometry | null, object?: IObject3D}) => {
        const geometry = this._geometry
        if (!geometry || (e.geometry ?? e.object?.geometry) !== geometry) return
        const previews = this._viewer?.getPlugin(MaterialPreviewPlugin)
        for (const m of this._materials) previews?.invalidate(m)
        this._requestPreview()
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
        // out of the page, the PickingPlugin shows the settings ({@link _updateInPage})
        const configs = !this._inPage ? [] : config ? [...actions, config] : actions
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
        this._renderCards()
        this._applySearch()
    }

    /** Shows the settings that match the text of the search field (all of them when it is empty) */
    private _applySearch() {
        if (!this._search) return // the first set of the settings, before the constructor makes the elements
        const q = this._search.value.trim().toLowerCase()
        this._body.classList.toggle('isp-searching', !!q)
        const any = filterRows(this._body, q, !q)
        this._noMatch.style.display = q && !any && this._tabs().length ? '' : 'none'
    }

    /**
     * The material cards of the Object tab: one for each material of the selected mesh, with a small preview and the name
     * (the type for a material with no name). A click opens the Material tab on that material.
     */
    private _renderCards() {
        if (!this._cardsEl) return // the first set of enabled, before the constructor makes the elements
        this._cancelCards()
        this._cardsEl.replaceChildren()
        const tabs = this._tabs()
        const open = tabs.find(t => t[0] === this._tab) ?? tabs[0]
        const shown = open?.[0] === 'object' && this._materials.length > 0
        this._cardsEl.style.display = shown ? '' : 'none'
        if (!shown) return
        const previews = !this.isDisabled() ? this._viewer?.getPlugin(MaterialPreviewPlugin) : undefined
        const size = InspectorPlugin.CardPreviewSize
        if (previews) this._cardSettings = this._cardsKey()
        this._materials.forEach((mat, i) => {
            const card = this._cardsEl.appendChild(el('button', 'isp-card'))
            card.type = 'button'
            card.title = 'Open in the Material tab'
            const canvas = card.appendChild(el('canvas', 'isp-card-preview'))
            canvas.width = canvas.height = size
            const name = card.appendChild(el('span', 'isp-card-name'))
            name.textContent = mat.name || `${mat.type} ${this._materials.length > 1 ? i + 1 : ''}`.trim()
            const type = card.appendChild(el('span', 'isp-card-type'))
            type.textContent = mat.type
            card.classList.toggle('isp-card-plain', !mat.name)
            card.addEventListener('click', () => {
                this._material = mat
                this.setTab('material')
            })
            if (!previews) return
            const request = () => {
                this._cardHandles[i]?.cancel()
                this._cardHandles[i] = previews.request(mat, {shape: 'sphere', size}, p => {
                    const ctx = canvas.getContext('2d')
                    if (!ctx) return
                    ctx.clearRect(0, 0, size, size)
                    ctx.drawImage(p.canvas, 0, 0, size, size)
                })
            }
            request()
            // a change of the material (an edit, an undo) asks for its preview again while the card shows
            mat.addEventListener('materialUpdate', request)
            this._cardListeners.push([mat, request])
        })
    }

    private _cancelCards() {
        for (const h of this._cardHandles) h?.cancel()
        this._cardHandles = []
        for (const [mat, f] of this._cardListeners) mat.removeEventListener('materialUpdate', f)
        this._cardListeners = []
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

    /** The Material tab is open with a material: the preview or its head shows */
    private _previewTab() {
        const open = this._tabs().find(t => t[0] === this._tab) ?? this._tabs()[0]
        return !!this._viewer && !this.isDisabled() && open?.[0] === 'material' && !!this._material
    }

    /** Asks the MaterialPreviewPlugin for the large preview, now and on each change of the material */
    private _requestPreview() {
        if (!this._previewEl) return // the first set of the settings, before the constructor makes the elements
        this._handle?.cancel()
        this._handle = undefined
        const tab = this._previewTab()
        const shown = tab && this.preview
        this._previewEl.style.display = tab ? '' : 'none'
        this._previewBody.style.display = this.preview ? '' : 'none'
        this._previewHead.setAttribute('aria-expanded', String(this.preview))
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
        this._updateInPage()
        const viewer = this._viewer
        if (!viewer) return
        if (this._handle && materialPreviewSettingsKey(materialPreviewOptionsFromViewer(viewer, this._material)) !== this._settings) this._requestPreview()
        // the material cards of the Object tab, the same way
        if (this._cardHandles.length && this._cardsKey() !== this._cardSettings) this._renderCards()
    }

    /** The viewer settings that change the previews of the material cards, one key for all of them */
    private _cardsKey() {
        const viewer = this._viewer
        return viewer ? this._materials.map(m => materialPreviewSettingsKey(materialPreviewOptionsFromViewer(viewer, m))).join('|') : ''
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

    /** A right-click on a setting, or a long press on a touch screen, opens its menu: Reset to default */
    private _setupReset() {
        let timer: ReturnType<typeof setTimeout> | undefined
        let start: {x: number, y: number} | undefined
        const cancel = () => {
            clearTimeout(timer)
            timer = undefined
        }
        this._body.addEventListener('contextmenu', (e: MouseEvent) => {
            cancel() // a long press on Android also sends contextmenu
            if (this._openFieldMenu(e.target as Element, e.clientX, e.clientY)) e.preventDefault()
        })
        this._body.addEventListener('pointerdown', (e: PointerEvent) => {
            cancel()
            if (e.pointerType !== 'touch') return
            const target = e.target as Element
            start = {x: e.clientX, y: e.clientY}
            timer = setTimeout(() => this._openFieldMenu(target, start!.x, start!.y), InspectorPlugin.LongPressTime)
        })
        // a drag (a slider, a scroll) is not a long press
        this._body.addEventListener('pointermove', (e: PointerEvent) => {
            if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel()
        })
        this._body.addEventListener('pointerup', cancel)
        this._body.addEventListener('pointercancel', cancel)
    }

    /**
     * The menu of the setting at `target`: Reset to default, when its value is not the default.
     * @returns whether a menu opened
     */
    private _openFieldMenu(target: Element, x: number, y: number) {
        const field = this._fieldAt(target)
        if (!field) return false
        const value = (field.target as Record<string, unknown>)[field.key]
        const def = this._defaultValue(field.target, field.key)
        if (def === undefined || isSameValue(value, def)) return false
        this._showMenu({'Reset to default': () => this._resetField(field.config, def)}, x, y)
        return true
    }

    protected _showMenu(items: Record<string, () => void>, x: number, y: number) {
        CustomContextMenu.Create(items, x, y)
    }

    /** The setting (a uiConfig with a property) whose row in the renderer holds `target`; not a disabled or read-only one (like the uuid) */
    private _fieldAt(target: Element) {
        const row = target?.closest?.('.tp-lblv')
        if (!row) return undefined
        let found: {config: UiObjectConfig, target: object, key: string} | undefined
        const visit = (c: UiObjectConfig) => {
            if (found) return
            const ref = c.uiRef as {controller_?: {view?: {element?: Element}}, element?: Element} | undefined
            if (ref && (ref.controller_?.view?.element ?? ref.element) === row) {
                const [obj, key] = getOrCall(c.property) ?? []
                const locked = getOrCall(c.disabled) || getOrCall(c.readOnly)
                if (!locked && obj && typeof obj === 'object' && key !== undefined) found = {config: c, target: obj, key: String(key)}
                return
            }
            const children = getOrCall(c.children as any) as (UiObjectConfig | (() => UiObjectConfig))[] | undefined
            if (Array.isArray(children)) for (const child of children) {
                const cc = getOrCall(child)
                if (cc) visit(cc)
            }
        }
        for (const c of this._shown) visit(c)
        return found
    }

    /**
     * The default value of a property: its value in a new object of the same class. `undefined` when there is none (a
     * class that needs arguments, a plain object, a function).
     */
    private _defaultValue(target: object, key: string) {
        // todo: the value of the asset that the object comes from (a prefab or a template: the root url in its userData), as a revert to it (U2 in the plan of the selection UX)
        const Class = target.constructor
        if (!Class || Class === Object) return undefined
        let defaults = InspectorPlugin._defaults.get(Class)
        if (defaults === undefined) {
            try {
                defaults = new (Class as new () => Record<string, unknown>)()
            } catch {
                defaults = null
            }
            InspectorPlugin._defaults.set(Class, defaults)
        }
        if (!defaults || !(key in defaults)) return undefined
        const value = defaults[key]
        return typeof value === 'function' ? undefined : value
    }

    /** Sets the default value through the renderer, with undo; a copy for an object value (a vector, a colour) */
    private async _resetField(config: UiObjectConfig, def: unknown) {
        const value = (def as {clone?: () => unknown})?.clone ? (def as {clone: () => unknown}).clone() : def
        await this._ui?.methods.setValue(config, value as any, {last: true}, true, true)
        config.uiRefresh?.(true, 'postFrame')
    }
}

/** The text of the first element with the class `cls` in `node`, lower case */
function textOf(node: Element, cls: string): string {
    for (const c of Array.from(node.children)) {
        if (c.classList.contains(cls)) return (c.textContent ?? '').toLowerCase()
        const t = textOf(c, cls)
        if (t) return t
    }
    return ''
}

/**
 * Hides the rows of the Tweakpane UI in `node` (class `isp-miss`) that do not match `q`: a setting whose label (or button
 * title) has it, or any setting in a folder whose title has it. A folder shows while it has a row that shows.
 * @param shown - an outer folder matches: all rows show
 * @returns whether a row shows
 */
function filterRows(node: Element, q: string, shown: boolean): boolean {
    const cl = node.classList
    if (cl.contains('tp-fldv')) {
        const head = Array.from(node.children).find(c => c.classList.contains('tp-fldv_b'))
        const match = shown || !!head && textOf(head, 'tp-fldv_t').includes(q)
        let any = false
        for (const c of Array.from(node.children)) if (c !== head) any = filterRows(c, q, match) || any
        cl.toggle('isp-miss', !(match || any))
        return match || any
    }
    if (cl.contains('tp-lblv')) {
        const visible = shown || (textOf(node, 'tp-lblv_l') + ' ' + textOf(node, 'tp-btnv_t')).includes(q)
        cl.toggle('isp-miss', !visible)
        return visible
    }
    let any = false
    for (const c of Array.from(node.children)) any = filterRows(c, q, shown) || any
    return any
}

/** The same value: equal primitives, or objects with `equals` (vectors, colours, eulers) */
function isSameValue(a: unknown, b: unknown) {
    if (a === b) return true
    const eq = (a as {equals?: (o: unknown) => boolean})?.equals
    return typeof eq === 'function' && !!b && typeof b === 'object' && eq.call(a, b)
}
