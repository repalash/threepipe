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
    get firstElementChild() {
        return this.children[0] ?? null
    }
    prepend(c: FakeElement) {
        this.insertBefore(c, this.children[0] ?? null)
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
        // stopImmediatePropagation stops the next listeners of this element, as in a page
        let stopped = false
        const event = {target: this, currentTarget: this, defaultPrevented: false, preventDefault: () => {
            event.defaultPrevented = true
        }, stopPropagation: () => {}, ...e, stopImmediatePropagation: () => {
            stopped = true
            e.stopImmediatePropagation?.()
        }}
        for (const f of this._listeners.get(type) ?? []) {
            f(event)
            if (stopped) break
        }
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
    // the gap of the floating cards (EditorFrame.css)
    vi.stubGlobal('getComputedStyle', () => ({getPropertyValue: (k: string) => k === '--lay-gap' ? '12px' : ''}))
})
afterEach(() => {
    vi.unstubAllGlobals()
})

const {EditorModeBar} = await import('../../plugins/tweakpane-editor/src/frame/EditorModeBar')
const {EditorFrame} = await import('../../plugins/tweakpane-editor/src/frame/EditorFrame')
const {TweakpaneEditorPlugin} = await import('../../plugins/tweakpane-editor/src/TweakpaneEditorPlugin')

const host = () => ({modeKeys: ['Viewer', 'Export'], setSelectedMode: vi.fn()})
/**
 * Fills a place with panels, one for each element, with the ids `<area><index>` in order (and takes out the panels of
 * those ids that were there): what a test of a stack needs. Works on an EditorFrame and on a TweakpaneEditorPlugin.
 */
