import {AViewerPluginSync, createStyles, onChange, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import {NoteItem, NotesPlugin} from './NotesPlugin'
import styles from './StickyNotesUiPlugin.css?inline'

/**
 * How the post-its are laid out over the canvas:
 * - `board`: each note is its own post-it, moved and sized on its own; "Arrange" puts them in columns;
 * - `stack`: the post-its lie on a pile, each one a little to the left of and above the one on it; a click on one
 *   behind brings it to the top, and the pile moves and sizes as one;
 * - `minimized`: the post-its are off the canvas; one button with the number of notes stays in the dock, and a click
 *   on it brings back the layout from before.
 */
export type StickyNotesLayout = 'board' | 'stack' | 'minimized'
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
    /** The layout that the button of `minimized` brings back */
    open?: Exclude<StickyNotesLayout, 'minimized'>
    color?: StickyNotesColor
    shown?: boolean
    /** The place and size of the pile */
    stack?: Box
    /** The post-it of each note in the board layout, by note id */
    board?: Record<string, Box>
    /** The note ids from the bottom to the top: the order of the board and of the pile */
    order?: string[]
}

/** The size of the canvas, in px */
interface Size {
    width: number
    height: number
}

/** A column of the board: the bottom of its lowest post-it with the gap under it, and its widest post-it */
interface Column {
    bottom: number
    w: number
}

/** The post-it of one note */
interface NoteCard {
    note: NoteItem
    card: HTMLDivElement
    /** Where the note is kept, + Context, Copy, ×; the post-it is dragged by it */
    bar: HTMLDivElement
    badge: HTMLButtonElement
    text: HTMLTextAreaElement
    /** The store of the note when it was last shown: a change is a move */
    store: string
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
/** When the board has no room for one more column, its columns start again this much lower and to the right, in px */
const LAYER_STEP = 24

/**
 * Sticky Notes UI Plugin
 *
 * Shows the notes of {@link NotesPlugin} as post-its over the canvas, in one of two layouts
 * ({@link StickyNotesLayout}): `board` (a post-it per note) or `stack` (a pile); `minimized` takes them off the
 * canvas. The buttons at the bottom left add a note, arrange the board, switch the layout and minimise; when minimised,
 * one button with the number of notes brings them back.
 *
 * - "+ Note" adds a note at once, in the store of new notes ({@link NotesPlugin.defaultStore}); "▾" picks another
 *   store. The badge on a note shows its store; a click moves the note to another store.
 * - Each note has "+ Context" (the time and the selection, {@link NotesPlugin.contextLine}), "Copy" and "×".
 * - Drag a post-it by its bar, and size it from its bottom right corner. A click on a post-it brings it up.
 * - The places, the sizes, the order, the layout and the colour are kept in `localStorage` ({@link storageKey}), not in
 *   the file.
 *
 * The post-its fill the nearest positioned ancestor of the layer, so the viewer container must be positioned (for
 * example `position: relative`) for the post-its to stay inside the canvas. The post-its and the dock are above the
 * loading screen and below the bars of the editor; their menus are in a second layer, with the popups of the page.
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

    /** The layer over the canvas that holds the post-its and the dock */
    readonly element: HTMLDivElement

    /**
     * The buttons at the bottom left of the canvas: "+ Note", "▾", "Arrange", the layout and "Minimise" (in the
     * `minimized` layout, the button that brings the post-its back). Place it with its style
     * when the corner is taken, e.g. `dock.style.bottom = '64px'`; the pile starts above it.
     */
    readonly dock: HTMLDivElement

