import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    createStyles,
    getWidgetKind,
    IObject3D,
    IViewerEvent,
    onChange,
    PickingPlugin,
    ThreeViewer,
    uiFolderContainer,
    uiNumber,
    uiToggle,
    widgetKinds,
} from 'threepipe'
import type {IGeometry, IMaterial, ITexture, UndoManagerPlugin} from 'threepipe'
import type {SelectionOutlinePlugin} from './SelectionOutlinePlugin'
import type {EditorFrameAreaOptions} from './frame/EditorFrame'
import styles from './LayersPanelPlugin.css?inline'

/**
 * One row of the list: an object, its depth in the tree, its number of child layers, and if it is open. A row with
 * `more` is the "… N more" row of an open object ({@link LayersPanelPlugin.maxChildren}): `object` is that object, and
 * `more` the number of its children that do not show.
 */
interface LayerRow {
    object: IObject3D
    depth: number
    kids: number
    open: boolean
    more?: number
    /** The row of the scene or of the default camera, at the top ({@link LayersPanelPlugin.sceneRows}) */
    pinned?: boolean
}

/** The events of {@link LayersPanelPlugin} */
export interface LayersPanelPluginEventMap extends AViewerPluginEventMap {
    /** The panel is turned on or off (`enabled`, `enable`, `disable`): the app that placed {@link LayersPanelPlugin.element} can take it out or put it back */
    enabledChange: {enabled: boolean}
}

/** The kinds of objects that can show no children in the list ({@link LayersPanelPlugin.leafTypes}) */
export type LayerLeafType = 'mesh' | 'line' | 'points' | 'camera' | 'light'

/** The tabs of the panel ({@link LayersPanelPlugin.tabs}): the tree of the objects, and the assets that they use */
export type LayersTab = 'objects' | 'materials' | 'textures' | 'geometries'

/** The tabs, their names, and the setting that turns each on */
const TABS: [tab: LayersTab, name: string, setting: 'objectsTab' | 'materialsTab' | 'texturesTab' | 'geometryTab'][] = [
    ['objects', 'Objects', 'objectsTab'], ['materials', 'Materials', 'materialsTab'],
    ['textures', 'Textures', 'texturesTab'], ['geometries', 'Geometry', 'geometryTab'],
]

/** An asset of a tab: a material, a texture or a geometry */
type LayerAsset = IMaterial | ITexture | IGeometry

/**
 * One row of a tab of assets: an asset with the objects in the scene that use it (and `scene`: a texture that the scene
 * uses, like the background), or, with `user`, one of these objects under its open asset
 */
interface AssetRow {
    asset: LayerAsset
    users: IObject3D[]
    scene: boolean
    open: boolean
    user?: IObject3D
}

/** The elements of one row of the virtual list. The rows are made once and filled again for each render. */
interface RowElements {
    row: HTMLDivElement
    caret: HTMLSpanElement
    kind: HTMLSpanElement
    name: HTMLSpanElement
    /** A short text after the name: the size of a texture, the users of an asset */
    meta: HTMLSpanElement
    lock: HTMLButtonElement
    eye: HTMLButtonElement
}

/** The events of the `Object3DManager` of the viewer that change the tabs of assets */
const ASSET_EVENTS = ['materialAdd', 'materialRemove', 'textureAdd', 'textureRemove', 'geometryAdd', 'geometryRemove'] as const

/** The rows above and below the visible part of the list that are in the DOM too, so a short scroll shows no gap */
const OVERSCAN = 8
/** The indent of each level of the tree, in px */
const INDENT = 12

/** The icons of the panel (16 px grid, drawn with the text colour, 1.3 px line as the other editor icons) */
const svg = (d: string, size = 14) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICONS = {
    group: svg('<path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11"/>'),
    mesh: svg('<path d="M8 2l5 3v6l-5 3-5-3V5z"/><path d="M3 5l5 3 5-3M8 8v6"/>'),
    eye: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    eyeOff: svg('<path d="M2 2l12 12M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.1 12.1A6.6 6.6 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11 11 0 0 1 2.4-2.9"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    unlock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>'),
    search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
    closed: svg('<path d="M6 4l4 4-4 4"/>', 10),
    open: svg('<path d="M4 6l4 4 4-4"/>', 10),
    scene: svg('<path d="M8 2.5l5.5 2.75L8 8 2.5 5.25z"/><path d="M2.5 8L8 10.75 13.5 8M2.5 10.75L8 13.5l5.5-2.75"/>'),
    texture: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="6" cy="6" r="1.3"/><path d="M13.5 10.5l-3.5-3.5-7.5 7"/>'),
    geometry: svg('<path d="M2.5 13.5h11L8 2.5z"/><path d="M5.25 8h5.5M8 13.5L5.25 8M8 13.5L10.75 8"/>'),
    // the entry in the mode bar of the editor frame, 16 px as the icons of the frame
    layers: svg('<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3"/>', 16),
}

/**
 * Layers Panel Plugin
 *
 * A list of the objects in the scene (`scene.modelRoot`) as a tree, like the layers panel of Figma or the outliner of
 * Blender. It replaces the {@link HierarchyUiPlugin}.
 *
 * - A click on a row selects its object in the {@link PickingPlugin}; Ctrl, Cmd or Shift + click adds it to the selection
 *   or takes it out. A selection in the viewport marks its rows, opens the groups that hold it and scrolls to it
 *   ({@link revealSelection}).
 * - The arrow on a row opens or closes it; Alt + click on the arrow opens or closes all the levels below it too.
 * - A hovered row outlines its object in the viewport with the {@link SelectionOutlinePlugin}, when that plugin is added
 *   and follows the picking ({@link viewportHover}), when the pointer rests on the row ({@link HoverDelay}). It renders
 *   one more frame and does not restart the progressive render. The object hovered in the viewport is marked in the list.
 * - The eye button hides or shows the object, the lock button locks or unlocks it. A locked object has
 *   `userData.userSelectable` set to `false`: the {@link PickingPlugin} does not pick it, or the objects inside it, in the
 *   viewport; the list can still select it. A row in the selection changes all the selected objects. Both are undo steps
 *   with the `UndoManagerPlugin`.
 * - A double-click on a name (or F2) renames the object: Enter or a click outside keeps the name, Escape goes back.
 * - With the focus in the list: Up and Down select the next row (Shift adds it), Right opens a row or goes to its first
 *   child, Left closes a row or goes to its parent.
 * - The search field shows only the objects whose name has the text, with the groups that hold them.
 * - Tabs for the materials, the textures and the geometries that the objects use ({@link tabs}, each turned on or off by
 *   {@link materialsTab} and the others; one tab shows no tab bar). An asset row has a swatch, a picture or an icon, the
 *   name, a short text (the size of a texture, the vertices of a geometry, the users), and an arrow that lists its users.
 *   A click selects the asset in the PickingPlugin, a double-click selects its users, a double-click on the name (or
 *   F2) renames a material or a texture ({@link renameAsset}); a hover outlines its users.
 * - The scene and the default camera are the first two rows, above the model ({@link sceneRows}), dimmer and with a line
 *   below them; a click selects them. Meshes, lines, points, cameras and lights show no children ({@link leafTypes},
 *   {@link showLeafChildren}).
 * - A double-click on a row selects it and moves the camera to it ({@link doubleClickFocus}; the scene row frames the
 *   model); a double-click on the name renames it. With {@link clickToUnselect}, a click on a selected row unselects it.
 * - An open row shows its first {@link maxChildren} children (5), then a "… N more" row; a click on it shows all of them
 *   ({@link showAllChildren}). The objects at the top level, a search and children that hold the selection always show.
 * - A virtual list: only the rows in view are in the DOM, so a scene with many objects stays fast.
 *
 * Lights and cameras have the icon and the colour of their kind (`widgetKinds` of threepipe), as in the viewport.
 *
 * Where the panel goes: in the `container` given to the constructor, else the app puts {@link element} in the page. The
 * plugin does not depend on the editor: in the page frame of the `TweakpaneEditorPlugin`, the app adds it as a panel,
 * `editor.addPanel('layers', layers.element, {...LayersPanelPlugin.AreaEntry, area: 'left'})` (the person can move it to
 * another place with the menu of its entry), and on the `enabledChange` event it takes the panel out
 * (`editor.removePanel('layers')`) or adds it back. The element fills its parent: give the parent a height. The plugin
 * takes the panel out of the page when it is removed.
 *
 * @example
 * ```ts
 * const layers = viewer.addPluginSync(LayersPanelPlugin)
 * const editor = viewer.getPlugin(TweakpaneEditorPlugin)!
 * const place = () => layers.isDisabled() ? editor.removePanel('layers') : editor.addPanel('layers', layers.element, {...LayersPanelPlugin.AreaEntry, area: 'left'})
 * place()
 * layers.addEventListener('enabledChange', place)
 * ```
 *
 * The plugin UI folder (Layers Panel) has the settings. The settings and the open rows are not saved with the viewer.
 *
 * @category Plugins
 */
