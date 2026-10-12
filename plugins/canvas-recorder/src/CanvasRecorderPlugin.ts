import {
    AViewerPluginEventMap,
    AViewerPluginSync,
    EasingFunctions,
    EasingFunctionType,
    now,
    onChange,
    ProgressivePlugin,
    serialize,
    Spherical,
    ThreeViewer,
    uiButton,
    uiDropdown,
    uiFolderContainer,
    uiInput,
    uiMonitor,
    uiNumber,
    uiSlider,
    uiToggle,
} from 'threepipe'
import {VideoCodecName} from './codecs'
import {IFrameRecorder} from './recorders/IFrameRecorder'
import {isWebCodecsSupported, WebCodecsVideoRecorder} from './recorders/WebCodecsVideoRecorder'
import {ImageSequenceFormat, ImageSequenceRecorder} from './recorders/ImageSequenceRecorder'
import {isMediaRecorderSupported, MediaStreamRecorder} from './recorders/MediaStreamRecorder'

/**
 * Recording mode of {@link CanvasRecorderPlugin}.
 * - `video` - frame-exact video with WebCodecs, in an MP4 file. Default.
 * - `images` - frame-exact image sequence (PNG, JPEG or WebP), in a zip file or a folder.
 * - `realtime` - real-time video with `MediaRecorder` over `canvas.captureStream()`. The fallback for browsers without WebCodecs.
 */
export type CanvasRecorderMode = 'video' | 'images' | 'realtime'

/**
 * State of {@link CanvasRecorderPlugin}.
 */
export type CanvasRecorderState = 'idle' | 'starting' | 'recording' | 'stopping'

/**
 * Argument of {@link CanvasRecordOptions.onFrame}.
 */
export interface CanvasRecorderFrameEvent {
    /**
     * Index of the frame that is rendered next, starting at 0.
     */
    frame: number
    /**
     * Time of the frame in seconds from the start of the recording (`frame / fps` in the frame-exact modes).
     */
    time: number
    /**
     * Total number of frames, when the recording has a fixed length.
     */
    frames?: number
}

/**
 * Options for {@link CanvasRecorderPlugin.startRecording} and the other record functions.
 * Options that are not set use the values of the plugin properties (like {@link CanvasRecorderPlugin.mode}, {@link CanvasRecorderPlugin.frameRate}).
 */
export interface CanvasRecordOptions {
    /**
     * Recording mode. See {@link CanvasRecorderMode}.
     */
    mode?: CanvasRecorderMode
    /**
     * Frames per second of the result. In the frame-exact modes, the scene time advances by exactly `1 / fps` for each captured frame.
     */
    fps?: number

    /**
     * Video codec family for the `video` mode. `auto` uses the first one the browser can encode, in the order H.264, VP9, AV1.
     */
    videoCodec?: 'auto' | VideoCodecName
    /**
     * Full WebCodecs codec string for the `video` mode, like `avc1.640033`. Overrides {@link videoCodec}.
     */
    codecString?: string
    /**
     * Video bitrate in bits per second for the `video` and `realtime` modes. `0` uses a default from the frame size and the frame rate.
     */
    bitrate?: number
    /**
     * Seconds between key frames in the `video` mode.
     * @default 2
     */
    keyFrameInterval?: number
    /**
     * Hardware acceleration preference for the `video` mode.
     * @default 'prefer-hardware'
     */
    hardwareAcceleration?: HardwareAcceleration

    /**
     * Image format for the `images` mode.
     */
    imageFormat?: ImageSequenceFormat
    /**
     * Image quality (0-1) for JPEG and WebP in the `images` mode.
     */
    imageQuality?: number
    /**
     * Where to save the frames in the `images` mode: a zip download, or a folder (File System Access API).
     */
    imageDestination?: 'zip' | 'directory'
    /**
     * Folder for `imageDestination: 'directory'`. When not set, {@link CanvasRecorderPlugin.directory} is used,
     * or the folder picker opens (this needs a user gesture, like a click).
     */
    directory?: FileSystemDirectoryHandle

    /**
     * Converge every frame with progressive rendering (`ProgressivePlugin`) before it is captured. Frame-exact modes only.
     * See {@link CanvasRecorderPlugin.convergeMode}.
     */
    converge?: boolean
    /**
     * Number of progressive frames to accumulate for each captured frame when {@link converge} is true.
     */
    convergeFrames?: number
    /**
     * Start `viewer.timeline` when the recording starts (and stop it at the end) if it is not running.
     */
    startTimeline?: boolean

