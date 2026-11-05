import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

// The page frame of the tweakpane editor (plugins/tweakpane-editor/src/frame): the mode bar, the bars, the layout menu
// and the layout setting of TweakpaneEditorPlugin. The node setup has no DOM: a small element with what the frame
// uses, and a tippy.js that keeps the state of each tooltip (enabled, shown) as tippy does.

interface FakeTip {
    reference: any
    props: Record<string, any>
    state: {isEnabled: boolean, isVisible: boolean}
    enable(): void
    disable(): void
    show(): void
    hide(): void
    setContent(c: string): void
    destroy(): void
    /** The tooltips of a singleton (createSingleton) */
    children?: FakeTip[]
    setInstances?(tips: FakeTip[]): void
}
const singletons: FakeTip[] = []
function fakeTippy(reference: any, props: Record<string, any> = {}): FakeTip {
    const t: FakeTip = {
        reference, props: {...props}, state: {isEnabled: true, isVisible: false},
        enable: () => {
            t.state.isEnabled = true
        },
        disable: () => { // as tippy: it also hides
            t.state.isVisible = false
            t.state.isEnabled = false
        },
        show: () => {
            if (t.state.isEnabled) t.state.isVisible = true
        },
        hide: () => {
            t.state.isVisible = false
        },
        setContent: c => {
            t.props.content = c
        },
        destroy: () => {},
    }
    if (reference) reference._tippy = t
    return t
}
// tippy.js is a dependency of the plugin, mocked by the file that Node resolves from the plugin's folder: in the
// workspace's node_modules (hoisted) or in the plugin's own (a nested or linked install)
const tippyPath = vi.hoisted(() => process.getBuiltinModule('node:module')
    .createRequire(new URL('../../plugins/tweakpane-editor/package.json', import.meta.url)).resolve('tippy.js'))
vi.mock(tippyPath, () => ({
    default: Object.assign((ref: any, props: any) => fakeTippy(ref, props), {setDefaultProps: () => {}}),
    // as tippy: the tooltips of a singleton are disabled, the singleton shows their content at their button
    createSingleton: (tips: FakeTip[], props: any) => {
        const s = fakeTippy(undefined, props)
        s.children = tips
        tips.forEach(t => t.disable())
        s.setInstances = next => {
            s.children!.forEach(t => t.enable())
            s.children = next
            next.forEach(t => t.disable())
        }
        singletons.push(s)
        return s
    },
}))
vi.mock('@threepipe/plugin-tweakpane', () => ({TweakpaneUiPlugin: class TweakpaneUiPlugin {}}))

class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    id = ''
    textContent = ''
    title = ''
    tabIndex = -1
    scrollLeft = 0
    _tippy?: FakeTip
    private _attrs = new Map<string, string>()
    private _listeners = new Map<string, ((e: any) => void)[]>()
    style = Object.assign({} as Record<string, any>, {
        setProperty: (k: string, v: string) => {
            this.style[k] = v
        },
        removeProperty: (k: string) => {
            delete this.style[k]
        },
    })
    classList = {
        contains: (c: string) => this.className.split(' ').includes(c),
        add: (...cs: string[]) => cs.forEach(c => this.classList.toggle(c, true)),
        remove: (...cs: string[]) => cs.forEach(c => this.classList.toggle(c, false)),
        toggle: (c: string, on = !this.classList.contains(c)) => {
            const rest = this.className.split(' ').filter(x => x && x !== c)
            this.className = (on ? [...rest, c] : rest).join(' ')
        },
    }
    constructor(readonly tagName: string) {}
    /** The markup of the frame: elements with a class, text, and self-closed SVG shapes */
    set innerHTML(html: string) {
        for (const c of [...this.children]) c.remove()
        const stack: FakeElement[] = [this]
        for (const [, close, tag, attrs, selfClose, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/g)) {
            const top = stack[stack.length - 1]
            if (text) top.textContent += text
            else if (close) stack.pop()
            else {
                const e = top.appendChild(new FakeElement(tag))
                e.className = attrs.match(/class="([^"]*)"/)?.[1] ?? ''
                if (!selfClose) stack.push(e)
            }
        }
    }
    get lastElementChild() {
        return this.children[this.children.length - 1] ?? null
    }
    get parentElement() {
        return this.parent ?? null
    }
    set contentEditable(v: string) {
        this.setAttribute('contenteditable', v)
    }
    get isContentEditable() {
        return this._attrs.has('contenteditable')
    }
    setAttribute(k: string, v: string) {
        this._attrs.set(k, v)
    }
    getAttribute(k: string) {
        return this._attrs.get(k) ?? null
    }
    removeAttribute(k: string) {
        this._attrs.delete(k)
    }
    getBoundingClientRect() {
        return {left: 0, top: 0, right: 28, bottom: 28, width: 28, height: 28}
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    append(...cs: FakeElement[]) {
        cs.forEach(c => this.appendChild(c))
    }
    replaceChildren(...cs: FakeElement[]) {
        for (const c of [...this.children]) c.remove()
        this.append(...cs)
    }
    insertBefore(c: FakeElement, before: FakeElement | null) {
        c.remove()
        c.parent = this
        const i = before ? this.children.indexOf(before) : -1
        this.children.splice(i < 0 ? this.children.length : i, 0, c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    contains(e: FakeElement) {
        return e === this || this.all().includes(e)
    }
    /** `.class` or a tag */
    querySelector(sel: string) {
        return this.all().find(e => sel.startsWith('.') ? e.classList.contains(sel.slice(1)) : e.tagName === sel) ?? null
    }
    /** `.class`, `[attribute]` or a tag, in a list */
    closest(sel: string): FakeElement | null {
        const match = (e: FakeElement) => sel.split(',').map(s => s.trim()).some(s =>
            s.startsWith('.') ? e.classList.contains(s.slice(1)) : s.startsWith('[') ? e._attrs.has(s.slice(1, -1)) : e.tagName === s)
        for (let e: FakeElement | undefined = this; e; e = e.parent) if (match(e)) return e
        return null
    }
    focus() {}
    blur() {
        this.fire('blur')
    }
    click() {
        this.fire('click')
    }
    addEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: (e: any) => void) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    fire(type: string, e: any = {}) {
        const event = {target: this, currentTarget: this, defaultPrevented: false, preventDefault: () => {
            event.defaultPrevented = true
        }, stopPropagation: () => {}, ...e}
        for (const f of this._listeners.get(type) ?? []) f(event)
        return event
    }
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
    find(cls: string) {
        return this.all().filter(e => e.classList.contains(cls))
    }
}

const doc = globalThis.document as any
const saved = {...doc}
/** Listeners on the window and on the document, as the frame adds them */
let win: FakeElement
let docEvents: FakeElement
let storage: Map<string, string>
let wide = true
beforeAll(() => {
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    for (const k of Object.keys(doc)) if (!(k in saved)) delete doc[k]
    Object.assign(doc, saved)
})
beforeEach(() => {
    singletons.length = 0
    doc.head = new FakeElement('head')
    doc.body = new FakeElement('body')
    doc.documentElement = new FakeElement('html')
    doc.querySelector = () => null
    doc.getElementById = () => null
    docEvents = new FakeElement('document')
    doc.addEventListener = (t: string, f: any) => docEvents.addEventListener(t, f)
    doc.removeEventListener = (t: string, f: any) => docEvents.removeEventListener(t, f)
    storage = new Map()
    wide = true
    win = new FakeElement('window')
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    })
    vi.stubGlobal('matchMedia', () => ({matches: wide}))
    vi.stubGlobal('addEventListener', (t: string, f: any) => win.addEventListener(t, f))
    vi.stubGlobal('removeEventListener', (t: string, f: any) => win.removeEventListener(t, f))
    vi.stubGlobal('getSelection', () => ({selectAllChildren: () => {}}))
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
})
afterEach(() => {
    vi.unstubAllGlobals()
})

