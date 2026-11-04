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

/** A stub viewer whose ProgressivePlugin returns the given recording delta. */
function viewerWithDelta(delta: () => number) {
    return {getPlugin: () => ({postFrameConvergedRecordingDelta: delta})} as any
}

// ProgressivePlugin.postFrameConvergedRecordingDelta is in seconds (1 / videoFrameRate) while CanvasRecorderPlugin records in converge mode
describe('ViewerTimeline recording delta', () => {
    test('a converged recorded frame advances the time by the delta in seconds', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0 // no end
        let d = -1
        const recViewer = viewerWithDelta(() => d)
        timeline.start()
        timeline.update(recViewer) // starts the clock (not recording)
        const t0 = timeline.time

        d = 1 / 30
        timeline.update(recViewer)
        expect(timeline.delta).toBeCloseTo(1 / 30)
        expect(timeline.time - t0).toBeCloseTo(1 / 30)

        for (let i = 0; i < 29; i++) timeline.update(recViewer)
        expect(timeline.time - t0).toBeCloseTo(1)
    })

    test('after a slow recording, the next frame does not add the time the recording took', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0
        let d = -1
        const recViewer = viewerWithDelta(() => d)
        let wall = 1000
        const spy = vi.spyOn(performance, 'now').mockImplementation(() => wall)
        try {
            timeline.start()
            timeline.update(recViewer)
            const t0 = timeline.time
            // 3 recorded frames of 1/30 s, each one takes 1 s to converge (one unconverged frame between)
            for (let i = 0; i < 3; i++) {
                wall += 500
                d = 0
                timeline.update(recViewer)
                wall += 500
                d = 1 / 30
                timeline.update(recViewer)
            }
            expect(timeline.time - t0).toBeCloseTo(0.1)
            // the recording ends: the next frame advances by its own wall time only
            wall += 16
            d = -1
            timeline.update(recViewer)
            expect(timeline.delta).toBeCloseTo(0.016)
            expect(timeline.time - t0).toBeCloseTo(0.116)
        } finally {
            spy.mockRestore()
        }
    })

    test('a frame that is not converged does not advance the time', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0
        let d = -1
        const recViewer = viewerWithDelta(() => d)
        timeline.start()
        timeline.update(recViewer)
        const t0 = timeline.time

        d = 0
        timeline.update(recViewer)
        expect(timeline.delta).toBe(0)
        expect(timeline.time).toBe(t0)
    })
})