    /**
     * Stop automatically after this many frames.
     */
    frames?: number
    /**
     * Stop automatically after this duration in seconds. In the frame-exact modes it is converted to `Math.round(duration * fps)` frames.
     */
    duration?: number
    /**
     * Called before each captured frame is rendered (in the viewer `preFrame` event), to update the scene for that frame.
     * With convergence, it is called once for each captured frame, not for every progressive frame.
     */
    onFrame?: (e: CanvasRecorderFrameEvent) => void

    /**
     * Download the result when the recording stops. Uses `viewer.exportBlob`.
     */
    download?: boolean
    /**
     * File name of the download without the extension.
     */
    filename?: string
    /**
     * When WebCodecs video encoding is not available, record in the `realtime` mode instead of failing.
     * @default true
     */
    fallbackToRealtime?: boolean
    /**
     * In the frame-exact modes, the viewer pauses when more than this many frames wait for encoding, until half of them are encoded.
     * @default 8
     */
    maxPendingFrames?: number
}

export interface CanvasRecorderPluginEventMap extends AViewerPluginEventMap {
    /**
     * The recording started.
     */
    start: {mode: CanvasRecorderMode, fps: number, width: number, height: number, codec?: string}
    /**
     * A frame was captured. In the `realtime` mode, sent for every rendered frame.
     */
    progress: {frame: number, frames?: number, time: number, progress?: number}
    /**
     * The recording stopped. `blob` is the result, it is undefined when cancelled or when the frames are written into a folder.
     */
    stop: {blob?: Blob, cancelled: boolean, frames: number, mode: CanvasRecorderMode}
    /**
     * The recording failed.
     */
    error: {error: unknown}
}

interface RecordingSession {
    mode: CanvasRecorderMode
    fps: number
    frame: number
    frames?: number
    duration?: number
    startTime: number
    options: CanvasRecordOptions
    recorder?: IFrameRecorder
    realtime?: MediaStreamRecorder
    progressive?: ProgressivePlugin
    lastMaxFrameCount?: number
    stopTimeline: boolean
    pausedViewer: boolean
    maxPending: number
    filename: string
    download: boolean
    done: Promise<Blob | undefined>
    resolve: (b?: Blob) => void
    reject: (e: unknown) => void
}

/**
 * Canvas Recorder Plugin
 *
 * Records the viewer canvas into a video file or an image sequence.
 *
 * - `video` mode (default): frame-exact video with WebCodecs. The scene time advances by exactly `1 / fps` for every captured frame
 * (through `viewer.timeline.recordingDeltaProvider`), so the video is smooth at the set frame rate, independent of how long a frame takes to render or encode.
 * Each frame is captured right after it is rendered, encoded with `VideoEncoder` (H.264 by default, VP9 or AV1 when H.264 is not available) and muxed into an MP4 file in the browser.
 * - `images` mode: the same frame-exact capture, saved as PNG, JPEG or WebP frames in a zip file or a folder.
 * - `realtime` mode: `MediaRecorder` over `canvas.captureStream()`, the fallback for browsers without WebCodecs. It records in real time and drops frames when the render is slow.
 *
 * In the frame-exact modes, these follow the fixed time step: `viewer.timeline` and the animations driven by it when it runs (like `AnimationObjectPlugin`),
 * `PopmotionPlugin` animations (like `CameraViewPlugin` camera animations), `GLTFAnimationPlugin` and the camera controls.
 * Code that reads the wall clock directly (`performance.now()`, `Date.now()`, CSS animations, video elements) does not.
 *
 * Optional convergence ({@link convergeMode}, off by default) accumulates progressive frames before each captured frame.
 * Converged frames hide temporal artifacts (noise, flicker, ghosting of temporal effects): use it for turntables and product shots of static scenes,
 * not to show the real-time motion quality of the renderer.
 *
 * @example
 * ```ts
 * const recorder = viewer.addPluginSync(CanvasRecorderPlugin)
 * // 5 seconds at 60 fps, downloaded as recording.mp4
 * const blob = await recorder.recordDuration(5, {fps: 60})
 * // camera turntable
 * await recorder.recordTurntable({duration: 6, angle: 360})
 * ```
 * @category Plugins
 */
