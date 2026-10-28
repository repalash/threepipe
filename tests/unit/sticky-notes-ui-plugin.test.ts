import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {NotesPlugin} from '../../plugins/tweakpane-editor/src/NotesPlugin'
import {StickyNotesUiPlugin} from '../../plugins/tweakpane-editor/src/StickyNotesUiPlugin'

// the node setup has no DOM: a small element with what the post-its use
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
    offsetWidth = 220
    offsetHeight = 150
    offsetLeft = 12
    offsetTop = 12
    clientWidth = 800
    clientHeight = 600
    /** The place on the page, for getBoundingClientRect */
    rect = {left: 0, top: 0, right: 0, bottom: 0}
    private _listeners = new Map<string, ((e: any) => void)[]>()
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        add: (c: string) => this.classList.toggle(c, true),
        toggle: (c: string, on: boolean) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    constructor(readonly tagName: string) {}
    getBoundingClientRect() {
        return this.rect
    }
    get parentElement() {
        return this.parent
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    replaceChildren() {
        for (const c of [...this.children]) c.remove()
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    contains(e: FakeElement) {
        return e === this || this.all().includes(e)
    }
    /** `button`, or classes like `.a, .b` */
    closest(selector: string): FakeElement | null {
        const match = (e: FakeElement) => selector.split(',').map(s => s.trim()).some(s => s.startsWith('.') ? e.classList.contains(s.slice(1)) : e.tagName === s)
        for (let e: FakeElement | undefined = this; e; e = e.parent) if (match(e)) return e
        return null
    }
    focus() {
        doc.activeElement = this
    }
    setPointerCapture() {}
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f({target: this, currentTarget: this, button: 0, pointerId: 1, preventDefault: () => {}, stopPropagation: () => {}, ...e})
    }
    /** All elements below this one, depth first */
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
    find(cls: string) {
        return this.all().filter(e => e.classList.contains(cls))
    }
    button(text: string) {
        return this.all().find(e => e.tagName === 'button' && e.textContent === text)!
    }
}

