import {describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Vector3} from 'three'
import {CanvasRecorderPlugin} from './CanvasRecorderPlugin'
import {ImageSequenceRecorder} from '../../utils/canvas-recorder/ImageSequenceRecorder'

// a recorder that starts at once and stops with an empty blob
function fakeRecorder(plugin: CanvasRecorderPlugin) {
    let recording = false
    return {
        options: {stepMode: false},
        isRecording: () => recording,
        start: () => {
            recording = true
            plugin.dispatchEvent({type: 'start'})
        },
        stop: (cb: (b: Blob) => void) => {
            recording = false
            cb(new Blob([]))
            plugin.dispatchEvent({type: 'stop'})
        },
    }
}

function setup(plugins: Record<string, any> = {}) {
    const plugin = new CanvasRecorderPlugin() as any
    plugin.convergeMode = true
    const progressive = {maxFrameCount: 32, isConverged: () => true}
    const camera = Object.assign(new EventDispatcher(), {
        interactionsEnabled: true,
        target: new Vector3(),
        position: new Vector3(0, 0, 5),
        userData: {},
        setDirty: () => undefined,
        setInteractions: vi.fn(),
    })
    plugin._viewer = {
        getPlugin: (t: string) => t === 'ProgressivePlugin' ? progressive : plugins[t],
        doOnce: async() => undefined,
        setDirty: () => undefined,
        scene: {mainCamera: camera},
        console,
    }
    plugin._recorder = fakeRecorder(plugin)
    plugin.endPaddingMs = 0
    return {plugin, progressive, camera}
}

describe('CanvasRecorderPlugin', () => {
    test('record(): a failing action rejects, stops the recording and restores maxFrameCount', async() => {
        const {plugin, progressive} = setup()
        await expect(plugin.record(async() => {
            throw new Error('action failed')
        })).rejects.toThrow('action failed')
        expect(plugin.isRecording()).toBe(false)
        expect(progressive.maxFrameCount).toBe(32)
    })

    test('record(): a normal action resolves and restores maxFrameCount', async() => {
        const {plugin, progressive} = setup()
        let during = 0
        const blob = await plugin.record(async() => {
            during = progressive.maxFrameCount
        })
        expect(blob).toBeInstanceOf(Blob)
        expect(during).toBe(16)
        expect(progressive.maxFrameCount).toBe(32)
    })

    test('recordCamera360 without PopmotionPlugin leaves the camera interactions alone', async() => {
        const {plugin, camera} = setup()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        expect(await plugin.recordCamera360(1)).toBeUndefined()
        expect(camera.setInteractions).not.toHaveBeenCalled()
        error.mockRestore()
    })

    test('recordCamera360: a failing recording still gives the camera back', async() => {
        const popmotion = {animate: () => ({promise: Promise.reject(new Error('anim failed'))})}
        const {plugin, camera} = setup({PopmotionPlugin: popmotion})
        await expect(plugin.recordCamera360(1)).rejects.toThrow('anim failed')
        expect(camera.setInteractions).toHaveBeenLastCalledWith(true, CanvasRecorderPlugin.PluginType)
        expect(camera.position.toArray()).toEqual([0, 0, 5])
    })
})

describe('ImageSequenceRecorder', () => {
    test('overlapping captures get their own frame names', () => {
        const callbacks: (() => void)[] = []
        const canvas = {toBlob: (cb: (b: Blob) => void) => callbacks.push(() => cb(new Blob([])))} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/png'}) as any
        rec.setState('recording')
        rec.requestFrame()
        rec.requestFrame() // before the first toBlob calls back
        callbacks.forEach(c => c())
        expect(rec._currentImages.map((i: [string, Blob]) => i[0])).toEqual(['frame_00001.png', 'frame_00002.png'])
    })
})
