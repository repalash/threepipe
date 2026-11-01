import {AViewerPluginSync, createStyles, onChange, raiseOnPress, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import {delegate, DelegateInstance} from 'tippy.js'
import {NoteItem, NotesPlugin} from './NotesPlugin'
import {addTooltipStyles, EDITOR_TOOLTIP_PROPS} from './tooltips'
import {readStored, writeStored} from './dom-utils'
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
    /** The move of the dock from its corner, where the person dragged it, in px */
    dock?: {x: number, y: number}
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
/** How long the copy button shows that the text was copied, in ms */
const COPIED_TIME = 1500

/** The icons of the buttons (24 px grid, drawn with the text colour; shown at 14 px, a 1.3 px line as the frame's icons) */
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const ICONS = {
    add: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    arrange: svg('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
    stack: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
    spread: svg('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'),
    minimize: svg('<path d="M5 12h14"/>'),
    notes: svg('<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>'),
    context: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    copy: svg('<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M16 4h2a2 2 0 0 1 2 2v4"/><path d="M21 14H11"/><path d="m15 10-4 4 4 4"/>'),
    copied: svg('<path d="M20 6 9 17l-5-5"/>'),
    delete: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
}
/** The icon of a store: `file`, `browser`, or a store of the app (a cloud) */
const STORE_ICONS: Record<string, string> = {
    file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
    browser: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/><path d="M6 4v4"/><path d="M10 4v4"/>'),
    other: svg('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>'),
}

/**
 * Sticky Notes UI Plugin
 *
 * Shows the notes of {@link NotesPlugin} as post-its over the canvas, in one of two layouts
 * ({@link StickyNotesLayout}): `board` (a post-it per note) or `stack` (a pile); `minimized` takes them off the
 * canvas. The icon buttons at the bottom left (each with a tooltip) add a note, pick the store of new notes, arrange
 * the board, switch the layout and minimise; when minimised, one button with the number of notes brings them back.
 *
 * - "Add a note" adds a note at once, in the store of new notes ({@link NotesPlugin.defaultStore}). The button next
 *   to it shows the icon of that store (a file, a browser window, a cloud for a store of the app); a click opens a menu
 *   of the stores.
 * - The icon on a note shows its store; a click opens the same menu, to move the note.
 * - Each note has "Add the time and the selection" ({@link NotesPlugin.contextLine}), "Copy the text" (the icon shows a
 *   check for a moment) and "Delete".
 * - "Add a note" opens the post-it by the dock: above it, or below it when the dock is at the top of the canvas. Notes
 *   added in code ({@link NotesPlugin.addNote}) go in the columns of {@link arrange}.
 * - Drag a post-it by its bar, and size it from its bottom right corner. A click on a post-it brings it up.
 * - Drag the dock by its handle (the dots at its left) or its free part, to move it out of the way; a double click there
 *   puts it back in its corner, as does "Reset places". The board and the pile keep their places above the corner.
 * - The places, the sizes, the order, the layout, the colour and the place of the dock are kept in `localStorage`
 *   ({@link storageKey}), not in the file.
 *
 * The post-its fill the nearest positioned ancestor of the layer, so the viewer container must be positioned (for
 * example `position: relative`) for the post-its to stay inside the canvas. The post-its and the dock are above the
 * loading screen and below the bars of the editor; their menus are in a second layer, with the popups of the page.
 *
 * The tooltips use tippy.js with the `editor` theme of the editor (its CSS is added with the styles, see
 * {@link InjectStyles}).
 *
 * The plugin's UI folder (Sticky Notes) has the settings: show, layout, colour, arrange, reset the places.
 *
 * @category Plugins
 */
export class StickyNotesUiPlugin extends AViewerPluginSync {
    static readonly PluginType = 'StickyNotesUiPlugin'
    /**
     * Adds the stylesheet of the notes and of the tooltips to the page when the first plugin is made. Off: the page
     * styles the `snp-` classes and the tooltips.
     */
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
     * The buttons at the bottom left of the canvas, after a drag handle: add a note, the store of new notes, arrange,
     * the layout and minimise (in the `minimized` layout, the button that brings the post-its back). Place it with its
     * style when the corner is taken, e.g. `dock.style.bottom = '56px'`; the pile starts above it. The person can drag
     * it elsewhere: that move is its `transform`, so do not set one.
     */
    readonly dock: HTMLDivElement

    private _notes?: NotesPlugin
    /** The box of the post-its in {@link element}: the dock is above all of them, however many there are */
    private _cardsBox: HTMLDivElement
    /** The layer of the menus, next to {@link element}: at the level of the popups of the page, above its bars */
    private _popups: HTMLDivElement
    private _unraise?: () => void
    private _cards = new Map<string, NoteCard>()
    /** The post-it of each card element, for the ResizeObserver */
    private _byElement = new WeakMap<Element, NoteCard>()
    /** A write of the state that waits for the end of a size change from a corner */
    private _writeTimer = 0
    private _state: StickyState
    private _storeButton: HTMLButtonElement
    private _arrangeButton: HTMLButtonElement
    private _layoutButton: HTMLButtonElement
    /** The buttons of the dock that show when the post-its are on the canvas */
    private _openButtons: HTMLButtonElement[]
    /** The button of the `minimized` layout: the number of notes; a click brings back the layout from before */
    private _restoreButton: HTMLButtonElement
    /** The number of notes on {@link _restoreButton} */
    private _count: HTMLSpanElement
    /** The tooltips of the buttons on the layer (their text is in `data-tip`) */
    private _tips?: DelegateInstance
    private _menu?: HTMLDivElement
    /** The button that opened the menu: a click on it again closes the menu */
    private _menuAnchor?: HTMLElement
    private _ready = false
    /** A note that is made now comes from "Add a note": its post-it opens by the dock */
    private _addAtDock = false
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
        if (StickyNotesUiPlugin.InjectStyles) {
            if (!StickyNotesUiPlugin._styles?.isConnected) StickyNotesUiPlugin._styles = createStyles(styles)
            addTooltipStyles()
        }
        this.element = el('div', 'snp-layer')
        this._cardsBox = el('div', 'snp-cards')
        this._popups = el('div', 'snp-layer snp-popups')
        this.dock = el('div', 'snp-dock')
        const grip = this.dock.appendChild(el('div', 'snp-grip'))
        grip.dataset.tip = 'Drag to move the buttons; double-click to put them back'
        const add = button(ICONS.add, 'Add a note', () => this.addNote(), 'snp-add')
        this._storeButton = button('', '', () => this._openMenu(this._storeButton, 'Save new notes in', id => this._setDefaultStore(id), this._notes?.defaultStore), 'snp-store')
        this._arrangeButton = button(ICONS.arrange, 'Arrange the post-its in columns', () => this.arrange())
        this._layoutButton = button('', '', () => this.layout = this.layout === 'board' ? 'stack' : 'board')
        const minimize = button(ICONS.minimize, 'Minimise: take the post-its off the canvas', () => this.layout = 'minimized', 'snp-min')
        this._restoreButton = button(ICONS.notes, 'Show the notes', () => this._restore(), 'snp-restore')
        this._count = this._restoreButton.appendChild(el('span', 'snp-count'))
        this._openButtons = [add, this._storeButton, this._layoutButton, minimize]
        for (const b of [add, this._storeButton, this._arrangeButton, this._layoutButton, minimize, this._restoreButton]) this.dock.appendChild(b)
        this.element.appendChild(this._cardsBox)
        this.element.appendChild(this.dock)
        this._draggableDock()
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
        this._notes?.addEventListener('notesChange', this._onNotesChanged)
        this._notes?.addEventListener('storeStatusChange', this._onStatus)
        this._notes?.addEventListener('defaultStoreChange', this._onDefaultStore)
        viewer.container.appendChild(this.element)
        viewer.container.appendChild(this._popups)
        // a press on a post-it or the dock brings the notes above other panels (the open perf card)
        this._unraise = raiseOnPress(this.element)
        // one tooltip for each button with a data-tip, read when it shows (the layout and store buttons change it);
        // in the viewer container, so it shows in full screen too, and inside it (the buttons of a post-it at the top
        // of the canvas show theirs below, not under the bars of the page)
        this._tips = delegate(this.element, {
            ...EDITOR_TOOLTIP_PROPS, target: '[data-tip]', appendTo: () => viewer.container,
            popperOptions: {modifiers: [{name: 'flip', options: {boundary: viewer.container}}]},
            onShow: tip => {
                const text = (tip.reference as HTMLElement).dataset.tip
                if (!text || this.element.classList.contains('snp-dragging')) return false
                tip.setContent(text)
            },
        })
        // the post-its stay inside the canvas when it changes size; without a ResizeObserver, on a window resize
        if (this._resizer) this._resizer.observe(this.element)
        else window.addEventListener('resize', this._onResize)
        this._showStore()
        this._placeDock()
        this._sync()
    }

    onRemove(viewer: ThreeViewer) {
        this._notes?.removeEventListener('notesChange', this._onNotesChanged)
        this._notes?.removeEventListener('storeStatusChange', this._onStatus)
        this._notes?.removeEventListener('defaultStoreChange', this._onDefaultStore)
        window.removeEventListener('resize', this._onResize)
        if (this._writeTimer) this._writeState()
        this._closeMenu()
        this._tips?.destroy()
        this._tips = undefined
        this._resizer?.disconnect()
        for (const c of this._cards.values()) c.card.remove()
        this._cards.clear()
        this._unraise?.()
        this._unraise = undefined
        this.element.remove()
        this._popups.remove()
        this._notes = undefined
        super.onRemove(viewer)
    }

    /**
     * Makes a note on top, with the cursor in it ({@link NotesPlugin.defaultStore} when no store is named). On the
     * board, its post-it opens by the dock (above it, or below it when the dock is at the top), inside the canvas.
     */
    addNote(store?: string) {
        this._closeMenu()
        if (this.layout === 'minimized') this._restore()
        this._addAtDock = true
        let note: NoteItem | undefined
        try {
            note = this._notes?.addNote('', store)
        } finally {
            this._addAtDock = false
        }
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

    /** Forgets the places and sizes: the board is arranged again, the pile and the dock go back to their corner */
    resetPlaces() {
        this._state.stack = {}
        this._state.board = {}
        this._state.dock = undefined
        this._placeDock()
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
        const board = this.layout === 'board'
        this._layoutButton.innerHTML = board ? ICONS.stack : ICONS.spread
        setTip(this._layoutButton, board ? 'Stack: put the post-its on a pile' : 'Spread: a post-it per note on the board')
        this._showStore()
        this._placeDock() // another number of buttons: another width
    }

    /** The icon and tooltip of the store of new notes; hidden with one store */
    private _showStore() {
        const stores = this._notes?.stores ?? [], store = this._notes?.defaultStore ?? ''
        this._storeButton.innerHTML = storeIcon(store)
        setTip(this._storeButton, 'New notes: ' + this._storeLabel(store))
        if (this.layout !== 'minimized') this._storeButton.style.display = stores.length > 1 ? '' : 'none'
    }

    private _setDefaultStore(id: string) {
        if (this._notes) this._notes.defaultStore = id // its defaultStoreChange shows it
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
        this._showStore() // a store added by the app
    }

    private _onDefaultStore = () => this._showStore()

    private _onResize = () => {
        this._placeDock()
        this._layoutCards(false)
    }

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
        // a note made now goes on top; from "Add a note", on the board, by the dock
        if (added) this._setOrder([...this._order().filter(o => o !== added), added])
        if (added && this._addAtDock && this.layout === 'board') (this._state.board ??= {})[added] = this._placeByDock()
        this._showCount()
        // the order with the new note on top is saved (in the stack layout, nothing else saves it)
        if (!this._layoutCards(!!added) && added) this._writeState()
    }

    /** The number of notes on the button of the `minimized` layout */
    private _showCount() {
        this._count.textContent = String(this._notes?.notes.length ?? 0)
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

    /**
     * Where a post-it from "Add a note" goes: at the left edge of the dock as shown (dragged or not), above it, or below
     * it when there is no room above; inside the canvas
     */
    private _placeByDock(): Box {
        const d = this.dock, move = this._placeDock(), size = this._size()
        const left = d.offsetLeft + move.x, top = d.offsetTop + move.y
        const above = top - GAP - NOTE_H
        const {x, y} = this._clamp({x: left, y: above >= 0 ? above : top + d.offsetHeight + GAP}, size)
        return {x, y}
    }

    /**
     * Moves the dock from its corner to where the person dragged it ({@link StickyState.dock}), inside the canvas (the
     * kept move stays, so a larger canvas shows it there again). Returns the move shown.
     */
    private _placeDock() {
        const d = this.dock, move = this._state.dock
        if (!move) {
            d.style.transform = ''
            return {x: 0, y: 0}
        }
        const {width, height} = this._size()
        const x = within(move.x, -d.offsetLeft, width - d.offsetWidth - d.offsetLeft)
        const y = within(move.y, -d.offsetTop, height - d.offsetHeight - d.offsetTop)
        d.style.transform = `translate(${x}px, ${y}px)`
        return {x, y}
    }

    /**
     * Drags the dock by its handle or its free part (a press on a button is a click), after {@link DRAG_START} px. A
     * double click there puts it back in its corner.
     */
    private _draggableDock() {
        const dock = this.dock
        const onButton = (e: Event) => !!(e.target as HTMLElement).closest?.('button')
        dock.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0 || onButton(e)) return
            e.preventDefault()
            this._closeMenu()
            const start = this._placeDock()
            trackDrag(dock, e, (dx, dy) => {
                this._state.dock = {x: start.x + dx, y: start.y + dy}
                this._placeDock()
            }, () => {
                this._state.dock = this._placeDock() // the place kept is the one shown
                this._writeState()
            }, this.element)
        })
        dock.addEventListener('dblclick', (e: MouseEvent) => {
            if (onButton(e)) return
            this._state.dock = undefined
            this._placeDock()
            this._writeState()
        })
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
        const badge = el('button', 'snp-icon snp-badge') as HTMLButtonElement
        const text = el('textarea', '') as HTMLTextAreaElement
        const c: NoteCard = {note, card, bar, badge, text, store: note.store, size: [NOTE_W, NOTE_H]}
        badge.addEventListener('click', () => this._openMenu(badge, 'Keep this note in', id => this._notes?.updateNote(c.note.id, {store: id}), c.note.store))
        bar.appendChild(badge)
        bar.appendChild(el('span', 'snp-fill'))
        bar.appendChild(button(ICONS.context, 'Add the time and the selection', () => this._addContext(c), 'snp-tool'))
        const copy = bar.appendChild(button(ICONS.copy, 'Copy the text', () => void this._copy(c, copy), 'snp-tool'))
        bar.appendChild(button(ICONS.delete, 'Delete the note', () => this._notes?.removeNote(c.note.id), 'snp-tool snp-delete'))
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

    /**
     * Copies the text of a note. After the write, the button shows a check and the tooltip "Copied" for
     * {@link COPIED_TIME} (a click hides a tooltip, and the copy has no other sign); when the page has no clipboard
     * access (an insecure page, a denied permission), it says that instead.
     */
    private async _copy(c: NoteCard, b: HTMLButtonElement) {
        try {
            if (!navigator.clipboard) throw new Error('No clipboard')
            await navigator.clipboard.writeText(c.text.value)
        } catch (e) {
            this._flash(b, ICONS.copy, 'Could not copy: no clipboard access')
            return
        }
        this._flash(b, ICONS.copied, 'Copied')
    }

    /** Shows an icon and a tooltip on a copy button for {@link COPIED_TIME}, then its own again */
    private _flash(b: HTMLButtonElement, icon: string, tip: string) {
        b.innerHTML = icon
        setTip(b, tip)
        // the tooltip of the delegate, made on the first hover; shown after the click that hid it
        const tippy = (b as {_tippy?: {setContent(t: string): void, show(): void}})._tippy
        setTimeout(() => {
            tippy?.setContent(tip)
            tippy?.show()
        })
        clearTimeout(Number(b.dataset.timer))
        b.dataset.timer = String(setTimeout(() => {
            b.innerHTML = ICONS.copy
            setTip(b, 'Copy the text')
            tippy?.setContent('Copy the text')
        }, COPIED_TIME))
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
        const store = c.note.store, status = this._notes?.storeStatus(store) ?? ''
        if (c.badge.dataset.store === store && c.badge.dataset.status === status) return
        c.badge.innerHTML = storeIcon(store)
        setTip(c.badge, 'This note: ' + this._storeLabel(store) + (status === 'error' ? ' (it could not be saved or loaded)' : ''))
        c.badge.dataset.store = store
        c.badge.dataset.status = status
    }

    /** Drags a post-it by its bar (the pile, in the stack layout), after {@link DRAG_START} px */
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
            trackDrag(bar, e, (dx, dy) => {
                c.card.classList.add('snp-lifted')
                const x = (start.x ?? 0) + dx, y = (start.y ?? 0) + dy
                if (stack) {
                    this._state.stack = {...this._state.stack, x, y}
                    this._layoutCards(false)
                } else {
                    // only this post-it moves: it is on top already (the press brought it up)
                    const box = (this._state.board ??= {})[c.note.id] = {...this._state.board?.[c.note.id], x, y}
                    this._setBox(c, this._clamp(box, size))
                }
            }, () => {
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
            }, this.element, () => c.card.classList.remove('snp-lifted'))
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
            const b = textButton('', () => {
                this._closeMenu()
                choose(store.id)
            })
            b.innerHTML = storeIcon(store.id)
            b.appendChild(el('span', '', store.label))
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
        if (this._menu?.contains(t) || t?.closest?.('.snp-store, .snp-badge')) return
        this._closeMenu()
    }

    private _readState(): StickyState {
        try {
            return JSON.parse(readStored(this.storageKey) || '{}') || {}
        } catch (e) {
            return {} // not JSON
        }
    }

    private _writeState() {
        clearTimeout(this._writeTimer)
        this._writeTimer = 0
        if (this._notes) this._setOrder(this._order())
        writeStored(this.storageKey, JSON.stringify(this._state))
    }
}