const doc = globalThis.document as any
const saved = {createElement: doc.createElement, addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener}
let storage: Map<string, string>
beforeAll(() => {
    StickyNotesUiPlugin.InjectStyles = false
    doc.createElement = (tag: string) => new FakeElement(tag)
    doc.addEventListener = () => {}
    doc.removeEventListener = () => {}
})
afterAll(() => {
    Object.assign(doc, saved)
    StickyNotesUiPlugin.InjectStyles = true
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

/** The notes and the post-its in a fake viewer */
function setup(options: ConstructorParameters<typeof NotesPlugin>[0] = {}) {
    const notes = new NotesPlugin(options)
    const sticky = new StickyNotesUiPlugin()
    const viewer = {
        container: new FakeElement('div'),
        addEventListener: () => {},
        removeEventListener: () => {},
        getPlugin: (c: any) => c === NotesPlugin ? notes : undefined,
        console,
    } as any
    notes.onAdded(viewer)
    sticky.onAdded(viewer)
    const layer = sticky.element as any as FakeElement
    return {notes, sticky, viewer, layer}
}

const cards = (layer: FakeElement) => layer.find('snp-card')

describe('StickyNotesUiPlugin', () => {
    test('the layer is on the canvas; the UI folder has the settings, not the notes', () => {
        const {sticky, viewer, layer} = setup()
        expect(viewer.container.children).toEqual([layer])
        expect(sticky.uiConfig.label).toBe('Sticky Notes')
        expect((sticky.uiConfig.children as any[]).map(c => c.label)).toEqual(['Show', 'Layout', 'Colour', 'Arrange', 'Reset places'])
        expect(sticky.toJSON).toBeUndefined()
    })

    test('board: a post-it per note, the dock adds a note in the store picked in its menu', () => {
        const {notes, layer} = setup()
        expect(cards(layer)).toHaveLength(0)
        layer.button('+ Note').fire('click')
        const menu = layer.find('snp-menu')[0]
        expect(menu.all().filter(e => e.tagName === 'button').map(b => b.textContent)).toEqual(['In the file', 'This browser'])
        menu.button('This browser').fire('click')
        expect(notes.notes.map(n => n.store)).toEqual(['browser'])
        expect(layer.find('snp-menu')).toHaveLength(0)
        expect(cards(layer)).toHaveLength(1)
        // the new note has the cursor
        expect(doc.activeElement).toBe(cards(layer)[0].all().find(e => e.tagName === 'textarea'))
        expect(cards(layer)[0].find('snp-badge')[0].textContent).toBe('This browser')
    })

    test('the store menu opens above a button at the bottom, inside the canvas', () => {
        const {layer} = setup()
        layer.rect = {left: 0, top: 0, right: 800, bottom: 600}
        const add = layer.button('+ Note')
        add.rect = {left: 16, top: 560, right: 70, bottom: 588}
        add.fire('click')
        const menu = layer.find('snp-menu')[0]
        // 150 high (the fake height): above the button, 4 px apart
        expect([menu.style.left, menu.style.top]).toEqual(['16px', '406px'])
    })

    test('with one store, + Note adds at once', () => {
        const {notes, layer} = setup({browser: false})
        layer.button('+ Note').fire('click')
        expect(notes.notes).toHaveLength(1)
        expect(layer.find('snp-menu')).toHaveLength(0)
    })

    test('typing keeps the same text box; × deletes the note; the badge moves it to another store', () => {
        const {notes, layer} = setup()
        notes.addNote('one')
        const text = cards(layer)[0].all().find(e => e.tagName === 'textarea')!
        text.focus()
        text.value = 'one more'
        text.fire('input')
        expect(notes.notes[0].text).toBe('one more')
        expect(cards(layer)[0].all().find(e => e.tagName === 'textarea')).toBe(text)

        cards(layer)[0].find('snp-badge')[0].fire('click')
        layer.find('snp-menu')[0].button('This browser').fire('click')
        expect(notes.notes[0].store).toBe('browser')
        expect(cards(layer)[0].find('snp-badge')[0].textContent).toBe('This browser')

        cards(layer)[0].button('×').fire('click')
        expect(notes.notes).toHaveLength(0)
        expect(cards(layer)).toHaveLength(0)
    })

    test('+ Context inserts the context line at the cursor', () => {
        const {notes, layer} = setup()
        notes.contextProvider = () => 'Move tool'
        notes.addNote('AB')
        const text = cards(layer)[0].all().find(e => e.tagName === 'textarea')!
        text.selectionStart = 1
        cards(layer)[0].button('+ Context').fire('click')
        expect(notes.notes[0].text).toMatch(/^A\n\[.+ · Move tool]\nB$/)
    })

    test('board: new post-its go below each other; dragging one moves it and keeps the place; Arrange puts them in columns', () => {
        const {notes, sticky, layer} = setup()
        const [a, b] = [notes.addNote('a'), notes.addNote('b')]
        const [ca, cb] = cards(layer)
        expect([ca.style.left, ca.style.top]).toEqual(['12px', '12px'])
        expect([cb.style.left, cb.style.top]).toEqual(['12px', '174px']) // 12 + 150 + 12

        const bar = cb.find('snp-bar')[0]
        bar.fire('pointerdown', {clientX: 20, clientY: 20})
        bar.fire('pointermove', {clientX: 320, clientY: 220})
        bar.fire('pointerup')
        expect([cb.style.left, cb.style.top]).toEqual(['312px', '212px'])
        expect(JSON.parse(storage.get('threepipe-sticky-notes')!).board[b.id]).toMatchObject({x: 312, y: 212})

        sticky.arrange()
        const state = JSON.parse(storage.get('threepipe-sticky-notes')!).board
        expect([state[a.id].x, state[a.id].y, state[b.id].x, state[b.id].y]).toEqual([12, 12, 12, 174])
    })

    test('board: the saved places of notes that load after the post-its are drawn are kept', async() => {
        storage.set('threepipe-notes', JSON.stringify([{id: 'n1', text: 'loads later', store: 'browser', created: 1}]))
        storage.set('threepipe-sticky-notes', JSON.stringify({layout: 'board', board: {n1: {x: 300, y: 200, w: 260, h: 180}}}))
        const {layer} = setup()
        // the stores load after the first drawing
        expect(cards(layer)).toHaveLength(0)
        await vi.waitFor(() => expect(cards(layer)).toHaveLength(1))
        expect([cards(layer)[0].style.left, cards(layer)[0].style.top, cards(layer)[0].style.width]).toEqual(['300px', '200px', '260px'])
        expect(JSON.parse(storage.get('threepipe-sticky-notes')!).board.n1).toMatchObject({x: 300, y: 200})
    })

    test('board: a deleted note forgets its place', () => {
        const {notes, layer} = setup()
        const n = notes.addNote('a')
        expect(JSON.parse(storage.get('threepipe-sticky-notes')!).board[n.id]).toBeTruthy()
        cards(layer)[0].button('×').fire('click')
        expect(JSON.parse(storage.get('threepipe-sticky-notes')!).board[n.id]).toBeUndefined()
    })

    test('a press on a button of the bar does not drag', () => {
        const {notes, layer} = setup()
        notes.addNote('a')
        const card = cards(layer)[0]
        const bar = card.find('snp-bar')[0]
        bar.fire('pointerdown', {target: card.button('Copy'), clientX: 20, clientY: 20})
        bar.fire('pointermove', {clientX: 320, clientY: 220})
        expect(card.style.left).toBe('12px')
    })

    test('stack: one post-it with the notes; Spread goes back to the board; the layout and colour are kept', () => {
        const {notes, sticky, layer} = setup()
        notes.addNote('a')
        notes.addNote('b', 'browser')
        layer.button('Stack').fire('click')
        expect(sticky.layout).toBe('stack')
        expect(cards(layer)).toHaveLength(1)
        expect(layer.find('snp-note')).toHaveLength(2)
        expect(layer.find('snp-count')[0].textContent).toBe('2')

        layer.button('–').fire('click')
        expect(cards(layer)[0].classList.contains('snp-collapsed')).toBe(true)

        sticky.color = 'blue'
        expect(layer.dataset.color).toBe('blue')
        expect(JSON.parse(storage.get('threepipe-sticky-notes')!)).toMatchObject({layout: 'stack', color: 'blue', stack: {collapsed: true}})
        const again = new StickyNotesUiPlugin()
        expect([again.layout, again.color]).toEqual(['stack', 'blue'])

        layer.button('Spread').fire('click')
        expect(sticky.layout).toBe('board')
        expect(cards(layer)).toHaveLength(2)
    })

    test('Show hides the layer; removing the plugin removes it', () => {
        const {sticky, viewer, layer} = setup()
        sticky.shown = false
        expect(layer.style.display).toBe('none')
        sticky.onRemove(viewer)
        expect(viewer.container.children).toEqual([])
    })
})
