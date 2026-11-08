import {ACanvasRecorder, type ICanvasFrameSink} from './ACanvasRecorder'
import {DirectoryFrameSink} from './DirectoryFrameSink'

/**
 * Records the canvas as an image sequence: one PNG, JPEG or WebP per frame. It captures the frames and gives them in
 * order to a sink ({@link CanvasRecorderOptions.frameSink}): a folder the user picks by default ({@link DirectoryFrameSink}),
 * a zip ({@link ZipFrameSink}), or your own. The next converged frame waits for the sink.
 */
export class ImageSequenceRecorder extends ACanvasRecorder {
    /** Captures and writes not done yet; stop waits for them */
    private _pending = new Set<Promise<void>>()
    /** The first failure of this recording, reported when it stops */
    private _writeError?: unknown
    /** The sink of this recording; a change of the option applies to the next one */
    private _sink?: ICanvasFrameSink
    /** Frames reach the sink one at a time and in order, however the captures end */
    private _sinkQueue: Promise<void> = Promise.resolve()

    private _track(p: Promise<void>) {
        // a failure is kept and reported by stop(), not as an unhandled rejection here. The tracked promise does not
        // reject, so stop() waits for every capture and write, also after a failed one.
        const tracked = p.then(() => undefined, (e) => {
            this._writeError = this._writeError ?? e
        })
        this._pending.add(tracked)
        tracked.then(() => this._pending.delete(tracked))
    }

    public start() {
        if (this.state === 'recording') {
            this._console.log('Already recording canvas')
            return
        }
        if (this.state === 'error') {
            this._console.warn('Resetting from error state.')
        }

        if (this.state === 'paused') {
            this.setState('starting')
            this.setState('recording')
            return
        }

        this._currentRecording = []
        this._frameCount = 0
        this._writeError = undefined
        this._sinkQueue = Promise.resolve()
        const option = this.options.frameSink
        const sink: ICanvasFrameSink = !option ? new DirectoryFrameSink() : typeof option === 'function' ? {write: option} : option
        this._sink = sink

        this.setState('starting')
        const startId = ++this._startId
        let started: void | Promise<void>
        try {
            started = sink.start?.()
        } catch (e) {
            this._onerror({detail: e})
            return
        }
        // a sink that needs nothing starts at once; one that waits (a folder picker) starts when it is ready
        if (!started) {
            this.setState('recording')
            return
        }
        started.then(() => {
            // disposed while the sink started: the recording does not start
            if (startId !== this._startId) return
            this._frameCount = 0
            this.setState('recording')
        }, (e: unknown) => {
            if (startId === this._startId) this._onerror({detail: e})
        })
    }

    /** The next converged frame waits for the sink (it may be slow, and frames would pile up in memory) */
    isBusy() {
        return this._pending.size > 0
    }

    /** Same as {@link isBusy}: the wait is for the sink, not a frame time, so it can be long */
    isWriting() {
        return this._pending.size > 0
    }

    private _sendFrame(sink: ICanvasFrameSink, name: string, mimeType: string) {
        const index = this._frameCount - 1
        const capture = new Promise<Blob>((resolve, reject) => this._canvas.toBlob(
            // no image (e.g. a canvas of size 0): the frame is missing, the stop reports it
            blob => blob ? resolve(blob) : reject(new Error('ImageSequenceRecorder: no image for ' + name)),
            mimeType,
            90,
        ))
        capture.catch(() => undefined) // reported through the queue below, which may reach it later
        this._track(capture.then(() => undefined)) // the stop waits for every capture, also after a failed write
        // after a failure the queue stays rejected: no later frame is sent, and the stop reports the first error
        this._sinkQueue = this._sinkQueue.then(async() => capture).then(async() => sink.write({blob: await capture, index, name, mimeType}))
        this._track(this._sinkQueue)
    }

    /** The start that waits for the sink; a dispose cancels it */
    private _startId = 0

    dispose() {
        // a start that waits for the sink does not start: it ends in the error state (a record() waiting for it settles)
        if (this.state === 'starting') {
            this._startId++
            this._sink?.dispose?.()
            this.setState('error', {error: new Error('ImageSequenceRecorder: disposed while starting')})
        } else if (this.state === 'error' || this.state === 'stopped') {
            // after a failed or ended recording: an upload session or the frames of a zip are let go too
            this._sink?.dispose?.()
            this._sink = undefined
        }
        super.dispose()
    }

    requestFrame() {
        if (!super.requestFrame()) return false
        const mime = this.options.mimeType
        // the name now: toBlob calls back later, after more frames may have been requested
        const name = 'frame_' + String(this._frameCount).padStart(5, '0') + (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg')
        if (this._sink) this._sendFrame(this._sink, name, mime)
        return true
    }

    public pause() {
        if (this.state === 'paused' || this.state === 'stopped') return

        this.setState('paused')
    }

    /**
     * Waits for the captures and writes still running and for the sink to finish, then calls back. An image sequence has
     * no blob: the callback gets undefined.
     */
    public stop(recordingCallback: (b?: Blob) => void) {
        if (this.state === 'stopped') return
        if (this.state === 'error') {
            this._console.error('Recorder in error state, cannot stop, call start again.')
            return
        }
        // if (this.state === 'paused') this._recorder?.resume() //todo

        this.setState('stopping')
        this._finish().then(() => {
            recordingCallback(undefined)
            this.setState('stopped')
        }, (e) => {
            // a write failed (disk full, folder access revoked): the caller's stop still settles, and the error is reported
            recordingCallback(undefined)
            this._onerror({detail: e})
        })
    }

    private async _finish() {
        while (this._pending.size) await Promise.all([...this._pending])
        // a write that failed during the recording: frames are missing, and the sink is not finished
        if (this._writeError) throw this._writeError
        await this._sink?.finish?.()
    }

    private _onerror: (event: any) => void = (event) => {
        this.setState('error', {error: event})
        this._console.error(event)
    }
}