@uiFolderContainer('Canvas Recorder')
export class CanvasRecorderPlugin extends AViewerPluginSync<CanvasRecorderPluginEventMap> {
    public static readonly PluginType = 'CanvasRecorderPlugin'
    enabled = true
    dependencies = []

    /**
     * Recording mode, see {@link CanvasRecorderMode}.
     */
    @uiDropdown('Mode', [
        {label: 'Video (frame-exact)', value: 'video'},
        {label: 'Image sequence', value: 'images'},
        {label: 'Real-time video', value: 'realtime'},
    ])
    @onChange(CanvasRecorderPlugin.prototype.refreshUi)
    @serialize() mode: CanvasRecorderMode = 'video'

    /**
     * Frames per second of the result.
     */
    @uiSlider('Frame rate', [1, 120], 1)
    @serialize() frameRate = 60

    /**
     * Video codec family in the `video` mode. `auto` uses H.264 when available, then VP9, then AV1.
     */
    @uiDropdown<CanvasRecorderPlugin>('Video codec', ['auto', 'avc', 'vp9', 'av1'].map(value => ({label: value, value})), (that) => ({
        hidden: () => that.mode !== 'video',
    }))
    @serialize() videoCodec: 'auto' | VideoCodecName = 'auto'

    /**
     * Video bitrate in Mbit/s in the `video` and `realtime` modes. `0` uses a default from the frame size and the frame rate (about 15 Mbit/s for 1080p at 60 fps).
     */
    @uiNumber<CanvasRecorderPlugin>('Bitrate (Mbps, 0 = auto)', (that) => ({
        hidden: () => that.mode === 'images',
    }))
    @serialize() videoBitrate = 0

    /**
     * Image format in the `images` mode.
     */
    @uiDropdown<CanvasRecorderPlugin>('Image format', [
        {label: 'PNG', value: 'image/png'},
        {label: 'JPEG', value: 'image/jpeg'},
        {label: 'WebP', value: 'image/webp'},
    ], (that) => ({
        hidden: () => that.mode !== 'images',
    }))
    @onChange(CanvasRecorderPlugin.prototype.refreshUi)
    @serialize() imageFormat: ImageSequenceFormat = 'image/png'

    /**
     * Image quality (0-1) for JPEG and WebP in the `images` mode.
     */
    @uiSlider<CanvasRecorderPlugin>('Image quality', [0, 1], 0.01, (that) => ({
        hidden: () => that.mode !== 'images' || that.imageFormat === 'image/png',
    }))
    @serialize() imageQuality = 0.95

    /**
     * Where to save the frames in the `images` mode. `directory` uses the File System Access API (Chrome, Edge), see {@link pickDirectory}.
     */
    @uiDropdown<CanvasRecorderPlugin>('Save frames to', [
        {label: 'Zip file', value: 'zip'},
        {label: 'Folder', value: 'directory'},
    ], (that) => ({
        hidden: () => that.mode !== 'images',
    }))
    @onChange(CanvasRecorderPlugin.prototype.refreshUi)
    @serialize() imageDestination: 'zip' | 'directory' = 'zip'

    /**
     * Folder for the image sequence when {@link imageDestination} is `directory`. Set with {@link pickDirectory}.
     */
    directory?: FileSystemDirectoryHandle

    /**
     * Converge every captured frame with progressive rendering. Off by default. Frame-exact modes only, needs `ProgressivePlugin`.
     *
     * Before each captured frame, the scene time is held until {@link convergeFrames} progressive frames are accumulated.
     * Converged frames hide temporal artifacts, like noise, flicker and the ghosting of temporal effects.
     * This is right for turntables and product shots of static scenes. It is wrong for showing the real-time motion quality of the renderer.
     */
    @uiToggle<CanvasRecorderPlugin>('Converge each frame', (that) => ({
        hidden: () => that.mode === 'realtime',
    }))
    @onChange(CanvasRecorderPlugin.prototype.refreshUi)
    @serialize() convergeMode = false

    /**
     * Number of progressive frames for each captured frame, when {@link convergeMode} is on.
     * It sets `ProgressivePlugin.maxFrameCount` while recording.
     */
    @uiSlider<CanvasRecorderPlugin>('Converge frames', [2, 256], 1, (that) => ({
        hidden: () => that.mode === 'realtime' || !that.convergeMode,
    }))
    @serialize() convergeFrames = 32

