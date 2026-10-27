import {describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Vector3} from 'three'
import {CanvasRecorderPlugin} from './CanvasRecorderPlugin'
import {ImageSequenceRecorder} from '../../utils/canvas-recorder/ImageSequenceRecorder'
import {FFMPEGRecorder} from '../../utils/canvas-recorder/FFMPEGRecorder'
import {CanvasMediaRecorder} from '../../utils/canvas-recorder/CanvasMediaRecorder'
import {CameraViewPlugin} from '../animation/CameraViewPlugin'
import {ProgressivePlugin} from '../pipeline/ProgressivePlugin'

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

    test('stopRecording(): a second call while the recording stops gets the same result', async() => {
        const {plugin} = setup()
        const stop = vi.spyOn(plugin._recorder, 'stop')
        plugin._recorder.start()
        const [a, b] = await Promise.all([plugin.stopRecording(), plugin.stopRecording()])
        expect(a).toBeInstanceOf(Blob)
        expect(b).toBe(a)
        expect(stop).toHaveBeenCalledTimes(1)
    })

    test('the default file name has the extension of the recorded format', async() => {
        const {plugin} = setup()
        const exportFile = vi.fn()
        let promptDefault = ''
        plugin._viewer.dialog = {prompt: async(_m: string, def: string) => (promptDefault = def, null)}
        plugin._viewer.getPlugin = (t: string) => t === 'FileTransferPlugin' ? {exportFile} : undefined
        await plugin._downloadBlob(new Blob([]), 'webm')
        expect(promptDefault).toBe('recording.webm')
        expect(exportFile).toHaveBeenCalledWith(expect.any(Blob), 'recording.webm')
    })

    test('no new recording while the last one still stops (an MP4 encodes)', () => {
        const {plugin} = setup()
        plugin._recorder.state = 'stopping'
        plugin._recorder.isRecording = () => false
        const start = vi.spyOn(plugin._recorder, 'start')
        expect(plugin.startRecording()).toBe(false)
        expect(start).not.toHaveBeenCalled()
    })

    test('a format change during a recording applies after it stops', async() => {
        const {plugin} = setup()
        const rec = plugin._recorder
        let state = 'stopped'
        Object.defineProperty(rec, 'state', {get: () => state})
        const start = rec.start
        rec.start = () => {
            state = 'recording'
            start()
        }
        const stop = rec.stop
        rec.stop = (cb: any) => {
            state = 'stopped'
            stop(cb)
        }
        const next = {setOptions: vi.fn()}
        plugin._getRecorder = vi.fn(() => next)
        plugin._viewer.renderManager = {composer: {}}
        rec.start()
        plugin.mimeType = 'image/png'
        expect(plugin._recorder).toBe(rec) // the running recording keeps its recorder
        expect(plugin._getRecorder).not.toHaveBeenCalled()
        await plugin.stopRecording()
        expect(plugin._getRecorder).toHaveBeenCalledWith('image')
        expect(plugin._recorder).toBe(next)
    })

    test('the running recording keeps its converge mode and frame rate; a change applies to the next one', async() => {
        const {plugin, progressive} = setup()
        Object.defineProperty(plugin._recorder, 'state', {get: () => plugin._recorder.isRecording() ? 'recording' : 'stopped'})
        plugin._getRecorder = vi.fn(() => ({setOptions: vi.fn()}))
        plugin.videoFrameRate = 30
        // the animation step that ProgressivePlugin gives while the recording runs
        const delta = () => ProgressivePlugin.prototype.postFrameConvergedRecordingDelta.call({
            _viewer: {getPlugin: () => plugin}, isConverged: () => true,
        } as any)
        let settings: any
        let step = -1
        await plugin.record(async() => {
            plugin.videoFrameRate = 60
            plugin.convergeMode = false
            settings = plugin.recordingSettings
            step = delta()
        })
        expect(settings).toEqual({convergeMode: true, videoFrameRate: 30})
        expect(step).toBeCloseTo(1 / 30)
        expect(progressive.maxFrameCount).toBe(32) // restored for the converge mode of the recording
        expect(plugin.recordingSettings).toBeUndefined()
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
        await new Promise(r => setTimeout(r, 5))
        expect(requestFrame).toHaveBeenCalledTimes(1)
    })

    test('the frames follow the frame rate: the animations run on the wall clock then', () => {
        const plugin = new CanvasRecorderPlugin() as any
        plugin.convergeMode = true
        plugin._viewer = {getPlugin: () => undefined, renderManager: {composer: {renderToScreen: true}}}
        const requestFrame = vi.fn()
        plugin._recorder = {isRecording: () => true, requestFrame}
        let time = 1000
        const now = vi.spyOn(performance, 'now').mockImplementation(() => time)
        try {
            for (const t of [0, 16, 34]) { // renders at 60 Hz, a video at 30 fps
                time = 1000 + t
                plugin._postRender()
            }
            expect(requestFrame).toHaveBeenCalledTimes(2)
        } finally {
            now.mockRestore()
        }
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

    test('a batch write that failed during the recording is reported at stop', async() => {
        const canvas = {toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/png'}) as any
        rec._console = {error: () => undefined, warn: () => undefined}
        let writes = 0
        rec._writeImages = async() => {
            if (writes++ === 0) throw new Error('disk full') // the first batch of 60 frames
        }
        rec.setState('recording')
        for (let i = 0; i < 62; i++) rec.requestFrame() // a batch write starts after 60 frames
        await new Promise(r => setTimeout(r, 0))
        await new Promise(resolve => rec.stop(resolve))
        expect(rec.state).toBe('error')
    })

    test('a failed batch write: stop still waits for the captures that run', async() => {
        const callbacks: (() => void)[] = []
        const canvas = {toBlob: (cb: (b: Blob) => void) => callbacks.push(() => cb(new Blob([])))} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/png'}) as any
        rec._console = {error: () => undefined, warn: () => undefined}
        let fail!: (e: Error) => void
        rec._track(new Promise<void>((_, reject) => fail = reject)) // a batch write that fails during the stop
        rec.setState('recording')
        rec.requestFrame()
        const done = new Promise(resolve => rec.stop(resolve))
        let settled = false
        void done.then(() => settled = true)
        fail(new Error('disk full'))
        await new Promise(r => setTimeout(r, 0))
        expect(settled).toBe(false) // the capture still runs
        callbacks[0]()
        await done
        expect(rec.state).toBe('error')
    })

    test('a capture without an image (a canvas of size 0) makes the stop end in the error state', async() => {
        const canvas = {toBlob: (cb: (b: Blob | null) => void) => cb(null)} as any
        const rec = new ImageSequenceRecorder(canvas, {mimeType: 'image/png'}) as any
        rec._console = {error: () => undefined, warn: () => undefined}
        rec._writeImages = async() => undefined
        rec.setState('recording')
        rec.requestFrame()
        await new Promise(resolve => rec.stop(resolve))
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

    test('an encode without output still calls back, and the recorder ends in the error state', async() => {
        vi.stubGlobal('Worker', class {
            onmessage: any = null
            postMessage() {
                return undefined
            }
        })
        try {
            const canvas = {width: 4, height: 4, toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
            const rec = new FFMPEGRecorder(canvas, {mimeType: 'video/mp4'}) as any
            vi.spyOn(console, 'log').mockImplementation(() => undefined)
            vi.spyOn(console, 'error').mockImplementation(() => undefined)
            vi.spyOn(console, 'time').mockImplementation(() => undefined)
            rec.start()
            rec.requestFrame()
            await new Promise(r => setTimeout(r, 0))
            const done = new Promise(resolve => rec.stop(resolve))
            await new Promise(r => setTimeout(r, 0))
            rec.worker.onmessage({data: {type: 'exit', data: 1}})
            rec.worker.onmessage({data: {type: 'done', data: {MEMFS: []}}}) // ffmpeg wrote no file
            expect(await done).toBeUndefined()
            expect(rec.state).toBe('error')
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

describe('CanvasRecorderPlugin stop and remove', () => {
    test('a recorder that fails during the end padding: the stop resolves without a recording', async() => {
        const {plugin} = setup()
        const rec = plugin._recorder
        let state = 'stopped'
        Object.defineProperty(rec, 'state', {get: () => state})
        rec.start = () => state = 'recording'
        rec.isRecording = () => state === 'recording'
        rec.stop = (cb: any) => {
            if (state === 'error') return // as the recorders do: no callback in the error state
            state = 'stopped'
            cb(new Blob([]))
        }
        plugin.endPaddingMs = 20
        rec.start()
        const stop = plugin.stopRecording()
        await new Promise(r => setTimeout(r, 5))
        state = 'error' // e.g. MediaRecorder fails during the padding
        const done = await Promise.race([stop, new Promise(r => setTimeout(() => r('hung'), 1000))])
        expect(done).toBeUndefined()
        expect(plugin._stopping).toBeUndefined()
    })

    test('onRemove drops the disposed recorders, so an add makes new ones', () => {
        const {plugin} = setup()
        const dispose = vi.fn()
        plugin._recorders = {['ffmpeg.js']: {dispose}}
        plugin._recorder = plugin._recorders['ffmpeg.js']
        const listeners = {removeEventListener: () => undefined}
        plugin._viewer = {...listeners, renderManager: listeners, scene: listeners, console}
        plugin.onRemove(plugin._viewer)
        expect(dispose).toHaveBeenCalled()
        expect(plugin.recorder).toBeUndefined()
        expect(plugin._recorders).toEqual({})
    })
})

describe('real-time recording (not converge mode)', () => {
    test('the frames follow the frame rate, not the render rate', () => {
        const {plugin} = setup()
        const rec = plugin._recorder
        rec.setOptions = () => undefined
        plugin._getRecorder = () => rec // keep the fake recorder when the options change
        plugin.convergeMode = false
        plugin.videoFrameRate = 30 // a frame every 33.3 ms
        const requestFrame = vi.fn()
        rec.requestFrame = requestFrame
        plugin.startRecording()
        let time = 1000
        const now = vi.spyOn(performance, 'now').mockImplementation(() => time)
        try {
            const render = (t: number) => {
                time = 1000 + t
                plugin._postRender()
                return requestFrame.mock.calls.length
            }
            expect(render(0)).toBe(1) // the first frame
            expect(render(16)).toBe(1) // a render at 60 Hz: no frame yet
            expect(render(34)).toBe(2)
            expect(render(134)).toBe(5) // a late render: the frames at 66.7, 100 and 133.3 ms
        } finally {
            now.mockRestore()
        }
    })
})

describe('converge mode with several frames in one loop', () => {
    test('each converged frame is captured before the next render', async() => {
        const {plugin} = setup()
        let shown = 0 // the frame that the canvas shows
        const captured: number[] = []
        plugin._recorder.requestFrame = () => captured.push(shown)
        plugin._recorder.start()
        plugin._viewer.renderManager = {composer: {renderToScreen: true}}
        for (const frame of [1, 2]) { // two renders in one animation loop (maxFramePerLoop 2)
            plugin._preRender()
            shown = frame
            plugin._postRender()
        }
        await new Promise(r => setTimeout(r, 10))
        expect(captured).toEqual([1, 2])
    })
})

describe('CameraViewPlugin.recordAllViews download', () => {
    test('the file name has the extension of the recorded format', async() => {
        const {plugin: recorder} = setup()
        recorder.record = async() => new Blob([], {type: 'video/webm;codecs=vp9'})
        const views = new CameraViewPlugin() as any
        let promptDefault = ''
        const exportFile = vi.fn()
        views._viewer = {
            getPlugin: (t: string) => t === 'CanvasRecorder' ? recorder : t === 'FileTransferPlugin' ? {exportFile} : undefined,
            dialog: {prompt: async(_m: string, def: string) => (promptDefault = def, '')},
        }
        views._cameraViews = [{}]
        views.resetToFirstView = async() => undefined
        await views.recordAllViews(undefined, true)
        expect(promptDefault).toBe('recording.webm')
        expect(exportFile).toHaveBeenCalledWith(expect.any(Blob), 'recording.webm')
    })
})

describe('FFMPEGRecorder image type', () => {
    test('a change of ffmpegOptions.imageType during a recording applies to the next one', async() => {
        const messages: string[] = []
        vi.stubGlobal('Worker', class {
            onmessage: any = null
            postMessage(m: any) {
                messages.push(m.type === 'image' ? m.file.name : m.arguments[m.arguments.indexOf('-i') + 1])
            }
        })
        try {
            const canvas = {width: 4, height: 4, toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
            const rec = new FFMPEGRecorder(canvas, {mimeType: 'video/mp4'}) as any
            vi.spyOn(console, 'log').mockImplementation(() => undefined)
            vi.spyOn(console, 'time').mockImplementation(() => undefined)
            rec.start()
            rec.requestFrame()
            rec.ffmpegOptions.imageType = 'png' // in the advanced options, while it records
            rec.requestFrame()
            rec.stop(() => undefined)
            await new Promise(r => setTimeout(r, 0))
            expect(messages).toEqual(['img000000.jpeg', 'img000001.jpeg', 'img%06d.jpeg'])
        } finally {
            vi.unstubAllGlobals()
            vi.restoreAllMocks()
        }
    })
})

describe('FFMPEGRecorder worker failure', () => {
    test('a worker that fails while recording ends the recording; a later start ends in the error state', () => {
        vi.stubGlobal('Worker', class {
            onmessage: any = null
            onerror: any = null
            postMessage() {
                return undefined
            }
        })
        try {
            const canvas = {width: 4, height: 4, toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
            const rec = new FFMPEGRecorder(canvas, {mimeType: 'video/mp4'}) as any
            vi.spyOn(console, 'error').mockImplementation(() => undefined)
            rec.start()
            rec.worker.onerror({message: 'failed to load the wasm'})
            expect(rec.state).toBe('error') // the plugin's stop then settles without a recording
            rec.start()
            expect(rec.state).toBe('error')
        } finally {
            vi.unstubAllGlobals()
            vi.restoreAllMocks()
        }
    })
})

describe('FFMPEGRecorder dispose', () => {
    test('ends the worker; an encode that runs settles its stop without a recording', async() => {
        const terminate = vi.fn()
        vi.stubGlobal('Worker', class {
            onmessage: any = null
            postMessage() {
                return undefined
            }
            terminate = terminate
        })
        try {
            const canvas = {width: 4, height: 4, toBlob: (cb: (b: Blob) => void) => cb(new Blob([]))} as any
            const rec = new FFMPEGRecorder(canvas, {mimeType: 'video/mp4'}) as any
            vi.spyOn(console, 'log').mockImplementation(() => undefined)
            vi.spyOn(console, 'error').mockImplementation(() => undefined)
            vi.spyOn(console, 'time').mockImplementation(() => undefined)
            rec.start()
            rec.requestFrame()
            const done = new Promise(resolve => rec.stop(resolve))
            rec.dispose() // while the stop waits for the encode
            expect(await done).toBeUndefined()
            expect(terminate).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
            vi.restoreAllMocks()
        }
    })
})

describe('CanvasMediaRecorder', () => {
    function fakeMediaRecorder() {
        return class {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            static isTypeSupported = () => true
            onstart: any
            onstop: any
            onerror: any
            ondataavailable: any
            onresume: any
            start() {
                this.onstart?.(new Event('start'))
            }
            stop() {
                this.onstop?.(new Event('stop')) // no data chunk
            }
            pause() {
                return undefined
            }
            resume() {
                return undefined
            }
        }
    }

    test('without MediaRecorder, the start ends in the error state', () => {
        vi.stubGlobal('window', {})
        try {
            const rec = new CanvasMediaRecorder({} as any, {mimeType: 'auto'}) as any
            rec._console = {error: () => undefined, warn: () => undefined, log: () => undefined}
            rec.start()
            expect(rec.state).toBe('error')
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('a stop without data still calls back, with no recording', async() => {
        const mediaRecorder = fakeMediaRecorder()
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const track = {stop: vi.fn()}
            const canvas = {captureStream: () => ({getVideoTracks: () => [track]})} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto'}) as any
            rec.start()
            expect(rec.state).toBe('recording')
            const done = await Promise.race([
                new Promise(resolve => rec.stop(() => resolve('called back'))),
                new Promise(resolve => setTimeout(() => resolve('hung'), 1000)),
            ])
            expect(done).toBe('called back')
            expect(rec.state).toBe('stopped')
            expect(track.stop).toHaveBeenCalledTimes(1) // the canvas capture ends with the recording
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
