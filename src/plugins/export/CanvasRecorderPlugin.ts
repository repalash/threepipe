import {Spherical} from 'three'
import {getOrCall, onChange, PartialRecord, serialize, timeout} from 'ts-browser-helpers'
import {generateUiConfig, uiSlider, UiObjectConfig} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, type ThreeViewer} from '../../viewer'
import type {IConvergedCanvasRecorder, ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import type {CameraViewPlugin} from '../animation/CameraViewPlugin'
import type {GLTFAnimationPlugin} from '../animation/GLTFAnimationPlugin'
import type {PopmotionPlugin} from '../animation/PopmotionPlugin'
import type {AnimationObjectPlugin} from '../animation/AnimationObjectPlugin'
import type {FileTransferPlugin} from './FileTransferPlugin'
import {type Easing, EasingFunctions} from '../../utils/animation'
import type {ICanvasRecorder} from '../../utils/canvas-recorder/ACanvasRecorder'
import {ImageSequenceRecorder} from '../../utils/canvas-recorder/ImageSequenceRecorder'
import {CanvasMediaRecorder} from '../../utils/canvas-recorder/CanvasMediaRecorder'
import {FFMPEGRecorder} from '../../utils/canvas-recorder/FFMPEGRecorder'

export interface CanvasRecorderPluginEventMap extends AViewerPluginEventMap {
    start: object
    stop: object
    error: object
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'encode-progress': {progress: number, frame: number, totalFrames: number}
}

/**
 * Canvas Recorder Plugin
 *
 * Records the viewer canvas to a video (MP4 with ffmpeg.js, or the browser's MediaRecorder) or to an image sequence.
 * In converge mode, each video frame is captured only after the {@link ProgressivePlugin} has converged,
 * and the animations step by `1 / videoFrameRate` per captured frame (see {@link ProgressivePlugin.postFrameConvergedRecordingDelta}).
 *
 * The MP4 recorder loads ffmpeg.js from {@link FFMPEGRecorder.LIBRARY_PATH} when it is created.
 *
 * @category Plugins
 */
export class CanvasRecorderPlugin extends AViewerPluginSync<CanvasRecorderPluginEventMap> implements IConvergedCanvasRecorder {
    enabled = true

    get recorder() {
        return this._recorder
    }

    constructor() {
        super()
        this.refreshRecorderOptions = this.refreshRecorderOptions.bind(this)
    }

    isRecording() {
        return this._recorder?.isRecording() ?? false
    }

    static readonly PluginType = 'CanvasRecorder'

    private _recordIndicator?: HTMLDivElement

    // Note: viewer.maxFramePerLoop must be max (screen refresh rate / videoFrameRate)

    @onChange(CanvasRecorderPlugin.prototype.refreshRecorderOptions)
    @serialize()
        convergeMode = true

    @onChange(CanvasRecorderPlugin.prototype.refreshRecorderOptions)
    @serialize() mimeType: 'auto' | 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | string = 'video/mp4' // undefined = auto for video based on browser

    @onChange(CanvasRecorderPlugin.prototype.refreshRecorderOptions)
    @serialize()
        videoFrameRate = 30

    private _recorders: PartialRecord<'ffmpeg.js' | 'canvas-media' | 'image', ICanvasRecorder> = {}
    private _recorder?: ICanvasRecorder

    /** A recorder option changed while a recording runs: applied when it stops */
    private _optionsPending = false

    private _active?: {convergeMode: boolean, videoFrameRate: number}

    /**
     * The converge mode and the frame rate of the running recording, from its start until it stops. A change of
     * {@link convergeMode} or {@link videoFrameRate} during a recording applies to the next one, so the frames, the
     * animation steps ({@link ProgressivePlugin.postFrameConvergedRecordingDelta}) and the encoded frame rate match.
     */
    get recordingSettings(): {convergeMode: boolean, videoFrameRate: number} | undefined {
        return this._active
    }

    /** The converge mode of the running recording, else the setting */
    private get _convergeNow(): boolean {
        return (this._active ?? this).convergeMode
    }

    /** The recorder is starting, recording or stopping (an MP4 encodes while it stops) */
    private _recorderBusy() {
        const state = this._recorder?.state
        return state === 'starting' || state === 'recording' || state === 'stopping' || !!this._stopping
    }

    refreshRecorderOptions(): void {
        if (!this._viewer) return
        // the running recording keeps its recorder and options; a new format applies to the next recording
        if (this._recorderBusy()) {
            this._optionsPending = true
            return
        }
        this._optionsPending = false
        let recorderType: 'ffmpeg.js' | 'canvas-media' | 'image' = 'image'
        if (this.mimeType === 'video/mp4') {
            recorderType = 'ffmpeg.js'
        } else if (this.mimeType === 'auto') {
            recorderType = 'canvas-media'
        } else if (this.mimeType.startsWith('image')) {
            recorderType = 'image'
        }
        this._recorder = this._getRecorder(recorderType)
        if (!this._recorder) return
        this._recorder.setOptions({
            frameRate: this.videoFrameRate,
            mimeType: this.mimeType,
            stepMode: this.convergeMode,
            // @ts-expect-error todo type only for ffmpeg recorder
            internalMimeType: this.internalMimeType,
        })
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)

        // the render manager sets composer.renderToScreen before its own preRender event, so it is changed there
        viewer.renderManager.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.scene.addEventListener('addSceneObject', this._refreshUi)

        // add record indicator
        this._recordIndicator = document.createElement('div')
        this._recordIndicator.style.width = '20px'
        this._recordIndicator.style.height = '20px'
        this._recordIndicator.style.backgroundColor = 'red'
        this._recordIndicator.style.top = '10px'
        this._recordIndicator.style.left = '10px'
        this._recordIndicator.style.position = 'absolute'
        this._recordIndicator.style.borderRadius = '100%'
        this._recordIndicator.style.visibility = 'hidden'
        viewer.canvas.parentElement?.appendChild(this._recordIndicator)

        this.refreshRecorderOptions()
    }

    private _renderToScreenDisabled = false

    /** A capture of the last converged frame that waits for its timeout */
    private _pendingCapture?: () => void

    private _preRender = () => {
        // several frames can render in one animation loop (maxFramePerLoop): capture the last one before it is replaced
        this._pendingCapture?.()
        if (this._convergeNow && this._recorder?.isRecording()) {
            const composer = this._viewer!.renderManager.composer
            const k = composer.renderToScreen
            // without ProgressivePlugin there is nothing to converge: every frame is final
            const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
            composer.renderToScreen = progressive ? progressive.isConverged() : true
            if (k && !composer.renderToScreen) {
                this._renderToScreenDisabled = true // set back to true post render
            }
        }
    }

    private _postRender = () => {
        if (this._recorder?.isRecording()) {
            const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
            if (!this._convergeNow || !progressive) {
                // real time; or converge mode without ProgressivePlugin, where the animations run on the wall clock
                this._requestRealtimeFrames()
            } else if (progressive.isConverged(true)) {
                // once: at its timeout, or before the next render (_preRender), whichever comes first
                let done = false
                const fn = () => {
                    if (done) return
                    done = true
                    if (this._pendingCapture === fn) this._pendingCapture = undefined
                    this._recorder?.requestFrame()
                }
                // give some time to the browser to render the frame
                const waitTime = 1
                // this._viewer!.renderer.frameWaitTime = waitTime
                this._pendingCapture = fn
                timeout(waitTime).then(fn)
            }
        }
        if (this._renderToScreenDisabled) {
            this._viewer!.renderManager.composer.renderToScreen = true
        }
    }
    /** The time of the next frame of a real-time recording, in ms (0: the recording starts) */
    private _nextFrameTime = 0

    /**
     * Real time (not converge mode, or converge mode without ProgressivePlugin): the frames follow the frame rate of the recording, not the render rate. A render
     * that comes early captures no frame; one that comes late captures the frames it passed (the same image), so the
     * video keeps the speed of the animation. After a pause of more than a second, the time starts again.
     */
    private _requestRealtimeFrames() {
        const interval = 1000 / (this._active ?? this).videoFrameRate
        const now = performance.now()
        if (!this._nextFrameTime || now - this._nextFrameTime > 1000) this._nextFrameTime = now
        while (now >= this._nextFrameTime) {
            this._recorder?.requestFrame()
            this._nextFrameTime += interval
        }
    }

    private _refreshUi = () => {
        this.uiConfig.children?.map(value => getOrCall(value)).flat(2).forEach(v => v?.uiRefresh?.())
    }

    private _stateChange(d: boolean) {
        this.dirty = d
        this._viewer?.setDirty()
        this.uiConfig.children?.map(value => getOrCall(value)).flat(2).forEach(v => v?.uiRefresh?.())
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.renderManager.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.scene.removeEventListener('addSceneObject', this._refreshUi)
        this._recorder?.dispose()
        Object.values(this._recorders).forEach(r => {
            r?.dispose()
        })
        // a disposed recorder (an ended MP4 worker) is not used again: an add makes new ones
        this._recorders = {}
        this._recorder = undefined
        return super.onRemove(viewer)
    }

    async record(action: () => Promise<any>, onStart?: () => void): Promise<Blob | undefined> {
        if (!this.enabled) return
        if (this._recorder?.isRecording()) return

        const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
        const maxFrameCount = progressive?.maxFrameCount
        // the recording keeps this converge mode (recordingSettings): maxFrameCount is restored for it below
        const convergeMode = this.convergeMode
        if (progressive && convergeMode) {
            progressive.maxFrameCount = Math.min(16, maxFrameCount ?? 16)
        }

        try {
            await new Promise<void>((resolve, reject) => {
                const listener2 = () => {
                    this.removeEventListener('start', listenerStart)
                    this.removeEventListener('stop', listener2)
                    this.removeEventListener('error', listenerError)
                }
                const listenerStart = async() => {
                    listener2()
                    try {
                        onStart?.()
                        await action()
                        resolve()
                    } catch (e) {
                        reject(e)
                    }
                }
                const listenerError = async() => {
                    listener2()
                    reject()
                }
                this.addEventListener('start', listenerStart)
                this.addEventListener('stop', listener2)
                this.addEventListener('error', listenerError)
                if (!this.startRecording()) {
                    listener2()
                    reject(new Error('CanvasRecorderPlugin: the recording could not start'))
                }
            })
            return await this.stopRecording()
        } catch (e) {
            // the action failed: stop the recording (its result is dropped) and pass the error on
            if (this._recorder?.isRecording()) await this.stopRecording()
            throw e
        } finally {
            if (progressive && convergeMode) {
                progressive.maxFrameCount = maxFrameCount ?? 16
            }
        }
    }

    startRecording(): boolean {
        if (!this.enabled) return false
        // the last recording is not done yet (an MP4 encodes while it stops): its end would stop the new one
        if (this._recorderBusy()) return false
        if (this.recorder?.isRecording() === false) {
            this._active = {convergeMode: this.convergeMode, videoFrameRate: this.videoFrameRate}
            this._nextFrameTime = 0
            this.recorder.options.stepMode = this.convergeMode
            this.recorder.start()
            return true
        }
        return false
    }

    // @serialize()
    @uiSlider('End padding (MS)', [0, 1000], 1)
        endPaddingMs = 500

    private _stopping?: Promise<Blob | undefined>

    /**
     * Stops the recording and resolves with the recording (no blob for an image sequence). A second call while the
     * recording stops gets the same promise.
     */
    async stopRecording(): Promise<Blob | undefined> {
        if (this._stopping) return this._stopping
        if (!this.recorder?.isRecording() || !this._viewer) return undefined
        const stopping = this._stop()
        this._stopping = stopping
        try {
            return await stopping
        } finally {
            this._stopping = undefined
            this._active = undefined
            // a format change made during the recording
            if (this._optionsPending) this.refreshRecorderOptions()
        }
    }

    private async _stop(): Promise<Blob | undefined> {
        if (this._viewer) {
            await this._viewer.doOnce('postFrame')
            if (this._convergeNow) {
                const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
                if (progressive) {
                    // the last pose converges in maxFrameCount frames; the cap ends the wait in a scene that never converges
                    const max = progressive.maxFrameCount + 2
                    for (let i = 0; i < max; i++) {
                        if (progressive.isConverged(true)) break
                        await this._viewer.doOnce('postFrame')
                    }
                }
            }
            // the capture of the last converged frame waits for a timeout: take it before the recorder stops
            this._pendingCapture?.()
            if (this.endPaddingMs) await timeout(this.endPaddingMs)
            // the recorder failed (or stopped) during the waits above: its stop() would not call back
            const recorder = this.recorder
            if (!recorder || recorder.state === 'error' || recorder.state === 'stopped') return undefined
            return new Promise((resolve) => recorder.stop(resolve))
        }
        return undefined
    }

    private async _downloadBlob(blob: Blob, ext: string) {
        // the extension of the recorded format (webm for a MediaRecorder recording in Chrome)
        const fileName = 'recording.' + (ext || 'mp4')
        const name = await this._viewer?.dialog.prompt('Canvas Recorder: Save file as', fileName, false)
        const tr = this._viewer?.getPlugin<FileTransferPlugin>('FileTransferPlugin')
        if (!tr) {
            this._viewer?.console.error('FileTransferPlugin required to export/download file')
            return
        }
        await tr.exportFile(blob, name || fileName)
    }

    /**
     * Prompts for duration if not specified
     * @param duration
     * @param ccw
     * @param angle
     * @param ease
     * @param onStart
     */
    async download360Recording(duration: number | null = null, ccw = false, angle = 360, ease?: Easing, onStart?: () => void) {
        if (this.recorder?.isRecording()) return
        if (!this._viewer) return
        const duration1 = duration ? duration : await this._viewer.dialog.prompt('Enter duration in seconds', '5', true)
        if (duration1 === null) return
        const durationNum = parseFloat(duration1 || '5' as any)
        if (!isFinite(durationNum) || durationNum <= 0) return
        const b = await this.recordCamera360(durationNum, ccw, angle, ease, onStart)
        if (b) {
            const ext = b.type.split(';')[0].split('/').pop() || 'mp4'
            await this._downloadBlob(b, ext)
        }

    }

    private _turntableAnimationAngle = 360
    private _turntableAnimationDuration = 5
    private _turntableAnimationCCW = false
    private _turntableAnimationEasing: keyof typeof EasingFunctions = 'linear'

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Video Export',
        children: [
            {
                type: 'slider',
                label: 'Frame Rate',
                bounds: [1, 60],
                stepSize: 1,
                property: [this, 'videoFrameRate'],
            },
            {
                type: 'checkbox',
                property: [this, 'convergeMode'],
                onChange: () => this.uiConfig.uiRefresh?.(true, 'postFrame'),
            },
            {
                type: 'dropdown',
                label: 'Mime type',
                property: [this, 'mimeType'],
                children: ([
                    ['Auto Video (x264)', 'auto'],
                    ['PNG sequence', 'image/png'],
                    ['JPEG sequence', 'image/jpeg'],
                    ['WEBP sequence', 'image/webp'],
                    ['MP4 Video (ffmpeg)', 'video/mp4'],
                ] as [string, string][]).map(value => ({
                    label: value[0],
                    value: value[1],
                })),
            },
            {
                type: 'folder',
                label: 'FFmpeg Options (Advanced)',
                children: [() => generateUiConfig((this._recorder as FFMPEGRecorder | undefined)?.ffmpegOptions)],
            },
            {
                type: 'input',
                disabled: true,
                label: 'State',
                getValue: () => this.recorder?.state ?? 'not initialized',
            },
            {
                type: 'button',
                label: () => this.isRecording() ? 'Stop Recording' : 'Start Recording',
                hidden: () => !this.isRecording() && this.convergeMode,
                value: () => {
                    if (this.isRecording()) this.stopRecording().then(async b => {
                        if (b) {
                            const ext = b.type.split(';')[0].split('/').pop() || 'mp4'
                            await this._downloadBlob(b, ext)
                        }
                    })
                    else this.startRecording()
                },
            },
            {
                type: 'button',
                label: 'Record Camera Views',
                disabled: () => this.isRecording() || !this._viewer?.getPlugin<CameraViewPlugin>('CameraViews'),
                value: () => {
                    this._viewer?.getPlugin<CameraViewPlugin>('CameraViews')?.recordAllViews()
                },
            },
            {
                type: 'button',
                label: 'Record Camera Views + GLTF + VAnimation',
                disabled: () => this.isRecording() || !this._viewer?.getPlugin<CameraViewPlugin>('CameraViews'),
                value: () => {
                    const isPlaying = this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.animationState === 'playing'
                    this._viewer?.getPlugin<CameraViewPlugin>('CameraViews')?.recordAllViews(() => {
                        this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.playAnimation()
                        this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.animation.animate()
                    }).then(() => {
                        if (!isPlaying)
                            this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.stopAnimation()
                        this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.animation.stop()
                    })
                },
            },
            {
                type: 'button',
                label: 'Record GLTF Anim',
                disabled: () => this.isRecording() || !this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.animations.length,
                value: async() => {
                    if (this.isRecording()) return
                    const animPlugin = this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')
                    if (!animPlugin) return
                    let lastLoop = false
                    if (animPlugin.loopAnimations) lastLoop = true
                    if (lastLoop) animPlugin.loopAnimations = false
                    const b = await this.record(async() => animPlugin.playAnimation())
                    if (lastLoop) animPlugin.loopAnimations = true
                    if (b) {
                        // console.log(b)
                        const ext = b.type.split(';')[0].split('/').pop() || 'mp4'
                        await this._downloadBlob(b, ext)
                    }
                },
            },
            {
                type: 'number',
                label: 'Turntable animation angle',
                disabled: () => this.isRecording(),
                property: [this, '_turntableAnimationAngle'],
            },
            {
                type: 'number',
                label: 'Turntable animation time (sec)',
                disabled: () => this.isRecording(),
                property: [this, '_turntableAnimationDuration'],
            },
            {
                type: 'number',
                label: 'Turntable animation CCW',
                disabled: () => this.isRecording(),
                property: [this, '_turntableAnimationCCW'],
            },
            {
                type: 'dropdown',
                label: 'Turntable animation ease',
                children: Object.keys(EasingFunctions).map((label) => ({label})),
                disabled: () => this.isRecording(),
                property: [this, '_turntableAnimationEasing'],
            },
            {
                type: 'button',
                label: 'Record turntable animation',
                disabled: () => this.isRecording(),
                value: async() => this.download360Recording(
                    this._turntableAnimationDuration, this._turntableAnimationCCW,
                    this._turntableAnimationAngle, EasingFunctions[this._turntableAnimationEasing]),
            },
            {
                type: 'button',
                label: 'Record turntable + GLTF + VAnimation',
                disabled: () => this.isRecording(),
                value: () => {
                    const isPlaying = this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.animationState === 'playing'
                    this.download360Recording(
                        this._turntableAnimationDuration, this._turntableAnimationCCW,
                        this._turntableAnimationAngle, EasingFunctions[this._turntableAnimationEasing], () => {
                            this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.playAnimation()
                            this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.animation.animate()
                        }).then(() => {
                        if (!isPlaying)
                            this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.stopAnimation()
                        this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.animation.stop()
                    })
                },
            },
            {
                type: 'number',
                label: 'After recording wait time (ms)',
                disabled: () => this.isRecording(),
                property: [this, 'endPaddingMs'],
            },
        ],
    }

    async recordCamera360(durationNum: number, ccw = false, angle = 360, ease?: Easing, onStart?: () => void): Promise<Blob | undefined> {
        if (this.recorder?.isRecording()) return
        if (!this._viewer) return
        // before the camera is changed: without it nothing records, and the camera must stay usable
        const popmotion = this._viewer.getPlugin<PopmotionPlugin>('PopmotionPlugin')
        if (!popmotion) {
            console.error('Popmotion plugin not found')
            return
        }
        const camera = this._viewer.scene.mainCamera
        let interactions = camera.interactionsEnabled
        let i = 0
        while (!interactions) { // by camera view/animation plugin
            this._viewer.setDirty()
            await this._viewer.doOnce('postFrame')
            if (i % 30 === 0) this._viewer.console.warn('CanvasRecorderPlugin: interactions are already disabled by something, waiting...')
            interactions = camera.interactionsEnabled
            if (i > 5000 / 30) break // 5 seconds (if 30fps)
            i++
        }
        camera.setInteractions(false, CanvasRecorderPlugin.PluginType)
        const cameraTarget = camera.target.clone()
        const cameraPos = camera.position.clone().sub(cameraTarget)
        const current = new Spherical().setFromVector3(cameraPos)
        camera.position.setFromSpherical(current).add(cameraTarget)
        camera.setDirty()
        const lastAutoLookAt = camera.userData.autoLookAtTarget
        camera.userData.autoLookAtTarget = true
        const initial = current.theta
        try {
            return await this.record(async() => popmotion.animate({
                from: initial,
                to: initial + (ccw ? -1 : 1) * angle * Math.PI / 180,
                duration: durationNum * 1000,
                ease: ease ?? EasingFunctions.linear,
                onUpdate: (v: number) => {
                    current.theta = v
                    camera.position.setFromSpherical(current).add(cameraTarget)
                    camera.setDirty()
                },
                // the end pose stays while the recording stops (the last frames and the end padding); the camera goes
                // back in the finally below
            }).promise, onStart)
        } finally {
            // also when the recording failed: the camera goes back and can be used again
            camera.userData.autoLookAtTarget = lastAutoLookAt
            camera.position.copy(cameraPos).add(cameraTarget)
            camera.setDirty()
            camera.setInteractions(true, CanvasRecorderPlugin.PluginType)
        }
    }

    protected _getRecorder(type: 'ffmpeg.js' | 'canvas-media' | 'image') {
        if (!this._viewer) throw new Error('No viewer')
        if (this._recorders[type]) return this._recorders[type]
        let recorder: ICanvasRecorder
        if (type === 'canvas-media')
            recorder = new CanvasMediaRecorder(this._viewer.canvas, {
                frameRate: this.videoFrameRate,
                mimeType: this.mimeType,
            })
        else if (type === 'ffmpeg.js')
            recorder = new FFMPEGRecorder(this._viewer.canvas, {
                frameRate: this.videoFrameRate,
                mimeType: this.mimeType,
            })
        else
            recorder = new ImageSequenceRecorder(this._viewer.canvas, {
                frameRate: this.videoFrameRate,
                mimeType: this.mimeType,
            })

        // todo: do we need to remove below listeners?
        recorder.addEventListener('starting', () => this._stateChange(false))
        recorder.addEventListener('recording', () => {
            this._recordIndicator!.style.visibility = 'visible'
            this._recordIndicator!.style.backgroundColor = 'red'
            this.dispatchEvent({type: 'start'})
            this._stateChange(!this._convergeNow)
        })
        recorder.addEventListener('error', () => {
            this._active = undefined
            if (this._optionsPending) this.refreshRecorderOptions()
            this.dispatchEvent({type: 'error'})
        })
        recorder.addEventListener('paused', () => this._stateChange(false))
        // recorder.addEventListener("resume", () => this._stateChange(!this.convergeMode));
        recorder.addEventListener('stopped', () => {
            this._active = undefined
            if (this._optionsPending) this.refreshRecorderOptions()
            this._recordIndicator!.style.visibility = 'hidden'
            this.dispatchEvent({type: 'stop'})
            this._stateChange(false)
        })
        recorder.addEventListener('encode-progress', (e) => {
            this.dispatchEvent({...e} as any)
        })
        this._recorders[type] = recorder
        return recorder
    }

}
