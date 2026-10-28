import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {NotesPlugin} from '../../plugins/tweakpane-editor/src/NotesPlugin'

// the node setup has no DOM: a small element with what the notes use
class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    textContent = ''
    title = ''
    value = ''
    placeholder = ''
    spellcheck = false
    selectionStart: number | null = null
    selectionEnd: number | null = null
    private _listeners = new Map<string, ((e: any) => void)[]>()
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        toggle: (c: string, on: boolean) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    constructor(readonly tagName: string) {}
    appendChild(c: FakeElement) {
        c.parent = this
        this.children.push(c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    focus() {
        doc.activeElement = this
    }
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f(e)
    }
    /** All elements below this one, depth first */
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
}

const doc = globalThis.document as any
const createElement = doc.createElement
let storage: Map<string, string>
beforeAll(() => {
    NotesPlugin.InjectStyles = false
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    doc.createElement = createElement
    NotesPlugin.InjectStyles = true
})
beforeEach(() => {
    doc.activeElement = null
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

function ui(notes: NotesPlugin) {
    const all = (notes.element as any as FakeElement).all()
    const button = (text: string) => all.find(e => e.tagName === 'button' && e.textContent.startsWith(text))!
    return {
        text: all.find(e => e.tagName === 'textarea')!,
        scene: button('Scene'),
        page: button('Page'),
        context: button('+ Context'),
        status: all.find(e => e.className === 'np-status')!,
    }
}

function type(notes: NotesPlugin, value: string) {
    const {text} = ui(notes)
    text.value = value
    text.fire('input')
}

/** A viewer with what the plugin uses, and a PickingPlugin with these objects selected */
function fakeViewer(selected: any[] = []) {
    return {
        addEventListener: () => {},
        removeEventListener: () => {},
        getPlugin: () => ({getSelectedObjects: () => selected}),
        console,
    } as any
}

describe('NotesPlugin', () => {
    test('the scene notes are serialized, and loaded notes show in the scene tab', () => {
        const notes = new NotesPlugin()
        type(notes, 'Check the prongs')
        expect(notes.sceneNotes).toBe('Check the prongs')
        expect(notes.toJSON().sceneNotes).toBe('Check the prongs')

        const loaded = new NotesPlugin()
        loaded.fromJSON({...notes.toJSON()})
        expect(loaded.tab).toBe('scene')
        expect(ui(loaded).text.value).toBe('Check the prongs')
    })

    test('the UI folder shows the notes element', () => {
        const notes = new NotesPlugin()
        expect(notes.uiConfig.label).toBe('Notes')
        expect(notes.uiConfig.domChildren).toEqual([notes.element])
    })

    test('the page notes are kept in localStorage 600 ms after the last key', () => {
        vi.useFakeTimers()
        const notes = new NotesPlugin({pageKey: 'my-notes'})
        ui(notes).page.fire('click')
        expect(notes.tab).toBe('page')
        type(notes, 'a')
        vi.advanceTimersByTime(400)
        type(notes, 'ab')
        vi.advanceTimersByTime(400)
        expect(storage.has('my-notes')).toBe(false)
        vi.advanceTimersByTime(200)
        expect(storage.get('my-notes')).toBe('ab')
        expect(notes.sceneNotes).toBe('')
    })

    test('notes typed just before the plugin is removed are kept', () => {
        vi.useFakeTimers()
        const notes = new NotesPlugin()
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        notes.setTab('page')
        type(notes, 'last words')
        notes.onRemove(viewer)
        expect(storage.get('threepipe-page-notes')).toBe('last words')
    })

    test('the page tab opens when only the page has notes, until a tab is picked', () => {
        storage.set('threepipe-page-notes', 'from before')
        const notes = new NotesPlugin()
        expect(notes.tab).toBe('page')
        expect(ui(notes).text.value).toBe('from before')
        expect(ui(notes).page.classList.contains('on')).toBe(true)

        ui(notes).page.fire('click')
        notes.sceneNotes = 'loaded with a file'
        expect(notes.tab).toBe('page')

        const other = new NotesPlugin()
        other.sceneNotes = 'loaded with a file'
        expect(other.tab).toBe('scene')
    })

    test('+ Context inserts the time, the context and the selected names at the cursor', () => {
        const notes = new NotesPlugin({contextProvider: () => 'Move tool'})
        notes.onAdded(fakeViewer([{name: 'Ring'}, {name: '', type: 'Mesh'}]))
        type(notes, 'AB')
        const {text} = ui(notes)
        text.selectionStart = 1
        notes.addContext()
        expect(text.value).toMatch(/^A\n\[.+ · Move tool · selected: Ring, Mesh]\nB$/)
        expect(notes.sceneNotes).toBe(text.value)
        expect(text.selectionStart).toBe(text.value.length - 1)
    })

    test('keys in the notes do not reach the viewer shortcuts', () => {
        const notes = new NotesPlugin()
        const stop = vi.fn()
        ui(notes).text.fire('keydown', {stopPropagation: stop})
        expect(stop).toHaveBeenCalled()
    })

    test('with syncUrl, the longer page notes win at the start and edits are posted', async() => {
        vi.useFakeTimers()
        storage.set('threepipe-page-notes', 'short')
        const fetch = vi.fn(async(_url: string, init?: RequestInit) => ({
            ok: true,
            json: async() => init ? {} : {text: 'longer notes from the server'},
        }))
        vi.stubGlobal('fetch', fetch)
        const notes = new NotesPlugin({syncUrl: '/notes'})
        notes.onAdded(fakeViewer())
        await vi.waitFor(() => expect(notes.pageNotes).toBe('longer notes from the server'))
        expect(ui(notes).text.value).toBe('longer notes from the server')
        expect(ui(notes).status.textContent).toBe('browser + server')

        type(notes, 'edited')
        vi.advanceTimersByTime(600)
        expect(storage.get('threepipe-page-notes')).toBe('edited')
        expect(fetch).toHaveBeenLastCalledWith('/notes', expect.objectContaining({method: 'POST', body: JSON.stringify({text: 'edited'})}))
    })

    test('with syncUrl, the merged notes are kept in the browser and sent to the server without an edit', async() => {
        const server = (text: string) => vi.fn(async(_url: string, init?: RequestInit) => ({ok: true, json: async() => init ? {} : {text}}))
        // the server notes are longer: they are kept in this browser too
        storage.set('threepipe-page-notes', 'short')
        let fetch = server('longer notes from the server')
        vi.stubGlobal('fetch', fetch)
        new NotesPlugin({syncUrl: '/notes'}).onAdded(fakeViewer())
        await vi.waitFor(() => expect(storage.get('threepipe-page-notes')).toBe('longer notes from the server'))
        expect(fetch).toHaveBeenCalledTimes(1)

        // the browser notes are longer: they are sent to the server
        storage.set('threepipe-page-notes', 'longer notes from this browser')
        fetch = server('short')
        vi.stubGlobal('fetch', fetch)
        new NotesPlugin({syncUrl: '/notes'}).onAdded(fakeViewer())
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        expect(fetch).toHaveBeenLastCalledWith('/notes', expect.objectContaining({method: 'POST', body: JSON.stringify({text: 'longer notes from this browser'})}))
    })

    test('with syncUrl, edits made while the server answers are not replaced by the server notes', async() => {
        vi.useFakeTimers()
        let answer!: (v: any) => void
        const fetch = vi.fn(async(_url: string, init?: RequestInit) => init ? {ok: true, json: async() => ({})} : new Promise(r => answer = r))
        vi.stubGlobal('fetch', fetch)
        const notes = new NotesPlugin({syncUrl: '/notes'})
        notes.onAdded(fakeViewer())
        notes.setTab('page')
        type(notes, 'typed now')
        answer({ok: true, json: async() => ({text: 'much longer notes from the server'})})
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        expect(notes.pageNotes).toBe('typed now')
        expect(ui(notes).text.value).toBe('typed now')
        expect(storage.get('threepipe-page-notes')).toBe('typed now')
        expect(fetch).toHaveBeenLastCalledWith('/notes', expect.objectContaining({method: 'POST', body: JSON.stringify({text: 'typed now'})}))
    })

    test('a server that fails keeps the notes in the browser only', async() => {
        vi.useFakeTimers()
        const fetch = vi.fn(async() => ({ok: false, json: async() => ({})}))
        vi.stubGlobal('fetch', fetch)
        const notes = new NotesPlugin({syncUrl: '/notes'})
        notes.onAdded(fakeViewer())
        notes.setTab('page')
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
        type(notes, 'local')
        vi.advanceTimersByTime(600)
        expect(storage.get('threepipe-page-notes')).toBe('local')
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(ui(notes).status.textContent).toBe('this browser')
    })
})
