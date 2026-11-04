import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {EventDispatcher} from 'three'
import {PerfPanelPlugin} from './PerfPanelPlugin'

type Listener = (e: any) => void

// the node setup has no DOM: a small element with what the panel uses
class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    // the inline style, with setProperty / removeProperty for custom properties (raiseOnPress sets --ui-raise)
    style: Record<string, any> = {
        setProperty(k: string, v: string) {
            this[k] = v
        },
        removeProperty(k: string) {
            delete this[k]
        },
    }
    dataset: Record<string, string> = {}
    textContent = ''
    title = ''
    clientWidth = 0
    clientHeight = 0
    offsetLeft = 0
    offsetTop = 0
    offsetWidth = 0
    offsetHeight = 0
    private _listeners = new Map<string, Listener[]>()
    classList = {
        add: (...c: string[]) => this._setClasses([...this._classes(), ...c]),
        remove: (...c: string[]) => this._setClasses(this._classes().filter(x => !c.includes(x))),
        toggle: (c: string, on: boolean) => on ? this.classList.add(c) : this.classList.remove(c),
        contains: (c: string) => this._classes().includes(c),
    }
    constructor(readonly tagName: string) {}
    private _classes() {
        return this.className.split(' ').filter(Boolean)
    }
    private _setClasses(c: string[]) {
        this.className = [...new Set(c)].join(' ')
    }
    appendChild(c: FakeElement) {
        c.remove()
        c.parent = this
        this.children.push(c)
        return c
    }
    replaceChildren(...c: FakeElement[]) {
        for (const x of this.children) x.parent = undefined
        this.children = []
        for (const x of c) this.appendChild(x)
    }
    get parentElement() {
        return this.parent
    }
    setPointerCapture() {
        // the test fires the pointer events on the element itself
    }
    remove() {
        if (!this.parent) return
        this.parent.children = this.parent.children.filter(x => x !== this)
        this.parent = undefined
    }
    getContext() {
        return null
    }
    addEventListener(type: string, f: Listener) {
        this._listeners.set(type, [...this._listeners.get(type) ?? [], f])
    }
    removeEventListener(type: string, f: Listener) {
        this._listeners.set(type, (this._listeners.get(type) ?? []).filter(x => x !== f))
    }
    listenerCount(type: string) {
        return this._listeners.get(type)?.length ?? 0
    }
    fire(type: string, e: any = {}) {
        for (const f of this._listeners.get(type) ?? []) f({type, target: this, currentTarget: this, button: 0, pointerId: 1, ...e})
    }
    /** All elements below this one, depth first */
    all(): FakeElement[] {
        return this.children.flatMap(c => [c, ...c.all()])
    }
    find(cls: string) {
        return this.all().find(e => e.classList.contains(cls))!
    }
}

const doc = globalThis.document as any
const saved = {createElement: doc.createElement, addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener}
const docEvents = new FakeElement('document')
let frames: ((t: number) => void)[] = []
let rafId = 0

beforeAll(() => {
    doc.createElement = (tag: string) => new FakeElement(tag)
    doc.addEventListener = docEvents.addEventListener.bind(docEvents)
    doc.removeEventListener = docEvents.removeEventListener.bind(docEvents)
})
afterAll(() => {
    Object.assign(doc, saved)
    delete doc.visibilityState
})
beforeEach(() => {
    frames = []
    doc.visibilityState = 'visible'
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => {
        frames.push(f)
        return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn(() => frames = []))
    vi.stubGlobal('getComputedStyle', () => ({getPropertyValue: () => ''}))
    vi.stubGlobal('addEventListener', vi.fn())
    vi.stubGlobal('removeEventListener', vi.fn())
})
afterEach(() => {
    vi.unstubAllGlobals()
})

/** Run the next animation frame at time t */
function frame(t: number) {
    const f = frames.shift()
    if (!f) throw new Error('no animation frame requested')
    f(t)
}

