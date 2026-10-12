import {Zip, ZipPassThrough} from 'threepipe'
import {FrameRecorderInfo, FrameSource, IFrameRecorder} from './IFrameRecorder'

export type ImageSequenceFormat = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageSequenceRecorderOptions {
    /**
     * Image format of the frames.
     * @default 'image/png'
     */
    format?: ImageSequenceFormat
    /**
     * Quality for `image/jpeg` and `image/webp`, between 0 and 1.
     * @default 0.95
     */
    quality?: number
    /**
     * Folder to write the frames into, from `showDirectoryPicker()` (File System Access API).
     * When not set, the frames are collected into a zip file.
     */
    directory?: FileSystemDirectoryHandle
    /**
     * File name prefix of the frames. Frame 12 in PNG format is `frame_000012.png` with the default prefix.
     * @default 'frame_'
     */
    filePrefix?: string
}

/**
 * Returns the file extension (without the dot) for an image mime type.
 * @param format - image mime type
 */
export function imageExtension(format: ImageSequenceFormat): string {
    return format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png'
}

/**
 * Frame-exact image sequence recorder.
 * Each captured frame is encoded with `canvas.toBlob` and written into a zip file (default) or into a folder chosen with the File System Access API.
 * The frames are written in order. Images are stored in the zip without compression, since PNG, JPEG and WebP are compressed already.
 */
export class ImageSequenceRecorder implements IFrameRecorder {
    get mimeType() {
        return this.options.directory ? '' : 'application/zip'
    }
    get fileExtension() {
        return this.options.directory ? '' : 'zip'
    }

    private _pending = 0
    private _queue: Promise<void> = Promise.resolve()
    private _error?: Error
    private _zip?: Zip
    private _zipChunks: Uint8Array[] = []
    private _zipDone?: Promise<void>
    private _source?: FrameSource
    private _cancelled = false

    constructor(public options: ImageSequenceRecorderOptions = {}) {
    }

    get pendingFrames() {
        return this._pending
    }

    async start(info: FrameRecorderInfo): Promise<void> {
        this._source = new FrameSource(info.width, info.height, false)
        this._error = undefined
        this._cancelled = false
        this._queue = Promise.resolve()
        this._pending = 0
        this._zipChunks = []
        if (this.options.directory) {
            this._zip = undefined
            this._zipDone = undefined
            return
        }
        const zip = new Zip()
        this._zip = zip
        this._zipDone = new Promise<void>((resolve, reject) => {
            zip.ondata = (err, chunk, final) => {
                if (err) {
                    reject(err)
                    return
                }
                this._zipChunks.push(chunk)
                if (final) resolve()
            }
        })
        this._zipDone.catch((e) => this._setError(e))
    }

    addFrame(canvas: HTMLCanvasElement, index: number): void {
        if (this._error) throw this._error
        if (!this._source) throw new Error('CanvasRecorder: image sequence recorder is not running')
        const format = this.options.format ?? 'image/png'
        const name = (this.options.filePrefix ?? 'frame_') + index.toString().padStart(6, '0') + '.' + imageExtension(format)
        const {source} = this._source.get(canvas)
        // toBlob copies the canvas bitmap synchronously, the encoding is asynchronous
        const blob = new Promise<Blob | null>((resolve) => source.toBlob(resolve, format, this.options.quality ?? 0.95))
        this._pending++
        this._queue = this._queue.then(async() => {
            const b = await blob
            if (this._cancelled || this._error) return
            if (!b) throw new Error('CanvasRecorder: unable to encode frame ' + index + ' as ' + format)
            await this._write(name, b)
        }).catch((e) => this._setError(e)).finally(() => {
            this._pending--
        })
    }

    async waitForPending(max: number): Promise<void> {
        while (this._pending > max && !this._error) {
            await Promise.race([this._queue, new Promise((r) => setTimeout(r, 20))])
        }
        if (this._error) throw this._error
    }

    async finish(): Promise<Blob | undefined> {
        await this._queue
        this._source?.dispose()
        this._source = undefined
        if (this._error) throw this._error
        const zip = this._zip
        this._zip = undefined
        if (!zip) return undefined // written to the directory
        zip.end()
        await this._zipDone
        const chunks = this._zipChunks
        this._zipChunks = []
        return new Blob(chunks as BlobPart[], {type: 'application/zip'})
    }

    cancel(): void {
        this._cancelled = true
        this._zip?.terminate()
        this._zip = undefined
        this._zipChunks = []
        this._source?.dispose()
        this._source = undefined
    }

    private async _write(name: string, blob: Blob) {
        const dir = this.options.directory
        if (dir) {
            const file = await dir.getFileHandle(name, {create: true})
            const writable = await file.createWritable()
            await writable.write(blob)
            await writable.close()
            return
        }
        const data = new Uint8Array(await blob.arrayBuffer())
        if (!this._zip) return // cancelled
        const entry = new ZipPassThrough(name)
        this._zip.add(entry)
        entry.push(data, true)
    }

    private _setError(e: unknown) {
        if (!this._error) this._error = e instanceof Error ? e : new Error(String(e))
    }
}
