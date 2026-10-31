/**
 * ProgressivePlugin.postFrameConvergedRecordingDelta: the hook that animations use to step one video
 * frame at a time while CanvasRecorderPlugin records in converge mode. No WebGL: the viewer is a stub
 * with the plugins and the render manager frame count.
 */
import {beforeAll, describe, expect, test} from 'vitest'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

beforeAll(async() => {
    // through the package entry: importing the plugin module alone runs into an import cycle
    tp = await import('../../index')
}, timeout)

/**
 * A ProgressivePlugin and a CanvasRecorderPlugin on a stub viewer. `setRecording` stubs the recorder state.
 * The recorder options are set before the viewer, as a change with a viewer creates the recorder (a Worker).
 */
function setup(maxFrameCount = 4, options: {convergeMode?: boolean, videoFrameRate?: number} = {}) {
    const progressive = new tp.ProgressivePlugin(maxFrameCount)
    const recorder = new tp.CanvasRecorderPlugin()
    Object.assign(recorder, options)
    let recording = false
    recorder._recorder = {isRecording: () => recording}
    const viewer: any = {
        plugins: {[tp.ProgressivePlugin.PluginType]: progressive, [tp.CanvasRecorderPlugin.PluginType]: recorder},
        getPlugin(type: string) { return this.plugins[type] },
        renderManager: {frameCount: 0},
    }
    progressive._viewer = viewer
    recorder._viewer = viewer
    return {progressive, recorder, viewer, setRecording: (r: boolean) => recording = r}
}

describe('ProgressivePlugin.postFrameConvergedRecordingDelta', () => {
    test('the recorder is found by its PluginType', () => {
        expect(tp.CanvasRecorderPlugin.PluginType).toBe('CanvasRecorder')
    })

    test('no recorder plugin: -1', () => {
        const {progressive, viewer} = setup()
        delete viewer.plugins.CanvasRecorder
        expect(progressive.postFrameConvergedRecordingDelta()).toBe(-1)
    })

    test('not recording: -1', () => {
        const {progressive} = setup()
        expect(progressive.postFrameConvergedRecordingDelta()).toBe(-1)
    })

    test('recording, not in converge mode: -1', () => {
        const {progressive, setRecording} = setup(4, {convergeMode: false})
        setRecording(true)
        expect(progressive.postFrameConvergedRecordingDelta()).toBe(-1)
    })

    test('recording in converge mode, not converged: 0', () => {
        const {progressive, viewer, setRecording} = setup(4)
        setRecording(true)
        viewer.renderManager.frameCount = 3 // post render: converged at maxFrameCount
        expect(progressive.postFrameConvergedRecordingDelta()).toBe(0)
    })

    test('recording in converge mode, converged: 1 / videoFrameRate seconds', () => {
        const {progressive, viewer, setRecording} = setup(4)
        setRecording(true)
        viewer.renderManager.frameCount = 4
        expect(progressive.postFrameConvergedRecordingDelta()).toBeCloseTo(1 / 30)

        const s2 = setup(4, {videoFrameRate: 60})
        s2.setRecording(true)
        s2.viewer.renderManager.frameCount = 4
        expect(s2.progressive.postFrameConvergedRecordingDelta()).toBeCloseTo(1 / 60)
    })

    test('converged, but the recorder still records a frame (a browser recorder): 0, the animations wait', () => {
        const {progressive, recorder, viewer, setRecording} = setup(4)
        setRecording(true)
        viewer.renderManager.frameCount = 4
        let busy = true
        recorder._recorder.isBusy = () => busy
        expect(progressive.postFrameConvergedRecordingDelta()).toBe(0)
        busy = false
        expect(progressive.postFrameConvergedRecordingDelta()).toBeCloseTo(1 / 30)
    })
})
