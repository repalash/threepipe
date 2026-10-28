import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {NotesPlugin} from '../../plugins/tweakpane-editor/src/NotesPlugin'
import {StickyNotesPlugin} from '../../plugins/tweakpane-editor/src/StickyNotesPlugin'

// the node setup has no DOM: a small element with what the notes and the card use
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
    style: Record<string, string> = {}
    dataset: Record<string, string> = {}
    offsetWidth = 260
    offsetHeight = 200
    offsetLeft = 12
    offsetTop = 388
    clientWidth = 800
    clientHeight = 600
    private _listeners = new Map<string, ((e: any) => void)[]>()
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        toggle: (c: string, on: boolean) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    constructor(readonly tagName: string) {}
    get parentElement() {
        return this.parent
    }
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
    closest(tag: string) {
        return this.tagName === tag ? this : null
    }
    setPointerCapture() {}
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f({target: this, currentTarget: this, button: 0, pointerId: 1, preventDefault: () => {}, ...e})
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
    StickyNotesPlugin.InjectStyles = false
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    doc.createElement = createElement
    NotesPlugin.InjectStyles = true
    StickyNotesPlugin.InjectStyles = true
})
beforeEach(() => {
    doc.activeElement = null
    storage = new Map()
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    })
    vi.stubGlobal('addEventListener', () => {})
    vi.stubGlobal('removeEventListener', () => {})
})
afterEach(() => {
    vi.unstubAllGlobals()
})

function fakeViewer() {
    return {
        container: new FakeElement('div'),
        addEventListener: () => {},
        removeEventListener: () => {},
        getPlugin: () => undefined,
        console,
    } as any
}

function card(notes: StickyNotesPlugin) {
    const c = notes.card as any as FakeElement
    return {
        card: c,
        head: c.children[0],
        collapse: c.all().find(e => e.className === 'snp-collapse')!,
        text: c.all().find(e => e.tagName === 'textarea')!,
    }
}

describe('StickyNotesPlugin', () => {
    test('the note is on the canvas, and the UI folder has the settings, not the notes', () => {
        const notes = new StickyNotesPlugin()
        const viewer = fakeViewer()
        notes.onAdded(viewer)
        expect(viewer.container.children).toEqual([notes.card])
        expect(card(notes).card.children[1]).toBe(notes.element)
        expect(notes.uiConfig.label).toBe('Sticky Notes')
        expect(notes.uiConfig.domChildren).toBeUndefined()
        expect((notes.uiConfig.children as any[]).map(c => c.label)).toEqual(['Show', 'Colour', 'Collapsed', 'Save in the file', 'Reset position', 'Clear scene notes'])

        notes.onRemove(viewer)
        expect(viewer.container.children).toEqual([])
    })

    test('colour and show', () => {
        const notes = new StickyNotesPlugin()
        expect(notes.card.dataset.color).toBe('yellow')
        notes.color = 'blue'
        expect(notes.card.dataset.color).toBe('blue')
        notes.shown = false
        expect(notes.card.style.display).toBe('none')
        notes.shown = true
        expect(notes.card.style.display).toBe('')
    })

    test('the colour is serialized; the scene notes only with "Save in the file"', () => {
        const notes = new StickyNotesPlugin()
        notes.color = 'pink'
        notes.sceneNotes = 'Check the prongs'
        expect(notes.toJSON()).toMatchObject({color: 'pink', saveSceneNotes: true, sceneNotes: 'Check the prongs'})

        notes.saveSceneNotes = false
        const data = notes.toJSON()
        expect(data.sceneNotes).toBeUndefined()
        expect(data.saveSceneNotes).toBe(false)

        const loaded = new StickyNotesPlugin()
        loaded.fromJSON({...notes.toJSON()})
        expect(loaded.color).toBe('pink')
        expect(loaded.sceneNotes).toBe('')
    })

    test('collapse hides the notes and is kept per page key', () => {
        const notes = new StickyNotesPlugin({pageKey: 'k'})
        const {card: c, collapse} = card(notes)
        expect(collapse.textContent).toBe('–')
        collapse.fire('click')
        expect(notes.collapsed).toBe(true)
        expect(c.classList.contains('snp-collapsed')).toBe(true)
        expect(collapse.title).toBe('Expand')
        expect(JSON.parse(storage.get('k:sticky')!).collapsed).toBe(true)

        expect(new StickyNotesPlugin({pageKey: 'k'}).collapsed).toBe(true)
        expect(new StickyNotesPlugin({pageKey: 'other'}).collapsed).toBe(false)
    })

    test('dragging the header moves the note inside the canvas, and the place is kept', () => {
        const notes = new StickyNotesPlugin({pageKey: 'k'})
        notes.onAdded(fakeViewer())
        const {card: c, head} = card(notes)
        head.fire('pointerdown', {clientX: 20, clientY: 400})
        head.fire('pointermove', {clientX: 120, clientY: 300})
        expect([c.style.left, c.style.top]).toEqual(['112px', '288px'])
        head.fire('pointermove', {clientX: 2000, clientY: -500})
        expect([c.style.left, c.style.top]).toEqual(['540px', '0px']) // 800 - 260 wide, the top edge
        head.fire('pointerup')
        expect(JSON.parse(storage.get('k:sticky')!)).toMatchObject({x: 1992, y: -512})

        const again = new StickyNotesPlugin({pageKey: 'k'})
        again.onAdded(fakeViewer())
        expect([card(again).card.style.left, card(again).card.style.top]).toEqual(['540px', '0px'])

        again.resetPosition()
        expect([card(again).card.style.left, card(again).card.style.top]).toEqual(['', ''])
        expect(JSON.parse(storage.get('k:sticky')!).x).toBeUndefined()
    })

    test('a collapsed note dragged to the bottom moves up when it expands, to stay inside the canvas', () => {
        const notes = new StickyNotesPlugin()
        notes.onAdded(fakeViewer())
        const {card: c, head, collapse} = card(notes)
        collapse.fire('click')
        c.offsetHeight = 30 // the header only
        head.fire('pointerdown', {clientX: 20, clientY: 400})
        head.fire('pointermove', {clientX: 20, clientY: 2000})
        head.fire('pointerup')
        expect(c.style.top).toBe('570px') // 600 - 30
        c.offsetHeight = 200
        collapse.fire('click')
        expect(c.style.top).toBe('400px') // 600 - 200
    })

    test('a press on the collapse button does not start a drag', () => {
        const notes = new StickyNotesPlugin()
        notes.onAdded(fakeViewer())
        const {card: c, head, collapse} = card(notes)
        head.fire('pointerdown', {target: collapse, clientX: 20, clientY: 400})
        head.fire('pointermove', {clientX: 120, clientY: 300})
        expect(c.style.left).toBe('')
    })

    test('the notes work as in NotesPlugin: typing sets the scene notes', () => {
        const notes = new StickyNotesPlugin()
        const {text} = card(notes)
        text.value = 'on the post-it'
        text.fire('input')
        expect(notes.sceneNotes).toBe('on the post-it')
    })
})
