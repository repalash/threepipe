import {
    AViewerPluginSync,
    createStyles,
    getWidgetKind,
    IObject3D,
    IViewerEvent,
    onChange,
    PickingPlugin,
    ThreeViewer,
    uiFolderContainer,
    uiToggle,
    widgetKinds,
} from 'threepipe'
import type {UndoManagerPlugin} from 'threepipe'
import type {SelectionOutlinePlugin} from './SelectionOutlinePlugin'
import type {TweakpaneEditorPlugin} from './TweakpaneEditorPlugin'
import type {EditorFrameArea, EditorFrameAreaOptions} from './frame/EditorFrame'
import styles from './LayersPanelPlugin.css?inline'

/** One row of the list: an object, its depth in the tree, its number of child layers, and if it is open */
interface LayerRow {
    object: IObject3D
    depth: number
    kids: number
    open: boolean
}

/** The elements of one row of the virtual list. The rows are made once and filled again for each render. */
interface RowElements {
    row: HTMLDivElement
    caret: HTMLSpanElement
    kind: HTMLSpanElement
    name: HTMLSpanElement
    lock: HTMLButtonElement
    eye: HTMLButtonElement
}

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
 *   and follows the picking ({@link viewportHover}). It renders one more frame and does not restart the progressive
 *   render. The object hovered in the viewport is marked in the list.
 * - The eye button hides or shows the object, the lock button locks or unlocks it. A locked object has
 *   `userData.userSelectable` set to `false`: the {@link PickingPlugin} does not pick it, or the objects inside it, in the
 *   viewport; the list can still select it. A row in the selection changes all the selected objects. Both are undo steps
 *   with the `UndoManagerPlugin`.
 * - A double-click on a name (or F2) renames the object: Enter or a click outside keeps the name, Escape goes back.
 * - With the focus in the list: Up and Down select the next row (Shift adds it), Right opens a row or goes to its first
 *   child, Left closes a row or goes to its parent.
 * - The search field shows only the objects whose name has the text, with the groups that hold them.
 * - A virtual list: only the rows in view are in the DOM, so a scene with many objects stays fast.
 *
 * Lights and cameras have the icon and the colour of their kind (`widgetKinds` of threepipe), as in the viewport.
 *
 * Where the panel goes: in the `container` given to the constructor; else, with a {@link TweakpaneEditorPlugin}, in the
 * area {@link editorArea} of its page frame (the left sidebar by default), with an entry in the mode bar
 * ({@link LayersPanelPlugin.AreaEntry}); else the app puts {@link element} in the page. The element fills its parent: give
 * the parent a height. The plugin takes the panel out of the page when it is removed.
 *
 * The plugin UI folder (Layers Panel) has the settings. The settings and the open rows are not saved with the viewer.
 *
 * @category Plugins
 */
@uiFolderContainer('Layers Panel')
export class LayersPanelPlugin extends AViewerPluginSync {
    static readonly PluginType = 'LayersPanelPlugin'
    /** Adds the stylesheet of the panel to the page when the first plugin is made. Off: the page styles the `lyp-` classes. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    /** The height of a row in px. The stylesheet takes it from the CSS variable `--lyp-row` on {@link element}. */
    static readonly RowHeight = 28
    /**
     * The entry of the panel in the mode bar of the editor frame (`TweakpaneEditorPlugin.setArea`): its name, icon and
     * colour. Set it before the plugin is added.
     */
    static AreaEntry: EditorFrameAreaOptions = {name: 'Layers', icon: ICONS.layers, color: '#6366f1'}

    dependencies = [PickingPlugin]
    serializeWithViewer = false

    /** Off: the panel is hidden, and out of the area of the editor frame */
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
     * The area of the page frame of the {@link TweakpaneEditorPlugin} for the panel (`TweakpaneEditorPlugin.setArea`).
     * `null`: the plugin does not put the panel in the frame. Not used with a `container`.
     */
    @onChange(LayersPanelPlugin.prototype._place)
        editorArea: EditorFrameArea | null = 'left'

    /** The panel: the header, the search field and the list. It fills its parent. */
    readonly element: HTMLDivElement
    /** The element that holds the panel while the plugin is added, given to the constructor */
    readonly container?: HTMLElement