const place = (f: {removePanel(id: string): void, addPanel(id: string, el: any, o?: any): void}, area: 'left' | 'bottom' | 'right', el: any, options?: any) => {
    for (let i = 0; i < 10; i++) f.removePanel(area + i)
    const els = el === null ? [] : Array.isArray(el) ? el : [el]
    els.forEach((e: any, i: number) => f.addPanel(area + i, e, {...Array.isArray(options) ? options[i] : i === 0 ? options : {}, area}))
}
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
    const layoutButton = (f: InstanceType<typeof EditorFrame>) => layoutButtonOf((f.modeBar.element as any as FakeElement).find('lay-mode-btn'))

    for (const [layout, expanded] of [['titlebar', true], ['floating', false], ['floating', true]] as const) {
        test(`the tooltip of the layout button hides while its menu is open, and never doubles (${layout}, names ${expanded ? 'shown' : 'hidden'})`, () => {
            const f = frame(layout, expanded)
            const b = layoutButton(f)
            const before = tipsOnHover(b)
            expect(before).toBe(expanded ? 0 : 1)
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
    /** The elements of the panels of a place: each panel is in a section */
    const els = (name: string) => area(name)[0].children.filter(c => c.classList.contains('lay-section')).map(c => c.children[0])
    /** The parts of the frame in the body, and in the mode bar (the actions) */
    const structure = (f: InstanceType<typeof EditorFrame>) => ({
        bars: body().children.filter(c => c.classList.contains('lay-bar')).map(c => ['top', 'bottom', 'head'].find(k => c.classList.contains('lay-' + k))),
        areas: body().children.filter(c => c.classList.contains('lay-area')).map(c => c.className),
        modeActions: (f.modeBar.element as any as FakeElement).find('lay-mode-actions').length,
        classes: body().className.split(' ').filter(c => c.startsWith('lay-')).sort(),
    })

    // floating has no bar: its head has the name (at the top of the left column)
    const bars = {titlebar: ['top'], statusbar: ['bottom'], floating: ['head']}
    for (const layout of ['titlebar', 'statusbar', 'floating'] as const) {
        test(`${layout}: the bars, the mode bar and an empty left and bottom area, which take no room`, () => {
            const f = new EditorFrame(host(), {layout})
            expect(structure(f)).toEqual({
                bars: bars[layout],
                areas: ['lay-area lay-area-left', 'lay-area lay-area-bottom'],
                modeActions: 1, // the same place in each layout
                // no lay-has-<area>: the CSS gives an empty area no room (tweakpane-editor-frame-css.test.ts)
                classes: ['lay-' + layout, 'lay-frame', 'lay-side'].sort(), // lay-side: 1440 x 900 (EditorFrame.Breakpoints)
            })
            expect(area('left')[0].children).toHaveLength(0)
            expect(area('bottom')[0].children).toHaveLength(0)
            expect(body().find('mb-root')).toHaveLength(1)
        })

        test(`${layout}: an element in the left area shows it, and a null empties the area`, () => {
            const f = new EditorFrame(host(), {layout})
            const layers = new FakeElement('div')
            place(f, 'left', layers as any)
            expect(els('left')).toEqual([layers])
            expect(body().classList.contains('lay-has-left')).toBe(true)
            expect(body().classList.contains('lay-has-bottom')).toBe(false)
            // another element takes its place
            const catalogue = new FakeElement('div')
            place(f, 'left', catalogue as any)
            expect(els('left')).toEqual([catalogue])
            expect(area('left')[0].contains(layers)).toBe(false)
            place(f, 'left', null)
            expect(area('left')[0].children).toHaveLength(0)
            expect(body().classList.contains('lay-has-left')).toBe(false)
        })
    }

    test('the light or dark and the layout buttons stay at the same place in the mode bar in each layout, and the bars have no buttons', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar', colorMode: {get: () => 'clean', set: () => {}}})
        const bar = f.modeBar.element as any as FakeElement
        const actions = bar.find('lay-mode-actions')[0]
        for (const layout of ['titlebar', 'statusbar', 'floating', 'titlebar'] as const) {
            f.setLayout(layout)
            expect(bar.find('lay-mode-actions'), layout).toEqual([actions])
            // above the names toggle, the last child
            expect(bar.children.indexOf(actions), layout).toBe(bar.children.length - 2)
            expect(actions.children.map(b => b.getAttribute('aria-label')), layout).toEqual(['Light or dark (Shift T)', 'Layout of the page'])
            for (const b of body().children.filter(c => c.classList.contains('lay-bar'))) expect(b.all().filter(e => e.tagName.toLowerCase() === 'button'), layout).toHaveLength(0)
        }
        f.dispose()
        expect(bar.find('lay-mode-actions')).toHaveLength(0)
    })

    test('each bar shows the logo and the app name: the title bar, the status bar and the floating head', () => {
        const f = new EditorFrame(host(), {layout: 'statusbar', title: 'My app'})
        const app = (cls: string) => body().children.find(c => c.classList.contains(cls))!.find('lay-app')[0]
        for (const [layout, cls] of [['statusbar', 'lay-bottom'], ['titlebar', 'lay-top'], ['floating', 'lay-head']] as const) {
            f.setLayout(layout)
            expect(app(cls).children.filter(c => c.tagName === 'b').map(c => c.textContent), layout).toEqual(['My app'])
        }
    })

    test('the areas keep their elements when the layout changes, and go with the frame', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const left = new FakeElement('div'), bottom = new FakeElement('div')
        place(f, 'left', left as any)
        place(f, 'bottom', bottom as any)
        for (const layout of ['floating', 'statusbar', 'titlebar'] as const) {
            f.setLayout(layout)
            expect(els('left'), layout).toEqual([left])
            expect(els('bottom'), layout).toEqual([bottom])
            expect(structure(f).classes, layout).toEqual(['lay-' + layout, 'lay-frame', 'lay-has-bottom', 'lay-has-left', 'lay-side'].sort())
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
        expect(stored()).toEqual({sizes: {right: 600, bottom: 250}, collapsed: {}, panels: {}, weights: {}, stacked: 'right', offsets: {}, spans: {}, rightShare: 0.5})
    })

    test('the left area and the panel leave room for the canvas next to each other and the mode bar', () => {
        vi.stubGlobal('innerWidth', 1000)
        const panel = new FakeElement('div')
        panel.getBoundingClientRect = () => ({width: 300, height: 800}) as any
        const f = new EditorFrame(host(), {layout: 'titlebar', panel: () => panel as any})
        place(f, 'left', new FakeElement('div') as any)
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
        place(f, 'left', new FakeElement('div') as any)
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
        place(f, 'left', new FakeElement('div') as any)
        const modeBar = f.modeBar.expanded ? EditorModeBar.Widths.wide : EditorModeBar.Widths.narrow
        const left = parseInt(sizeVar('--lay-left-area-size')!), right = parseInt(sizeVar('--tweakpane-ui-container-width')!)
        expect(left + right + modeBar + EditorFrame.MinCanvasWidth).toBeLessThanOrEqual(1200)
        expect(left).toBeGreaterThanOrEqual(EditorFrame.AreaLimits.left[0])
    })

    test('the sizes get smaller when the window gets smaller, and come back when it is wide again', () => {
        vi.stubGlobal('innerWidth', 1440)
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', new FakeElement('div') as any)
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
        place(f, 'left', new FakeElement('div') as any)
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
        expect(stored()).toEqual({sizes: {}, collapsed: {left: false}, panels: {}, weights: {}, stacked: 'right', offsets: {}, spans: {}, rightShare: 0.5})
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

    test('a stack with a list of options: an entry for each element, which shows or hides it; the last one collapses the area', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const layers = new FakeElement('div'), inspector = new FakeElement('div')
        place(f, 'left', [layers, inspector] as any, [{name: 'Layers'}, {name: 'Inspector'}])
        place(f, 'bottom', new FakeElement('div') as any, {name: 'Timeline'})
        const box = (f.modeBar.element as any as FakeElement).find('lay-area-entries')[0]
        const all = () => box.find('lay-area-entry').filter(e => e.style.display !== 'none')
        // in the order of the areas, then of the elements (the right area is empty: no entry)
        expect(all().map(e => e.getAttribute('aria-label'))).toEqual(['Layers', 'Inspector', 'Timeline'])
        const [eLayers, eInspector] = all()
        const sections = body().find('lay-area-left')[0].find('lay-section')
        const split = body().find('lay-area-left')[0].find('lay-split')[0]
        const hidden = (e: FakeElement) => e.classList.contains('lay-section-hidden')
        expect([marked(eLayers), marked(eInspector)]).toEqual([true, true])
        eLayers.click()
        expect([hidden(sections[0]), hidden(sections[1]), hidden(split), marked(eLayers), marked(eInspector)]).toEqual([true, false, true, false, true])
        expect(stored().panels).toEqual({left0: {hidden: true}})
        // the last shown element: the area collapses, the element stays
        eInspector.click()
        expect([f.isAreaCollapsed('left'), hidden(sections[1]), marked(eInspector)]).toEqual([true, false, false])
        // an entry opens the area with its element
        eLayers.click()
        expect([f.isAreaCollapsed('left'), hidden(sections[0]), hidden(sections[1]), hidden(split)]).toEqual([false, false, false, false])
    })

    test('a right-click on the entry of a panel opens its Move menu: the places, its own checked; a pick moves it, kept', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const layers = new FakeElement('div')
        f.addPanel('layers', layers as any, {name: 'Layers', area: 'left'})
        f.addPanel('timeline', new FakeElement('div') as any, {name: 'Timeline', area: 'bottom'})
        const box = (f.modeBar.element as any as FakeElement).find('lay-area-entries')[0]
        const entry = box.find('lay-area-entry')[0]
        let prevented = false
        entry.fire('contextmenu', {preventDefault: () => prevented = true})
        const menu = body().find('lay-menu')[0]
        expect(prevented).toBe(true)
        expect(menu.children.map(i => i.textContent + (i.getAttribute('aria-checked') === 'true' ? '*' : ''))).toEqual(['Left sidebar*', 'Bottom strip', 'Right sidebar'])
        menu.children[1].click()
        expect([f.panelArea('layers'), body().find('lay-area-bottom')[0].contains(layers), body().classList.contains('lay-has-left')]).toEqual(['bottom', true, false])
        // at the end of the stack of its new place; the entries follow the places, then the stacks
        expect(box.find('lay-area-entry').map(e => e.getAttribute('aria-label'))).toEqual(['Timeline', 'Layers'])
        expect(stored().panels).toEqual({layers: {area: 'bottom', hidden: false}})
        // a new frame (a reload) puts it in the kept place
        f.dispose()
        const g = new EditorFrame(host(), {layout: 'titlebar'})
        g.addPanel('layers', layers as any, {name: 'Layers', area: 'left'})
        expect(g.panelArea('layers')).toBe('bottom')
    })

    test('a long press on the entry of a panel on a touch screen opens the Move menu, and is not a tap', () => {
        vi.useFakeTimers()
        try {
            const f = new EditorFrame(host(), {layout: 'titlebar'})
            f.addPanel('layers', new FakeElement('div') as any, {name: 'Layers'})
            const entry = (f.modeBar.element as any as FakeElement).find('lay-area-entry')[0]
            entry.fire('pointerdown', {pointerType: 'touch', clientX: 0, clientY: 0})
            vi.advanceTimersByTime(EditorFrame.LongPressTime)
            entry.fire('pointerup', {})
            entry.click()
            expect([body().find('lay-menu').length, f.isPanelHidden('layers')]).toEqual([1, false])
        } finally {
            vi.useRealTimers()
        }
    })

    test('movePanel and removePanel: the panels of a place in their order; an empty place takes no room', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const a = new FakeElement('div'), b = new FakeElement('div')
        f.addPanel('a', a as any, {area: 'left'})
        f.addPanel('b', b as any, {area: 'left'})
        expect(f.panelIds).toEqual(['a', 'b'])
        f.setPanelHidden('a', true)
        f.movePanel('a', 'right') // not kept: from code
        expect([f.panelArea('a'), f.isPanelHidden('a'), stored()?.panels ?? {}]).toEqual(['right', false, {}])
        expect(body().find('lay-area-left')[0].find('lay-split')).toHaveLength(0)
        f.removePanel('b')
        expect([body().classList.contains('lay-has-left'), f.panelIds]).toEqual([false, ['a']])
        // the same id again: in place of the old panel
        const c = new FakeElement('div')
        f.addPanel('a', c as any, {area: 'left'})
        expect([f.panelIds, f.panelArea('a'), body().find('lay-area-left')[0].contains(c)]).toEqual([['a'], 'left', true])
    })

    test('a place left with only hidden panels (its last shown panel moved away or removed) collapses, and its panels show in it', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('b', new FakeElement('div') as any, {area: 'left'})
        f.setPanelHidden('b', true, true)
        f.movePanel('a', 'right', true)
        expect([f.isAreaCollapsed('left'), body().classList.contains('lay-collapsed-left'), f.isPanelHidden('b')]).toEqual([true, true, false])
        expect([stored().collapsed.left, stored().panels.b.hidden]).toEqual([true, false])
        // a tap on its entry opens the place again with it
        const entry = (id: string) => (f.modeBar.element as any as FakeElement).find('lay-area-entry').find(e => e === (f as any)._panels.get(id).entry)!
        entry('b').click()
        expect([f.isAreaCollapsed('left'), f.isPanelHidden('b')]).toEqual([false, false])
        // the same when the last shown panel is removed
        f.addPanel('c', new FakeElement('div') as any, {area: 'bottom'})
        f.addPanel('d', new FakeElement('div') as any, {area: 'bottom'})
        f.setPanelHidden('d', true)
        f.removePanel('c')
        expect([f.isAreaCollapsed('bottom'), f.isPanelHidden('d')]).toEqual([true, false])
        // and the right place
        f.addPanel('e', new FakeElement('div') as any, {area: 'right'})
        f.setPanelHidden('e', true)
        f.movePanel('a', 'left')
        expect([f.isPanelHidden('e'), !!(f as any)._collapsed.right]).toEqual([false, true])
    })

    test('a panel that the person hid shows in its place when the last shown panel goes, and the kept pick says so', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('b', new FakeElement('div') as any, {area: 'left'})
        f.setPanelHidden('b', true, true)
        f.removePanel('a') // from code
        expect([f.isPanelHidden('b'), stored().panels.b.hidden]).toEqual([false, false])
        ;((f as any)._panels.get('b').entry as FakeElement).click() // opens the place
        expect(f.isAreaCollapsed('left')).toBe(false)
        f.dispose()
        // a reload with b only: the place opens with b shown
        const g = new EditorFrame(host(), {layout: 'titlebar'})
        g.addPanel('b', new FakeElement('div') as any, {area: 'left'})
        expect([g.isPanelHidden('b'), g.isAreaCollapsed('left')]).toEqual([false, false])
    })

    test('a removed or replaced panel takes the tooltip of its entry out of the mode bar', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const tips = () => (f.modeBar as any)._tips.length
        const group = () => singletons.find(s => s === (f.modeBar as any)._tipGroup)!.children!.length
        const before = [tips(), group()]
        for (let i = 0; i < 5; i++) {
            f.addPanel('layers', new FakeElement('div') as any, {area: 'left'})
            f.removePanel('layers')
        }
        expect([tips(), group()]).toEqual(before)
        f.addPanel('layers', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('layers', new FakeElement('div') as any, {area: 'left'}) // in place of the old one
        expect([tips(), group()]).toEqual([before[0] + 1, before[1] + 1])
    })

    test('addPanel with the id of a panel in another place lays out the old place again', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'bottom'})
        expect([body().classList.contains('lay-has-left'), body().find('lay-area-left')[0].children.length, f.panelArea('a')]).toEqual([false, 0, 'bottom'])
        // one of more: no split left behind
        f.addPanel('b', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('c', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('b', new FakeElement('div') as any, {area: 'right'})
        expect(body().find('lay-area-left')[0].find('lay-split')).toHaveLength(0)
        expect(body().find('lay-area-left')[0].find('lay-section')).toHaveLength(1)
    })

    test('a restore keeps a hidden panel that the app adds before the shown ones, and the place open', () => {
        storage.set('tpEditorFrameAreas', JSON.stringify({panels: {notes: {hidden: true}}}))
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('notes', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('second', new FakeElement('div') as any, {area: 'left'})
        expect([f.isPanelHidden('notes'), f.isPanelHidden('second'), f.isAreaCollapsed('left')]).toEqual([true, false, false])
    })

    test('a tap on the entry of a panel in the right place while the panel cannot be seen shows it, and does not hide it', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('insp', new FakeElement('div') as any, {area: 'right'})
        f.addPanel('layers', new FakeElement('div') as any, {area: 'left'})
        const entry = (id: string) => (f as any)._panels.get(id).entry as FakeElement
        // the mode bar hid the panel
        f.modeBar.setOpen(false)
        entry('insp').click()
        expect([f.modeBar.open, f.isPanelHidden('insp'), !!(f as any)._collapsed.right, marked(entry('insp'))]).toEqual([true, false, false, true])
        // shown: a tap hides it, as before (the only one: the place collapses)
        entry('insp').click()
        expect([!!(f as any)._collapsed.right, marked(entry('insp'))]).toEqual([true, false])
        entry('insp').click()
        expect(marked(entry('insp'))).toBe(true)
        // a narrow window with the left place in the place of the panel
        vi.stubGlobal('innerWidth', 600)
        vi.stubGlobal('innerHeight', 900)
        win.fire('resize')
        f.setStackedArea('left')
        expect(marked(entry('insp'))).toBe(false)
        entry('insp').click()
        expect([f.stackedArea, f.isPanelHidden('insp'), !!(f as any)._collapsed.right, marked(entry('insp'))]).toEqual(['right', false, false, true])
    })

    test('a panel moved to the right place shows when the mode bar hid the panel', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'left'})
        f.modeBar.setOpen(false)
        f.movePanel('a', 'left') // the same place: the panel stays hidden
        expect(f.modeBar.open).toBe(false)
        f.movePanel('a', 'right', true)
        expect([f.modeBar.open, f.isPanelHidden('a'), f.panelArea('a')]).toEqual([true, false, 'right'])
    })

    test('a panel that leaves the right place shows the mode settings again (an app hid them for it, like swap)', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('insp', new FakeElement('div') as any, {area: 'right'})
        f.addPanel('layers', new FakeElement('div') as any, {area: 'left'})
        f.setModeSettingsHidden(true)
        f.movePanel('insp', 'left', true)
        expect(f.modeSettingsHidden).toBe(false)
        // another panel in the right place later: the mode settings show under it
        f.movePanel('layers', 'right', true)
        expect(f.modeSettingsHidden).toBe(false)
        // a move within the right place keeps them; a remove from it shows them
        f.setModeSettingsHidden(true)
        f.movePanel('layers', 'right')
        expect(f.modeSettingsHidden).toBe(true)
        f.removePanel('layers')
        expect(f.modeSettingsHidden).toBe(false)
        // a panel that leaves another place does not change them
        f.addPanel('r', new FakeElement('div') as any, {area: 'right'})
        f.setModeSettingsHidden(true)
        f.movePanel('insp', 'bottom')
        expect(f.modeSettingsHidden).toBe(true)
    })

    test('a narrow window: a moved panel shows in its new place, which takes the place of the panel', () => {
        vi.stubGlobal('innerWidth', 600)
        vi.stubGlobal('innerHeight', 900)
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('b', new FakeElement('div') as any, {area: 'left'})
        f.setStackedArea('left')
        f.movePanel('b', 'bottom', true)
        expect([f.stackedArea, body().classList.contains('lay-stacked-bottom'), f.isPanelHidden('b'), stored().stacked]).toEqual(['bottom', true, false, 'bottom'])
        f.movePanel('a', 'right', true)
        expect([f.stackedArea, f.modeBar.open]).toEqual(['right', true])
    })

    test('a narrow window, no hidden element kept: a tap on an entry of the stack shown hides that element, not the place', () => {
        vi.stubGlobal('innerWidth', 600)
        vi.stubGlobal('innerHeight', 900)
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', [new FakeElement('div'), new FakeElement('div')] as any, [{name: 'Layers'}, {name: 'Inspector'}])
        f.setStackedArea('left')
        const box = (f.modeBar.element as any as FakeElement).find('lay-area-entries')[0]
        box.find('lay-area-entry')[0].click()
        expect([f.isPanelHidden('left0'), f.isPanelHidden('left1'), f.modeBar.open, f.stackedArea]).toEqual([true, false, true, 'left'])
        // the last element shown: the place hides
        box.find('lay-area-entry')[1].click()
        expect([f.isPanelHidden('left1'), f.modeBar.open]).toEqual([false, false])
    })

    test('a drag of a split changes the two shown sections next to it; a hidden section keeps its weight', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', [new FakeElement('div'), new FakeElement('div'), new FakeElement('div')] as any, [{}, {}, {}])
        f.setPanelHidden('left1', true)
        const leftArea = body().find('lay-area-left')[0]
        const sections = leftArea.find('lay-section')
        // a hidden section measures 0, the shown ones 100 px
        sections.forEach((sec, i) => (sec as any).getBoundingClientRect = () => ({left: 0, top: 0, right: 100, bottom: i === 1 ? 0 : 100, width: 100, height: i === 1 ? 0 : 100}))
        const split = leftArea.find('lay-split')[1] // before the third section: between the first and the third
        split.fire('pointerdown', {button: 0, clientY: 0})
        win.fire('pointermove', {clientY: 50})
        win.fire('pointerup', {})
        const weights = sections.map(sec => Number(sec.style.flexGrow))
        expect(weights[1]).toBe(1)
        expect(weights[0]).toBeCloseTo(1.5)
        expect(weights[2]).toBeCloseTo(0.5)
    })

    test('the place and the hidden state that the person picks are kept by the id of the panel', () => {
        storage.set('tpEditorFrameAreas', JSON.stringify({panels: {b: {hidden: true}, c: {area: 'bottom'}, d: {area: 'top', hidden: 'x'}}}))
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        f.addPanel('a', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('b', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('c', new FakeElement('div') as any, {area: 'left'})
        f.addPanel('d', new FakeElement('div') as any, {area: 'left'}) // a place that is not one, a hidden that is not a boolean: left out
        expect(['a', 'b', 'c', 'd'].map(id => [f.panelArea(id), f.isPanelHidden(id)])).toEqual([['left', false], ['left', true], ['bottom', false], ['left', false]])
    })

    test('the breakpoints set the layout classes on the body; a resize sets them again', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const classes = () => ['lay-stack', 'lay-side', 'lay-single'].filter(c => body().classList.contains(c))
        expect(classes()).toEqual(['lay-side']) // 1440 x 900
        const size = (w: number, h: number) => {
            vi.stubGlobal('innerWidth', w)
            vi.stubGlobal('innerHeight', h)
            win.fire('resize')
        }
        size(390, 664) // a phone in portrait
        expect(classes()).toEqual(['lay-stack', 'lay-single'])
        size(919, 1200)
        expect(classes()).toEqual(['lay-stack', 'lay-single'])
        size(920, 1200)
        expect(classes()).toEqual(['lay-side'])
        size(699, 390) // a narrow landscape window
        expect(classes()).toEqual(['lay-side', 'lay-single'])
        size(700, 390)
        expect(classes()).toEqual(['lay-side'])
        // other numbers: the next resize uses them
        const defaults = {...EditorFrame.Breakpoints}
        try {
            EditorFrame.Breakpoints.singleView = 800
            size(780, 390)
            expect(classes()).toEqual(['lay-side', 'lay-single'])
        } finally {
            Object.assign(EditorFrame.Breakpoints, defaults)
        }
        f.dispose()
        expect(classes()).toEqual([])
    })

    test('areas at the size of the CSS shrink when the window has no room for them, and get it back when it has', () => {
        vi.stubGlobal('innerWidth', 1000)
        vi.stubGlobal('innerHeight', 500) // landscape: side by side
        storage.set('tpEditorModeBarExpanded', '0')
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', new FakeElement('div') as any)
        // on screen: the variable, else the 240 px of the CSS
        area('left').getBoundingClientRect = () => ({width: parseInt(sizeVar('--lay-left-area-size') ?? '240'), height: 800}) as any
        const room = (w: number) => w - 240 /* panel, no variable: AreaLimits */ - EditorModeBar.Widths.narrow - EditorFrame.MinCanvasWidth
        vi.stubGlobal('innerWidth', 720)
        win.fire('resize')
        expect(sizeVar('--lay-left-area-size')).toBe(Math.max(160, room(720)) + 'px')
        vi.stubGlobal('innerWidth', 1400)
        win.fire('resize')
        expect(sizeVar('--lay-left-area-size')).toBeUndefined() // the size of the CSS again
        expect(stored()).toBeNull() // not a size that the person picked
        // a narrow window shows the areas one at a time: no fitting for them
        vi.stubGlobal('innerWidth', 650)
        win.fire('resize')
        expect(sizeVar('--lay-left-area-size')).toBeUndefined()
    })

    test('each panel has an entry in the mode bar, after the modes, with its name, icon and colour', () => {
        const f = new EditorFrame(host(), {layout: 'floating'})
        const bar = f.modeBar.element as any as FakeElement
        const box = bar.find('lay-area-entries')[0]
        // after the two modes, before the actions of the floating layout and the names toggle
        expect(bar.children.indexOf(box)).toBe(2)
        expect(bar.children.indexOf(box)).toBeLessThan(bar.children.indexOf(bar.find('lay-mode-actions')[0]))
        expect([shown(box), box.find('lay-area-entry').length]).toEqual([false, 0])
        f.addPanel('layers', new FakeElement('div') as any, {name: 'Layers', icon: '<svg class="layers-icon"></svg>'})
        let e = box.find('lay-area-entry')[0]
        expect(shown(box)).toBe(true)
        expect([e.getAttribute('aria-label'), e.find('mb-label')[0].textContent, e.find('layers-icon').length]).toEqual(['Layers', 'Layers', 1])
        expect(e._tippy!.props.content).toBe('Layers')
        expect(e.style['--mb-color']).toBeUndefined() // the grey of the CSS
        f.addPanel('layers', new FakeElement('div') as any, {name: 'Layers', color: '#7c5cff'})
        e = box.find('lay-area-entry')[0]
        expect([box.find('lay-area-entry').length, e.style['--mb-color']]).toEqual([1, '#7c5cff'])
        // no name: the name of its place
        f.addPanel('strip', new FakeElement('div') as any, {area: 'bottom'})
        expect(box.find('lay-area-entry')[1].getAttribute('aria-label')).toBe(EditorFrame.AreaNames.bottom)
        f.removePanel('layers')
        f.removePanel('strip')
        expect([shown(box), box.find('lay-area-entry').length]).toEqual([false, 0])
        f.dispose()
        expect(bar.find('lay-area-entries')).toHaveLength(0)
    })

    test('in a wide window, an entry shows or hides its area, and is marked while it shows', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', new FakeElement('div') as any)
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
        vi.stubGlobal('innerWidth', 390) // a phone in portrait (EditorFrame.Breakpoints)
        vi.stubGlobal('innerHeight', 664)
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', new FakeElement('div') as any, {name: 'Layers'})
        place(f, 'bottom', new FakeElement('div') as any)
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
        place(f, 'left', null)
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
        place(f, 'left', new FakeElement('div') as any)
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
        expect(stored()).toEqual({sizes: {left: 160}, collapsed: {left: false}, panels: {}, weights: {}, stacked: 'right', offsets: {}, spans: {}, rightShare: 0.5})
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
        place(f, 'bottom', new FakeElement('div') as any)
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
        expect(stored()).toEqual({sizes: {}, collapsed: {bottom: false}, panels: {}, weights: {}, stacked: 'right', offsets: {}, spans: {}, rightShare: 0.5})
    })

    /** A floating frame with a 300 px panel and a 240 px left card (the gap is 12 px, see getComputedStyle above) */
    const floating = () => {
        const panel = new FakeElement('div')
        panel.getBoundingClientRect = () => ({width: 300, height: 876}) as any
        const f = new EditorFrame(host(), {layout: 'floating', panel: () => panel as any})
        place(f, 'left', new FakeElement('div') as any)
        area('left').getBoundingClientRect = () => ({width: 240, height: 876}) as any
        return f
    }
    const grip = (a: string) => body().find('lay-grip-' + a)[0]
    const end = (a: string, which: string) => body().find(`lay-end-${a}-${which}`)[0]

    test('floating: setAreaOffset moves a card within the room for the canvas; setAreaSpan sets its part of the side', () => {
        const f = floating()
        f.setAreaOffset('left', 100)
        expect([f.areaOffset('left'), sizeVar('--lay-left-offset')]).toEqual([100, '100px'])
        // the size and the offset share the room: 1440 - 300 (panel) - 168 (mode bar with names) - 240 (canvas) = 732, less 240
        f.setAreaOffset('left', 2000)
        expect(f.areaOffset('left')).toBe(492)
        // the panel then has no room to move: 1440 - 240 - 492 - 168 - 240 = 300, its size
        f.setAreaOffset('right', 50)
        expect(f.areaOffset('right')).toBe(0)
        f.setAreaOffset('left', 100)
        f.setAreaOffset('right', 50)
        expect([f.areaOffset('right'), sizeVar('--lay-right-offset')]).toEqual([50, '50px'])
        // along the side: the window height less the gaps, 876 px
        f.setAreaSpan('left', {start: 100, length: 400})
        expect([f.areaSpan('left'), sizeVar('--lay-left-start'), sizeVar('--lay-left-length')]).toEqual([{start: 100, length: 400}, '100px', '400px'])
        f.setAreaSpan('left', {start: 800, length: 400})
        expect(f.areaSpan('left')).toEqual({start: 476, length: 400})
        f.setAreaSpan('left', {start: 0, length: 10})
        expect(f.areaSpan('left')).toEqual({start: 0, length: EditorFrame.MinCardLength})
        // no length: to the end of the side, which the CSS fills
        f.setAreaSpan('left', {start: 100})
        expect([f.areaSpan('left'), sizeVar('--lay-left-length')]).toEqual([{start: 100, length: 776}, undefined])
        // the row of the bottom card: between the left card (12 + 100 + 240) and the panel with the mode bar (12 + 50 + 468 + 12)
        place(f, 'bottom', new FakeElement('div') as any)
        expect(f.areaSpan('bottom')).toEqual({start: 0, length: 1440 - 352 - 12 - 542})
        f.setAreaSpan('left', null)
        expect([f.areaSpan('left'), sizeVar('--lay-left-start')]).toEqual([{start: 0, length: 876}, undefined])
        f.setAreaOffset('left', null)
        expect([f.areaOffset('left'), sizeVar('--lay-left-offset')]).toEqual([0, undefined])
    })

    test('a larger size of a moved card makes its offset smaller, so the card stays in the room', () => {
        const f = floating()
        // the left card is as wide as its size on screen
        area('left').getBoundingClientRect = () => ({width: parseFloat(body().style['--lay-left-area-size'] ?? '240'), height: 876}) as any
        f.setAreaSize('left', 160)
        // the room: 1440 - 300 (panel) - 168 (mode bar with names) - 240 (canvas) = 732
        f.setAreaOffset('left', 600)
        expect(f.areaOffset('left')).toBe(572)
        f.setAreaSize('left', 480)
        expect([sizeVar('--lay-left-area-size'), f.areaOffset('left')]).toEqual(['480px', 252])
    })

    test('a size that the person sets makes the offset of the other card smaller', () => {
        const f = floating()
        area('left').getBoundingClientRect = () => ({width: parseFloat(body().style['--lay-left-area-size'] ?? '240'), height: 876}) as any
        f.setAreaOffset('right', 2000)
        expect(f.areaOffset('right')).toBe(492)
        // 480 px fit when the panel moves back: 1440 - 480 - 168 - 240 - 300 = 252
        f.setAreaSize('left', 480)
        expect([sizeVar('--lay-left-area-size'), f.areaOffset('right')]).toEqual(['480px', 252])
    })

    test('a narrow window: a drag of the panel edge starts from the width of the area shown in the place of the panel', () => {
        wide = false
        vi.stubGlobal('innerWidth', 640)
        vi.stubGlobal('innerHeight', 360)
        const panel = new FakeElement('div')
        // hidden: the area takes its place
        panel.getBoundingClientRect = () => ({width: 0, height: 0}) as any
        const f = new EditorFrame(host(), {layout: 'titlebar', panel: () => panel as any})
        place(f, 'left', new FakeElement('div') as any)
        area('left').getBoundingClientRect = () => ({width: 300, height: 324}) as any
        f.setStackedArea('left')
        drag(handle('right'), {clientX: 296}, {clientX: 286})
        expect(sizeVar('--tweakpane-ui-container-width')).toBe('310px')
    })

    test('a smaller window makes the offsets smaller before the sizes of the other cards', () => {
        const f = floating()
        area('left').getBoundingClientRect = () => ({width: parseFloat(body().style['--lay-left-area-size'] ?? '240'), height: 876}) as any
        // the room of the panel: 1440 - 240 (left card) - 168 (mode bar with names) - 240 (canvas) = 792, less 300
        f.setAreaOffset('right', 2000)
        expect(f.areaOffset('right')).toBe(492)
        // at 1000 px the offset goes to 1000 - 240 - 168 - 240 - 300 = 52, and the left card keeps its 240 px
        vi.stubGlobal('innerWidth', 1000)
        win.fire('resize')
        expect([f.areaOffset('right'), sizeVar('--lay-left-area-size')]).toEqual([52, undefined])
    })

    test('the offsets and the spans apply only in the floating layout with the areas next to the canvas, and are kept', () => {
        const f = floating()
        f.setAreaOffset('left', 100, true)
        f.setAreaSpan('right', {start: 50, length: 500}, true)
        expect(stored()).toMatchObject({offsets: {left: 100}, spans: {right: {start: 50, length: 500}}})
        f.setLayout('titlebar')
        expect([f.areaOffset('left'), f.areaSpan('right'), sizeVar('--lay-left-offset'), sizeVar('--lay-right-start')]).toEqual([0, undefined, undefined, undefined])
        f.setLayout('floating')
        expect([f.areaOffset('left'), f.areaSpan('right')]).toEqual([100, {start: 50, length: 500}])
        // a narrow window shows the areas one at a time
        vi.stubGlobal('innerWidth', 640)
        vi.stubGlobal('innerHeight', 360)
        win.fire('resize')
        expect([f.areaOffset('left'), f.areaSpan('right'), sizeVar('--lay-right-length')]).toEqual([0, undefined, undefined])
        f.dispose()
        // a new frame applies the kept ones; values that are not numbers are ignored
        vi.stubGlobal('innerWidth', 1440)
        vi.stubGlobal('innerHeight', 900)
        storage.set('tpEditorFrameAreas', JSON.stringify({offsets: {left: 80, right: 'x'}, spans: {left: {start: 30, length: 300}, bottom: {start: 'a'}}}))
        const g = floating()
        expect([g.areaOffset('left'), g.areaOffset('right'), g.areaSpan('left')]).toEqual([80, 0, {start: 30, length: 300}])
        g.dispose()
        for (const k of ['offset', 'start', 'length']) expect(sizeVar(`--lay-left-${k}`), k).toBeUndefined()
    })

    test('a drag of a grip moves the card on both axes and keeps its length; a double-click puts it back', () => {
        const f = floating()
        drag(grip('left'), {clientX: 6, clientY: 400}, {clientX: 56, clientY: 300}, {clientX: 106, clientY: 500})
        // 100 to the right; the card fills its side, so it cannot move down, and its span stays the whole side
        expect([f.areaOffset('left'), f.areaSpan('left')]).toEqual([100, {start: 0, length: 876}])
        expect(stored().offsets).toEqual({left: 100})
        expect(stored().spans.left).toBeUndefined()
        // the side is full: the start stays 0. A smaller card moves
        f.setAreaSpan('left', {start: 0, length: 400})
        drag(grip('left'), {clientX: 106, clientY: 400}, {clientX: 56, clientY: 600})
        expect([f.areaOffset('left'), f.areaSpan('left')]).toEqual([50, {start: 200, length: 400}])
        // the panel and the mode bar move to the left, the bottom card up and to the right
        drag(grip('right'), {clientX: 1434, clientY: 400}, {clientX: 1404, clientY: 400})
        expect(f.areaOffset('right')).toBe(30)
        place(f, 'bottom', new FakeElement('div') as any)
        area('bottom').getBoundingClientRect = () => ({width: 600, height: 160}) as any
        f.setAreaSpan('bottom', {start: 0, length: 300})
        drag(grip('bottom'), {clientX: 500, clientY: 894}, {clientX: 540, clientY: 874})
        expect([f.areaOffset('bottom'), f.areaSpan('bottom')]).toEqual([20, {start: 40, length: 300}])
        expect(body().classList.contains('lay-moving')).toBe(false)
        grip('left').fire('dblclick')
        expect([f.areaOffset('left'), f.areaSpan('left')]).toEqual([0, {start: 0, length: 876}])
        expect(stored().offsets.left).toBeUndefined()
    })

    test('after a drag, an end of a card that touches the end of its side stays there: the card grows with the side', () => {
        const f = floating()
        place(f, 'bottom', new FakeElement('div') as any)
        area('bottom').getBoundingClientRect = () => ({width: 684, height: 160}) as any
        // the row of the bottom card: 1440 - (12 + 240) - 12 - (12 + 468 + 12) = 684; 100 px off its left end
        drag(end('bottom', 'start'), {clientX: 264}, {clientX: 364})
        expect(f.areaSpan('bottom')).toEqual({start: 100, length: 584})
        expect(stored().spans.bottom).toEqual({start: 100})
        // the left card hides: the row is 936 px, and the card still reaches its right end
        f.setAreaCollapsed('left', true)
        expect(f.areaSpan('bottom')).toEqual({start: 100, length: 836})
        // a card made shorter at its right end keeps its length
        f.setAreaCollapsed('left', false)
        drag(end('bottom', 'end'), {clientX: 948}, {clientX: 848})
        expect(stored().spans.bottom).toEqual({start: 100, length: 484})
        f.setAreaCollapsed('left', true)
        expect(f.areaSpan('bottom')).toEqual({start: 100, length: 484})
    })

    test('the panels of a place: a stack of sections with a split between two; a drag moves the split, a double-click makes them equal', () => {
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        const [a, b, c] = [new FakeElement('div'), new FakeElement('div'), new FakeElement('div')]
        place(f, 'left', [a, b, c] as any)
        const box = area('left')
        expect(box.classList.contains('lay-split-area')).toBe(true)
        expect(box.children.map(e => e.className)).toEqual(['lay-section', 'lay-split', 'lay-section', 'lay-split', 'lay-section'])
        const sections = box.children.filter(e => e.classList.contains('lay-section'))
        expect(sections.map(e => e.children[0])).toEqual([a, b, c])
        expect(sections.map(e => e.style.flexGrow)).toEqual(['1', '1', '1'])
        const splits = box.children.filter(e => e.classList.contains('lay-split'))
        expect(splits.map(e => e.getAttribute('role'))).toEqual(['separator', 'separator'])
        // 300 px each: the first split 60 px down gives 360 and 240
        sections.forEach(e => e.getBoundingClientRect = () => ({width: 240, height: 300}) as any)
        drag(splits[0], {clientY: 300}, {clientY: 360})
        expect(sections.map(e => e.style.flexGrow)).toEqual(['1.2', '0.8', '1'])
        // kept by the id of the panel
        expect(stored().weights).toEqual({left0: 1.2, left1: 0.8})
        // at least MinSectionSize (the sections now measure as their weights give them: 360, 240 and 300)
        sections.forEach((e, i) => e.getBoundingClientRect = () => ({width: 240, height: [360, 240, 300][i]}) as any)
        drag(splits[1], {clientY: 600}, {clientY: 0})
        expect(sections[1].style.flexGrow).toBe(String(Math.round(EditorFrame.MinSectionSize / 900 * 3 * 1000) / 1000))
        splits[0].fire('dblclick')
        expect([sections.map(e => e.style.flexGrow), stored().weights]).toEqual([['1', '1', '1'], {}])
        // one panel: no stack (its section fills the place)
        place(f, 'left', a as any)
        expect([box.classList.contains('lay-split-area'), box.children.map(e => e.children[0])]).toEqual([false, [a]])
    })

    test('a stack keeps its split by the ids of its panels in a new frame; the bottom place stacks left to right', () => {
        storage.set('tpEditorFrameAreas', JSON.stringify({weights: {left0: 1.5, left1: 0.5, bottom0: 'x', bottom1: -1}}))
        const f = new EditorFrame(host(), {layout: 'titlebar'})
        place(f, 'left', [new FakeElement('div'), new FakeElement('div')] as any)
        const grow = (a: string) => area(a).children.filter(e => e.classList.contains('lay-section')).map(e => e.style.flexGrow)
        expect(grow('left')).toEqual(['1.5', '0.5'])
        // a new panel: weight 1, the others keep theirs
        place(f, 'left', [new FakeElement('div'), new FakeElement('div'), new FakeElement('div')] as any)
        expect(grow('left')).toEqual(['1.5', '0.5', '1'])
        // a value that is not a positive number is ignored
        place(f, 'bottom', [new FakeElement('div'), new FakeElement('div')] as any)
        expect(grow('bottom')).toEqual(['1', '1'])
        const split = area('bottom').children.find(e => e.classList.contains('lay-split'))!
        expect(split.getAttribute('aria-orientation')).toBe('vertical')
        area('bottom').children.filter(e => e.classList.contains('lay-section')).forEach(e => e.getBoundingClientRect = () => ({width: 400, height: 160}) as any)
        drag(split, {clientX: 400}, {clientX: 500})
        expect(grow('bottom')).toEqual(['1.25', '0.75'])
    })

    test('the head of the floating layout has the app name and the file name, and takes its room from the left column', () => {
        const f = floating()
        const head = body().find('lay-head')[0]
        expect(head.querySelector('b')!.textContent).toBe('threepipe')
        f.documentName = 'ring.glb'
        expect(head.querySelector('.lay-file')!.textContent).toBe('ring.glb')
        // not in the other layouts, which have a bar with the name
        f.setLayout('titlebar')
        expect(body().find('lay-head')).toHaveLength(0)
        f.setLayout('floating')
        // the side of the left card: 900 - 2 x 12, less the head (36 px) and its gap
        vi.stubGlobal('getComputedStyle', () => ({getPropertyValue: (k: string) => ({'--lay-gap': '12px', '--lay-head': '36px'} as any)[k] ?? ''}))
        f.setAreaSpan('left', {start: 0})
        expect(f.areaSpan('left')).toEqual({start: 0, length: 828})
        expect(f.areaSpan('right')).toEqual({start: 0, length: 876})
        f.dispose()
        expect(body().find('lay-head')).toHaveLength(0)
    })

    test('a drag of an end of a card sets its span; the other end stays; a double-click fills the side', () => {
        const f = floating()
        drag(end('left', 'start'), {clientY: 12}, {clientY: 112})
        expect(f.areaSpan('left')).toEqual({start: 100, length: 776})
        drag(end('left', 'end'), {clientY: 888}, {clientY: 588})
        expect(f.areaSpan('left')).toEqual({start: 100, length: 476})
        // not shorter than MinCardLength, from either end
        drag(end('left', 'start'), {clientY: 112}, {clientY: 900})
        expect(f.areaSpan('left')).toEqual({start: 576 - EditorFrame.MinCardLength, length: EditorFrame.MinCardLength})
        drag(end('left', 'end'), {clientY: 588}, {clientY: 0})
        expect(f.areaSpan('left')!.length).toBe(EditorFrame.MinCardLength)
        expect(stored().spans.left).toEqual(f.areaSpan('left'))
        end('left', 'end').fire('dblclick')
        expect([f.areaSpan('left'), sizeVar('--lay-left-length')]).toEqual([{start: 0, length: 876}, undefined])
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
        layoutButtonOf((p.frame!.modeBar.element as any as FakeElement).find('lay-mode-btn')).click()
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

    test('addPanel keeps the panel when the frame is made again, also after the classic layout; removePanel takes it out', () => {
        const p = plugin()
        const layers = new FakeElement('div')
        const inLeft = () => body().find('lay-area-left')[0]?.find('lay-section').map(e => e.children[0]) ?? []
        p.layout = 'classic'
        p.addPanel('layers', layers as any, {name: 'Layers', area: 'left'}) // no frame: kept for later
        expect(body().find('lay-area')).toHaveLength(0)
        p.layout = 'floating'
        expect(inLeft()).toEqual([layers])
        expect(body().classList.contains('lay-has-left')).toBe(true)
        p.layout = 'classic'
        expect(body().classList.contains('lay-has-left')).toBe(false)
        p.layout = 'titlebar'
        expect(inLeft()).toEqual([layers])
        p.removePanel('layers')
        p.layout = 'classic'
        p.layout = 'statusbar'
        expect(inLeft()).toHaveLength(0)
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

describe('EditorFrame right area', () => {
    const stored = () => JSON.parse(storage.get('tpEditorFrameAreas') ?? 'null')
    /** A frame with the container of the Tweakpane UI (the pane of the UI in it) as its panel */
    const setup = (layout: 'titlebar' | 'floating' = 'titlebar') => {
        const panel = new FakeElement('div')
        panel.id = 'tweakpaneUiContainer'
        const pane = panel.appendChild(new FakeElement('div'))
        pane.className = 'tp-rotv'
        const f = new EditorFrame(host(), {layout, panel: () => panel as any})
        const box = () => (f.modeBar.element as any as FakeElement).find('lay-area-entries')[0]
        const shownEntries = () => box().find('lay-area-entry').filter(e => e.style.display !== 'none')
        return {f, panel, pane, shownEntries}
    }
    const has = (c: string) => body().classList.contains(c)
    const tab = (f: InstanceType<typeof EditorFrame>, open: boolean) =>
        (f.modeBar.element as any as FakeElement).all().find(b => b.getAttribute('role') === 'tab' && (b.getAttribute('aria-selected') === 'true') === open)!

    test('the right area goes first in the panel, with a split, above the pane of the mode settings; null takes it out', () => {
        const {f, panel, pane, shownEntries} = setup()
        const inspector = new FakeElement('div')
        place(f, 'right', inspector as any, [{name: 'Inspector'}])
        const [area, split] = panel.children
        expect(area.classList.contains('lay-area-right')).toBe(true)
        expect(area.find('lay-section')[0].children).toEqual([inspector])
        expect(split.classList.contains('lay-pane-split')).toBe(true)
        expect(panel.children[2]).toBe(pane)
        expect([has('lay-has-right'), has('lay-right-shown')]).toEqual([true, true])
        expect(shownEntries().map(e => e.getAttribute('aria-label'))).toEqual(['Inspector'])
        place(f, 'right', null)
        expect(panel.children).toEqual([pane])
        expect([has('lay-has-right'), has('lay-right-shown')]).toEqual([false, false])
        expect(shownEntries()).toHaveLength(0)
    })

    test('its entry hides and shows it; hiding the only element collapses the right area, the mode settings stay', () => {
        const {f, shownEntries} = setup()
        place(f, 'right', new FakeElement('div') as any, [{name: 'Inspector'}])
        const entry = shownEntries()[0]
        expect(entry.classList.contains('lay-entry-on')).toBe(true)
        entry.click()
        expect([has('lay-right-shown'), entry.classList.contains('lay-entry-on'), f.modeBar.open]).toEqual([false, false, true])
        expect(stored().collapsed.right).toBe(true)
        entry.click()
        expect(has('lay-right-shown')).toBe(true)
    })

    test('a click on the open mode hides its settings while the right area shows, and a click shows them again', () => {
        const {f} = setup()
        place(f, 'right', new FakeElement('div') as any, [{name: 'Inspector'}])
        const bar = f.modeBar.element as any as FakeElement
        let stopped = false
        bar.fire('click', {target: tab(f, true), stopImmediatePropagation: () => stopped = true})
        expect([f.modeSettingsHidden, has('lay-mode-hidden'), stopped, f.modeBar.open]).toEqual([true, true, true, true])
        bar.fire('click', {target: tab(f, true), stopImmediatePropagation: () => {}})
        expect([f.modeSettingsHidden, has('lay-mode-hidden')]).toEqual([false, false])
        // another mode: its settings show
        f.setModeSettingsHidden(true)
        stopped = false
        bar.fire('click', {target: tab(f, false), stopImmediatePropagation: () => stopped = true})
        expect([f.modeSettingsHidden, stopped]).toEqual([false, false])
        // the settings hidden, then the panel hidden by the mode bar: a click on the open mode opens it with the settings
        f.setModeSettingsHidden(true)
        f.modeBar.setOpen(false)
        stopped = false
        bar.fire('click', {target: tab(f, true), stopImmediatePropagation: () => stopped = true})
        expect([f.modeSettingsHidden, has('lay-mode-hidden'), stopped]).toEqual([false, false, false])
        f.modeBar.setOpen(true)
        // without the right area, the open mode hides the panel as before (the click goes on to the button)
        place(f, 'right', null)
        stopped = false
        bar.fire('click', {target: tab(f, true), stopImmediatePropagation: () => stopped = true})
        expect([f.modeSettingsHidden, stopped]).toEqual([false, false])
    })

    test('swap: the app hides the mode settings and shows the right area while something is selected', () => {
        const {f} = setup()
        place(f, 'right', new FakeElement('div') as any, [{name: 'Inspector'}])
        // nothing selected: the right area collapses, the mode settings show
        f.setPanelHidden('right0', true)
        f.setModeSettingsHidden(false)
        expect([has('lay-right-shown'), has('lay-mode-hidden')]).toEqual([false, false])
        // selected: the right area takes the panel
        f.setPanelHidden('right0', false)
        f.setModeSettingsHidden(true)
        expect([has('lay-right-shown'), has('lay-mode-hidden')]).toEqual([true, true])
        // the mode settings hidden apply only while the right area shows
        f.setPanelHidden('right0', true)
        expect([has('lay-right-shown'), has('lay-mode-hidden')]).toEqual([false, false])
    })

    test('a drag of the split sets the part of the panel for the right area, kept; a double-click puts it at the middle', () => {
        const {f, panel, pane} = setup()
        place(f, 'right', new FakeElement('div') as any, [{name: 'Inspector'}])
        const [area, split] = panel.children
        ;(area as any).getBoundingClientRect = () => ({height: 300, width: 300})
        ;(pane as any).getBoundingClientRect = () => ({height: 300, width: 300})
        split.fire('pointerdown', {button: 0, clientY: 300})
        win.fire('pointermove', {clientY: 420})
        win.fire('pointerup', {})
        expect(body().style['--lay-right-box-grow']).toBe('0.7')
        expect(stored().rightShare).toBe(0.7)
        split.fire('dblclick')
        expect([body().style['--lay-right-box-grow'], stored().rightShare]).toEqual(['0.5', 0.5])
    })

    test('the TweakpaneEditorPlugin keeps the right area when it makes the frame again; a picked mode shows its settings', () => {
        const panel = new FakeElement('div')
        panel.id = 'tweakpaneUiContainer'
        panel.appendChild(new FakeElement('div')).className = 'tp-rotv'
        doc.getElementById = (id: string) => id === 'tweakpaneUiContainer' ? panel : null
        const p = new TweakpaneEditorPlugin()
        ;(p as any)._viewer = {getPlugin: () => undefined}
        p.modeKeys = ['Viewer', 'Export']
        p.layout = 'titlebar'
        const inspector = new FakeElement('div')
        place(p, 'right', inspector as any, [{name: 'Inspector'}])
        p.layout = 'floating'
        p.layout = 'classic'
        p.layout = 'statusbar'
        expect(panel.children[0].find('lay-section')[0].children).toEqual([inspector])
        p.frame!.setModeSettingsHidden(true)
        p.setSelectedMode(1)
        expect(p.frame!.modeSettingsHidden).toBe(false)
    })

    test('the TweakpaneEditorPlugin sends frameChange when it makes or removes the frame, so an app sets the frame state again', () => {
        const p = new TweakpaneEditorPlugin()
        ;(p as any)._viewer = {getPlugin: () => undefined}
        p.modeKeys = ['Viewer', 'Export']
        const frames: unknown[] = []
        p.addEventListener('frameChange', e => frames.push(e.frame))
        p.layout = 'titlebar'
        const first = p.frame
        p.layout = 'floating' // the same frame, another layout: no event
        p.layout = 'classic'
        p.layout = 'statusbar'
        expect(frames).toEqual([first, undefined, p.frame])
        expect(p.frame).not.toBe(first)
    })
})
