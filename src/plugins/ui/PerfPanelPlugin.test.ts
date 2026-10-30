import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi} from 'vitest'
import {EventDispatcher} from 'three'
import {PerfPanelPlugin} from './PerfPanelPlugin'

type Listener = (e: any) => void

// the node setup has no DOM: a small element with what the panel uses
class FakeElement {
    children: FakeElement[] = []
    parent?: FakeElement
    className = ''
    style: Record<string, string> = {}
    dataset: Record<string, string> = {}
    textContent = ''
    title = ''
    clientWidth = 0
    clientHeight = 0
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
    fire(type: string) {
        for (const f of this._listeners.get(type) ?? []) f({type})
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
