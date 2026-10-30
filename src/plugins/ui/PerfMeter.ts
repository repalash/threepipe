/**
 * The measuring part of {@link PerfPanelPlugin}, without DOM: a ring buffer of animation frames, the stats over a
 * window and the warning rules.
 */

export type PerfWarningId = 'capped' | 'maybe-capped' | 'cpu-bound' | 'gpu-bound' | 'battery' | 'hidden' | 'software'

/** A warning of {@link PerfPanelPlugin}, in {@link PerfStats.warnings} */
export interface PerfWarning {
    id: PerfWarningId
    text: string
    hint?: string
}

/** Live numbers of {@link PerfPanelPlugin}, updated 4 times per second */
export interface PerfStats {
    /** requestAnimationFrame rate over the last second: how often the page can show a new frame */
    fps: number
    /** Highest steady frame rate seen at a common display rate (the display refresh rate), 0 until known */
    refreshRate: number
    /** Frame interval in ms over the last second: average, 95th percentile and maximum */
    frameAvg: number
    frameP95: number
    frameMax: number
    /** CPU time from the viewer's preRender to postRender, per frame that rendered, over the last second */
    renderAvg: number
    renderMax: number
    /** Renders in the last second. 0 is normal: the viewer renders only when something changes */
    rendersPerSecond: number
    /** Draw calls and triangles of the last render, summed over all its passes (shadows, scene, effects, screen) */
    drawCalls: number
    triangles: number
    /** GPU name from WebGL, '' when the browser hides it */
    gpu: string
    /** Active warnings, the most important first */
    warnings: PerfWarning[]
}

/** What the browser tells beside the frames */
export interface PerfEnvironment {
    /** From navigator.getBattery(), where the browser has it */
    battery?: {charging: boolean, level: number}
    /** The tab is hidden: no animation frames come */
    hidden?: boolean
}

/** Samples kept: 4 s at 240 Hz */
const CAP = 1024
/** Window of the warnings and the sparkline, ms */
export const PERF_WINDOW = 3000
/** Common display refresh rates, Hz */
export const DISPLAY_RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|basic render|software/i

/**
 * Collects one sample per animation frame and computes {@link PerfStats} over the last seconds.
 * The frame rate cap of a power saver (Chrome Energy Saver, Low Power Mode) has no API, so it is found from idle
 * frames: a frame that rendered nothing costs almost nothing, so idle frames at a steady ~33 ms (or clearly slower
 * than the rate seen before) mean a cap, not a heavy scene.
 */
export class PerfMeter {
    readonly stats: PerfStats = {
        fps: 0, refreshRate: 0, frameAvg: 0, frameP95: 0, frameMax: 0, renderAvg: 0, renderMax: 0,
        rendersPerSecond: 0, drawCalls: 0, triangles: 0, gpu: '', warnings: [],
    }

    // ring buffer, one sample per animation frame
    private _t = new Float64Array(CAP) // frame time
    private _dt = new Float32Array(CAP) // interval to the previous frame
    private _ms = new Float32Array(CAP) // CPU render time since the previous frame
    private _rn = new Uint8Array(CAP) // renders since the previous frame
    private _head = 0
    private _count = 0
    // scratch for the percentiles
    private _s1 = new Float32Array(CAP)
    private _sIdle = new Float32Array(CAP)
    private _sRend = new Float32Array(CAP)

    private _maxRate = 0
    private _idleSeen = false
    private _capped = false
    private _cappedRate = 0
    private _frameWarnings: PerfWarning[] = []

    /** A frame rate cap is detected (see the class) */
    get capped() {
        return this._capped
    }

    /** The capped frame rate, 0 when not capped */
    get cappedRate() {
        return this._cappedRate
    }

    /**
     * Add one animation frame.
     * @param t - time of the frame, ms (the requestAnimationFrame time)
     * @param dt - interval to the frame before, ms
     * @param renderMs - CPU time of the renders since the frame before, ms
     * @param renders - number of renders since the frame before
     */
    addFrame(t: number, dt: number, renderMs: number, renders: number) {
        const i = this._head
        this._t[i] = t
        this._dt[i] = dt
        this._ms[i] = renderMs
        this._rn[i] = Math.min(255, renders)
        this._head = (i + 1) % CAP
        if (this._count < CAP) this._count++
    }

