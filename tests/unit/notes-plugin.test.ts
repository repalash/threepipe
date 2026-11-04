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
        // flush() waits for the load, and saves after it
        const flushing = notes.flush()
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
        expect(saved).toEqual([])
        answer([{id: 'old', text: 'on the server', store: 'slow', created: 1}])
        await flushing
        expect(texts(notes)).toEqual(['slow:on the server', 'slow:typed while it loads'])
        expect(saved.map(n => n.map(x => x.text))).toEqual([['on the server', 'typed while it loads']])
    })

    test('a loaded note with the id of a note in another store gets a new id', async() => {
        storage.set('threepipe-notes', JSON.stringify([{id: 'same', text: 'in the browser', store: 'browser', created: 1}]))
        const notes = new NotesPlugin()
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(texts(notes)).toEqual(['browser:in the browser']))
        notes.fromJSON({...notes.toJSON(), fileNotes: [{id: 'same', text: 'from an old export', store: 'file', created: 1}]})
        await vi.waitFor(() => expect(texts(notes)).toEqual(['file:from an old export', 'browser:in the browser']))
        const [file, browser] = notes.notes
        expect(browser.id).toBe('same')
        expect(file.id).not.toBe('same')
        expect(notes.fileNotes[0].id).toBe(file.id)
        notes.updateNote('same', {text: 'typed'})
        expect(texts(notes)).toEqual(['file:from an old export', 'browser:typed'])
    })

    test('a note made right after the plugin is added stays: the file and the browser load at once', async() => {
        storage.set('threepipe-notes', JSON.stringify([{id: 'b', text: 'from before', store: 'browser', created: 1}]))
        const notes = new NotesPlugin()
        notes.onAdded(fakeViewer())
        expect(texts(notes)).toEqual(['browser:from before'])
        notes.addNote('right away')
        await new Promise(r => setTimeout(r, 10))
        expect(texts(notes)).toEqual(['file:right away', 'browser:from before'])
        expect(notes.fileNotes.map(n => n.text)).toEqual(['right away'])
    })

    test('a store replaced by another with the same id gets none of the old notes; the old one keeps its last changes', async() => {
        const a = memoryStore('project', [{id: 'a1', text: 'project A', created: 1}])
        const b = memoryStore('project', [{id: 'b1', text: 'project B', created: 1}])
        const notes = new NotesPlugin({file: false, browser: false, stores: [a]})
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(texts(notes)).toEqual(['project:project A']))
        notes.updateNote('a1', {text: 'project A, edited'})
        notes.addStore(b)
        await vi.waitFor(() => expect(texts(notes)).toEqual(['project:project B']))
        await notes.flush()
        expect(b.saved).toEqual([])
        expect(a.saved.at(-1)!.map(n => n.text)).toEqual(['project A, edited'])
    })

    test('a save queued behind a slow save goes to its own store, also when the store is replaced', async() => {
        const answers: (() => void)[] = []
        const aSaved: string[][] = []
        const a: NotesStore = {id: 'project', label: 'A', load: () => [{id: 'a1', text: 'A', store: 'project', created: 1}], save: async n => {
            aSaved.push(n.map(x => x.text))
            await new Promise<void>(r => answers.push(r))
        }}
        let bLoad!: (n: NoteItem[]) => void
        const bSaved: string[][] = []
        const b: NotesStore = {id: 'project', label: 'B', load: async() => new Promise(r => bLoad = r), save: n => void bSaved.push(n.map(x => x.text))}
        const notes = new NotesPlugin({file: false, browser: false, stores: [a]})
        notes.onAdded(fakeViewer())
        notes.updateNote('a1', {text: 'A1'})
        void notes.flush() // running
        notes.updateNote('a1', {text: 'A2'})
        void notes.flush() // queued behind it
        notes.addStore(b)
        answers[0]()
        await vi.waitFor(() => expect(aSaved.at(-1)).toEqual(['A2']))
        answers.forEach(r => r())
        await vi.waitFor(() => expect(bLoad).toBeTypeOf('function'))
        bLoad([{id: 'b1', text: 'B', store: 'project', created: 1}])
        await vi.waitFor(() => expect(texts(notes)).toEqual(['project:B']))
        await notes.flush()
        expect(bSaved).toEqual([])
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

    test('flush() also waits for a save that the 600 ms timer already started', async() => {
        vi.useFakeTimers()
        let finish!: () => void
        const saved: string[][] = []
        const server: NotesStore = {id: 'server', label: 'Server', load: () => [], save: async n => new Promise<void>(r => finish = () => {
            saved.push(n.map(x => x.text))
            r()
        })}
        const notes = new NotesPlugin({file: false, browser: false, stores: [server]})
        notes.onAdded(fakeViewer())
        notes.addNote('kept')
        await vi.advanceTimersByTimeAsync(600) // the save starts and waits for the server
        expect(notes.storeStatus('server')).toBe('saving')
        let flushed = false
        const flushing = notes.flush().then(() => flushed = true)
        await vi.advanceTimersByTimeAsync(0)
        expect(flushed).toBe(false)
        finish()
        await flushing
        expect(saved).toEqual([['kept']])
    })

    test('flush() waits for a store that still loads and has changes: its load, then the save of the changes', async() => {
        vi.useFakeTimers()
        let answer!: (notes: NoteItem[]) => void
        const saved: string[][] = []
        const server: NotesStore = {
            id: 'server', label: 'Server',
            load: async() => new Promise<NoteItem[]>(r => answer = r),
            save: async n => void saved.push(n.map(x => x.text)),
        }
        const notes = new NotesPlugin({file: false, browser: false, stores: [server]})
        notes.onAdded(fakeViewer())
        notes.addNote('made while it loads')
        let flushed = false
        const flushing = notes.flush().then(() => flushed = true)
        await vi.advanceTimersByTimeAsync(0)
        expect(flushed).toBe(false)
        answer([{id: 'r1', text: 'remote', store: 'server', created: 1}])
        await flushing
        expect(saved).toEqual([['remote', 'made while it loads']])
        expect(notes.storeStatus('server')).toBe('saved')

        // a store that cannot load keeps its changes unsaved: flush() does not wait for it
        const broken: NotesStore = {id: 'broken', label: 'Broken', load: async() => Promise.reject(new Error('down')), save: async() => {}}
        notes.addStore(broken)
        notes.addNote('kept here', 'broken')
        await notes.flush()
        expect(notes.storeStatus('broken')).toBe('error')
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

    test('the answer of a load from before a remove and add is dropped: it does not replace a later edit', async() => {
        const answers: ((n: NoteItem[]) => void)[] = []
        const saved: string[][] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: async() => new Promise(r => answers.push(r)), save: n => void saved.push(n.map(x => x.text))}
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow]})
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        notes.onRemove(viewer)
        notes.onAdded(viewer)
        await vi.waitFor(() => expect(answers).toHaveLength(2))
        const stale = [{id: 'a', text: 'old', store: 'slow', created: 1}]
        answers[1](stale)
        await vi.waitFor(() => expect(texts(notes)).toEqual(['slow:old']))
        notes.updateNote('a', {text: 'edited'})
        await notes.flush()
        expect(saved).toEqual([['edited']])
        answers[0](stale) // the first load answers last
        await new Promise(r => setTimeout(r, 0))
        expect(texts(notes)).toEqual(['slow:edited'])
        expect(notes.storeStatus('slow')).toBe('saved')
    })

    test('a note made while a store loads is saved also when the plugin is removed before the load answers', async() => {
        let answer!: (n: NoteItem[]) => void
        const saved: string[][] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: async() => new Promise(r => answer = r), save: n => void saved.push(n.map(x => x.text))}
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow]})
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        notes.addNote('typed while it loads')
        notes.onRemove(viewer) // the viewer is disposed
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
        const loaded = new Promise(r => notes.addEventListener('notesChange', e => e.change === 'load' && r(e)))
        answer([{id: 'old', text: 'from before', store: 'slow', created: 1}])
        await loaded
        await notes.flush()
        expect(saved).toEqual([['from before', 'typed while it loads']])
    })

    test('an edit that a failed save could not keep stays over the reload after a remove and add', async() => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let backend: NoteItem[] = [{id: 'a', text: 'first', store: 'server', created: 1}, {id: 'b', text: 'other', store: 'server', created: 2}]
        let online = false
        const server: NotesStore = {id: 'server', label: 'Server', load: () => backend.map(n => ({...n})), save: async n => {
            if (!online) throw new Error('offline')
            backend = n
        }}
        const notes = new NotesPlugin({file: false, browser: false, stores: [server]})
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        notes.updateNote('a', {text: 'latest'})
        notes.onRemove(viewer) // its save fails
        notes.onAdded(viewer)
        await vi.waitFor(() => expect(notes.storeStatus('server')).toBe('changed'))
        expect(texts(notes)).toEqual(['server:latest', 'server:other'])
        online = true
        await notes.flush()
        expect(backend.map(n => n.text)).toEqual(['latest', 'other'])
        warn.mockRestore()
    })

    test('a failed load of a replaced store does not show an error on the store that replaced it', async() => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let reject!: (e: Error) => void
        const projectA: NotesStore = {id: 'project', label: 'A', load: async() => new Promise<NoteItem[]>((_, r) => reject = r), save: () => {}}
        const notes = new NotesPlugin({file: false, browser: false, stores: [projectA]})
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
        notes.addStore(memoryStore('project', [{id: 'b', text: 'in B'}], 'B'))
        expect(notes.storeStatus('project')).toBe('saved')
        reject(new Error('offline'))
        await new Promise(r => setTimeout(r, 0))
        expect(notes.storeStatus('project')).toBe('saved')
        expect(texts(notes)).toEqual(['project:in B'])
        warn.mockRestore()
    })

    test('a failed save of a replaced store changes nothing in the store that replaced it', async() => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let fail!: () => void
        const projectA: NotesStore = {id: 'project', label: 'A', load: () => [{id: 'same', text: 'in A', store: 'project', created: 1}],
            save: async() => new Promise<void>((_, reject) => fail = () => reject(new Error('offline')))}
        const projectB = memoryStore('project', [{id: 'same', text: 'in B', store: 'project', created: 1}], 'B')
        const notes = new NotesPlugin({file: false, browser: false, stores: [projectA]})
        notes.onAdded(fakeViewer())
        notes.removeNote('same')
        const saving = notes.flush() // A's save waits
        notes.addStore(projectB) // loads after A's save
        fail()
        await saving
        await vi.waitFor(() => expect(notes.storeStatus('project')).toBe('saved'))
        await notes.flush()
        expect(texts(notes)).toEqual(['project:in B'])
        expect(projectB.saved).toEqual([])
        warn.mockRestore()
    })

    test('a reload keeps only the notes edited meanwhile: the other notes come from the load', async() => {
        const answers: ((n: NoteItem[]) => void)[] = []
        const saved: string[][] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: async() => new Promise(r => answers.push(r)), save: n => void saved.push(n.map(x => x.text))}
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow]})
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        await vi.waitFor(() => expect(answers).toHaveLength(1))
        answers[0]([{id: 'a', text: 'A', store: 'slow', created: 1}, {id: 'b', text: 'B', store: 'slow', created: 2}])
        await vi.waitFor(() => expect(texts(notes)).toEqual(['slow:A', 'slow:B']))
        notes.onRemove(viewer)
        notes.onAdded(viewer) // B changes on another device meanwhile
        await vi.waitFor(() => expect(answers).toHaveLength(2))
        notes.updateNote('a', {text: 'A edited here'})
        const loaded = new Promise(r => notes.addEventListener('notesChange', e => e.change === 'load' && r(e)))
        answers[1]([{id: 'a', text: 'A', store: 'slow', created: 1}, {id: 'b', text: 'B edited there', store: 'slow', created: 2}])
        await loaded
        expect(texts(notes)).toEqual(['slow:A edited here', 'slow:B edited there'])
        await notes.flush()
        expect(saved.at(-1)).toEqual(['A edited here', 'B edited there'])
    })

    test('a store replaced while it loads gets the changes made meanwhile, with the notes it loads', async() => {
        let backend: NoteItem[] = [{id: 'old', text: 'from before', store: 'project', created: 1}]
        let loads = 0
        // the first load (the plugin's) does not answer before the replace
        const projectA: NotesStore = {id: 'project', label: 'A', load: async() => loads++ ? backend.map(n => ({...n})) : new Promise<NoteItem[]>(() => {}), save: n => {
            backend = n
        }}
        const projectB = memoryStore('project', [], 'B')
        const notes = new NotesPlugin({file: false, browser: false, stores: [projectA]})
        notes.onAdded(fakeViewer())
        notes.addNote('typed in A while it loads')
        notes.addStore(projectB)
        await vi.waitFor(() => expect(backend.map(n => n.text)).toEqual(['from before', 'typed in A while it loads']))
        expect(texts(notes)).toEqual([])
        await notes.flush()
        expect(projectB.saved).toEqual([])
    })

    test('a store that replaces one on the same backend loads after the last save of the old one', async() => {
        let backend: NoteItem[] = [{id: 'a', text: 'first', store: 'shared', created: 1}]
        const makeStore = (): NotesStore => ({id: 'shared', label: 'Shared', load: () => backend.map(n => ({...n})), save: n => {
            backend = n
        }})
        const notes = new NotesPlugin({file: false, browser: false, stores: [makeStore()]})
        notes.onAdded(fakeViewer())
        notes.updateNote('a', {text: 'latest'}) // waits for the 600 ms
        notes.addStore(makeStore()) // the same key or server
        await vi.waitFor(() => expect(notes.storeStatus('shared')).toBe('saved'))
        expect(texts(notes)).toEqual(['shared:latest'])
        expect(backend.map(n => n.text)).toEqual(['latest'])
    })

    test('an add right after a remove loads the store after the save of the remove', async() => {
        let backend: NoteItem[] = [{id: 'a', text: 'first', store: 'server', created: 1}]
        let finish!: () => void
        const server: NotesStore = {id: 'server', label: 'Server', load: () => backend.map(n => ({...n})), save: async n => new Promise<void>(r => finish = () => {
            backend = n
            r()
        })}
        const notes = new NotesPlugin({file: false, browser: false, stores: [server]})
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        notes.updateNote('a', {text: 'latest'})
        notes.onRemove(viewer) // saves the change, slowly
        notes.onAdded(viewer)
        expect(notes.storeStatus('server')).toBe('loading')
        finish()
        await vi.waitFor(() => expect(notes.storeStatus('server')).toBe('saved'))
        expect(texts(notes)).toEqual(['server:latest'])
        expect(backend.map(n => n.text)).toEqual(['latest'])
    })

    test('a note deleted or moved out while its store loads again does not come back with the load', async() => {
        const answers: ((n: NoteItem[]) => void)[] = []
        const saved: string[][] = []
        const slow: NotesStore = {id: 'slow', label: 'Slow', load: async() => new Promise(r => answers.push(r)), save: n => void saved.push(n.map(x => x.text))}
        const other = memoryStore('other')
        const notes = new NotesPlugin({file: false, browser: false, stores: [slow, other]})
        const viewer = fakeViewer()
        const before = [{id: 'a', text: 'deleted', store: 'slow', created: 1}, {id: 'b', text: 'moved', store: 'slow', created: 2}, {id: 'c', text: 'kept', store: 'slow', created: 3}]
        notes.onAdded(viewer)
        await vi.waitFor(() => expect(answers).toHaveLength(1))
        answers[0](before)
        await vi.waitFor(() => expect(texts(notes)).toEqual(['slow:deleted', 'slow:moved', 'slow:kept']))
        notes.onRemove(viewer)
        notes.onAdded(viewer) // the notes stay visible while the store loads again
        await vi.waitFor(() => expect(answers).toHaveLength(2))
        notes.removeNote('a')
        notes.updateNote('b', {store: 'other'})
        const loaded = new Promise(r => notes.addEventListener('notesChange', e => e.change === 'load' && r(e)))
        answers[1](before)
        await loaded
        expect(texts(notes)).toEqual(['slow:kept', 'other:moved'])
        await notes.flush()
        expect(saved.at(-1)).toEqual(['kept'])
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

    test('a failed save stays to do: flush() tries it again', async() => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let online = false
        const saved: string[][] = []
        const server: NotesStore = {id: 'server', label: 'Server', load: () => [], save: n => {
            if (!online) throw new Error('offline')
            saved.push(n.map(x => x.text))
        }}
        const notes = new NotesPlugin({file: false, browser: false, stores: [server]})
        notes.onAdded(fakeViewer())
        notes.addNote('kept')
        await notes.flush()
        expect(notes.storeStatus('server')).toBe('error')
        online = true
        await notes.flush()
        expect(saved).toEqual([['kept']])
        expect(notes.storeStatus('server')).toBe('saved')
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

    test('a browser store that the browser refuses (full, or a sandboxed page) shows the error and saves again later', async() => {
        let refuse = true
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => storage.get(k) ?? null,
            setItem: (k: string, v: string) => {
                if (refuse) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
                storage.set(k, v)
            },
        })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const notes = new NotesPlugin({file: false})
        notes.addNote('kept')
        await notes.flush()
        expect(notes.storeStatus('browser')).toBe('error')
        expect(storage.has('threepipe-notes')).toBe(false)
        refuse = false
        await notes.flush()
        expect(notes.storeStatus('browser')).toBe('saved')
        expect(JSON.parse(storage.get('threepipe-notes')!).map((n: NoteItem) => n.text)).toEqual(['kept'])
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

    test('a removal of many notes (clear, a store replaced) names the notes it removes in its event', () => {
        const notes = new NotesPlugin({browser: false, stores: [memoryStore('mem', [{id: 'm1', text: 'm', store: 'mem', created: 1}])]})
        notes.onAdded(fakeViewer())
        const f1 = notes.addNote('f1', 'file')
        const m2 = notes.addNote('m2', 'mem')
        const removed: (string[] | undefined)[] = []
        notes.addEventListener('notesChange', e => e.change === 'remove' && removed.push(e.notes?.map(n => n.id)))
        notes.clear('file')
        notes.addStore(memoryStore('mem'))
        expect(removed).toEqual([[f1.id], ['m1', m2.id]])
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

    test('HttpNotesStore: a save under 64 KiB is a keepalive request, so it ends also when the page closes', async() => {
        const fetch = vi.fn(async(_url: string, _init?: RequestInit) => ({ok: true, json: async() => ({})}))
        vi.stubGlobal('fetch', fetch)
        const store = new HttpNotesStore('/api/notes')
        await store.save([{id: 'h', text: 'small', store: 'server', created: 1}])
        expect(fetch.mock.calls.at(-1)![1]!.keepalive).toBe(true)
        // the browser refuses a keepalive body over 64 KiB: a larger save is a normal request
        await store.save([{id: 'h', text: 'é'.repeat(33 * 1024), store: 'server', created: 1}]) // 66 KiB in UTF-8
        expect(fetch.mock.calls.at(-1)![1]!.keepalive).toBe(false)
    })
})