/**
 * Follows a press on `handle` that moves at least {@link DRAG_START} px: `move` gets the distance from the press each
 * time, `end` runs after a drag (not after a click), `release` after any press. The pointer is captured on the handle, so
 * the drag goes on outside it, and it ends on release, cancel or a lost capture. `layer` has `snp-dragging` during a
 * drag (the grabbing cursor, no tooltips).
 */
function trackDrag(handle: HTMLElement, e: PointerEvent, move: (dx: number, dy: number) => void, end: () => void, layer: HTMLElement, release?: () => void) {
    const sx = e.clientX, sy = e.clientY
    let moving = false
    handle.setPointerCapture?.(e.pointerId)
    const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy
        if (!moving && Math.abs(dx) + Math.abs(dy) < DRAG_START) return
        if (!moving) layer.classList.add('snp-dragging')
        moving = true
        move(dx, dy)
    }
    const onEnd = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onEnd)
        handle.removeEventListener('pointercancel', onEnd)
        handle.removeEventListener('lostpointercapture', onEnd)
        layer.classList.remove('snp-dragging')
        release?.()
        if (moving) end()
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
    handle.addEventListener('lostpointercapture', onEnd)
}

/** v between min and max; min when the range is empty (a dock wider than the canvas keeps its left edge inside) */
function within(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v))
}

/** An element with a class and a text */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    if (className) e.className = className
    if (text) e.textContent = text
    return e
}

/** A button with a text and a click (the menus) */
function textButton(text: string, click: () => void, className = ''): HTMLButtonElement {
    const b = el('button', className, text)
    b.addEventListener('click', click)
    return b
}

/** An icon button with a tooltip and a click */
function button(icon: string, tip: string, click: () => void, className = ''): HTMLButtonElement {
    const b = textButton('', click, className ? 'snp-icon ' + className : 'snp-icon')
    b.innerHTML = icon
    if (tip) setTip(b, tip)
    return b
}

/** The tooltip of a button (shown by the delegate of the layer) and its name for a screen reader */
function setTip(b: HTMLElement, tip: string) {
    b.dataset.tip = tip
    b.setAttribute('aria-label', tip)
}

function storeIcon(store: string) {
    return STORE_ICONS[store] ?? STORE_ICONS.other
}
