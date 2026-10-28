import {AViewerPluginSync, createStyles, onChange, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import {NoteItem, NotesPlugin} from './NotesPlugin'
import styles from './StickyNotesUiPlugin.css?inline'

/**
 * How the notes are laid out over the canvas:
 * - `board`: each note is its own post-it, moved and sized on its own; "Arrange" puts them in columns;
 * - `stack`: one post-it with the notes one above the other.
 */
export type StickyNotesLayout = 'board' | 'stack'
export type StickyNotesColor = 'yellow' | 'pink' | 'blue' | 'green' | 'theme'

/** A place and size on the canvas, in px */
interface Box {
    x?: number
    y?: number
    w?: number
    h?: number
}

/** What the person set, kept in `localStorage` ({@link StickyNotesUiPlugin.storageKey}) */
interface StickyState {
    layout?: StickyNotesLayout
    color?: StickyNotesColor
    shown?: boolean
    stack?: Box & {collapsed?: boolean}
    /** The post-it of each note in the board layout, by note id */
    board?: Record<string, Box>
}

/** The UI of one note */
interface NoteView {
    note: NoteItem
    /** The note: its bar (where it is kept, + Context, Copy, delete) and its text */
    root: HTMLDivElement
    bar: HTMLDivElement
    badge: HTMLButtonElement
    text: HTMLTextAreaElement
}

/** The size of a new post-it in the board layout */
const NOTE_W = 220
const NOTE_H = 150
const GAP = 12

/**
 * Sticky Notes UI Plugin
 *
 * Shows the notes of {@link NotesPlugin} as post-its over the canvas, in one of two layouts
 * ({@link StickyNotesLayout}): `board`, each note its own post-it, or `stack`, one post-it with all the notes. A
 * button on the canvas switches between them.
 *
 * - "+ Note" makes a note; with more than one store, a menu asks where to keep it ("In the file", "This browser", or
 *   a store of the app). The badge on a note shows its store; a click moves it to another store.
 * - Each note has "+ Context" (the time and the selection, {@link NotesPlugin.contextLine}), "Copy" and "×".
 * - Drag a post-it by its bar, and size it from its bottom right corner. The places, the sizes, the layout and the
 *   colour are kept in `localStorage` ({@link storageKey}), not in the file.
 *
 * The plugin's UI folder (Sticky Notes) has the settings: show, layout, colour, arrange, reset the places.
 *
 * @category Plugins
 */
export class StickyNotesUiPlugin extends AViewerPluginSync {
    static readonly PluginType = 'StickyNotesUiPlugin'
    /** Adds the stylesheet of the notes to the page when the first plugin is made. Off: the page styles the `snp-` classes. */
    static InjectStyles = true
    private static _styles?: HTMLStyleElement
    enabled = true
    dependencies = [NotesPlugin]
    // the layout, the places and the colour are a setting of the person (localStorage), not of the scene
    toJSON: any = undefined

    /** The notes are on the canvas */
    @onChange(StickyNotesUiPlugin.prototype._settingChanged)
        shown = true

    @onChange(StickyNotesUiPlugin.prototype._settingChanged)
        layout: StickyNotesLayout = 'board'

    /** The colour of the post-its. `theme`: the colours of the Tweakpane theme */
    @onChange(StickyNotesUiPlugin.prototype._settingChanged)
        color: StickyNotesColor = 'yellow'

    /** The `localStorage` key of the layout, the colour, the places and the sizes */
    readonly storageKey: string

    /** The layer over the canvas that holds the post-its */
    readonly element: HTMLDivElement

    private _notes?: NotesPlugin
    private _views = new Map<string, NoteView>()
    private _state: StickyState
    private _menu?: HTMLDivElement
    private _ready = false
    /** The size the person gives a post-it from its corner is kept: the box of each post-it on the canvas */
    private _sizes = new WeakMap<Element, Box>()
    private _sized = new WeakSet<Element>()
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
        for (const {target} of entries) {
            // the first call is the size the post-it was made with
            if (!this._sized.has(target)) {
                this._sized.add(target)
                continue
            }
            const box = this._sizes.get(target)
            if (!box) continue
            box.w = (target as HTMLElement).offsetWidth
            box.h = (target as HTMLElement).offsetHeight
            this._writeState()
        }
    })

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Sticky Notes',
        children: [
            {type: 'checkbox', label: 'Show', property: [this, 'shown']},
            {type: 'dropdown', label: 'Layout', property: [this, 'layout'], children: [{label: 'Board: a post-it per note', value: 'board'}, {label: 'Stack: one post-it', value: 'stack'}]},
            {
                type: 'dropdown', label: 'Colour', property: [this, 'color'],
                children: (['yellow', 'pink', 'blue', 'green', 'theme'] as const).map(c => ({label: c[0].toUpperCase() + c.slice(1), value: c})),
            },
            {type: 'button', label: 'Arrange', value: () => this.arrange(), hidden: () => this.layout !== 'board'},
            {type: 'button', label: 'Reset places', value: () => this.resetPlaces()},
        ],
    }

    constructor(storageKey = 'threepipe-sticky-notes') {
        super()
        this.storageKey = storageKey
        if (StickyNotesUiPlugin.InjectStyles && !StickyNotesUiPlugin._styles?.isConnected) StickyNotesUiPlugin._styles = createStyles(styles)
        this.element = el('div', 'snp-layer')
        this._state = this._readState()
        this.layout = this._state.layout ?? this.layout
        this.color = this._state.color ?? this.color
        this.shown = this._state.shown ?? this.shown
        this._ready = true
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._notes = viewer.getPlugin(NotesPlugin)
        this._notes?.addEventListener('notesChanged', this._onNotesChanged)
        this._notes?.addEventListener('storeStatusChanged', this._onStatus)
        viewer.container.appendChild(this.element)
        window.addEventListener('resize', this._onResize)
        this._render()
    }

    onRemove(viewer: ThreeViewer) {
        this._notes?.removeEventListener('notesChanged', this._onNotesChanged)
        this._notes?.removeEventListener('storeStatusChanged', this._onStatus)
        window.removeEventListener('resize', this._onResize)
        this._closeMenu()
        this._resizer?.disconnect()
        this.element.remove()
        this._notes = undefined
        super.onRemove(viewer)
    }

    /** Makes a note and shows it with the cursor in it. With no store named and more than one, use the menu of "+ Note". */
    addNote(store?: string) {
        const note = this._notes?.addNote('', store)
        if (note) this._views.get(note.id)?.text.focus()
        return note
    }

    /** Puts the post-its of the board layout in columns from the top left corner, in the order of the notes */
    arrange() {
        const board: Record<string, Box> = {}
        const height = this.element.clientHeight || 600
        let x = GAP, y = GAP, colW = 0
        for (const note of this._notes?.notes ?? []) {
            const old = this._state.board?.[note.id] ?? {}
            const w = old.w ?? NOTE_W, h = old.h ?? NOTE_H
            if (y > GAP && y + h > height - GAP) {
                x += colW + GAP
                y = GAP
                colW = 0
            }
            board[note.id] = {...old, x, y}
            y += h + GAP
            colW = Math.max(colW, w)
        }
        this._state.board = board
        this._writeState()
        this._render()
    }

    /** Forgets the places and sizes of the post-its: the board is arranged again, the stack goes back to its corner */
    resetPlaces() {
        this._state.stack = {collapsed: this._state.stack?.collapsed}
        this._state.board = {}
        this.arrange()
    }

    private _settingChanged() {
        if (!this._ready) return // the field initializers and the constructor
        this._state.layout = this.layout
        this._state.color = this.color
        this._state.shown = this.shown
        this._writeState()
        this._render()
        this.uiConfig.uiRefresh?.(true)
    }

    private _onNotesChanged = (e: {change: string, note?: NoteItem}) => {
        if (e.change === 'update' && e.note) {
            const view = this._views.get(e.note.id)
            // a note typed in keeps its text and cursor; a move to another store moves it in the stack too
            if (view && view.note.store === e.note.store && view.badge.textContent === this._storeLabel(e.note.store)) {
                if (document.activeElement !== view.text && view.text.value !== e.note.text) view.text.value = e.note.text
                return
            }
        }
        this._render()
    }

    private _onStatus = () => {
        for (const view of this._views.values()) this._updateBadge(view)
    }

    private _onResize = () => this._render()

    /** Builds the post-its of the layout from the notes */
    private _render() {
        this._closeMenu()
        const focused = [...this._views.values()].find(v => v.text === document.activeElement)
        const caret = focused?.text.selectionStart
        this._resizer?.disconnect()
        this.element.replaceChildren()
        this._views.clear()
        this.element.dataset.color = this.color
        this.element.style.display = this.shown ? '' : 'none'
        if (!this._notes) return
        for (const note of this._notes.notes) this._views.set(note.id, this._noteView(note))
        if (this.layout === 'stack') this._renderStack()
        else this._renderBoard()
        const again = focused && this._views.get(focused.note.id)
        if (again) {
            again.text.focus()
            if (caret !== undefined && caret !== null) again.text.selectionStart = again.text.selectionEnd = caret
        }
    }

    private _renderBoard() {
        const board = this._state.board ??= {}
        let placed = false
        for (const view of this._views.values()) {
            const card = el('div', 'snp-card snp-note-card')
            card.appendChild(view.root)
            this.element.appendChild(card)
            if (!board[view.note.id]) {
                board[view.note.id] = this._nextPlace()
                placed = true
            }
            const box = board[view.note.id]
            this._placeCard(card, box)
            this._draggable(view.bar, card, (x, y) => {
                box.x = x
                box.y = y
            })
            this._watchSize(card, box)
        }
        // the places of removed notes
        const ids = new Set(this._views.keys())
        for (const id of Object.keys(board)) if (!ids.has(id)) delete board[id]
        if (placed) this._writeState()

        const dock = el('div', 'snp-dock')
        dock.appendChild(this._addButton('+ Note'))
        dock.appendChild(button('Arrange', 'Put the notes in columns', () => this.arrange()))
        dock.appendChild(button('Stack', 'Show the notes in one post-it', () => this.layout = 'stack'))
        this.element.appendChild(dock)
    }

    private _renderStack() {
        const box = this._state.stack ??= {}
        const card = el('div', 'snp-card snp-stack')
        card.classList.toggle('snp-collapsed', !!box.collapsed)
        const head = el('div', 'snp-head')
        const title = el('b', '', 'Notes')
        const count = el('span', 'snp-count', String(this._views.size))
        head.appendChild(title)
        head.appendChild(count)
        head.appendChild(el('span', 'snp-fill'))
        head.appendChild(this._addButton('+', 'Add a note'))
        head.appendChild(button('Spread', 'A post-it per note', () => this.layout = 'board'))
        head.appendChild(button(box.collapsed ? '+' : '–', box.collapsed ? 'Expand' : 'Collapse', () => {
            box.collapsed = !box.collapsed
            this._writeState()
            this._render()
        }, 'snp-collapse'))
        card.appendChild(head)
        const list = el('div', 'snp-list')
        for (const view of this._views.values()) list.appendChild(view.root)
        if (!this._views.size) list.appendChild(el('div', 'snp-empty', 'No notes yet. “+” adds one.'))
        card.appendChild(list)
        this.element.appendChild(card)
        this._placeCard(card, box)
        this._draggable(head, card, (x, y) => {
            box.x = x
            box.y = y
        })
        if (!box.collapsed) this._watchSize(card, box)
    }

    /** The UI of a note: its bar (badge, + Context, Copy, ×) and its text */
    private _noteView(note: NoteItem): NoteView {
        const root = el('div', 'snp-note')
        const bar = el('div', 'snp-bar')
        const badge = el('button', 'snp-badge') as HTMLButtonElement
        badge.addEventListener('click', () => this._openMenu(badge, 'Keep in', id => this._notes?.updateNote(note.id, {store: id}), note.store))
        bar.appendChild(badge)
        bar.appendChild(el('span', 'snp-fill'))
        const text = el('textarea', '') as HTMLTextAreaElement
        text.value = note.text
        text.placeholder = 'A note…'
        text.spellcheck = true
        text.addEventListener('input', () => this._notes?.updateNote(note.id, {text: text.value}))
        // typing (Ctrl+Z, Delete, the arrows) does not reach the viewer's shortcuts
        text.addEventListener('keydown', e => e.stopPropagation())
        bar.appendChild(button('+ Context', 'Add the time and the selection', () => {
            const line = this._notes?.contextLine() ?? ''
            const at = text.selectionStart ?? text.value.length
            const insert = (at && text.value[at - 1] !== '\n' ? '\n' : '') + line + '\n'
            text.value = text.value.slice(0, at) + insert + text.value.slice(at)
            text.focus()
            text.selectionStart = text.selectionEnd = at + insert.length
            this._notes?.updateNote(note.id, {text: text.value})
        }, 'snp-tool'))
        bar.appendChild(button('Copy', 'Copy the note', () => void navigator.clipboard?.writeText(text.value), 'snp-tool'))
        bar.appendChild(button('×', 'Delete the note', () => this._notes?.removeNote(note.id), 'snp-tool snp-delete'))
        root.appendChild(bar)
        root.appendChild(text)
        const view = {note, root, bar, badge, text}
        this._updateBadge(view)
        return view
    }

    private _storeLabel(store: string) {
        return this._notes?.getStore(store)?.label ?? store
    }

    private _updateBadge(view: NoteView) {
        const status = this._notes?.storeStatus(view.note.store)
        view.badge.textContent = this._storeLabel(view.note.store)
        view.badge.title = 'Where the note is kept' + (status === 'error' ? ': it could not be saved or loaded' : '') + '. Click to move it.'
        view.badge.dataset.status = status ?? ''
    }

    /** "+ Note": a note in the only store, or a menu of the stores */
    private _addButton(label: string, title = 'Add a note') {
        const b = button(label, title, () => {
            const stores = this._notes?.stores ?? []
            if (stores.length <= 1) this.addNote()
            else this._openMenu(b, 'New note in', id => this.addNote(id), this._notes?.defaultStore)
        }, 'snp-add')
        return b
    }

    private _openMenu(anchor: HTMLElement, title: string, pick: (store: string) => void, current?: string) {
        const open = this._menu?.dataset.anchor === title + anchor.className
        this._closeMenu()
        if (open) return
        const menu = el('div', 'snp-menu')
        menu.dataset.anchor = title + anchor.className
        menu.appendChild(el('div', 'snp-menu-title', title))
        for (const store of this._notes?.stores ?? []) {
            const b = button(store.label, '', () => {
                this._closeMenu()
                pick(store.id)
            })
            if (store.id === current) b.classList.add('on')
            menu.appendChild(b)
        }
        const r = anchor.getBoundingClientRect?.()
        const p = this.element.getBoundingClientRect?.()
        if (r && p) {
            menu.style.left = Math.round(r.left - p.left) + 'px'
            menu.style.top = Math.round(r.bottom - p.top + 4) + 'px'
        }
        this.element.appendChild(menu)
        this._menu = menu
        document.addEventListener('pointerdown', this._pointerOutside, true)
    }

    private _closeMenu() {
        document.removeEventListener('pointerdown', this._pointerOutside, true)
        this._menu?.remove()
        this._menu = undefined
    }

    /** A press outside the menu closes it, but not one on the button that opened it: its click toggles the menu */
    private _pointerOutside = (e: Event) => {
        const t = e.target as HTMLElement
        if (this._menu?.contains(t) || t?.closest?.('.snp-add, .snp-badge')) return
        this._closeMenu()
    }

    /** Where a new post-it goes in the board layout: below the lowest one in the first column, or a new column */
    private _nextPlace(): Box {
        const boxes = Object.values(this._state.board ?? {})
        const height = this.element.clientHeight || 600
        const columnAt = (cx: number) => boxes.filter(b => (b.x ?? 0) === cx)
        let x = GAP
        let column = columnAt(x)
        while (column.length) {
            const y = Math.max(...column.map(b => (b.y ?? 0) + (b.h ?? NOTE_H) + GAP))
            if (y + NOTE_H <= height - GAP) return {x, y}
            x += Math.max(...column.map(b => b.w ?? NOTE_W)) + GAP
            column = columnAt(x)
        }
        return {x, y: GAP}
    }

    /** Sets the place and size of a post-it, kept inside the canvas. No place: the bottom left corner (the stack). */
    private _placeCard(card: HTMLElement, box: Box) {
        if (box.w) card.style.width = box.w + 'px'
        if (box.h) card.style.height = box.h + 'px'
        if (box.x === undefined || box.y === undefined) return
        const maxX = Math.max(0, this.element.clientWidth - (card.offsetWidth || box.w || NOTE_W))
        const maxY = Math.max(0, this.element.clientHeight - (card.offsetHeight || box.h || NOTE_H))
        card.style.left = Math.min(Math.max(0, box.x), maxX) + 'px'
        card.style.top = Math.min(Math.max(0, box.y), maxY) + 'px'
        card.style.bottom = 'auto'
    }

    /** A post-it follows the pointer from its handle; the place is kept when the pointer is released */
    private _draggable(handle: HTMLElement, card: HTMLElement, set: (x: number, y: number) => void) {
        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest?.('button')) return
            e.preventDefault()
            this._closeMenu()
            const sx = e.clientX - card.offsetLeft
            const sy = e.clientY - card.offsetTop
            handle.setPointerCapture(e.pointerId)
            // the post-it moved last is on top
            card.parentElement?.appendChild(card)
            const move = (ev: PointerEvent) => {
                set(ev.clientX - sx, ev.clientY - sy)
                this._placeCard(card, {x: ev.clientX - sx, y: ev.clientY - sy})
            }
            const up = () => {
                handle.removeEventListener('pointermove', move)
                handle.removeEventListener('pointerup', up)
                handle.removeEventListener('pointercancel', up)
                this._writeState()
            }
            handle.addEventListener('pointermove', move)
            handle.addEventListener('pointerup', up)
            handle.addEventListener('pointercancel', up)
        })
    }

    /** Keeps the size the person gives a post-it from its corner */
    private _watchSize(card: HTMLElement, box: Box) {
        this._sizes.set(card, box)
        this._resizer?.observe(card)
    }

    private _readState(): StickyState {
        try {
            return JSON.parse(localStorage.getItem(this.storageKey) || '{}') || {}
        } catch (e) {
            return {} // no storage, or not JSON
        }
    }

    private _writeState() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this._state))
        } catch (e) {
            // no storage: this page only
        }
    }
}

/** An element with a class and a text */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    if (className) e.className = className
    if (text) e.textContent = text
    return e
}

/** A button with a text, a tooltip and a click */
function button(text: string, title: string, click: () => void, className = ''): HTMLButtonElement {
    const b = el('button', className, text)
    if (title) b.title = title
    b.addEventListener('click', click)
    return b
}