/** A viewer with what the panel reads, and a renderer info like three.js (its update does not use `this`) */
function makeViewer() {
    const render = {calls: 0, triangles: 0}
    const info = {
        render,
        update: (count: number, _mode: number, instances: number) => {
            render.calls++
            render.triangles += instances * count / 3
        },
    }
    const gl = {RENDERER: 1, getParameter: () => 'SwiftShader Device', getExtension: () => null}
    const viewer = new EventDispatcher<any>() as any
    Object.assign(viewer, {
        container: new FakeElement('div'),
        canvas: {clientWidth: 300, clientHeight: 200, width: 300, height: 200},
        renderManager: {webglRenderer: {info, getContext: () => gl}, renderScale: 1, frameCount: 0},
        getPlugin: () => undefined,
        console: console,
    })
    const origUpdate = info.update
    /** One viewer render with draws of `tris` triangles each */
    const renderFrame = (...tris: number[]) => {
        viewer.dispatchEvent({type: 'preRender'})
        for (const t of tris) info.update(t * 3, 4, 1)
        viewer.dispatchEvent({type: 'postRender'})
    }
    return {viewer, info, origUpdate, renderFrame}
}

const el = (p: PerfPanelPlugin) => p.element as any as FakeElement

describe('PerfPanelPlugin', () => {
    test('starts as a pill in the bottom-left corner; options set the corner, the card and the theme', () => {
        const p = new PerfPanelPlugin()
        expect(p.collapsed).toBe(true)
        expect(el(p).className).toBe('pp-root pp-bottom-left pp-collapsed')
        expect(el(p).find('pp-pill-text').textContent).toBe('– fps')

        const q = new PerfPanelPlugin({position: 'top-right', collapsed: false, theme: 'dark'})
        expect(q.collapsed).toBe(false)
        expect(el(q).className).toBe('pp-root pp-top-right pp-dark')
    })

    test('a click on the pill opens the card, a click on the card header collapses it', () => {
        const p = new PerfPanelPlugin()
        el(p).find('pp-pill').fire('click')
        expect(p.collapsed).toBe(false)
        expect(el(p).classList.contains('pp-collapsed')).toBe(false)
        el(p).find('pp-head').fire('click')
        expect(p.collapsed).toBe(true)
        p.collapsed = false
        expect(el(p).classList.contains('pp-collapsed')).toBe(false)
    })

    test('position moves the panel to another corner', () => {
        const p = new PerfPanelPlugin()
        p.position = 'top-left'
        expect(p.position).toBe('top-left')
        expect(el(p).className).toBe('pp-root pp-collapsed pp-top-left')
        p.position = 'bottom-right'
        expect(el(p).className).toBe('pp-root pp-collapsed pp-bottom-right')
    })

    test('the pill and the card head drag the panel inside the container; a click is not a drag; position puts it back', () => {
        // a ResizeObserver that the test triggers
        type Callback = () => void
        const observed = new Map<unknown, Callback>()
        vi.stubGlobal('ResizeObserver', class {
            constructor(public callback: Callback) {}
            observe(t: unknown) {
                observed.set(t, this.callback)
            }
            disconnect() {
                observed.clear()
            }
        })
        const {viewer} = makeViewer()
        Object.assign(viewer.container, {clientWidth: 800, clientHeight: 600})
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        const root = el(p), pill = root.find('pp-pill'), head = root.find('pp-head')
        Object.assign(root, {offsetLeft: 10, offsetTop: 568, offsetWidth: 60, offsetHeight: 22}) // the pill at the bottom left
        const drag = (handle: FakeElement, dx: number, dy: number) => {
            handle.fire('pointerdown', {clientX: 100, clientY: 100})
            handle.fire('pointermove', {clientX: 101, clientY: 101}) // under the drag threshold
            handle.fire('pointermove', {clientX: 100 + dx, clientY: 100 + dy})
            handle.fire('pointerup')
            handle.fire('click') // the browser sends a click after the release
        }

        drag(pill, 200, -200)
        expect(root.style.transform).toBe('translate(200px, -200px)')
        expect(p.collapsed).toBe(true) // the drag did not open the card
        // after the release, the pointer moves it no more
        pill.fire('pointermove', {clientX: 0, clientY: 0})
        expect(root.style.transform).toBe('translate(200px, -200px)')
        // a click without a move opens the card
        drag(pill, 1, 1)
        expect(p.collapsed).toBe(false)
        expect(root.style.transform).toBe('translate(200px, -200px)')

        // inside the container: the open card (it grows up from the bottom corner) is moved in, the pill comes back
        Object.assign(root, {offsetTop: 321, offsetWidth: 248, offsetHeight: 269})
        drag(head, 5000, -5000)
        expect(root.style.transform).toBe('translate(542px, -321px)') // 800 - 248 - 10; to the top edge
        expect(p.collapsed).toBe(false) // the drag did not collapse it
        Object.assign(root, {offsetTop: 568, offsetWidth: 60, offsetHeight: 22})
        p.collapsed = true
        expect(root.style.transform).toBe('translate(542px, -321px)')
        Object.assign(root, {offsetTop: 321, offsetWidth: 248, offsetHeight: 269})
        p.collapsed = false
        drag(head, 0, 0) // a click on the head collapses
        expect(p.collapsed).toBe(true)

        // a smaller container keeps it inside
        Object.assign(root, {offsetTop: 568, offsetWidth: 60, offsetHeight: 22})
        viewer.container.clientWidth = 400
        observed.get(viewer.container)!()
        expect(root.style.transform).toBe('translate(330px, -321px)') // 400 - 60 - 10

        // the Position dropdown puts it in a corner, also the corner it is in
        p.position = 'bottom-left'
        expect(root.style.transform).toBe('')
        drag(pill, 50, 0)
        p.position = 'top-right'
        expect(root.style.transform).toBe('')
        p.onRemove(viewer)
        expect(observed.size).toBe(0)
    })

    test('after a drag, Enter or Space (a click without a press) still opens and collapses the panel', () => {
        const {viewer} = makeViewer()
        Object.assign(viewer.container, {clientWidth: 800, clientHeight: 600})
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        const root = el(p), pill = root.find('pp-pill'), head = root.find('pp-head')
        Object.assign(root, {offsetLeft: 10, offsetTop: 568, offsetWidth: 60, offsetHeight: 22})
        // a drag that ends outside the pill: the browser sends no click, so nothing clears the drag
        pill.fire('pointerdown', {clientX: 100, clientY: 100})
        pill.fire('pointermove', {clientX: 300, clientY: 0})
        pill.fire('pointerup')
        expect(p.collapsed).toBe(true)
        pill.fire('click', {detail: 0}) // Enter on the focused pill
        expect(p.collapsed).toBe(false)
        head.fire('click', {detail: 0}) // Space on the focused header
        expect(p.collapsed).toBe(true)
        // the click that ends a drag still does nothing
        pill.fire('pointerdown', {clientX: 100, clientY: 100})
        pill.fire('pointermove', {clientX: 150, clientY: 100})
        pill.fire('pointerup')
        pill.fire('click', {detail: 1})
        expect(p.collapsed).toBe(true)
        p.onRemove(viewer)
    })

    test('a dragged panel that grows (a new warning, the open card) is moved back inside', () => {
        type Callback = () => void
        const observed = new Map<unknown, Callback>()
        vi.stubGlobal('ResizeObserver', class {
            constructor(public callback: Callback) {}
            observe(t: unknown) {
                observed.set(t, this.callback)
            }
            disconnect() {
                observed.clear()
            }
        })
        const {viewer} = makeViewer()
        Object.assign(viewer.container, {clientWidth: 800, clientHeight: 600})
        const p = new PerfPanelPlugin({collapsed: false})
        p.onAdded(viewer)
        const root = el(p), head = root.find('pp-head')
        // the open card at the bottom left, dragged to the top edge
        Object.assign(root, {offsetLeft: 10, offsetTop: 321, offsetWidth: 248, offsetHeight: 269})
        head.fire('pointerdown', {clientX: 100, clientY: 100})
        head.fire('pointermove', {clientX: 100, clientY: -5000})
        head.fire('pointerup')
        expect(root.style.transform).toBe('translate(0px, -321px)')
        // a warning makes it 60 px taller: it grows up from the bottom corner, so its top would go out
        Object.assign(root, {offsetTop: 261, offsetHeight: 329})
        expect(observed.has(root)).toBe(true)
        observed.get(root)!()
        expect(root.style.transform).toBe('translate(0px, -261px)')
        p.onRemove(viewer)
    })

    test('enabled, collapsed and position set in code refresh the plugin UI', () => {
        const p = new PerfPanelPlugin()
        const uiRefresh = vi.fn()
        p.uiConfig.uiRefresh = uiRefresh
        p.enabled = false
        p.collapsed = false
        p.position = 'top-left'
        expect(uiRefresh).toHaveBeenCalledTimes(3)
        p.position = 'top-left' // no change
        expect(uiRefresh).toHaveBeenCalledTimes(3)
    })

    test('added: in the container, measures each animation frame and sends update 4 times per second', () => {
        const {viewer} = makeViewer()
        const p = new PerfPanelPlugin()
        const updates = vi.fn()
        p.addEventListener('update', updates)
        p.onAdded(viewer)
        expect(el(p).parent).toBe(viewer.container)
        expect(viewer.container.children.some((c: FakeElement) => c.tagName === 'style')).toBe(true)
        expect(p.stats.gpu).toBe('SwiftShader Device')

        for (let i = 0; i < 60; i++) frame(1000 + i * 1000 / 60) // the stats run at 1000, ~1250, ~1500, ~1750
        expect(updates).toHaveBeenCalledTimes(4)
        expect(updates.mock.calls[0][0].stats).toBe(p.stats)
        expect(Math.round(p.stats.fps)).toBe(60)
        expect(el(p).find('pp-pill-text').textContent).toBe('60 fps')
        expect(el(p).find('pp-dot').classList.contains('pp-good')).toBe(true)
        // the software GL warning puts a dot on the pill
        expect(p.stats.warnings.map(w => w.id)).toEqual(['software'])
        expect(el(p).find('pp-pill').classList.contains('pp-has-warn')).toBe(true)
        p.onRemove(viewer)
    })

    test('draw calls and triangles of a render are summed over all its draws; draws outside a render are not', () => {
        const {viewer, info, renderFrame} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        renderFrame(100, 20, 2)
        expect(p.stats.drawCalls).toBe(3)
        expect(p.stats.triangles).toBe(122)
        info.update(30, 4, 1) // a draw outside the viewer render
        expect(p.stats.drawCalls).toBe(3)
        expect(info.render.calls).toBe(4) // three.js still counts it
        renderFrame(5)
        expect(p.stats.drawCalls).toBe(1)
        expect(p.stats.triangles).toBe(5)
        p.onRemove(viewer)
    })

    test('renders per second and render CPU time come from preRender / postRender', () => {
        const {viewer, renderFrame} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        let t = 1000
        frame(t)
        for (let i = 0; i < 60; i++) {
            renderFrame(1)
            frame(t += 20)
        }
        // the stats ran at 1000, 1260, 1520, 1780 and 2040 ms; the last second has 51 frames with one render each
        expect(p.stats.rendersPerSecond).toBe(51)
        expect(p.stats.renderMax).toBeGreaterThanOrEqual(p.stats.renderAvg)
        p.onRemove(viewer)
    })

    test('enabled = false or disable() hides the panel and stops measuring', () => {
        const {viewer} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        expect(frames.length).toBe(1)
        p.enabled = false
        expect(el(p).style.display).toBe('none')
        expect(frames.length).toBe(0)
        p.enabled = true
        expect(el(p).style.display).toBe('')
        expect(frames.length).toBe(1)
        p.disable('test')
        expect(el(p).style.display).toBe('none')
        expect(frames.length).toBe(0)
        p.enable('test')
        expect(frames.length).toBe(1)
        p.onRemove(viewer)
    })

    test('while not measuring, renders and draws are not counted', () => {
        const {viewer, info, renderFrame} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        renderFrame(10, 10)
        expect(p.stats.drawCalls).toBe(2)
        p.enabled = false
        renderFrame(5)
        expect(p.stats.drawCalls).toBe(2)
        expect((p as any)._tickRenders).toBe(1)
        expect(info.render.calls).toBe(3) // three.js still counts it
        p.enabled = true
        renderFrame(5)
        expect(p.stats.drawCalls).toBe(1)
        p.onRemove(viewer)
    })

    test('a hidden tab pauses measuring and shows the hidden warning', () => {
        const {viewer} = makeViewer()
        const p = new PerfPanelPlugin({collapsed: false})
        p.onAdded(viewer)
        doc.visibilityState = 'hidden'
        docEvents.fire('visibilitychange')
        expect(frames.length).toBe(0)
        expect(p.stats.warnings.map(w => w.id)).toContain('hidden')
        expect(el(p).find('pp-pill-text').textContent).toBe('paused')
        expect(el(p).find('pp-warns').children.map(c => c.dataset.w)).toEqual(['software', 'hidden'])

        doc.visibilityState = 'visible'
        docEvents.fire('visibilitychange')
        expect(frames.length).toBe(1)
        expect(p.stats.warnings.map(w => w.id)).not.toContain('hidden')
        p.onRemove(viewer)
    })

    test('a chrome:// link in a hint is a code element that copies on click', async() => {
        const {viewer} = makeViewer()
        const p = new PerfPanelPlugin({collapsed: false})
        p.onAdded(viewer)
        for (let t = 1000; t <= 3000; t += 33.4) frame(t) // idle frames at ~30 fps: capped
        expect(p.stats.warnings[0].id).toBe('capped')
        const writeText = vi.fn(async() => undefined)
        vi.stubGlobal('navigator', {clipboard: {writeText}})
        const code = el(p).find('pp-warns').all().find(e => e.tagName === 'code')!
        expect(code.textContent).toBe('chrome://settings/performance')
        code.fire('click')
        expect(writeText).toHaveBeenCalledWith('chrome://settings/performance')
        await Promise.resolve()
        expect(code.classList.contains('pp-copied')).toBe(true)
        p.onRemove(viewer)
    })

    test('a warning whose text changes keeps its element (text selection, hover); a new warning builds the list again', () => {
        const p = new PerfPanelPlugin({collapsed: false})
        const warns = el(p).find('pp-warns')
        const show = (...w: PerfPanelPlugin['stats']['warnings']) => {
            p.stats.warnings = w
            ;(p as any)._renderWarnings()
        }
        show({id: 'cpu-bound', text: 'CPU bound: 20.1 of 25.0 ms', hint: 'Heavy work'})
        const div = warns.children[0]
        show({id: 'cpu-bound', text: 'CPU bound: 21.3 of 26.0 ms', hint: 'Heavy work'})
        expect(warns.children[0]).toBe(div)
        expect(div.children[0].textContent).toBe('CPU bound: 21.3 of 26.0 ms')
        show({id: 'cpu-bound', text: 'CPU bound: 21.3 of 26.0 ms', hint: 'Heavy work'}, {id: 'hidden', text: 'Tab hidden'})
        expect(warns.children.map(c => c.dataset.w)).toEqual(['cpu-bound', 'hidden'])
        expect(warns.children[0]).not.toBe(div)
    })

    test('on battery: a warning that follows the battery events', async() => {
        const battery = Object.assign(new FakeElement('battery'), {charging: false, level: 0.5})
        vi.stubGlobal('navigator', {getBattery: async() => battery})
        const {viewer} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        await new Promise(r => setTimeout(r, 0))
        expect(p.stats.warnings.map(w => w.id)).toEqual(['battery', 'software'])
        battery.charging = true
        battery.fire('chargingchange')
        expect(p.stats.warnings.map(w => w.id)).toEqual(['software'])
        p.onRemove(viewer)
        expect(battery.listenerCount('chargingchange')).toBe(0)
        expect(battery.listenerCount('levelchange')).toBe(0)
    })

    test('onRemove: no element, style, listeners, renderer hook or animation frame stays', () => {
        const {viewer, info, origUpdate, renderFrame} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        expect(info.update).not.toBe(origUpdate)
        p.onRemove(viewer)
        expect(el(p).parent).toBeUndefined()
        expect(viewer.container.children).toEqual([])
        expect(info.update).toBe(origUpdate)
        expect(frames.length).toBe(0)
        expect(docEvents.listenerCount('visibilitychange')).toBe(0)
        expect(viewer.hasEventListener('preRender', (p as any)._onPreRender)).toBe(false)
        expect(viewer.hasEventListener('postRender', (p as any)._onPostRender)).toBe(false)
        renderFrame(10)
        expect(p.stats.drawCalls).toBe(0)

        // added again, it works as before
        p.onAdded(viewer)
        expect(el(p).parent).toBe(viewer.container)
        renderFrame(10)
        expect(p.stats.drawCalls).toBe(1)
        p.onRemove(viewer)
    })

    test('removed under another wrapper of info.update, then added again: each draw counts once', () => {
        const {viewer, info, renderFrame} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        const inner = info.update
        info.update = (count: number, mode: number, instances: number) => inner(count, mode, instances) // another tool wraps it
        p.onRemove(viewer) // the panel hook stays in the chain under the other wrapper
        p.onAdded(viewer)
        renderFrame(10)
        expect(p.stats.drawCalls).toBe(1)
        expect(p.stats.triangles).toBe(10)
        p.onRemove(viewer)
    })

    test('removed before the battery answers: no battery listeners', async() => {
        const battery = Object.assign(new FakeElement('battery'), {charging: false, level: 0.5})
        vi.stubGlobal('navigator', {getBattery: async() => battery})
        const {viewer} = makeViewer()
        const p = new PerfPanelPlugin()
        p.onAdded(viewer)
        p.onRemove(viewer)
        await new Promise(r => setTimeout(r, 0))
        expect(battery.listenerCount('chargingchange')).toBe(0)
    })
})
