import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'

// The start screen of the tweakpane editor (plugins/tweakpane-editor/src/EditorSplash.ts). The node setup has no DOM: a
// small element with what the splash uses (its markup, classes, attributes, listeners, focus), and a tippy.js that
// keeps the tooltips it made.

const tips: {reference: any, props: any, destroyed: boolean}[] = []
// tippy.js is a dependency of the plugin, mocked by the file that Node resolves from the plugin's folder
const tippyPath = vi.hoisted(() => process.getBuiltinModule('node:module')
    .createRequire(new URL('../../plugins/tweakpane-editor/package.json', import.meta.url)).resolve('tippy.js'))
vi.mock(tippyPath, () => ({
    default: (reference: any, props: any) => {
        const t = {reference, props, destroyed: false, destroy: () => {
            t.destroyed = true
        }}
        tips.push(t)
        return t
    },
}))

class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    textContent = ''
    tabIndex = 0
    hidden = false
    checked = false
    type = ''
    accept = ''
    multiple = false
    files: File[] | null = null
    value = ''
    private _attrs = new Map<string, string>()
    private _listeners = new Map<string, ((e: any) => void)[]>()
    style: Record<string, string> = {}
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
    /** Elements with a class and a type, text, and self-closed SVG shapes; void `input` elements */
    set innerHTML(html: string) {
        for (const c of [...this.children]) c.remove()
        const stack: FakeElement[] = [this]
        for (const [, close, tag, attrs, selfClose, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/g)) {
            const top = stack[stack.length - 1]
            if (text) top.textContent += text.trim()
            else if (close) stack.pop()
            else {
                const e = top.appendChild(new FakeElement(tag))
                e.className = attrs.match(/class="([^"]*)"/)?.[1] ?? ''
                e.type = attrs.match(/type="([^"]*)"/)?.[1] ?? ''
                if (!selfClose && tag !== 'input') stack.push(e)
            }
        }
    }
    get isConnected(): boolean {
        return this === doc.body || !!this.parent?.isConnected
    }
    setAttribute(k: string, v: string) {
        this._attrs.set(k, v)
    }
    getAttribute(k: string) {
        return this._attrs.get(k) ?? null
    }
    hasAttribute(k: string) {
        return this._attrs.has(k)
    }
    removeAttribute(k: string) {
        this._attrs.delete(k)
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    /** One selector: `.class`, a tag, `input[type="checkbox"]`, or `.class tag` (a descendant) */
    private _matches(sel: string, e: FakeElement): boolean {
        const parts = sel.trim().split(/\s+/)
        const one = (s: string, x: FakeElement) => {
            const typed = s.match(/^([a-z]+)\[type="([^"]+)"\]$/)
            if (typed) return x.tagName === typed[1] && x.type === typed[2]
            return s.startsWith('.') ? x.classList.contains(s.slice(1)) : x.tagName === s
        }
        if (!one(parts[parts.length - 1], e)) return false
        if (parts.length === 1) return true
        for (let p = e.parent; p; p = p.parent) if (one(parts[0], p)) return true
        return false
    }
    querySelectorAll(sel: string) {
        return this.all().filter(e => sel.split(',').some(s => this._matches(s, e)))
    }
    querySelector(sel: string) {
        return this.querySelectorAll(sel)[0] ?? null
    }
    closest(sel: string): FakeElement | null {
        for (let e: FakeElement | undefined = this; e; e = e.parent) if (sel.split(',').some(s => this._matches(s, e!))) return e
        return null
    }
    focus() {
        doc.activeElement = this
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
    listeners(type: string) {
        return this._listeners.get(type)?.length ?? 0
    }
    fire(type: string, e: any = {}) {
        const event = {
            target: this, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
            preventDefault: () => {
                event.defaultPrevented = true
            },
            stopPropagation: () => {
                event.propagationStopped = true
            },
            stopImmediatePropagation: () => {
                event.immediateStopped = true
            },
            ...e,
        }
        for (const f of this._listeners.get(type) ?? []) f(event)
        return event
    }
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
}

const doc = globalThis.document as any
const saved = {...doc}
let win: FakeElement
let storage: Map<string, string>
beforeAll(() => {
    doc.createElement = (tag: string) => new FakeElement(tag)
})
afterAll(() => {
    for (const k of Object.keys(doc)) if (!(k in saved)) delete doc[k]
    Object.assign(doc, saved)
})
beforeEach(() => {
    tips.length = 0
    doc.head = new FakeElement('head')
    doc.body = new FakeElement('body')
    doc.activeElement = doc.body
    storage = new Map()
    win = new FakeElement('window')
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    })
    vi.stubGlobal('addEventListener', (t: string, f: any) => win.addEventListener(t, f))
    vi.stubGlobal('removeEventListener', (t: string, f: any) => win.removeEventListener(t, f))
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const {EditorSplash} = await import('../../plugins/tweakpane-editor/src/EditorSplash')
type Splash = InstanceType<typeof EditorSplash>

const body = () => doc.body as FakeElement
const root = (s: Splash) => s.element as any as FakeElement
const find = (s: Splash, cls: string) => root(s).querySelectorAll('.' + cls)
const one = (s: Splash, cls: string) => root(s).querySelector('.' + cls)!
const labels = (els: FakeElement[]) => els.map(e => e.querySelector('span')!.textContent)
const key = (k: string, mods: Record<string, any> = {}) => win.fire('keydown', {key: k, target: body(), ...mods})
/** A promise that the test resolves or rejects */
function deferred() {
    let resolve!: () => void, reject!: (e: Error) => void
    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })
    return {promise, resolve, reject}
}
const flush = async() => new Promise(r => setTimeout(r, 0))

