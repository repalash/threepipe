import {AViewerPluginSync, ProgressivePlugin, ThreeViewer} from 'threepipe'

export type PerfPanelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface PerfPanelOptions {
    /** Corner of the container. Default: bottom-left */
    position?: PerfPanelPosition
    /** Start as the small "60 fps" pill. Default: true */
    collapsed?: boolean
    /** Element to mount into. Default: viewer.container (it must be positioned, e.g. relative) */
    container?: HTMLElement
    /** Light (default) or dark. With the tweakpane UI on the page (body.tpTheme-*), the panel takes its colours. */
    theme?: 'light' | 'dark'
}

export interface PerfWarning {
    id: 'capped' | 'maybe-capped' | 'cpu-bound' | 'gpu-bound' | 'battery' | 'hidden' | 'software'
    text: string
    hint?: string
}

/** Live numbers of the panel, updated 4 times per second */
export interface PerfStats {
    /** requestAnimationFrame rate over the last second: how often the page can show a new frame */
    fps: number
    /** Highest steady frame rate seen in this session (the display refresh rate), 0 until known */
    refreshRate: number
    /** Frame interval in ms over the last second */
    frameAvg: number
    frameP95: number
    frameMax: number
    /** CPU time from the viewer's preRender to postRender, per frame that rendered, over the last second */
    renderAvg: number
    renderMax: number
    /** Frames that rendered in the last second. 0 is normal: the viewer renders only when something changes */
    rendersPerSecond: number
    /** Draw calls and triangles of the last render, summed over all its passes (shadows, scene, effects, screen) */
    drawCalls: number
    triangles: number
    gpu: string
    warnings: PerfWarning[]
}

/** Samples kept: 4 s at 240 Hz */
const CAP = 1024
/** Window of the warnings and the sparkline, ms */
const WINDOW = 3000
/** DOM and stats update interval, ms (4 per second) */
const UI_INTERVAL = 250
/** Top of the sparkline, ms */
const SPARK_MAX = 50
const RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|basic render|software/i

interface BatteryLike extends EventTarget {
    charging: boolean
    level: number
}

/**
 * A small FPS / performance panel for threepipe viewers, plain DOM.
 *
 * Collapsed: a pill "60 fps" with a status dot (green, amber, red) and an amber corner dot when a warning is on.
 * Click it for the card: a sparkline of the frame times (last 3 s; blue bars rendered, grey bars idle), frame time
 * avg / p95 / max, CPU render time, renders per second, draw calls and triangles, canvas size, GPU and JS heap.
 *
 * Warnings: frame rate capped at ~30 fps (Chrome Energy Saver, Low Power Mode), CPU or GPU bound, on battery,
 * software rendering, tab hidden. Measuring uses its own requestAnimationFrame loop and the viewer's
 * preRender / postRender events; it never calls setDirty, so an idle viewer stays idle.
 */
export class PerfPanelPlugin extends AViewerPluginSync {
    static readonly PluginType = 'PerfPanelPlugin'
    serializeWithViewer = false

    readonly element: HTMLDivElement
    readonly stats: PerfStats = {
        fps: 0, refreshRate: 0, frameAvg: 0, frameP95: 0, frameMax: 0, renderAvg: 0, renderMax: 0,
        rendersPerSecond: 0, drawCalls: 0, triangles: 0, gpu: '', warnings: [],
    }

    private _enabled = true
    private _options: PerfPanelOptions
    private _pill: HTMLButtonElement
    private _pillText: HTMLElement
    private _pillDot: HTMLElement
    private _cardDot: HTMLElement
    private _cardFps: HTMLElement
    private _cardSub: HTMLElement
    private _rows: Record<'frame' | 'render' | 'renders' | 'draws' | 'canvas' | 'gpu' | 'heap', HTMLElement>
    private _warns: HTMLElement
    private _spark: HTMLCanvasElement
    private _warnHtml = ''
    private _sparkColors = {render: '#0d99ff', idle: '#c9ccd1', line: '#e9eaec', bad: '#f24822', text: '#8a8f97'}