    /**
     * Start `viewer.timeline` when the recording starts (and stop it at the end) if it is not running.
     * Timeline driven animations (like `AnimationObjectPlugin`, camera views on the timeline) only advance while the timeline runs.
     */
    @uiToggle('Start timeline')
    @serialize() startTimeline = false

    /**
     * Download the result when the recording stops.
     */
    @uiToggle('Auto download')
    @serialize() autoDownload = true

    /**
     * File name of the download, without the extension.
     */
    @uiInput('File name')
    @serialize() filename = 'recording'

    /**
     * Duration in seconds for {@link recordDuration} and {@link recordTurntable} from the UI.
     */
    @uiNumber('Duration (s)')
    @serialize() duration = 5

    /**
     * Rotation angle in degrees for {@link recordTurntable} from the UI.
     */
    @uiNumber('Turntable angle')
    @serialize() turntableAngle = 360

    /**
     * Rotate the camera counter-clockwise (seen from above) in {@link recordTurntable} from the UI.
     */
    @uiToggle('Turntable counter-clockwise')
    @serialize() turntableCcw = false

    /**
     * Easing of the turntable rotation from the UI.
     */
    @uiDropdown('Turntable easing', Object.keys(EasingFunctions).map(label => ({label})))
    @serialize() turntableEase: EasingFunctionType = 'linear'

    private _state: CanvasRecorderState = 'idle'
    private _session?: RecordingSession
    private _needsFrameCallback = false

    /**
     * Current state.
     */
    get state(): CanvasRecorderState {
        return this._state
    }

    /**
     * Number of frames captured in the current recording.
     */
    get recordedFrames(): number {
        return this._session?.frame ?? 0
    }

    /**
     * State and progress as text, like `recording 12 / 120`.
     */
    @uiMonitor('Status')
    get status(): string {
        const s = this._session
        if (!s || this._state === 'starting') return this._state
        return this._state + ' ' + s.frame + (s.frames !== undefined ? ' / ' + s.frames : '') + ' frames'
    }

    /**
     * True while a recording is starting, running or stopping.
     */
    isRecording() {
        return this._state !== 'idle'
    }

    constructor() {
        super()
        this.toggleRecording = this.toggleRecording.bind(this)
        this.refreshUi = this.refreshUi.bind(this)
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.addEventListener('postFrame', this._postFrame)
    }

    onRemove(viewer: ThreeViewer): void {
        if (this._session) this._finish(true)
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.removeEventListener('postFrame', this._postFrame)
        super.onRemove(viewer)
    }

    /**
     * Checks if the browser can record frame-exact video with WebCodecs (`VideoEncoder` and `VideoFrame`, secure context only).
     * Use {@link findVideoEncoderConfig} to check a codec and a size.
     */
    static IsWebCodecsSupported() {
        return isWebCodecsSupported()
    }

    /**
     * Checks if the browser can record in the `realtime` mode (`MediaRecorder` and `canvas.captureStream`).
     */
    static IsMediaRecorderSupported() {
        return isMediaRecorderSupported()
    }

