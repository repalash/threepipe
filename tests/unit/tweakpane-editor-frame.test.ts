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
// tippy.js is a dependency of the plugin (in its node_modules, which can be a link), mocked by its real path
const tippyPath = vi.hoisted(() => process.getBuiltinModule('node:fs')
    .realpathSync(new URL('../../plugins/tweakpane-editor/node_modules/tippy.js/dist/tippy.cjs.js', import.meta.url)))
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
        (f.modeBar.element as any as FakeElement).find('lay-float-btn').pop()! :
        body().find('lay-top')[0].find('lay-btn').pop()!

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
        body().find('lay-top')[0].find('lay-btn').pop()!.click()
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
