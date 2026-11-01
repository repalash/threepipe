import {Spherical} from 'three'
import {getOrCall, onChange, PartialRecord, serialize, timeout} from 'ts-browser-helpers'
import {generateUiConfig, UiObjectConfig} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, type ThreeViewer} from '../../viewer'
import type {IConvergedCanvasRecorder, ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import type {CameraViewPlugin} from '../animation/CameraViewPlugin'
import type {GLTFAnimationPlugin} from '../animation/GLTFAnimationPlugin'
import type {AnimationResult, PopmotionPlugin} from '../animation/PopmotionPlugin'
import type {AnimationObjectPlugin} from '../animation/AnimationObjectPlugin'
import type {FileTransferPlugin} from './FileTransferPlugin'
import {type Easing, EasingFunctions} from '../../utils/animation'
import type {ICanvasRecorder} from '../../utils/canvas-recorder/ACanvasRecorder'
import {ImageSequenceRecorder} from '../../utils/canvas-recorder/ImageSequenceRecorder'
import {CanvasMediaRecorder} from '../../utils/canvas-recorder/CanvasMediaRecorder'
import {FFMPEGRecorder} from '../../utils/canvas-recorder/FFMPEGRecorder'
import {RemovalWaits} from '../../utils/canvas-recorder/RemovalWaits'

/** A listener of {@link CanvasRecorderPlugin} on one of its recorders: the event type and the listener */
type RecorderListener = [string, (e: any) => void]

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
    /** The listeners of the plugin on each recorder that it made ({@link _getRecorder}) */
    private _recorderListeners = new Map<ICanvasRecorder, RecorderListener[]>()
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

    /**
     * Whether the recorder can take a frame now. A browser recorder in converge mode records each frame for one frame
     * time: until then, no frame is requested and the animations do not step
     * ({@link ProgressivePlugin.postFrameConvergedRecordingDelta}), so each pose gets its own frame.
     */
    canRecordFrame(): boolean {
        // no frame renders (disabled, or rendering paused or failed): nothing to capture, so the animations wait too
        return this._rendering() && !this._recorder?.isBusy?.()
    }

    /**
     * The viewer renders frames: it is enabled ({@link ThreeViewer.enabled}, false also while the WebGL context is lost)
     * and rendering is not paused ({@link ThreeViewer.renderEnabled}, false also after a render error)
     */
    private _rendering(): boolean {
        const viewer = this._viewer
        return !!(viewer?.enabled && viewer.renderEnabled)
    }

    /** The ends of the waits for the action of a {@link record}, which end when rendering stops during the recording */
    private _renderingStopEnds = new Set<() => void>()

    /** Rendering stopped during this recording, and the warning was shown */
    private _renderingStopWarned = false

    /**
     * Rendering stopped during a recording: the viewer was disabled (no postFrame comes then), or a postFrame came with
     * rendering paused or failed. No frame is captured until it renders again, and a {@link record} stops waiting for
     * its action, which would not end (its animations step with the captured frames) or would record nothing.
     */
    private _renderingStopped = () => {
        if (!this._recorder?.isRecording()) return
        if (!this._renderingStopWarned) {
            this._renderingStopWarned = true
            this._viewer?.console.warn('CanvasRecorderPlugin: rendering stopped during the recording (the viewer is disabled, or rendering is paused or failed), no frames are recorded until it renders again')
        }
        const ends = [...this._renderingStopEnds]
        this._renderingStopEnds.clear()
        ends.forEach(end => end())
    }

    /**
     * Waits for the promise, or until rendering stops during the recording ({@link _renderingStopped}).
     * @returns true when rendering stopped first
     */
    private _untilRenderingStops(promise: Promise<unknown>): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            if (!this._rendering()) {
                resolve(true)
                return
            }
            const end = () => resolve(true)
            this._renderingStopEnds.add(end)
            promise.then(() => resolve(false), reject).then(() => this._renderingStopEnds.delete(end))
        })
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
        })
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)

        // the render manager sets composer.renderToScreen before its own preRender event, so it is changed there
        viewer.renderManager.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.addEventListener('postFrame', this._postFrame)
        viewer.addEventListener('viewerDisabled', this._renderingStopped)
        viewer.scene.addEventListener('addSceneObject', this._refreshUi)

        // add record indicator (onRemove takes it out of the page)
        this._recordIndicator = document.createElement('div')
        Object.assign(this._recordIndicator.style, {
            width: '20px',
            height: '20px',
            backgroundColor: 'red',
            top: '10px',
            left: '10px',
            position: 'absolute',
            borderRadius: '100%',
            visibility: 'hidden',
        })
        viewer.canvas.parentElement?.appendChild(this._recordIndicator)

        this.refreshRecorderOptions()
    }

    /** The capture of the frames that wait for their timeout ({@link _captureSoon}) */
    private _pendingCapture?: () => void
    /** The frames that the pending capture requests */
    private _pendingFrames = 0

    /**
     * Converge mode: captures the canvas after the listeners of this frame ran (they read {@link canRecordFrame}, which a
     * capture can change), at a timeout or before the next render (_preRender), whichever comes first.
     */
    private _captureSoon() {
        this._pendingFrames++
        if (this._pendingCapture) return
        const fn = () => {
            if (this._pendingCapture !== fn) return
            this._pendingCapture = undefined
            const frames = this._pendingFrames
            this._pendingFrames = 0
            for (let i = 0; i < frames; i++) this._recorder?.requestFrame()
        }
        this._pendingCapture = fn
        // give some time to the browser to render the frame
        timeout(1).then(fn)
    }

    private _preRender = () => {
        // several frames can render in one animation loop (maxFramePerLoop): capture the last one before it is replaced.
        // A capture of this frame (rendersPerFrame above 1) waits for its timeout: the next render has the same pose, and
        // the recorder must stay free until postFrame, so the animations still step for it.
        if (!this._capturedInFrame) this._pendingCapture?.()
        if (this._convergeNow && this._recorder?.isRecording()) {
            // without ProgressivePlugin there is nothing to converge: every frame is final. The render manager sets
            // renderToScreen back to true after the render.
            const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
            this._viewer!.renderManager.composer.renderToScreen = progressive ? progressive.isConverged() : true
        }
    }

    private _postRender = () => {
        this._rendered = true
        if (this._recorder?.isRecording()) {
            const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
            if (!this._convergeNow || !progressive) {
                // real time; or converge mode without ProgressivePlugin, where the animations run on the wall clock
                this._requestRealtimeFrames()
            } else if (!this._capturedInFrame && progressive.isConverged(true)) {
                // the browser recorder still records the last frame: a still loop (_postFrame) or the stop takes this one
                this._uncapturedRender = !this.canRecordFrame()
                if (!this._uncapturedRender) this._captureSoon()
                this._capturedInFrame = !this._uncapturedRender
            }
        }
    }
    /** The time of the next frame of a real-time recording, in ms (0: the recording starts) */
    private _nextFrameTime = 0

    /** A frame rendered in this animation loop */
    private _rendered = false

    /**
     * Converge mode: a render of this frame was captured. The animations step once per frame (postFrame), so the
     * other renders of the frame (viewer.rendersPerFrame above 1) capture nothing: each step has one frame.
     */
    private _capturedInFrame = false

    /** Converge mode: the last converged render came while the recorder still recorded a frame, and is not captured yet */
    private _uncapturedRender = false

    /**
     * Converge mode: in an animation loop without a render (the scene stays converged, e.g. a pause between camera
     * views or the end padding), the animations still step by one frame ({@link ProgressivePlugin.postFrameConvergedRecordingDelta}),
     * so the last frame is captured again: each step of the recording has one frame. A wait for a time in the video
     * uses {@link waitRecordingTime}. Without ProgressivePlugin, the animations run on the wall clock, and the frames
     * follow the frame rate of the recording.
     */
    private _postFrame = () => {
        const rendered = this._rendered
        this._rendered = false
        this._capturedInFrame = false
        // rendering is paused or failed (the loop still sends postFrame): no frame to capture
        if (!this._viewer?.renderEnabled) {
            this._renderingStopped()
            return
        }
        if (rendered || !this._convergeNow || !this._recorder?.isRecording()) return
        const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
        if (!progressive) {
            this._requestRealtimeFrames()
            return
        }
        // the animations stepped in this loop only if the recorder could take a frame (canRecordFrame)
        if (!progressive.isConverged(true) || !this.canRecordFrame()) return
        // after the other postFrame listeners, so the animations of this frame still step (a still scene: the same image)
        this._uncapturedRender = false
        this._captureSoon()
    }

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
        this._refreshUi()
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.renderManager.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.removeEventListener('postFrame', this._postFrame)
        viewer.removeEventListener('viewerDisabled', this._renderingStopped)
        viewer.scene.removeEventListener('addSceneObject', this._refreshUi)
        // no frame, animation or recorder event comes after a removal (or a viewer dispose): the waits end now
        this._removalWaits.endAll()
        // each recorder once (the current one is one of them, unless a subclass made it)
        new Set([this._recorder, ...Object.values(this._recorders)]).forEach(r => {
            if (!r) return
            r.dispose()
            // after the dispose, whose own events still come here: an event that the disposed recorder sends later
            // (e.g. the native stop of a MediaRecorder) does not reach a recording after an add again
            this._recorderListeners.get(r)?.forEach(([event, listener]) => r.removeEventListener(event, listener))
        })
        this._recorderListeners.clear()
        // a disposed recorder (an ended MP4 worker) is not used again: an add makes new ones
        this._recorders = {}
        this._recorder = undefined
        // the state of the recording and of the frames ends with the removal (also when the stopped event of the
        // recorder comes later), so a later add starts clean. The timeout of a deferred capture does nothing then.
        this._active = undefined
        this._optionsPending = false
        this._stopping = undefined
        this._pendingCapture = undefined
        this._pendingFrames = 0
        this._nextFrameTime = 0
        this._rendered = false
        this._capturedInFrame = false
        this._uncapturedRender = false
        this.dirty = false
        // an add makes a new indicator
        this._recordIndicator?.remove()
        this._recordIndicator = undefined
        return super.onRemove(viewer)
    }

    async record(action: () => Promise<any>, onStart?: () => void): Promise<Blob | undefined> {
        if (!this.enabled) return
        if (this._recorder?.isRecording()) return

        const removed = this._removalWaits.watch()
        const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
        const maxFrameCount = progressive?.maxFrameCount
        // the recording keeps this converge mode (recordingSettings): maxFrameCount is restored for it below, or at a
        // removal, before a recording of a later add reads it
        const convergeMode = this.convergeMode
        const restore = () => {
            this._removalWaits.delete(restore)
            if (progressive && convergeMode) progressive.maxFrameCount = maxFrameCount ?? 16
        }
        if (progressive && convergeMode) {
            progressive.maxFrameCount = Math.min(16, maxFrameCount ?? 16)
            this._removalWaits.add(restore)
        }

        try {
            await new Promise<void>((resolve, reject) => {
                const listener2 = () => {
                    this.removeEventListener('start', listenerStart)
                    this.removeEventListener('stop', listener2)
                    this.removeEventListener('error', listenerError)
                    this._removalWaits.delete(listenerError)
                }
                const listenerStart = async() => {
                    listener2()
                    try {
                        onStart?.()
                        // a removal (or a viewer dispose) ends the animation loop that the action can wait for: it
                        // ends the wait, and the stop below has no recording to stop. When rendering stops, the action
                        // would not end (its animations step with the captured frames): the recording stops then.
                        if (await this._removalWaits.race(this._untilRenderingStops(action())))
                            this._viewer?.console.warn('CanvasRecorderPlugin: the recording ends with the frames recorded before rendering stopped')
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
                // a removal (or a viewer dispose) before the start ends it as a start error: the action does not run
                this._removalWaits.add(listenerError)
                if (!this.startRecording()) {
                    listener2()
                    reject(new Error('CanvasRecorderPlugin: the recording could not start'))
                }
            })
            // removed: the removal ended the recording, and a recording of a later add is not this one
            if (removed()) return undefined
            return await this.stopRecording()
        } catch (e) {
            // the action failed: stop the recording (its result is dropped) and pass the error on
            if (!removed() && this._recorder?.isRecording()) await this.stopRecording()
            throw e
        } finally {
            if (!removed()) restore()
        }
    }

    startRecording(): boolean {
        if (!this.enabled) return false
        // the last recording is not done yet (an MP4 encodes while it stops): its end would stop the new one
        if (this._recorderBusy()) return false
        if (!this._rendering()) {
            this._viewer?.console.warn(`CanvasRecorderPlugin: ${this._viewer?.enabled === false ? 'the viewer is disabled' : 'rendering is paused (renderEnabled false)'}, nothing to record`)
            return false
        }
        if (this.recorder?.isRecording() === false) {
            this._active = {convergeMode: this.convergeMode, videoFrameRate: this.videoFrameRate}
            this._renderingStopWarned = false
            this._nextFrameTime = 0
            this._uncapturedRender = false
            this.recorder.options.stepMode = this.convergeMode
            this.recorder.start()
            return true
        }
        return false
    }

    // @serialize()
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
            // not after a removal, which ended this stop and its state: the state can be of a later add then
            if (this._stopping === stopping) {
                this._stopping = undefined
                this._active = undefined
                // a format change made during the recording
                if (this._optionsPending) this.refreshRecorderOptions()
            }
        }
    }

    /**
     * Waits for a time of the video: in a converge-mode recording, for the steps of the recording (one frame each, as
     * the animations step), so a pause has its length in the video; else for the wall time. A scene that does not
     * converge (no step in `maxFrameCount` frames, e.g. a plugin that stays dirty) waits the rest on the wall clock.
     * The frames in which a browser recorder still records a frame ({@link canRecordFrame}) do not count as such for
     * two frame times of the video. It ends early when the recording ends.
     * @param ms - the time in milliseconds
     */
    async waitRecordingTime(ms: number): Promise<void> {
        const viewer = this._viewer
        const progressive = viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
        if (!viewer || !progressive || !this._convergeNow || !this.isRecording()) {
            await timeout(ms)
            return
        }
        // no frame renders: the video gets no frames for this time
        if (!this._rendering()) return
        const fps = (this._active ?? this).videoFrameRate
        const steps = Math.round(ms / 1000 * fps)
        let n = 0
        let noStep = 0
        /** The wall time until which a busy browser recorder does not count as a frame without a step */
        let busyUntil = 0
        // a listener, not doOnce: with maxFramePerLoop above 1, several frames come in one animation loop
        await new Promise<void>(resolve => {
            const end = () => {
                viewer.removeEventListener('postFrame', step)
                viewer.removeEventListener('viewerDisabled', end)
                this._removalWaits.delete(end)
                resolve()
            }
            const step = () => {
                // rendering stopped (paused or failed): no frame comes for the steps that are left
                if (!this._rendering()) {
                    end()
                    return
                }
                if (progressive.postFrameConvergedRecordingDelta() > 0) {
                    n++
                    noStep = 0
                    busyUntil = 0
                } else if (!this.canRecordFrame()) {
                    // the browser recorder records a frame for a frame time of the video, which fast loops pass in more
                    // than maxFrameCount frames: the scene is converged
                    const t = performance.now()
                    if (!busyUntil) busyUntil = t + 2000 / fps
                    else if (t > busyUntil) noStep++
                } else {
                    busyUntil = 0
                    noStep++
                }
                if (n < steps && this.isRecording() && noStep <= progressive.maxFrameCount + 2) return
                end()
            }
            if (steps < 1) resolve()
            else {
                viewer.addEventListener('postFrame', step)
                // a disabled viewer sends no postFrame
                viewer.addEventListener('viewerDisabled', end)
                this._removalWaits.add(end)
            }
        })
        // the scene does not converge: the steps that are left, on the wall clock
        if (n < steps && this.isRecording() && this._rendering()) await timeout((steps - n) / fps * 1000)
    }

    /**
     * The waits of a recording that depend on frames, animations or recorder events (the start and the action of
     * {@link record}, the frame waits and the recorder stop of a stop, the turntable start); {@link onRemove} ends them
     */
    private _removalWaits = new RemovalWaits()

    /**
     * The next frame of the viewer, the viewer disabled ({@link ThreeViewer.enabled}: no frame comes then), or the removal
     * of the plugin (or a viewer dispose), whichever comes first
     */
    private async _nextFrame() {
        const viewer = this._viewer
        if (!viewer || !viewer.enabled) return
        let disabled!: () => void
        const disable = new Promise<void>(resolve => disabled = resolve)
        viewer.addEventListener('viewerDisabled', disabled)
        try {
            await this._removalWaits.race(Promise.race([viewer.doOnce('postFrame'), disable]))
        } finally {
            viewer.removeEventListener('viewerDisabled', disabled)
        }
    }

    private async _stop(): Promise<Blob | undefined> {
        if (this._viewer) {
            // a removal ends the stop: after it, the frame state and the recorder can be of a later add
            const removed = this._removalWaits.watch()
            await this._nextFrame()
            if (removed()) return undefined
            // no frame renders (the viewer is disabled, or rendering is paused or failed): no last pose to wait for
            if (this._convergeNow && this._rendering()) {
                const progressive = this._viewer?.getPlugin<ProgressivePlugin>('ProgressivePlugin')
                if (progressive) {
                    // the last pose converges in maxFrameCount frames; the cap ends the wait in a scene that never converges
                    const max = progressive.maxFrameCount + 2
                    for (let i = 0; i < max; i++) {
                        if (progressive.isConverged(true) || !this._rendering()) break
                        await this._nextFrame()
                        if (removed()) return undefined
                    }
                    // the last pose converged while the browser recorder still recorded a frame: a still loop takes it once
                    // the recorder is ready. The recorder ends its frame within a frame time of the video, which fast loops
                    // can pass in fewer than max loops.
                    const readyBy = performance.now() + 2000 / (this._active ?? this).videoFrameRate
                    for (let i = 0; this._uncapturedRender && this._rendering() && this._recorder?.isRecording() && (i < max || performance.now() < readyBy); i++) {
                        await this._nextFrame()
                        if (removed()) return undefined
                    }
                }
            }
            // the capture of the last converged frame waits for a timeout: take it before the recorder stops
            this._pendingCapture?.()
            if (this.endPaddingMs && this._rendering()) await this.waitRecordingTime(this.endPaddingMs)
            if (removed()) return undefined
            // the last frame of the padding waits for its capture too
            this._pendingCapture?.()
            // the recorder failed (or stopped) during the waits above: its stop() would not call back
            const recorder = this.recorder
            if (!recorder || recorder.state === 'error' || recorder.state === 'stopped') return undefined
            // a removal ends the wait for the recorder too: it disposes the recorder, and the recording is dropped
            return this._removalWaits.race(new Promise<Blob | undefined>((resolve) => recorder.stop(resolve)))
        }
        return undefined
    }

    private async _downloadBlob(blob: Blob, ext: string) {
        // the extension of the recorded format (webm for a MediaRecorder recording in Chrome)
        const fileName = 'recording.' + (ext || 'mp4')
        const name = await this._viewer?.dialog.prompt('Canvas Recorder: Save file as', fileName, false)
        // cancelled: no file (an empty name keeps the default name)
        if (name === null) return
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
                value: async() => {
                    const isPlaying = this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.animationState === 'playing'
                    // the animations stop also when the recording fails
                    await this._viewer?.getPlugin<CameraViewPlugin>('CameraViews')?.recordAllViews(() => {
                        this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.playAnimation()
                        this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.animation.animate()
                    }).finally(() => {
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
                    let b: Blob | undefined
                    try {
                        b = await this.record(async() => animPlugin.playAnimation())
                    } finally {
                        // also when the recording fails to start or the animation fails
                        if (lastLoop) animPlugin.loopAnimations = true
                    }
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
                value: async() => {
                    const isPlaying = this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.animationState === 'playing'
                    // the animations stop also when the recording fails
                    await this.download360Recording(
                        this._turntableAnimationDuration, this._turntableAnimationCCW,
                        this._turntableAnimationAngle, EasingFunctions[this._turntableAnimationEasing], () => {
                            this._viewer?.getPlugin<GLTFAnimationPlugin>('GLTFAnimation')?.playAnimation()
                            this._viewer?.getPlugin<AnimationObjectPlugin>('AnimationObjectPlugin')?.animation.animate()
                        }).finally(() => {
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
            this._viewer.console.error('CanvasRecorderPlugin: PopmotionPlugin required to record the turntable')
            return
        }
        const viewer = this._viewer
        const removed = this._removalWaits.watch()
        const camera = viewer.scene.mainCamera
        let interactions = camera.interactionsEnabled
        let i = 0
        while (!interactions) { // by camera view/animation plugin
            // no frame comes (the viewer is disabled): the record below does not start
            if (!this._viewer?.enabled) break
            viewer.setDirty()
            await this._nextFrame()
            // removed (or the viewer disposed) during the wait: the camera is not changed yet, and nothing records
            if (removed()) return
            if (i % 30 === 0) viewer.console.warn('CanvasRecorderPlugin: interactions are already disabled by something, waiting...')
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
        let turn: AnimationResult | undefined
        try {
            return await this.record(async() => (turn = popmotion.animate({
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
            })).promise, onStart)
        } finally {
            // a removal of the plugin ends the recording before the turn ends: the turn stops, so it does not move the
            // camera after it goes back
            turn?.stop()
            // also when the recording failed: the camera goes back and can be used again
            camera.userData.autoLookAtTarget = lastAutoLookAt
            camera.position.copy(cameraPos).add(cameraTarget)
            camera.setDirty()
            camera.setInteractions(true, CanvasRecorderPlugin.PluginType)
        }
    }

    /** A recorder event can come after a removal (a recording that a dispose stops): there is no indicator then */
    private _showIndicator(visible: boolean) {
        if (this._recordIndicator) this._recordIndicator.style.visibility = visible ? 'visible' : 'hidden'
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

        // onRemove detaches these listeners after it disposes the recorder
        const listeners: RecorderListener[] = [
            ['starting', () => this._stateChange(false)],
            ['recording', () => {
                this._showIndicator(true)
                this.dispatchEvent({type: 'start'})
                this._stateChange(!this._convergeNow)
            }],
            // an error ends the recording too: the indicator hides and the viewer stops rendering every frame for it
            ['error', () => {
                this._active = undefined
                if (this._optionsPending) this.refreshRecorderOptions()
                this._showIndicator(false)
                this.dispatchEvent({type: 'error'})
                this._stateChange(false)
            }],
            ['paused', () => this._stateChange(false)],
            // ['resume', () => this._stateChange(!this.convergeMode)],
            ['stopped', () => {
                this._active = undefined
                if (this._optionsPending) this.refreshRecorderOptions()
                this._showIndicator(false)
                this.dispatchEvent({type: 'stop'})
                this._stateChange(false)
            }],
            ['encode-progress', (e) => this.dispatchEvent({...e} as any)],
        ]
        listeners.forEach(([event, listener]) => recorder.addEventListener(event, listener))
        this._recorderListeners.set(recorder, listeners)
        this._recorders[type] = recorder
        return recorder
    }

}
