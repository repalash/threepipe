import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {NoteItem, NotesPlugin} from '../../plugins/tweakpane-editor/src/NotesPlugin'
import {StickyNotesUiPlugin} from '../../plugins/tweakpane-editor/src/StickyNotesUiPlugin'
import {readFileSync} from 'node:fs'

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
        remove: (c: string) => this.classList.toggle(c, false),
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
    insertBefore(c: FakeElement, before: FakeElement) {
        c.remove()
        c.parent = this
        const i = this.children.indexOf(before)
        this.children.splice(i < 0 ? this.children.length : i, 0, c)
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
function setup(options: ConstructorParameters<typeof NotesPlugin>[0] = {}, canvas = {width: 800, height: 600}) {
    const notes = new NotesPlugin(options)
    const sticky = new StickyNotesUiPlugin()
    // the canvas, and the dock at its bottom: 28 px high, 12 px above the bottom edge
    const layer = sticky.element as any as FakeElement
    layer.clientWidth = canvas.width
    layer.clientHeight = canvas.height
    ;(sticky.dock as any as FakeElement).offsetTop = canvas.height - 40
    const viewer = {
        container: new FakeElement('div'),
        addEventListener: () => {},
        removeEventListener: () => {},
        getPlugin: (c: any) => c === NotesPlugin ? notes : undefined,
        console,
    } as any
    notes.onAdded(viewer)
    sticky.onAdded(viewer)
    return {notes, sticky, viewer, layer}
}

const cards = (layer: FakeElement) => layer.find('snp-card')
/** The texts of the buttons that show in the dock */
const dockButtons = (layer: FakeElement) => layer.find('snp-dock')[0].all().filter(b => b.style.display !== 'none').map(b => b.textContent)
/** What the ResizeObserver does when a post-it changes size */
const resized = (sticky: StickyNotesUiPlugin, card: FakeElement) => (sticky as any)._cardResized((sticky as any)._byElement.get(card))

describe('StickyNotesUiPlugin', () => {
    const text = (c: FakeElement) => c.all().find(e => e.tagName === 'textarea')!
    const place = (c: FakeElement) => [c.style.left, c.style.top]
    const state = () => JSON.parse(storage.get('threepipe-sticky-notes')!)
    /** Drags a post-it by its bar (the free part, not a button) */
    const drag = (c: FakeElement, dx: number, dy: number) => {
        const bar = c.find('snp-bar')[0]
        const target = c.find('snp-fill')[0]
        c.fire('pointerdown', {target})
        bar.fire('pointerdown', {target, clientX: 20, clientY: 20})
        bar.fire('pointermove', {clientX: 20 + dx / 2, clientY: 20 + dy / 2})
        bar.fire('pointermove', {clientX: 20 + dx, clientY: 20 + dy})
        bar.fire('pointerup')
    }

    test('the layer is on the canvas with the dock; the UI folder has the settings, not the notes', () => {
        const {sticky, viewer, layer} = setup()
        expect(viewer.container.children).toEqual([layer])
        expect(dockButtons(layer)).toEqual(['+ Note', '▾', 'Arrange', 'Stack', 'Minimise'])
        expect(sticky.uiConfig.label).toBe('Sticky Notes')
        expect((sticky.uiConfig.children as any[]).map(c => c.label)).toEqual(['Show', 'Layout', 'Colour', 'Arrange', 'Reset places'])
        expect(sticky.toJSON).toBeUndefined()
    })

    test('+ Note adds a note at once, on top and with the cursor in it; ▾ picks the store', () => {
        const {notes, layer} = setup()
        layer.button('+ Note').fire('click')
        expect(notes.notes.map(n => n.store)).toEqual(['file'])
        expect(cards(layer)).toHaveLength(1)
        expect(doc.activeElement).toBe(text(cards(layer)[0]))
        expect(cards(layer)[0].classList.contains('snp-new')).toBe(true)

        layer.button('▾').fire('click')
        const menu = layer.find('snp-menu')[0]
        expect(menu.all().filter(e => e.tagName === 'button').map(b => b.textContent)).toEqual(['In the file', 'This browser'])
        menu.button('This browser').fire('click')
        expect(notes.notes.map(n => n.store)).toEqual(['file', 'browser'])
        expect(layer.find('snp-menu')).toHaveLength(0)
        const top = cards(layer).find(c => c.style.zIndex === '2')!
        expect(top.find('snp-badge')[0].textContent).toBe('This browser')
    })

    test('typing keeps the same post-it and text box; × deletes the note; the badge moves it to another store', () => {
        const {notes, layer} = setup()
        notes.addNote('one')
        const card = cards(layer)[0]
        const box = text(card)
        box.focus()
        box.value = 'one more'
        box.fire('input')
        expect(notes.notes[0].text).toBe('one more')
        expect(cards(layer)[0]).toBe(card)
        expect(text(cards(layer)[0])).toBe(box)

        card.find('snp-badge')[0].fire('click')
        layer.find('snp-menu')[0].button('This browser').fire('click')
        expect(notes.notes[0].store).toBe('browser')
        expect(cards(layer)[0]).toBe(card)
        expect(card.find('snp-badge')[0].textContent).toBe('This browser')

        card.button('×').fire('click')
        expect(notes.notes).toHaveLength(0)
        expect(cards(layer)).toHaveLength(0)
    })

    test('typing changes only its post-it; a move to another store lays the post-its out again', () => {
        const {notes, layer} = setup()
        notes.addNote('a')
        notes.addNote('b')
        const [ca, cb] = cards(layer)
        cb.style.left = 'untouched'
        cb.find('snp-badge')[0].title = 'untouched'
        const box = text(ca)
        box.value = 'a, typed'
        box.fire('input')
        expect(notes.notes[0].text).toBe('a, typed')
        expect([cb.style.left, cb.find('snp-badge')[0].title]).toEqual(['untouched', 'untouched'])

        notes.updateNote(notes.notes[0].id, {store: 'browser'})
        expect(ca.find('snp-badge')[0].textContent).toBe('This browser')
        expect(cb.style.left).toBe('12px')
    })

    test('a change of the text by the app shows in the note being typed in, with the cursor kept', () => {
        const {notes, layer} = setup()
        const n = notes.addNote('typed')
        const box = text(cards(layer)[0])
        box.focus()
        box.selectionStart = box.selectionEnd = 3
        notes.updateNote(n.id, {text: 'typed, and changed by the app'})
        expect(box.value).toBe('typed, and changed by the app')
        expect([box.selectionStart, box.selectionEnd]).toEqual([3, 3])
    })

    test('a click on the badge of another note opens the menu of that note; on the same badge, it closes it', () => {
        const {notes, layer} = setup()
        notes.addNote('a')
        notes.addNote('b')
        const [ca, cb] = cards(layer)
        ca.find('snp-badge')[0].fire('click')
        expect(layer.find('snp-menu')).toHaveLength(1)
        cb.find('snp-badge')[0].fire('click')
        expect(layer.find('snp-menu')).toHaveLength(1)
        layer.find('snp-menu')[0].button('This browser').fire('click')
        expect(notes.notes.find(n => n.text === 'b')!.store).toBe('browser')
        expect(notes.notes.find(n => n.text === 'a')!.store).toBe('file')
        ca.find('snp-badge')[0].fire('click')
        ca.find('snp-badge')[0].fire('click')
        expect(layer.find('snp-menu')).toHaveLength(0)
    })

    test('+ Context inserts the context line at the cursor', () => {
        const {notes, layer} = setup()
        notes.contextProvider = () => 'Move tool'
        notes.addNote('AB')
        const box = text(cards(layer)[0])
        box.selectionStart = 1
        cards(layer)[0].button('+ Context').fire('click')
        expect(notes.notes[0].text).toMatch(/^A\n\[.+ · Move tool]\nB$/)
    })

    test('board: new post-its go below each other; a drag moves one, ends on release and keeps the place; Arrange', () => {
        const {notes, sticky, layer} = setup()
        const [a, b] = [notes.addNote('a'), notes.addNote('b')]
        const [ca, cb] = cards(layer)
        expect(place(ca)).toEqual(['12px', '12px'])
        expect(place(cb)).toEqual(['12px', '174px']) // 12 + 150 + 12

        ca.style.left = 'untouched'
        drag(cb, 300, 200)
        expect(place(cb)).toEqual(['312px', '374px'])
        expect(ca.style.left).toBe('untouched') // only the post-it dragged moves
        ca.style.left = '12px'
        expect(state().board[b.id]).toMatchObject({x: 312, y: 374})
        // after the release, the pointer moves the post-it no more
        cb.find('snp-bar')[0].fire('pointermove', {clientX: 600, clientY: 500})
        expect(place(cb)).toEqual(['312px', '374px'])

        sticky.arrange()
        expect([state().board[a.id].y, state().board[b.id].y]).toEqual([12, 174])
        expect(place(cb)).toEqual(['12px', '174px'])
    })

    test('board: a column that is full starts the next one, beside its widest post-it', () => {
        const {notes, sticky, layer} = setup()
        notes.addNote('wide')
        const wide = cards(layer)[0]
        wide.offsetWidth = 300
        resized(sticky, wide)
        for (let i = 0; i < 6; i++) notes.addNote(String(i))
        // 600 px high: three post-its in a column (12, 174, 336), as 498 + 150 is more than 600 - 12
        expect(cards(layer).map(place)).toEqual([
            ['12px', '12px'], ['12px', '174px'], ['12px', '336px'],
            ['324px', '12px'], ['324px', '174px'], ['324px', '336px'], // 12 + 300 + 12
            ['556px', '12px'], // 324 + 220 + 12
        ])
    })

    /** The place and size of each post-it, in px */
    const boxes = (layer: FakeElement) => cards(layer).map(c => ['left', 'top', 'width', 'height'].map(k => parseFloat(c.style[k])))
    const phone = {width: 390, height: 844}

    test('board on a phone: each new post-it is inside the canvas and above the dock; a full canvas starts again a little lower', () => {
        const {notes, layer} = setup({}, phone)
        for (let i = 0; i < 12; i++) {
            notes.addNote(String(i))
            const [x, y, w, h] = boxes(layer)[i]
            expect(x).toBeGreaterThanOrEqual(0)
            expect(y).toBeGreaterThanOrEqual(0)
            expect(x + w).toBeLessThanOrEqual(390)
            expect(y + h).toBeLessThanOrEqual(804 - 12) // above the dock
        }
        // one column fits: 4 post-its (12, 174, 336, 498), then the column again 24 px right and down
        expect(boxes(layer).slice(0, 6).map(([x, y]) => [x, y])).toEqual([[12, 12], [12, 174], [12, 336], [12, 498], [36, 36], [36, 198]])
    })

    test('stack on a phone: the pile, with each new post-it on top, is inside the canvas and above the dock', () => {
        const {notes, sticky, layer} = setup({}, phone)
        sticky.layout = 'stack'
        for (let i = 0; i < 8; i++) {
            notes.addNote(String(i))
            for (const [x, y, w, h] of boxes(layer).filter((_, j) => cards(layer)[j].style.visibility !== 'hidden')) {
                expect(x).toBeGreaterThanOrEqual(0)
                expect(y).toBeGreaterThanOrEqual(0)
                expect(x + w).toBeLessThanOrEqual(390)
                expect(y + h).toBeLessThanOrEqual(804 - 12)
            }
        }
    })

    test('the layer does not scroll: a focus never moves the post-its away from their places', () => {
        const {layer} = setup()
        layer.button('+ Note').fire('click')
        ;(layer as any).scrollTop = 120
        ;(layer as any).scrollLeft = 40
        layer.fire('scroll')
        expect([(layer as any).scrollTop, (layer as any).scrollLeft]).toEqual([0, 0])
    })

    test('a press on a post-it brings it up; on a button of its bar, it does not drag', () => {
        const {notes, layer} = setup()
        notes.addNote('a')
        notes.addNote('b')
        const [ca] = cards(layer)
        expect([ca.style.zIndex, cards(layer)[1].style.zIndex]).toEqual(['1', '2'])
        ca.fire('pointerdown', {target: ca})
        expect([ca.style.zIndex, cards(layer)[1].style.zIndex]).toEqual(['2', '1'])

        const bar = ca.find('snp-bar')[0]
        bar.fire('pointerdown', {target: ca.button('Copy'), clientX: 20, clientY: 20})
        bar.fire('pointermove', {clientX: 320, clientY: 220})
        expect(place(ca)).toEqual(['12px', '12px'])
    })

    test('a drag the canvas does not hold keeps the post-it inside it', () => {
        const {notes, layer} = setup()
        notes.addNote('a')
        drag(cards(layer)[0], 5000, 5000)
        expect(place(cards(layer)[0])).toEqual(['580px', '450px']) // 800 - 220, 600 - 150
    })

    test('stack: the post-its lie on a pile with offsets; a click on one behind brings it up; the pile drags as one', () => {
        const {notes, sticky, layer} = setup()
        const [a, b, c] = [notes.addNote('a'), notes.addNote('b'), notes.addNote('c')]
        layer.find('snp-dock')[0].offsetTop = 560
        layer.button('Stack').fire('click')
        expect(sticky.layout).toBe('stack')
        const byId = (id: string) => cards(layer)[notes.notes.findIndex(n => n.id === id)]
        // c on top at the corner of the pile (260 x 190 above the dock), b and a 8 px left and up each: the pile goes
        // toward -x, and its last post-it is at the left edge of the dock
        expect(place(byId(c.id))).toEqual(['28px', '358px']) // above the dock: 560 - 190 - 12
        expect(place(byId(b.id))).toEqual(['20px', '350px'])
        expect(place(byId(a.id))).toEqual(['12px', '342px'])
        expect(byId(a.id).classList.contains('snp-behind')).toBe(true)
        expect(byId(c.id).classList.contains('snp-behind')).toBe(false)

        byId(a.id).fire('pointerdown', {target: byId(a.id)})
        expect(place(byId(a.id))).toEqual(['28px', '358px'])
        expect(byId(c.id).classList.contains('snp-behind')).toBe(true)

        drag(byId(a.id), 100, -100)
        expect(place(byId(a.id))).toEqual(['128px', '258px'])
        expect(place(byId(c.id))).toEqual(['120px', '250px'])
        expect(state().stack).toMatchObject({x: 128, y: 258})

        // dragged against the left edge, the post-its under the top one stay on the canvas
        drag(byId(a.id), -500, 0)
        expect(cards(layer).map(c => parseFloat(c.style.left)).sort((x, y) => x - y)).toEqual([0, 8, 16])

        sticky.color = 'blue'
        expect(layer.dataset.color).toBe('blue')
        expect(state()).toMatchObject({layout: 'stack', color: 'blue'})
        const again = new StickyNotesUiPlugin()
        expect([again.layout, again.color]).toEqual(['stack', 'blue'])

        layer.button('Spread').fire('click')
        expect(sticky.layout).toBe('board')
        expect(byId(c.id).classList.contains('snp-behind')).toBe(false)
    })

    test('minimized: the post-its leave the canvas, a button with the count stays; a click on it brings back the last layout', () => {
        const {notes, sticky, layer} = setup()
        notes.addNote('a')
        notes.addNote('b')
        layer.button('Stack').fire('click')
        layer.button('Minimise').fire('click')
        expect(sticky.layout).toBe('minimized')
        expect(layer.dataset.layout).toBe('minimized') // the stylesheet hides the post-its
        expect(dockButtons(layer)).toEqual(['Notes · 2'])
        expect(state()).toMatchObject({layout: 'minimized', open: 'stack'})
        notes.addNote('c')
        expect(dockButtons(layer)).toEqual(['Notes · 3'])
        expect(new StickyNotesUiPlugin().layout).toBe('minimized')

        layer.button('Notes · 3').fire('click')
        expect(sticky.layout).toBe('stack')
        expect(dockButtons(layer)).toEqual(['+ Note', '▾', 'Spread', 'Minimise'])
        expect(state()).toMatchObject({layout: 'stack', open: 'stack'})

        // the setting has the mode too; a note added from the plugin brings the post-its back
        const layout = (sticky.uiConfig.children as any[]).find(c => c.label === 'Layout')
        expect(layout.children.map((o: any) => o.value)).toEqual(['board', 'stack', 'minimized'])
        sticky.layout = 'minimized'
        sticky.addNote()
        expect(sticky.layout).toBe('stack')
        // a layout kept from before minimises and comes back
        storage.set('threepipe-sticky-notes', JSON.stringify({layout: 'stack'}))
        const again = new StickyNotesUiPlugin()
        again.layout = 'minimized'
        ;(again.dock as any as FakeElement).find('snp-restore')[0].fire('click')
        expect(again.layout).toBe('stack')
    })

    test('board: the saved places of notes that load after the post-its are drawn are kept', async() => {
        storage.set('threepipe-sticky-notes', JSON.stringify({layout: 'board', board: {n1: {x: 300, y: 200, w: 260, h: 180}}}))
        // a store that answers later, like a server
        const server = {id: 'server', label: 'Server', save: () => {}, load: async() => [{id: 'n1', text: 'loads later', store: 'server', created: 1}]}
        const {layer} = setup({stores: [server]})
        expect(cards(layer)).toHaveLength(0)
        await vi.waitFor(() => expect(cards(layer)).toHaveLength(1))
        const c = cards(layer)[0]
        expect([c.style.left, c.style.top, c.style.width]).toEqual(['300px', '200px', '260px'])
        expect(state().board.n1).toMatchObject({x: 300, y: 200})
    })

    test('the saved order keeps the notes of a store that still loads, so the pile comes back as it was', async() => {
        storage.set('threepipe-sticky-notes', JSON.stringify({layout: 'stack', order: ['s1', 'm1']}))
        let answer!: (notes: NoteItem[]) => void
        const server = {id: 'server', label: 'Server', save: () => {}, load: async() => new Promise<NoteItem[]>(r => answer = r)}
        const mem = {id: 'mem', label: 'Memory', save: () => {}, load: () => [{id: 'm1', text: 'on top', store: 'mem', created: 1}]}
        const {notes, sticky, layer} = setup({file: false, browser: false, stores: [mem, server]})
        // while the server loads: settings and a press on a loaded note write the state
        sticky.color = 'blue'
        cards(layer)[0].fire('pointerdown', {target: cards(layer)[0]})
        expect(state().order).toEqual(['s1', 'm1'])

        answer([{id: 's1', text: 'below', store: 'server', created: 2}])
        await vi.waitFor(() => expect(cards(layer)).toHaveLength(2))
        const top = cards(layer).find(c => c.style.zIndex === '2')!
        expect(text(top).value).toBe('on top')
        expect(state().order).toEqual(['s1', 'm1'])

        // a note made now goes on top; a deleted note leaves the order
        const n = notes.addNote('new', 'mem')
        sticky.color = 'green'
        expect(state().order).toEqual(['s1', 'm1', n.id])
        notes.removeNote('s1')
        expect(state().order).toEqual(['m1', n.id])
    })

    /** A store that answers when `answer` is called, like a server */
    const slowStore = (id: string) => {
        let answer!: (notes: NoteItem[]) => void
        const store = {id, label: id, save: () => {}, load: async() => new Promise<NoteItem[]>(r => answer = r)}
        return {store, answer: (notes: NoteItem[]) => answer(notes)}
    }
    const savedPlaces = () => storage.set('threepipe-sticky-notes', JSON.stringify({layout: 'board', board: {s1: {x: 300, y: 200, w: 260, h: 180}}, order: ['s1']}))

    test('clear() of a store while another store loads keeps the places and the order of the notes that load', async() => {
        savedPlaces()
        const server = slowStore('server')
        const {notes, layer} = setup({browser: false, stores: [server.store]})
        notes.addNote('f1', 'file')
        notes.addNote('f2', 'file')
        notes.clear('file')
        expect(cards(layer)).toHaveLength(0)
        expect(state().board.s1).toMatchObject({x: 300, y: 200})
        expect(state().order).toEqual(['s1'])

        server.answer([{id: 's1', text: 'loads later', store: 'server', created: 1}])
        await vi.waitFor(() => expect(cards(layer)).toHaveLength(1))
        expect([cards(layer)[0].style.left, cards(layer)[0].style.top, cards(layer)[0].style.width]).toEqual(['300px', '200px', '260px'])
    })

    test('a store replaced with addStore while another store loads keeps the places and the order of the notes that load', async() => {
        savedPlaces()
        const server = slowStore('server')
        const mem = {id: 'mem', label: 'Memory', save: () => {}, load: () => [{id: 'm1', text: 'm', store: 'mem', created: 1}]}
        const {notes, layer} = setup({file: false, browser: false, stores: [mem, server.store]})
        expect(state().board.m1).toBeTruthy()
        notes.addStore({...mem, load: () => []})
        expect(cards(layer)).toHaveLength(0)
        expect(state().board.m1).toBeUndefined() // the notes of the replaced store are removed
        expect(state().board.s1).toMatchObject({x: 300, y: 200})
        expect(state().order).toEqual(['s1'])

        server.answer([{id: 's1', text: 'loads later', store: 'server', created: 1}])
        await vi.waitFor(() => expect(cards(layer)).toHaveLength(1))
        expect([cards(layer)[0].style.left, cards(layer)[0].style.top]).toEqual(['300px', '200px'])
    })

    test('board: a deleted note forgets its place', () => {
        const {notes, layer} = setup()
        const n = notes.addNote('a')
        expect(state().board[n.id]).toBeTruthy()
        cards(layer)[0].button('×').fire('click')
        expect(state().board[n.id]).toBeUndefined()
    })

    test('the store menu opens above a button at the bottom, inside the canvas', () => {
        const {layer} = setup()
        layer.rect = {left: 0, top: 0, right: 800, bottom: 600}
        const pick = layer.button('▾')
        pick.rect = {left: 70, top: 560, right: 90, bottom: 588}
        pick.fire('click')
        const menu = layer.find('snp-menu')[0]
        // 150 high (the fake height): above the button, 4 px apart
        expect([menu.style.left, menu.style.top]).toEqual(['70px', '406px'])
    })

    test('a size from the corner is kept, written once after the sizing; a hidden post-it (size 0) changes no size', () => {
        vi.useFakeTimers()
        try {
            const {notes, sticky, layer} = setup()
            const n = notes.addNote('a')
            const card = cards(layer)[0]
            let writes = 0
            const set = localStorage.setItem
            vi.stubGlobal('localStorage', {...localStorage, setItem: (k: string, v: string) => (writes++, set(k, v))})
            // the frames of a size change: the post-it follows, the state is written after the last one
            for (const w of [240, 270, 300]) {
                card.offsetWidth = w
                card.offsetHeight = 200
                resized(sticky, card)
            }
            expect([card.style.width, card.style.height]).toEqual(['300px', '200px'])
            expect(writes).toBe(0)
            vi.advanceTimersByTime(300)
            expect(writes).toBe(1)
            expect(state().board[n.id]).toMatchObject({w: 300, h: 200})
            sticky.shown = false
            card.offsetWidth = card.offsetHeight = 0
            resized(sticky, card)
            vi.advanceTimersByTime(300)
            expect(state().board[n.id]).toMatchObject({w: 300, h: 200})
        } finally {
            vi.useRealTimers()
        }
    })

    test('a size change that waits to be written is written when the plugin is removed', () => {
        vi.useFakeTimers()
        try {
            const {notes, sticky, viewer, layer} = setup()
            const n = notes.addNote('a')
            const card = cards(layer)[0]
            card.offsetWidth = 300
            resized(sticky, card)
            sticky.onRemove(viewer)
            expect(state().board[n.id]).toMatchObject({w: 300})
        } finally {
            vi.useRealTimers()
        }
    })

    test('on a touch screen the text of a note is 16 px, so a phone does not zoom in when it gets the cursor', () => {
        // the test setup leaves CSS imports empty: the file itself
        const css = readFileSync(new URL('../../plugins/tweakpane-editor/src/StickyNotesUiPlugin.css', import.meta.url), 'utf8')
        const touch = css.match(/@media \(pointer: coarse\)\s*{([^{}]*{[^{}]*})*\s*}/)?.[0] ?? ''
        expect(touch).toMatch(/\.snp-card textarea\s*{[^}]*font-size:\s*16px/)
    })

    test('Show hides the layer; removing the plugin removes it', () => {
        const {sticky, viewer, layer} = setup()
        sticky.shown = false
        expect(layer.style.display).toBe('none')
        sticky.onRemove(viewer)
        expect(viewer.container.children).toEqual([])
    })
})
