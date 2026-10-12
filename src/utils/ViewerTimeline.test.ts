import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {ViewerTimeline} from './ViewerTimeline'

// Minimal viewer stand-in, ViewerTimeline.update does not use the viewer.
const viewer = {} as any

describe('ViewerTimeline recording delta', () => {
    let wallTime = 1000 // ms
    beforeEach(() => {
        wallTime = 1000
        vi.spyOn(performance, 'now').mockImplementation(() => wallTime)
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('recordingDelta returns -1 when no provider is set or it returns a negative value', () => {
        const timeline = new ViewerTimeline()
        expect(timeline.recordingDelta()).toBe(-1)
        timeline.recordingDeltaProvider = () => -5
        expect(timeline.recordingDelta()).toBe(-1)
        timeline.recordingDeltaProvider = () => NaN
        expect(timeline.recordingDelta()).toBe(-1)
        timeline.recordingDeltaProvider = () => 0
        expect(timeline.recordingDelta()).toBe(0)
        timeline.recordingDeltaProvider = () => 0.5
        expect(timeline.recordingDelta()).toBe(0.5)
    })

    test('uses the wall clock when not recording', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0
        timeline.start()
        timeline.update(viewer) // starts the clock
        wallTime += 250
        timeline.update(viewer)
        expect(timeline.delta).toBeCloseTo(0.25, 10)
        expect(timeline.time).toBeCloseTo(0.25, 10)
    })

    test('advances by the fixed step, independent of the wall clock', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0
        const fps = 60
        timeline.recordingDeltaProvider = () => 1 / fps
        const updates = vi.fn()
        timeline.addEventListener('update', updates)
        timeline.start()
        const frames = 120
        for (let i = 0; i < frames; i++) {
            timeline.update(viewer)
            wallTime += 100 + i % 7 * 13 // slow and uneven frames
        }
        expect(timeline.delta).toBeCloseTo(1 / fps, 12)
        expect(timeline.time).toBeCloseTo(frames / fps, 10)
        expect(updates).toHaveBeenCalledTimes(frames)
    })

    test('holds the time while the provider returns 0', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0
        let step = 0
        timeline.recordingDeltaProvider = () => step
        const updates = vi.fn()
        timeline.addEventListener('update', updates)
        timeline.start()
        for (let i = 0; i < 10; i++) {
            timeline.update(viewer)
            wallTime += 50
        }
        expect(timeline.time).toBe(0)
        expect(timeline.delta).toBe(0)
        expect(updates).not.toHaveBeenCalled()
        step = 0.5
        timeline.update(viewer)
        expect(timeline.time).toBeCloseTo(0.5, 12)
        expect(updates).toHaveBeenCalledTimes(1)
    })

    test('does not jump when the recording stops', () => {
        const timeline = new ViewerTimeline()
        timeline.endTime = 0
        timeline.recordingDeltaProvider = () => 1 / 30
        timeline.start()
        for (let i = 0; i < 30; i++) {
            timeline.update(viewer)
            wallTime += 1000 // each frame takes 1s of real time, 30x slower than real time
        }
        expect(timeline.time).toBeCloseTo(1, 10)
        timeline.recordingDeltaProvider = undefined
        timeline.update(viewer)
        // only the wall time since the last frame is added, not the 29s the recording lagged behind
        expect(timeline.delta).toBeCloseTo(1, 10)
        expect(timeline.time).toBeCloseTo(2, 10)
    })

    test('does not advance when the timeline is not running', () => {
        const timeline = new ViewerTimeline()
        timeline.recordingDeltaProvider = () => 1 / 60
        for (let i = 0; i < 5; i++) timeline.update(viewer)
        expect(timeline.time).toBe(0)
    })
})