    // ring buffer, one sample per requestAnimationFrame tick
    private _t = new Float64Array(CAP) // tick time
    private _dt = new Float32Array(CAP) // interval to the previous tick
    private _ms = new Float32Array(CAP) // CPU render time since the previous tick
    private _rn = new Uint8Array(CAP) // renders since the previous tick
    private _head = 0
    private _count = 0
    // scratch for the percentiles, filled 4 times per second
    private _s1 = new Float32Array(CAP)
    private _sIdle = new Float32Array(CAP)
    private _sRend = new Float32Array(CAP)

    private _raf = 0
    private _last = 0
    private _lastUi = 0
    private _uiCount = 0
    private _tickRenders = 0
    private _tickMs = 0
    private _renderStart = 0
    private _inRender = false
    private _calls = 0
    private _tris = 0

    private _maxRate = 0
    private _idleSeen = false
    private _capped = false
    private _cappedRate = 0
    private _battery?: BatteryLike
    private _info?: {update: (count: number, mode: number, instances: number) => void, render: {triangles: number}}
    private _origUpdate?: (count: number, mode: number, instances: number) => void
    private _hookedUpdate?: (count: number, mode: number, instances: number) => void

    constructor(options: PerfPanelOptions = {}) {
        super()
        this._options = options
        injectStyles()
        const el = document.createElement('div')
        el.className = `pp-root pp-${options.position ?? 'bottom-left'}${options.theme === 'dark' ? ' pp-dark' : ''}${options.collapsed === false ? '' : ' pp-collapsed'}`
        el.innerHTML = `
<button class="pp-pill" title="Performance: click for details"><i class="pp-dot"></i><span class="pp-pill-text">– fps</span></button>
<div class="pp-card">
  <div class="pp-head" title="Collapse"><i class="pp-dot"></i><b class="pp-big">–</b><span class="pp-sub"></span><button class="pp-x" title="Collapse">–</button></div>
  <canvas class="pp-spark" title="Frame times, last 3 s. Blue: frames that rendered. Grey: idle frames. Lines at 16.7 and 33.3 ms."></canvas>
  <dl class="pp-rows">
    <dt title="Time between frames over the last second">Frame ms</dt><dd data-r="frame"></dd>
    <dt title="CPU time of a render, from the viewer's preRender to postRender. The GPU works after it, in parallel.">Render CPU</dt><dd data-r="render"></dd>
    <dt title="The viewer renders only when something changes: 0 when nothing moves is normal and saves power">Renders/s</dt><dd data-r="renders"></dd>
    <dt title="Draw calls and triangles of the last render, summed over all passes (shadows, scene, effects, screen)">Draws · tris</dt><dd data-r="draws"></dd>
    <dt title="Canvas size in CSS pixels, render scale and device pixel ratio">Canvas</dt><dd data-r="canvas"></dd>
    <dt>GPU</dt><dd data-r="gpu"></dd>
    <dt title="JavaScript heap used / limit (Chrome only)">JS heap</dt><dd data-r="heap"></dd>
  </dl>
  <div class="pp-warns"></div>
</div>`
        this.element = el
        this._pill = el.querySelector('.pp-pill')!
        this._pillText = el.querySelector('.pp-pill-text')!
        this._pillDot = this._pill.querySelector('.pp-dot')!
        this._cardDot = el.querySelector('.pp-head .pp-dot')!
        this._cardFps = el.querySelector('.pp-big')!
        this._cardSub = el.querySelector('.pp-sub')!
        this._warns = el.querySelector('.pp-warns')!
        this._spark = el.querySelector('.pp-spark')!
        const rows: Record<string, HTMLElement> = {}
        el.querySelectorAll<HTMLElement>('[data-r]').forEach(d => rows[d.dataset.r!] = d)
        this._rows = rows as PerfPanelPlugin['_rows']
        if (!(performance as any).memory) { // Chrome only
            this._rows.heap.style.display = 'none'
            ;(this._rows.heap.previousElementSibling as HTMLElement).style.display = 'none'
        }
        this._pill.addEventListener('click', () => {
            this.collapsed = false
        })
        el.querySelector('.pp-head')!.addEventListener('click', () => {
            this.collapsed = true
        })
        // chrome:// links do not open from a page: a click copies them
        this._warns.addEventListener('click', e => {
            const code = (e.target as HTMLElement).closest('code')
            if (code) navigator.clipboard?.writeText(code.textContent || '').then(() => code.classList.add('pp-copied'))
        })
    }

