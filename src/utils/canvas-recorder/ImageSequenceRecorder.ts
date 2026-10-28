import {ACanvasRecorder} from './ACanvasRecorder'
import {writeFile} from 'ts-browser-helpers'

export class ImageSequenceRecorder extends ACanvasRecorder {
    private _currentImages: [string, Blob][] = [] // filename, dataurl
    /** Captures (toBlob) and writes not done yet; stop waits for them */
    private _pending = new Set<Promise<void>>()
    /** The first failed write of this recording, reported when it stops */
    private _writeError?: unknown

    private _track(p: Promise<void>) {
        // a failed write is kept and reported by stop(), not as an unhandled rejection here. The tracked promise does
        // not reject, so stop() waits for every capture and write, also after a failed one.
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
        this._currentImages = []
        this._frameCount = 0
        this._writeError = undefined

        this.setState('starting')
        const startId = ++this._startId
        if (typeof window !== 'undefined' && (window as any).showDirectoryPicker) {
            (window as any)
                .showDirectoryPicker()
                .then(async(dir: FileSystemDirectoryHandle) => {
                    const imgDir = await dir?.getDirectoryHandle('i-' + Math.floor(Date.now()), {create: true})
                    // disposed while the folder was picked: the recording does not start
                    if (startId !== this._startId) return
                    this._imgDirectory = imgDir
                    this._frameCount = 0
                    this.setState('recording')
                })
                .catch((e: any) => {
                    if (startId === this._startId) this._onerror({detail: e} as any)
                })
        } else {
            // no folder to write to (the File System Access API is not in this browser)
            this._onerror({detail: new Error('ImageSequenceRecorder: showDirectoryPicker is not supported in this browser')} as any)
        }
    }

    private _imgDirectory?: FileSystemDirectoryHandle

    /** The start that waits for the folder; a dispose cancels it */
    private _startId = 0

    dispose() {
        // a start that waits for the folder does not start: it ends in the error state (a record() waiting for it settles)
        if (this.state === 'starting') {
            this._startId++
            this.setState('error', {error: new Error('ImageSequenceRecorder: disposed while starting')})
        }
        super.dispose()
    }

    requestFrame() {
        if (!super.requestFrame()) return false
        const mime = this.options.mimeType
        // the name now: toBlob calls back later, after more frames may have been requested
        const name = 'frame_' + String(this._frameCount).padStart(5, '0') + (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg')

        // const dataUrl = this._canvas.toDataURL(mime, 90);
        this._track(new Promise<void>((resolve, reject) => this._canvas.toBlob(
            (blob) => {
                // no image (e.g. a canvas of size 0): the frame is missing, the stop reports it
                if (!blob) return reject(new Error('ImageSequenceRecorder: no image for ' + name))
                this._currentImages.push([name, blob])
                resolve()
            },
            mime,
            90,
        )))
        // this._currentImages.push([
        //   "frame_" + String(this._frameCount).padStart(5, "0") + (mime.includes("png") ? ".png" : ".jpg"),
        //   dataUrl,
        // ]);

        if (this._currentImages.length > 60) {
            this._track(this._writeImages([...this._currentImages]))
            this._currentImages = []
        }
        return true
    }

    public pause() {
        if (this.state === 'paused' || this.state === 'stopped') return

        this.setState('paused')
    }

    /**
     * Writes the frames that are left, after the captures still running, then calls back. An image sequence has no
     * blob: the callback gets undefined.
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

    private async _writeImages(images: [string, Blob][]) {
        if (!this._imgDirectory) return

        // const imageBlobs = await Promise.all(
        //   images.map(async ([name, dataUrl]) => {
        //     return await (await fetch(dataUrl)).blob();
        //   })
        // );
        const writes = []
        for (const item of images) {
            const file = await this._imgDirectory.getFileHandle(item[0], {create: true})
            // console.log('writing image', image[0])
            writes.push(writeFile(file, item[1]))
        }
        await Promise.all(writes)
    }

    private async _finish() {
        while (this._pending.size) await Promise.all([...this._pending])
        if (this._currentImages.length > 0) {
            const images = [...this._currentImages]
            this._currentImages = []
            await this._writeImages(images)
        }
        // a batch write that failed during the recording: frames are missing
        if (this._writeError) throw this._writeError
    }

    private _onerror: (event: any) => void = (event) => {
        this.setState('error', {error: event})
        this._console.error(event)
    }
}