const samples = (load = vi.fn()) => [
    {title: 'Helmet', text: 'PBR textures', icon: '<svg class="helmet"></svg>', load},
    {title: 'Watch', load},
]

describe('EditorSplash', () => {
    test('open shows a modal dialog with the title, Start, Recent and the sample cards, and takes the focus', () => {
        const s = new EditorSplash({title: 'My Editor', version: 'v1', samples: samples(), onNew: vi.fn(), onFiles: vi.fn()})
        expect(s.isOpen).toBe(false)
        s.open()
        const r = root(s)
        expect(r.parent).toBe(body())
        expect([r.getAttribute('role'), r.getAttribute('aria-modal'), r.getAttribute('aria-label')]).toEqual(['dialog', 'true', 'My Editor'])
        expect(doc.activeElement).toBe(r)
        expect([one(s, 'esp-title').textContent, one(s, 'esp-version').textContent]).toEqual(['My Editor', 'v1'])
        expect(labels(one(s, 'esp-start').children)).toEqual(['New empty scene', 'Open file…'])
        expect(one(s, 'esp-recent').querySelector('.esp-none')).not.toBeNull()
        const cards = find(s, 'esp-card-btn')
        expect(cards.map(c => c.querySelector('.esp-label')!.textContent)).toEqual(['Helmet', 'Watch'])
        expect(cards.map(c => c.querySelector('.esp-text')?.textContent ?? null)).toEqual(['PBR textures', null])
        // the icon of the sample, or the default box
        expect(cards[0].querySelector('.helmet')).not.toBeNull()
        expect(cards[1].querySelector('svg')).not.toBeNull()
        // the close button has the editor tooltip
        expect(tips.map(t => [t.reference, t.props.content])).toEqual([[one(s, 'esp-close'), 'Close (Esc)']])
        s.open() // already open: the same dialog
        expect(body().children).toEqual([r])
    })

    test('without the callbacks or samples, their parts are hidden', () => {
        const s = new EditorSplash()
        s.open()
        expect(one(s, 'esp-start').children).toHaveLength(0)
        expect(one(s, 'esp-start-heading').hidden).toBe(true)
        expect(one(s, 'esp-recent-heading').hidden).toBe(true)
        expect(one(s, 'esp-samples-heading').hidden).toBe(true)
        expect(one(s, 'esp-hint').textContent).toBe('')
        expect(root(s).querySelector('input[type="file"]')).toBeNull()
        expect(one(s, 'esp-title').textContent).toBe('threepipe Editor')
    })

    test('a sample shows that it loads, then the splash closes, and the sample is in the Recent list', async() => {
        const d = deferred()
        const load = vi.fn(() => d.promise)
        const onClose = vi.fn()
        const s = new EditorSplash({samples: samples(load), onClose})
        s.open()
        const r = root(s)
        const card = find(s, 'esp-card-btn')[1]
        card.click()
        expect(load).toHaveBeenCalledTimes(1)
        expect(r.classList.contains('esp-busy')).toBe(true)
        expect(r.getAttribute('aria-busy')).toBe('true')
        expect(card.classList.contains('esp-loading')).toBe(true)
        expect(one(s, 'esp-status').textContent).toBe('Opening “Watch”…')
        // one load at a time
        find(s, 'esp-card-btn')[0].click()
        expect(load).toHaveBeenCalledTimes(1)
        d.resolve()
        await flush()
        expect(s.isOpen).toBe(false)
        expect(r.parent).toBeUndefined()
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(tips[0].destroyed).toBe(true)
        expect(s.recent).toEqual(['Watch'])
        expect(storage.get('tpEditorSplashRecent')).toBe('["Watch"]')
        // the latest first, once each, and only samples the app still has
        storage.set('tpEditorSplashRecent', JSON.stringify(['Gone', 'Helmet', 'Watch']))
        const s2 = new EditorSplash({samples: samples(load)})
        s2.open()
        expect(labels(one(s2, 'esp-recent').children)).toEqual(['Helmet', 'Watch'])
    })

    test('a load goes on after Escape: the reopened splash shows it, refuses a second one, and closes when it ends', async() => {
        const d = deferred()
        const load = vi.fn(() => d.promise)
        const onNew = vi.fn()
        const s = new EditorSplash({samples: samples(load), onNew})
        s.open()
        find(s, 'esp-card-btn')[0].click()
        key('Escape')
        expect(s.isOpen).toBe(false)
        s.open()
        const r = root(s)
        expect(r.classList.contains('esp-busy')).toBe(true)
        expect(r.getAttribute('aria-busy')).toBe('true')
        expect(one(s, 'esp-status').textContent).toBe('Opening “Helmet”…')
        // no second operation while the first one runs
        find(s, 'esp-card-btn')[1].click()
        one(s, 'esp-start').children[0].click() // New empty scene
        expect(load).toHaveBeenCalledTimes(1)
        expect(onNew).not.toHaveBeenCalled()
        // nor a close by a click on the dimmed page
        r.fire('pointerdown')
        expect(s.isOpen).toBe(true)
        d.resolve()
        await flush()
        expect(s.isOpen).toBe(false)
        expect(s.recent).toEqual(['Helmet'])
        // a load that fails while the reopened splash is open: it says so there
        const d2 = deferred()
        load.mockImplementationOnce(() => d2.promise)
        s.open()
        find(s, 'esp-card-btn')[1].click()
        key('Escape')
        s.open()
        d2.reject(new Error('404'))
        await flush()
        expect(s.isOpen).toBe(true)
        expect(root(s).classList.contains('esp-busy')).toBe(false)
        expect(one(s, 'esp-status').textContent).toBe('Could not open “Watch”. Pick a sample, or open a file.')
        onNew.mockClear()
        one(s, 'esp-start').children[0].click()
        await flush()
        expect(onNew).toHaveBeenCalledTimes(1)
    })

    test('a sample that fails keeps the splash open with a message, and is not recent', async() => {
        const load = vi.fn(async() => {
            throw new Error('404')
        })
        const s = new EditorSplash({samples: samples(load)})
        s.open()
        const card = find(s, 'esp-card-btn')[0]
        card.click()
        await flush()
        expect(s.isOpen).toBe(true)
        expect(root(s).classList.contains('esp-busy')).toBe(false)
        expect(root(s).hasAttribute('aria-busy')).toBe(false)
        expect(card.classList.contains('esp-loading')).toBe(false)
        const status = one(s, 'esp-status')
        expect(status.textContent).toBe('Could not open “Helmet”. Pick a sample, or open a file.')
        expect(status.classList.contains('esp-error')).toBe(true)
        expect(s.recent).toEqual([])
        // another try works
        load.mockResolvedValueOnce(undefined)
        card.click()
        await flush()
        expect(s.isOpen).toBe(false)
    })

    test('Escape, × and a click on the dimmed page close it; the focus goes back', () => {
        const before = new FakeElement('button')
        body().appendChild(before)
        before.focus()
        const s = new EditorSplash({samples: samples()})
        s.open()
        const e = key('Escape')
        expect(s.isOpen).toBe(false)
        // before the shortcuts of the page
        expect(e.immediateStopped).toBe(true)
        expect(doc.activeElement).toBe(before)
        s.open()
        one(s, 'esp-close').click()
        expect(s.isOpen).toBe(false)
        s.open()
        root(s).fire('pointerdown', {target: one(s, 'esp-card')})
        expect(s.isOpen).toBe(true)
        root(s).fire('pointerdown')
        expect(s.isOpen).toBe(false)
        // Escape when it is closed is for the page
        expect(key('Escape').defaultPrevented).toBe(false)
    })

    test('Ctrl+O opens the closed splash (not in a text field, not with shortcut: false); in the open one, the file picker', () => {
        const s = new EditorSplash({onFiles: vi.fn()})
        const field = new FakeElement('input')
        key('o', {ctrlKey: true, target: field})
        expect(s.isOpen).toBe(false)
        expect(key('o', {metaKey: true}).defaultPrevented).toBe(true)
        expect(s.isOpen).toBe(true)
        const input = root(s).querySelector('input[type="file"]')!
        expect([input.type, input.multiple, input.hidden]).toEqual(['file', true, true])
        const picked = vi.fn()
        input.addEventListener('click', picked)
        const e = key('O', {ctrlKey: true})
        expect([e.defaultPrevented, e.immediateStopped]).toEqual([true, true])
        expect(picked).toHaveBeenCalledTimes(1)
        one(s, 'esp-start').children[0].click() // Open file…
        expect(picked).toHaveBeenCalledTimes(2)
        s.close()

        const off = new EditorSplash({shortcut: false})
        key('o', {ctrlKey: true})
        expect(off.isOpen).toBe(false)
    })

    test('picked and dropped files go to onFiles, with the drop area while a file is over the splash', async() => {
        const onFiles = vi.fn()
        const s = new EditorSplash({onFiles, accept: '.glb'})
        s.open()
        const r = root(s)
        const input = r.querySelector('input[type="file"]')!
        expect(input.accept).toBe('.glb')
        expect(one(s, 'esp-hint').textContent).toBe('Drop a file anywhere to open it')
        const a = {name: 'a.gltf'} as File
        const b = {name: 'a.bin'} as File
        input.files = [a, b]
        input.value = 'C:\\fakepath\\a.gltf'
        input.fire('change')
        // by their paths, as AssetImporter.importFiles takes them
        expect(onFiles).toHaveBeenCalledWith(new Map([['a.gltf', a], ['a.bin', b]]))
        // the picker is cleared, so the same file picked again (after a failed import) is a change again
        expect(input.value).toBe('')
        expect(one(s, 'esp-status').textContent).toBe('Opening a.gltf, a.bin…')
        await flush()
        expect(s.isOpen).toBe(false)

        s.open()
        const r2 = root(s)
        r2.fire('dragenter')
        r2.fire('dragenter') // over a child
        r2.fire('dragleave')
        expect(r2.classList.contains('esp-over')).toBe(true)
        r2.fire('dragleave')
        expect(r2.classList.contains('esp-over')).toBe(false)
        r2.fire('dragenter')
        const drop = r2.fire('drop', {dataTransfer: {files: [a]}})
        expect(drop.defaultPrevented).toBe(true)
        expect(r2.classList.contains('esp-over')).toBe(false)
        expect(onFiles).toHaveBeenLastCalledWith(new Map([['a.gltf', a]]))
        // a drop of no files does nothing
        await flush()
        s.open()
        root(s).fire('drop', {dataTransfer: {files: []}})
        expect(onFiles).toHaveBeenCalledTimes(2)
    })

    test('a dropped folder opens with the relative paths of its files (a .gltf with its .bin), as a drop on the canvas', async() => {
        const onFiles = vi.fn()
        const s = new EditorSplash({onFiles})
        s.open()
        const gltf = {name: 'scene.gltf'} as File
        const bin = {name: 'scene.bin'} as File
        // FileSystemEntry objects, as webkitGetAsEntry gives them: a folder with two files; its reader gives them once
        const file = (f: File, fullPath: string) => ({isFile: true, isDirectory: false, fullPath, file: (ok: (f: File) => void) => ok(f)})
        const children = [file(gltf, '/helmet/scene.gltf'), file(bin, '/helmet/scene.bin')]
        const folder = {isFile: false, isDirectory: true, fullPath: '/helmet', createReader: () => ({
            readEntries: (ok: (e: any[]) => void) => ok(children.splice(0)),
        })}
        root(s).fire('drop', {dataTransfer: {files: [], items: [{webkitGetAsEntry: () => folder}]}})
        expect(onFiles).toHaveBeenCalledTimes(1)
        const files: Map<string, File> = onFiles.mock.calls[0][0]
        expect([...files.keys()].sort()).toEqual(['/helmet/scene.bin', '/helmet/scene.gltf'])
        expect(files.get('/helmet/scene.gltf')).toBe(gltf)
        expect(one(s, 'esp-status').textContent).toMatch(/^Opening scene\.(bin|gltf), scene\.(bin|gltf)…$/)
        await flush()
        expect(s.isOpen).toBe(false)
    })

    test('a folder whose files are read after the splash closed and opened again does not open in the new splash', async() => {
        const onFiles = vi.fn()
        const s = new EditorSplash({onFiles})
        s.open()
        // the browser reads the file of the entry later
        let read!: () => void
        const entry = {isFile: true, isDirectory: false, fullPath: '/helmet/scene.glb', file: (ok: (f: File) => void) => {
            read = () => ok({name: 'scene.glb'} as File)
        }}
        root(s).fire('drop', {dataTransfer: {files: [], items: [{webkitGetAsEntry: () => entry}]}})
        s.close()
        s.open()
        read()
        await flush()
        expect(onFiles).not.toHaveBeenCalled()
        expect(root(s).classList.contains('esp-busy')).toBe(false)
    })

    test('the "Show at startup" box is kept in localStorage, under storageKey', () => {
        const s = new EditorSplash({storageKey: 'app'})
        expect(s.showAtStartup).toBe(true)
        s.open()
        const box = root(s).querySelector('.esp-check input')!
        expect(box.checked).toBe(true)
        box.checked = false
        box.fire('change')
        expect(s.showAtStartup).toBe(false)
        expect(storage.get('appStartup')).toBe('0')
        expect(new EditorSplash({storageKey: 'app'}).showAtStartup).toBe(false)
        s.showAtStartup = true // from code: the box follows
        expect(box.checked).toBe(true)
        expect(storage.get('appStartup')).toBe('1')

        // null: nothing is kept
        storage.clear()
        const none = new EditorSplash({storageKey: null, samples: samples()})
        none.showAtStartup = false
        expect(none.showAtStartup).toBe(false)
        expect(storage.size).toBe(0)
        // a broken value is no list
        storage.set('tpEditorSplashRecent', '{nope')
        expect(new EditorSplash().recent).toEqual([])
        storage.set('tpEditorSplashRecent', '["a", 3, "b"]')
        expect(new EditorSplash().recent).toEqual(['a', 'b'])
    })

    test('Tab stays in the dialog, and no key reaches the page behind it', () => {
        const s = new EditorSplash({samples: samples(), onNew: vi.fn()})
        s.open()
        const r = root(s)
        const items = r.querySelectorAll('button, input[type="checkbox"]')
        expect(items[0].classList.contains('esp-close')).toBe(true)
        expect(items[items.length - 1].type).toBe('checkbox')
        items[items.length - 1].focus()
        let e = r.fire('keydown', {key: 'Tab'})
        expect([e.defaultPrevented, doc.activeElement]).toEqual([true, items[0]])
        r.focus() // the dialog itself, as at open
        e = r.fire('keydown', {key: 'Tab', shiftKey: true})
        expect(doc.activeElement).toBe(items[items.length - 1])
        e = r.fire('keydown', {key: 'w'})
        expect([e.propagationStopped, e.defaultPrevented]).toEqual([true, false])
    })

    test('dispose closes it, and removes its styles and the shortcut', () => {
        const s = new EditorSplash()
        const styles = doc.head.children.length // the splash, and the tooltip theme once per page
        expect(styles).toBeGreaterThan(0)
        expect(win.listeners('keydown')).toBe(1)
        s.open()
        s.dispose()
        expect(s.isOpen).toBe(false)
        expect(win.listeners('keydown')).toBe(0)
        expect(doc.head.children).toHaveLength(styles - 1)
    })
})