    get enabled() {
        return this._enabled
    }

    /** False hides the panel and stops measuring */
    set enabled(v: boolean) {
        if (v === this._enabled) return
        this._enabled = v
        this.element.style.display = v ? '' : 'none'
        this._sync()
    }

    get collapsed() {
        return this.element.classList.contains('pp-collapsed')
    }

    set collapsed(v: boolean) {
        this.element.classList.toggle('pp-collapsed', v)
        if (!v) {
            this._readColors()
            this._render()
        }
    }

    setPosition(position: PerfPanelPosition) {
        this.element.classList.remove('pp-top-left', 'pp-top-right', 'pp-bottom-left', 'pp-bottom-right')
        this.element.classList.add('pp-' + position)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        ;(this._options.container ?? viewer.container).appendChild(this.element)
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
        this._battery?.removeEventListener('chargingchange', this._onBattery)
        this._battery?.removeEventListener('levelchange', this._onBattery)
        this._battery = undefined
        this._unhookInfo()
        this.element.remove()
        super.onRemove(viewer)
    }

    // region measuring

    /** Measure only while attached, enabled and visible: a hidden tab gets no animation frames */
    private _sync = () => {
        const run = !!this._viewer && this._enabled && document.visibilityState !== 'hidden'
        if (run && !this._raf) {
            this._last = 0 // the gap while paused is not a frame
            this._raf = requestAnimationFrame(this._tick)
        } else if (!run) this._stop()
        this._render()
    }

    private _stop() {
        if (this._raf) cancelAnimationFrame(this._raf)
        this._raf = 0
    }

    private _tick = (t: number) => {
        this._raf = requestAnimationFrame(this._tick)
        const dt = t - this._last
        // a longer gap is a pause (debugger, a frozen tab), not a frame; a hidden tab stops the loop (_sync)
        if (this._last > 0 && dt > 0 && dt < 10000) {
            const i = this._head
            this._t[i] = t
            this._dt[i] = dt
            this._ms[i] = this._tickMs
            this._rn[i] = Math.min(255, this._tickRenders)
            this._head = (i + 1) % CAP
            if (this._count < CAP) this._count++
        }
        this._last = t
        this._tickMs = 0
        this._tickRenders = 0
        if (t - this._lastUi >= UI_INTERVAL) {
            this._lastUi = t
            this._compute(t)
            this._render()
        }
    }