    /**
     * Calls `fn` for each frame of the last {@link PERF_WINDOW} ms, the newest first.
     * `rendered` is true when the frame or the one before rendered: either one shapes the interval.
     */
    forEachFrame(now: number, fn: (age: number, dt: number, rendered: boolean) => void) {
        for (let k = 0; k < this._count; k++) {
            const i = (this._head - 1 - k + CAP) % CAP
            const age = now - this._t[i]
            if (age > PERF_WINDOW) break
            const prevRn = k + 1 < this._count ? this._rn[(i - 1 + CAP) % CAP] : 0
            fn(age, this._dt[i], !!(this._rn[i] || prevRn))
        }
    }

    /** Compute the frame stats, the refresh rate, the cap and the frame warnings over the window that ends at `now` */
    compute(now: number) {
        const s = this.stats
        let n1 = 0, sum1 = 0, max1 = 0, renders1 = 0, rFrames = 0, rSum = 0, rMax = 0
        let nIdle = 0, nRend = 0, rendCpu = 0
        for (let k = 0; k < this._count; k++) {
            const i = (this._head - 1 - k + CAP) % CAP
            const age = now - this._t[i]
            if (age > PERF_WINDOW) break
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
            // the work of the frame before or this one shapes this interval, whichever rAF callback runs first
            const p = (i - 1 + CAP) % CAP
            const prevRn = k + 1 < this._count ? this._rn[p] : 0
            if (!rn && !prevRn) this._sIdle[nIdle++] = dt
            else {
                this._sRend[nRend++] = dt
                rendCpu += Math.max(ms, prevRn ? this._ms[p] : 0)
            }
        }
        if (n1) this._s1.subarray(0, n1).sort()
        s.frameAvg = n1 ? sum1 / n1 : 0
        s.fps = n1 ? 1000 / s.frameAvg : 0
        s.frameP95 = n1 ? this._s1[Math.min(n1 - 1, Math.floor(n1 * 0.95))] : 0
        s.frameMax = max1
        s.renderAvg = rFrames ? rSum / rFrames : 0
        s.renderMax = rMax
        s.rendersPerSecond = renders1

        // display refresh: the fastest steady rate seen (the median of a second ignores single slow frames)
        if (n1 >= 20) {
            const rate = displayRate(1000 / this._s1[n1 >> 1])
            if (rate > this._maxRate) this._maxRate = rate
        }
        s.refreshRate = this._maxRate

        // frame rate cap: idle frames at a steady ~33 ms, or clearly slower than the rate seen before
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
            if (this._capped && 1000 / m > this._cappedRate * 1.25) { // faster than the cap: no cap
                this._capped = false
                this._cappedRate = 0
            }
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
        this._frameWarnings = warnings
    }

    /** Set {@link PerfStats.warnings}: the frame warnings of the last {@link compute}, then battery, software GL and hidden tab */
    updateWarnings(env: PerfEnvironment = {}) {
        const warnings = [...this._frameWarnings]
        const b = env.battery
        if (b && !b.charging) {
            warnings.push({
                id: 'battery',
                text: `On battery (${Math.round(b.level * 100)} %)`,
                hint: 'Chrome Energy Saver can turn on when unplugged or below 20 %.',
            })
        }
        if (SOFTWARE_GPU.test(this.stats.gpu)) {
            warnings.push({
                id: 'software',
                text: 'Software rendering: no GPU acceleration',
                hint: 'Turn on hardware acceleration in the browser settings, or update the GPU driver.',
            })
        }
        if (env.hidden) warnings.push({id: 'hidden', text: 'Tab hidden: measuring paused'})
        this.stats.warnings = warnings
    }
}

/** 59.7 → 60: the closest common display rate within 4 %, else the rounded rate */
export function snapRate(r: number) {
    return displayRate(r) || Math.round(r)
}

/** The closest common display rate within 4 %, 0 when none is close */
export function displayRate(r: number) {
    for (const c of DISPLAY_RATES) if (Math.abs(r - c) <= c * 0.04) return c
    return 0
}

/** The GPU name: unmasked where the browser allows it, "ANGLE (Vendor, Renderer, Backend)" shortened to the renderer */
export function gpuName(gl: Pick<WebGLRenderingContext, 'getParameter' | 'getExtension' | 'RENDERER'>) {
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
