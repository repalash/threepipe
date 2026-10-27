import {ACanvasRecorder} from './ACanvasRecorder'
import {writeFile} from 'ts-browser-helpers'

export class ImageSequenceRecorder extends ACanvasRecorder {
    private _currentImages: [string, Blob][] = [] // filename, dataurl

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

        this.setState('starting')
        if (window && (window as any).showDirectoryPicker) {
            (window as any)
                .showDirectoryPicker()
                .then(async(dir: FileSystemDirectoryHandle) => {
                    const imgDir = await dir?.getDirectoryHandle('i-' + Math.floor(Date.now()), {create: true})
                    this._imgDirectory = imgDir
                    this._frameCount = 0
                    this.setState('recording')
                })
                .catch((e: any) => {
                    this._onerror({detail: e} as any)
                })
        }
    }

    private _imgDirectory?: FileSystemDirectoryHandle

    requestFrame() {
        if (!super.requestFrame()) return false
        const mime = this.options.mimeType

        // const dataUrl = this._canvas.toDataURL(mime, 90);
        this._canvas.toBlob(
            (blob) => {
                this._currentImages.push([
                    'frame_' + String(this._frameCount).padStart(5, '0') + (mime.includes('png') ? '.png' : '.jpg'),
                    blob!,
                ])
            },
            mime,
            90,
        )
        // this._currentImages.push([
        //   "frame_" + String(this._frameCount).padStart(5, "0") + (mime.includes("png") ? ".png" : ".jpg"),
        //   dataUrl,
        // ]);

        if (this._currentImages.length > 60) {
            this._writeImages([...this._currentImages])
            this._currentImages = []
        }
        return true
    }

    public pause() {
        if (this.state === 'paused' || this.state === 'stopped') return

        this.setState('paused')
    }

    public stop(_recordingCallback: (b: Blob) => void) {
        if (this.state === 'stopped') return
        if (this.state === 'error') {
            this._console.error('Recorder in error state, cannot stop, call start again.')
            return
        }
        // if (this.state === 'paused') this._recorder?.resume() //todo

        this.setState('stopping')
        this._onstop({} as any)
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

    private _onstop: EventListener = (_evt) => {
        if (this._currentImages.length > 0) {
            // image sequence
            this._writeImages([...this._currentImages])
            this._currentImages = []
        }
        this.setState('stopped')
    }

    private _onerror: (event: any) => void = (event) => {
        this.setState('error', {error: event})
        this._console.error(event)
    }
}

