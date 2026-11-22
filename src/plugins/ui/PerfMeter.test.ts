import {describe, expect, test} from 'vitest'
import {displayRate, gpuName, PerfMeter, snapRate} from './PerfMeter'

interface Frames {
    /** number of frames */
    n: number
    /** interval, ms */
    dt: number
    /** CPU render ms per frame */
    ms?: number
    /** renders per frame */
    renders?: number
}

/** Add frames after time `t` and return the time of the last one */
function feed(meter: PerfMeter, t: number, ...groups: Frames[]) {
    for (const g of groups) {
        for (let i = 0; i < g.n; i++) {
            t += g.dt
            meter.addFrame(t, g.dt, g.ms ?? 0, g.renders ?? 0)
        }
    }
    return t
}

const ids = (m: PerfMeter) => m.stats.warnings.map(w => w.id)

/** compute, then the warnings with no environment */
function run(m: PerfMeter, now: number) {
    m.compute(now)
    m.updateWarnings()
    return ids(m)
}

describe('PerfMeter stats', () => {
    test('fps, avg, p95 and max over the last second', () => {
        const m = new PerfMeter()
        // 40 frames of 20 ms and one of 100 ms: 900 ms
        const t = feed(m, 1000, {n: 20, dt: 20}, {n: 1, dt: 100}, {n: 20, dt: 20})
        m.compute(t)
        expect(m.stats.frameAvg).toBeCloseTo(900 / 41)
        expect(m.stats.fps).toBeCloseTo(1000 / (900 / 41))
        expect(m.stats.frameP95).toBe(20) // index 38 of 41 sorted
        expect(m.stats.frameMax).toBe(100)
    })

    test('only the last second counts for the fps; frames older than the window are dropped', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 60, dt: 50}) // 3 s of slow frames
        t = feed(m, t, {n: 100, dt: 10}) // then 1 s at 100 fps
        m.compute(t + 5) // the last slow frame is 1005 ms old
        expect(m.stats.fps).toBeCloseTo(100)
        expect(m.stats.frameMax).toBe(10)

        // nothing in the window: no stats
        m.compute(t + 5000)
        expect(m.stats.fps).toBe(0)
        expect(m.stats.frameMax).toBe(0)
    })

    test('a slow page shows its last frame', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 2, dt: 1500})
        m.compute(t)
        expect(m.stats.fps).toBeCloseTo(1000 / 1500)
    })

    test('renders per second and the CPU time of the frames that rendered', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 30, dt: 16}, {n: 10, dt: 16, ms: 4, renders: 1}, {n: 1, dt: 16, ms: 9, renders: 2})
        m.compute(t)
        expect(m.stats.rendersPerSecond).toBe(12)
        expect(m.stats.renderAvg).toBeCloseTo((10 * 4 + 9) / 11)
        expect(m.stats.renderMax).toBe(9)
    })

    test('forEachFrame: newest first, rendered when the frame or the one before rendered', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 1, dt: 16}, {n: 1, dt: 17, renders: 1}, {n: 1, dt: 18}, {n: 1, dt: 19})
        const seen: [number, number, boolean][] = []
        m.forEachFrame(t, (age, dt, rendered) => seen.push([age, dt, rendered]))
        expect(seen).toEqual([[0, 19, false], [19, 18, true], [37, 17, true], [54, 16, false]])
    })
})

describe('PerfMeter refresh rate', () => {
    test('the fastest steady rate seen, snapped to a display rate', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 60, dt: 1000 / 59.7})
        m.compute(t)
        expect(m.stats.refreshRate).toBe(60)
        t = feed(m, t, {n: 120, dt: 1000 / 120})
        m.compute(t)
        expect(m.stats.refreshRate).toBe(120)
        t = feed(m, t, {n: 60, dt: 1000 / 60})
        m.compute(t)
        expect(m.stats.refreshRate).toBe(120) // a slower rate later does not lower it
    })

    test('a rate that is no display rate (a busy GPU at 55 fps) is not the refresh rate', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 60, dt: 1000 / 55, ms: 2, renders: 1})
        m.compute(t)
        expect(m.stats.refreshRate).toBe(0)
    })

    test('needs 20 frames in the last second', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 19, dt: 1000 / 60})
        m.compute(t)
        expect(m.stats.refreshRate).toBe(0)
    })

    test('snapRate and displayRate', () => {
        expect(snapRate(59.7)).toBe(60)
        expect(snapRate(143)).toBe(144)
        expect(snapRate(55)).toBe(55)
        expect(displayRate(55)).toBe(0)
        expect(displayRate(29.5)).toBe(30)
    })
})

