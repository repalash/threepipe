import {downloadBlob} from 'ts-browser-helpers'
import {type Zippable, zipSync} from 'three/examples/jsm/libs/fflate.module.js'
import type {CanvasRecorderFrame, ICanvasFrameSink} from './ACanvasRecorder'

/**
 * Puts the frames of an image sequence in one zip, made when the recording stops. Works in every browser and needs no
 * folder picker. All frames stay in memory until then, so a long recording at a large size needs a lot of it; a sink
 * that writes each frame away ({@link DirectoryFrameSink}, or a function that uploads it) does not.
 *
 * The zip is downloaded, or given to `onZip` instead.
 */
export class ZipFrameSink implements ICanvasFrameSink {
    private _files: Zippable = {}

    /**
     * @param name - the zip's file name, without `.zip`
     * @param onZip - takes the zip instead of downloading it
     */
    constructor(public name = 'frames', public onZip?: (zip: File) => void | Promise<void>) {}

    start(): void {
        this._files = {}
    }

    async write(frame: CanvasRecorderFrame): Promise<void> {
        this._files[frame.name] = new Uint8Array(await frame.blob.arrayBuffer())
    }

    async finish(): Promise<void> {
        // the images are compressed already: stored, not compressed again
        const zipped = zipSync(this._files, {level: 0})
        this._files = {}
        const zip = new File([zipped as Uint8Array<ArrayBuffer>], this.name + '.zip', {type: 'application/zip'})
        if (this.onZip) await this.onZip(zip)
        else downloadBlob(zip, zip.name)
    }

    dispose(): void {
        this._files = {}
    }
}
