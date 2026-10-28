import {ACanvasRecorder, CanvasRecorderOptions} from './ACanvasRecorder'
import {now, timeout} from 'ts-browser-helpers'

/** The browser has MediaRecorder */
function hasMediaRecorder() {
    return typeof window !== 'undefined' && !!window.MediaRecorder
}

export class CanvasMediaRecorder extends ACanvasRecorder {
    private _recorder?: MediaRecorder
    private _track: MediaStreamTrack | undefined

    protected _setOptions(value: Partial<CanvasRecorderOptions>) {
        super._setOptions(value)

        if (!this.options.mimeType || this.options.mimeType === 'auto') {
            this.options.mimeType = (CanvasMediaRecorder.GetSupportedMimeTypes([], ['h264'], true) ??
                CanvasMediaRecorder.GetSupportedMimeTypes(undefined, undefined, true)) as string
        }
        // without MediaRecorder, start() ends in the error state (use an image sequence instead)
        if (!hasMediaRecorder()) this._console.warn('MediaRecorder is not supported in this browser')
        else if (!this.options.mimeType) {
            console.warn(new Error('No supported mimetype found'))
        }
    }

    public setOptions(options: Partial<CanvasRecorderOptions>) {
        // todo: remove undefined keys and values from options
        this._setOptions(options)
    }

    private _recordingCallback?: (b?: Blob) => void

    constructor(canvas: HTMLCanvasElement, options?: Partial<CanvasRecorderOptions>) {
        super(canvas, options)
    }

    public start() {
        if (this.state === 'recording') {
            this._console.log('Already recording canvas')
            return
        }
        if (this.state === 'error') {
            this._recorder = undefined
            this._console.warn('Resetting from error state.')
        }
        if (this._recorder) {
            if (this.state === 'paused') {
                this.setState('starting')
                this._recorder.resume()
                return
            }
            this._console.warn('Canvas recorder unknown state', this.state)
            return
        }

        const options: MediaRecorderOptions = {
            mimeType: this.options.mimeType,
            videoBitsPerSecond: this.options.videoBitsPerSecond,
        }

        this._currentRecording = []
        this._frameCount = 0
        this._stepping = false
        this._queuedFrames = 0
        // a start that cannot record ends in the error state, so the caller does not wait for it
        if (!hasMediaRecorder() || !options.mimeType?.startsWith('video')) {
            const error = new Error(hasMediaRecorder() ? 'No supported video type for MediaRecorder' : 'MediaRecorder not supported, use an image sequence')
            this._console.error(error.message)
            this.setState('error', {error})
            return
        }
        const stream = this._canvas.captureStream(this.options.stepMode ? 0 : this.options.frameRate)
        const track = stream.getVideoTracks()?.[0]
        // if (track) {
        //     const constraints = track.getConstraints()
        // constraints.frameRate = 30
        // track.applyConstraints(constraints).then(()=>{
        //     console.log(track.getCapabilities(), track.getSettings(), track)
        // })
        // }
        this._track = track

        this.setState('starting')
        // the browser can refuse the stream or its options: the start ends in the error state, and the next start makes a
        // new recorder
        try {
            this._recorder = new window.MediaRecorder(stream, options)
            this._recorder.onstop = this._onstop
            this._recorder.ondataavailable = this._ondataavailable
            this._recorder.onerror = this._onerror as any // todo see ts error without any
            this._recorder.onresume = this._onresume
            this._recorder.onstart = this._onstart
            // this._recorder.onpause = this._onpause
            this._recorder.start()
        } catch (e) {
            this._onerror(e)
        }
    }

    private _resumeSyncTime = 0

    /** Step mode: a frame records for one frame time (resume, then pause in _onresume) */
    private _stepping = false
    /** Step mode: the frames requested while a frame records; each gets its own frame time after it */
    private _queuedFrames = 0

    requestFrame() {
        if (!this._recorder || !super.requestFrame()) return false
        if (!this._track || !this.options.stepMode) return true
        // a resume of a recorder that records gives no frame time: the frame waits for the one before it
        if (this._stepping) this._queuedFrames++
        else this._step()
        return true
    }

    /** Step mode: a frame records now; a frame requested now would wait for it */
    isBusy() {
        return this._stepping || this._queuedFrames > 0
    }

    /** Step mode: records the canvas for one frame time */
    private _step() {
        this._stepping = true
        this._resumeSyncTime = now()
        // @ts-expect-error no ts for CanvasCaptureMediaStreamTrack
        this._track!.requestFrame()
        this._recorder!.resume()
    }

    public pause() {
        if (this.state === 'paused' || this.state === 'stopped') return
        if (this.options.stepMode) {
            console.error('Pause not supported in stepMode')
            return
        }
        if (this._recorder) {
            this._recorder.pause()
            this.setState('paused')
        }
    }