@uiFolderContainer('Layers Panel')
export class LayersPanelPlugin extends AViewerPluginSync<LayersPanelPluginEventMap> {
    static readonly PluginType = 'LayersPanelPlugin'
    /** Adds the stylesheet of the panel to the page when the first plugin is made. Off: the page styles the `lyp-` classes. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    /** The height of a row in px. The stylesheet takes it from the CSS variable `--lyp-row` on {@link element}. */
    static readonly RowHeight = 28
    /**
     * A name, an icon and a colour for the entry of the panel in the mode bar of the editor frame, for the app to pass to
     * `TweakpaneEditorPlugin.addPanel`. The plugin does not use it.
     */
    static AreaEntry: EditorFrameAreaOptions = {name: 'Layers', icon: ICONS.layers, color: '#6366f1'}

    /**
     * The time in ms that the pointer rests on a row before the viewport outlines its object ({@link viewportHover}). Each
     * outline renders one frame, so a move across many rows renders none until the pointer stops. The pointer that
     * leaves the list clears the outline at once. `0`: at once on each row.
     */
    static HoverDelay = 80

    dependencies = [PickingPlugin]
    serializeWithViewer = false

    /** Off: the panel is hidden, and the `enabledChange` event tells the app (which can take its area out of the editor frame) */
    @onChange(LayersPanelPlugin.prototype.setDirty)
    @uiToggle('Enabled')
        enabled = true

    /**
     * A hovered row outlines its object in the viewport. It needs the {@link SelectionOutlinePlugin} with
     * `followPicking` on. A change renders one more frame, it does not restart the progressive render.
     */
    @onChange(LayersPanelPlugin.prototype._viewportHoverChanged)
    @uiToggle('Hover in viewport')
        viewportHover = true

    /** A change of the selection opens the groups that hold the selected objects and scrolls the list to the first one */
    @uiToggle('Reveal selection')
        revealSelection = true

    /**
     * An open row shows this many of its children, then a "… N more" row; a click on it shows all of them (until the row
     * is closed). The objects at the top level, a search, and children that hold the selection always show. `0`: all.
     */
    @onChange(LayersPanelPlugin.prototype._structureChanged)
    @uiNumber('Max children', {stepSize: 1})
        maxChildren = 5

    /**
     * The scene and the default camera as the first two rows of the Objects tab, above the model, with a line below them.
     * A click selects them (the UI of the editor shows their settings). They are not in the model: they have no eye, lock
     * or arrow, and a search hides them.
     */
    @onChange(LayersPanelPlugin.prototype._structureChanged)
    @uiToggle('Scene and camera rows')
        sceneRows = true

    /**
     * The kinds of objects that show no children in the list: their helpers, targets or parts. Set a new list to change
     * it. {@link showLeafChildren} shows the children of all kinds.
     */
    @onChange(LayersPanelPlugin.prototype._structureChanged)
        leafTypes: LayerLeafType[] = ['mesh', 'line', 'points', 'camera', 'light']

    /** Shows the children of the objects of {@link leafTypes} too */
    @onChange(LayersPanelPlugin.prototype._structureChanged)
    @uiToggle('Show children of meshes, lights, cameras')
        showLeafChildren = false

    /** A click on a selected row (without a key) unselects it */
    @uiToggle('Click unselects a selected row')
        clickToUnselect = false

    /**
     * A double-click on a row selects it and moves the camera to it (the scene row: to the whole model). A double-click on
     * the name renames it.
     */
    @uiToggle('Double-click focuses')
        doubleClickFocus = true

    /**
     * The Objects tab: the tree of the objects. The tabs that are on show in a tab bar ({@link tabs}); with one tab on,
     * there is no tab bar.
     */
    @onChange(LayersPanelPlugin.prototype._tabsChanged)
    @uiToggle('Objects tab')
        objectsTab = true

    /** The Materials tab: the materials of the objects in the scene, with a swatch and the objects that use each */
    @onChange(LayersPanelPlugin.prototype._tabsChanged)
    @uiToggle('Materials tab')
        materialsTab = true

    /** The Textures tab: the textures that the scene and its objects use, with a picture, the size and the users */
    @onChange(LayersPanelPlugin.prototype._tabsChanged)
    @uiToggle('Textures tab')
        texturesTab = true

    /** The Geometry tab: the geometries of the objects in the scene, with the vertex count and the objects that use each */
    @onChange(LayersPanelPlugin.prototype._tabsChanged)
    @uiToggle('Geometry tab')
        geometryTab = true

    /** The panel: the header, the search field and the list. It fills its parent. */
    readonly element: HTMLDivElement
    /** The element that holds the panel while the plugin is added, given to the constructor */
    readonly container?: HTMLElement

