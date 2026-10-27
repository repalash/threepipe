import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {ViewerTimeline} from './ViewerTimeline'

// update() only asks the viewer for the ProgressivePlugin
const viewer = {getPlugin: () => undefined} as any

describe('ViewerTimeline', () => {
    beforeEach(() => {
        vi.useFakeTimers({toFake: ['performance']})
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    test('runs on the clock after start()', () => {
        const t = new ViewerTimeline()
        t.endTime = 0
        t.start()
        t.update(viewer)
        vi.advanceTimersByTime(500)
        t.update(viewer)
        expect(t.running).toBe(true)
        expect(t.time).toBeCloseTo(0.5, 2)
    })

    test('stop() then setTime() keeps the time that was set', () => {
        const t = new ViewerTimeline()
        t.endTime = 0
        t.start()
        t.update(viewer)
        vi.advanceTimersByTime(1000)
        t.update(viewer)
        // like a "go to start" button while playing: the stop takes effect in the next frame
        t.stop()
        t.setTime(0)
        vi.advanceTimersByTime(100)
        t.update(viewer)
        expect(t.running).toBe(false)
        expect(t.time).toBe(0)
    })

    test('stop() alone keeps the time of the last frame', () => {
        const t = new ViewerTimeline()
        t.endTime = 0
        t.start()
        t.update(viewer)
        vi.advanceTimersByTime(1000)
        t.update(viewer)
        t.stop()
        vi.advanceTimersByTime(100)
        t.update(viewer)
        expect(t.running).toBe(false)
        expect(t.time).toBeCloseTo(1, 2)
    })
})
