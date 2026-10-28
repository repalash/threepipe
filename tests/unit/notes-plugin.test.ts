import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {HttpNotesStore, NoteItem, NotesPlugin, NotesStore} from '../../plugins/tweakpane-editor/src/NotesPlugin'

const doc = globalThis.document as any
const saved = {addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener}
beforeAll(() => {
    doc.addEventListener = () => {}
    doc.removeEventListener = () => {}
})
afterAll(() => Object.assign(doc, saved))

let storage: Map<string, string>
beforeEach(() => {
    storage = new Map()
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    })
    vi.stubGlobal('addEventListener', () => {})
    vi.stubGlobal('removeEventListener', () => {})
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

/** A viewer with what the plugin uses, and a PickingPlugin with these objects selected */
function fakeViewer(selected: any[] = []) {
    return {
        addEventListener: () => {},
        removeEventListener: () => {},
        getPlugin: () => ({getSelectedObjects: () => selected}),
        console,
    } as any
}

/** A store in memory, with its saves */
function memoryStore(id: string, notes: Partial<NoteItem>[] = [], label = id): NotesStore & {saved: NoteItem[][]} {
    const saved: NoteItem[][] = []
    return {id, label, saved, load: () => notes as NoteItem[], save: (n: NoteItem[]) => void saved.push(n)}
}

const texts = (notes: NotesPlugin) => notes.notes.map(n => n.store + ':' + n.text)

