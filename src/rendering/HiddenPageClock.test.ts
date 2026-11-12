import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {HiddenPageClock} from './HiddenPageClock'

/** A document whose visibility the test sets, and workers whose ticks the test sends */
let visibility: 'visible' | 'hidden' = 'visible'
let listeners: (() => void)[] = []
let workers: {onmessage: null | (() => void), terminated: boolean, tick: () => void}[] = []

beforeEach(() => {
    visibility = 'visible'
    listeners = []
    workers = []
    vi.stubGlobal('document', {
        get visibilityState() { return visibility },
        addEventListener: (_: string, l: () => void) => listeners.push(l),
        removeEventListener: (_: string, l: () => void) => listeners = listeners.filter(x => x !== l),
    })
    vi.stubGlobal('Worker', class {
        onmessage: null | (() => void) = null
        terminated = false
        constructor() { workers.push(this as any) }
        tick() { this.onmessage?.() }
        terminate() { this.terminated = true }
    })
})
afterEach(() => vi.unstubAllGlobals())

const setVisibility = (v: 'visible' | 'hidden') => {
    visibility = v
    listeners.forEach(l => l())
}

describe('HiddenPageClock', () => {
    test('ticks only while the page is hidden and someone holds it', () => {
        const onTick = vi.fn()
        const clock = new HiddenPageClock(onTick)
        setVisibility('hidden')
        expect(workers.length).toBe(0) // not held: nothing
        clock.hold('recording')
        expect(clock.ticking).toBe(true)
        workers[0].tick()
        workers[0].tick()
        expect(onTick).toHaveBeenCalledTimes(2)
        setVisibility('visible') // requestAnimationFrame again
        expect(workers[0].terminated).toBe(true)
        expect(clock.ticking).toBe(false)
        setVisibility('hidden')
        expect(workers.length).toBe(2)
        clock.release('recording')
        expect(workers[1].terminated).toBe(true)
        expect(listeners.length).toBe(0)
    })

    test('held while visible: starts when the page is hidden', () => {
        const clock = new HiddenPageClock(() => undefined)
        clock.hold('a')
        expect(clock.ticking).toBe(false)
        setVisibility('hidden')
        expect(clock.ticking).toBe(true)
        clock.dispose()
        expect(clock.ticking).toBe(false)
    })

    test('several holders: it stops when the last one lets go', () => {
        const clock = new HiddenPageClock(() => undefined)
        setVisibility('hidden')
        clock.hold('a')
        clock.hold('b')
        expect(workers.length).toBe(1)
        clock.release('a')
        expect(clock.ticking).toBe(true)
        clock.release('b')
        expect(clock.ticking).toBe(false)
    })

    test('no Worker (Node.js, or blocked): no clock, no error', () => {
        vi.stubGlobal('Worker', undefined)
        const clock = new HiddenPageClock(() => undefined)
        setVisibility('hidden')
        clock.hold('a')
        expect(clock.ticking).toBe(false)
        clock.release('a')
    })
})

describe('RenderManager.animationLoop with two clocks', () => {
    test('a frame time older than the last frame (a late requestAnimationFrame after a worker tick) does not step back', async() => {
        const {RenderManager} = await import('../index') // through the package, as the circular imports need
        const deltas: number[] = []
        const manager = {_lastTime: 0, frameWaitTime: 0, _renderer: {}, dispatchEvent: (e: any) => deltas.push(e.deltaTime)}
        const loop = (time: number) => RenderManager.prototype.animationLoop.call(manager as any, time)
        loop(1000) // a worker tick, performance.now()
        loop(995) // requestAnimationFrame: its frame began before that tick
        loop(1016)
        expect(deltas).toEqual([1000, 0, 16])
        expect(manager._lastTime).toBe(1016)
    })
})