const {EditorModeBar} = await import('../../plugins/tweakpane-editor/src/frame/EditorModeBar')
const {EditorFrame} = await import('../../plugins/tweakpane-editor/src/frame/EditorFrame')
const {TweakpaneEditorPlugin} = await import('../../plugins/tweakpane-editor/src/TweakpaneEditorPlugin')

const host = () => ({modeKeys: ['Viewer', 'Export'], setSelectedMode: vi.fn()})
const body = () => doc.body as FakeElement
/** The number of tooltips that show on a hover of a button: its own, and the singleton's for its group */
const tipsOnHover = (b: FakeElement) => (b._tippy!.state.isEnabled ? 1 : 0) +
    singletons.filter(s => s.state.isEnabled && s.children!.includes(b._tippy!)).length
/** The layout button among the buttons of a bar */
const layoutButtonOf = (buttons: FakeElement[]) => buttons.find(b => b.getAttribute('aria-label') === 'Layout of the page')!
const keydown = (key: string, code: string, mods: Record<string, boolean> = {}) => win.fire('keydown', {key, code, target: body(), ...mods})

describe('EditorModeBar', () => {
    test('cycle steps through the names and the panel, the icons and the panel, the icons only', () => {
        const panel = new FakeElement('div')
        const bar = new EditorModeBar(host(), body() as any, () => panel as any, null)
        expect([bar.expanded, bar.open]).toEqual([true, true])
        bar.cycle()
        expect([bar.expanded, bar.open]).toEqual([false, true])
        bar.cycle()
        expect([bar.expanded, bar.open]).toEqual([false, false])
        expect(panel.style.visibility).toBe('hidden')
        expect(body().classList.contains('mb-panel-hidden')).toBe(true)
        bar.cycle()
        expect([bar.expanded, bar.open]).toEqual([true, true])
        expect(panel.style.visibility).toBe('')
        // a window without room for the names skips them
        wide = false
        bar.cycle()
        bar.cycle()
        expect([bar.expanded, bar.open]).toEqual([false, false])
        bar.cycle()
        expect([bar.expanded, bar.open]).toEqual([false, true])
    })

    test('the names are kept only when the person picks them (the toggle, Ctrl+\\, the UI), not at the first build or from code', () => {
        wide = false // the first visit in a narrow window: no names
        let bar = new EditorModeBar(host(), body() as any, undefined, 'names')
        expect(bar.expanded).toBe(false)
        expect(storage.has('names')).toBe(false)
        bar.setExpanded(true) // from code
        expect(storage.has('names')).toBe(false)
        bar.setExpanded(false, true) // the person's pick
        expect(storage.get('names')).toBe('0')
        wide = true
        bar.cycle() // the toggle button and Ctrl+\: the panel hidden
        bar.cycle() // the names and the panel
        expect(storage.get('names')).toBe('1')
        // a wide window later, nothing picked: the names, from the window
        storage.clear()
        bar = new EditorModeBar(host(), body() as any, undefined, 'names')
        expect(bar.expanded).toBe(true)
        expect(storage.has('names')).toBe(false)
    })

    test('show selects a mode once and opens the panel', () => {
        const editor = host()
        const bar = new EditorModeBar(editor, body() as any, undefined, null)
        // as TweakpaneEditorPlugin: it marks the mode in the bar
        editor.setSelectedMode.mockImplementation((i: number) => bar.select(i))
        bar.setOpen(false)
        bar.show(1)
        expect(editor.setSelectedMode).toHaveBeenCalledTimes(1)
        expect(editor.setSelectedMode).toHaveBeenCalledWith(1)
        expect(bar.open).toBe(true)
        const buttons = (bar.element as any as FakeElement).find('mb-btn').filter(b => b.getAttribute('role') === 'tab')
        expect(buttons.map(b => b.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    })
})

describe('EditorFrame', () => {
    const frame = (layout: 'titlebar' | 'floating', expanded: boolean, onRename?: (name: string) => void) => {
        storage.set('tpEditorModeBarExpanded', expanded ? '1' : '0')
        return new EditorFrame(host(), {layout, onRename})
    }
    const layoutButton = (f: InstanceType<typeof EditorFrame>) => f.layout === 'floating' ?
        layoutButtonOf((f.modeBar.element as any as FakeElement).find('lay-float-btn')) :
        layoutButtonOf(body().find('lay-top')[0].find('lay-btn'))

    for (const [layout, expanded] of [['titlebar', true], ['floating', false], ['floating', true]] as const) {
        test(`the tooltip of the layout button hides while its menu is open, and never doubles (${layout}, names ${expanded ? 'shown' : 'hidden'})`, () => {
            const f = frame(layout, expanded)
            const b = layoutButton(f)
            const before = tipsOnHover(b)
            expect(before).toBe(layout === 'floating' && expanded ? 0 : 1)
            b.click()
            expect(body().find('lay-menu')).toHaveLength(1)
            expect(tipsOnHover(b)).toBe(0)
            b.click() // closes it
            expect(body().find('lay-menu')).toHaveLength(0)
            expect(tipsOnHover(b)).toBe(before)
            b.click()
            docEvents.fire('keydown', {key: 'Escape'})
            expect(body().find('lay-menu')).toHaveLength(0)
            expect(tipsOnHover(b)).toBe(before)
            b.click()
            f.setLayout(layout) // closes it too
            expect(body().find('lay-menu')).toHaveLength(0)
            expect(tipsOnHover(b)).toBe(before)
            // the other buttons of the mode bar
            const mode = (f.modeBar.element as any as FakeElement).find('mb-btn')[0]
            expect(tipsOnHover(mode)).toBe(expanded ? 0 : 1)
        })
    }

    test('the mode bar hides the panel of the options, and the frame opens it when it is folded', () => {
        const panel = new FakeElement('div')
        panel.innerHTML = '<div class="tp-rotv"><button class="tp-rotv_b"></button></div>'
        const fold = vi.fn()
        panel.querySelector('.tp-rotv_b')!.addEventListener('click', fold)
        const f = new EditorFrame(host(), {layout: 'titlebar', panel: () => panel as any})
        expect(fold).toHaveBeenCalledTimes(1) // folded (a phone): opened when the layout applies
        panel.querySelector('.tp-rotv')!.classList.add('tp-rotv-expanded')
        f.modeBar.setOpen(false)
        expect(panel.style.visibility).toBe('hidden')
        f.setLayout('floating')
        expect(fold).toHaveBeenCalledTimes(1) // open already
    })

    test('Ctrl+\\ and Cmd+\\ step the mode bar, by the key or by the key code', () => {
        const f = frame('titlebar', true)
        keydown('\\', 'Backslash', {ctrlKey: true})
        expect(f.modeBar.expanded).toBe(false)
        // a keyboard layout where the key is not at the Backslash position
        keydown('\\', 'IntlBackslash', {metaKey: true})
        expect(f.modeBar.open).toBe(false)
        keydown('\\', 'Backslash')
        expect(f.modeBar.open).toBe(false)
        keydown('T', 'KeyT', {shiftKey: true, ctrlKey: true})
        expect(f.modeBar.open).toBe(false)
    })

    test('a click on the name renames it: Enter keeps it, Escape goes back, not while an IME composes', () => {
        const onRename = vi.fn()
        const f = frame('titlebar', true, (name) => {
            onRename(name)
            f.documentName = name
        })
        f.documentName = 'Ring.glb'
        const name = body().find('lay-top')[0].find('lay-file')[0]
        expect(name.textContent).toBe('Ring.glb')
        name.click()
        expect(name.isContentEditable).toBe(true)
        name.textContent = '  New   ring '
        // Enter that ends a composition (IME) is for the text
        expect(name.fire('keydown', {key: 'Enter', isComposing: true}).defaultPrevented).toBe(false)
        expect(name.isContentEditable).toBe(true)
        name.fire('keydown', {key: 'Enter'})
        expect(name.isContentEditable).toBe(false)
        expect(onRename).toHaveBeenCalledWith('New ring')
        expect(name.textContent).toBe('New ring')
        name.click()
        name.textContent = 'Other'
        name.fire('keydown', {key: 'Escape', isComposing: true})
        expect(name.isContentEditable).toBe(true)
        name.fire('keydown', {key: 'Escape'})
        expect(name.textContent).toBe('New ring')
        expect(onRename).toHaveBeenCalledTimes(1)
    })

    test('the Enter that ends a composition in Safari (isComposing false, keyCode 229) is for the text', () => {
        const f = frame('titlebar', true, (name) => f.documentName = name)
        f.documentName = 'Ring.glb'
        const name = body().find('lay-top')[0].find('lay-file')[0]
        name.click()
        expect(name.fire('keydown', {key: 'Enter', isComposing: false, keyCode: 229}).defaultPrevented).toBe(false)
        expect(name.isContentEditable).toBe(true)
    })

    test('a long name typed in the bar shows from its start after the rename (the edit scrolled it)', () => {
        const f = frame('titlebar', true, (name) => f.documentName = name)
        f.documentName = 'Ring.glb'
        const name = body().find('lay-top')[0].find('lay-file')[0]
        name.click()
        name.textContent = 'A very long name of a ring that goes on and on'
        name.scrollLeft = 193 // the caret at the end of the text
        name.fire('keydown', {key: 'Enter'})
        expect(name.scrollLeft).toBe(0)
    })
})

describe('EditorFrame areas', () => {
    const area = (name: string) => body().find('lay-area-' + name)
    /** The parts of the frame in the body, and in the mode bar (the actions of the floating layout) */
    const structure = (f: InstanceType<typeof EditorFrame>) => ({
        bars: body().children.filter(c => c.classList.contains('lay-bar')).map(c => c.classList.contains('lay-top') ? 'top' : 'bottom'),
        areas: body().children.filter(c => c.classList.contains('lay-area')).map(c => c.className),
        floatActions: (f.modeBar.element as any as FakeElement).find('lay-float-actions').length,
        classes: body().className.split(' ').filter(c => c.startsWith('lay-')).sort(),
    })

    const bars = {titlebar: ['top'], statusbar: ['bottom'], floating: []}
    for (const layout of ['titlebar', 'statusbar', 'floating'] as const) {
        test(`${layout}: the bars, the mode bar and an empty left and bottom area, which take no room`, () => {
            const f = new EditorFrame(host(), {layout})
            expect(structure(f)).toEqual({
                bars: bars[layout],
                areas: ['lay-area lay-area-left', 'lay-area lay-area-bottom'],
                floatActions: layout === 'floating' ? 1 : 0,
                // no lay-has-<area>: the CSS gives an empty area no room (tweakpane-editor-frame-css.test.ts)
                classes: ['lay-' + layout, 'lay-frame'].sort(),
            })
            expect(area('left')[0].children).toHaveLength(0)
            expect(area('bottom')[0].children).toHaveLength(0)
            expect(body().find('mb-root')).toHaveLength(1)
        })

        test(`${layout}: an element in the left area shows it, and a null empties the area`, () => {
            const f = new EditorFrame(host(), {layout})
            const layers = new FakeElement('div')
            f.setArea('left', layers as any)
            expect(area('left')[0].children).toEqual([layers])
            expect(body().classList.contains('lay-has-left')).toBe(true)
            expect(body().classList.contains('lay-has-bottom')).toBe(false)
            // another element takes its place
            const catalogue = new FakeElement('div')
            f.setArea('left', catalogue as any)
            expect(area('left')[0].children).toEqual([catalogue])
            expect(layers.parentElement).toBeNull()
            f.setArea('left', null)
            expect(area('left')[0].children).toHaveLength(0)
            expect(body().classList.contains('lay-has-left')).toBe(false)
        })
    }

    test('the areas keep their elements when the layout changes, and go with the frame', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const left = new FakeElement('div'), bottom = new FakeElement('div')
        f.setArea('left', left as any)
        f.setArea('bottom', bottom as any)
        for (const layout of ['floating', 'statusbar', 'titlebar'] as const) {
            f.setLayout(layout)
            expect(area('left')[0].children, layout).toEqual([left])
            expect(area('bottom')[0].children, layout).toEqual([bottom])
            expect(structure(f).classes, layout).toEqual(['lay-' + layout, 'lay-frame', 'lay-has-bottom', 'lay-has-left'].sort())
        }
        f.dispose()
        expect(body().find('lay-area')).toHaveLength(0)
        expect(body().className.split(' ').filter(c => c.startsWith('lay-'))).toEqual([])
    })
})

describe('EditorFrame area sizes', () => {
    const handle = (area: string) => body().find('lay-handle-' + area)[0]
    const area = (name: string) => body().find('lay-area-' + name)[0]
    const stored = () => JSON.parse(storage.get('tpEditorFrameAreas') ?? 'null')
    const sizeVar = (v: string) => body().style[v]
    /** A drag on the window from a press on the edge, in px */
    const drag = (el: FakeElement, from: {clientX?: number, clientY?: number}, ...moves: {clientX?: number, clientY?: number}[]) => {
        el.fire('pointerdown', {button: 0, ...from})
        for (const m of moves) win.fire('pointermove', m)
        win.fire('pointerup', {})
    }

    test('an edge for the left area, the bottom area and the panel; they go with the frame, and so do the sizes', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        expect(['left', 'bottom', 'right'].map(a => handle(a)?.getAttribute('role'))).toEqual(['separator', 'separator', 'separator'])
        expect(handle('bottom').getAttribute('aria-orientation')).toBe('horizontal')
        f.setAreaSize('left', 300)
        f.setAreaSize('right', 400)
        f.setAreaCollapsed('bottom', true)
        f.dispose()
        expect(body().find('lay-handle')).toHaveLength(0)
        // the classic layout has the panel width of the Tweakpane UI again
        expect([sizeVar('--lay-left-area-size'), sizeVar('--tweakpane-ui-container-width')]).toEqual([undefined, undefined])
        expect(body().classList.contains('lay-collapsed-bottom')).toBe(false)
    })

    test('setAreaSize keeps the size between the limits and half of the window; null sets the size of the CSS again; keep stores it', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setAreaSize('left', 300.4)
        expect(sizeVar('--lay-left-area-size')).toBe('300px')
        f.setAreaSize('left', 20)
        expect(sizeVar('--lay-left-area-size')).toBe('160px')
        f.setAreaSize('right', 5000)
        expect(sizeVar('--tweakpane-ui-container-width')).toBe('600px')
        vi.stubGlobal('innerHeight', 500)
        f.setAreaSize('bottom', 380)
        expect(sizeVar('--lay-bottom-area-size')).toBe('250px') // half of the window
        expect(storage.has('tpEditorFrameAreas')).toBe(false) // set from code: not kept
        f.setAreaSize('left', null, true)
        expect(sizeVar('--lay-left-area-size')).toBeUndefined()
        expect(stored()).toEqual({sizes: {right: 600, bottom: 250}, collapsed: {}, stacked: 'right'})
    })

    test('the left area and the panel leave room for the canvas next to each other and the mode bar', () => {
        vi.stubGlobal('innerWidth', 1000)
        const panel = new FakeElement('div')
        panel.getBoundingClientRect = () => ({width: 300, height: 800}) as any
        const f = new EditorFrame(host(), {layout: 'titlebar', panel: () => panel as any})
        f.setArea('left', new FakeElement('div') as any)
        area('left').getBoundingClientRect = () => ({width: 480, height: 800}) as any
        const modeBar = f.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
        f.setAreaSize('right', 500)
        expect(sizeVar('--tweakpane-ui-container-width')).toBe(Math.max(240, 1000 - 480 - modeBar - EditorFrame.MinCanvasWidth) + 'px')
        f.setAreaSize('left', 480)
        expect(sizeVar('--lay-left-area-size')).toBe(Math.max(160, Math.min(480, 1000 - 300 - modeBar - EditorFrame.MinCanvasWidth)) + 'px')
        // a collapsed left area takes no room from the panel
        f.setAreaCollapsed('left', true)
        f.setAreaSize('right', 500)
        expect(sizeVar('--tweakpane-ui-container-width')).toBe(Math.min(500, 1000 - modeBar - EditorFrame.MinCanvasWidth) + 'px')
    })

    test('the default size of an area (null, a double-click) leaves room for the canvas: the other side area fits again', () => {
        vi.stubGlobal('innerWidth', 1000)
        storage.set('tpEditorModeBarExpanded', '1')
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setArea('left', new FakeElement('div') as any)
        // on screen, the left area has its variable, else the 240 px of the CSS
        area('left').getBoundingClientRect = () => ({width: parseInt(sizeVar('--lay-left-area-size') ?? '240'), height: 800}) as any
        const room = (left: number) => 1000 - left - EditorModeBar.Widths.wide - EditorFrame.MinCanvasWidth
        f.setAreaSize('left', 160)
        f.setAreaSize('right', 600)
        expect(sizeVar('--tweakpane-ui-container-width')).toBe(room(160) + 'px')
        f.setAreaSize('left', null)
        expect(sizeVar('--lay-left-area-size')).toBeUndefined()
        expect(sizeVar('--tweakpane-ui-container-width')).toBe(room(240) + 'px')
    })

    test('kept sizes are limited again when an area is set, so the left area and the panel leave room for the canvas', () => {
        vi.stubGlobal('innerWidth', 1200)
        storage.set('tpEditorFrameAreas', JSON.stringify({sizes: {left: 400, right: 600}}))
        const f = new EditorFrame(host(), {layout: 'titlebar'}) // the plugin sets the areas after the frame is made
        expect(sizeVar('--tweakpane-ui-container-width')).toBe('600px') // no left area yet
        f.setArea('left', new FakeElement('div') as any)
        const modeBar = f.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
        const left = parseInt(sizeVar('--lay-left-area-size')!), right = parseInt(sizeVar('--tweakpane-ui-container-width')!)
        expect(left + right + modeBar + EditorFrame.MinCanvasWidth).toBeLessThanOrEqual(1200)
        expect(left).toBeGreaterThanOrEqual(EditorFrame.AreaLimits.left[0])
    })

    test('the sizes get smaller when the window gets smaller, and come back when it is wide again', () => {
        vi.stubGlobal('innerWidth', 1440)
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setArea('left', new FakeElement('div') as any)
        // on screen, the width of the left area follows its variable
        area('left').getBoundingClientRect = () => ({width: parseInt(sizeVar('--lay-left-area-size') ?? '240'), height: 800}) as any
        f.setAreaSize('left', 480)
        f.setAreaSize('right', 552)
        const modeBar = f.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
        const widths = () => [parseInt(sizeVar('--lay-left-area-size')!), parseInt(sizeVar('--tweakpane-ui-container-width')!)]
        expect(widths()).toEqual([480, 552])
        vi.stubGlobal('innerWidth', 1000)
        win.fire('resize')
        const [left, right] = widths()
        expect(left + right + modeBar + EditorFrame.MinCanvasWidth).toBeLessThanOrEqual(1000)
        vi.stubGlobal('innerWidth', 1440)
        win.fire('resize')
        expect(widths()).toEqual([480, 552])
        f.dispose()
        vi.stubGlobal('innerWidth', 1000)
        win.fire('resize') // removed with the frame
        expect(sizeVar('--lay-left-area-size')).toBeUndefined()
    })

    test('the sizes are limited again when a collapsed area or the panel opens', () => {
        vi.stubGlobal('innerWidth', 1200)
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setArea('left', new FakeElement('div') as any)
        area('left').getBoundingClientRect = () => ({width: parseInt(sizeVar('--lay-left-area-size') ?? '240'), height: 800}) as any
        const fits = () => {
            const modeBar = f.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
            return parseInt(sizeVar('--lay-left-area-size')!) + parseInt(sizeVar('--tweakpane-ui-container-width')!) + modeBar + EditorFrame.MinCanvasWidth <= 1200
        }
        f.setAreaSize('left', 480)
        f.setAreaSize('right', 300)
        f.setAreaCollapsed('left', true)
        f.setAreaSize('right', 600) // the collapsed left area takes no room
        f.setAreaCollapsed('left', false)
        expect(fits()).toBe(true)
        f.setAreaCollapsed('right', true)
        f.setAreaSize('left', 480) // the hidden panel takes no room
        f.setAreaCollapsed('right', false) // through the mode bar
        expect(fits()).toBe(true)
    })

    test('setAreaCollapsed: the left and the bottom area with a body class, the panel through the mode bar', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setAreaCollapsed('left', true)
        expect(body().classList.contains('lay-collapsed-left')).toBe(true)
        expect(f.isAreaCollapsed('left')).toBe(true)
        f.setAreaCollapsed('right', true, true)
        expect([f.modeBar.open, body().classList.contains('mb-panel-hidden'), f.isAreaCollapsed('right')]).toEqual([false, true, true])
        expect(storage.has('tpEditorFrameAreas')).toBe(false) // the panel is not kept here
        f.setAreaCollapsed('right', false)
        expect(f.modeBar.open).toBe(true)
        f.setAreaCollapsed('left', false, true)
        expect(body().classList.contains('lay-collapsed-left')).toBe(false)
        expect(stored()).toEqual({sizes: {}, collapsed: {left: false}, stacked: 'right'})
    })

    test('a new frame applies the kept sizes and collapsed areas; a stored value that is not of the frame is ignored', () => {
        storage.set('tpEditorFrameAreas', JSON.stringify({sizes: {left: 320, right: 'wide'}, collapsed: {bottom: true, right: true}}))
        let f = new EditorFrame(host(), {layout: 'floating'})
        expect([sizeVar('--lay-left-area-size'), sizeVar('--tweakpane-ui-container-width')]).toEqual(['320px', undefined])
        expect([f.isAreaCollapsed('bottom'), f.isAreaCollapsed('right')]).toEqual([true, false])
        f.dispose()
        storage.set('tpEditorFrameAreas', '{not json')
        f = new EditorFrame(host(), {layout: 'floating'})
        expect(sizeVar('--lay-left-area-size')).toBeUndefined()
        f.dispose()
        EditorFrame.AreaStorageKey = null
        storage.set('tpEditorFrameAreas', JSON.stringify({sizes: {left: 320}}))
        try {
            f = new EditorFrame(host(), {layout: 'floating'})
            expect(sizeVar('--lay-left-area-size')).toBeUndefined()
            f.setAreaSize('left', 300, true)
            expect(stored()).toEqual({sizes: {left: 320}}) // not written
        } finally {
            EditorFrame.AreaStorageKey = 'tpEditorFrameAreas'
        }
    })

    /** The entries of the areas in the mode bar, and the tabs of the modes */
    const entries = (f: InstanceType<typeof EditorFrame>) => {
        const box = (f.modeBar.element as any as FakeElement).find('lay-area-entries')[0]
        return {box, left: box.find('lay-area-entry')[0], bottom: box.find('lay-area-entry')[1]}
    }
    const shown = (e: FakeElement) => e.style.display !== 'none'
    const marked = (e: FakeElement) => e.classList.contains('lay-entry-on')

    test('the mode bar has an entry for each area with an element, after the modes, with its name and icon', () => {
        const f = new EditorFrame(host(), {layout: 'floating'})
        const bar = f.modeBar.element as any as FakeElement
        const e = entries(f)
        // after the two modes, before the actions of the floating layout and the names toggle
        expect(bar.children.indexOf(e.box)).toBe(2)
        expect(bar.children.indexOf(e.box)).toBeLessThan(bar.children.indexOf(bar.find('lay-float-actions')[0]))
        expect([shown(e.box), shown(e.left), shown(e.bottom)]).toEqual([false, false, false])
        f.setArea('left', new FakeElement('div') as any, {name: 'Layers', icon: '<svg class="layers-icon"></svg>'})
        expect([shown(e.box), shown(e.left), shown(e.bottom)]).toEqual([true, true, false])
        expect([e.left.getAttribute('aria-label'), e.left.find('mb-label')[0].textContent, e.left.find('layers-icon').length]).toEqual(['Layers', 'Layers', 1])
        expect(e.left._tippy!.props.content).toBe('Layers')
        f.setArea('bottom', new FakeElement('div') as any)
        expect([shown(e.bottom), e.bottom.getAttribute('aria-label')]).toEqual([true, EditorFrame.AreaNames.bottom])
        f.setArea('left', null)
        expect([shown(e.box), shown(e.left)]).toEqual([true, false])
        f.dispose()
        expect(bar.find('lay-area-entries')).toHaveLength(0)
    })

    test('in a wide window, an entry shows or hides its area, and is marked while it shows', () => {
        vi.stubGlobal('matchMedia', (q: string) => ({matches: q !== EditorFrame.StackedQuery}))
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setArea('left', new FakeElement('div') as any)
        const e = entries(f)
        expect(marked(e.left)).toBe(true)
        e.left.click()
        expect([f.isAreaCollapsed('left'), marked(e.left), stored().collapsed.left]).toEqual([true, false, true])
        e.left.click()
        expect([f.isAreaCollapsed('left'), marked(e.left)]).toEqual([false, true])
        // a drag of the edge to the side collapses it too: the entry follows
        f.setAreaCollapsed('left', true)
        expect(marked(e.left)).toBe(false)
        // the modes are not taken
        f.setAreaCollapsed('left', false)
        const bar = f.modeBar.element as any as FakeElement
        const tab = bar.find('mb-btn').filter(b => b.getAttribute('role') === 'tab')[0]
        const stop = vi.fn()
        bar.fire('click', {target: tab, stopImmediatePropagation: stop})
        expect([f.stackedArea, stop.mock.calls.length]).toEqual(['right', 0])
    })

    test('on a phone, the entries and the modes share the part below the canvas; a tap on the one shown hides it', () => {
        vi.stubGlobal('matchMedia', (q: string) => ({matches: q === EditorFrame.StackedQuery})) // a phone in portrait
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setArea('left', new FakeElement('div') as any, {name: 'Layers'})
        f.setArea('bottom', new FakeElement('div') as any)
        const e = entries(f)
        // the panel is below the canvas: no entry is marked
        expect([marked(e.left), marked(e.bottom)]).toEqual([false, false])
        // an entry: its area there, kept; it opens the part below the canvas when the mode bar hid it
        f.modeBar.setOpen(false)
        e.left.click()
        expect([f.stackedArea, body().classList.contains('lay-stacked-left'), f.modeBar.open, stored().stacked]).toEqual(['left', true, true, 'left'])
        expect([marked(e.left), marked(e.bottom)]).toEqual([true, false])
        e.bottom.click()
        expect([f.stackedArea, marked(e.left), marked(e.bottom)]).toEqual(['bottom', false, true])
        // a tap on the entry shown hides the part below the canvas, and a tap again shows it
        e.bottom.click()
        expect([f.modeBar.open, marked(e.bottom), f.stackedArea]).toEqual([false, false, 'bottom'])
        e.bottom.click()
        expect([f.modeBar.open, marked(e.bottom)]).toEqual([true, true])
        // a tap on the open mode shows the panel, and does not hide it (the click stops before the button)
        const bar = f.modeBar.element as any as FakeElement
        const tabs = bar.find('mb-btn').filter(b => b.getAttribute('role') === 'tab')
        const tap = (tab: FakeElement) => {
            let stopped = false
            bar.fire('click', {target: tab, stopImmediatePropagation: () => stopped = true})
            if (!stopped) tab.click()
        }
        tap(tabs[0])
        expect([f.stackedArea, f.modeBar.open, stored().stacked, marked(e.bottom)]).toEqual(['right', true, 'right', false])
        // another mode opens as usual
        f.setStackedArea('left')
        tap(tabs[1])
        expect([f.stackedArea, f.modeBar.open]).toEqual(['right', true])
        expect(f.modeBar.editor.setSelectedMode).toHaveBeenCalledWith(1)
        // the panel below the canvas: a tap on the open mode hides it, as before
        tap(tabs[0])
        expect(f.modeBar.open).toBe(false)
        // the panel picked from code opens the part below the canvas too
        f.setStackedArea('right')
        expect(f.modeBar.open).toBe(true)
        // an empty area shows the panel, and a mode tap is not taken
        f.setStackedArea('left')
        f.setArea('left', null)
        tap(tabs[0])
        expect([f.stackedArea, f.modeBar.open]).toEqual(['left', false])
        // a new frame applies the kept area; dispose removes the classes
        f.dispose()
        expect(body().className).not.toContain('lay-stacked')
        storage.set('tpEditorFrameAreas', JSON.stringify({stacked: 'bottom'}))
        const g = new EditorFrame(host(), {layout: 'floating'})
        expect([g.stackedArea, body().classList.contains('lay-stacked-bottom')]).toEqual(['bottom', true])
        g.dispose()
        storage.set('tpEditorFrameAreas', JSON.stringify({stacked: 'top'}))
        expect(new EditorFrame(host(), {layout: 'floating'}).stackedArea).toBe('right')
    })

    test('a drag of the left edge resizes it, collapses it past half of the smallest size, opens it again, and keeps the size at the end', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setArea('left', new FakeElement('div') as any)
        area('left').getBoundingClientRect = () => ({width: 240, height: 800}) as any
        handle('left').fire('pointerdown', {button: 0, clientX: 240})
        expect(body().classList.contains('lay-resizing')).toBe(true)
        win.fire('pointermove', {clientX: 300})
        expect(sizeVar('--lay-left-area-size')).toBe('300px')
        expect(storage.has('tpEditorFrameAreas')).toBe(false) // during the drag
        win.fire('pointermove', {clientX: 40}) // a size of 40 px, under half of 160
        expect(f.isAreaCollapsed('left')).toBe(true)
        win.fire('pointermove', {clientX: 130}) // 130 px: open, at the smallest size
        expect([f.isAreaCollapsed('left'), sizeVar('--lay-left-area-size')]).toEqual([false, '160px'])
        win.fire('pointerup', {})
        expect(stored()).toEqual({sizes: {left: 160}, collapsed: {left: false}, stacked: 'right'})
        expect(body().classList.contains('lay-resizing')).toBe(false)
        // the drag is over: a move does nothing
        win.fire('pointermove', {clientX: 400})
        expect(sizeVar('--lay-left-area-size')).toBe('160px')
        // another button does not drag
        handle('left').fire('pointerdown', {button: 2, clientX: 160})
        win.fire('pointermove', {clientX: 400})
        expect(sizeVar('--lay-left-area-size')).toBe('160px')
    })

    test('a drag of the panel edge: to the left it grows, to the right it hides the panel; the bottom edge grows up', () => {
        const panel = new FakeElement('div')
        panel.getBoundingClientRect = () => ({width: 300, height: 800}) as any
        const f = new EditorFrame(host(), {layout: 'titlebar', panel: () => panel as any})
        drag(handle('right'), {clientX: 1096}, {clientX: 1000})
        expect(sizeVar('--tweakpane-ui-container-width')).toBe('396px')
        drag(handle('right'), {clientX: 1096}, {clientX: 1350}) // 300 - 254 = 46 px
        expect(f.modeBar.open).toBe(false)
        f.setArea('bottom', new FakeElement('div') as any)
        area('bottom').getBoundingClientRect = () => ({width: 800, height: 160}) as any
        drag(handle('bottom'), {clientY: 700}, {clientY: 650})
        expect(sizeVar('--lay-bottom-area-size')).toBe('210px')
    })

    test('a double-click on an edge sets the default size, or opens a collapsed area', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.setAreaSize('left', 300)
        handle('left').fire('dblclick')
        expect(sizeVar('--lay-left-area-size')).toBeUndefined()
        f.setAreaCollapsed('bottom', true)
        handle('bottom').fire('dblclick')
        expect(f.isAreaCollapsed('bottom')).toBe(false)
        expect(stored()).toEqual({sizes: {}, collapsed: {bottom: false}, stacked: 'right'})
    })
})

