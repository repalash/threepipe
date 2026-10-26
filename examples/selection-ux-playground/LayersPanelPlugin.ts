import {AViewerPluginSync, IObject3D, PickingPlugin, ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {SelectionUxPlugin} from './SelectionUxPlugin'

/**
 * Figma-like layers panel. Prototype replacement for the treejs based HierarchyUiPlugin.
 *
 * - Click selects, Shift/Ctrl+click adds, hover highlights the object in the viewport.
 * - Show/hide and lock on each row (lock = cannot be picked or moved in the viewport, still selectable here).
 * - Double-click the name to rename. Drag rows to reorder or to move into a group (world transform is kept).
 * - Right-click for actions. Search filters by name.
 * - The lock button in the header locks all editing (view-only), here and in the viewport.
 *
 * Mount {@link element} anywhere.
 */
export class LayersPanelPlugin extends AViewerPluginSync {
    static readonly PluginType = 'LayersPanelPlugin'
    enabled = true
    dependencies = [PickingPlugin]

    readonly element: HTMLDivElement
    private _list: HTMLDivElement
    private _search: HTMLInputElement
    private _lockBtn: HTMLButtonElement
    private _menu?: HTMLDivElement
    private _expanded = new Set<IObject3D>()
    private _rows = new Map<IObject3D, HTMLDivElement>()
    private _queued = false
    private _renaming = false
    private _dragged: IObject3D[] = []
    private _filter = ''

    constructor(theme: 'light' | 'dark' = 'light') {
        super()
        injectStyles()
        this.element = document.createElement('div')
        this.element.className = 'lp-root' + (theme === 'dark' ? ' lp-dark' : '')
        this.element.innerHTML = `
<div class="lp-head">
  <span class="lp-title">Layers</span>
  <button class="lp-icon-btn lp-edit-lock" title="Lock editing (view only)">${ICONS.unlock}</button>
</div>
<div class="lp-search">${ICONS.search}<input placeholder="Search layers"></div>
<div class="lp-list"></div>`
        this._list = this.element.querySelector('.lp-list')!
        this._search = this.element.querySelector('.lp-search input')!
        this._lockBtn = this.element.querySelector('.lp-edit-lock')!
        this._search.addEventListener('input', () => {
            this._filter = this._search.value.trim().toLowerCase()
            this.refresh()
        })
        this._search.addEventListener('keydown', e => e.stopPropagation())
        this._lockBtn.addEventListener('click', () => {
            const ux = this._ux()
            if (ux) ux.setEditingLocked(!ux.editingLocked)
            this.refresh()
        })
        this._list.addEventListener('contextmenu', e => e.preventDefault())
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
        this._picking?.addEventListener('selectedObjectChanged', this.refresh)
        this._ux()?.addEventListener('uxUpdate', this._onUx)
        window.addEventListener('pointerdown', this._closeMenu, true)
        this.refresh()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.scene.removeEventListener('sceneUpdate', this._onSceneUpdate)
        this._picking?.removeEventListener('selectedObjectChanged', this.refresh)
        this._ux()?.removeEventListener('uxUpdate', this._onUx)
        window.removeEventListener('pointerdown', this._closeMenu, true)
        this.element.remove()
        super.onRemove(viewer)
    }

    private _onSceneUpdate = (e: any) => {
        if (e?.object && (e.object.assetType === 'widget' || e.object.userData?.isWidgetRoot)) return
        if (e?.hierarchyChanged || e?.refreshScene || e?.change === 'visible' || e?.change === 'name') this.refresh()
    }

    private _onUx = (e: {reason: string}) => {
        if (e.reason === 'hover') this._updateHover()
        else if (e.reason !== 'drag' && e.reason !== 'transform') this.refresh()
    }

    refresh = () => {
        if (this._queued) return
        this._queued = true
        requestAnimationFrame(() => {
            this._queued = false
            if (!this._renaming) this._build()
        })
    }

    private _isContent(o: IObject3D) {
        return !o.userData.isWidgetRoot && o.assetType !== 'widget' && o.userData.userSelectable !== false && !o.userData.isMultiSelectDummy
    }

    private _kids(o: IObject3D) {
        return (o.children as IObject3D[]).filter(c => this._isContent(c))
    }

    private _matches(o: IObject3D): boolean {
        if (!this._filter) return true
        if ((o.name || '').toLowerCase().includes(this._filter)) return true
        return this._kids(o).some(k => this._matches(k))
    }

    private _build() {
        if (!this._viewer) return
        const sel = this._picking?.getSelectedObjects().filter(o => (o as IObject3D)?.isObject3D) as IObject3D[] || []
        const root = this._viewer.scene.modelRoot
        for (const s of sel) {
            let p = s.parent as IObject3D | null
            while (p && p !== root) {
                this._expanded.add(p)
                p = p.parent as IObject3D | null
            }
        }
        const parentsOfSel = new Set<IObject3D>()
        for (const s of sel) s.traverseAncestors(a => parentsOfSel.add(a as IObject3D))
        const locked = this._locked
        this.element.classList.toggle('lp-editing-locked', locked)
        this._lockBtn.innerHTML = locked ? ICONS.lock : ICONS.unlock
        this._lockBtn.title = locked ? 'Unlock editing' : 'Lock editing (view only)'
        this._lockBtn.classList.toggle('lp-on', locked)

        const scroll = this._list.scrollTop
        this._list.innerHTML = ''
        this._rows.clear()
        const add = (o: IObject3D, depth: number, parentHidden: boolean, parentLocked: boolean) => {
            if (!this._matches(o)) return
            const kids = this._kids(o)
            const open = this._expanded.has(o) || !!this._filter
            const hidden = !o.visible || parentHidden
            const lockedObj = !!o.userData.locked
            const row = document.createElement('div')
            row.className = 'lp-row' +
                (sel.includes(o) ? ' lp-sel' : parentsOfSel.has(o) ? ' lp-sel-parent' : '') +
                (hidden ? ' lp-hidden' : '') + (lockedObj || parentLocked ? ' lp-locked' : '')
            row.style.paddingLeft = 6 + depth * 14 + 'px'
            row.draggable = !locked
            row.innerHTML = `<span class="lp-caret">${kids.length ? open ? ICONS.down : ICONS.right : ''}</span>` +
                `<span class="lp-type">${o.isLight ? ICONS.light : o.isCamera ? ICONS.camera : o.geometry ? ICONS.mesh : ICONS.group}</span>` +
                '<span class="lp-name"></span>' +
                `<button class="lp-icon-btn lp-lock ${lockedObj ? 'lp-on' : ''}" title="${lockedObj ? 'Unlock' : 'Lock'}">${lockedObj ? ICONS.lock : ICONS.unlock}</button>` +
                `<button class="lp-icon-btn lp-eye ${!o.visible ? 'lp-on' : ''}" title="${o.visible ? 'Hide' : 'Show'} (H)">${o.visible ? ICONS.eye : ICONS.eyeOff}</button>`
            row.querySelector('.lp-name')!.textContent = o.name || o.type
            row.querySelector('.lp-caret')!.addEventListener('click', e => {
                e.stopPropagation()
                if (this._expanded.has(o)) this._expanded.delete(o)
                else this._expanded.add(o)
                this._build()
            })
            row.querySelector('.lp-eye')!.addEventListener('click', e => {
                e.stopPropagation()
                this._toggle(o, 'visible')
            })
            row.querySelector('.lp-lock')!.addEventListener('click', e => {
                e.stopPropagation()
                if (!this._locked) this._toggle(o, 'locked')
            })
            row.addEventListener('click', e => this._clickRow(o, e))
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
            this._rows.set(o, row)
            this._list.appendChild(row)
            if (open) for (const k of kids) add(k, depth + 1, hidden, lockedObj || parentLocked)
        }
        for (const o of this._kids(root)) add(o, 0, false, false)
        if (!this._list.childElementCount) {
            const empty = document.createElement('div')
            empty.className = 'lp-empty'
            empty.textContent = this._filter ? 'No layers match' : 'No objects. Drop a model on the canvas.'
            this._list.appendChild(empty)
        }
        this._list.scrollTop = scroll
        this._rows.get(sel[0])?.scrollIntoView({block: 'nearest'})
        this._updateHover()
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
            this.refresh()
        }
        apply(targets.map(() => v))
        this._record(() => apply(before), () => apply(targets.map(() => v)))
    }

    private _rename(o: IObject3D, row: HTMLDivElement) {
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
                const set = (n: string) => {
                    o.name = n
                    o.setDirty?.({change: 'name', refreshScene: false} as any)
                    this.refresh()
                }
                set(name)
                this._record(() => set(old), () => set(name))
            }
            this._build()
        }
        input.addEventListener('keydown', e => {
            e.stopPropagation()
            if (e.key === 'Enter') finish(true)
            if (e.key === 'Escape') finish(false)
        })
        input.addEventListener('blur', () => finish(true))
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
        this.refresh()
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
        const items: [string, string, (() => void) | null][] = [
            ['Zoom to', 'F', () => picking?.focusSelected()],
            ['Rename', 'Double-click', locked ? null : () => {
                const row = this._rows.get(o)
                if (row) this._rename(o, row)
            }],
            ['Duplicate', 'Ctrl+D', locked ? null : () => picking?.duplicateSelected()],
            ['Group selection', 'Ctrl+G', locked || !ux ? null : () => ux.groupSelected()],
            ['Ungroup', 'Ctrl+Shift+G', locked || !ux || !isGroup ? null : () => ux.ungroupSelected()],
            [o.visible ? 'Hide' : 'Show', 'H', () => this._toggle(o, 'visible')],
            [o.userData.locked ? 'Unlock' : 'Lock', '', locked ? null : () => this._toggle(o, 'locked')],
            ['Delete', 'Delete', locked ? null : async() => picking?.deleteSelected()],
        ]
        const m = document.createElement('div')
        m.className = 'lp-menu' + (this.element.classList.contains('lp-dark') ? ' lp-dark' : '')
        for (const [label, key, fn] of items) {
            const it = document.createElement('div')
            it.className = 'lp-menu-item' + (fn ? '' : ' lp-disabled')
            it.innerHTML = `<span>${label}</span><kbd>${key}</kbd>`
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
  --lp-sel: #e5f4ff; --lp-sel-parent: #f5fbff; --lp-accent: #0d99ff; --lp-input: #f5f5f5;
  display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--lp-bg); color: var(--lp-fg);
  font: 11px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none;
}
.lp-dark {
  --lp-bg: #2c2c2c; --lp-fg: #e8e8e8; --lp-dim: #9a9a9a; --lp-line: #3a3a3a; --lp-hover: #383838;
  --lp-sel: #0d99ff40; --lp-sel-parent: #0d99ff18; --lp-input: #383838;
}
.lp-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 6px 12px; }
.lp-title { font-weight: 600; }
.lp-search { display: flex; align-items: center; gap: 6px; margin: 0 8px 6px; padding: 0 8px; height: 26px; border-radius: 5px; background: var(--lp-input); color: var(--lp-dim); }
.lp-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--lp-fg); font: inherit; }
.lp-list { flex: 1; overflow: auto; padding-bottom: 8px; }
.lp-row { display: flex; align-items: center; height: 28px; padding-right: 4px; gap: 2px; cursor: default; white-space: nowrap; position: relative; }
.lp-row:hover, .lp-row.lp-hover { box-shadow: inset 0 0 0 1px var(--lp-accent); }
.lp-row:hover { background: var(--lp-hover); }
.lp-row.lp-sel { background: var(--lp-sel); }
.lp-row.lp-sel-parent { background: var(--lp-sel-parent); }
.lp-row.lp-hidden .lp-name, .lp-row.lp-hidden .lp-type { opacity: 0.4; }
.lp-row.lp-dragging { opacity: 0.4; }
.lp-row.lp-drop-before::before, .lp-row.lp-drop-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 2px; background: var(--lp-accent); }
.lp-row.lp-drop-before::before { top: -1px; }
.lp-row.lp-drop-after::after { bottom: -1px; }
.lp-row.lp-drop-into { box-shadow: inset 0 0 0 2px var(--lp-accent); }
.lp-caret { width: 14px; display: flex; justify-content: center; color: var(--lp-dim); flex: none; }
.lp-type { width: 18px; display: flex; justify-content: center; color: var(--lp-dim); flex: none; }
.lp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; padding-left: 2px; }
.lp-rename { flex: 1; min-width: 0; font: inherit; color: var(--lp-fg); background: var(--lp-bg); border: 1px solid var(--lp-accent); border-radius: 3px; padding: 2px 4px; outline: none; }
.lp-icon-btn { border: 0; background: transparent; color: var(--lp-dim); width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex: none; }
.lp-icon-btn:hover { background: var(--lp-hover); color: var(--lp-fg); }
.lp-row .lp-icon-btn { visibility: hidden; }
.lp-row:hover .lp-icon-btn, .lp-row .lp-icon-btn.lp-on { visibility: visible; }
.lp-head .lp-icon-btn.lp-on { color: #fff; background: var(--lp-accent); }
.lp-editing-locked .lp-row .lp-lock { visibility: hidden !important; }
.lp-empty { color: var(--lp-dim); padding: 12px; }
.lp-menu { position: fixed; z-index: 1000; min-width: 200px; background: #1e1e1e; color: #fff; border-radius: 8px; padding: 6px 0; box-shadow: 0 6px 24px rgba(0,0,0,.25); font: 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; }
.lp-menu-item { display: flex; justify-content: space-between; gap: 16px; padding: 7px 14px; cursor: default; }
.lp-menu-item:hover { background: #0d99ff; }
.lp-menu-item.lp-disabled { opacity: 0.4; pointer-events: none; }
.lp-menu-item kbd { font: inherit; color: #aaa; }
`
    document.head.appendChild(st)
}