    private _notes?: NotesPlugin
    /** The box of the post-its in {@link element}: the dock is above all of them, however many there are */
    private _cardsBox: HTMLDivElement
    /** The layer of the menus, next to {@link element}: at the level of the popups of the page, above its bars */
    private _popups: HTMLDivElement
    private _cards = new Map<string, NoteCard>()
    /** The post-it of each card element, for the ResizeObserver */
    private _byElement = new WeakMap<Element, NoteCard>()
    /** A write of the state that waits for the end of a size change from a corner */
    private _writeTimer = 0
    private _state: StickyState
    private _arrangeButton: HTMLButtonElement
    private _layoutButton: HTMLButtonElement
    /** The buttons of the dock that show when the post-its are on the canvas */
    private _openButtons: HTMLButtonElement[]
    /** The button of the `minimized` layout: the number of notes; a click brings back the layout from before */
    private _restoreButton: HTMLButtonElement
    private _menu?: HTMLDivElement
    /** The button that opened the menu: a click on it again closes the menu */
    private _menuAnchor?: HTMLElement
    private _ready = false
    /**
     * Watches the layer (the canvas changes size, also without a window resize) and each post-it (a size from its
     * corner)
     */
    private _resizer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
        for (const {target} of entries) {
            if (target === this.element) {
                this._onResize()
                continue
            }
            const c = this._byElement.get(target)
            if (c) this._cardResized(c)
        }
    })

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Sticky Notes',
        children: [
            {type: 'checkbox', label: 'Show', property: [this, 'shown']},
            {
                type: 'dropdown', label: 'Layout', property: [this, 'layout'],
                children: [{label: 'Board: a post-it per note', value: 'board'}, {label: 'Stack: a pile', value: 'stack'}, {label: 'Minimised: off the canvas', value: 'minimized'}],
            },
            {
                type: 'dropdown', label: 'Colour', property: [this, 'color'],
                children: (['yellow', 'pink', 'blue', 'green', 'theme'] as const).map(c => ({label: c[0].toUpperCase() + c.slice(1), value: c})),
            },
            {type: 'button', label: 'Arrange', value: () => this.arrange(), hidden: () => this.layout !== 'board'},
            {type: 'button', label: 'Reset places', value: () => this.resetPlaces()},
        ],
    }

    /**
     * @param storageKey - the `localStorage` key of the layout, the colour, the places, the sizes and the order
     * @param startMinimized - the post-its start minimized on each page load, so they do not cover the canvas; the button
     * of the dock brings back the layout that the person set last. `false`: they start in that layout.
     */
    constructor(storageKey = 'threepipe-sticky-notes', startMinimized = true) {
        super()
        this.storageKey = storageKey
        if (StickyNotesUiPlugin.InjectStyles && !StickyNotesUiPlugin._styles?.isConnected) StickyNotesUiPlugin._styles = createStyles(styles)
        this.element = el('div', 'snp-layer')
        this._cardsBox = el('div', 'snp-cards')
        this._popups = el('div', 'snp-layer snp-popups')
        this.dock = el('div', 'snp-dock')
        const add = button('+ Note', 'Add a note', () => this.addNote(), 'snp-add')
        const pick = button('▾', 'Add a note in…', () => this._openMenu(pick, 'New note in', id => this.addNote(id), this._notes?.defaultStore), 'snp-add-to')
        this._arrangeButton = button('Arrange', 'Put the post-its in columns', () => this.arrange())
        this._layoutButton = button('', '', () => this.layout = this.layout === 'board' ? 'stack' : 'board')
        const minimize = button('Minimise', 'Take the post-its off the canvas', () => this.layout = 'minimized', 'snp-min')
        this._restoreButton = button('', 'Put the post-its back on the canvas', () => this._restore(), 'snp-restore')
        this._openButtons = [add, pick, this._layoutButton, minimize]
        for (const b of [add, pick, this._arrangeButton, this._layoutButton, minimize, this._restoreButton]) this.dock.appendChild(b)
        this.element.appendChild(this._cardsBox)
        this.element.appendChild(this.dock)
        // a focus (the cursor in a note, a phone keyboard) can scroll a box that hides its overflow: the post-its would
        // move away from their places and not come back
        this.element.addEventListener('scroll', () => this.element.scrollTop = this.element.scrollLeft = 0)
        // the post-its, the dock and the menus keep their pointer and wheel from the viewer under them
        for (const layer of [this.element, this._popups]) {
            layer.addEventListener('pointerdown', e => e.stopPropagation())
            layer.addEventListener('wheel', e => e.stopPropagation())
        }
        this._state = this._readState()
        this.layout = this._state.layout ?? this.layout
        this.color = this._state.color ?? this.color
        this.shown = this._state.shown ?? this.shown
        if (this.layout !== 'minimized') this._state.open = this.layout
        // this load only: the stored layout stays for the button of the dock (no state write before _ready)
        if (startMinimized) this.layout = 'minimized'
        this._ready = true
        this._applyLook()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._notes = viewer.getPlugin(NotesPlugin)
        this._notes?.addEventListener('notesChanged', this._onNotesChanged)
        this._notes?.addEventListener('storeStatusChanged', this._onStatus)
        viewer.container.appendChild(this.element)
        viewer.container.appendChild(this._popups)
        // the post-its stay inside the canvas when it changes size; without a ResizeObserver, on a window resize
        if (this._resizer) this._resizer.observe(this.element)
        else window.addEventListener('resize', this._onResize)
        this._sync()
    }

    onRemove(viewer: ThreeViewer) {
        this._notes?.removeEventListener('notesChanged', this._onNotesChanged)
        this._notes?.removeEventListener('storeStatusChanged', this._onStatus)
        window.removeEventListener('resize', this._onResize)
        if (this._writeTimer) this._writeState()
        this._closeMenu()
        this._resizer?.disconnect()
        for (const c of this._cards.values()) c.card.remove()
        this._cards.clear()
        this.element.remove()
        this._popups.remove()
        this._notes = undefined
        super.onRemove(viewer)
    }

    /** Makes a note on top, with the cursor in it ({@link NotesPlugin.defaultStore} when no store is named) */
    addNote(store?: string) {
        this._closeMenu()
        if (this.layout === 'minimized') this._restore()
        const note = this._notes?.addNote('', store)
        if (note) this._cards.get(note.id)?.text.focus({preventScroll: true})
        return note
    }

    /** Brings the post-it of a note to the top (of the board, or of the pile) */
    bringToTop(id: string) {
        const order = this._order()
        if (order[order.length - 1] === id) return
        this._setOrder([...order.filter(o => o !== id), id])
        this._writeState()
        this._layoutCards(true)
    }

    /**
     * Puts the post-its of the board in columns from the top left corner, from the bottom one to the top one, inside
     * the canvas and above the dock, as new post-its are placed
     */
    arrange() {
        const board: Record<string, Box> = {}
        const size = this._size(), bottom = this._boardBottom(size)
        const columns = new Map<number, Column>()
        for (const id of this._order()) {
            const old = this._state.board?.[id] ?? {}
            board[id] = {...old, ...this._nextPlace(columns, size.width, bottom, old.w, old.h)}
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
        if (this.layout === 'minimized') this._closeMenu()
        else this._state.open = this.layout
        this._state.layout = this.layout
        this._state.color = this.color
        this._state.shown = this.shown
        this._writeState()
        this._applyLook()
        this._layoutCards(true)
        this.uiConfig.uiRefresh?.(true)
    }

    /** The layout from before `minimized` */
    private _restore() {
        this.layout = this._state.open ?? 'board'
    }

    private _applyLook() {
        const minimized = this.layout === 'minimized'
        this.element.dataset.color = this._popups.dataset.color = this.color
        this.element.dataset.layout = this.layout
        this.element.style.display = this._popups.style.display = this.shown ? '' : 'none'
        for (const b of this._openButtons) b.style.display = minimized ? 'none' : ''
        this._restoreButton.style.display = minimized ? '' : 'none'
        this._showCount()
        this._arrangeButton.style.display = this.layout === 'board' ? '' : 'none'
        this._layoutButton.textContent = this.layout === 'board' ? 'Stack' : 'Spread'
        this._layoutButton.title = this.layout === 'board' ? 'Put the post-its on a pile' : 'A post-it per note on the board'
    }

    private _onNotesChanged = (e: {change: string, note?: NoteItem, notes?: NoteItem[]}) => {
        const c = e.change === 'update' && e.note ? this._cards.get(e.note.id) : undefined
        if (c && e.note) {
            // typing: only its post-it changes; a move to another store can change the order of the pile
            if (this._showNote(c, e.note)) this._layoutCards(false)
            return
        }
        if (e.change === 'remove') {
            // the removed notes forget their places and depths; notes that are not loaded yet keep theirs. An event
            // that names no notes removes those of every note that is not there.
            const removed = e.note ? [e.note] : e.notes
            const ids = new Set((removed ?? this._notes?.notes ?? []).map(n => n.id))
            const gone = removed ? (id: string) => ids.has(id) : (id: string) => !ids.has(id)
            if (this._state.board) for (const id of Object.keys(this._state.board)) if (gone(id)) delete this._state.board[id]
            if (this._state.order) this._state.order = this._state.order.filter(id => !gone(id))
            this._writeState()
        }
        this._sync(e.change === 'add' ? e.note?.id : undefined)
    }

    private _onStatus = (e: {store: string}) => {
        for (const c of this._cards.values()) if (c.note.store === e.store) this._updateBadge(c)
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
                this._cardsBox.appendChild(c.card)
                if (note.id === added) c.card.classList.add('snp-new')
            }
            this._showNote(c, note)
        }
        // a note made now goes on top
        if (added) this._setOrder([...this._order().filter(o => o !== added), added])
        this._showCount()
        // the order with the new note on top is saved (in the stack layout, nothing else saves it)
        if (!this._layoutCards(!!added) && added) this._writeState()
    }

    /** The number of notes on the button of the `minimized` layout */
    private _showCount() {
        this._restoreButton.textContent = 'Notes · ' + (this._notes?.notes.length ?? 0)
    }

    /** Shows the text and the store of a note on its post-it. Returns true when the note moved to another store. */
    private _showNote(c: NoteCard, note: NoteItem) {
        const moved = c.store !== note.store
        c.note = note
        c.store = note.store
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
        return moved
    }

    /** The note ids from the bottom to the top, with the notes not in the stored order on top */
    private _order() {
        const ids = this._notes?.notes.map(n => n.id) ?? []
        const all = new Set(ids)
        const known = new Set((this._state.order ?? []).filter(id => all.has(id)))
        return [...known, ...ids.filter(id => !known.has(id))]
    }

    /**
     * Keeps a new order of the loaded notes (from the bottom to the top). The ids of notes that are not loaded yet (a
     * store that still loads) stay in their places among them, so the pile comes back as it was when they load.
     */
    private _setOrder(order: string[]) {
        const loaded = new Set(this._notes?.notes.map(n => n.id))
        const kept: string[] = []
        let i = 0
        for (const id of this._state.order ?? []) {
            if (!loaded.has(id)) kept.push(id)
            else if (i < order.length) kept.push(order[i++])
        }
        kept.push(...order.slice(i))
        this._state.order = kept
    }

    /**
     * Sets the place, size and depth of every post-it for the layout. `animate`: they glide there. Returns true when
     * it saved the state (places for new post-its on the board).
     */
    private _layoutCards(animate: boolean): boolean {
        this.element.classList.toggle('snp-instant', !animate)
        if (this.layout === 'minimized') return false // off the canvas: laid out when they come back
        const order = this._order()
        // read once: a read after the style writes below would lay out the page again for each post-it
        const size = this._size()
        if (this.layout === 'stack') {
            const pile = this._pileBox(size)
            order.forEach((id, i) => {
                const c = this._cards.get(id)
                if (!c) return
                const depth = order.length - 1 - i
                const d = Math.min(depth, PILE_DEPTH)
                this._setBox(c, {x: pile.x - d * PILE_STEP, y: pile.y - d * PILE_STEP, w: pile.w, h: pile.h})
                c.card.style.zIndex = String(i + 1)
                c.card.style.transform = depth ? `rotate(${depth % 2 ? 1.2 : -0.9}deg)` : ''
                c.card.style.visibility = depth > PILE_DEPTH ? 'hidden' : ''
                c.card.classList.toggle('snp-behind', depth > 0)
            })
        } else {
            const board = this._state.board ??= {}
            const bottom = this._boardBottom(size)
            let columns: Map<number, Column> | undefined
            order.forEach((id, i) => {
                const c = this._cards.get(id)
                if (!c) return
                if (!board[id]) board[id] = this._nextPlace(columns ??= this._columns(board), size.width, bottom)
                this._setBox(c, this._clamp(board[id], size))
                c.card.style.zIndex = String(i + 1)
                c.card.style.transform = ''
                c.card.style.visibility = ''
                c.card.classList.remove('snp-behind')
            })
            if (columns) {
                this._writeState()
                return true
            }
        }
        return false
    }

    /** The lowest edge of a post-it placed on the board: above the dock */
    private _boardBottom(size: Size) {
        return Math.min(size.height, this.dock.offsetTop || size.height) - GAP
    }

    /** The size of the canvas, in px */
    private _size(): Size {
        return {width: this.element.clientWidth || 800, height: this.element.clientHeight || 600}
    }

    /**
     * The place and size of the top post-it of the pile, as shown: above the dock, or where the person put it. The
     * post-its under it lie toward -x and -y, so it keeps room for them inside the canvas.
     */
    private _pileBox(size = this._size()): Required<Box> {
        const s = this._state.stack ?? {}
        const w = s.w ?? NOTE_W + 40, h = s.h ?? NOTE_H + 40
        const spread = Math.min(Math.max(this._cards.size - 1, 0), PILE_DEPTH) * PILE_STEP
        // above the dock, where it is; the post-it at the bottom of the pile at the left edge of the dock
        const dockTop = this.dock.offsetTop || size.height - 40
        // the pile without its spread is kept inside the canvas less the spread
        const inner = {width: size.width - spread, height: size.height - spread}
        const box = this._clamp({x: (s.x ?? GAP + spread) - spread, y: (s.y ?? dockTop - h - GAP) - spread, w, h}, inner)
        return {x: (box.x ?? 0) + spread, y: (box.y ?? 0) + spread, w: box.w ?? w, h: box.h ?? h}
    }

    /**
     * A box as shown inside the canvas: no larger than the canvas, and moved inside it. The size kept in the state
     * stays the one the person gave, so a larger canvas shows it again.
     */
    private _clamp(box: Box, {width, height} = this._size()): Box {
        const w = Math.min(box.w ?? NOTE_W, width), h = Math.min(box.h ?? NOTE_H, height)
        return {
            ...box,
            x: Math.min(Math.max(0, box.x ?? GAP), Math.max(0, width - w)),
            y: Math.min(Math.max(0, box.y ?? GAP), Math.max(0, height - h)),
            w, h,
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
        const c: NoteCard = {note, card, bar, badge, text, store: note.store, size: [NOTE_W, NOTE_H]}
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
        this._byElement.set(card, c)
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

    /** Shows the store of the note and its state on the badge; writes to the page only what changed */
    private _updateBadge(c: NoteCard) {
        const status = this._notes?.storeStatus(c.note.store) ?? '', label = this._storeLabel(c.note.store)
        if (c.badge.textContent === label && c.badge.dataset.status === status) return
        c.badge.textContent = label
        c.badge.title = 'Where the note is kept' + (status === 'error' ? ': it could not be saved or loaded' : '') + '. Click to move it.'
        c.badge.dataset.status = status
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
            const size = this._size()
            const start = stack ? this._pileBox(size) : this._clamp(this._state.board?.[c.note.id] ?? {}, size)
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
                if (stack) {
                    this._state.stack = {...this._state.stack, x, y}
                    this._layoutCards(false)
                } else {
                    // only this post-it moves: it is on top already (the press brought it up)
                    const box = (this._state.board ??= {})[c.note.id] = {...this._state.board?.[c.note.id], x, y}
                    this._setBox(c, this._clamp(box, size))
                }
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
                    const board = this._state.board ??= {}
                    // the place kept is the one shown, the size the one the person gave
                    const {x, y} = this._clamp(board[c.note.id] ?? {})
                    board[c.note.id] = {...board[c.note.id], x, y}
                }
                this._writeState()
            }
            bar.addEventListener('pointermove', move)
            bar.addEventListener('pointerup', end)
            bar.addEventListener('pointercancel', end)
            bar.addEventListener('lostpointercapture', end)
        })
    }

    /**
     * The person sized a post-it from its corner: its box (the pile's, in the stack layout) keeps the size. This runs
     * for each frame of the sizing; the state is written once, after it.
     */
    private _cardResized(c: NoteCard) {
        const w = c.card.offsetWidth, h = c.card.offsetHeight
        if (!w || !h) return // hidden (Show off, or the canvas hidden): not a size the person gave
        if (Math.abs(w - c.size[0]) < 2 && Math.abs(h - c.size[1]) < 2) return // the size the layout gave it
        c.size = [w, h]
        if (this.layout === 'stack') {
            this._state.stack = {...this._state.stack, w, h}
            this._layoutCards(false)
        } else {
            // only this post-it changes; it is not moved back inside the canvas with a glide
            this.element.classList.add('snp-instant')
            const box = (this._state.board ??= {})[c.note.id] = {...this._state.board?.[c.note.id], w, h}
            this._setBox(c, this._clamp(box))
        }
        clearTimeout(this._writeTimer)
        this._writeTimer = window.setTimeout(() => this._writeState(), 300)
    }

    /** The columns of the board: the post-its with the same left edge, by that edge */
    private _columns(board: Record<string, Box>) {
        const columns = new Map<number, Column>()
        for (const b of Object.values(board)) this._addToColumn(columns, b)
        return columns
    }

    private _addToColumn(columns: Map<number, Column>, b: Box) {
        const x = b.x ?? 0, col = columns.get(x)
        const bottom = (b.y ?? 0) + (b.h ?? NOTE_H) + GAP, w = b.w ?? NOTE_W
        columns.set(x, col ? {bottom: Math.max(col.bottom, bottom), w: Math.max(col.w, w)} : {bottom, w})
    }

    /**
     * Where a post-it of size `w` × `h` goes on the board (a new one, or one that "Arrange" places), inside the canvas
     * and above `bottom`: below the lowest one in the first column with room, or a new column. When no column has
     * room, the columns start again {@link LAYER_STEP} lower and to the right, over the others (a phone has room for
     * one column); when that has no room either, the top left corner. `columns` ({@link _columns}) gets the post-it,
     * so the next one goes below it.
     */
    private _nextPlace(columns: Map<number, Column>, width: number, bottom: number, w = NOTE_W, h = NOTE_H): Box {
        for (let o = 0; o === 0 || GAP + o + w <= width - GAP; o += LAYER_STEP) {
            let x = GAP + o, col = columns.get(x)
            while (col && col.bottom + h > bottom) {
                x += col.w + GAP
                col = columns.get(x)
            }
            if (x > GAP + o && x + w > width - GAP) continue // no room for this column
            const y = col ? col.bottom : GAP + o
            this._addToColumn(columns, {x, y, w, h})
            return {x, y}
        }
        return {x: GAP, y: GAP}
    }

    private _openMenu(anchor: HTMLElement, title: string, choose: (store: string) => void, current?: string) {
        const open = !!this._menu && this._menuAnchor === anchor
        this._closeMenu()
        if (open) return
        const menu = el('div', 'snp-menu')
        menu.appendChild(el('div', 'snp-menu-title', title))
        for (const store of this._notes?.stores ?? []) {
            const b = button(store.label, '', () => {
                this._closeMenu()
                choose(store.id)
            })
            if (store.id === current) b.classList.add('on')
            menu.appendChild(b)
        }
        this._popups.appendChild(menu)
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
        this._menuAnchor = anchor
        document.addEventListener('pointerdown', this._pointerOutside, true)
    }

    private _closeMenu() {
        document.removeEventListener('pointerdown', this._pointerOutside, true)
        this._menu?.remove()
        this._menu = undefined
        this._menuAnchor = undefined
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
        clearTimeout(this._writeTimer)
        this._writeTimer = 0
        if (this._notes) this._setOrder(this._order())
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
