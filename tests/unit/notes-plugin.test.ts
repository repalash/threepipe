import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {HttpNotesStore, NoteItem, NotesPlugin, NotesStore} from '../../plugins/tweakpane-editor/src/NotesPlugin'

let storage: Map<string, string>
beforeEach(() => {
    storage = new Map()
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    })
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

    test('the changes of the last 600 ms are saved when the plugin is removed', () => {
        vi.useFakeTimers()
        const notes = new NotesPlugin()
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        notes.addNote('last words', 'browser')
        notes.onRemove(viewer)
        expect(JSON.parse(storage.get('threepipe-notes')!).map((x: NoteItem) => x.text)).toEqual(['last words'])
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
