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
    const progressive = {maxFrameCount: 32, isConverged: (_postRender?: boolean) => true}
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

    test('recordCamera360: the end pose stays until the recording stops, then the camera goes back', async() => {
        const popmotion = {animate: (o: any) => {
            o.onUpdate(o.to)
            o.onComplete?.()
            return {promise: Promise.resolve()}
        }}
        const {plugin, camera} = setup({PopmotionPlugin: popmotion})
        let atStop: number[] = []
        const stop = plugin._recorder.stop
        plugin._recorder.stop = (cb: any) => {
            atStop = camera.position.toArray().map((v: number) => +v.toFixed(5))
            stop(cb)
        }
        await plugin.recordCamera360(1, false, 90) // a quarter turn
        expect(atStop).toEqual([5, 0, 0]) // the end of the turn, not the start
        expect(camera.position.toArray().map((v: number) => +v.toFixed(5))).toEqual([0, 0, 5])
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

    test('a dispose while the folder is picked ends the start in the error state; the recording does not start', async() => {
        let pick!: (dir: any) => void
        vi.stubGlobal('window', {showDirectoryPicker: async() => new Promise(r => pick = r)})
        try {
            const rec = new ImageSequenceRecorder({} as any, {mimeType: 'image/png'}) as any
            const states: string[] = []
            rec.addEventListener('recording', () => states.push('recording'))
            rec.addEventListener('error', () => states.push('error'))
            rec.start()
            expect(rec.state).toBe('starting')
            rec.dispose() // e.g. the plugin is removed while the picker is open
            pick({getDirectoryHandle: async() => ({})}) // the folder is picked after that
            await new Promise(r => setTimeout(r, 5))
            expect(rec.state).toBe('error')
            expect(states).toEqual(['error'])
        } finally {
            vi.unstubAllGlobals()
        }
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
        // converge mode: the padding waits for frames of the recording (postFrame)
        const viewer = Object.assign(new EventDispatcher(), plugin._viewer)
        plugin._viewer = viewer
        Object.assign(plugin._viewer.getPlugin('ProgressivePlugin'), {postFrameConvergedRecordingDelta: () => 1 / 30})
        plugin.endPaddingMs = 20
        rec.start()
        const stop = plugin.stopRecording()
        await new Promise(r => setTimeout(r, 5))
        state = 'error' // e.g. MediaRecorder fails during the padding
        viewer.dispatchEvent({type: 'postFrame'}) // the next animation loop
        const done = await Promise.race([stop, new Promise(r => setTimeout(() => r('hung'), 1000))])
        expect(done).toBeUndefined()
        expect(plugin._stopping).toBeUndefined()
    })

    // a viewer dispose removes the plugin and ends the animation loop: no frame comes after it
    function removable() {
        const {plugin, progressive} = setup()
        const viewer = Object.assign(new EventDispatcher(), plugin._viewer, {
            renderManager: new EventDispatcher(),
            scene: Object.assign(new EventDispatcher(), plugin._viewer.scene),
        })
        plugin._viewer = viewer
        plugin._recorder.dispose = () => plugin._recorder.stop(() => undefined)
        return {plugin, progressive, viewer}
    }

    test('a removal during the converge-mode end padding settles the stop', async() => {
        const {plugin, progressive, viewer} = removable()
        Object.assign(progressive, {postFrameConvergedRecordingDelta: () => 1 / 30})
        plugin.endPaddingMs = 500 // 15 frames, which never come
        plugin._recorder.start()
        const stop = plugin.stopRecording()
        await new Promise(r => setTimeout(r, 5))
        viewer.dispatchEvent({type: 'postFrame'}) // one frame of the padding, then the viewer is disposed
        plugin.onRemove(viewer)
        expect(await Promise.race([stop, new Promise(r => setTimeout(() => r('hung'), 100))])).toBeUndefined()
        expect(plugin._stopping).toBeUndefined()
        expect(plugin._frameWaits.size).toBe(0)
        expect(viewer._listeners?.postFrame ?? []).toHaveLength(0)
    })

    test('a removal while the stop waits for the last pose to converge settles the stop', async() => {
        const {plugin, progressive, viewer} = removable()
        progressive.isConverged = () => false
        viewer.doOnce = async() => new Promise(() => undefined) // the frames never come
        plugin._recorder.start()
        const stop = plugin.stopRecording()
        await new Promise(r => setTimeout(r, 5))
        plugin.onRemove(viewer)
        expect(await Promise.race([stop, new Promise(r => setTimeout(() => r('hung'), 100))])).toBeUndefined()
        expect(plugin._frameWaits.size).toBe(0)
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

describe('recorder failure', () => {
    test('a recorder error hides the indicator and ends the dirty state of a real-time recording', () => {
        const {plugin} = setup()
        plugin._active = {convergeMode: false, videoFrameRate: 30} // a real-time recording
        plugin._viewer.canvas = {}
        plugin._recordIndicator = {style: {visibility: 'hidden'}}
        const rec = plugin._getRecorder('image')
        rec._console = {error: () => undefined, warn: () => undefined}
        rec.setState('recording')
        expect(plugin.dirty).toBe(true)
        expect(plugin._recordIndicator.style.visibility).toBe('visible')
        rec.setState('error', {error: new Error('the encoder failed')})
        expect(plugin.dirty).toBe(false)
        expect(plugin._recordIndicator.style.visibility).toBe('hidden')
    })
})

describe('record indicator', () => {
    test('a removal takes the indicator out of the page, so an add again has one indicator', () => {
        const parent = {
            children: [] as any[],
            appendChild(c: any) {
                this.children.push(c)
            },
        }
        vi.stubGlobal('document', {createElement: () => ({style: {}, remove(this: any) {
            parent.children.splice(parent.children.indexOf(this), 1)
        }})})
        try {
            const plugin = new CanvasRecorderPlugin() as any
            plugin.refreshRecorderOptions = () => undefined // no recorder (an MP4 recorder starts a worker)
            const listeners = {addEventListener: () => undefined, removeEventListener: () => undefined}
            const viewer = {...listeners, renderManager: listeners, scene: listeners, canvas: {parentElement: parent}, console}
            plugin.onAdded(viewer)
            const rec = plugin._getRecorder('image')
            plugin.onRemove(viewer)
            expect(parent.children).toHaveLength(0)
            // a recorder event after the removal (a recording that the dispose stops) finds no indicator
            expect(() => rec.setState('stopped')).not.toThrow()
            plugin.onAdded(viewer)
            expect(parent.children).toHaveLength(1)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe('converge mode hold', () => {
    test('each still loop of a converged scene adds one frame, as the animations step one frame per loop', () => {
        const {plugin, progressive} = setup() // converge mode, the scene is converged
        let shown = 0 // the frame that the canvas shows
        const captured: number[] = []
        plugin._recorder.requestFrame = () => captured.push(shown)
        plugin._recorder.start()
        plugin._viewer.renderManager = {composer: {renderToScreen: true}}
        const loop = (render: boolean) => {
            if (render) {
                plugin._preRender()
                shown++
                plugin._postRender()
            }
            plugin._postFrame()
            plugin._pendingCapture?.() // the timeout of the capture, after the listeners of the frame
        }
        loop(true) // a converged render
        loop(false) // a still loop: the hold
        loop(false)
        expect(captured).toEqual([1, 1, 1])
        progressive.isConverged = () => false
        loop(true) // a render that is not converged: no frame
        expect(captured).toEqual([1, 1, 1])
    })
})

describe('a recorder that still records a frame', () => {
    test('no frame is requested until it is ready, for a converged render or a still loop', () => {
        const {plugin} = setup() // converge mode, the scene is converged
        const requestFrame = vi.fn()
        let busy = true
        Object.assign(plugin._recorder, {requestFrame, isBusy: () => busy})
        plugin._recorder.start()
        plugin._viewer.renderManager = {composer: {renderToScreen: true}}
        plugin._preRender()
        plugin._postRender() // a converged render while busy: no capture
        plugin._postFrame()
        plugin._postFrame() // still loops while busy: no hold
        expect(plugin._pendingCapture).toBeUndefined()
        expect(requestFrame).not.toHaveBeenCalled()
        busy = false
        plugin._postFrame() // ready: the still scene (the converged pose) is captured
        plugin._pendingCapture?.()
        expect(requestFrame).toHaveBeenCalledTimes(1)
    })

    test('a still-loop capture waits for the other listeners of the frame, so the animations still step', () => {
        const {plugin} = setup() // converge mode, the scene is converged
        let busy = false
        Object.assign(plugin._recorder, {requestFrame: () => busy = true, isBusy: () => busy}) // a browser recorder
        plugin._recorder.start()
        plugin._postFrame() // a still loop
        expect(plugin.canRecordFrame()).toBe(true) // e.g. GLTFAnimationPlugin, a later postFrame listener: it steps
        plugin._pendingCapture?.() // the timeout, after the frame
        expect(busy).toBe(true)
        expect(plugin.canRecordFrame()).toBe(false) // the next frame waits for the recorder
    })
})

describe('recording time', () => {
    test('a converge-mode wait lasts its frames of the video, counted per frame (also several in one loop)', async() => {
        const {plugin, progressive} = setup()
        const viewer = Object.assign(new EventDispatcher(), plugin._viewer)
        plugin._viewer = viewer
        let delta = 1 / 30
        Object.assign(progressive, {postFrameConvergedRecordingDelta: () => delta})
        plugin._recorder.start()
        let done = false
        const wait = plugin.waitRecordingTime(200).then(() => done = true) // 6 frames at 30 fps
        const frame = () => viewer.dispatchEvent({type: 'postFrame'})
        frame()
        frame()
        delta = 0 // a render that is not converged: no step
        frame()
        delta = 1 / 30
        frame()
        frame()
        frame()
        await Promise.resolve()
        expect(done).toBe(false) // 5 steps
        frame()
        await wait
        expect(done).toBe(true)
    })

    test('a wait counts the still frames of a browser recorder, whose capture comes after the listeners', async() => {
        const {plugin, progressive} = setup()
        const viewer = Object.assign(new EventDispatcher(), plugin._viewer)
        plugin._viewer = viewer
        let busy = false
        Object.assign(plugin._recorder, {requestFrame: () => busy = true, isBusy: () => busy}) // a browser recorder
        Object.assign(progressive, {postFrameConvergedRecordingDelta: () => plugin.canRecordFrame() ? 1 / 30 : 0})
        viewer.addEventListener('postFrame', plugin._postFrame) // the recorder listens before the wait
        plugin._recorder.start()
        let done = false
        const wait = plugin.waitRecordingTime(100).then(() => done = true) // 3 frames at 30 fps
        const stillFrame = () => {
            viewer.dispatchEvent({type: 'postFrame'})
            plugin._pendingCapture?.() // the capture, at its timeout
            busy = false // the browser recorder ends the frame before the next one
        }
        stillFrame()
        stillFrame()
        await Promise.resolve()
        expect(done).toBe(false)
        stillFrame()
        await wait
        expect(done).toBe(true)
    })

    test('a scene that does not converge waits the rest of the time on the wall clock', async() => {
        const {plugin, progressive} = setup()
        const viewer = Object.assign(new EventDispatcher(), plugin._viewer)
        plugin._viewer = viewer
        progressive.maxFrameCount = 4
        Object.assign(progressive, {postFrameConvergedRecordingDelta: () => 0}) // e.g. a plugin that stays dirty
        plugin._recorder.start()
        let done = false
        const wait = plugin.waitRecordingTime(100).then(() => done = true) // 3 frames at 30 fps
        for (let i = 0; i < 6; i++) viewer.dispatchEvent({type: 'postFrame'}) // maxFrameCount + 2 frames without a step
        await Promise.resolve()
        expect(done).toBe(false)
        viewer.dispatchEvent({type: 'postFrame'}) // one more: it does not converge, the rest (100 ms) on the wall clock
        const result = await Promise.race([wait, new Promise(r => setTimeout(() => r('hung'), 1000))])
        expect(result).not.toBe('hung')
        expect(done).toBe(true)
    })

    test('the pause between camera views waits for recording time while a recording runs', async() => {
        const views = new CameraViewPlugin() as any
        const waitRecordingTime = vi.fn(async() => {
            views.viewLooping = false // one view, then the loop ends
        })
        views._viewer = {getPlugin: (t: string) => t === 'CanvasRecorder' ? {isRecording: () => true, waitRecordingTime} : undefined}
        views._cameraViews = [{}]
        views.animateToView = async() => undefined
        views.viewPauseTime = 200
        views.viewLooping = true
        await views._animationLoop()
        expect(waitRecordingTime).toHaveBeenCalledWith(202)
    })
})

describe('converge mode stop', () => {
    // each postFrame renders one progressive frame; the converged frame is captured (in _postRender)
    function converging(maxFrameCount: number) {
        const {plugin, progressive} = setup()
        let frameCount = 0
        progressive.maxFrameCount = maxFrameCount
        progressive.isConverged = (postRender = false) => frameCount >= maxFrameCount - 1 + (postRender ? 1 : 0)
        const captured: number[] = []
        const rec = plugin._recorder
        rec.requestFrame = () => rec.isRecording() && captured.push(frameCount)
        plugin._viewer.doOnce = async() => {
            if (progressive.isConverged(true)) return // converged: nothing renders
            frameCount++
            plugin._postRender()
        }
        rec.start()
        return {plugin, captured}
    }

    test('the stop waits for the last pose to converge (16 samples in record())', async() => {
        const {plugin, captured} = converging(16)
        await plugin.stopRecording()
        expect(captured).toEqual([16])
    })

    test('the converged frame is captured before the recorder stops, also without end padding', async() => {
        const {plugin, captured} = converging(4)
        await plugin.stopRecording()
        expect(captured).toEqual([4])
    })

    test('the last frame of the end padding is captured before the recorder stops', async() => {
        const {plugin, progressive} = setup()
        const viewer = Object.assign(new EventDispatcher(), plugin._viewer)
        plugin._viewer = viewer
        Object.assign(progressive, {postFrameConvergedRecordingDelta: () => 1 / 30})
        viewer.addEventListener('postFrame', plugin._postFrame) // the recorder listens before the wait
        const rec = plugin._recorder
        let captured = 0
        rec.requestFrame = () => rec.isRecording() && captured++
        plugin.endPaddingMs = 34 // one frame at 30 fps
        rec.start()
        const stop = plugin.stopRecording()
        await new Promise(r => setTimeout(r, 5))
        viewer.dispatchEvent({type: 'postFrame'}) // a still loop: its capture waits for a timeout, the padding ends
        await stop
        expect(captured).toBe(1)
    })

    test('the last pose waits for the browser recorder for a frame time of the video, also when the loops are fast', async() => {
        const {plugin, captured} = converging(4)
        const rec = plugin._recorder
        let busy = true // the browser recorder records the frame of the pose before, for a frame time (33 ms at 30 fps)
        setTimeout(() => busy = false, 30)
        rec.isBusy = () => busy
        const doOnce = plugin._viewer.doOnce
        plugin._viewer.doOnce = async() => {
            await doOnce()
            await new Promise(r => setTimeout(r, 1)) // a fast loop (a high refresh rate): 6 loops end before the recorder
            plugin._postFrame()
            plugin._pendingCapture?.()
        }
        await plugin.stopRecording()
        expect(captured).toEqual([4])
    })

    test('a last pose that converges while the browser recorder still records a frame is captured once it is ready', async() => {
        const {plugin, captured} = converging(4)
        const rec = plugin._recorder
        let busy = true // the browser recorder records the frame of the pose before
        let loops = 0
        rec.isBusy = () => busy
        const doOnce = plugin._viewer.doOnce
        plugin._viewer.doOnce = async() => {
            await doOnce() // renders until the pose converges (the converged render comes while busy)
            if (++loops > 5) busy = false // the recorder ends its frame
            plugin._postFrame() // the loop ends: a still loop captures when the recorder is ready
            plugin._pendingCapture?.()
        }
        await plugin.stopRecording()
        expect(captured).toEqual([4]) // the final pose, once
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
        for (const frame of [1, 2]) { // two frames in one animation loop (maxFramePerLoop 2), each with its postFrame
            plugin._preRender()
            shown = frame
            plugin._postRender()
            plugin._postFrame()
        }
        await new Promise(r => setTimeout(r, 10))
        expect(captured).toEqual([1, 2])
    })

    test('several converged renders in one frame (rendersPerFrame 2) capture one frame, as the animations step once', async() => {
        const {plugin} = setup() // converge mode, the scene is converged (e.g. ProgressivePlugin(1))
        let shown = 0 // the frame that the canvas shows
        const captured: number[] = []
        plugin._recorder.requestFrame = () => captured.push(shown)
        plugin._recorder.start()
        plugin._viewer.renderManager = {composer: {renderToScreen: true}}
        for (const step of [1, 2]) { // two animation steps
            for (const render of [0, 1]) { // the renders of the frame, before its postFrame
                plugin._preRender()
                shown = step * 10 + render
                plugin._postRender()
            }
            plugin._postFrame()
        }
        await new Promise(r => setTimeout(r, 10))
        expect(captured).toEqual([11, 21]) // the last render of each frame (the same pose)
    })

    test('a browser recorder: the capture of a frame with several renders still lets the animations step in it', () => {
        const {plugin} = setup() // converge mode, the scene is converged (e.g. ProgressivePlugin(1))
        let busy = false
        let pose = 0 // the pose of the animations
        let shown = -1 // the pose that the canvas shows
        const captured: number[] = []
        Object.assign(plugin._recorder, {requestFrame: () => {
            captured.push(shown)
            busy = true
        }, isBusy: () => busy}) // a browser recorder
        plugin._recorder.start()
        plugin._viewer.renderManager = {composer: {renderToScreen: true}}
        for (let loop = 0; loop < 3; loop++) {
            if (shown !== pose) for (let j = 0; j < 2; j++) { // the pose changed: two renders (rendersPerFrame 2)
                plugin._preRender()
                shown = pose
                plugin._postRender()
            }
            if (plugin.canRecordFrame()) pose++ // the animations step in postFrame (postFrameConvergedRecordingDelta)
            plugin._postFrame()
            plugin._pendingCapture?.() // the timeout of the capture, after the frame
            busy = false // the browser recorder ends the frame before the next loop
        }
        expect(captured).toEqual([0, 1, 2]) // each pose once
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

    test('a dispose before the native start ends the start in the error state and stops the native recorder', async() => {
        const mediaRecorder = class extends fakeMediaRecorder() {
            state = 'inactive'
            start() {
                this.state = 'recording'
                setTimeout(() => this.onstart?.(new Event('start')), 1) // the start event comes later
            }
            stop() {
                this.state = 'inactive'
                super.stop()
            }
        }
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const track = {stop: vi.fn()}
            const canvas = {captureStream: () => ({getVideoTracks: () => [track]})} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto'}) as any
            const states: string[] = []
            rec.addEventListener('recording', () => states.push('recording'))
            rec.addEventListener('error', () => states.push('error'))
            rec.start()
            const native = rec._recorder
            expect(rec.state).toBe('starting')
            rec.dispose() // e.g. the plugin is removed
            await new Promise(r => setTimeout(r, 10))
            expect(states).toEqual(['error'])
            expect(native.state).toBe('inactive')
            expect(track.stop).toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('a native start that throws ends the start in the error state and stops the canvas capture', () => {
        const mediaRecorder = class extends fakeMediaRecorder() {
            start() {
                throw new DOMException('the stream cannot be recorded', 'NotSupportedError')
            }
        }
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const track = {stop: vi.fn()}
            const canvas = {captureStream: () => ({getVideoTracks: () => [track]})} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto'}) as any
            rec._console = {error: () => undefined, warn: () => undefined, log: () => undefined}
            rec.start()
            expect(rec.state).toBe('error')
            expect(track.stop).toHaveBeenCalled()
            expect(rec._recorder).toBeUndefined() // a new start makes a new recorder
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('a native error releases the failed recording before the error event, so a listener can start again at once', () => {
        const mediaRecorder = fakeMediaRecorder()
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const tracks: {stop: any}[] = []
            const canvas = {captureStream: () => {
                const track = {stop: vi.fn()}
                tracks.push(track)
                return {getVideoTracks: () => [track]}
            }} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto'}) as any
            rec._console = {error: () => undefined, warn: () => undefined, log: () => undefined}
            rec.start()
            const failed = rec._recorder
            let retried = false
            rec.addEventListener('error', () => { // e.g. an app that retries from the plugin's error event
                if (retried) return
                retried = true
                rec.start()
            })
            failed.onerror?.(new Event('error'))
            failed.onstop?.(new Event('stop')) // the browser stops the failed recorder after its error event
            expect(rec.state).toBe('recording')
            expect(rec._recorder).toBeDefined()
            expect(rec._recorder).not.toBe(failed)
            expect(tracks[0].stop).toHaveBeenCalled() // the canvas capture of the failed recording ends
            expect(tracks[1].stop).not.toHaveBeenCalled() // the capture of the new recording runs
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('step mode: the frame time of a failed recording does not end a step of the next one', async() => {
        const mediaRecorder = fakeMediaRecorder()
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const canvas = {captureStream: () => ({getVideoTracks: () => [{stop: vi.fn(), requestFrame: vi.fn()}]})} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto', frameRate: 100, stepMode: true}) as any // 10 ms per frame
            rec._console = {error: () => undefined, warn: () => undefined, log: () => undefined}
            rec.start()
            const failed = rec._recorder
            failed.resume = () => failed.onresume?.(new Event('resume'))
            rec.requestFrame() // a step: its frame time ends in 10 ms
            failed.onerror?.(new Event('error')) // the native recorder fails during the step
            rec.start() // a retry before the frame time ends
            const next = rec._recorder
            next.pause = vi.fn()
            next.resume = () => undefined // the resume event of the new step comes later
            rec.requestFrame()
            expect(rec.isBusy()).toBe(true)
            await new Promise(r => setTimeout(r, 30)) // the frame time of the failed step passes
            expect(rec.isBusy()).toBe(true) // the new step still waits for its resume
            expect(next.pause).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

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

    test('step mode: frames requested during a frame time wait for it, and the stop waits for them', async() => {
        const mediaRecorder = fakeMediaRecorder()
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const track = {stop: vi.fn(), requestFrame: vi.fn()}
            const canvas = {captureStream: () => ({getVideoTracks: () => [track]})} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto', frameRate: 100, stepMode: true}) as any // 10 ms per frame
            rec.start()
            const events: string[] = []
            rec._recorder.resume = () => {
                events.push('resume')
                rec._recorder.onresume(new Event('resume'))
            }
            const stop = rec._recorder.stop.bind(rec._recorder)
            rec._recorder.stop = () => {
                events.push('stop')
                stop()
            }
            rec.requestFrame()
            rec.requestFrame()
            rec.requestFrame() // three frames in one frame time
            expect(events).toEqual(['resume'])
            await new Promise(resolve => rec.stop(resolve))
            expect(events).toEqual(['resume', 'resume', 'resume', 'stop']) // a frame time each, then the stop
            expect(track.requestFrame).toHaveBeenCalledTimes(3)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('step mode: a dispose during a step settles the stop and drops the frames that wait', async() => {
        const mediaRecorder = fakeMediaRecorder()
        vi.stubGlobal('window', {MediaRecorder: mediaRecorder})
        vi.stubGlobal('MediaRecorder', mediaRecorder)
        try {
            const track = {stop: vi.fn(), requestFrame: vi.fn()}
            const canvas = {captureStream: () => ({getVideoTracks: () => [track]})} as any
            const rec = new CanvasMediaRecorder(canvas, {mimeType: 'auto', frameRate: 100, stepMode: true}) as any // 10 ms per frame
            rec.start()
            rec._recorder.resume = function(this: any) {
                this.onresume(new Event('resume'))
            }
            rec.requestFrame()
            rec.requestFrame() // waits for the first
            const stopped = new Promise(resolve => rec.stop(() => resolve('called back')))
            rec.dispose() // e.g. the plugin is removed
            expect(await Promise.race([stopped, new Promise(r => setTimeout(() => r('hung'), 100))])).toBe('called back')
            await new Promise(r => setTimeout(r, 30)) // the timer of the step ends without an error
            expect(track.requestFrame).toHaveBeenCalledTimes(1)
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

    test('the first supported type is found without a probe of every other type', () => {
        const isTypeSupported = vi.fn((t: string) => t.startsWith('video/webm'))
        vi.stubGlobal('window', {MediaRecorder: {isTypeSupported}})
        vi.stubGlobal('MediaRecorder', {isTypeSupported})
        try {
            expect(CanvasMediaRecorder.GetSupportedMimeTypes([], ['h264'], true)).toBe('video/webm;codecs=h264')
            expect(isTypeSupported).toHaveBeenCalledTimes(1)
            isTypeSupported.mockClear()
            // the full list is the same as before
            const all = CanvasMediaRecorder.GetSupportedMimeTypes([], ['vp9', 'h264']) as string[]
            expect(all).toEqual([
                'video/webm;codecs=vp9', 'video/webm;codecs:vp9', 'video/webm;codecs=VP9', 'video/webm;codecs:VP9', 'video/webm',
                'video/webm;codecs=h264', 'video/webm;codecs:h264', 'video/webm;codecs=H264', 'video/webm;codecs:H264', 'video/webm',
            ])
            expect(isTypeSupported).toHaveBeenCalledTimes(40)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