describe('PerfMeter warnings', () => {
    test('capped: steady idle frames at ~33 ms', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 60, dt: 33.4})
        expect(run(m, t)).toEqual(['capped'])
        expect(m.capped).toBe(true)
        expect(m.cappedRate).toBe(30)
        expect(m.stats.warnings[0].hint).toContain('chrome://settings/performance')
    })

    test('capped: steady idle frames clearly slower than the rate seen before', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 120, dt: 1000 / 120})
        expect(run(m, t)).toEqual([])
        t = feed(m, t, {n: 180, dt: 1000 / 60})
        expect(run(m, t)).toEqual(['capped'])
        expect(m.cappedRate).toBe(60)
        expect(m.stats.warnings[0].hint).toContain('120 Hz before')
    })

    test('not capped: idle frames at the display rate, or unsteady idle frames', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 60, dt: 1000 / 60})
        expect(run(m, t)).toEqual([])
        const j = new PerfMeter()
        t = 1000
        for (let i = 0; i < 60; i++) t = feed(j, t, {n: 1, dt: i % 2 ? 31 : 36}) // in the ~30 fps range, but not steady
        expect(run(j, t)).toEqual([])
    })

    test('the cap goes when the frames run faster than it', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 60, dt: 33.4})
        expect(run(m, t)).toEqual(['capped'])
        t = feed(m, t, {n: 400, dt: 1000 / 60, ms: 2, renders: 1}) // rendering at 60 fps
        expect(run(m, t)).toEqual([])
        expect(m.capped).toBe(false)
    })

    test('cpu-bound: slow rendering frames, most of it in the CPU part', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 60, dt: 40, ms: 35, renders: 1})
        expect(run(m, t)).toEqual(['cpu-bound'])
        expect(m.stats.warnings[0].text).toBe('CPU bound: a render takes 35.0 of 40.0 ms per frame')
    })

    test('gpu-bound: slow rendering frames with a light CPU part', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 60, dt: 50, ms: 3, renders: 1})
        expect(run(m, t)).toEqual(['gpu-bound'])
        expect(m.stats.warnings[0].text).toBe('GPU bound: frames take 50.0 ms, the CPU part only 3.0 ms')
    })

    test('maybe-capped: steady ~30 fps rendering with a light CPU part, before any idle frames', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 60, dt: 33.4, ms: 3, renders: 1})
        expect(run(m, t)).toEqual(['maybe-capped'])
        // once idle frames at the display rate were seen, the same frames are GPU bound
        const g = new PerfMeter()
        t = feed(g, 1000, {n: 60, dt: 1000 / 60})
        g.compute(t)
        t = feed(g, t, {n: 200, dt: 33.4, ms: 3, renders: 1})
        expect(run(g, t)).toEqual(['gpu-bound'])
    })

    test('no bound warning within the frame budget, or while mostly idle', () => {
        const m = new PerfMeter()
        let t = feed(m, 1000, {n: 60, dt: 1000 / 60, ms: 12, renders: 1})
        expect(run(m, t)).toEqual([])
        const idle = new PerfMeter()
        t = feed(idle, 1000, {n: 40, dt: 1000 / 60}, {n: 3, dt: 60, ms: 50, renders: 1})
        expect(run(idle, t)).toEqual([])
    })

    test('battery: only when not charging', () => {
        const m = new PerfMeter()
        m.updateWarnings({battery: {charging: false, level: 0.42}})
        expect(ids(m)).toEqual(['battery'])
        expect(m.stats.warnings[0].text).toBe('On battery (42 %)')
        m.updateWarnings({battery: {charging: true, level: 0.42}})
        expect(ids(m)).toEqual([])
    })

    test('software: a software GL renderer', () => {
        const m = new PerfMeter()
        m.stats.gpu = 'SwiftShader Device (Subzero)'
        m.updateWarnings()
        expect(ids(m)).toEqual(['software'])
        m.stats.gpu = 'Apple M2'
        m.updateWarnings()
        expect(ids(m)).toEqual([])
    })

    test('hidden: last, after the frame warnings', () => {
        const m = new PerfMeter()
        const t = feed(m, 1000, {n: 60, dt: 33.4})
        m.compute(t)
        m.updateWarnings({hidden: true, battery: {charging: false, level: 1}})
        expect(ids(m)).toEqual(['capped', 'battery', 'hidden'])
    })
})

describe('gpuName', () => {
    const gl = (renderer: string, unmasked?: string) => ({
        RENDERER: 1,
        getParameter: (p: number) => p === 1 ? renderer : p === 2 ? unmasked : undefined,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        getExtension: () => unmasked === undefined ? null : {UNMASKED_RENDERER_WEBGL: 2},
    }) as any

    test('ANGLE strings are shortened to the renderer', () => {
        expect(gpuName(gl('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('NVIDIA GeForce RTX 3080')
        expect(gpuName(gl('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'))).toBe('ANGLE Metal Renderer: Apple M2')
    })

    test('a masked name reads the debug extension', () => {
        expect(gpuName(gl('WebKit WebGL', 'Apple GPU'))).toBe('Apple GPU')
        expect(gpuName(gl('WebKit WebGL'))).toBe('WebKit WebGL')
    })

    test('an error gives an empty name', () => {
        expect(gpuName({RENDERER: 1, getParameter: () => {
            throw new Error('lost')
        }, getExtension: () => null} as any)).toBe('')
    })
})