describe('NotesPlugin', () => {
    test('the stores: in the file, then this browser; new notes go in the first one', () => {
        const notes = new NotesPlugin()
        expect(notes.stores.map(s => [s.id, s.label])).toEqual([['file', 'In the file'], ['browser', 'This browser']])
        expect(notes.defaultStore).toBe('file')
        notes.addNote('b1', 'browser')
        notes.addNote('f1')
        notes.addNote('b2', 'browser')
        notes.addNote('f2')
        // the order of the stores, then the order they were made
        expect(texts(notes)).toEqual(['file:f1', 'file:f2', 'browser:b1', 'browser:b2'])
        expect(() => notes.addNote('x', 'nope')).toThrow()
    })

    test('the notes in the file are serialized, and come back with the config', async() => {
        const notes = new NotesPlugin()
        notes.addNote('Check the prongs')
        notes.addNote('only here', 'browser')
        await notes.flush()
        const data = notes.toJSON()
        expect(data.fileNotes.map((n: NoteItem) => n.text)).toEqual(['Check the prongs'])

        const loaded = new NotesPlugin()
        loaded.onAdded(fakeViewer())
        loaded.fromJSON(JSON.parse(JSON.stringify(data)))
        await vi.waitFor(() => expect(texts(loaded)).toEqual(['file:Check the prongs', 'browser:only here']))
    })

    test('the notes in the file are in the config at once, for an export right after an edit', () => {
        const notes = new NotesPlugin()
        const n = notes.addNote('new')
        expect(notes.toJSON().fileNotes.map((x: NoteItem) => x.text)).toEqual(['new'])
        notes.updateNote(n.id, {text: 'edited'})
        expect(notes.toJSON().fileNotes.map((x: NoteItem) => x.text)).toEqual(['edited'])
        notes.removeNote(n.id)
        expect(notes.toJSON().fileNotes).toEqual([])
    })

    test('a note moved out of the file leaves the config at once', () => {
        const notes = new NotesPlugin()
        const n = notes.addNote('moving')
        notes.updateNote(n.id, {store: 'browser'})
        expect(notes.toJSON().fileNotes).toEqual([])
        notes.updateNote(n.id, {store: 'file'})
        expect(notes.toJSON().fileNotes.map((x: NoteItem) => x.text)).toEqual(['moving'])
    })

    test('a store is not saved before its notes are loaded: a save then would replace them', async() => {
        let answer!: (n: NoteItem[]) => void
        const saved: NoteItem[][] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: async() => new Promise(r => answer = r), save: n => void saved.push(n)}
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow]})
        notes.onAdded(fakeViewer())
        notes.addNote('typed while it loads')
        await notes.flush()
        expect(saved).toEqual([])
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
        answer([{id: 'old', text: 'on the server', store: 'slow', created: 1}])
        await vi.waitFor(() => expect(texts(notes)).toEqual(['slow:on the server', 'slow:typed while it loads']))
        await notes.flush()
        expect(saved.map(n => n.map(x => x.text))).toEqual([['on the server', 'typed while it loads']])
    })

    test('importing another scene replaces the notes in the file', async() => {
        const notes = new NotesPlugin()
        notes.onAdded(fakeViewer())
        const a = notes.addNote('scene A')
        const other = new NotesPlugin()
        const b = other.addNote('scene B')
        const config = JSON.parse(JSON.stringify(other.toJSON()))
        config.fileNotes.push({...config.fileNotes[0], id: a.id, text: 'scene B, same id'})
        notes.fromJSON(config)
        await vi.waitFor(() => expect(texts(notes)).toEqual(['file:scene B', 'file:scene B, same id']))
        expect(notes.notes[0].id).toBe(b.id)
        expect(notes.fileNotes.map(x => x.text)).toEqual(['scene B', 'scene B, same id'])
    })

    test('the notes in this browser are saved 600 ms after the last change, and loaded when the plugin is added', async() => {
        vi.useFakeTimers()
        const notes = new NotesPlugin({browser: 'my-notes'})
        const n = notes.addNote('a', 'browser')
        vi.advanceTimersByTime(400)
        notes.updateNote(n.id, {text: 'ab'})
        vi.advanceTimersByTime(400)
        expect(storage.has('my-notes')).toBe(false)
        await vi.advanceTimersByTimeAsync(200)
        expect(JSON.parse(storage.get('my-notes')!).map((x: NoteItem) => x.text)).toEqual(['ab'])
        expect(notes.storeStatus('browser')).toBe('saved')

        const again = new NotesPlugin({browser: 'my-notes'})
        again.onAdded(fakeViewer())
        await vi.waitFor(() => expect(texts(again)).toEqual(['browser:ab']))
    })

    test('an app adds its own store: it loads, and gets only its own notes to save', async() => {
        const server = memoryStore('server', [{id: 's1', text: 'from the server', created: 1}], 'Server')
        const notes = new NotesPlugin({stores: [server]})
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(texts(notes)).toEqual(['server:from the server']))
        expect(notes.getStore('server')?.label).toBe('Server')

        notes.addNote('in the file')
        notes.updateNote('s1', {text: 'edited'})
        await notes.flush()
        expect(server.saved.at(-1)!.map(n => n.text)).toEqual(['edited'])
        expect(notes.fileNotes.map(n => n.text)).toEqual(['in the file'])

        // added later: loaded at once
        const later = memoryStore('later', [{id: 'l1', text: 'later', created: 1}])
        notes.addStore(later)
        await vi.waitFor(() => expect(texts(notes)).toContain('later:later'))
    })

    test('a note moved to another store is saved in both', async() => {
        const a = memoryStore('a'), b = memoryStore('b')
        const notes = new NotesPlugin({file: false, browser: false, stores: [a, b]})
        const n = notes.addNote('moving', 'a')
        await notes.flush()
        notes.updateNote(n.id, {store: 'b'})
        await notes.flush()
        expect(a.saved.at(-1)).toEqual([])
        expect(b.saved.at(-1)!.map(x => x.text)).toEqual(['moving'])
        expect(texts(notes)).toEqual(['b:moving'])
    })

    test('notes made while a store loads stay, after the loaded ones, and are saved', async() => {
        let answer!: (n: NoteItem[]) => void
        const saved: NoteItem[][] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: async() => new Promise(r => answer = r), save: n => void saved.push(n)}
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow]})
        notes.onAdded(fakeViewer())
        expect(notes.storeStatus('slow')).toBe('loading')
        notes.addNote('typed now')
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
        answer([{id: 'old', text: 'from before', store: 'slow', created: 1}])
        await vi.waitFor(() => expect(texts(notes)).toEqual(['slow:from before', 'slow:typed now']))
        await notes.flush()
        expect(saved.at(-1)!.map(n => n.text)).toEqual(['from before', 'typed now'])
    })

    test('a store that cannot load is not saved, so its notes elsewhere are not replaced', async() => {
        const saved: NoteItem[][] = []
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const offline: NotesStore = {id: 'off', label: 'Offline', load: () => {
            throw new Error('offline')
        }, save: n => void saved.push(n)}
        const notes = new NotesPlugin({file: false, browser: false, stores: [offline]})
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(notes.storeStatus('off')).toBe('error'))
        notes.addNote('kept here')
        await notes.flush()
        expect(saved).toEqual([])
        expect(texts(notes)).toEqual(['off:kept here'])
        expect(notes.storeStatus('off')).toBe('error')
        warn.mockRestore()
    })

    test('a store that fails keeps the notes, and shows the error', async() => {
        const bad: NotesStore = {id: 'bad', label: 'Bad', load: () => [], save: () => {
            throw new Error('offline')
        }}
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const notes = new NotesPlugin({file: false, browser: false, stores: [bad]})
        notes.addNote('kept')
        await notes.flush()
        expect(notes.storeStatus('bad')).toBe('error')
        expect(texts(notes)).toEqual(['bad:kept'])
        warn.mockRestore()
    })

    test('the changes of the last 600 ms are saved when the plugin is removed', async() => {
        vi.useFakeTimers()
        const notes = new NotesPlugin()
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        await vi.waitFor(() => expect(notes.storeStatus('browser')).toBe('saved'))
        notes.addNote('last words', 'browser')
        notes.onRemove(viewer)
        expect(JSON.parse(storage.get('threepipe-notes')!).map((x: NoteItem) => x.text)).toEqual(['last words'])
    })

    test('one save at a time per store: a change made during a slow save is saved after it, with the latest notes', async() => {
        const calls: string[][] = []
        const answers: (() => void)[] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: () => [], save: async n => {
            calls.push(n.map(x => x.text))
            await new Promise<void>(r => answers.push(r))
        }}
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow]})
        const n = notes.addNote('first')
        const one = notes.flush()
        notes.updateNote(n.id, {text: 'second'})
        const two = notes.flush()
        notes.updateNote(n.id, {text: 'third'})
        const three = notes.flush()
        await vi.waitFor(() => expect(calls).toHaveLength(1))
        expect(notes.storeStatus('slow')).toBe('changed') // a newer change waits for the running save
        answers[0]()
        await vi.waitFor(() => expect(calls).toHaveLength(2))
        answers[1]()
        await Promise.all([one, two, three])
        // the second and third changes are one save, after the first, with the latest text
        expect(calls).toEqual([['first'], ['third']])
        expect(notes.storeStatus('slow')).toBe('saved')
    })

    test('the changes of the last 600 ms are saved when the page is hidden or left', async() => {
        vi.useFakeTimers()
        const handlers: Record<string, (e: Event) => void> = {}
        vi.stubGlobal('addEventListener', (type: string, f: (e: Event) => void) => handlers[type] = f)
        vi.stubGlobal('removeEventListener', () => {})
        const notes = new NotesPlugin()
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(notes.storeStatus('browser')).toBe('saved'))
        notes.addNote('typed just before leaving', 'browser')
        handlers.pagehide({type: 'pagehide'} as any)
        expect(JSON.parse(storage.get('threepipe-notes')!).map((x: NoteItem) => x.text)).toEqual(['typed just before leaving'])
    })

    test('the context line has the time, the context and the selected names', () => {
        const notes = new NotesPlugin({contextProvider: () => 'Move tool'})
        notes.onAdded(fakeViewer([{name: 'Ring'}, {name: '', type: 'Mesh'}]))
        expect(notes.contextLine()).toMatch(/^\[.+ · Move tool · selected: Ring, Mesh]$/)
    })

    test('HttpNotesStore: GET {notes}, POST {notes}', async() => {
        const fetch = vi.fn(async(_url: string, init?: RequestInit) => ({ok: true, json: async() => init ? {} : {notes: [{id: 'h', text: 'remote', created: 1}]}}))
        vi.stubGlobal('fetch', fetch)
        const store = new HttpNotesStore('/api/notes')
        expect((await store.load()).map(n => n.text)).toEqual(['remote'])
        await store.save([{id: 'h', text: 'changed', store: 'server', created: 1}])
        expect(fetch).toHaveBeenLastCalledWith('/api/notes', expect.objectContaining({method: 'POST'}))
        expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).notes[0].text).toBe('changed')
    })
})
