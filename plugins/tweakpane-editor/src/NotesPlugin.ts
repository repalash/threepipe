import {AViewerPluginEventMap, AViewerPluginSync, IObject3D, PickingPlugin, serialize, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'

/** One note */
export interface NoteItem {
    /** Unique in the plugin */
    id: string
    text: string
    /** The {@link NotesStore.id} of the store that keeps the note */
    store: string
    /** When the note was made, in ms since 1970 */
    created: number
}

/**
 * Where notes are kept. {@link NotesPlugin} has two stores: `file` (in the viewer config, so in an exported .glb) and
 * `browser` ({@link BrowserNotesStore}). An app adds others with {@link NotesPlugin.addStore}, for example a server
 * ({@link HttpNotesStore}) or its own backend.
 */
export interface NotesStore {
    /** Unique in the plugin, kept in {@link NoteItem.store} */
    readonly id: string
    /** The name in the UI, like "In the file" */
    readonly label: string
    /** The notes of this store. Called when the plugin is added to a viewer, or the store to the plugin. */
    load(): NoteItem[] | Promise<NoteItem[]>
    /** Keeps all the notes of this store. Called 600 ms after the last change of one of them. */
    save(notes: NoteItem[]): void | Promise<void>
}

/** The state of a store: its notes are loading, saved, waiting to be saved, being saved, or it failed */
export type NotesStoreStatus = 'loading' | 'saved' | 'changed' | 'saving' | 'error'

/** Keeps notes in `localStorage`, in this browser only */
export class BrowserNotesStore implements NotesStore {
    constructor(readonly key = 'threepipe-notes', readonly id = 'browser', readonly label = 'This browser') {}

    load(): NoteItem[] {
        try {
            const notes = JSON.parse(localStorage.getItem(this.key) || '[]')
            return Array.isArray(notes) ? notes : []
        } catch (e) {
            return [] // no storage, or not JSON
        }
    }

    save(notes: NoteItem[]) {
        localStorage.setItem(this.key, JSON.stringify(notes))
    }
}

/** Keeps notes on a server: GET {@link url} returns `{notes: NoteItem[]}`, POST {@link url} takes `{notes}` */
export class HttpNotesStore implements NotesStore {
    constructor(readonly url: string, readonly id = 'server', readonly label = 'Server') {}

    async load(): Promise<NoteItem[]> {
        const r = await fetch(this.url)
        if (!r.ok) throw new Error('HttpNotesStore: GET ' + r.status)
        const d = await r.json()
        return Array.isArray(d?.notes) ? d.notes : []
    }

    async save(notes: NoteItem[]) {
        const r = await fetch(this.url, {method: 'POST', headers: [['Content-Type', 'application/json']], body: JSON.stringify({notes})})
        if (!r.ok) throw new Error('HttpNotesStore: POST ' + r.status)
    }
}

export interface NotesPluginOptions {
    /** The `file` store: notes saved in the viewer config, so in an exported .glb. Default: true */
    file?: boolean
    /** The `browser` store ({@link BrowserNotesStore}), or its `localStorage` key. Default: true (key `threepipe-notes`) */
    browser?: boolean | string
    /** More stores, after `file` and `browser` */
    stores?: NotesStore[]
    /** Extra text for {@link NotesPlugin.contextLine}, for example the current tool or mode */
    contextProvider?: () => string
}

export interface NotesPluginEventMap extends AViewerPluginEventMap {
    /** A note was added, changed or removed, or a store loaded its notes */
    notesChanged: {change: 'add' | 'update' | 'remove' | 'load', note?: NoteItem}
    /** The {@link NotesStoreStatus} of a store changed */
    storeStatusChanged: {store: string, status: NotesStoreStatus}
}

/**
 * Notes Plugin
 *
 * A list of notes, each kept in a store:
 * - `file`: {@link fileNotes}, a serialized property, so these notes are saved in the viewer config, inside an
 *   exported .glb, and come back when the file loads;
 * - `browser`: `localStorage` ({@link BrowserNotesStore});
 * - any store the app adds ({@link addStore}), for example {@link HttpNotesStore} or its own.
 *
 * The plugin has no notes UI: a view shows {@link notes} and edits them with {@link addNote}, {@link updateNote} and
 * {@link removeNote}, for example `StickyNotesUiPlugin` (post-its over the canvas). The `notesChanged` event tells the
 * views to update. Changes are saved per store, 600 ms after the last one, and when the plugin is removed.
 *
 * Its UI folder (Notes) has the settings: the store of new notes, and clear the notes in the file.
 *
 * @category Plugins
 */
export class NotesPlugin extends AViewerPluginSync<NotesPluginEventMap> {
    static readonly PluginType = 'NotesPlugin'
    enabled = true

    /** The notes of the `file` store: saved in the viewer config, so in an exported .glb */
    @serialize()
        fileNotes: NoteItem[] = []

    /** The store of a note made with {@link addNote} when it names none. Default: the first store. */
    defaultStore = ''

    /** Extra text for {@link contextLine} */
    contextProvider?: () => string

    private _notes: NoteItem[] = []
    private _stores: NotesStore[] = []
    private _status: Record<string, NotesStoreStatus> = {}
    private _changed = new Set<string>()
    /** Stores that load: their changes wait, as a save before the load would replace the notes not loaded yet */
    private _loading = new Set<string>()
    private _timer = 0
    /** Per store, the running save: saves of a store run one after the other */
    private _running = new Map<string, Promise<void>>()
    /** Per store, a save that waits for the running one: more changes join it */
    private _waiting = new Map<string, Promise<void>>()

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Notes',
        children: [
            {
                type: 'dropdown', label: 'New notes in', property: [this, 'defaultStore'],
                children: () => this._stores.map(s => ({label: s.label, value: s.id})),
            },
            {type: 'button', label: 'Clear notes in the file', value: () => this.clear('file'), hidden: () => !this.getStore('file')},
        ],
    }

    constructor(options: NotesPluginOptions = {}) {
        super()
        this.contextProvider = options.contextProvider
        if (options.file !== false) this._stores.push(this._fileStore)
        if (options.browser !== false) this._stores.push(new BrowserNotesStore(typeof options.browser === 'string' ? options.browser : undefined))
        this._stores.push(...options.stores ?? [])
        this.defaultStore = this._stores[0]?.id ?? ''
        // a loaded scene or config brings its own file notes
        this.addEventListener('deserialize', () => this.getStore('file') === this._fileStore && this._loadStore(this._fileStore, true))
    }

    /** All the notes, in the order of the stores, then the order they were made */
    get notes(): readonly NoteItem[] {
        return this._notes
    }

    get stores(): readonly NotesStore[] {
        return this._stores
    }

    /** A store, by its id */
    getStore(id: string): NotesStore | undefined {
        return this._stores.find(s => s.id === id)
    }

    /** The state of a store */
    storeStatus(id: string): NotesStoreStatus {
        return this._status[id] ?? 'saved'
    }

    /** Adds a store, and loads its notes when the plugin is in a viewer. A store with the same id is replaced. */
    addStore(store: NotesStore) {
        const old = this._stores.findIndex(s => s.id === store.id)
        if (old >= 0) this._stores[old] = store
        else this._stores.push(store)
        if (!this.defaultStore) this.defaultStore = store.id
        this.uiConfig.uiRefresh?.(true)
        if (this._viewer) this._loadStore(store)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        for (const store of this._stores) this._loadStore(store)
        // a reload, a closed tab or a hidden page: the changes of the last 600 ms are saved
        window.addEventListener('pagehide', this._savePending)
        document.addEventListener('visibilitychange', this._savePending)
    }

    onRemove(viewer: ThreeViewer) {
        window.removeEventListener('pagehide', this._savePending)
        document.removeEventListener('visibilitychange', this._savePending)
        // the changes of the last 600 ms
        if (this._timer) void this._saveChanged()
        super.onRemove(viewer)
    }

    /** Makes a note, at the end of the notes of its store ({@link defaultStore} when none is named) */
    addNote(text = '', store = this.defaultStore): NoteItem {
        if (!this.getStore(store)) throw new Error('NotesPlugin: no store ' + store)
        const note: NoteItem = {id: newId(), text, store, created: Date.now()}
        this._notes.splice(this._endOfStore(store), 0, note)
        this._changedStore(store)
        this.dispatchEvent({type: 'notesChanged', change: 'add', note})
        return note
    }

    /** Changes the text of a note, or moves it to the end of the notes of another store */
    updateNote(id: string, patch: Partial<Pick<NoteItem, 'text' | 'store'>>) {
        const note = this._notes.find(n => n.id === id)
        if (!note) return
        if (patch.store !== undefined && patch.store !== note.store) {
            if (!this.getStore(patch.store)) throw new Error('NotesPlugin: no store ' + patch.store)
            const from = note.store
            this._notes.splice(this._notes.indexOf(note), 1)
            note.store = patch.store
            this._notes.splice(this._endOfStore(note.store), 0, note)
            // after the move: the store it left is saved without it
            this._changedStore(from)
        }
        if (patch.text !== undefined) note.text = patch.text
        this._changedStore(note.store)
        this.dispatchEvent({type: 'notesChanged', change: 'update', note})
    }

    removeNote(id: string) {
        const note = this._notes.find(n => n.id === id)
        if (!note) return
        this._notes.splice(this._notes.indexOf(note), 1)
        this._changedStore(note.store)
        this.dispatchEvent({type: 'notesChanged', change: 'remove', note})
    }

    /** Removes all the notes of a store */
    clear(store: string) {
        if (!this._notes.some(n => n.store === store)) return
        this._notes = this._notes.filter(n => n.store !== store)
        this._changedStore(store)
        this.dispatchEvent({type: 'notesChanged', change: 'remove'})
    }

    /** A line "[time · context · selected: names]" for a note: the time, {@link contextProvider}, the selected objects */
    contextLine(): string {
        const selected = (this._viewer?.getPlugin(PickingPlugin)?.getSelectedObjects() || []) as any[]
        const names = selected.map(o => (o as IObject3D)?.name || o?.type).filter(Boolean).join(', ')
        const extra = this.contextProvider?.() || ''
        return `[${new Date().toLocaleString()}${extra ? ' · ' + extra : ''}${names ? ' · selected: ' + names : ''}]`
    }

    /** Saves the changed stores now, instead of 600 ms after the last change */
    async flush() {
        await this._saveChanged()
    }

    private _fileStore: NotesStore = {
        id: 'file',
        label: 'In the file',
        load: () => this.fileNotes.map(n => ({...n})),
        save: (notes) => {
            this.fileNotes = notes
        },
    }

    /** The index after the notes of a store: the first note of a later store */
    private _endOfStore(store: string) {
        const rank = (id: string) => this._stores.findIndex(s => s.id === id)
        const r = rank(store)
        const i = this._notes.findIndex(n => rank(n.store) > r)
        return i < 0 ? this._notes.length : i
    }

    private _setStatus(store: string, status: NotesStoreStatus) {
        if (this._status[store] === status) return
        this._status[store] = status
        this.dispatchEvent({type: 'storeStatusChanged', store, status})
    }

    /** Loads the notes of a store. `replace`: the loaded notes replace the notes of the store (another scene). */
    private _loadStore(store: NotesStore, replace = false) {
        this._setStatus(store.id, 'loading')
        this._loading.add(store.id)
        Promise.resolve().then(async() => store.load()).then(loaded => {
            if (this.getStore(store.id) !== store) return // replaced meanwhile
            this._loading.delete(store.id)
            // notes made in this store while it loaded stay, after the loaded ones, and are saved
            const made = !replace && this._changed.has(store.id) ? this._notes.filter(n => n.store === store.id) : []
            const ids = new Set(made.map(n => n.id))
            const notes = (Array.isArray(loaded) ? loaded : [])
                .filter(n => n && typeof n.text === 'string' && !ids.has(n.id))
                .map(n => ({id: String(n.id || newId()), text: n.text, store: store.id, created: Number(n.created) || Date.now()}))
            this._notes = this._notes.filter(n => n.store !== store.id)
            this._notes.splice(this._endOfStore(store.id), 0, ...notes, ...made)
            if (made.length) this._changedStore(store.id) // saved with the loaded notes
            else this._setStatus(store.id, 'saved')
            this.dispatchEvent({type: 'notesChanged', change: 'load'})
        }).catch(e => {
            // the store stays in _loading, so its changes are not saved: a save without the notes that did not load
            // would replace them
            console.warn('NotesPlugin: could not load the notes of ' + store.id, e)
            this._setStatus(store.id, 'error')
        })
    }

    private _changedStore(store: string) {
        if (this.getStore(store) === this._fileStore) {
            // at once: the viewer config (an export) reads fileNotes
            this.fileNotes = this._notes.filter(n => n.store === store).map(n => ({...n}))
            this._setStatus(store, 'saved')
            return
        }
        this._changed.add(store)
        // a store that could not load stays in the error state: its changes are not saved
        if (!(this._loading.has(store) && this.storeStatus(store) === 'error')) this._setStatus(store, 'changed')
        clearTimeout(this._timer)
        this._timer = window.setTimeout(() => void this._saveChanged(), 600)
    }

    /** The page is left or hidden: the changes that wait for the 600 ms are saved now */
    private _savePending = (e: Event) => {
        if (this._timer && (e.type === 'pagehide' || document.visibilityState === 'hidden')) void this._saveChanged()
    }

    private async _saveChanged() {
        clearTimeout(this._timer)
        this._timer = 0
        const changed = [...this._changed].filter(id => !this._loading.has(id))
        for (const id of changed) this._changed.delete(id)
        await Promise.all(changed.map(async id => this._saveStore(id)))
    }

    /**
     * Saves the notes of a store now, or after its running save, so an older save never ends after a newer one. The
     * notes are read when the save starts, so it saves the latest ones.
     */
    private async _saveStore(id: string): Promise<void> {
        const waiting = this._waiting.get(id)
        if (waiting) return waiting
        const running = this._running.get(id)
        if (running) {
            const next = running.then(async() => {
                this._waiting.delete(id)
                return this._saveStore(id)
            })
            this._waiting.set(id, next)
            return next
        }
        // started at once: a store that saves synchronously (localStorage) is saved before the page closes
        const save = this._runSave(id)
        this._running.set(id, save)
        void save.then(() => this._running.get(id) === save && this._running.delete(id))
        return save
    }

    private async _runSave(id: string) {
        const store = this.getStore(id)
        if (!store) return
        this._setStatus(id, 'saving')
        try {
            await store.save(this._notes.filter(n => n.store === id).map(n => ({...n})))
            if (!this._changed.has(id) && !this._waiting.has(id)) this._setStatus(id, 'saved')
        } catch (e) {
            console.warn('NotesPlugin: could not save the notes of ' + id, e)
            this._setStatus(id, 'error')
        }
    }
}

let lastId = 0

/** An id unique in this page, and very likely across pages: the time, a counter and a random part */
function newId() {
    return Date.now().toString(36) + '-' + (++lastId).toString(36) + Math.random().toString(36).slice(2, 6)
}
