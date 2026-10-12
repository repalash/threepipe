/**
 * Mime types tried by {@link MediaStreamRecorder} when none is set, in order.
 * WebM (VP9, VP8) comes first: with `video/mp4;codecs=avc1`, MediaRecorder delivered almost no frames from a WebGL canvas in Chrome (measured on an Apple M4 Pro).
 */
export const mediaRecorderMimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
]

export interface MediaStreamRecorderOptions {
    /**
     * Frames per second requested from `canvas.captureStream`.
     * @default 30
     */
    fps?: number
    /**
     * Mime type for MediaRecorder, like `video/webm;codecs=vp9`. By default, the first supported type in {@link mediaRecorderMimeTypes}.
     */
    mimeType?: string
    /**
     * Bits per second. `0` or `undefined` lets the browser choose.
     */
    bitrate?: number
}

/**
 * Checks if the browser has `MediaRecorder` and `HTMLCanvasElement.captureStream`.
 */
export function isMediaRecorderSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function' &&
        typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/**
 * Real-time recorder using `MediaRecorder` over `canvas.captureStream()`.
 *
 * This is the fallback for browsers without WebCodecs. It records what is shown on the canvas in real time: the scene time follows the wall clock,
 * frames are dropped when the render is slow, and the encoding runs while rendering, which can slow down the render.
 */
export class MediaStreamRecorder {
    /**
     * The mime type in use. Set in {@link start}.
     */
    mimeType = ''

    private _recorder?: MediaRecorder
    private _stream?: MediaStream
    private _chunks: Blob[] = []
    private _stopped?: Promise<void>

    constructor(readonly canvas: HTMLCanvasElement, public options: MediaStreamRecorderOptions = {}) {
    }

    /**
     * Returns the first mime type in the list that MediaRecorder supports.
     * @param types - mime types to try, {@link mediaRecorderMimeTypes} by default
     */
    static FindMimeType(types = mediaRecorderMimeTypes): string | undefined {
        if (!isMediaRecorderSupported()) return undefined
        return types.find(t => MediaRecorder.isTypeSupported(t))
    }

    get fileExtension() {
        return this.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
    }

    get isRecording() {
        return this._recorder?.state === 'recording'
    }

    start(): void {
        if (!isMediaRecorderSupported()) throw new Error('CanvasRecorder: MediaRecorder or canvas.captureStream is not supported in this browser')
        const mimeType = this.options.mimeType || MediaStreamRecorder.FindMimeType()
        if (!mimeType || !MediaRecorder.isTypeSupported(mimeType)) throw new Error('CanvasRecorder: no supported MediaRecorder mime type ' + (mimeType ?? ''))
        this.mimeType = mimeType
        this._chunks = []
        this._stream = this.canvas.captureStream(this.options.fps ?? 30)
        const recorder = new MediaRecorder(this._stream, {
            mimeType,
            videoBitsPerSecond: this.options.bitrate || undefined,
        })
        this._recorder = recorder
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) this._chunks.push(e.data)
        }
        this._stopped = new Promise<void>((resolve, reject) => {
            recorder.onstop = () => resolve()
            recorder.onerror = (e) => reject((e as ErrorEvent).error ?? new Error('MediaRecorder error'))
        })
        this._stopped.catch(() => undefined) // handled in stop(), avoids an unhandled rejection after cancel()
        recorder.start(1000) // collect data every second
    }

    async stop(): Promise<Blob | undefined> {
        const recorder = this._recorder
        if (!recorder) return undefined
        if (recorder.state !== 'inactive') recorder.stop()
        try {
            await this._stopped
        } finally {
            this._cleanup()
        }
        const blob = new Blob(this._chunks, {type: this.mimeType})
        this._chunks = []
        return blob
    }

    cancel(): void {
        const recorder = this._recorder
        if (recorder && recorder.state !== 'inactive') {
            recorder.ondataavailable = null
            recorder.stop()
        }
        this._chunks = []
        this._cleanup()
    }

    private _cleanup() {
        this._stream?.getTracks().forEach(t => t.stop())
        this._stream = undefined
        this._recorder = undefined
        this._stopped = undefined
    }
}
