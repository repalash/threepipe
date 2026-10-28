import {AViewerPluginSync, createStyles, onChange, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import {NoteItem, NotesPlugin} from './NotesPlugin'
import styles from './StickyNotesUiPlugin.css?inline'

/**
 * How the post-its are laid out over the canvas:
 * - `board`: each note is its own post-it, moved and sized on its own; "Arrange" puts them in columns;
 * - `stack`: the post-its lie on a pile, each one a little offset from the one above it; a click on one behind brings
 *   it to the top, and the pile moves and sizes as one.
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
    /** The place and size of the pile */
    stack?: Box
    /** The post-it of each note in the board layout, by note id */
    board?: Record<string, Box>
    /** The note ids from the bottom to the top: the order of the board and of the pile */
    order?: string[]
}

/** The post-it of one note */
interface NoteCard {
    note: NoteItem
    card: HTMLDivElement
    /** Where the note is kept, + Context, Copy, ×; the post-it is dragged by it */
    bar: HTMLDivElement
    badge: HTMLButtonElement
    text: HTMLTextAreaElement
    /** The size given to the post-it, to tell it from a size the person gives it from its corner */
    size: [number, number]
}

const NOTE_W = 220
const NOTE_H = 150
const GAP = 12
/** The offset of each post-it under the top one in the pile, in px, and the number of them that show */
const PILE_STEP = 8
const PILE_DEPTH = 4
/** A press moves this far before it is a drag, in px: a click on the bar brings the post-it up without a move */
const DRAG_START = 3