    private _list: HTMLDivElement
    private _spacer: HTMLDivElement
    private _empty: HTMLDivElement
    private _count: HTMLSpanElement
    private _search: HTMLInputElement
    private _filter = ''
    /** The open rows. Weak: a removed object is not kept. */
    private _expanded = new WeakSet<IObject3D>()
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
    /** The object of the row under the pointer */
    private _rowHover: IObject3D | null = null
    /** The row element under the pointer: a render can give it another object (the rows are reused) */
    private _hoverRowEl: HTMLElement | null = null
    /** The value of `userData.userSelectable` before a lock, given back by the unlock */
    private _beforeLock = new WeakMap<IObject3D, boolean | undefined>()
    private _picking?: PickingPlugin
    private _editor?: TweakpaneEditorPlugin
    /** The area of the editor frame that has the panel now */
    private _placedArea: EditorFrameArea | null = null
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.refresh())

    /**
     * @param container - the element that holds the panel while the plugin is added. Without it, the panel goes in the
     * page frame of the {@link TweakpaneEditorPlugin} ({@link editorArea}), or the app puts {@link element} in the page.
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
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate)
        viewer.scene.addEventListener('objectUpdate', this._onObjectUpdate)
        // the PickingPlugin and the TweakpaneEditorPlugin can be added before or after this plugin, removed and replaced
        viewer.addPluginListener('add', this._onPluginAdded, 'PickingPlugin', 'TweakpaneEditorPlugin')
        viewer.addPluginListener('remove', this._onPluginRemoved, 'PickingPlugin', 'TweakpaneEditorPlugin')
        this._setPicking(viewer.getPlugin<PickingPlugin>('PickingPlugin'))
        this._setEditor(viewer.getPlugin<TweakpaneEditorPlugin>('TweakpaneEditorPlugin'))
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
        viewer.removePluginListener('add', this._onPluginAdded)
        viewer.removePluginListener('remove', this._onPluginRemoved)
        this._setPicking(undefined)
        this._setEditor(undefined)
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

    /** Called when {@link enabled} changes (and by `enable` / `disable`): shows or hides the panel */
    setDirty() {
        if (!this._viewer) return // the first set of enabled, in the constructor
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
        return this._flat.map(r => r.object)
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
        const set = (o: IObject3D) => open ? this._expanded.add(o) : this._expanded.delete(o)
        if (deep) object.traverse(o => set(o as IObject3D))
        else set(object)
        this.refresh(true)
    }

    /** Closes all the rows */
    collapseAll() {
        this._expanded = new WeakSet()
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
        const i = this._index.get(object)
        if (i === undefined) return false
        this._renaming?.(true)
        this._scrollTo(i)
        this._renderNow()
        const els = this._pool.find(p => p.row.dataset.index === String(i))
        if (!els) return false
        const input = el('input', 'lyp-rename')
        input.value = object.name
        input.setAttribute('aria-label', 'Name')
        els.name.style.display = 'none'
        els.row.insertBefore(input, els.lock)
        input.focus()
        input.select()
        const finish = (commit: boolean) => {
            if (this._renaming !== finish) return
            this._renaming = undefined
            const name = input.value.trim()
            input.remove()
            els.name.style.display = ''
            if (commit) this.renameObject(object, name)
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

    /** Puts the panel in its container or in the area of the editor frame, or takes it out (disabled) */
    private _place() {
        if (!this._viewer) return
        const on = !this.isDisabled()
        this.element.style.display = on ? '' : 'none'
        const area = on && this._editor && !this.container ? this.editorArea : null
        if (area !== this._placedArea) {
            if (this._placedArea) this._editor?.setArea(this._placedArea, null)
            this._placedArea = area
            if (area) this._editor!.setArea(area, this.element, LayersPanelPlugin.AreaEntry)
        }
        if (this.container && on && this.element.parentElement !== this.container) this.container.appendChild(this.element)
    }

    private _setEditor(editor: TweakpaneEditorPlugin | undefined) {
        if (editor === this._editor) return
        if (this._placedArea) this._editor?.setArea(this._placedArea, null)
        this._placedArea = null
        this._editor = editor
        this._place()
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
        this._setEditor(this._viewer?.getPlugin<TweakpaneEditorPlugin>('TweakpaneEditorPlugin'))
    }

    // the removed plugin is still the one getPlugin returns at this point
    private _onPluginRemoved = (e: IViewerEvent) => {
        if (e.plugin === this._picking) this._setPicking(undefined)
        if (e.plugin === this._editor) this._setEditor(undefined)
    }

    // endregion

    // region events

    private _onSceneUpdate = (e: {object?: IObject3D, hierarchyChanged?: boolean, change?: string}) => {
        if (e.object && (e.object.assetType === 'widget' || e.object.userData?.isWidgetRoot)) return
        // a new name can change what the search finds; other changes (visibility, a move) only change the rows
        this.refresh(!!e.hierarchyChanged || e.change === 'name')
    }

    /**
     * An object added or removed. The scene sends no `sceneUpdate` for a camera (`RootScene.refreshScene` leaves its
     * changes out), so the list hears of it here.
     */
    private _onObjectUpdate = (e: {change?: string}) => {
        if (e.change === 'addedToParent' || e.change === 'removedFromParent') this.refresh(true)
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
        this.refresh(opened)
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

    /** The row under the pointer: its object is outlined in the viewport ({@link viewportHover}) */
    private _setRowHover(object: IObject3D | null) {
        if (object === this._rowHover) return
        this._rowHover = object
        this._outlineHover()
    }

    /**
     * The hover of the {@link SelectionOutlinePlugin}: the object of the hovered row, else the hover of the viewport (when
     * the pointer leaves the list). The setter of the outline redraws only on a change, one frame.
     */
    private _outlineHover() {
        const outline = this._viewer?.getPlugin<SelectionOutlinePlugin>('SelectionOutlinePlugin')
        if (!outline?.followPicking) return
        const row = this.viewportHover ? this._rowHover : null
        const canvas = this._picking?.picker?.hoverObject as IObject3D | null | undefined
        outline.hovered = row ? [row] : canvas?.isObject3D ? [canvas] : []
    }

    private _onPointerOver = (e: PointerEvent) => {
        this._hoverRowEl = (e.target as Element | null)?.closest?.('.lyp-row') as HTMLElement | null
        this._setRowHover(this._hoverRowEl && this._rowObject(this._hoverRowEl) || null)
    }

    private _onClick = (e: MouseEvent) => {
        const target = e.target as Element
        if (target.closest('.lyp-rename')) return
        const row = target.closest('.lyp-row') as HTMLElement | null
        const o = row && this._rowObject(row)
        if (!o) return
        // the list keeps the focus (a click can focus a button), for the arrow keys
        this._list.focus({preventScroll: true})
        if (target.closest('.lyp-eye')) this._toggle(o, 'visible')
        else if (target.closest('.lyp-lock')) this._toggle(o, 'locked')
        else if (target.closest('.lyp-caret') && this._flat[this._index.get(o)!]?.kids) {
            this.setExpanded(o, !this._expanded.has(o), e.altKey)
        } else {
            if (e.shiftKey || e.ctrlKey || e.metaKey) this._picking?.toggleSelectedObject(o)
            else this._select([o])
        }
    }

    private _onDoubleClick = (e: MouseEvent) => {
        const target = e.target as Element
        if (!target.closest('.lyp-name')) return
        const row = target.closest('.lyp-row') as HTMLElement | null
        const o = row && this._rowObject(row)
        if (o) this.startRename(o)
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
            const s = this._selected()[0]
            if (s) {
                e.preventDefault()
                this.startRename(s)
            }
            return
        }
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
        e.preventDefault()
        e.stopPropagation() // not for the camera or the other shortcuts of the page
        if (this._structureDirty) this._build()
        const flat = this._flat
        const sel = this._selected()
        const i = sel.length ? this._index.get(sel[0]) ?? -1 : -1
        const r = i >= 0 ? flat[i] : undefined
        const go = (j: number) => {
            const t = flat[Math.max(0, Math.min(flat.length - 1, j))]
            if (!t) return
            if (e.shiftKey && sel.length && this._picking?.multiSelectEnabled) this._select([t.object, ...sel.filter(s => s !== t.object)])
            else this._select([t.object])
        }
        if (e.key === 'ArrowDown') go(i + 1)
        else if (e.key === 'ArrowUp') go(i < 0 ? flat.length - 1 : i - 1)
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

    // endregion

    // region actions

    private _selected(): IObject3D[] {
        return (this._picking?.getSelectedObjects() ?? []).filter(o => (o as IObject3D)?.isObject3D) as IObject3D[]
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
        return (o.children as IObject3D[]).filter(c => this._isLayer(c))
    }

    /** Builds the list of rows from the tree, the open rows and the search */
    private _build() {
        this._structureDirty = false
        this._flat = []
        this._index.clear()
        this._total = 0
        const root = this._viewer?.scene.modelRoot as IObject3D | undefined
        if (!root) return
        const filter = this._filter
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
        const add = (o: IObject3D, depth: number) => {
            if (!keep.has(o)) return
            const kids = this._kids(o)
            // the search opens the groups that hold a match
            const open = kids.length > 0 && (!!filter || this._expanded.has(o))
            this._index.set(o, this._flat.length)
            this._flat.push({object: o, depth, kids: kids.length, open})
            if (open) for (const k of kids) add(k, depth + 1)
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
        const flat = this._flat
        const n = flat.length
        const rowHeight = LayersPanelPlugin.RowHeight
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
        this._spacer.style.height = n * rowHeight + 'px'
        // only the rows in view, and OVERSCAN more above and below, are in the DOM
        const scroll = this._list.scrollTop
        const first = Math.max(0, Math.floor(scroll / rowHeight) - OVERSCAN)
        const last = Math.min(n, Math.ceil((scroll + this._list.clientHeight) / rowHeight) + OVERSCAN)
        for (let i = first; i < last; i++) {
            const r = flat[i]
            this._fill(this._rowAt(i - first), i, r, selected.has(r.object), parentsOfSel.has(r.object), r.object === hovered)
        }
        for (let j = Math.max(0, last - first); j < this._pool.length; j++) {
            const p = this._pool[j]
            if (p.row.style.display === 'none') continue
            p.row.style.display = 'none'
            delete p.row.dataset.index
        }
        // the row under the pointer can have another object now (a scroll, a change of the tree)
        if (this._hoverRowEl) this._setRowHover(this._rowObject(this._hoverRowEl) ?? null)
        this._empty.style.display = n ? 'none' : ''
        this._empty.textContent = this._filter ? 'No layers match' : 'No objects in the scene'
        this._count.textContent = this._total ? String(this._total) : ''
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

    private _rowObject(row: HTMLElement): IObject3D | undefined {
        const i = row.dataset.index
        return i === undefined ? undefined : this._flat[+i]?.object
    }

    /** Fills one row. Each part is set only when it changes, so a refresh in each frame (a drag in the viewport) is cheap. */
    private _fill(p: RowElements, i: number, r: LayerRow, isSel: boolean, isParentOfSel: boolean, isHovered: boolean) {
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
        const {row} = p
        setIfChanged(row, 'className', cls)
        row.dataset.index = String(i)
        setIfChanged(row.style, 'display', '')
        setIfChanged(row.style, 'top', i * LayersPanelPlugin.RowHeight + 'px')
        setIfChanged(row.style, 'paddingLeft', 4 + r.depth * INDENT + 'px')
        row.setAttribute('aria-level', String(r.depth + 1))
        row.setAttribute('aria-selected', String(isSel))
        if (r.kids) row.setAttribute('aria-expanded', String(r.open))
        else row.removeAttribute('aria-expanded')

        const caret = r.kids ? r.open ? 'open' : 'closed' : ''
        if (p.caret.dataset.state !== caret) {
            p.caret.dataset.state = caret
            p.caret.innerHTML = caret ? ICONS[caret as 'open' | 'closed'] : ''
            p.caret.title = caret ? 'Open or close (Alt: all levels)' : ''
        }
        const kind = getWidgetKind(o)
        const kindKey = kind ?? ((o as any).geometry ? 'mesh' : 'group')
        if (p.kind.dataset.kind !== kindKey) {
            p.kind.dataset.kind = kindKey
            p.kind.innerHTML = kind ? svg(`<path d="${widgetKinds[kind].icon}"/>`) : ICONS[kindKey as 'mesh' | 'group']
            p.kind.style.color = kind ? widgetKinds[kind].color : ''
        }
        const name = o.name || o.type
        setIfChanged(p.name, 'textContent', name)
        setIfChanged(p.name, 'title', name)

        toggleButton(p.lock, isLocked(o), locked, ICONS.lock, ICONS.unlock, 'Unlock', 'Lock: not picked in the viewport')
        toggleButton(p.eye, !o.visible, hidden, ICONS.eyeOff, ICONS.eye, 'Show (H)', 'Hide (H)')
        // a camera cannot be hidden
        setIfChanged(p.eye, 'disabled', !!o.isCamera)
    }

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