    /**
     * Opens the folder picker of the File System Access API and sets {@link directory}.
     * Must be called from a user gesture, like a click.
     * @returns the folder, or undefined when the picker is not supported or was cancelled
     */
    @uiButton<CanvasRecorderPlugin>('Choose folder', (that) => ({
        hidden: () => that.mode !== 'images' || that.imageDestination !== 'directory',
        sendArgs: false,
    }))
    async pickDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
        const picker = (window as unknown as {showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle>}).showDirectoryPicker
        if (typeof picker !== 'function') {
            this._viewer?.console.warn('CanvasRecorderPlugin: the File System Access API (showDirectoryPicker) is not supported in this browser')
            return undefined
        }
        try {
            this.directory = await picker.call(window, {mode: 'readwrite', id: 'threepipe-canvas-recorder'})
        } catch (e) {
            if ((e as Error)?.name !== 'AbortError') this._viewer?.console.error('CanvasRecorderPlugin: unable to open the folder', e)
            return undefined
        }
        this.refreshUi()
        return this.directory
    }

    /**
     * Start a recording. It runs until {@link stopRecording} or {@link cancelRecording} is called, or until `options.frames` or `options.duration` is reached.
     * Throws when the recording cannot start (like when a recording is running, or no encoder is available).
     * @param options - options, unset values use the plugin properties
     */
    async startRecording(options: CanvasRecordOptions = {}): Promise<void> {
        await this._start(options)
    }

    private async _start(options: CanvasRecordOptions): Promise<RecordingSession> {
        const viewer = this._viewer
        if (!viewer) throw new Error('CanvasRecorderPlugin: not added to a viewer')
        if (this.isDisabled()) throw new Error('CanvasRecorderPlugin: plugin is disabled')
        if (this._state !== 'idle') throw new Error('CanvasRecorderPlugin: a recording is already running')
        this._state = 'starting'
        this.refreshUi()

        const fps = Math.max(1, options.fps ?? this.frameRate)
        let mode = options.mode ?? this.mode
        const bitrateMbps = this.videoBitrate > 0 ? this.videoBitrate : 0
        const bitrate = options.bitrate ?? bitrateMbps * 1e6
        let resolve!: (b?: Blob) => void
        let reject!: (e: unknown) => void
        const done = new Promise<Blob | undefined>((res, rej) => {
            resolve = res
            reject = rej
        })
        done.catch(() => undefined) // the error is also sent in the error event, avoids an unhandled rejection when nobody awaits it
        const session: RecordingSession = {
            mode, fps,
            frame: 0,
            startTime: 0,
            options,
            stopTimeline: false,
            pausedViewer: false,
            maxPending: Math.max(1, options.maxPendingFrames ?? 8),
            filename: options.filename ?? this.filename,
            download: options.download ?? this.autoDownload,
            done, resolve, reject,
        }

        const canvas = viewer.canvas
        const width = canvas.width
        const height = canvas.height
        try {
            if (mode === 'images') {
                const destination = options.imageDestination ?? this.imageDestination
                let directory: FileSystemDirectoryHandle | undefined
                if (destination === 'directory') {
                    // pick the folder first, the picker needs the user gesture
                    directory = options.directory ?? this.directory ?? await this.pickDirectory()
                    if (!directory) viewer.console.warn('CanvasRecorderPlugin: no folder selected, saving the frames into a zip file')
                }
                session.recorder = new ImageSequenceRecorder({
                    format: options.imageFormat ?? this.imageFormat,
                    quality: options.imageQuality ?? this.imageQuality,
                    directory,
                })
            } else if (mode === 'video') {
                session.recorder = new WebCodecsVideoRecorder({
                    codec: options.videoCodec ?? this.videoCodec,
                    codecString: options.codecString,
                    bitrate,
                    keyFrameInterval: options.keyFrameInterval,
                    hardwareAcceleration: options.hardwareAcceleration,
                })
            }

            if (session.recorder) {
                try {
                    await session.recorder.start({width, height, fps})
                } catch (e) {
                    const fallback = options.fallbackToRealtime ?? true
                    if (mode !== 'video' || !fallback || !isMediaRecorderSupported()) throw e
                    viewer.console.warn('CanvasRecorderPlugin: WebCodecs video encoding is not available, recording in real time with MediaRecorder.', e)
                    session.recorder = undefined
                    mode = 'realtime'
                    session.mode = mode
                }
            }

            if (mode === 'realtime') {
                session.realtime = new MediaStreamRecorder(canvas, {fps, bitrate})
                session.realtime.start()
                session.duration = options.duration ?? (options.frames !== undefined ? options.frames / fps : undefined)
                if (options.converge ?? this.convergeMode) viewer.console.warn('CanvasRecorderPlugin: convergence is not supported in the realtime mode')
            } else {
                session.frames = options.frames ?? (options.duration !== undefined ? Math.max(1, Math.round(options.duration * fps)) : undefined)
                if (options.converge ?? this.convergeMode) {
                    const progressive = viewer.getPlugin(ProgressivePlugin)
                    if (!progressive) {
                        viewer.console.warn('CanvasRecorderPlugin: ProgressivePlugin is required to converge frames, recording without convergence')
                    } else {
                        session.progressive = progressive
                        session.lastMaxFrameCount = progressive.maxFrameCount
                        progressive.maxFrameCount = Math.max(2, options.convergeFrames ?? this.convergeFrames)
                    }
                }
                if (typeof viewer.timeline.recordingDelta !== 'function') {
                    viewer.console.warn('CanvasRecorderPlugin: this threepipe version has no viewer.timeline.recordingDeltaProvider (added in 0.6.0), the frames are captured but the scene time follows the wall clock')
                }
                viewer.timeline.recordingDeltaProvider = this._recordingDelta
            }
        } catch (e) {
            session.recorder?.cancel()
            session.realtime?.cancel()
            this._state = 'idle'
            this.refreshUi()
            this.dispatchEvent({type: 'error', error: e})
            throw e
        }

        if ((options.startTimeline ?? this.startTimeline) && !viewer.timeline.running) {
            viewer.timeline.start()
            session.stopTimeline = true
        }
        // FrameFadePlugin blends frames over wall clock time, disable it while recording
        viewer.getPlugin<AViewerPluginSync>('FrameFadePlugin')?.disable(this)

        session.startTime = now()
        this._session = session
        this._needsFrameCallback = true
        this._state = 'recording'
        viewer.setDirty()
        this.refreshUi()
        this.dispatchEvent({
            type: 'start', mode, fps, width, height,
            codec: session.recorder instanceof WebCodecsVideoRecorder ? session.recorder.codecString : session.realtime?.mimeType,
        })
        return session
    }

    /**
     * Stop the recording and return the result. Downloads the result when `download` (or {@link autoDownload}) is set.
     * @returns the video or zip file, or undefined when nothing was recorded or the frames were written into a folder
     */
    async stopRecording(): Promise<Blob | undefined> {
        const session = this._session
        if (!session) return undefined
        if (this._state === 'recording') this._finish(false)
        return session.done
    }

    /**
     * Stop the recording and discard the result.
     */
    async cancelRecording(): Promise<void> {
        const session = this._session
        if (!session) return
        if (this._state === 'recording') this._finish(true)
        await session.done.catch(() => undefined)
    }

    /**
     * Record while an action runs. The recording starts, then `action` is called and awaited.
     * After it resolves, one more frame is captured (so the end state of an animation is in the result) and the recording stops.
     * @example
     * ```ts
     * const popmotion = viewer.getPlugin(PopmotionPlugin)!
     * const blob = await recorder.record(() => popmotion.animate({from: 0, to: 1, duration: 2000, onUpdate: v => {...}}).promise)
     * ```
     * @param action - function to run while recording, like starting an animation and returning its promise
     * @param options - recording options
     */
    async record(action: (recorder: this) => unknown, options: CanvasRecordOptions = {}): Promise<Blob | undefined> {
        const session = await this._start(options)
        try {
            await action(this)
        } catch (e) {
            await this.cancelRecording()
            throw e
        }
        if (this._session === session && this._state === 'recording') {
            if (session.realtime) this._finish(false)
            else session.frames = Math.min(session.frames ?? Infinity, session.frame + 1)
        }
        return session.done
    }

    /**
     * Record a fixed duration. In the frame-exact modes, this is exactly `Math.round(duration * fps)` frames.
     * @example
     * ```ts
     * // rotate an object, frame by frame
     * await recorder.recordDuration(4, {fps: 30, onFrame: ({time}) => {
     *     object.rotation.y = time * Math.PI / 2
     *     object.setDirty()
     * }})
     * ```
     * @param duration - duration in seconds
     * @param options - recording options, use `onFrame` to update the scene for each frame
     */
    async recordDuration(duration: number, options: CanvasRecordOptions = {}): Promise<Blob | undefined> {
        if (!(duration > 0)) throw new Error('CanvasRecorderPlugin: duration must be greater than 0')
        const session = await this._start({...options, duration, frames: undefined})
        return session.done
    }

    /**
     * Record a camera turntable: the main camera orbits around its target by `angle` degrees in `duration` seconds.
     * For a full turn (a multiple of 360 degrees) the last frame is one step before the first one, so the video loops without a repeated frame.
     * The camera position and interactions are restored at the end.
     * @param options - turntable options and recording options. Defaults from the plugin properties ({@link duration}, {@link turntableAngle}, {@link turntableCcw}, {@link turntableEase}).
     */
    async recordTurntable(options: CanvasRecordOptions & {
        /**
         * Duration in seconds.
         */
        duration?: number,
        /**
         * Rotation angle in degrees.
         */
        angle?: number,
        /**
         * Rotate counter-clockwise, seen from above.
         */
        ccw?: boolean,
        /**
         * Easing function name, see `EasingFunctions` in threepipe.
         */
        ease?: EasingFunctionType
    } = {}): Promise<Blob | undefined> {
        const viewer = this._viewer
        if (!viewer) throw new Error('CanvasRecorderPlugin: not added to a viewer')
        const {angle = this.turntableAngle, ccw = this.turntableCcw, ease = this.turntableEase, ...recordOptions} = options
        const duration = options.duration ?? this.duration
        const camera = viewer.scene.mainCamera
        const target = camera.target.clone()
        const position = camera.position.clone()
        const spherical = new Spherical().setFromVector3(position.clone().sub(target))
        const startTheta = spherical.theta
        const angleRad = (ccw ? 1 : -1) * angle * Math.PI / 180
        const easing = EasingFunctions[ease] ?? EasingFunctions.linear
        const fullTurn = Math.abs(angle) > 0 && Math.abs(angle) % 360 === 0
        const lastAutoLookAt = camera.userData.autoLookAtTarget
        let started = false
        try {
            return await this.recordDuration(duration, {
                ...recordOptions,
                onFrame: (e) => {
                    if (!started) {
                        started = true
                        camera.setInteractions(false, CanvasRecorderPlugin.PluginType)
                        camera.userData.autoLookAtTarget = true
                    }
                    // frame-exact: from the frame index. realtime: from the wall clock time
                    const frames = e.frames
                    const t = frames === undefined ? e.time / duration :
                        fullTurn ? e.frame / frames : frames > 1 ? e.frame / (frames - 1) : 1
                    spherical.theta = startTheta + angleRad * easing(Math.min(1, t))
                    camera.position.setFromSpherical(spherical).add(target)
                    camera.setDirty()
                    recordOptions.onFrame?.(e)
                },
            })
        } finally {
            if (started) {
                camera.position.copy(position)
                camera.target.copy(target)
                camera.userData.autoLookAtTarget = lastAutoLookAt
                camera.setDirty()
                camera.setInteractions(true, CanvasRecorderPlugin.PluginType)
            }
        }
    }

    /**
     * Start or stop a recording with the plugin settings. Used by the UI button.
     */
    @uiButton<CanvasRecorderPlugin>('Start/Stop', (that) => ({
        label: () => that.isRecording() ? 'Stop recording' : 'Start recording',
        sendArgs: false,
    }))
    async toggleRecording(): Promise<void> {
        try {
            if (this.isRecording()) await this.stopRecording()
            else await this.startRecording()
        } catch (e) {
            this._viewer?.console.error('CanvasRecorderPlugin:', e)
        }
    }

    @uiButton<CanvasRecorderPlugin>('Cancel recording', (that) => ({
        disabled: () => !that.isRecording(),
        sendArgs: false,
    }))
    protected async _cancelClick(): Promise<void> {
        return this.cancelRecording()
    }

    @uiButton<CanvasRecorderPlugin>('Record duration', (that) => ({
        disabled: () => that.isRecording(),
        sendArgs: false,
    }))
    protected async _recordDurationClick(): Promise<void> {
        await this.recordDuration(this.duration).catch(e => this._viewer?.console.error('CanvasRecorderPlugin:', e))
    }

    @uiButton<CanvasRecorderPlugin>('Record turntable', (that) => ({
        disabled: () => that.isRecording(),
        sendArgs: false,
    }))
    protected async _recordTurntableClick(): Promise<void> {
        await this.recordTurntable().catch(e => this._viewer?.console.error('CanvasRecorderPlugin:', e))
    }

    /**
     * Refresh the UI, like after changing a property from code.
     */
    refreshUi() {
        this.uiConfig?.uiRefresh?.(true, 'postFrame')
    }

    /**
     * The time step for `viewer.timeline.recordingDeltaProvider`: `1 / fps` for a frame that is captured, `0` while a frame converges, `-1` when not recording frame-exact.
     */
    private _recordingDelta = (): number => {
        const s = this._session
        if (this._state !== 'recording' || !s || !s.recorder) return -1
        return this._isCaptureFrame(s) ? 1 / s.fps : 0
    }

    private _isCaptureFrame(s: RecordingSession) {
        return !s.progressive || s.progressive.isConverged(true)
    }

    private _preFrame = () => {
        const s = this._session
        if (this._state !== 'recording' || !s) return
        if (s.realtime) {
            const time = (now() - s.startTime) / 1000
            s.options.onFrame?.({frame: s.frame, time, frames: s.frames})
            return
        }
        if (!this._needsFrameCallback) return
        this._needsFrameCallback = false
        s.options.onFrame?.({frame: s.frame, time: s.frame / s.fps, frames: s.frames})
    }

    private _postFrame = () => {
        const s = this._session
        const viewer = this._viewer
        if (this._state !== 'recording' || !s || !viewer) return
        if (s.realtime) {
            s.frame++
            const time = (now() - s.startTime) / 1000
            this.dispatchEvent({type: 'progress', frame: s.frame, time, progress: s.duration ? Math.min(1, time / s.duration) : undefined})
            if (s.duration !== undefined && time >= s.duration) this._finish(false)
            return
        }
        const recorder = s.recorder
        if (!recorder || !this._isCaptureFrame(s)) return
        try {
            recorder.addFrame(viewer.canvas, s.frame)
        } catch (e) {
            this._finish(true, e)
            return
        }
        s.frame++
        this._needsFrameCallback = true
        this.dispatchEvent({
            type: 'progress', frame: s.frame, frames: s.frames, time: s.frame / s.fps,
            progress: s.frames ? s.frame / s.frames : undefined,
        })
        if (s.frames !== undefined && s.frame >= s.frames) {
            this._finish(false)
            return
        }
        if (recorder.pendingFrames > s.maxPending) this._waitForEncoder(s)
    }

    /**
     * Pause the viewer loop while the encoder catches up, so the captured frames do not pile up in memory.
     */
    private async _waitForEncoder(s: RecordingSession) {
        const viewer = this._viewer
        if (!viewer || !s.recorder || s.pausedViewer || !viewer.enabled) return
        s.pausedViewer = true
        viewer.enabled = false
        try {
            await s.recorder.waitForPending(Math.floor(s.maxPending / 2))
        } catch (e) {
            if (this._session === s && this._state === 'recording') this._finish(true, e)
        } finally {
            if (s.pausedViewer) {
                s.pausedViewer = false
                viewer.enabled = true
            }
        }
    }

    private async _finish(cancelled: boolean, error?: unknown) {
        const s = this._session
        const viewer = this._viewer
        if (!s || this._state === 'stopping') return
        this._state = 'stopping'
        this.refreshUi()

        // restore the viewer
        if (viewer) {
            if (viewer.timeline.recordingDeltaProvider === this._recordingDelta) viewer.timeline.recordingDeltaProvider = undefined
            if (s.stopTimeline) viewer.timeline.stop()
            viewer.getPlugin<AViewerPluginSync>('FrameFadePlugin')?.enable(this)
            if (s.pausedViewer) {
                s.pausedViewer = false
                viewer.enabled = true
            }
        }
        if (s.progressive && s.lastMaxFrameCount !== undefined) s.progressive.maxFrameCount = s.lastMaxFrameCount

        let blob: Blob | undefined
        let err = error
        if (cancelled || err) {
            s.recorder?.cancel()
            s.realtime?.cancel()
        } else {
            try {
                blob = s.recorder ? await s.recorder.finish() : await s.realtime?.stop()
            } catch (e) {
                err = e
            }
        }

        this._session = undefined
        this._state = 'idle'
        this.refreshUi()

        if (err) {
            viewer?.console.error('CanvasRecorderPlugin: recording failed', err)
            this.dispatchEvent({type: 'error', error: err})
            s.reject(err)
            this.dispatchEvent({type: 'stop', blob: undefined, cancelled: true, frames: s.frame, mode: s.mode})
            return
        }
        if (blob && s.download && viewer) {
            const ext = s.recorder ? s.recorder.fileExtension : s.realtime?.fileExtension ?? 'webm'
            try {
                await viewer.exportBlob(blob, s.filename + '.' + ext)
            } catch (e) {
                viewer.console.error('CanvasRecorderPlugin: unable to download the recording', e)
            }
        }
        this.dispatchEvent({type: 'stop', blob, cancelled, frames: s.frame, mode: s.mode})
        s.resolve(blob)
    }
}
