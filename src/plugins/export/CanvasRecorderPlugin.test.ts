import {describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Vector3} from 'three'
import {CanvasRecorderPlugin} from './CanvasRecorderPlugin'
import {ImageSequenceRecorder} from '../../utils/canvas-recorder/ImageSequenceRecorder'
import {FFMPEGRecorder} from '../../utils/canvas-recorder/FFMPEGRecorder'
import {CameraViewPlugin} from '../animation/CameraViewPlugin'

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

    test('record(): rejects when the recording cannot start', async() => {
        const {plugin, progressive} = setup()
        plugin._recorder = undefined // no recorder: startRecording() returns false
        const action = vi.fn()
        await expect(Promise.race([
            plugin.record(action),
            new Promise((_, r) => setTimeout(() => r(new Error('hung')), 1000)),
        ])).rejects.toThrow('could not start')
        expect(action).not.toHaveBeenCalled()
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

describe('ImageSequenceRecorder stop', () => {
    test('waits for a capture still running, writes it, then calls back without a blob', async() => {
        const callbacks: (() => void)[] = []
        const canvas = {toBlob: (cb: (b: Blob) => void) => callbacks.push(() => cb(new Blob([])))} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/png'}) as any
        const written: string[] = []
        rec._writeImages = async(images: [string, Blob][]) => {
            written.push(...images.map(i => i[0]))
        }
        rec.setState('recording')
        rec.requestFrame()
        rec.requestFrame()
        callbacks[0]() // the second capture is still running at stop
        const done = new Promise(resolve => rec.stop(resolve))
        let settled = false
        void done.then(() => settled = true)
        await new Promise(r => setTimeout(r, 0))
        expect(settled).toBe(false) // it waits for the second capture
        callbacks[1]()
        expect(await done).toBeUndefined()
        expect(written).toEqual(['frame_00001.png', 'frame_00002.png'])
        expect(rec.state).toBe('stopped')
    })
})

describe('converge mode without ProgressivePlugin', () => {
    test('every frame is captured and shown', async() => {
        const plugin = new CanvasRecorderPlugin() as any
        plugin.convergeMode = true
        const composer = {renderToScreen: true}
        plugin._viewer = {getPlugin: () => undefined, renderManager: {composer}}
        const requestFrame = vi.fn()
        plugin._recorder = {isRecording: () => true, requestFrame}
        plugin._preRender()
        expect(composer.renderToScreen).toBe(true)
        plugin._postRender()
        await new Promise(r => setTimeout(r, 5)) // converge mode captures after 1 ms
        expect(requestFrame).toHaveBeenCalledTimes(1)
    })
})

describe('ImageSequenceRecorder failures and names', () => {
    test('a failed write at stop still calls back, and the recorder ends in the error state', async() => {
        const canvas = {toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/png'}) as any
        rec._console = {error: () => undefined, warn: () => undefined}
        rec._writeImages = async() => {
            throw new Error('disk full')
        }
        rec.setState('recording')
        rec.requestFrame()
        const done = await Promise.race([
            new Promise(resolve => rec.stop(() => resolve('called back'))),
            new Promise(resolve => setTimeout(() => resolve('hung'), 1000)),
        ])
        expect(done).toBe('called back')
        expect(rec.state).toBe('error')
    })

    test('WebP frames get the .webp extension', () => {
        const canvas = {toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/webp'}) as any
        rec.setState('recording')
        rec.requestFrame()
        expect(rec._currentImages[0][0]).toBe('frame_00001.webp')
    })
})

describe('ImageSequenceRecorder start', () => {
    test('without showDirectoryPicker, the start ends in the error state', () => {
        const rec = new ImageSequenceRecorder({} as any, {mimeType: 'image/png'}) as any
        rec._console = {error: () => undefined, warn: () => undefined}
        const states: string[] = []
        rec.addEventListener('error', () => states.push('error'))
        rec.start()
        expect(rec.state).toBe('error')
        expect(states).toEqual(['error'])
    })
})

describe('FFMPEGRecorder stop', () => {
    test('encodes after every capture is in the worker, also when the captures overlap', async() => {
        const messages: string[] = []
        vi.stubGlobal('Worker', class {
            onmessage = null
            postMessage(m: any) {
                messages.push(m.type === 'image' ? 'image:' + m.file.name : m.type)
            }
        })
        try {
            const callbacks: (() => void)[] = []
            const canvas = {width: 4, height: 4, toBlob: (cb: (b: Blob) => void) => callbacks.push(() => cb(new Blob([])))} as any
            const rec = new FFMPEGRecorder(canvas, {mimeType: 'video/mp4'}) as any
            vi.spyOn(console, 'log').mockImplementation(() => undefined)
            vi.spyOn(console, 'warn').mockImplementation(() => undefined)
            vi.spyOn(console, 'time').mockImplementation(() => undefined)
            rec.start()
            rec.requestFrame()
            rec.requestFrame() // before the first toBlob calls back
            callbacks[0]()
            await new Promise(r => setTimeout(r, 0))
            rec.stop(() => undefined)
            await new Promise(r => setTimeout(r, 0))
            expect(messages).toEqual(['image:img000000.jpeg']) // waits for the second capture
            callbacks[1]()
            await new Promise(r => setTimeout(r, 0))
            expect(messages).toEqual(['image:img000000.jpeg', 'image:img000001.jpeg', 'run'])
        } finally {
            vi.unstubAllGlobals()
            vi.restoreAllMocks()
        }
    })
})

describe('CameraViewPlugin.recordAllViews', () => {
    test('a failing animation rejects, stops the recording and turns the view loop back on', async() => {
        const {plugin: recorder} = setup()
        const views = new CameraViewPlugin() as any
        views._viewer = {getPlugin: (t: string) => t === 'CanvasRecorder' ? recorder : undefined}
        views._cameraViews = [{}]
        views._animationLooping = true // the view loop itself does not run here
        views.viewLooping = true
        views.resetToFirstView = async() => undefined
        views.animateAllViews = async() => {
            expect(views.viewLooping).toBe(false)
            throw new Error('anim failed')
        }
        await expect(views.recordAllViews(undefined, false)).rejects.toThrow('anim failed')
        expect(recorder.isRecording()).toBe(false)
        expect(views.viewLooping).toBe(true)
    })
})