    private _list: HTMLDivElement
    private _spacer: HTMLDivElement
    private _empty: HTMLDivElement
    private _count: HTMLSpanElement
    private _tabsEl: HTMLDivElement
    private _tab: LayersTab = 'objects'
    /** The rows of the open tab of assets, and the number of assets in each tab (for the tab bar and the header) */
    private _assetRows: AssetRow[] = []
    private _tabCounts: Partial<Record<LayersTab, number>> = {}
    /** The open assets: their users are in the list */
    private _openAssets = new WeakSet<object>()
    /** The asset of the user row that the panel selected last: an object can be a user of two open assets */
    private _userAsset?: LayerAsset
    /** The pictures of the textures, as data URLs ('' when the image cannot be drawn) */
    private _thumbs = new WeakMap<object, {image: unknown, url: string, n: number}>()
    /** The number of the last picture drawn: the key of a picture in a row, so a new picture of a texture is drawn */
    private _thumbCount = 0
    private _search: HTMLInputElement
    private _filter = ''
    /** The open rows. Weak: a removed object is not kept. */
    private _expanded = new WeakSet<IObject3D>()
    /** The open rows that show all their children ({@link showAllChildren}) */
    private _showAll = new WeakSet<IObject3D>()
    private _flat: LayerRow[] = []
    private _index = new Map<IObject3D, number>()
    private _total = 0
    private _structureDirty = true
    private _frame = 0
    /** The rows in the DOM, filled for the part of the list in view */
    private _pool: RowElements[] = []
    /** The next render scrolls the list to the first selected object */
    private _reveal = false
    /** The rename that is open: a render waits until it ends */
    private _renaming?: (commit: boolean) => void
    /** The row under the pointer: its object or asset, and the objects that the viewport outlines for it */
    private _hoverKey: unknown = null
    private _hoverObjects: IObject3D[] = []
    /** The row element under the pointer: a render can give it another object (the rows are reused) */
    private _hoverRowEl: HTMLElement | null = null
    /** The outline of a row that waits for the pointer to rest ({@link HoverDelay}), and the target that it outlines then */
    private _hoverTimer?: ReturnType<typeof setTimeout>
    private _hoverNext: {key: unknown, objects: IObject3D[]} | null = null
    /** The value of `userData.userSelectable` before a lock, given back by the unlock */
    private _beforeLock = new WeakMap<IObject3D, boolean | undefined>()
    private _picking?: PickingPlugin
    /** On or off at the last `enabledChange` (set in the constructor, after the first set of `enabled`) */
    private _on: boolean
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.refresh())

    /**
     * @param container - the element that holds the panel while the plugin is added. Without it, the app puts
     * {@link element} in the page (in the editor frame: `TweakpaneEditorPlugin.addPanel`).
     */
    constructor(container?: HTMLElement) {
        super()
        this.container = container
        if (LayersPanelPlugin.InjectStyles && !LayersPanelPlugin._styles?.isConnected) LayersPanelPlugin._styles = createStyles(styles)
        this.element = el('div', 'lyp-root')
        this.element.style.setProperty('--lyp-row', LayersPanelPlugin.RowHeight + 'px')
        const head = this.element.appendChild(el('div', 'lyp-head'))
        head.appendChild(el('span', 'lyp-title')).textContent = 'Layers'
        this._count = head.appendChild(el('span', 'lyp-count'))
        this._tabsEl = this.element.appendChild(el('div', 'lyp-tabs'))
        this._tabsEl.setAttribute('role', 'tablist')
        for (const [tab, name] of TABS) {
            const b = this._tabsEl.appendChild(el('button', 'lyp-tab'))
            b.type = 'button'
            b.dataset.tab = tab
            b.textContent = name
            b.setAttribute('role', 'tab')
            b.addEventListener('click', () => this.setTab(tab))
        }
        const search = this.element.appendChild(el('label', 'lyp-search'))
        search.appendChild(el('span', 'lyp-search-icon')).innerHTML = ICONS.search
        this._search = search.appendChild(el('input', 'lyp-search-input'))
        this._search.placeholder = 'Search'
        this._search.setAttribute('aria-label', 'Search the layers')
        this._list = this.element.appendChild(el('div', 'lyp-list'))
        this._list.tabIndex = 0
        this._list.setAttribute('role', 'tree')
        this._list.setAttribute('aria-label', 'Layers')
        this._spacer = this._list.appendChild(el('div', 'lyp-spacer'))
        this._empty = this._list.appendChild(el('div', 'lyp-empty'))

        this._search.addEventListener('input', () => this._setFilter(this._search.value))
        this._search.addEventListener('keydown', this._onSearchKey)
        this._list.addEventListener('click', this._onClick)
        this._list.addEventListener('dblclick', this._onDoubleClick)
        this._list.addEventListener('keydown', this._onKey)
        this._list.addEventListener('scroll', () => this.refresh())
        this._list.addEventListener('pointerover', this._onPointerOver)
        this._list.addEventListener('pointerleave', () => {
            this._hoverRowEl = null
            this._setRowHover(null)
        })
        this._tabsChanged()
        this._on = !this.isDisabled()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.addEventListener('objectUpdate', this._onObjectUpdate)
        for (const type of ASSET_EVENTS) viewer.object3dManager?.addEventListener(type, this._onAssetsChanged)
        // a mesh that takes another material or geometry, already in use: the users of both change (no add or remove)
        viewer.scene.addEventListener('materialChanged', this._onAssetsChanged)
        viewer.scene.addEventListener('geometryChanged', this._onAssetsChanged)
        viewer.scene.addEventListener('materialUpdate', this._onMaterialUpdate)
        viewer.scene.addEventListener('textureUpdate', this._onTextureUpdate)
        // the PickingPlugin can be added before or after this plugin, removed and replaced
        viewer.addPluginListener('add', this._onPluginAdded, 'PickingPlugin')
        viewer.addPluginListener('remove', this._onPluginRemoved, 'PickingPlugin')
        this._setPicking(viewer.getPlugin<PickingPlugin>('PickingPlugin'))
        this._resizer?.observe(this._list)
        this._place()
        this.refresh(true)
    }

    onRemove(viewer: ThreeViewer) {
        this._renaming?.(false)
        this._hoverRowEl = null
        this._setRowHover(null)
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.removeEventListener('objectUpdate', this._onObjectUpdate)
        for (const type of ASSET_EVENTS) viewer.object3dManager?.removeEventListener(type, this._onAssetsChanged)
        viewer.scene.removeEventListener('materialChanged', this._onAssetsChanged)
        viewer.scene.removeEventListener('geometryChanged', this._onAssetsChanged)
        viewer.scene.removeEventListener('materialUpdate', this._onMaterialUpdate)
        viewer.scene.removeEventListener('textureUpdate', this._onTextureUpdate)
        viewer.removePluginListener('add', this._onPluginAdded)
        viewer.removePluginListener('remove', this._onPluginRemoved)
        this._setPicking(undefined)
        this._resizer?.disconnect()
        if (this._frame) cancelFrame(this._frame)
        this._frame = 0
        this.element.remove()
        super.onRemove(viewer)
    }

    dispose() {
        this._resizer?.disconnect()
        super.dispose()
    }

    /** Called when {@link enabled} changes (and by `enable` / `disable`): shows or hides the panel, and sends `enabledChange` */
    setDirty() {
        const on = !this.isDisabled()
        // undefined at the first set of enabled, in the constructor
        if (this._on !== undefined && on !== this._on) {
            this._on = on
            this.dispatchEvent({type: 'enabledChange', enabled: on})
        }
        if (!this._viewer) return
        this._place()
        if (!this.isDisabled()) this.refresh(true)
    }

    /**
     * Draws the rows in view again, in the next animation frame. Changes in the scene, the selection and the panel call
     * it; call it after a change that the plugin does not hear about, such as a name set without `setDirty`.
     * @param structure - also build the list again: after a change of the tree, of the open rows or of the search
     */
    refresh(structure = false) {
        if (structure) this._structureDirty = true
        if (this._frame || !this._viewer || this.isDisabled()) return
        this._frame = nextFrame(this._render)
    }

    /** The objects in the list, from the top: the children of the open rows included, filtered by the search */
    get listedObjects(): IObject3D[] {
        if (this._structureDirty) this._build()
        return this._flat.filter(r => !r.more && !r.pinned).map(r => r.object)
    }

    /** The object has its row open: its children are in the list */
    isExpanded(object: IObject3D) {
        return this._expanded.has(object)
    }

    /**
     * Opens or closes the row of an object.
     * @param deep - also all the levels below it
     */
    setExpanded(object: IObject3D, open: boolean, deep = false) {
        const set = (o: IObject3D) => {
            if (open) return this._expanded.add(o)
            this._expanded.delete(o)
            // closed: the next open shows the first children again
            this._showAll.delete(o)
        }
        if (deep) object.traverse(o => set(o as IObject3D))
        else set(object)
        this.refresh(true)
    }

    /** Closes all the rows */
    collapseAll() {
        this._expanded = new WeakSet()
        this._showAll = new WeakSet()
        this.refresh(true)
    }

    /** The tabs that are on ({@link objectsTab}, {@link materialsTab}, {@link texturesTab}, {@link geometryTab}); the Objects tab when none is */
    get tabs(): LayersTab[] {
        const on = TABS.filter(t => this[t[2]]).map(t => t[0])
        return on.length ? on : ['objects']
    }

    /** The open tab ({@link setTab}) */
    get tab(): LayersTab {
        return this._tab
    }

    /** Opens a tab that is on ({@link tabs}) */
    setTab(tab: LayersTab) {
        if (tab === this._tab || !this.tabs.includes(tab)) return
        this._tab = tab
        this._setRowHover(null)
        this._list.scrollTop = 0
        this._updateTabs()
        this.refresh(true)
    }

    /** Renames a material or a texture, as one undo step. An empty name or the same name does nothing. */
    renameAsset(asset: IMaterial | ITexture, name: string) {
        const old = asset.name
        if (!name || name === old) return
        const set = (n: string) => {
            asset.name = n
            asset.setDirty?.()
            this.refresh(true)
        }
        set(name)
        this._record(() => set(old), () => set(name))
    }

    /** Shows all the children of an open row, in place of its "… N more" row ({@link maxChildren}) */
    showAllChildren(object: IObject3D) {
        this._showAll.add(object)
        this.refresh(true)
    }

    /**
     * The object is locked: its `userData.userSelectable` is `false`, so the PickingPlugin does not pick it, or the
     * objects inside it, in the viewport. The lock of a parent is not checked.
     */
    isLocked(object: IObject3D) {
        return isLocked(object)
    }

    /** Shows or hides objects, as one undo step. Cameras are left out: threepipe does not support a hidden camera. */
    setVisible(objects: IObject3D[], visible: boolean) {
        objects = objects.filter(o => !o.isCamera)
        if (!objects.length) return
        const before = objects.map(o => o.visible)
        const apply = (values: boolean[]) => {
            objects.forEach((o, i) => {
                if (o.visible === values[i]) return
                o.visible = values[i]
                o.setDirty?.({refreshScene: true, change: 'visible'})
            })
            this.refresh()
        }
        const after = objects.map(() => visible)
        apply(after)
        this._record(() => apply(before), () => apply(after))
    }

    /**
     * Locks or unlocks objects, as one undo step. A lock sets `userData.userSelectable` to `false`; an unlock gives back
     * the value from before the lock (none, or `true` for an object without a material that is picked, like a text).
     */
    setLocked(objects: IObject3D[], locked: boolean) {
        const before = objects.map(o => o.userData.userSelectable)
        const after = objects.map((o, i) => {
            if (locked) {
                if (!isLocked(o)) this._beforeLock.set(o, before[i])
                return false
            }
            return isLocked(o) ? this._beforeLock.get(o) : before[i]
        })
        const apply = (values: (boolean | undefined)[]) => {
            objects.forEach((o, i) => {
                if (values[i] === undefined) delete o.userData.userSelectable
                else o.userData.userSelectable = values[i]
            })
            this.refresh()
        }
        apply(after)
        this._record(() => apply(before), () => apply(after))
    }

    /** Renames an object, as one undo step. An empty name or the same name does nothing. */
    renameObject(object: IObject3D, name: string) {
        const old = object.name
        if (!name || name === old) return
        const set = (n: string) => {
            object.name = n
            // as the Name field of the object UI: the other UIs show the new name
            object.setDirty?.({refreshScene: true, frameFade: false, refreshUi: true, change: 'name'})
            this.refresh(true)
        }
        set(name)
        this._record(() => set(old), () => set(name))
    }

    /**
     * Opens the name field on the row of an object, as a double-click on its name does. The row must be in the list
     * (its parents open). Returns `false` when it is not.
     */
    startRename(object: IObject3D) {
        if (this.isDisabled() || !this._viewer) return false
        if (this._structureDirty) this._build()
        const i = this._tab === 'objects' ? this._index.get(object) : undefined
        if (i === undefined || this._flat[i].pinned) return false
        return this._openRename(i, object.name, name => this.renameObject(object, name))
    }

    /** The name field on the row at a place in the list, with the name now; Enter or a blur calls `commit` */
    private _openRename(i: number, value: string, commit: (name: string) => void) {
        this._renaming?.(true)
        this._scrollTo(i)
        this._renderNow()
        const els = this._pool.find(p => p.row.dataset.index === String(i))
        if (!els) return false
        const input = el('input', 'lyp-rename')
        input.value = value
        input.setAttribute('aria-label', 'Name')
        els.name.style.display = 'none'
        els.row.insertBefore(input, els.lock)
        input.focus()
        input.select()
        const finish = (keep: boolean) => {
            if (this._renaming !== finish) return
            this._renaming = undefined
            const name = input.value.trim()
            input.remove()
            els.name.style.display = ''
            if (keep) commit(name)
            this._list.focus({preventScroll: true})
            this.refresh()
        }
        this._renaming = finish
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            e.stopPropagation()
            // the Enter or Escape that ends a composition (IME) is for the text
            if (e.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') finish(true)
            else if (e.key === 'Escape') finish(false)
        })
        input.addEventListener('blur', () => finish(true))
        return true
    }

    // region placement

    /** Shows or hides the panel (disabled), and puts it in its container */
    private _place() {
        if (!this._viewer) return
        const on = !this.isDisabled()
        this.element.style.display = on ? '' : 'none'
        if (this.container && on && this.element.parentElement !== this.container) this.container.appendChild(this.element)
    }

    private _setPicking(picking: PickingPlugin | undefined) {
        if (picking === this._picking) return
        this._picking?.removeEventListener('selectedObjectChanged', this._onSelection)
        this._picking?.removeEventListener('hoverObjectChanged', this._onPickingHover)
        this._picking = picking
        picking?.addEventListener('selectedObjectChanged', this._onSelection)
        picking?.addEventListener('hoverObjectChanged', this._onPickingHover)
        this.refresh()
    }

    private _onPluginAdded = () => {
        this._setPicking(this._viewer?.getPlugin<PickingPlugin>('PickingPlugin'))
    }

    // the removed plugin is still the one getPlugin returns at this point
    private _onPluginRemoved = (e: IViewerEvent) => {
        if (e.plugin === this._picking) this._setPicking(undefined)
    }

    // endregion

    // region events

    private _onSceneUpdate = (e: {object?: IObject3D, hierarchyChanged?: boolean, change?: string}) => {
        if (e.object && (e.object.assetType === 'widget' || e.object.userData?.isWidgetRoot)) return
        // a new name can change what the search finds; other changes (visibility, a move) only change the rows
        this.refresh(!!e.hierarchyChanged || e.change === 'name')
    }

    /**
     * An object added, removed or renamed. The scene sends no `sceneUpdate` for a camera (`RootScene.refreshScene` leaves
     * its changes out), so the list hears of it here.
     */
    private _onObjectUpdate = (e: {change?: string}) => {
        if (e.change === 'addedToParent' || e.change === 'removedFromParent' || e.change === 'name') this.refresh(true)
    }

    private _onSelection = () => {
        let opened = false
        if (this.revealSelection) {
            this._reveal = true
            // open the groups that hold the selection
            const root = this._viewer?.scene.modelRoot
            for (const s of this._selected()) {
                const parents: IObject3D[] = []
                let p = s.parent as IObject3D | null
                while (p && p !== root) {
                    parents.push(p)
                    p = p.parent as IObject3D | null
                }
                if (!p) continue // not in the model root
                for (const a of parents) {
                    if (this._expanded.has(a)) continue
                    this._expanded.add(a)
                    opened = true
                }
            }
        }
        this.refresh(opened || this._selectionBehindMore())
    }

    /** A selected object is not in the list, and an object that holds it has a "… N more" row: the build shows all */
    private _selectionBehindMore() {
        const cut = new Set(this._flat.filter(r => r.more).map(r => r.object))
        if (!cut.size) return false
        return this._selected().some(s => {
            if (this._index.has(s)) return false
            for (let p = s.parent as IObject3D | null; p; p = p.parent as IObject3D | null) if (cut.has(p)) return true
            return false
        })
    }

    private _onPickingHover = () => {
        const hovered = this._picking?.picker?.hoverObject
        for (const p of this._pool) {
            const o = this._rowObject(p.row)
            p.row.classList.toggle('lyp-hover', !!o && o === hovered)
        }
    }

    private _viewportHoverChanged() {
        this._outlineHover()
    }

    /**
     * The row under the pointer: its object (or the users of its asset) is outlined in the viewport ({@link viewportHover}),
     * after the pointer rests on it ({@link HoverDelay}); no row clears the outline at once
     */
    private _setRowHover(target: {key: unknown, objects: IObject3D[]} | null) {
        // the row that waits is drawn again (a render in each frame): it keeps its time, with its objects now
        if (this._hoverTimer && target && target.key === this._hoverNext?.key) {
            this._hoverNext = target
            return
        }
        clearTimeout(this._hoverTimer)
        this._hoverTimer = undefined
        this._hoverNext = null
        if ((target?.key ?? null) === this._hoverKey) {
            // the same row: its objects can change (the users of an asset), then the outline follows at once
            const objects = target?.objects ?? []
            const now = this._hoverObjects
            if (objects.length === now.length && objects.every((o, i) => o === now[i])) return
            this._hoverObjects = objects
            this._outlineHover()
            return
        }
        this._hoverNext = target
        const apply = () => {
            const next = this._hoverNext
            this._hoverTimer = undefined
            this._hoverNext = null
            this._hoverKey = next?.key ?? null
            this._hoverObjects = next?.objects ?? []
            this._outlineHover()
        }
        if (target && LayersPanelPlugin.HoverDelay > 0) this._hoverTimer = setTimeout(apply, LayersPanelPlugin.HoverDelay)
        else apply()
    }

    /**
     * The hover of the {@link SelectionOutlinePlugin}: the object of the hovered row, else the hover of the viewport (when
     * the pointer leaves the list). The setter of the outline redraws only on a change, one frame.
     */
    private _outlineHover() {
        const outline = this._viewer?.getPlugin<SelectionOutlinePlugin>('SelectionOutlinePlugin')
        if (!outline?.followPicking) return
        const row = this.viewportHover ? this._hoverObjects : []
        const canvas = this._picking?.picker?.hoverObject as IObject3D | null | undefined
        outline.hovered = row.length ? [...row] : canvas?.isObject3D ? [canvas] : []
    }

    private _onPointerOver = (e: PointerEvent) => {
        this._hoverRowEl = (e.target as Element | null)?.closest?.('.lyp-row') as HTMLElement | null
        this._setRowHover(this._hoverRowEl && this._rowTarget(this._hoverRowEl))
    }

    private _onClick = (e: MouseEvent) => {
        const target = e.target as Element
        if (target.closest('.lyp-rename')) return
        const row = target.closest('.lyp-row') as HTMLElement | null
        if (!row) return
        const asset = this._assetRowOf(row)
        if (asset) {
            this._list.focus({preventScroll: true})
            if (asset.user) {
                this._userAsset = asset.asset
                this._clickObject(asset.user, e)
            } else if (target.closest('.lyp-caret') && asset.users.length) this._toggleAsset(asset.asset)
            else this._selectAsset(asset.asset)
            return
        }
        const more = row.dataset.index !== undefined ? this._flat[+row.dataset.index] : undefined
        if (more?.more) return this.showAllChildren(more.object)
        const o = this._rowObject(row)
        if (!o) return
        // the list keeps the focus (a click can focus a button), for the arrow keys
        this._list.focus({preventScroll: true})
        if (target.closest('.lyp-eye')) this._toggle(o, 'visible')
        else if (target.closest('.lyp-lock')) this._toggle(o, 'locked')
        else if (target.closest('.lyp-caret') && this._flat[this._index.get(o)!]?.kids) {
            this.setExpanded(o, !this._expanded.has(o), e.altKey)
        } else this._clickObject(o, e)
    }

    /** A click on the row of an object: it selects it; a key adds or takes out, with multi-select (as in the viewport) */
    private _clickObject(o: IObject3D, e: MouseEvent) {
        const key = e.shiftKey || e.ctrlKey || e.metaKey
        if (key && this._picking?.multiSelectEnabled) this._picking.toggleSelectedObject(o)
        else if (!key && this.clickToUnselect && this._selected().includes(o)) this._select([])
        else this._select([o])
    }

    /** Selects an object and moves the camera to it ({@link doubleClickFocus}); for the scene, to the whole model */
    private _focus(o: IObject3D) {
        this._select([o])
        const viewer = this._viewer
        if (viewer) void this._picking?.focusObject(o === viewer.scene ? viewer.scene.modelRoot : o)
    }

    private _onDoubleClick = (e: MouseEvent) => {
        const target = e.target as Element
        const row = target.closest('.lyp-row') as HTMLElement | null
        if (!row) return
        const asset = this._assetRowOf(row)
        // an asset: its name renames it (not a geometry), else its users are selected
        if (asset) {
            if (asset.user) {
                if (this.doubleClickFocus) this._focus(asset.user)
                return
            }
            if (target.closest('.lyp-name') && this._startAssetRename(+row.dataset.index!)) return
            this._select(asset.users)
            return
        }
        const o = this._rowObject(row)
        if (!o) return
        // the name renames (not the rows of the scene and the camera); the rest of the row focuses
        if (target.closest('.lyp-name') && this.startRename(o)) return
        if (this.doubleClickFocus) this._focus(o)
    }

    /** The name field on the row of a material or a texture of the open tab; `false` for a geometry or a user row */
    private _startAssetRename(i: number) {
        const r = this._assetRows[i]
        if (!r || r.user || (r.asset as IGeometry).isBufferGeometry) return false
        const a = r.asset as IMaterial | ITexture
        return this._openRename(i, a.name, name => this.renameAsset(a, name))
    }

    private _onSearchKey = (e: KeyboardEvent) => {
        // the keys typed in the field are for the field, not for the shortcuts of the page
        e.stopPropagation()
        if (e.key === 'Escape' && this._search.value) {
            this._search.value = ''
            this._setFilter('')
        }
    }

    /** The keys in the focused list: arrows move in the list, F2 renames */
    private _onKey = (e: KeyboardEvent) => {
        if (e.target !== this._list) return
        if (e.key === 'F2') {
            const picked = this._picking?.picker?.selectedObject as unknown
            const assetAt = this._tab !== 'objects' ? this._assetRows.findIndex(r => !r.user && r.asset === picked) : -1
            const s = this._selected()[0]
            if (assetAt >= 0 || s) {
                e.preventDefault()
                if (assetAt >= 0) this._startAssetRename(assetAt)
                else this.startRename(s)
            }
            return
        }
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
        e.preventDefault()
        e.stopPropagation() // not for the camera or the other shortcuts of the page
        if (this._structureDirty) this._build()
        if (this._tab !== 'objects') return this._assetKey(e.key)
        const flat = this._flat
        const sel = this._selected()
        const i = sel.length ? this._index.get(sel[0]) ?? -1 : -1
        const r = i >= 0 ? flat[i] : undefined
        // the next row of an object in that direction: a "… N more" row is passed over
        const go = (j: number, step = 1) => {
            while (flat[j]?.more) j += step
            const t = flat[Math.max(0, Math.min(flat.length - 1, j))]
            if (!t || t.more) return
            if (e.shiftKey && sel.length && this._picking?.multiSelectEnabled) this._select([t.object, ...sel.filter(s => s !== t.object)])
            else this._select([t.object])
        }
        if (e.key === 'ArrowDown') go(i + 1)
        else if (e.key === 'ArrowUp') go(i < 0 ? flat.length - 1 : i - 1, -1)
        else if (!r) return
        else if (e.key === 'ArrowRight') {
            if (r.kids && !r.open) this.setExpanded(r.object, true, e.altKey)
            else if (r.open) go(i + 1)
        } else if (r.open) this.setExpanded(r.object, false, e.altKey)
        else {
            const p = r.object.parent as IObject3D | null
            if (p && this._index.has(p)) this._select([p])
        }
    }

    /** The arrow keys in a tab of assets: Up and Down select the next row, Right opens an asset, Left closes it */
    private _assetKey(key: string) {
        const rows = this._assetRows
        const picked = this._picking?.picker?.selectedObject as unknown
        const sel = this._selected()
        const isSel = (r: AssetRow) => r.user ? sel.includes(r.user) : r.asset === picked
        // the selected user row under the asset it was selected from, else the first selected row
        let i = rows.findIndex(r => r.user && r.asset === this._userAsset && isSel(r))
        if (i < 0) i = rows.findIndex(isSel)
        const r = rows[i]
        const go = (j: number) => {
            j = Math.max(0, Math.min(rows.length - 1, j))
            const t = rows[j]
            if (!t) return
            this._scrollTo(j)
            this._userAsset = t.user ? t.asset : undefined
            if (t.user) this._select([t.user])
            else this._selectAsset(t.asset)
        }
        if (key === 'ArrowDown') go(i + 1)
        else if (key === 'ArrowUp') go(i < 0 ? rows.length - 1 : i - 1)
        else if (!r) return
        else if (r.user) {
            // a user: Left goes to its asset
            if (key === 'ArrowLeft') this._selectAsset(r.asset)
        } else if (key === 'ArrowRight' ? !r.open && r.users.length : r.open) this._toggleAsset(r.asset)
    }

    // endregion

    // region actions

    private _selected(): IObject3D[] {
        return (this._picking?.getSelectedObjects() ?? []).filter(o => (o as IObject3D)?.isObject3D) as IObject3D[]
    }

    /** Selects a material, a texture or a geometry in the PickingPlugin: the UI of the editor shows its settings */
    private _selectAsset(asset: LayerAsset) {
        const picking = this._picking
        if (!picking || picking.isDisabled()) return
        picking.picker?.setSelected(asset, true)
    }

    /** Opens or closes an asset: its users show under it */
    private _toggleAsset(asset: LayerAsset) {
        if (this._openAssets.has(asset)) this._openAssets.delete(asset)
        else this._openAssets.add(asset)
        this.refresh(true)
    }

    private _select(objects: IObject3D[]) {
        const picking = this._picking
        if (!picking || picking.isDisabled()) return
        picking.picker?.setSelected(objects.length ? objects.length === 1 ? objects[0] : objects as any : null, true)
    }

    /** The eye or the lock of a row: for the whole selection when the row is in it */
    private _toggle(object: IObject3D, what: 'visible' | 'locked') {
        const sel = this._selected()
        const targets = sel.includes(object) ? sel : [object]
        if (what === 'visible') this.setVisible(targets, !object.visible)
        else this.setLocked(targets, !isLocked(object))
    }

    private _record(undo: () => void, redo: () => void) {
        this._viewer?.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.undoManager?.record({undo, redo})
    }

    private _setFilter(text: string) {
        const filter = text.trim().toLowerCase()
        if (filter === this._filter) return
        this._filter = filter
        this._list.scrollTop = 0
        this.refresh(true)
    }

    // endregion

    // region list

    /** An object that is a layer: not a widget, the multi-selection helper, or the target of a directional or spot light */
    private _isLayer(o: IObject3D) {
        return !o.userData.isWidgetRoot && o.assetType !== 'widget' && !o.userData.isMultiSelectDummy &&
            (o.parent as any)?.target !== o
    }

    private _kids(o: IObject3D) {
        if (!this.showLeafChildren && this._isLeaf(o)) return []
        return (o.children as IObject3D[]).filter(c => this._isLayer(c))
    }

    /** An object of {@link leafTypes}: its children do not show */
    private _isLeaf(o: IObject3D) {
        const t = this.leafTypes
        const k = o as IObject3D & {isLine?: boolean, isPoints?: boolean}
        return !!(k.isMesh && t.includes('mesh') || k.isLine && t.includes('line') || k.isPoints && t.includes('points') ||
            k.isCamera && t.includes('camera') || k.isLight && t.includes('light'))
    }

    /** Builds the rows of the tree and of the open tab of assets, and the counts of the tabs */
    private _build() {
        this._structureDirty = false
        this._buildObjects()
        this._buildAssets()
        this._updateTabs()
    }

    /** Builds the list of rows from the tree, the open rows and the search */
    private _buildObjects() {
        this._flat = []
        this._index.clear()
        this._total = 0
        const root = this._viewer?.scene.modelRoot as IObject3D | undefined
        if (!root) return
        const filter = this._filter
        // the scene and the default camera, above the model; not in a search
        const scene = this._viewer!.scene
        if (this.sceneRows && !filter) {
            for (const o of [scene, scene.defaultCamera] as (IObject3D | undefined)[]) {
                if (!o) continue
                this._index.set(o, this._flat.length)
                this._flat.push({object: o, depth: 0, kids: 0, open: false, pinned: true})
            }
        }
        // one pass for the search: an object stays when it or an object inside it matches
        const keep = new Set<IObject3D>()
        const mark = (o: IObject3D): boolean => {
            this._total++
            let match = !filter || (o.name || '').toLowerCase().includes(filter)
            for (const k of this._kids(o)) if (mark(k)) match = true
            if (match) keep.add(o)
            return match
        }
        const top = this._kids(root)
        for (const o of top) mark(o)
        // the selected objects and the objects that hold them: a child of these always shows
        const holdsSel = new Set<IObject3D>()
        for (const s of this._selected()) {
            holdsSel.add(s)
            s.traverseAncestors(a => holdsSel.add(a as IObject3D))
        }
        const limit = Math.max(0, Math.floor(this.maxChildren))
        const add = (o: IObject3D, depth: number) => {
            if (!keep.has(o)) return
            const kids = this._kids(o)
            // the search opens the groups that hold a match
            const open = kids.length > 0 && (!!filter || this._expanded.has(o))
            this._index.set(o, this._flat.length)
            this._flat.push({object: o, depth, kids: kids.length, open})
            if (!open) return
            // the first children and a "… N more" row; not for one child more, the search, or the selection
            const cut = limit > 0 && !filter && kids.length > limit + 1 && !this._showAll.has(o) &&
                !kids.slice(limit).some(k => holdsSel.has(k))
            for (const k of cut ? kids.slice(0, limit) : kids) add(k, depth + 1)
            if (cut) this._flat.push({object: o, depth: depth + 1, kids: 0, open: false, more: kids.length - limit})
        }
        for (const o of top) add(o, 0)
    }

    private _renderNow() {
        if (this._frame) cancelFrame(this._frame)
        this._render()
    }

    private _scrollTo(i: number) {
        const row = LayersPanelPlugin.RowHeight
        const top = i * row, h = this._list.clientHeight
        if (top < this._list.scrollTop) this._list.scrollTop = top
        else if (top + row > this._list.scrollTop + h) this._list.scrollTop = top + row - h
    }

    /** Fills the rows in view */
    private _render = () => {
        this._frame = 0
        if (!this._viewer || this._renaming || this.isDisabled()) return
        if (this._structureDirty) this._build()
        if (this._tab !== 'objects') return this._renderAssets()
        const flat = this._flat
        const n = flat.length
        const sel = this._selected()
        if (this._reveal) {
            this._reveal = false
            const i = sel.length ? this._index.get(sel[0]) : undefined
            if (i !== undefined) this._scrollTo(i)
        }
        const selected = new Set(sel)
        const parentsOfSel = new Set<IObject3D>()
        for (const s of sel) s.traverseAncestors(a => parentsOfSel.add(a as IObject3D))
        const hovered = this._picking?.picker?.hoverObject
        const [first, last] = this._window(n)
        for (let i = first; i < last; i++) {
            const r = flat[i]
            this._fill(this._rowAt(i - first), i, r, selected.has(r.object), parentsOfSel.has(r.object), r.object === hovered)
        }
        this._endRender(first, last, n, this._filter ? 'No layers match' : 'No objects in the scene')
    }

    /** The rows of the list in the DOM: the ones in view, and OVERSCAN more above and below */
    private _window(n: number): [first: number, last: number] {
        const rowHeight = LayersPanelPlugin.RowHeight
        this._spacer.style.height = n * rowHeight + 'px'
        const scroll = this._list.scrollTop
        const first = Math.max(0, Math.floor(scroll / rowHeight) - OVERSCAN)
        return [first, Math.min(n, Math.ceil((scroll + this._list.clientHeight) / rowHeight) + OVERSCAN)]
    }

    /** After the rows from `first` to `last` of `n` are filled: hides the other rows of the pool, the hover, the empty text and the count */
    private _endRender(first: number, last: number, n: number, emptyText: string) {
        for (let j = Math.max(0, last - first); j < this._pool.length; j++) {
            const p = this._pool[j]
            if (p.row.style.display === 'none') continue
            p.row.style.display = 'none'
            delete p.row.dataset.index
        }
        // the row under the pointer can have another object now (a scroll, a change of the tree)
        if (this._hoverRowEl) this._setRowHover(this._rowTarget(this._hoverRowEl))
        this._empty.style.display = n ? 'none' : ''
        this._empty.textContent = emptyText
        const count = this._tabCounts[this._tab] ?? 0
        this._count.textContent = count ? String(count) : ''
    }

    /** Fills the rows of the open tab of assets in view */
    private _renderAssets() {
        const rows = this._assetRows
        const picked = this._picking?.picker?.selectedObject as unknown
        const selected = new Set(this._selected())
        const [first, last] = this._window(rows.length)
        for (let i = first; i < last; i++) {
            const r = rows[i]
            const isSel = r.user ? selected.has(r.user) : r.asset === picked
            this._fillAsset(this._rowAt(i - first), i, r, isSel, !r.user && r.users.some(u => selected.has(u)))
        }
        const name = TABS.find(t => t[0] === this._tab)![1].toLowerCase()
        this._endRender(first, last, rows.length, this._filter ? 'Nothing matches' : `No ${name} in the scene`)
    }

    /** The row element at a place in the pool, made when the pool has none there */
    private _rowAt(j: number): RowElements {
        let p = this._pool[j]
        if (p) return p
        const row = el('div', 'lyp-row')
        row.setAttribute('role', 'treeitem')
        p = {
            row,
            caret: row.appendChild(el('span', 'lyp-caret')),
            kind: row.appendChild(el('span', 'lyp-kind')),
            name: row.appendChild(el('span', 'lyp-name')),
            meta: row.appendChild(el('span', 'lyp-meta')),
            lock: row.appendChild(el('button', 'lyp-btn lyp-lock')),
            eye: row.appendChild(el('button', 'lyp-btn lyp-eye')),
        }
        p.lock.type = p.eye.type = 'button'
        // the list keeps the focus, for the arrow keys
        p.lock.tabIndex = p.eye.tabIndex = -1
        this._pool[j] = p
        this._spacer.appendChild(row)
        return p
    }

    /** The object of a row element; none for a "… N more" row */
    private _rowObject(row: HTMLElement): IObject3D | undefined {
        const i = row.dataset.index
        if (this._tab !== 'objects') return i === undefined ? undefined : this._assetRows[+i]?.user
        const r = i === undefined ? undefined : this._flat[+i]
        return r && !r.more ? r.object : undefined
    }

    /** The row of a tab of assets that a row element shows */
    private _assetRowOf(row: HTMLElement): AssetRow | undefined {
        const i = row.dataset.index
        return this._tab === 'objects' || i === undefined ? undefined : this._assetRows[+i]
    }

    /** What the viewport outlines for a row element: its object, or the users of its asset */
    private _rowTarget(row: HTMLElement): {key: unknown, objects: IObject3D[]} | null {
        const a = this._assetRowOf(row)
        if (a) return a.user ? {key: a.user, objects: [a.user]} : {key: a.asset, objects: a.users}
        const o = this._rowObject(row)
        // the scene row: no outline of the whole model
        return o ? {key: o, objects: o === this._viewer?.scene ? [] : [o]} : null
    }

    /** Fills one row. Each part is set only when it changes, so a refresh in each frame (a drag in the viewport) is cheap. */
    private _fill(p: RowElements, i: number, r: LayerRow, isSel: boolean, isParentOfSel: boolean, isHovered: boolean) {
        const {row} = p
        row.dataset.index = String(i)
        setIfChanged(row.style, 'display', '')
        setIfChanged(row.style, 'top', i * LayersPanelPlugin.RowHeight + 'px')
        setIfChanged(row.style, 'paddingLeft', 4 + r.depth * INDENT + 'px')
        row.setAttribute('aria-level', String(r.depth + 1))
        if (r.more) return this._fillMore(p, r.more)
        if (r.pinned) return this._fillPinned(p, i, r.object, isSel)
        setIfChanged(p.lock.style, 'visibility', '')
        setIfChanged(p.eye.style, 'visibility', '')
        setIfChanged(p.meta, 'textContent', '')
        const o = r.object
        const root = this._viewer?.scene.modelRoot
        // hidden or locked by a parent too
        let hidden = !o.visible
        let locked = isLocked(o)
        for (let a = o.parent as IObject3D | null; a && a !== root; a = a.parent as IObject3D | null) {
            if (!a.visible) hidden = true
            if (isLocked(a)) locked = true
        }
        const cls = 'lyp-row' + (isSel ? ' lyp-sel' : isParentOfSel ? ' lyp-sel-parent' : '') +
            (hidden ? ' lyp-hidden' : '') + (locked ? ' lyp-locked' : '') + (isHovered ? ' lyp-hover' : '')
        setIfChanged(row, 'className', cls)
        row.setAttribute('aria-selected', String(isSel))
        if (r.kids) row.setAttribute('aria-expanded', String(r.open))
        else row.removeAttribute('aria-expanded')

        this._setCaret(p, r.kids ? r.open ? 'open' : 'closed' : '', 'Open or close (Alt: all levels)')
        this._setObjectKind(p, o)
        const name = o.name || o.type
        setIfChanged(p.name, 'textContent', name)
        setIfChanged(p.name, 'title', name)

        toggleButton(p.lock, isLocked(o), locked, ICONS.lock, ICONS.unlock, 'Unlock', 'Lock: not picked in the viewport')
        toggleButton(p.eye, !o.visible, hidden, ICONS.eyeOff, ICONS.eye, 'Show (H)', 'Hide (H)')
        // a camera cannot be hidden
        setIfChanged(p.eye, 'disabled', !!o.isCamera)
    }

    /** The arrow of a row: `open`, `closed`, or none */
    private _setCaret(p: RowElements, state: '' | 'open' | 'closed', title: string) {
        if (p.caret.dataset.state === state) return
        p.caret.dataset.state = state
        p.caret.innerHTML = state ? ICONS[state] : ''
        p.caret.title = state ? title : ''
    }

    /** The icon of an object: its kind (a light or a camera, in its colour), a mesh, or a group */
    private _setObjectKind(p: RowElements, o: IObject3D) {
        const kind = getWidgetKind(o)
        const kindKey = kind ?? ((o as any).geometry ? 'mesh' : 'group')
        if (p.kind.dataset.kind === kindKey) return
        p.kind.dataset.kind = kindKey
        p.kind.innerHTML = kind ? svg(`<path d="${widgetKinds[kind].icon}"/>`) : ICONS[kindKey as 'mesh' | 'group']
        p.kind.style.color = kind ? widgetKinds[kind].color : ''
    }

    /** Fills a row of a tab of assets: an asset (its swatch, picture or icon, name, size and users) or one of its users */
    private _fillAsset(p: RowElements, i: number, r: AssetRow, isSel: boolean, usedBySel: boolean) {
        const {row} = p
        row.dataset.index = String(i)
        setIfChanged(row.style, 'display', '')
        setIfChanged(row.style, 'top', i * LayersPanelPlugin.RowHeight + 'px')
        setIfChanged(row.style, 'paddingLeft', 4 + (r.user ? INDENT : 0) + 'px')
        row.setAttribute('aria-level', r.user ? '2' : '1')
        setIfChanged(row, 'className', 'lyp-row ' + (r.user ? 'lyp-user' : 'lyp-asset') + (isSel ? ' lyp-sel' : usedBySel ? ' lyp-sel-parent' : ''))
        row.setAttribute('aria-selected', String(isSel))
        const opens = !r.user && r.users.length > 0
        if (opens) row.setAttribute('aria-expanded', String(r.open))
        else row.removeAttribute('aria-expanded')
        this._setCaret(p, opens ? r.open ? 'open' : 'closed' : '', 'Show or hide the objects that use it')
        setIfChanged(p.lock.style, 'visibility', 'hidden')
        setIfChanged(p.eye.style, 'visibility', 'hidden')
        if (r.user) {
            this._setObjectKind(p, r.user)
            setIfChanged(p.name, 'textContent', r.user.name || r.user.type)
            setIfChanged(p.name, 'title', p.name.textContent!)
            setIfChanged(p.meta, 'textContent', '')
            return
        }
        const a = r.asset
        const swatch = (a as IMaterial).isMaterial ? '#' + ((a as IMaterial & {color?: {getHexString(): string}}).color?.getHexString() ?? 'cccccc') : ''
        const thumb = (a as ITexture).isTexture ? this._thumb(a as ITexture) : undefined
        // each picture has its number: a reused row, or a texture with a new image, draws the new picture
        const kindKey = swatch ? 'swatch' + swatch : thumb?.url ? 'thumb:' + thumb.n : (a as ITexture).isTexture ? 'texture' : 'geometry'
        if (p.kind.dataset.kind !== kindKey) {
            p.kind.dataset.kind = kindKey
            p.kind.style.color = ''
            p.kind.innerHTML = swatch ? `<span class="lyp-swatch" style="background:${swatch}"></span>` :
                thumb?.url ? `<img class="lyp-thumb" alt="" src="${thumb.url}">` : ICONS[(a as ITexture).isTexture ? 'texture' : 'geometry']
        }
        const name = this._assetName(a)
        setIfChanged(p.name, 'textContent', name)
        setIfChanged(p.name, 'title', name)
        setIfChanged(p.meta, 'textContent', this._assetMeta(r))
    }

    /** Fills the row of the scene or of the default camera: a grey icon, a dimmer name, no buttons; a line below the last one */
    private _fillPinned(p: RowElements, i: number, o: IObject3D, isSel: boolean) {
        const end = !this._flat[i + 1]?.pinned
        setIfChanged(p.row, 'className', 'lyp-row lyp-pinned' + (isSel ? ' lyp-sel' : '') + (end ? ' lyp-pinned-end' : ''))
        p.row.removeAttribute('aria-expanded')
        p.row.setAttribute('aria-selected', String(isSel))
        this._setCaret(p, '', '')
        const isScene = o === this._viewer?.scene
        const key = isScene ? 'pinned-scene' : 'pinned-camera'
        if (p.kind.dataset.kind !== key) {
            p.kind.dataset.kind = key
            p.kind.style.color = ''
            p.kind.innerHTML = isScene ? ICONS.scene : svg(`<path d="${widgetKinds[getWidgetKind(o) ?? 'perspectiveCamera'].icon}"/>`)
        }
        const name = isScene ? 'Scene' : o.name || 'Default camera'
        setIfChanged(p.name, 'textContent', name)
        setIfChanged(p.name, 'title', name)
        setIfChanged(p.meta, 'textContent', '')
        setIfChanged(p.lock.style, 'visibility', 'hidden')
        setIfChanged(p.eye.style, 'visibility', 'hidden')
    }

    /** Fills the "… N more" row of an open object: no icon and no buttons; a click shows all the children */
    private _fillMore(p: RowElements, more: number) {
        setIfChanged(p.row, 'className', 'lyp-row lyp-more')
        p.row.removeAttribute('aria-expanded')
        p.row.setAttribute('aria-selected', 'false')
        this._setCaret(p, '', '')
        p.kind.dataset.kind = ''
        p.kind.innerHTML = ''
        setIfChanged(p.meta, 'textContent', '')
        setIfChanged(p.name, 'textContent', `… ${more} more`)
        setIfChanged(p.name, 'title', 'Show all')
        setIfChanged(p.lock.style, 'visibility', 'hidden')
        setIfChanged(p.eye.style, 'visibility', 'hidden')
    }

    private _structureChanged() {
        this.refresh(true)
    }

    // region tabs

    /** A tab turned on or off: the tab bar shows only with two tabs or more; a tab turned off gives its place to the first one */
    private _tabsChanged() {
        if (!this._tabsEl) return // the first set of the settings, in the constructor
        const tabs = this.tabs
        if (!tabs.includes(this._tab)) {
            this._tab = tabs[0]
            this._setRowHover(null)
            this._list.scrollTop = 0
        }
        this._updateTabs()
        this.refresh(true)
    }

    /** The buttons of the tab bar: the tabs that are on, the open one marked, the counts in the tooltips */
    private _updateTabs() {
        const tabs = this.tabs
        this._tabsEl.style.display = tabs.length > 1 ? '' : 'none'
        for (const b of Array.from(this._tabsEl.children) as HTMLButtonElement[]) {
            const tab = b.dataset.tab as LayersTab
            const on = tab === this._tab
            b.style.display = tabs.includes(tab) ? '' : 'none'
            b.classList.toggle('lyp-on', on)
            b.setAttribute('aria-selected', String(on))
            const count = this._tabCounts[tab]
            b.title = TABS.find(t => t[0] === tab)![1] + (count === undefined ? '' : ': ' + count)
        }
    }

    private _onAssetsChanged = () => {
        this.refresh(true)
    }

    /**
     * A material changed (it bubbles to the scene): its name, colour or maps show in the Materials and the Textures tab.
     * The other tabs do not show them, and a drag of a slider sends it in each frame.
     */
    private _onMaterialUpdate = () => {
        if (this._tab === 'materials' || this._tab === 'textures') this.refresh(true)
    }

    /**
     * A texture of a material changed (a new image: it bubbles to the scene): its picture and size show in the Textures
     * tab. The rows are drawn again; the list stays (the picture and the size are read when a row is drawn).
     */
    private _onTextureUpdate = () => {
        if (this._tab === 'textures') this.refresh()
    }

    /** Builds the rows of the open tab of assets (an open asset lists its users under it), and the counts of the tabs */
    private _buildAssets() {
        this._assetRows = []
        this._tabCounts = {objects: this._total}
        let open: Omit<AssetRow, 'open'>[] = []
        for (const tab of this.tabs) {
            if (tab === 'objects') continue
            const list = this._collect(tab)
            this._tabCounts[tab] = list.length
            if (tab === this._tab) open = list
        }
        const filter = this._filter
        for (const x of open) {
            if (filter && !this._assetName(x.asset).toLowerCase().includes(filter)) continue
            const isOpen = x.users.length > 0 && this._openAssets.has(x.asset)
            this._assetRows.push({...x, open: isOpen})
            if (isOpen) for (const user of x.users) this._assetRows.push({...x, open: false, user})
        }
    }

    /**
     * The materials, textures or geometries that the objects in the scene use (the `Object3DManager` of the viewer), each
     * with those objects. A texture of a material counts the objects of the material; a texture of the scene counts too.
     */
    private _collect(tab: LayersTab): Omit<AssetRow, 'open'>[] {
        const om = this._viewer?.object3dManager
        const root = this._viewer?.scene.modelRoot
        if (!om || !root || tab === 'objects') return []
        const inScene = (o: IObject3D) => {
            for (let p: IObject3D | null = o; p; p = p.parent as IObject3D | null) if (p === root) return true
            return false
        }
        const users = (a: {appliedMeshes?: Set<IObject3D>}) => [...a.appliedMeshes ?? []].filter(inScene)
        if (tab === 'materials') return om.getMaterials().map(asset => ({asset, users: users(asset), scene: false})).filter(x => x.users.length)
        if (tab === 'geometries') return om.getGeometries().map(asset => ({asset, users: users(asset), scene: false})).filter(x => x.users.length)
        return om.getTextures().map(asset => {
            const found = new Set<IObject3D>()
            let scene = false
            asset.appliedObjects?.forEach(o => {
                if ((o as IMaterial).isMaterial) users(o as IMaterial).forEach(m => found.add(m))
                else if ((o as IObject3D & {isScene?: boolean}).isScene) scene = true
                else if (inScene(o as IObject3D)) found.add(o as IObject3D)
            })
            return {asset, users: [...found], scene}
        }).filter(x => x.users.length || x.scene)
    }

    /** The name of an asset, or its kind and the start of its uuid */
    private _assetName(a: LayerAsset) {
        return a.name || ((a as ITexture).isTexture ? 'Texture' : (a as IMaterial).isMaterial ? (a as IMaterial).type : 'Geometry') + ' ' + a.uuid.slice(0, 4)
    }

    /** The short text of an asset: the size of a texture, the generator and the vertices of a geometry, the users */
    private _assetMeta(r: AssetRow) {
        const a = r.asset
        const users = r.users.length ? `${r.users.length} obj` : r.scene ? 'scene' : ''
        if ((a as ITexture).isTexture) {
            const image = (a as ITexture).image as {width?: number, height?: number} | undefined
            return [image?.width ? `${image.width}×${image.height}` : '', users].filter(Boolean).join(' · ')
        }
        if ((a as IGeometry).isBufferGeometry) {
            const g = a as IGeometry
            const v = g.attributes?.position?.count ?? 0
            const generator = g.userData?.generationParams?.type as string | undefined
            return [generator, (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v) + ' v', users].filter(Boolean).join(' · ')
        }
        return users
    }

    /**
     * A small picture of a texture: a data URL (`url`, '' when its image cannot be drawn: a data texture, another
     * origin) and its number (`n`). It is drawn again when the texture gets another image (the Flip Y of the image UI);
     * an image that is not loaded yet gives none, so a later render draws it.
     */
    private _thumb(t: ITexture): {url: string, n: number} | undefined {
        const cached = this._thumbs.get(t)
        if (cached && cached.image === t.image) return cached
        let url = ''
        const img = t.image as CanvasImageSource & {width?: number} | undefined
        const drawable = typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement ||
            typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement ||
            typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap
        if (drawable && !img!.width) return undefined
        try {
            if (drawable) {
                const c = document.createElement('canvas')
                c.width = c.height = 32
                c.getContext('2d')?.drawImage(img!, 0, 0, 32, 32)
                url = c.toDataURL()
            }
        } catch (e) {
            url = '' // a texture from another origin
        }
        const thumb = {image: t.image, url, n: ++this._thumbCount}
        this._thumbs.set(t, thumb)
        return thumb
    }

    // endregion

    // endregion
}

/** An element with a class */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    e.className = className
    return e
}

/** Sets a property only when it changes: a write to the DOM, even of the same value, can cost a style or layout pass */
function setIfChanged<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
    if (target[key] !== value) target[key] = value
}

function isLocked(object: IObject3D) {
    return object.userData.userSelectable === false
}

/**
 * The state of the eye or the lock of a row: on for the object itself, or from a parent (`inherited`: the icon of on,
 * dimmed; a click sets it on the object). The parts are set only when the state changes (innerHTML reads back changed).
 */
function toggleButton(b: HTMLButtonElement, on: boolean, inherited: boolean, onIcon: string, offIcon: string, onTitle: string, offTitle: string) {
    const state = on ? 'on' : inherited ? 'inherited' : 'off'
    if (b.dataset.state === state) return
    b.dataset.state = state
    b.classList.toggle('lyp-on', on)
    b.classList.toggle('lyp-inherited', !on && inherited)
    b.innerHTML = on || inherited ? onIcon : offIcon
    b.title = on ? onTitle : offTitle
    b.setAttribute('aria-pressed', String(on))
}

function nextFrame(f: () => void): number {
    return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16) as any as number
}

function cancelFrame(id: number) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id)
}