    private _onPreRender = () => {
        const info = this._viewer?.renderManager.webglRenderer.info
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
     * Count the draw calls of a whole render. threepipe needs renderer.info.autoReset = true (ExtendedRenderPass
     * checks it), so renderer.info only holds the last renderer.render() call of a frame, usually the screen pass.
     * Wrapping info.update counts every draw of every pass between preRender and postRender, without a reset.
     */
    private _hookInfo() {
        this._unhookInfo()
        const info = this._viewer?.renderManager.webglRenderer.info as PerfPanelPlugin['_info']
        if (!info || typeof info.update !== 'function') return
        const orig = info.update
        const render = info.render
        const hooked = (count: number, mode: number, instances: number) => {
            if (!this._inRender) return orig(count, mode, instances)
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
        if (this._info && this._origUpdate && this._info.update === this._hookedUpdate) this._info.update = this._origUpdate
        this._info = this._origUpdate = this._hookedUpdate = undefined
    }

    private async _watchBattery() {
        const nav = navigator as Navigator & {getBattery?: () => Promise<BatteryLike>}
        if (!nav.getBattery) return
        try {
            const battery = await nav.getBattery()
            if (!this._viewer) return
            this._battery = battery
            battery.addEventListener('chargingchange', this._onBattery)
            battery.addEventListener('levelchange', this._onBattery)
        } catch (e) {
            // not allowed here (permissions policy): no battery line
        }
    }

    private _onBattery = () => {
        this._lastUi = 0 // update on the next frame
    }

    // endregion

    // region stats

    private _compute(now: number) {
        const s = this.stats
        let n1 = 0, sum1 = 0, max1 = 0, renders1 = 0, rFrames = 0, rSum = 0, rMax = 0
        let nIdle = 0, nRend = 0, rendCpu = 0
        for (let k = 0; k < this._count; k++) {
            const i = (this._head - 1 - k + CAP) % CAP
            const age = now - this._t[i]
            if (age > WINDOW) break
            const dt = this._dt[i]
            const rn = this._rn[i]
            const ms = this._ms[i]
            if (age <= 1000 || k === 0) { // the last second, or the last frame when frames are slower
                this._s1[n1++] = dt
                sum1 += dt
                if (dt > max1) max1 = dt
                renders1 += rn
                if (rn) {
                    rFrames++
                    rSum += ms
                    if (ms > rMax) rMax = ms
                }
            }
            // the work of the previous tick or this one shapes this interval, whichever rAF callback runs first
            const p = (i - 1 + CAP) % CAP
            const prevRn = k + 1 < this._count ? this._rn[p] : 0
            if (!rn && !prevRn) this._sIdle[nIdle++] = dt
            else {
                this._sRend[nRend++] = dt
                rendCpu += Math.max(ms, prevRn ? this._ms[p] : 0)
            }
        }
        if (n1) this._s1.subarray(0, n1).sort()
        s.fps = n1 ? 1000 / (sum1 / n1) : 0
        s.frameAvg = n1 ? sum1 / n1 : 0
        s.frameP95 = n1 ? this._s1[Math.min(n1 - 1, Math.floor(n1 * 0.95))] : 0
        s.frameMax = max1
        s.renderAvg = rFrames ? rSum / rFrames : 0
        s.renderMax = rMax
        s.rendersPerSecond = renders1

        // display refresh: the fastest steady rate seen (the median of a second ignores single slow frames)
        if (n1 >= 20) {
            const rate = snapRate(1000 / this._s1[n1 >> 1])
            if (rate > this._maxRate) this._maxRate = rate
        }
        s.refreshRate = this._maxRate

        // Frame rate cap. No API tells it, so: idle frames (nothing rendered) cost almost nothing, and they still
        // come at a steady ~33 ms, or clearly slower than the rate seen before. A heavy scene cannot cause that.
        if (nIdle >= 20) {
            const idle = this._sIdle.subarray(0, nIdle).sort()
            const m = idle[nIdle >> 1]
            const steady = idle[Math.floor(nIdle * 0.9)] - idle[Math.floor(nIdle * 0.1)] < 4
            const at30 = m > 30 && m < 36.5
            const belowSeen = this._maxRate >= 50 && 1000 / m < this._maxRate * 0.6
            this._idleSeen = true
            this._capped = steady && (at30 || belowSeen)
            this._cappedRate = this._capped ? snapRate(1000 / m) : 0
        }
        const warnings: PerfWarning[] = []
        // mostly rendering: compare the CPU part with the frame time
        if (nRend >= 6 && nRend >= 4 * nIdle) {
            const rend = this._sRend.subarray(0, nRend).sort()
            const m = rend[nRend >> 1]
            const cpu = rendCpu / nRend
            if (this._capped && 1000 / m > this._cappedRate * 1.25) this._capped = false // faster than the cap: no cap
            const budget = this._capped ? 1000 / this._cappedRate : 1000 / (this._maxRate >= 50 ? this._maxRate : 60)
            const steady = rend[Math.floor(nRend * 0.9)] - rend[Math.floor(nRend * 0.1)] < 4
            if (m > budget * 1.25) {
                if (cpu >= 0.6 * m) {
                    warnings.push({
                        id: 'cpu-bound',
                        text: `CPU bound: a render takes ${cpu.toFixed(1)} of ${m.toFixed(1)} ms per frame`,
                        hint: 'Heavy JavaScript work in the render: plugins, many objects or materials updating each frame.',
                    })
                } else if (!this._capped && !this._idleSeen && steady && m > 30 && m < 36.5) {
                    warnings.push({
                        id: 'maybe-capped',
                        text: 'Steady ~30 fps with a light CPU part: Energy Saver may cap the frame rate, or the GPU is the limit',
                        hint: 'Keep the scene still for 2 s: idle frames at ~30 fps confirm a cap.',
                    })
                } else {
                    warnings.push({
                        id: 'gpu-bound',
                        text: `GPU bound: frames take ${m.toFixed(1)} ms, the CPU part only ${cpu.toFixed(1)} ms`,
                        hint: 'Lower the render scale or turn off effects. If it stays at ~30 fps while the scene is still, a power saver caps it.',
                    })
                }
            }
        }
        if (this._capped) {
            warnings.unshift({
                id: 'capped',
                text: `Frame rate capped at ~${this._cappedRate} fps — Chrome Energy Saver or a battery saver may be on`,
                hint: `Turn it off: chrome://settings/performance → Energy Saver; Safari / iOS: Low Power Mode.${this._maxRate > this._cappedRate ? ` The display ran at ${this._maxRate} Hz before.` : ''}`,
            })
        }
        const b = this._battery
        if (b && !b.charging) {
            warnings.push({
                id: 'battery',
                text: `On battery (${Math.round(b.level * 100)} %)`,
                hint: 'Chrome Energy Saver can turn on when unplugged or below 20 %.',
            })
        }
        if (SOFTWARE_GPU.test(s.gpu)) warnings.push({id: 'software', text: 'Software rendering: no GPU acceleration', hint: 'Turn on hardware acceleration in the browser settings, or update the GPU driver.'})
        s.warnings = warnings
    }

    // endregion

    // region view

    private _render() {
        const s = this.stats
        const paused = !this._raf
        const hidden = document.visibilityState === 'hidden'
        const hasData = s.fps > 0 && !paused
        const level = !hasData ? 'pp-off' : s.fps >= 50 ? 'pp-good' : s.fps >= 25 ? 'pp-amber' : 'pp-red'
        const fps = hasData ? String(Math.round(s.fps)) : '–'
        setClass(this._pillDot, level)
        setClass(this._cardDot, level)
        setText(this._pillText, paused ? 'paused' : fps + ' fps')
        this._pill.classList.toggle('pp-has-warn', s.warnings.length > 0 || hidden)
        if (this.collapsed) return

        setText(this._cardFps, paused ? 'paused' : fps + ' fps')
        const rate = s.refreshRate
        // a rate under 48 Hz is not a display rate, it is a cap or a slow page
        setText(this._cardSub, rate >= 48 ? `display ${rate} Hz` : this._capped ? 'display rate unknown (capped)' : 'display rate unknown')
        const r = this._rows
        setText(r.frame, hasData ? `${f1(s.frameAvg)} · p95 ${f1(s.frameP95)} · max ${f1(s.frameMax)}` : '–')
        setText(r.render, s.rendersPerSecond ? `${f1(s.renderAvg)} ms · max ${f1(s.renderMax)}` : '– idle')
        let renders = String(s.rendersPerSecond)
        if (!s.rendersPerSecond && hasData) renders = '0 · idle, nothing changed'
        else if (s.rendersPerSecond) {
            const prog = this._viewer?.getPlugin(ProgressivePlugin)
            const fc = this._viewer?.renderManager.frameCount ?? 0
            if (prog?.enabled && fc < prog.maxFrameCount) renders += ` · frame ${fc}/${prog.maxFrameCount}`
        }
        setText(r.renders, renders)
        setText(r.draws, s.drawCalls ? `${s.drawCalls} · ${fmtCount(s.triangles)}` : '–')
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

        let html = ''
        for (const w of s.warnings) html += `<div class="pp-warn" data-w="${w.id}">${escapeHtml(w.text)}${w.hint ? `<small>${linkify(w.hint)}</small>` : ''}</div>`
        if (hidden) html += '<div class="pp-warn" data-w="hidden">Tab hidden: measuring paused</div>'
        if (this._warnHtml !== html) this._warns.innerHTML = this._warnHtml = html

        if (++this._uiCount % 4 === 0) this._readColors()
        this._drawSpark()
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
        const h = Math.round(cv.clientHeight * dpr)
        if (!w || !h) return
        if (cv.width !== w || cv.height !== h) {
            cv.width = w
            cv.height = h
        }
        const ctx = cv.getContext('2d')
        if (!ctx) return
        const c = this._sparkColors
        ctx.clearRect(0, 0, w, h)
        const y = (ms: number) => h - Math.min(ms, SPARK_MAX) / SPARK_MAX * h
        ctx.fillStyle = c.line
        ctx.fillRect(0, Math.round(y(1000 / 60)), w, Math.max(1, Math.round(dpr)))
        ctx.fillRect(0, Math.round(y(1000 / 30)), w, Math.max(1, Math.round(dpr)))
        ctx.fillStyle = c.text
        ctx.font = `${Math.round(9 * dpr)}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = 'right'
        ctx.fillText('16', w - 1, y(1000 / 60) - 2 * dpr)
        ctx.fillText('33', w - 1, y(1000 / 30) - 2 * dpr)
        const bw = Math.max(1, Math.round(dpr))
        const pw = w - Math.round(18 * dpr) // the labels keep the right edge, with a gap to the bars
        const now = this._last
        let color = ''
        for (let k = 0; k < this._count; k++) {
            const i = (this._head - 1 - k + CAP) % CAP
            const age = now - this._t[i]
            if (age > WINDOW) break
            const dt = this._dt[i]
            const prevRn = k + 1 < this._count ? this._rn[(i - 1 + CAP) % CAP] : 0
            const col = dt > SPARK_MAX ? c.bad : this._rn[i] || prevRn ? c.render : c.idle
            if (col !== color) ctx.fillStyle = color = col
            const x = Math.round(pw - age / WINDOW * pw - bw)
            const top = Math.round(y(dt))
            ctx.fillRect(x, top, bw, h - top)
        }
    }

    // endregion
}

/** One decimal under 100: 16.7, 117 */
function f1(v: number) {
    return v < 100 ? v.toFixed(1) : String(Math.round(v))
}

/** 1234567 → 1.23 M, 34567 → 35 k */
function fmtCount(v: number) {
    return v >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : v >= 1e4 ? Math.round(v / 1e3) + ' k' : String(v)
}

/** 59.7 → 60: the closest common display rate within 4 % */
function snapRate(r: number) {
    for (const c of RATES) if (Math.abs(r - c) <= c * 0.04) return c
    return Math.round(r)
}

/** Text for innerHTML */
function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** chrome:// pages do not open from a link: show them as code that a click copies */
function linkify(s: string) {
    return escapeHtml(s).replace(/chrome:\/\/[\w/-]+/g, m => `<code title="Click to copy">${m}</code>`)
}

/** Write only on a change: no layout work for the same text */
function setText(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text
}

/** Swap the level class (pp-good, pp-amber, pp-red, pp-off) */
function setClass(el: HTMLElement, level: string) {
    if (el.dataset.level === level) return
    if (el.dataset.level) el.classList.remove(el.dataset.level)
    el.classList.add(level)
    el.dataset.level = level
}

/** The GPU name: unmasked where the browser allows it, "ANGLE (Vendor, Renderer, Backend)" shortened to the renderer */
function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    let name = ''
    try {
        name = String(gl.getParameter(gl.RENDERER) || '')
        // Chrome and Safari mask RENDERER; Firefox unmasks it and deprecates the extension
        if (!name || /^webkit webgl$/i.test(name)) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info')
            if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || name)
        }
    } catch (e) {
        return ''
    }
    const angle = /^ANGLE \((.*)\)$/.exec(name)
    if (angle) {
        const parts = angle[1].split(', ')
        if (parts.length >= 3) name = parts.slice(1, -1).join(', ')
    }
    return name.replace(/\s*\(0x[0-9a-f]+\)/gi, '').replace(/\s+Direct3D\S*.*$/i, '').trim()
}

let stylesAdded = false
/** One <style> for every panel on the page */
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.pp-root {
  --pp-bg: #ffffff; --pp-fg: #1e1e1e; --pp-dim: #8a8f97; --pp-line: #e9eaec; --pp-hover: #f2f3f5;
  --pp-accent: #0d99ff; --pp-good: #14ae5c; --pp-amber: #f5a524; --pp-bad: #f24822; --pp-spark-idle: #c9ccd1;
  --pp-warn-bg: #fff4e0; --pp-warn-fg: #7a4b00;
  --pp-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.06), 0 6px 20px rgba(0,0,0,.10);
  position: absolute; z-index: 12; color: var(--pp-fg); user-select: none;
  font: 500 11px/1.35 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
.pp-dark.pp-root {
  --pp-bg: #2c2c2c; --pp-fg: #f0f0f0; --pp-dim: #9a9a9a; --pp-line: #3d3d3d; --pp-hover: #383838; --pp-spark-idle: #5a5a5a;
  --pp-warn-bg: rgba(245,165,36,.14); --pp-warn-fg: #ffc965;
  --pp-shadow: 0 0 0 1px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.35);
}
/* with the tweakpane UI on the page, take its theme colours (body.tpTheme-black / dark / blue / light / white) */
body[class*="tpTheme-"] .pp-root {
  --pp-bg: var(--tp-base-background-color, #1c2026); --pp-fg: var(--tp-container-foreground-color, #f0f0f0);
  --pp-dim: var(--tp-monitor-foreground-color, #9a9a9a); --pp-line: var(--tp-container-border-color, rgba(255,255,255,.14));
  --pp-hover: var(--tp-button-background-color-hover, rgba(255,255,255,.09)); --pp-spark-idle: var(--tp-label-foreground-color, #8a8f97);
}
body.tpTheme-black .pp-root, body.tpTheme-dark .pp-root, body.tpTheme-blue .pp-root, body.tpTheme-figma-dark .pp-root {
  --pp-warn-bg: rgba(245,165,36,.14); --pp-warn-fg: #ffc965; --pp-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 6px 20px rgba(0,0,0,.3);
}
.pp-top-left { top: 10px; left: 10px; }
.pp-top-right { top: 10px; right: 10px; }
.pp-bottom-left { bottom: 10px; left: 10px; }
.pp-bottom-right { bottom: 10px; right: 10px; }
.pp-pill {
  position: relative; display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border: 0; border-radius: 6px;
  background: var(--pp-bg); color: var(--pp-fg); box-shadow: var(--pp-shadow); font: inherit; cursor: pointer;
}
.pp-pill:hover { background: var(--pp-hover); }
.pp-pill:focus-visible, .pp-x:focus-visible { outline: 2px solid var(--pp-accent); outline-offset: 1px; }
/* a warning: an amber dot on the corner */
.pp-pill.pp-has-warn::after {
  content: ''; position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--pp-amber); box-shadow: 0 0 0 1.5px var(--pp-bg);
}
.pp-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--pp-dim); }
.pp-dot.pp-good { background: var(--pp-good); }
.pp-dot.pp-amber { background: var(--pp-amber); }
.pp-dot.pp-red { background: var(--pp-bad); }
.pp-card { width: 248px; box-sizing: border-box; padding: 8px 10px 10px; border-radius: 6px; background: var(--pp-bg); box-shadow: var(--pp-shadow); }
.pp-collapsed .pp-card, .pp-root:not(.pp-collapsed) .pp-pill { display: none; }
.pp-head { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.pp-big { font-size: 14px; font-weight: 600; }
.pp-sub { flex: 1; color: var(--pp-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pp-x { border: 0; background: transparent; color: var(--pp-dim); font: inherit; font-size: 14px; line-height: 1; padding: 0 2px; border-radius: 4px; cursor: pointer; }
.pp-x:hover { color: var(--pp-fg); background: var(--pp-hover); }
.pp-spark { display: block; width: 100%; height: 34px; margin: 7px 0 6px; }
.pp-rows { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; margin: 0; }
.pp-rows dt { color: var(--pp-dim); white-space: nowrap; }
.pp-rows dd { margin: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text; }
.pp-warns { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.pp-warns:empty { display: none; }
.pp-warn { padding: 5px 7px; border-radius: 4px; background: var(--pp-warn-bg); color: var(--pp-warn-fg); user-select: text; }
.pp-warn small { display: block; margin-top: 2px; font-size: 10.5px; font-weight: 400; opacity: .9; }
.pp-warn code { font: inherit; font-weight: 500; text-decoration: underline dotted; cursor: copy; }
.pp-warn code.pp-copied::after { content: ' ✓'; }
`
    document.head.appendChild(st)
}
