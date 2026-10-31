import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import {createStyles} from 'ts-browser-helpers'
import type {UiObjectConfig} from 'uiconfig.js'
import styles from './PerfPanelPlugin.css?inline'
import {gpuName, PERF_WINDOW, PerfMeter, PerfStats} from './PerfMeter'

export type {PerfStats, PerfWarning, PerfWarningId} from './PerfMeter'

export type PerfPanelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface PerfPanelOptions {
    /** Corner of the container. Default: `'bottom-left'` */
    position?: PerfPanelPosition
    /** Start as the small "60 fps" pill. Default: `true` */
    collapsed?: boolean
    /** Element to mount into. Default: `viewer.container` (it must be positioned, e.g. `position: relative`) */
    container?: HTMLElement
    /** Light (default) or dark. With the tweakpane UI on the page (`body.tpTheme-*`), the panel takes its colours. */
    theme?: 'light' | 'dark'
}

export interface PerfPanelPluginEventMap extends AViewerPluginEventMap {
    /** The stats changed (4 times per second while measuring) */
    update: {stats: PerfStats}
}

/** DOM and stats update interval, ms (4 per second) */
const UI_INTERVAL = 250
/** Top of the sparkline, ms */
const SPARK_MAX = 50
/** A longer gap between two animation frames is a pause (a debugger, a frozen tab), not a frame */
const MAX_FRAME_GAP = 10000
/** A press on the pill or the card header moves this far before it is a drag, in px: a click opens or collapses the card */
const DRAG_START = 3
const POSITIONS: PerfPanelPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

interface BatteryLike extends EventTarget {
    charging: boolean
    level: number
}

interface RendererInfoLike {
    update: (count: number, mode: number, instances: number) => void
    render: {triangles: number}
}
type RowKey = 'frame' | 'render' | 'renders' | 'draws' | 'canvas' | 'gpu' | 'heap'

/**
 * PerfPanelPlugin shows a small FPS / performance panel over the canvas, in plain DOM.
 *
 * Collapsed, it is a pill "60 fps" with a status dot (green, amber, red), and an amber corner dot when a warning is on.
 * A click opens the card: a sparkline of the frame times (last 3 s; accent bars rendered, grey bars idle), frame time
 * avg / p95 / max, CPU render time, renders per second, draw calls and triangles, canvas size, GPU and JS heap.
 * A click on the card header collapses it again. Drag the pill or the card header to move the panel; it stays inside the
 * container, also when the container gets smaller. Setting {@link position} (the Position dropdown) puts it back in a
 * corner. The dragged place is kept while the page is open, not saved.
 *
 * Collapsed, the pill is an overlay on the canvas (z-index 12, under the loading screen). The open card is viewer UI
 * (z-index 160, see UI layers in CONTRIBUTING.md): above other widgets in the same corner, such as the dock of the
 * sticky notes (150), and below the bars of the editor (200).
 *
 * Warnings (also in {@link stats}.warnings): frame rate capped at ~30 fps (Chrome Energy Saver, Low Power Mode),
 * CPU or GPU bound, on battery, software rendering, tab hidden.
 *
 * It measures with its own requestAnimationFrame loop and the viewer's `preRender` / `postRender` events. It never
 * calls `setDirty`, so an idle viewer stays idle. Draw calls and triangles are summed over all the passes of a render
 * (it wraps `renderer.info.update` while rendering, and restores it on remove).
 *
 * @example
 * ```ts
 * const perf = viewer.addPluginSync(new PerfPanelPlugin({position: 'bottom-right'}))
 * perf.addEventListener('update', ({stats}) => console.log(stats.fps, stats.warnings))
 * ```
 *
 * @category Plugins
 */
export class PerfPanelPlugin extends AViewerPluginSync<PerfPanelPluginEventMap> {
    static readonly PluginType = 'PerfPanelPlugin'
    serializeWithViewer = false