describe('TweakpaneEditorPlugin.layout', () => {
    /** The plugin with modes in a fake viewer, so a layout makes the frame */
    const plugin = () => {
        const p = new TweakpaneEditorPlugin()
        ;(p as any)._viewer = {getPlugin: () => undefined}
        p.modeKeys = ['Viewer', 'Export']
        return p
    }

    test('a layout set from code applies, and is not kept', () => {
        const p = plugin()
        p.layout = 'floating'
        expect(p.frame?.layout).toBe('floating')
        p.layout = 'classic'
        expect(p.frame).toBeUndefined()
        expect(storage.has('tpEditorLayout')).toBe(false)
    })

    test('the layout picked in the layout menu or the UI dropdown is kept', () => {
        const p = plugin()
        p.layout = 'titlebar'
        layoutButtonOf(body().find('lay-top')[0].find('lay-btn')).click()
        const items = body().find('lay-menu')[0].children
        items.find(i => i.textContent === 'Status bar')!.click()
        expect(p.layout).toBe('statusbar')
        expect(storage.get('tpEditorLayout')).toBe('statusbar')
        const dropdown = (p.uiConfig.children as any[]).find(c => c.label === 'Page layout')
        expect(dropdown.getValue()).toBe('statusbar')
        dropdown.setValue('floating')
        expect(p.frame?.layout).toBe('floating')
        expect(storage.get('tpEditorLayout')).toBe('floating')
    })

    test('setArea keeps the element when the frame is made again, also after the classic layout', () => {
        const p = plugin()
        const layers = new FakeElement('div')
        p.layout = 'classic'
        p.setArea('left', layers as any) // no frame: kept for later
        expect(body().find('lay-area')).toHaveLength(0)
        p.layout = 'floating'
        expect(body().find('lay-area-left')[0].children).toEqual([layers])
        expect(body().classList.contains('lay-has-left')).toBe(true)
        p.layout = 'classic'
        expect(body().classList.contains('lay-has-left')).toBe(false)
        p.layout = 'titlebar'
        expect(body().find('lay-area-left')[0].children).toEqual([layers])
        p.setArea('left', null)
        p.layout = 'classic'
        p.layout = 'statusbar'
        expect(body().find('lay-area-left')[0].children).toHaveLength(0)
        expect(body().classList.contains('lay-has-left')).toBe(false)
    })

    test('the light or dark toggle sets the color mode of the Tweakpane UI, and its Color Mode dropdown follows', () => {
        const p = plugin()
        const ui = {colorMode: 'clean', uiConfig: {uiRefresh: vi.fn()}}
        ;(p as any)._viewer = {getPlugin: () => ui}
        p.layout = 'titlebar'
        win.fire('keydown', {key: 'T', code: 'KeyT', shiftKey: true, target: body()})
        expect(ui.colorMode).toBe('clean-dark')
        expect(ui.uiConfig.uiRefresh).toHaveBeenCalled()
    })
})