    /** Calls back with the recording, or with undefined when there is no data or the recorder failed */
    public stop(recordingCallback: (b?: Blob) => void) {
        if (this.state === 'stopped') return
        if (this.state === 'error') {
            this._console.error('Recorder in error state, cannot stop, call start again.')
            return
        }
        // if (this.state === 'paused') this._recorder?.resume() //todo

        this._recordingCallback = recordingCallback
        this.setState('stopping')
        // step mode: the frames that record or wait finish first, then the recorder stops (_onresume)
        if (this._stepping) return
        if (this._recorder) this._recorder.stop()
        else this._onstop(new Event('stop'))
    }

    /** Calls back the pending stop once */
    private _settleStop(blob?: Blob) {
        const callback = this._recordingCallback
        this._recordingCallback = undefined
        callback?.(blob)
    }

    dispose() {
        this._stopTrack()
        if (!this._recorder) return
        // a start that waits for the native start event does not start: its handlers are detached, the native recorder
        // stops, and the start ends in the error state (a record() waiting for it settles)
        if (this.state === 'starting') {
            const recorder = this._recorder
            recorder.onstart = recorder.onresume = recorder.onstop = recorder.ondataavailable = recorder.onerror = null
            if (recorder.state !== 'inactive') recorder.stop()
            this._recorder = undefined
            this.setState('error', {error: new Error('CanvasMediaRecorder: disposed while starting')})
            return
        }
        // step mode: the frames that wait are dropped, and a stop that waits for a step stops now
        const stepping = this._stepping
        this._stepping = false
        this._queuedFrames = 0
        if (stepping && this.state === 'stopping') this._recorder.stop()
        super.dispose()
        this._recorder = undefined
    }

    private _onstop: EventListener = (_evt) => {
        // also without data: the stop settles with no recording
        this._settleStop(this._currentRecording.length > 0 ? new Blob(this._currentRecording, {type: this.options.mimeType}) : undefined)
        this._recorder = undefined
        this._stopTrack()
        this.setState('stopped')
    }

    /** Ends the canvas capture of the recording: a stream that stays open keeps capturing the renders */
    private _stopTrack() {
        this._track?.stop()
        this._track = undefined
    }
    private _onstart: EventListener = (_evt) => {
        this._frameCount = 0
        if (this.options.stepMode) this._recorder?.pause()
        this.setState('recording')
    }
    private _onresume: EventListener = (_evt) => {
        if (this.state === 'paused' || this.state === 'starting' || this.state === 'stopped') this.setState('recording')
        if (!this.options.stepMode) return
        const pse = () => {
            this._stepping = false
            if (this._queuedFrames > 0 && (this.state === 'recording' || this.state === 'stopping')) {
                this._queuedFrames--
                this._recorder?.pause()
                this._step()
            } else if (this.state === 'recording') this._recorder?.pause()
            else if (this.state === 'stopping') this._recorder?.stop()
        }
        const del = Math.min(this._resumeSyncTime - now(), 0) + 1000 / this.options.frameRate
        if (del > 0) timeout(del).then(pse)
        else pse()
        // console.log(del)
    }

    private _onerror: (event: any) => void = (event) => {
        // the failed recording is released before the error event, whose listeners can start a new one at once; its
        // handlers are detached, so its later events (the browser stops it after the error) do not reach the new one
        const recorder = this._recorder
        if (recorder) recorder.onstart = recorder.onresume = recorder.onstop = recorder.ondataavailable = recorder.onerror = null
        this._recorder = undefined
        this._stopTrack()
        this._settleStop(undefined)
        this._console.error(event)
        this.setState('error', {error: event})
    }

    // https://stackoverflow.com/questions/41739837/all-mime-types-supported-by-mediarecorder-in-firefox-and-chrome
    public static GetSupportedMimeTypes(
        types?: string[],
        codecs?: string[],
        firstOnly = false,
    ): string[] | string | undefined {
        if (!hasMediaRecorder()) return firstOnly ? undefined : []
        const VIDEO_TYPES = ['webm', 'ogg', 'mp4', 'x-matroska'].filter(
            (value) => !types || types.length < 1 || types.includes(value),
        )
        const VIDEO_CODECS = [
            'vp9',
            'vp9.0',
            'vp8',
            'vp8.0',
            'avc1',
            'av1',
            'h265',
            'h.265',
            'h264',
            'h.264',
            'opus',
        ].filter((value) => !codecs || codecs.length < 1 || codecs.includes(value))

        const supportedTypes: string[] = []
        VIDEO_TYPES.forEach((videoType) => {
            const type = `video/${videoType}`
            VIDEO_CODECS.forEach((codec) => {
                const variations = [
                    `${type};codecs=${codec}`,
                    `${type};codecs:${codec}`,
                    `${type};codecs=${codec.toUpperCase()}`,
                    `${type};codecs:${codec.toUpperCase()}`,
                    `${type}`,
                ]
                variations.forEach((variation) => {
                    if (MediaRecorder.isTypeSupported(variation)) supportedTypes.push(variation)
                })
            })
        })
        if (firstOnly) return supportedTypes.length > 0 ? supportedTypes[0] : undefined
        return supportedTypes
    }
}
