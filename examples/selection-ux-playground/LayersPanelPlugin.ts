import {AViewerPluginSync, IObject3D, PickingPlugin, ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'
import {CameraPathPlugin} from './CameraPathPlugin'

interface FlatRow {o: IObject3D, depth: number, kids: number, open: boolean, hidden: boolean, locked: boolean}

export type LayersTab = 'objects' | 'materials' | 'textures' | 'geometries'
/** A material, texture or geometry and the objects in the scene that use it; `user` rows list those objects */
type AssetRow = {kind: 'asset', a: any, users: IObject3D[], open: boolean} | {kind: 'user', o: IObject3D, a: any}
type MenuItem = [string, string, (() => void) | null]

const TABS: [LayersTab, string][] = [['objects', 'Objects'], ['materials', 'Materials'], ['textures', 'Textures'], ['geometries', 'Geometry']]

const ROW = 28

/**
 * Figma-like layers panel. Prototype replacement for the treejs based HierarchyUiPlugin.
 *
 * - Click selects, Shift/Ctrl+click adds, hover highlights the object in the viewport.
 * - Arrow keys move in the list while it has focus (up/down: next row, left/right: collapse/expand, parent/child).
 * - Show/hide and lock on each row (lock = cannot be picked or moved in the viewport, still selectable here).
 * - Double-click the name to rename. Drag rows to reorder or to move into a group (world transform is kept).
 * - Right-click for actions. Search filters by name. Alt+click on the arrow opens or closes all levels.
 * - The lock button in the header locks all editing (view-only), here and in the viewport.
 * - Virtual list: only the rows in view are in the DOM, so large scenes stay fast.
 * - Tabs for materials, textures and geometries: swatch / thumbnail / size, how many objects use each (open to list
 *   them, hover to highlight them), click selects it in PickingPlugin, double-click a geometry to edit it.
 *
 * Mount {@link element} anywhere. {@link makeMovable} lets the header drag a floating container.
 */
export class LayersPanelPlugin extends AViewerPluginSync {
    static readonly PluginType = 'LayersPanelPlugin'
    enabled = true
    dependencies = [PickingPlugin]

    readonly element: HTMLDivElement
    private _list: HTMLDivElement
    private _spacer: HTMLDivElement
    private _count: HTMLSpanElement
    private _search: HTMLInputElement
    private _lockBtn: HTMLButtonElement
    private _menu?: HTMLDivElement
    private _expanded = new Set<IObject3D>()
    private _flat: FlatRow[] = []
    private _index = new Map<IObject3D, number>()
    private _rows = new Map<IObject3D, HTMLDivElement>()
    private _structureDirty = true
    private _queued = false
    private _renaming = false
    private _dragged: IObject3D[] = []
    private _filter = ''
    private _total = 0
    private _tab: LayersTab = 'objects'
    private _tabsEl!: HTMLDivElement
    private _assetRows: AssetRow[] = []
    private _expandedAssets = new Set<any>()
    private _thumbs = new WeakMap<object, string>()

    constructor(theme: 'light' | 'dark' = 'light') {
        super()
        injectStyles()
        this.element = document.createElement('div')
        this.element.className = 'lp-root' + (theme === 'dark' ? ' lp-dark' : '')
        this.element.innerHTML = `
<div class="lp-head">
  <span class="lp-title">Layers <span class="lp-count"></span></span>
  <button class="lp-icon-btn lp-edit-lock" title="Lock editing (view only)">${ICONS.unlock}</button>
</div>
<div class="lp-search">${ICONS.search}<input placeholder="Search"></div>
<div class="lp-tabs">${TABS.map(([t, l]) => `<button data-tab="${t}">${l}<span></span></button>`).join('')}</div>
<div class="lp-list" tabindex="0" data-own-arrows><div class="lp-spacer"></div></div>`
        this._list = this.element.querySelector('.lp-list')!
        this._spacer = this.element.querySelector('.lp-spacer')!
        this._count = this.element.querySelector('.lp-count')!
        this._search = this.element.querySelector('.lp-search input')!
        this._lockBtn = this.element.querySelector('.lp-edit-lock')!
        this._tabsEl = this.element.querySelector('.lp-tabs')!
        this._tabsEl.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab as LayersTab)))
        this._search.addEventListener('input', () => {
            this._filter = this._search.value.trim().toLowerCase()
            this.refresh(true)
        })
        this._search.addEventListener('keydown', e => e.stopPropagation())
        this._lockBtn.addEventListener('click', () => {
            const ux = this._ux()
            if (ux) ux.setEditingLocked(!ux.editingLocked)
            this.refresh()
        })
        this._list.addEventListener('contextmenu', e => e.preventDefault())
        this._list.addEventListener('scroll', () => this.refresh())
        this._list.addEventListener('keydown', this._onListKey)
    }

    private _ux() {
        return this._viewer?.getPlugin(SelectionUxPlugin)
    }

    private get _picking() {
        return this._viewer?.getPlugin(PickingPlugin)
    }

    private get _locked() {
        return !!this._ux()?.editingLocked
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('sceneUpdate', this._onSceneUpdate)
        this._picking?.addEventListener('selectedObjectChanged', this._onSelection)
        this._ux()?.addEventListener('uxUpdate', this._onUx)
        window.addEventListener('pointerdown', this._closeMenu, true)
        this.refresh(true)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        this._picking?.removeEventListener('selectedObjectChanged', this._onSelection)
        this._ux()?.removeEventListener('uxUpdate', this._onUx)
        window.removeEventListener('pointerdown', this._closeMenu, true)
        this.element.remove()
        super.onRemove(viewer)
    }

    private _onSceneUpdate = (e: any) => {
        if (e?.object && (e.object.assetType === 'widget' || e.object.userData?.isWidgetRoot)) return
        if (e?.hierarchyChanged || e?.refreshScene || e?.change === 'visible' || e?.change === 'name') this.refresh(true)
    }

    private _onSelection = () => {
        // open the groups that hold the selection
        const root = this._viewer?.scene.modelRoot
        let opened = false
        for (const s of this._selected()) {
            let p = s.parent as IObject3D | null
            while (p && p !== root) {
                if (!this._expanded.has(p)) {
                    this._expanded.add(p)
                    opened = true
                }
                p = p.parent as IObject3D | null
            }
        }
        this._scrollToSelection = true
        this.refresh(opened)
    }

    private _scrollToSelection = false

    private _onUx = (e: {reason: string}) => {
        if (e.reason === 'hover') this._updateHover()
        else if (e.reason === 'hierarchy') this.refresh(true)
        else if (e.reason === 'settings') this.refresh()
    }

    setTab(tab: LayersTab) {
        this._tab = tab
        this._list.scrollTop = 0
        this.refresh(true)
    }

    /** Redraw the rows in view. `structure` also rebuilds the flat list (hierarchy, expand, filter, visibility). */
    refresh = (structure = false) => {
        if (structure) this._structureDirty = true
        if (this._queued) return
        this._queued = true
        requestAnimationFrame(() => {
            this._queued = false
            if (this._renaming) return
            if (this._structureDirty) this._buildFlat()
            this._renderTabs()
            if (this._tab === 'objects') this._render()
            else this._renderAssets()
        })
    }

    private _renderTabs() {
        const counts: Record<LayersTab, number> = {objects: this._total, materials: this._collect('materials').length, textures: this._collect('textures').length, geometries: this._collect('geometries').length}
        this._tabsEl.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
            const t = b.dataset.tab as LayersTab
            b.classList.toggle('on', t === this._tab)
            // the counts are in the tooltips, so the four tabs fit the panel
            b.querySelector('span')!.textContent = counts[t] ? ' ' + counts[t].toLocaleString() : ''
            b.title = `${TABS.find(x => x[0] === t)![1]}: ${counts[t]}`
        })
        // the header counts what the open tab lists
        this._count.textContent = counts[this._tab] ? counts[this._tab].toLocaleString() : ''
    }

    private _isContent(o: IObject3D) {
        return !o.userData.isWidgetRoot && o.assetType !== 'widget' && o.userData.userSelectable !== false && !o.userData.isMultiSelectDummy
            && (o.parent as any)?.target !== o // the target child of a directional or spot light
    }

    private _kids(o: IObject3D) {
        return (o.children as IObject3D[]).filter(c => this._isContent(c))
    }

    private _buildFlat() {
        this._structureDirty = false
        this._flat = []
        this._index.clear()
        this._total = 0
        if (!this._viewer) return
        const root = this._viewer.scene.modelRoot
        // one pass for the search: an object stays if it or something inside it matches
        const keep = new Set<IObject3D>()
        const mark = (o: IObject3D): boolean => {
            this._total++
            let m = !this._filter || (o.name || '').toLowerCase().includes(this._filter)
            for (const k of this._kids(o)) if (mark(k)) m = true
            if (m) keep.add(o)
            return m
        }
        for (const o of this._kids(root)) mark(o)
        const add = (o: IObject3D, depth: number, parentHidden: boolean, parentLocked: boolean) => {
            if (!keep.has(o)) return
            const kids = this._kids(o)
            const open = kids.length > 0 && (this._expanded.has(o) || !!this._filter)
            const hidden = !o.visible || parentHidden
            const locked = !!o.userData.locked || parentLocked
            this._index.set(o, this._flat.length)
            this._flat.push({o, depth, kids: kids.length, open, hidden, locked})
            if (open) for (const k of kids) add(k, depth + 1, hidden, locked)
        }
        for (const o of this._kids(root)) add(o, 0, false, false)
    }

    private _render() {
        const sel = this._selected()
        const selSet = new Set(sel)
        const parentsOfSel = new Set<IObject3D>()
        for (const s of sel) s.traverseAncestors(a => parentsOfSel.add(a as IObject3D))
        const locked = this._locked
        this.element.classList.toggle('lp-editing-locked', locked)
        this._lockBtn.innerHTML = locked ? ICONS.lock : ICONS.unlock
        this._lockBtn.title = locked ? 'Unlock editing' : 'Lock editing (view only)'
        this._lockBtn.classList.toggle('lp-on', locked)

        const n = this._flat.length
        this._spacer.style.height = n * ROW + 'px'
        if (this._scrollToSelection) {
            this._scrollToSelection = false
            const i = sel.length ? this._index.get(sel[0]) : undefined
            if (i !== undefined) {
                const top = i * ROW, h = this._list.clientHeight
                if (top < this._list.scrollTop) this._list.scrollTop = top
                else if (top + ROW > this._list.scrollTop + h) this._list.scrollTop = top + ROW - h
            }
        }
        // only the rows in view (plus a margin) exist in the DOM
        const first = Math.max(0, Math.floor(this._list.scrollTop / ROW) - 8)
        const last = Math.min(n, Math.ceil((this._list.scrollTop + this._list.clientHeight) / ROW) + 8)
        this._spacer.innerHTML = ''
        this._rows.clear()
        for (let i = first; i < last; i++) {
            const r = this._flat[i]
            const row = this._row(r, selSet.has(r.o), parentsOfSel.has(r.o), locked)
            row.style.top = i * ROW + 'px'
            this._spacer.appendChild(row)
            this._rows.set(r.o, row)
        }
        if (!n) {
            const empty = document.createElement('div')
            empty.className = 'lp-empty'
            empty.textContent = this._filter ? 'No layers match' : 'No objects. Drop a model on the canvas.'
            this._spacer.appendChild(empty)
        }
        this._updateHover()
    }

    private _row(r: FlatRow, isSel: boolean, isParentOfSel: boolean, editingLocked: boolean) {
        const o = r.o
        const lockedObj = !!o.userData.locked
        const row = document.createElement('div')
        row.className = 'lp-row' + (isSel ? ' lp-sel' : isParentOfSel ? ' lp-sel-parent' : '') +
            (r.hidden ? ' lp-hidden' : '') + (r.locked ? ' lp-locked' : '')
        row.style.paddingLeft = 2 + r.depth * 14 + 'px'
        row.draggable = !editingLocked
        row.innerHTML = `<span class="lp-caret ${r.kids ? '' : 'lp-none'}" title="${r.kids ? 'Open / close (Alt: all levels)' : ''}">${r.kids ? r.open ? ICONS.down : ICONS.right : ''}</span>` +
            `<span class="lp-type">${o.isLight ? ICONS.light : o.isCamera ? ICONS.camera : o.geometry ? ICONS.mesh : ICONS.group}</span>` +
            '<span class="lp-name"></span>' +
            `<button class="lp-icon-btn lp-lock ${lockedObj ? 'lp-on' : ''}" title="${lockedObj ? 'Unlock' : 'Lock'}">${lockedObj ? ICONS.lock : ICONS.unlock}</button>` +
            `<button class="lp-icon-btn lp-eye ${!o.visible ? 'lp-on' : ''}" title="${o.visible ? 'Hide' : 'Show'} (H)">${o.visible ? ICONS.eye : ICONS.eyeOff}</button>`
        row.querySelector('.lp-name')!.textContent = o.name || o.type
        const caret = row.querySelector('.lp-caret')!
        // the arrow does not select, so it gets its own pointer events
        caret.addEventListener('pointerdown', e => e.stopPropagation())
        caret.addEventListener('click', e => {
            e.stopPropagation()
            if (r.kids) this._toggleOpen(o, (e as MouseEvent).altKey)
        })
        row.querySelector('.lp-eye')!.addEventListener('click', e => {
            e.stopPropagation()
            this._toggle(o, 'visible')
        })
        row.querySelector('.lp-lock')!.addEventListener('click', e => {
            e.stopPropagation()
            if (!this._locked) this._toggle(o, 'locked')
        })
        row.addEventListener('click', e => {
            this._list.focus({preventScroll: true})
            this._clickRow(o, e)
        })
        row.querySelector('.lp-name')!.addEventListener('dblclick', e => {
            e.stopPropagation()
            if (!this._locked) this._rename(o, row)
        })
        row.addEventListener('contextmenu', e => {
            e.preventDefault()
            this._openMenu(o, e.clientX, e.clientY)
        })
        row.addEventListener('pointerenter', () => {
            const ux = this._ux()
            if (ux) ux.externalHover = o
        })
        row.addEventListener('pointerleave', () => {
            const ux = this._ux()
            if (ux && ux.externalHover === o) ux.externalHover = null
        })
        this._setupDnd(o, row)
        return row
    }

    // region asset tabs

    private _inScene(o: any) {
        const root = this._viewer?.scene.modelRoot
        let p = o
        while (p) {
            if (p === root) return true
            p = p.parent
        }
        return false
    }

    /** The materials / textures / geometries used in the scene, each with the objects that use it */
    private _collect(tab: LayersTab): {a: any, users: IObject3D[]}[] {
        const om = (this._viewer as any)?.object3dManager
        if (!om || tab === 'objects') return []
        const meshes = (a: any) => [...a?.appliedMeshes ?? []].filter(m => this._inScene(m)) as IObject3D[]
        if (tab === 'materials') return (om.getMaterials() as any[]).map(a => ({a, users: meshes(a)})).filter(x => x.users.length)
        if (tab === 'geometries') return (om.getGeometries() as any[]).map(a => ({a, users: meshes(a)})).filter(x => x.users.length)
        return (om.getTextures() as any[]).map(t => {
            const users = new Set<IObject3D>()
            let scene = false
            t.appliedObjects?.forEach((o: any) => {
                if (o.isMaterial) meshes(o).forEach(m => users.add(m))
                else if (o.isScene) scene = true
                else if (o.isObject3D && this._inScene(o)) users.add(o)
            })
            return {a: t, users: [...users], scene}
        }).filter(x => x.users.length || x.scene)
    }

    private _assetName(a: any) {
        return a.name || (a.isTexture ? 'Texture' : a.isMaterial ? a.type : 'Geometry') + ' ' + String(a.uuid).slice(0, 4)
    }

    private _buildAssets() {
        const list = this._collect(this._tab).filter(x => !this._filter || this._assetName(x.a).toLowerCase().includes(this._filter))
        this._assetRows = []
        for (const x of list) {
            const open = this._expandedAssets.has(x.a)
            this._assetRows.push({kind: 'asset', a: x.a, users: x.users, open})
            if (open) for (const o of x.users) this._assetRows.push({kind: 'user', o, a: x.a})
        }
    }

    private _renderAssets() {
        this._buildAssets()
        const picked = this._picking?.getSelectedObject() as any
        const selObjs = new Set(this._selected())
        const rows = this._assetRows
        this._spacer.style.height = rows.length * ROW + 'px'
        const first = Math.max(0, Math.floor(this._list.scrollTop / ROW) - 8)
        const last = Math.min(rows.length, Math.ceil((this._list.scrollTop + this._list.clientHeight) / ROW) + 8)
        this._spacer.innerHTML = ''
        this._rows.clear()
        for (let i = first; i < last; i++) {
            const r = rows[i]
            const row = r.kind === 'asset' ? this._assetRow(r, picked === r.a, r.users.some(u => selObjs.has(u))) : this._userRow(r, selObjs.has(r.o))
            row.style.top = i * ROW + 'px'
            this._spacer.appendChild(row)
            if (r.kind === 'user') this._rows.set(r.o, row)
        }
        if (!rows.length) {
            const empty = document.createElement('div')
            empty.className = 'lp-empty'
            empty.textContent = this._filter ? 'Nothing matches' : `No ${this._tab} in the scene`
            this._spacer.appendChild(empty)
        }
        this._updateHover()
    }

    private _thumb(t: any) {
        const cached = this._thumbs.get(t)
        if (cached !== undefined) return cached
        let url = ''
        const img = t.image
        try {
            if (img && img.width && (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement || typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap)) {
                const c = document.createElement('canvas')
                c.width = c.height = 36
                c.getContext('2d')!.drawImage(img, 0, 0, 36, 36)
                url = c.toDataURL()
            }
        } catch (e) {
            url = ''
        }
        this._thumbs.set(t, url)
        return url
    }

    private _assetRow(r: Extract<AssetRow, {kind: 'asset'}>, isSel: boolean, usedBySel: boolean) {
        const a = r.a
        const row = document.createElement('div')
        row.className = 'lp-row' + (isSel ? ' lp-sel' : usedBySel ? ' lp-sel-parent' : '')
        row.style.paddingLeft = '2px'
        let icon = ICONS.mesh
        let meta = `${r.users.length} obj`
        if (a.isMaterial) {
            const c = a.color?.getHexString?.()
            icon = `<span class="lp-swatch" style="background:${c ? '#' + c : '#ccc'}"></span>`
        } else if (a.isTexture) {
            const th = this._thumb(a)
            icon = th ? `<img class="lp-thumb" src="${th}" alt="">` : ICONS.texture
            const w = a.image?.width, h = a.image?.height
            meta = (w ? `${w}×${h} · ` : '') + (r.users.length ? `${r.users.length} obj` : 'scene')
        } else if (a.isBufferGeometry) {
            const n = a.attributes?.position?.count ?? 0
            const gen = a.userData?.generationParams?.type
            icon = ICONS.geometry
            meta = `${gen ? gen + ' · ' : ''}${n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n} v · ${r.users.length} obj`
        }
        row.innerHTML = `<span class="lp-caret ${r.users.length ? '' : 'lp-none'}">${r.users.length ? r.open ? ICONS.down : ICONS.right : ''}</span>` +
            `<span class="lp-type">${icon}</span><span class="lp-name"></span><span class="lp-meta"></span>`
        row.querySelector('.lp-name')!.textContent = this._assetName(a)
        row.querySelector('.lp-meta')!.textContent = meta
        const caret = row.querySelector('.lp-caret')!
        caret.addEventListener('pointerdown', e => e.stopPropagation())
        caret.addEventListener('click', e => {
            e.stopPropagation()
            if (this._expandedAssets.has(a)) this._expandedAssets.delete(a)
            else this._expandedAssets.add(a)
            this.refresh()
        })
        row.addEventListener('click', () => {
            this._list.focus({preventScroll: true})
            this._picking?.picker?.setSelected(a, true)
        })
        row.addEventListener('dblclick', () => {
            const ux = this._ux()
            if (a.isBufferGeometry && r.users.length === 1 && ux) ux.enterGeometryEdit(r.users[0])
            else this._select(r.users)
        })
        row.querySelector('.lp-name')!.addEventListener('dblclick', e => {
            if (a.isBufferGeometry) return
            e.stopPropagation()
            if (!this._locked) this._rename(a, row)
        })
        row.addEventListener('pointerenter', () => this._ux()?.setExternalHoverList(r.users))
        row.addEventListener('pointerleave', () => this._ux()?.setExternalHoverList([]))
        row.addEventListener('contextmenu', e => {
            e.preventDefault()
            this._openAssetMenu(r, row, e.clientX, e.clientY)
        })
        return row
    }

    private _userRow(r: Extract<AssetRow, {kind: 'user'}>, isSel: boolean) {
        const o = r.o
        const row = document.createElement('div')
        row.className = 'lp-row lp-user' + (isSel ? ' lp-sel' : '')
        row.style.paddingLeft = '24px'
        row.innerHTML = `<span class="lp-type">${o.isLight ? ICONS.light : o.isCamera ? ICONS.camera : ICONS.mesh}</span><span class="lp-name"></span>`
        row.querySelector('.lp-name')!.textContent = o.name || o.type
        row.addEventListener('click', e => this._clickRow(o, e))
        row.addEventListener('pointerenter', () => {
            const ux = this._ux()
            if (ux) ux.externalHover = o
        })
        row.addEventListener('pointerleave', () => {
            const ux = this._ux()
            if (ux && ux.externalHover === o) ux.externalHover = null
        })
        return row
    }

    private _openAssetMenu(r: Extract<AssetRow, {kind: 'asset'}>, row: HTMLDivElement, x: number, y: number) {
        const a = r.a
        const ux = this._ux()
        const items: MenuItem[] = [
            [`Select the objects using it (${r.users.length})`, '', r.users.length ? () => this._select(r.users) : null],
            ['Zoom to the objects', '', r.users.length ? () => void this._viewer?.fitToView(r.users, 1.25, 800, 'easeOut') : null],
        ]
        if (a.isBufferGeometry) items.push(['Edit geometry', 'Double-click', ux && r.users.length === 1 && !this._locked ? () => ux.enterGeometryEdit(r.users[0]) : null])
        else items.push(['Rename', 'Double-click name', this._locked ? null : () => this._rename(a, row)])
        this._showMenu(x, y, items)
    }

    // endregion


    private _toggleOpen(o: IObject3D, all: boolean) {
        const open = !this._expanded.has(o)
        const set = (x: IObject3D) => {
            if (open) this._expanded.add(x)
            else this._expanded.delete(x)
        }
        if (all) o.traverse(x => set(x as IObject3D))
        else set(o)
        this.refresh(true)
    }

    private _updateHover() {
        const h = this._ux()?.hovered
        for (const [o, r] of this._rows) r.classList.toggle('lp-hover', o === h)
    }

    private _selected(): IObject3D[] {
        return (this._picking?.getSelectedObjects() || []).filter(o => (o as IObject3D)?.isObject3D) as IObject3D[]
    }

    private _select(objs: IObject3D[]) {
        const p = this._picking?.picker
        p?.setSelected(objs.length ? objs.length === 1 ? objs[0] : objs as any : null, true)
    }

    private _clickRow(o: IObject3D, e: MouseEvent) {
        const cur = this._selected()
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
            const i = cur.indexOf(o)
            const next = [...cur]
            if (i >= 0) next.splice(i, 1)
            else next.unshift(o)
            this._select(next)
        } else this._select([o])
    }

    /** Arrow keys in the focused list: up/down next row, right opens or goes in, left closes or goes to the parent */
    private _onListKey = (e: KeyboardEvent) => {
        if (!e.code.startsWith('Arrow')) return
        e.preventDefault()
        e.stopPropagation()
        if (this._tab !== 'objects') {
            if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return
            const picked = this._picking?.getSelectedObject() as any
            const sel = this._selected()
            const i = this._assetRows.findIndex(r => r.kind === 'asset' ? r.a === picked : sel.includes(r.o))
            const t = this._assetRows[Math.max(0, Math.min(this._assetRows.length - 1, i + (e.code === 'ArrowDown' ? 1 : -1)))]
            if (t?.kind === 'asset') this._picking?.picker?.setSelected(t.a, true)
            else if (t) this._select([t.o])
            return
        }
        if (this._structureDirty) this._buildFlat()
        const sel = this._selected()
        const i = sel.length ? this._index.get(sel[0]) ?? -1 : -1
        const r = i >= 0 ? this._flat[i] : undefined
        const go = (j: number) => {
            const t = this._flat[Math.max(0, Math.min(this._flat.length - 1, j))]
            if (!t) return
            if (e.shiftKey && sel.length) this._select([t.o, ...sel.filter(s => s !== t.o)])
            else this._select([t.o])
        }
        if (e.code === 'ArrowDown') go(i + 1)
        else if (e.code === 'ArrowUp') go(i < 0 ? this._flat.length - 1 : i - 1)
        else if (!r) return
        else if (e.code === 'ArrowRight') {
            if (r.kids && !r.open) this._toggleOpen(r.o, e.altKey)
            else if (r.open) go(i + 1)
        } else if (e.code === 'ArrowLeft') {
            if (r.open) this._toggleOpen(r.o, e.altKey)
            else {
                const p = r.o.parent as IObject3D | null
                if (p && this._index.has(p)) this._select([p])
            }
        }
    }

    private _record(undo: () => void, redo: () => void) {
        this._viewer?.getPlugin(UndoManagerPlugin)?.undoManager?.record({undo, redo})
    }

    private _toggle(o: IObject3D, what: 'visible' | 'locked') {
        // applies to the whole selection when the row is part of it, like Figma
        const sel = this._selected()
        const targets = sel.includes(o) ? sel : [o]
        const before = targets.map(t => what === 'visible' ? t.visible : !!t.userData.locked)
        const v = what === 'visible' ? !o.visible : !o.userData.locked
        const apply = (vals: boolean[]) => {
            targets.forEach((t, i) => {
                if (what === 'visible') {
                    t.visible = vals[i]
                    t.setDirty?.({refreshScene: true})
                } else {
                    if (vals[i]) t.userData.locked = true
                    else delete t.userData.locked
                }
            })
            this._viewer?.setDirty()
            this.refresh(true)
        }
        apply(targets.map(() => v))
        this._record(() => apply(before), () => apply(targets.map(() => v)))
    }

    private _rename(o: {name: string, setDirty?: (...a: any[]) => any}, row: HTMLDivElement) {
        const nameEl = row.querySelector('.lp-name')!
        const input = document.createElement('input')
        input.className = 'lp-rename'
        input.value = o.name
        nameEl.replaceWith(input)
        this._renaming = true
        input.focus()
        input.select()
        const old = o.name
        let done = false
        const finish = (commit: boolean) => {
            if (done) return
            done = true
            this._renaming = false
            const name = input.value.trim()
            if (commit && name && name !== old) {
                const set = (nm: string) => {
                    o.name = nm
                    o.setDirty?.({change: 'name', refreshScene: false} as any)
                    this.refresh(true)
                }
                set(name)
                this._record(() => set(old), () => set(name))
            }
            this._list.focus({preventScroll: true})
            this.refresh(true)
        }
        input.addEventListener('keydown', e => {
            e.stopPropagation()
            if (e.key === 'Enter') finish(true)
            if (e.key === 'Escape') finish(false)
        })
        input.addEventListener('blur', () => finish(true))
    }

    /** Drag the panel header to move `target` (a positioned container) inside its parent. The position is remembered. */
    makeMovable(target: HTMLElement, storageKey = 'layers-panel-pos') {
        const head = this.element.querySelector<HTMLElement>('.lp-head')!
        head.classList.add('lp-movable')
        head.title = 'Drag to move'
        const clamp = (x: number, y: number) => {
            const p = target.offsetParent as HTMLElement | null
            const pw = p?.clientWidth ?? innerWidth, ph = p?.clientHeight ?? innerHeight
            return [Math.max(0, Math.min(pw - target.offsetWidth, x)), Math.max(0, Math.min(ph - 40, y))]
        }
        const place = (x: number, y: number) => {
            [x, y] = clamp(x, y)
            target.style.left = x + 'px'
            target.style.top = y + 'px'
            target.style.right = 'auto'
        }
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
            if (saved) requestAnimationFrame(() => place(saved[0], saved[1]))
        } catch (e) {
            // private mode
        }
        head.addEventListener('pointerdown', e => {
            if ((e.target as Element).closest('button')) return
            e.preventDefault()
            head.setPointerCapture(e.pointerId)
            const sx = e.clientX - target.offsetLeft, sy = e.clientY - target.offsetTop
            const move = (ev: PointerEvent) => place(ev.clientX - sx, ev.clientY - sy)
            const up = () => {
                head.removeEventListener('pointermove', move)
                head.removeEventListener('pointerup', up)
                try {
                    localStorage.setItem(storageKey, JSON.stringify([target.offsetLeft, target.offsetTop]))
                } catch (er) {
                    // private mode
                }
            }
            head.addEventListener('pointermove', move)
            head.addEventListener('pointerup', up)
        })
    }

    // region drag and drop

    private _setupDnd(o: IObject3D, row: HTMLDivElement) {
        row.addEventListener('dragstart', e => {
            if (this._locked) return e.preventDefault()
            const sel = this._selected()
            this._dragged = sel.includes(o) ? sel : [o]
            e.dataTransfer?.setData('text/plain', o.uuid)
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            row.classList.add('lp-dragging')
        })
        row.addEventListener('dragend', () => {
            this._dragged = []
            this._clearDropMarks()
        })
        row.addEventListener('dragover', e => {
            if (!this._dragged.length) return
            const where = this._dropWhere(o, row, e)
            this._clearDropMarks()
            if (!where) return
            e.preventDefault()
            row.classList.add('lp-drop-' + where)
        })
        row.addEventListener('dragleave', () => row.classList.remove('lp-drop-before', 'lp-drop-after', 'lp-drop-into'))
        row.addEventListener('drop', e => {
            const where = this._dropWhere(o, row, e)
            this._clearDropMarks()
            if (!where) return
            e.preventDefault()
            this._move(this._dragged, o, where)
            this._dragged = []
        })
    }

    private _clearDropMarks() {
        for (const r of this._rows.values()) r.classList.remove('lp-drop-before', 'lp-drop-after', 'lp-drop-into', 'lp-dragging')
    }

    private _dropWhere(target: IObject3D, row: HTMLElement, e: DragEvent): 'before' | 'after' | 'into' | null {
        // no drop on itself or inside its own children
        for (const d of this._dragged) {
            let p: IObject3D | null = target
            while (p) {
                if (p === d) return null
                p = p.parent as IObject3D | null
            }
        }
        const r = row.getBoundingClientRect()
        const y = (e.clientY - r.top) / r.height
        const canInto = !target.geometry || this._kids(target).length > 0
        if (canInto && y > 0.3 && y < 0.7) return 'into'
        return y < 0.5 ? 'before' : 'after'
    }

    private _move(objs: IObject3D[], target: IObject3D, where: 'before' | 'after' | 'into') {
        const parent = (where === 'into' ? target : target.parent) as IObject3D | null
        if (!parent) return
        const prev = objs.map(o => ({o, parent: o.parent!, index: o.parent!.children.indexOf(o)}))
        const doMove = () => {
            for (const o of objs) {
                parent.attach(o) // keeps the world transform
                const ch = parent.children
                ch.splice(ch.indexOf(o), 1)
                if (where === 'into') ch.push(o)
                else {
                    const ti = ch.indexOf(target)
                    ch.splice(where === 'before' ? ti : ti + 1, 0, o)
                }
            }
            if (where === 'into') this._expanded.add(target)
            this._changed()
        }
        const undo = () => {
            for (const p of [...prev].reverse()) {
                p.parent.attach(p.o)
                const ch = p.parent.children
                ch.splice(ch.indexOf(p.o), 1)
                ch.splice(Math.min(p.index, ch.length), 0, p.o)
            }
            this._changed()
        }
        doMove()
        this._record(undo, doMove)
    }

    private _changed() {
        this._viewer?.scene.setDirty({refreshScene: true})
        this._viewer?.setDirty()
        this.refresh(true)
    }

    // endregion

    // region context menu

    private _closeMenu = (e?: Event) => {
        if (e && this._menu?.contains(e.target as Node)) return
        this._menu?.remove()
        this._menu = undefined
    }

    private _openMenu(o: IObject3D, x: number, y: number) {
        this._closeMenu()
        if (!this._selected().includes(o)) this._select([o])
        const ux = this._ux()
        const picking = this._picking
        const locked = this._locked
        const sel = this._selected()
        const isGroup = sel.some(s => !s.geometry && this._kids(s).length)
        const cp = this._viewer?.getPlugin(CameraPathPlugin)
        const items: MenuItem[] = [
            ['Zoom to', 'F', () => picking?.focusSelected()],
            ...o.isCamera && ux ? [['Look through', '0', () => ux.lookThrough(o)], ['Move to this view', 'Ctrl+Alt+0', locked ? null : () => ux.alignCameraToView(o)]] as MenuItem[] : [],
            ...cp && (o.isCamera || (o as any).isLine2 || (o as any).isLine) ? [[o.isCamera ? 'Animate along a path…' : 'Animate a camera along it…', '', locked ? null : () => cp.openDialog(o.isCamera ? {object: o} : {path: o})]] as MenuItem[] : [],
            ['Rename', 'Double-click', locked ? null : () => {
                const row = this._rows.get(o)
                if (row) this._rename(o, row)
            }],
            ['Duplicate', 'Ctrl+D', locked ? null : () => picking?.duplicateSelected()],
            ['Group selection', 'Ctrl+G', locked || !ux ? null : () => ux.groupSelected()],
            ['Ungroup', 'Ctrl+Shift+G', locked || !ux || !isGroup ? null : () => ux.ungroupSelected()],
            [o.visible ? 'Hide' : 'Show', 'H', () => this._toggle(o, 'visible')],
            [o.userData.locked ? 'Unlock' : 'Lock', '', locked ? null : () => this._toggle(o, 'locked')],
            ['Move up', '', locked ? null : () => this._moveInParent(o, -1)],
            ['Move down', '', locked ? null : () => this._moveInParent(o, 1)],
            ['Delete', 'Delete', locked ? null : async() => picking?.deleteSelected()],
        ]
        this._showMenu(x, y, items)
    }

    /** Move one step up or down among its siblings (undoable) */
    private _moveInParent(o: IObject3D, d: number) {
        const p = o.parent
        if (!p) return
        const from = p.children.indexOf(o)
        const to = Math.max(0, Math.min(p.children.length - 1, from + d))
        if (from === to) return
        const place = (i: number) => {
            p.children.splice(p.children.indexOf(o), 1)
            p.children.splice(i, 0, o)
            this._changed()
        }
        place(to)
        this._record(() => place(from), () => place(to))
    }

    private _showMenu(x: number, y: number, items: MenuItem[]) {
        this._closeMenu()
        const m = document.createElement('div')
        m.className = 'lp-menu'
        for (const [label, key, fn] of items) {
            const it = document.createElement('div')
            it.className = 'lp-menu-item' + (fn ? '' : ' lp-disabled')
            it.innerHTML = `<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}`
            if (fn) it.addEventListener('click', () => {
                this._closeMenu()
                fn()
            })
            m.appendChild(it)
        }
        document.body.appendChild(m)
        const r = m.getBoundingClientRect()
        m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'
        m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px'
        this._menu = m
    }

    // endregion
}

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
    group: svg('<path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11"/>'),
    mesh: svg('<path d="M8 2l5 3v6l-5 3-5-3V5z"/><path d="M3 5l5 3 5-3M8 8v6"/>'),
    light: svg('<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
    camera: svg('<rect x="1.5" y="4.5" width="9" height="7" rx="1"/><path d="M10.5 7l4-2v6l-4-2"/>'),
    eye: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    eyeOff: svg('<path d="M2 2l12 12M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.1 12.1A6.6 6.6 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11 11 0 0 1 2.4-2.9"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
    unlock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>'),
    search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
    texture: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 10.5l3-3 3 3 2-2 3 3"/><circle cx="10.5" cy="5.5" r="1"/>'),
    geometry: svg('<path d="M8 2l5 3v6l-5 3-5-3V5z"/><path d="M3 5l5 3 5-3M8 8v6M5.5 3.5l5 9M10.5 3.5l-5 9" opacity=".5"/>'),
    right: '<svg viewBox="0 0 16 16" width="10" height="10"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    down: '<svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.lp-root {
  --lp-bg: #ffffff; --lp-fg: #1e1e1e; --lp-dim: #8a8a8a; --lp-line: #ececec; --lp-hover: #f3f3f3;
  --lp-sel: #e5f4ff; --lp-sel-focus: #cfeaff; --lp-sel-parent: #f5fbff; --lp-accent: #0d99ff; --lp-input: #f5f5f5;
  display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--lp-bg); color: var(--lp-fg);
  font: 11px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none;
}
.lp-dark {
  --lp-bg: #2c2c2c; --lp-fg: #e8e8e8; --lp-dim: #9a9a9a; --lp-line: #3a3a3a; --lp-hover: #383838;
  --lp-sel: #0d99ff40; --lp-sel-focus: #0d99ff66; --lp-sel-parent: #0d99ff18; --lp-input: #383838;
}
/* with the tweakpane UI on the page, take its theme colours */
body[class*="tpTheme-"] .lp-root {
  --lp-bg: var(--tp-base-background-color, #1c2026); --lp-fg: var(--tp-container-foreground-color, #f0f0f0);
  --lp-dim: var(--tp-monitor-foreground-color, #9a9a9a); --lp-line: var(--tp-container-border-color, rgba(255,255,255,.12));
  --lp-hover: var(--tp-container-background-color-hover, rgba(255,255,255,.06)); --lp-input: var(--tp-input-background-color, rgba(255,255,255,.07));
  --lp-sel: rgba(13,153,255,.22); --lp-sel-focus: rgba(13,153,255,.34); --lp-sel-parent: rgba(13,153,255,.08);
}
.lp-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 6px 12px; min-height: 24px; }
.lp-head.lp-movable { cursor: grab; }
.lp-head.lp-movable:active { cursor: grabbing; }
.lp-title { font-weight: 600; }
.lp-count { font-weight: 400; color: var(--lp-dim); margin-left: 4px; }
.lp-search { display: flex; align-items: center; gap: 6px; margin: 0 8px 6px; padding: 0 8px; height: 26px; border-radius: 5px; background: var(--lp-input); color: var(--lp-dim); }
.lp-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--lp-fg); font: inherit; }
.lp-tabs { display: flex; gap: 2px; margin: 0 8px 6px; padding: 2px; border-radius: 6px; background: var(--lp-input); }
.lp-tabs button { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: var(--lp-dim); padding: 4px 2px; border-radius: 4px; font: inherit; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-tabs button span { display: none; }
.lp-tabs button:hover { color: var(--lp-fg); background: var(--lp-hover); }
.lp-tabs button.on { color: var(--lp-fg); background: var(--lp-bg); box-shadow: 0 0 0 1px var(--lp-line), 0 1px 2px rgba(0,0,0,.06); font-weight: 600; }
.lp-tabs button span { font-weight: 400; color: var(--lp-dim); }
.lp-swatch { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); display: inline-block; }
.lp-thumb { width: 16px; height: 16px; border-radius: 3px; object-fit: cover; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
.lp-meta { color: var(--lp-dim); font-size: 10px; padding: 0 6px; white-space: nowrap; flex: none; }
.lp-row.lp-user .lp-name { color: var(--lp-dim); }
.lp-list { flex: 1; overflow: auto; outline: none; padding-bottom: 8px; position: relative; }
.lp-spacer { position: relative; }
.lp-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; height: ${ROW}px; padding-right: 4px; gap: 0; cursor: default; white-space: nowrap; box-sizing: border-box; }
.lp-row:hover, .lp-row.lp-hover { box-shadow: inset 0 0 0 1px var(--lp-accent); }
.lp-row:hover { background: var(--lp-hover); }
.lp-row.lp-sel { background: var(--lp-sel); }
.lp-list:focus .lp-row.lp-sel { background: var(--lp-sel-focus); }
.lp-row.lp-sel-parent { background: var(--lp-sel-parent); }
.lp-row.lp-hidden .lp-name, .lp-row.lp-hidden .lp-type { opacity: 0.4; }
.lp-row.lp-dragging { opacity: 0.4; }
.lp-row.lp-drop-before::before, .lp-row.lp-drop-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 2px; background: var(--lp-accent); }
.lp-row.lp-drop-before::before { top: -1px; }
.lp-row.lp-drop-after::after { bottom: -1px; }
.lp-row.lp-drop-into { box-shadow: inset 0 0 0 2px var(--lp-accent); }
.lp-caret { width: 20px; height: 24px; display: flex; align-items: center; justify-content: center; color: var(--lp-dim); flex: none; border-radius: 4px; cursor: pointer; }
.lp-caret:hover { background: var(--lp-line); color: var(--lp-fg); }
.lp-caret.lp-none { cursor: default; background: none; }
.lp-type { width: 18px; display: flex; justify-content: center; color: var(--lp-dim); flex: none; }
.lp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; padding-left: 4px; }
.lp-rename { flex: 1; min-width: 0; font: inherit; color: var(--lp-fg); background: var(--lp-bg); border: 1px solid var(--lp-accent); border-radius: 3px; padding: 2px 4px; outline: none; }
.lp-icon-btn { border: 0; background: transparent; color: var(--lp-dim); width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex: none; }
.lp-icon-btn:hover { background: var(--lp-hover); color: var(--lp-fg); }
.lp-row .lp-icon-btn { visibility: hidden; }
.lp-row:hover .lp-icon-btn, .lp-row .lp-icon-btn.lp-on { visibility: visible; }
.lp-head .lp-icon-btn.lp-on { color: #fff; background: var(--lp-accent); }
.lp-editing-locked .lp-row .lp-lock { visibility: hidden !important; }
.lp-empty { color: var(--lp-dim); padding: 12px; }
/* like the toolbar menus: light, or the tweakpane theme's colours */
.lp-menu {
  position: fixed; z-index: 1000; min-width: 200px; background: #fff; color: #1e1e1e; border-radius: 6px; padding: 4px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.10);
  font: 500 11px/1 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif); animation: lp-in .12s ease-out;
}
@keyframes lp-in { from { opacity: 0; transform: translateY(-3px); } }
.lp-menu-item { display: flex; justify-content: space-between; align-items: center; gap: 18px; padding: 0 10px; height: 28px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.lp-menu-item:hover { background: #f2f3f5; }
.lp-menu-item.lp-disabled { opacity: 0.4; pointer-events: none; }
.lp-menu-item kbd { font: inherit; font-size: 10px; color: #8a8f97; background: #f0f1f3; border-radius: 4px; padding: 2px 5px; }
body[class*="tpTheme-"] .lp-menu { background: var(--tp-base-background-color, #1c2026); color: var(--tp-container-foreground-color, #f0f0f0); }
body[class*="tpTheme-"] .lp-menu-item:hover { background: var(--tp-button-background-color-hover, rgba(255,255,255,.09)); }
body[class*="tpTheme-"] .lp-menu-item kbd { color: var(--tp-monitor-foreground-color, #9a9a9a); background: var(--tp-input-background-color, rgba(255,255,255,.07)); }
`
    document.head.appendChild(st)
}