    /** The root element of the panel. It is in the container while the plugin is added. */
    readonly element: HTMLDivElement

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Performance Panel',
        children: [
            {type: 'checkbox', label: 'Enabled', property: [this, 'enabled']},
            {type: 'checkbox', label: 'Collapsed', property: [this, 'collapsed']},
            {type: 'dropdown', label: 'Position', property: [this, 'position'], children: POSITIONS.map(p => ({label: p, value: p}))},
        ],
    }

    private _enabled = true
    private _options: PerfPanelOptions
    private _position: PerfPanelPosition
    private _meter = new PerfMeter()
    private _stylesheet?: HTMLStyleElement
    /** The move from the corner that the person dragged the panel to, in px; undefined: in the corner */
    private _offset?: {x: number, y: number}
    /** The last press was a drag: the click after its release does not open or collapse the card */
    private _dragged = false
    /** Keeps a dragged panel inside the container when the container changes size */
    private _resizer?: ResizeObserver

    private _pill: HTMLButtonElement
    private _pillText: HTMLElement
    private _pillDot: HTMLElement
    private _cardDot: HTMLElement
    private _cardFps: HTMLElement
    private _cardSub: HTMLElement
    private _rows = {} as Record<RowKey, HTMLElement>
    private _warns: HTMLElement
    private _spark: HTMLCanvasElement
    private _sparkCtx?: CanvasRenderingContext2D
    private _warnKey = ''
    private _warnTexts: HTMLElement[] = []
    private _sparkColors = {render: '#0d99ff', idle: '#c9ccd1', line: '#e9eaec', bad: '#f24822', text: '#8a8f97'}
    private _uiCount = 0

    private _raf = 0
    private _last = 0
    private _lastUi = 0
    private _tickRenders = 0
    private _tickMs = 0
    private _renderStart = 0
    private _inRender = false
    private _calls = 0
    private _tris = 0

    private _battery?: BatteryLike
    private _info?: RendererInfoLike
    private _origUpdate?: RendererInfoLike['update']
    private _hookedUpdate?: RendererInfoLike['update']

    constructor(options: PerfPanelOptions = {}) {
        super()
        this._options = options
        this._position = options.position ?? 'bottom-left'

        const el = this.element = h('div', `pp-root pp-${this._position}${options.theme === 'dark' ? ' pp-dark' : ''}${options.collapsed === false ? '' : ' pp-collapsed'}`)

        this._pill = h('button', 'pp-pill', el, 'Performance: click for details')
        this._pillDot = h('i', 'pp-dot', this._pill)
        this._pillText = h('span', 'pp-pill-text', this._pill)
        this._pillText.textContent = '– fps'

        const card = h('div', 'pp-card', el)
        const head = h('div', 'pp-head', card, 'Collapse')
        this._cardDot = h('i', 'pp-dot', head)
        this._cardFps = h('b', 'pp-big', head)
        this._cardFps.textContent = '–'
        this._cardSub = h('span', 'pp-sub', head)
        h('button', 'pp-x', head, 'Collapse').textContent = '–'
        this._spark = h('canvas', 'pp-spark', card, 'Frame times, last 3 s. Accent: frames that rendered. Grey: idle frames. Lines at 16.7 and 33.3 ms.')

        const rows = h('dl', 'pp-rows', card)
        const row = (key: RowKey, label: string, title = '') => {
            const dt = h('dt', '', rows, title)
            dt.textContent = label
            this._rows[key] = h('dd', '', rows)
            return dt
        }
        row('frame', 'Frame ms', 'Time between frames over the last second')
        row('render', 'Render CPU', 'CPU time of a render, from the viewer\'s preRender to postRender. The GPU works after it, in parallel.')
        row('renders', 'Renders/s', 'The viewer renders only when something changes: 0 when nothing moves is normal and saves power')
        row('draws', 'Draws · tris', 'Draw calls and triangles of the last render, summed over all passes (shadows, scene, effects, screen)')
        row('canvas', 'Canvas', 'Canvas size in CSS pixels, render scale and device pixel ratio')
        row('gpu', 'GPU')
        const heap = row('heap', 'JS heap', 'JavaScript heap used / limit (Chrome only)')
        if (!(performance as any).memory) heap.style.display = this._rows.heap.style.display = 'none'

        this._warns = h('div', 'pp-warns', card)

        this._pill.addEventListener('click', () => this._dragged || (this.collapsed = false))
        head.addEventListener('click', () => this._dragged || (this.collapsed = true))
        this._pill.addEventListener('pointerdown', this._onPress)
        head.addEventListener('pointerdown', this._onPress)
    }

    /** Live numbers, updated in place 4 times per second while measuring (see the `update` event) */
    get stats(): PerfStats {
        return this._meter.stats
    }

    get enabled() {
        return this._enabled
    }

    /** False hides the panel and stops measuring */
    set enabled(v: boolean) {
        if (v === this._enabled) return
        this._enabled = v
        this.setDirty()
        this.uiConfig.uiRefresh?.(true)
    }

    get collapsed() {
        return this.element.classList.contains('pp-collapsed')
    }

    /** True shows the pill, false the card */
    set collapsed(v: boolean) {
        if (v === this.collapsed) return
        this.element.classList.toggle('pp-collapsed', v)
        this._place() // the card has another size than the pill
        if (!v) {
            this._readColors()
            this._render()
        }
        this.uiConfig.uiRefresh?.(true)
    }

    get position() {
        return this._position
    }

    /** Corner of the container. Setting it, also to the same corner, puts back a panel that the person dragged. */
    set position(position: PerfPanelPosition) {
        this._offset = undefined
        this._place()
        if (position === this._position) return
        this.element.classList.remove('pp-' + this._position)
        this.element.classList.add('pp-' + position)
        this._position = position
        this.uiConfig.uiRefresh?.(true)
    }

    /** Shows or hides the panel and starts or stops measuring, from {@link enabled}, {@link isDisabled} and the tab visibility */
    setDirty() {
        this._sync()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._stylesheet = createStyles(styles, viewer.container)
        const container = this._options.container ?? viewer.container
        container.appendChild(this.element)
        if (typeof ResizeObserver !== 'undefined') {
            this._resizer = new ResizeObserver(this._place)
            this._resizer.observe(container)
        } else window.addEventListener('resize', this._place)
        viewer.addEventListener('preRender', this._onPreRender)
        viewer.addEventListener('postRender', this._onPostRender)
        document.addEventListener('visibilitychange', this._sync)
        this.stats.gpu = gpuName(viewer.renderManager.webglRenderer.getContext())
        this._hookInfo()
        this._watchBattery()
        this._sync()
    }

    onRemove(viewer: ThreeViewer) {
        this._stop()
        viewer.removeEventListener('preRender', this._onPreRender)
        viewer.removeEventListener('postRender', this._onPostRender)
        document.removeEventListener('visibilitychange', this._sync)
        this._resizer?.disconnect()
        this._resizer = undefined
        window.removeEventListener('resize', this._place)
        this._battery?.removeEventListener('chargingchange', this._onBattery)
        this._battery?.removeEventListener('levelchange', this._onBattery)
        this._battery = undefined
        this._unhookInfo()
        this._inRender = false
        this.element.remove()
        this._stylesheet?.remove()
        this._stylesheet = undefined
        super.onRemove(viewer)
    }

    // region measuring

    private _isHidden() {
        return document.visibilityState === 'hidden'
    }

    /** Measure only while added, enabled and visible: a hidden tab gets no animation frames */
    private _sync = () => {
        const show = !this.isDisabled()
        this.element.style.display = show ? '' : 'none'
        if (show) this._place()
        const run = !!this._viewer && show && !this._isHidden()
        if (run && !this._raf) {
            this._last = 0 // the gap while stopped is not a frame
            this._raf = requestAnimationFrame(this._tick)
        } else if (!run) this._stop()
        this._meter.updateWarnings(this._env())
        this._render()
    }

    private _stop() {
        if (this._raf) cancelAnimationFrame(this._raf)
        this._raf = 0
    }

    private _tick = (t: number) => {
        this._raf = requestAnimationFrame(this._tick)
        const dt = t - this._last
        if (this._last > 0 && dt > 0 && dt < MAX_FRAME_GAP) this._meter.addFrame(t, dt, this._tickMs, this._tickRenders)
        this._last = t
        this._tickMs = 0
        this._tickRenders = 0
        if (t - this._lastUi >= UI_INTERVAL) {
            this._lastUi = t
            this._meter.compute(t)
            this._meter.updateWarnings(this._env())
            this._render()
            this.dispatchEvent({type: 'update', stats: this.stats})
        }
    }

    private _env() {
        return {battery: this._battery, hidden: this._isHidden()}
    }

    private _onPreRender = () => {
        if (!this._raf) return // not measuring: the draw hook only passes through
        const info = this._viewer?.renderManager.webglRenderer.info as RendererInfoLike | undefined
        if (info !== this._info) this._hookInfo() // a restored WebGL context makes a new info object
        this._calls = 0
        this._tris = 0
        this._inRender = true
        this._renderStart = performance.now()
    }

    private _onPostRender = () => {
        if (!this._inRender) return
        this._inRender = false
        this._tickMs += performance.now() - this._renderStart
        this._tickRenders++
        this.stats.drawCalls = this._calls
        this.stats.triangles = this._tris
    }

    /**
     * Count the draw calls of a whole render. threepipe needs `renderer.info.autoReset = true` (ExtendedRenderPass
     * checks it), so `renderer.info` only holds the last `renderer.render()` call of a frame, usually the screen pass.
     * Wrapping `info.update` counts every draw of every pass between preRender and postRender, without a reset.
     */
    private _hookInfo() {
        this._unhookInfo()
        const info = this._viewer?.renderManager.webglRenderer.info as RendererInfoLike | undefined
        if (!info || typeof info.update !== 'function') return
        const orig = info.update
        const render = info.render
        const hooked = (count: number, mode: number, instances: number) => {
            // an old hook left under another wrapper (see _unhookInfo) only passes through, so a draw counts once
            if (!this._inRender || this._hookedUpdate !== hooked) return orig(count, mode, instances)
            const t = render.triangles
            orig(count, mode, instances)
            this._calls++
            this._tris += render.triangles - t
        }
        info.update = hooked
        this._info = info
        this._origUpdate = orig
        this._hookedUpdate = hooked
    }

    private _unhookInfo() {
        // another wrapper on top of this one keeps it; it then only passes through
        if (this._info && this._origUpdate && this._info.update === this._hookedUpdate) this._info.update = this._origUpdate
        this._info = this._origUpdate = this._hookedUpdate = undefined
    }

    private async _watchBattery() {
        const nav = navigator as Navigator & {getBattery?: () => Promise<BatteryLike>}
        if (!nav.getBattery) return
        const viewer = this._viewer
        try {
            const battery = await nav.getBattery()
            // removed meanwhile, or added again and an earlier call got it
            if (!viewer || this._viewer !== viewer || this._battery) return
            this._battery = battery
            battery.addEventListener('chargingchange', this._onBattery)
            battery.addEventListener('levelchange', this._onBattery)
            this._onBattery()
        } catch (e) {
            // not allowed here (permissions policy): no battery line
        }
    }

    private _onBattery = () => {
        this._meter.updateWarnings(this._env())
        this._render()
    }

    // endregion

    // region view

    /**
     * A press on the pill or the card header: after {@link DRAG_START} px it drags the panel. The pointer is captured
     * on the pressed element, so the panel follows it also outside, until the release, a cancel or a lost capture.
     */
    private _onPress = (e: PointerEvent) => {
        this._dragged = false
        if (e.button !== 0) return
        const handle = e.currentTarget as HTMLElement
        const start = this._place() ?? {x: 0, y: 0}
        const sx = e.clientX, sy = e.clientY
        handle.setPointerCapture?.(e.pointerId)
        const move = (ev: PointerEvent) => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy
            if (!this._dragged && Math.abs(dx) + Math.abs(dy) < DRAG_START) return
            this._dragged = true
            this._offset = {x: start.x + dx, y: start.y + dy}
            this._place()
        }
        const end = () => {
            handle.removeEventListener('pointermove', move)
            handle.removeEventListener('pointerup', end)
            handle.removeEventListener('pointercancel', end)
            handle.removeEventListener('lostpointercapture', end)
            if (this._dragged) this._offset = this._place() // the place kept is the one shown
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', end)
        handle.addEventListener('pointercancel', end)
        handle.addEventListener('lostpointercapture', end)
    }

    /**
     * Moves the panel from its corner by the dragged offset, kept inside the container (the offset itself stays, so
     * the pill comes back to its place when the card collapses). Returns the move shown, or undefined in the corner.
     */
    private _place = () => {
        const el = this.element, o = this._offset, parent = el.parentElement
        if (!o || !parent) {
            el.style.transform = ''
            return undefined
        }
        const x = within(o.x, -el.offsetLeft, parent.clientWidth - el.offsetWidth - el.offsetLeft)
        const y = within(o.y, -el.offsetTop, parent.clientHeight - el.offsetHeight - el.offsetTop)
        el.style.transform = `translate(${x}px, ${y}px)`
        return {x, y}
    }

    private _render() {
        const s = this.stats
        const paused = !this._raf
        const hasData = s.fps > 0 && !paused
        const level = !hasData ? 'pp-off' : s.fps >= 50 ? 'pp-good' : s.fps >= 25 ? 'pp-amber' : 'pp-red'
        const fps = paused ? 'paused' : (hasData ? String(Math.round(s.fps)) : '–') + ' fps'
        setLevel(this._pillDot, level)
        setLevel(this._cardDot, level)
        setText(this._pillText, fps)
        this._pill.classList.toggle('pp-has-warn', s.warnings.length > 0)
        if (this.collapsed || this.element.style.display === 'none') return

        setText(this._cardFps, fps)
        const rate = s.refreshRate
        // a rate under 48 Hz is not a display rate, it is a cap or a slow page
        setText(this._cardSub, rate >= 48 ? `display ${rate} Hz` : this._meter.capped ? 'display rate unknown (capped)' : 'display rate unknown')
        const r = this._rows
        setText(r.frame, hasData ? `${f1(s.frameAvg)} · p95 ${f1(s.frameP95)} · max ${f1(s.frameMax)}` : '–')
        setText(r.render, s.rendersPerSecond ? `${f1(s.renderAvg)} ms · max ${f1(s.renderMax)}` : '– idle')
        let renders = String(s.rendersPerSecond)
        if (!s.rendersPerSecond && hasData) renders = '0 · idle, nothing changed'
        else if (s.rendersPerSecond) {
            const prog = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
            const fc = this._viewer?.renderManager.frameCount ?? 0
            if (prog && !prog.isDisabled() && fc < prog.maxFrameCount) renders += ` · frame ${fc}/${prog.maxFrameCount}`
        }
        setText(r.renders, renders)
        setText(r.draws, s.drawCalls ? `${s.drawCalls} · ${formatCount(s.triangles)}` : '–')
        const v = this._viewer
        if (v) {
            const c = v.canvas
            const scale = v.renderManager.renderScale
            const dpr = window.devicePixelRatio || 1
            setText(r.canvas, `${c.clientWidth}×${c.clientHeight} · ×${+scale.toFixed(2)}${dpr !== scale ? ` · DPR ${+dpr.toFixed(2)}` : ''}`)
            r.canvas.title = `Drawing buffer ${c.width}×${c.height} px`
        }
        setText(r.gpu, s.gpu || 'hidden by the browser')
        r.gpu.title = s.gpu
        const mem = (performance as any).memory as {usedJSHeapSize: number, jsHeapSizeLimit: number} | undefined
        if (mem) setText(r.heap, `${Math.round(mem.usedJSHeapSize / 1048576)} / ${Math.round(mem.jsHeapSizeLimit / 1048576)} MB`)

        this._renderWarnings()
        if (++this._uiCount % 4 === 0) this._readColors()
        this._drawSpark()
    }

    /** Build the warning elements when the warnings or their hints change; else only write the texts (the numbers in them change each update) */
    private _renderWarnings() {
        const warnings = this.stats.warnings
        const key = warnings.map(w => w.id + '\t' + (w.hint ?? '')).join('\n')
        if (key === this._warnKey) {
            warnings.forEach((w, i) => setText(this._warnTexts[i], w.text))
            return
        }
        this._warnKey = key
        this._warnTexts = []
        this._warns.replaceChildren(...warnings.map(w => {
            const div = h('div', 'pp-warn')
            div.dataset.w = w.id
            const text = h('span', '', div)
            text.textContent = w.text
            this._warnTexts.push(text)
            if (w.hint) {
                const small = h('small', '', div)
                // chrome:// pages do not open from a link: show them as code that a click copies
                w.hint.split(/(chrome:\/\/[\w/-]+)/).forEach((part, i) => {
                    if (!part) return
                    const code = i % 2 === 1
                    const el = h(code ? 'code' : 'span', '', small, code ? 'Click to copy' : '')
                    el.textContent = part
                    if (code) el.addEventListener('click', () => {
                        navigator.clipboard?.writeText(part).then(() => el.classList.add('pp-copied'), () => undefined)
                    })
                })
            }
            return div
        }))
    }

    /** Colours of the sparkline from the CSS variables, so it follows the theme; once per second */
    private _readColors() {
        const cs = getComputedStyle(this.element)
        const c = this._sparkColors
        c.render = cs.getPropertyValue('--pp-accent').trim() || c.render
        c.idle = cs.getPropertyValue('--pp-spark-idle').trim() || c.idle
        c.line = cs.getPropertyValue('--pp-line').trim() || c.line
        c.bad = cs.getPropertyValue('--pp-bad').trim() || c.bad
        c.text = cs.getPropertyValue('--pp-dim').trim() || c.text
    }

    private _drawSpark() {
        const cv = this._spark
        const dpr = window.devicePixelRatio || 1
        const w = Math.round(cv.clientWidth * dpr)
        const hgt = Math.round(cv.clientHeight * dpr)
        if (!w || !hgt) return
        let ctx = this._sparkCtx
        if (!ctx || cv.width !== w || cv.height !== hgt) {
            cv.width = w // resets the context state: set the font again
            cv.height = hgt
            ctx = this._sparkCtx = cv.getContext('2d') ?? undefined
            if (!ctx) return
            ctx.font = `${Math.round(9 * dpr)}px ui-sans-serif, system-ui, sans-serif`
            ctx.textAlign = 'right'
        }
        const c = this._sparkColors
        ctx.clearRect(0, 0, w, hgt)
        const y = (ms: number) => hgt - Math.min(ms, SPARK_MAX) / SPARK_MAX * hgt
        const lw = Math.max(1, Math.round(dpr))
        ctx.fillStyle = c.line
        ctx.fillRect(0, Math.round(y(1000 / 60)), w, lw)
        ctx.fillRect(0, Math.round(y(1000 / 30)), w, lw)
        ctx.fillStyle = c.text
        ctx.fillText('16', w - 1, y(1000 / 60) - 2 * dpr)
        ctx.fillText('33', w - 1, y(1000 / 30) - 2 * dpr)
        const pw = w - Math.round(18 * dpr) // the labels keep the right edge, with a gap to the bars
        let color = ''
        this._meter.forEachFrame(this._last, (age, dt, rendered) => {
            const col = dt > SPARK_MAX ? c.bad : rendered ? c.render : c.idle
            if (col !== color) ctx.fillStyle = color = col
            const x = Math.round(pw - age / PERF_WINDOW * pw - lw)
            const top = Math.round(y(dt))
            ctx.fillRect(x, top, lw, hgt - top)
        })
    }

    // endregion
}

/** A new element with a class, in a parent, with a title */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, title?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (title) el.title = title
    parent?.appendChild(el)
    return el
}

/** v between min and max; min when the range is empty (a panel larger than the container keeps its top left inside) */
function within(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v))
}

/** One decimal under 100: 16.7, 117 */
function f1(v: number) {
    return v < 100 ? v.toFixed(1) : String(Math.round(v))
}

/** 1234567 → 1.23 M, 34567 → 35 k */
function formatCount(v: number) {
    return v >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : v >= 1e4 ? Math.round(v / 1e3) + ' k' : String(v)
}

/** Write only on a change: no layout work for the same text */
function setText(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text
}

/** Swap the level class (pp-good, pp-amber, pp-red, pp-off) */
function setLevel(el: HTMLElement, level: string) {
    if (el.dataset.level === level) return
    if (el.dataset.level) el.classList.remove(el.dataset.level)
    el.classList.add(level)
    el.dataset.level = level
}