/**
 * Sticky Notes UI Plugin
 *
 * Shows the notes of {@link NotesPlugin} as post-its over the canvas, in one of two layouts
 * ({@link StickyNotesLayout}): `board` (a post-it per note) or `stack` (a pile). The buttons at the bottom left add
 * a note, arrange the board and switch the layout.
 *
 * - "+ Note" adds a note at once, in the store of new notes ({@link NotesPlugin.defaultStore}); "▾" picks another
 *   store. The badge on a note shows its store; a click moves the note to another store.
 * - Each note has "+ Context" (the time and the selection, {@link NotesPlugin.contextLine}), "Copy" and "×".
 * - Drag a post-it by its bar, and size it from its bottom right corner. A click on a post-it brings it up.
 * - The places, the sizes, the order, the layout and the colour are kept in `localStorage` ({@link storageKey}), not in
 *   the file.
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

    /** The `localStorage` key of the layout, the colour, the places, the sizes and the order */
    readonly storageKey: string

    /** The layer over the canvas that holds the post-its */
    readonly element: HTMLDivElement

    /**
     * The buttons at the bottom left of the canvas: "+ Note", "▾", "Arrange" and the layout. Place it with its style
     * when the corner is taken, e.g. `dock.style.bottom = '64px'`; the pile starts above it.
     */
    readonly dock: HTMLDivElement

    private _notes?: NotesPlugin
    private _cards = new Map<string, NoteCard>()
    private _state: StickyState
    private _arrangeButton: HTMLButtonElement
    private _layoutButton: HTMLButtonElement
    private _menu?: HTMLDivElement
    private _ready = false
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
        for (const {target} of entries) this._cardResized(target as HTMLDivElement)
    })

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Sticky Notes',
        children: [
            {type: 'checkbox', label: 'Show', property: [this, 'shown']},
            {type: 'dropdown', label: 'Layout', property: [this, 'layout'], children: [{label: 'Board: a post-it per note', value: 'board'}, {label: 'Stack: a pile', value: 'stack'}]},
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
        this.dock = el('div', 'snp-dock')
        const add = button('+ Note', 'Add a note', () => this.addNote(), 'snp-add')
        const pick = button('▾', 'Add a note in…', () => this._openMenu(pick, 'New note in', id => this.addNote(id), this._notes?.defaultStore), 'snp-add-to')
        this._arrangeButton = button('Arrange', 'Put the post-its in columns', () => this.arrange())
        this._layoutButton = button('', '', () => this.layout = this.layout === 'board' ? 'stack' : 'board')
        for (const b of [add, pick, this._arrangeButton, this._layoutButton]) this.dock.appendChild(b)
        this.element.appendChild(this.dock)
        // the post-its and the dock keep their pointer and wheel from the viewer under them
        this.element.addEventListener('pointerdown', e => e.stopPropagation())
        this.element.addEventListener('wheel', e => e.stopPropagation())
        this._state = this._readState()
        this.layout = this._state.layout ?? this.layout
        this.color = this._state.color ?? this.color
        this.shown = this._state.shown ?? this.shown
        this._ready = true
        this._applyLook()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._notes = viewer.getPlugin(NotesPlugin)
        this._notes?.addEventListener('notesChanged', this._onNotesChanged)
        this._notes?.addEventListener('storeStatusChanged', this._onStatus)
        viewer.container.appendChild(this.element)
        window.addEventListener('resize', this._onResize)
        this._sync()
    }

    onRemove(viewer: ThreeViewer) {
        this._notes?.removeEventListener('notesChanged', this._onNotesChanged)
        this._notes?.removeEventListener('storeStatusChanged', this._onStatus)
        window.removeEventListener('resize', this._onResize)
        this._closeMenu()
        this._resizer?.disconnect()
        for (const c of this._cards.values()) c.card.remove()
        this._cards.clear()
        this.element.remove()
        this._notes = undefined
        super.onRemove(viewer)
    }

    /** Makes a note on top, with the cursor in it ({@link NotesPlugin.defaultStore} when no store is named) */
    addNote(store?: string) {
        this._closeMenu()
        const note = this._notes?.addNote('', store)
        if (note) this._cards.get(note.id)?.text.focus()
        return note
    }

    /** Brings the post-it of a note to the top (of the board, or of the pile) */
    bringToTop(id: string) {
        const order = this._order()
        if (order[order.length - 1] === id) return
        this._state.order = [...order.filter(o => o !== id), id]
        this._writeState()
        this._layoutCards(true)
    }

    /** Puts the post-its of the board in columns from the top left corner, from the bottom one to the top one */
    arrange() {
        const board: Record<string, Box> = {}
        const height = this.element.clientHeight || 600
        let x = GAP, y = GAP, colW = 0
        for (const id of this._order()) {
            const old = this._state.board?.[id] ?? {}
            const w = old.w ?? NOTE_W, h = old.h ?? NOTE_H
            if (y > GAP && y + h > height - GAP) {
                x += colW + GAP
                y = GAP
                colW = 0
            }
            board[id] = {...old, x, y}
            y += h + GAP
            colW = Math.max(colW, w)
        }
        this._state.board = board
        this._writeState()
        this._layoutCards(true)
    }

    /** Forgets the places and sizes: the board is arranged again, the pile goes back to its corner */
    resetPlaces() {
        this._state.stack = {}
        this._state.board = {}
        this.arrange()
    }

    private _settingChanged() {
        if (!this._ready) return // the field initializers and the constructor
        this._state.layout = this.layout
        this._state.color = this.color
        this._state.shown = this.shown
        this._writeState()
        this._applyLook()
        this._layoutCards(true)
        this.uiConfig.uiRefresh?.(true)
    }

    private _applyLook() {
        this.element.dataset.color = this.color
        this.element.dataset.layout = this.layout
        this.element.style.display = this.shown ? '' : 'none'
        this._arrangeButton.style.display = this.layout === 'board' ? '' : 'none'
        this._layoutButton.textContent = this.layout === 'board' ? 'Stack' : 'Spread'
        this._layoutButton.title = this.layout === 'board' ? 'Put the post-its on a pile' : 'A post-it per note on the board'
    }

    private _onNotesChanged = (e: {change: string, note?: NoteItem}) => {
        if (e.change === 'remove' && this._state.board) {
            // a removed note forgets its place; notes that are not loaded yet keep theirs
            const ids = new Set(this._notes?.notes.map(n => n.id))
            for (const id of Object.keys(this._state.board)) if (e.note ? id === e.note.id : !ids.has(id)) delete this._state.board[id]
            this._writeState()
        }
        this._sync(e.change === 'add' ? e.note?.id : undefined)
    }

    private _onStatus = () => {
        for (const c of this._cards.values()) this._updateBadge(c)
    }

    private _onResize = () => this._layoutCards(false)

    /**
     * Makes the post-its of new notes, removes those of removed notes and updates the others, then lays them out. A
     * post-it that stays keeps its text box, so the cursor and the typing are not interrupted.
     */
    private _sync(added?: string) {
        const notes = this._notes?.notes ?? []
        const ids = new Set(notes.map(n => n.id))
        for (const [id, c] of this._cards) {
            if (ids.has(id)) continue
            this._resizer?.unobserve(c.card)
            c.card.remove()
            this._cards.delete(id)
        }
        for (const note of notes) {
            let c = this._cards.get(note.id)
            if (!c) {
                c = this._makeCard(note)
                this._cards.set(note.id, c)
                this.element.insertBefore(c.card, this.dock)
                if (note.id === added) c.card.classList.add('snp-new')
            }
            c.note = note
            // a change by the app (typing gives the same text): shown also while the note is typed in, cursor kept
            if (c.text.value !== note.text) {
                const t = c.text, focused = document.activeElement === t, from = t.selectionStart, to = t.selectionEnd
                t.value = note.text
                if (focused && from !== null) {
                    t.selectionStart = Math.min(from, note.text.length)
                    t.selectionEnd = Math.min(to ?? from, note.text.length)
                }
            }
            this._updateBadge(c)
        }
        // a note made now goes on top
        if (added) this._state.order = [...this._order().filter(o => o !== added), added]
        this._layoutCards(!!added)
    }

    /** The note ids from the bottom to the top, with the notes not in the stored order on top */
    private _order() {
        const ids = this._notes?.notes.map(n => n.id) ?? []
        const known = (this._state.order ?? []).filter(id => ids.includes(id))
        return [...known, ...ids.filter(id => !known.includes(id))]
    }

    /** Sets the place, size and depth of every post-it for the layout. `animate`: they glide there. */
    private _layoutCards(animate: boolean) {
        this.element.classList.toggle('snp-instant', !animate)
        const order = this._order()
        if (this.layout === 'stack') {
            const pile = this._pileBox()
            order.forEach((id, i) => {
                const c = this._cards.get(id)
                if (!c) return
                const depth = order.length - 1 - i
                const d = Math.min(depth, PILE_DEPTH)
                this._setBox(c, {x: pile.x + d * PILE_STEP, y: pile.y - d * PILE_STEP, w: pile.w, h: pile.h})
                c.card.style.zIndex = String(i + 1)
                c.card.style.transform = depth ? `rotate(${depth % 2 ? 1.2 : -0.9}deg)` : ''
                c.card.style.visibility = depth > PILE_DEPTH ? 'hidden' : ''
                c.card.classList.toggle('snp-behind', depth > 0)
            })
        } else {
            const board = this._state.board ??= {}
            let placed = false
            order.forEach((id, i) => {
                const c = this._cards.get(id)
                if (!c) return
                if (!board[id]) {
                    board[id] = this._nextPlace()
                    placed = true
                }
                this._setBox(c, this._clamp(board[id]))
                c.card.style.zIndex = String(i + 1)
                c.card.style.transform = ''
                c.card.style.visibility = ''
                c.card.classList.remove('snp-behind')
            })
            if (placed) this._writeState()
        }
    }

    /** The place and size of the pile: its corner above the dock, or where the person put it */
    private _pileBox(): Required<Box> {
        const s = this._state.stack ?? {}
        const w = s.w ?? NOTE_W + 40, h = s.h ?? NOTE_H + 40
        const H = this.element.clientHeight || 600
        // above the dock, where it is
        const dockTop = this.dock.offsetTop || H - 40
        return this._clamp({x: s.x ?? GAP, y: s.y ?? dockTop - h - GAP, w, h}) as Required<Box>
    }

    /** A box kept inside the canvas */
    private _clamp(box: Box): Box {
        const w = box.w ?? NOTE_W, h = box.h ?? NOTE_H
        const W = this.element.clientWidth || 800, H = this.element.clientHeight || 600
        return {
            ...box,
            x: Math.min(Math.max(0, box.x ?? GAP), Math.max(0, W - w)),
            y: Math.min(Math.max(0, box.y ?? GAP), Math.max(0, H - h)),
        }
    }

    private _setBox(c: NoteCard, box: Box) {
        const w = box.w ?? NOTE_W, h = box.h ?? NOTE_H
        c.size = [w, h]
        c.card.style.left = (box.x ?? 0) + 'px'
        c.card.style.top = (box.y ?? 0) + 'px'
        c.card.style.width = w + 'px'
        c.card.style.height = h + 'px'
    }

    /** The post-it of a note: its bar (badge, + Context, Copy, ×) and its text */
    private _makeCard(note: NoteItem): NoteCard {
        const card = el('div', 'snp-card')
        const bar = el('div', 'snp-bar')
        const badge = el('button', 'snp-badge') as HTMLButtonElement
        const text = el('textarea', '') as HTMLTextAreaElement
        const c: NoteCard = {note, card, bar, badge, text, size: [NOTE_W, NOTE_H]}
        badge.addEventListener('click', () => this._openMenu(badge, 'Keep in', id => this._notes?.updateNote(c.note.id, {store: id}), c.note.store))
        bar.appendChild(badge)
        bar.appendChild(el('span', 'snp-fill'))
        bar.appendChild(button('+ Context', 'Add the time and the selection', () => this._addContext(c), 'snp-tool'))
        bar.appendChild(button('Copy', 'Copy the note', () => void navigator.clipboard?.writeText(text.value), 'snp-tool'))
        bar.appendChild(button('×', 'Delete the note', () => this._notes?.removeNote(c.note.id), 'snp-tool snp-delete'))
        text.value = note.text
        text.placeholder = 'A note…'
        text.spellcheck = true
        text.addEventListener('input', () => this._notes?.updateNote(c.note.id, {text: text.value}))
        text.addEventListener('keydown', e => {
            // typing (Ctrl+Z, Delete, the arrows) does not reach the viewer's shortcuts; Escape leaves the note
            e.stopPropagation()
            if (e.key === 'Escape') text.blur()
        })
        card.appendChild(bar)
        card.appendChild(text)
        // a press on a post-it brings it up; on one behind in the pile, it does only that
        card.addEventListener('pointerdown', (e: PointerEvent) => {
            const behind = this.layout === 'stack' && card.classList.contains('snp-behind')
            this.bringToTop(c.note.id)
            if (behind) e.preventDefault()
        })
        card.addEventListener('animationend', () => card.classList.remove('snp-new'))
        this._draggable(c)
        this._resizer?.observe(card)
        this._updateBadge(c)
        return c
    }

    private _addContext(c: NoteCard) {
        const t = c.text
        const line = this._notes?.contextLine() ?? ''
        const at = t.selectionStart ?? t.value.length
        const insert = (at && t.value[at - 1] !== '\n' ? '\n' : '') + line + '\n'
        t.value = t.value.slice(0, at) + insert + t.value.slice(at)
        t.focus()
        t.selectionStart = t.selectionEnd = at + insert.length
        this._notes?.updateNote(c.note.id, {text: t.value})
    }

    private _storeLabel(store: string) {
        return this._notes?.getStore(store)?.label ?? store
    }

    private _updateBadge(c: NoteCard) {
        const status = this._notes?.storeStatus(c.note.store)
        c.badge.textContent = this._storeLabel(c.note.store)
        c.badge.title = 'Where the note is kept' + (status === 'error' ? ': it could not be saved or loaded' : '') + '. Click to move it.'
        c.badge.dataset.status = status ?? ''
    }

    /**
     * Drags a post-it by its bar (the pile, in the stack layout). The pointer is captured on the bar, so the post-it
     * follows it also outside the bar, and the drag ends on release, cancel or a lost capture.
     */
    private _draggable(c: NoteCard) {
        const bar = c.bar
        bar.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest?.('button')) return
            if (this.layout === 'stack' && c.card.classList.contains('snp-behind')) return
            e.preventDefault()
            this._closeMenu()
            const stack = this.layout === 'stack'
            const start = stack ? this._pileBox() : this._clamp(this._state.board?.[c.note.id] ?? {})
            const sx = e.clientX, sy = e.clientY
            let moving = false
            bar.setPointerCapture?.(e.pointerId)
            const move = (ev: PointerEvent) => {
                const dx = ev.clientX - sx, dy = ev.clientY - sy
                if (!moving && Math.abs(dx) + Math.abs(dy) < DRAG_START) return
                if (!moving) {
                    moving = true
                    this.element.classList.add('snp-dragging')
                    c.card.classList.add('snp-lifted')
                }
                const x = (start.x ?? 0) + dx, y = (start.y ?? 0) + dy
                if (stack) this._state.stack = {...this._state.stack, x, y}
                else (this._state.board ??= {})[c.note.id] = {...this._state.board?.[c.note.id], x, y}
                this._layoutCards(false)
            }
            const end = () => {
                bar.removeEventListener('pointermove', move)
                bar.removeEventListener('pointerup', end)
                bar.removeEventListener('pointercancel', end)
                bar.removeEventListener('lostpointercapture', end)
                this.element.classList.remove('snp-dragging')
                c.card.classList.remove('snp-lifted')
                if (!moving) return
                // the place kept is the one inside the canvas
                if (stack) {
                    const pile = this._pileBox()
                    this._state.stack = {...this._state.stack, x: pile.x, y: pile.y}
                } else {
                    this._state.board![c.note.id] = this._clamp(this._state.board![c.note.id])
                }
                this._writeState()
            }
            bar.addEventListener('pointermove', move)
            bar.addEventListener('pointerup', end)
            bar.addEventListener('pointercancel', end)
            bar.addEventListener('lostpointercapture', end)
        })
    }

    /** The person sized a post-it from its corner: its box (the pile's, in the stack layout) keeps the size */
    private _cardResized(card: HTMLDivElement) {
        const c = [...this._cards.values()].find(x => x.card === card)
        if (!c) return
        const w = card.offsetWidth, h = card.offsetHeight
        if (Math.abs(w - c.size[0]) < 2 && Math.abs(h - c.size[1]) < 2) return // the size the layout gave it
        c.size = [w, h]
        if (this.layout === 'stack') this._state.stack = {...this._state.stack, w, h}
        else (this._state.board ??= {})[c.note.id] = {...this._state.board?.[c.note.id], w, h}
        this._writeState()
        this._layoutCards(false)
    }

    /** Where a new post-it goes on the board: below the lowest one in the first column with room, or a new column */
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

    private _openMenu(anchor: HTMLElement, title: string, choose: (store: string) => void, current?: string) {
        const open = this._menu?.dataset.anchor === title + anchor.className
        this._closeMenu()
        if (open) return
        const menu = el('div', 'snp-menu')
        menu.dataset.anchor = title + anchor.className
        menu.appendChild(el('div', 'snp-menu-title', title))
        for (const store of this._notes?.stores ?? []) {
            const b = button(store.label, '', () => {
                this._closeMenu()
                choose(store.id)
            })
            if (store.id === current) b.classList.add('on')
            menu.appendChild(b)
        }
        this.element.appendChild(menu)
        // below the button, or above it when there is no room below (the dock at the bottom); inside the canvas
        const r = anchor.getBoundingClientRect?.()
        const p = this.element.getBoundingClientRect?.()
        if (r && p) {
            const h = menu.offsetHeight, w = menu.offsetWidth
            let top = r.bottom - p.top + 4
            if (top + h > this.element.clientHeight) top = r.top - p.top - h - 4
            menu.style.left = Math.round(Math.max(0, Math.min(r.left - p.left, this.element.clientWidth - w))) + 'px'
            menu.style.top = Math.round(Math.max(0, top)) + 'px'
        }
        this._menu = menu
        document.addEventListener('pointerdown', this._pointerOutside, true)
    }

    private _closeMenu() {
        document.removeEventListener('pointerdown', this._pointerOutside, true)
        this._menu?.remove()
        this._menu = undefined
    }

    /** A press outside the menu closes it, but not one on a button that opens a menu: its click toggles it */
    private _pointerOutside = (e: Event) => {
        const t = e.target as HTMLElement
        if (this._menu?.contains(t) || t?.closest?.('.snp-add-to, .snp-badge')) return
        this._closeMenu()
    }

    private _readState(): StickyState {
        try {
            return JSON.parse(localStorage.getItem(this.storageKey) || '{}') || {}
        } catch (e) {
            return {} // no storage, or not JSON
        }
    }

    private _writeState() {
        if (this._notes) this._state.order = this._order()
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
