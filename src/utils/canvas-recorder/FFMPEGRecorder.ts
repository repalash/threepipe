import {ACanvasRecorder, CanvasRecorderOptions} from './ACanvasRecorder'
import {remoteWorkerURL} from 'ts-browser-helpers'

export interface FFMPEGOptions {
    imageType?: 'png' | 'jpeg' | 'webp'
    pixFmt?: 'yuv420p' /* | 'yuv444p' | 'yuv422p'*/ | string
    crf?: number
    bitrate?: string
    preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | 'veryslow' | string
    colorSpace?: 'bt709' | string
    colorTrc?: 'bt709' | string
}

export class FFMPEGRecorder extends ACanvasRecorder<'encode-progress'> {
    worker: Worker

    public static LIBRARY_PATH = 'https://cdn.jsdelivr.net/npm/@repalash/ffmpeg.js@4.2.9005/dist/'
    // images: { name: string; data: Uint8Array }[] = [];
    constructor(canvas: HTMLCanvasElement, options?: Partial<CanvasRecorderOptions>) {
        super(canvas, options)

        this.worker = new Worker(remoteWorkerURL(
            FFMPEGRecorder.LIBRARY_PATH + 'ffmpeg-worker-mp4.js',
            FFMPEGRecorder.LIBRARY_PATH + 'ffmpeg-worker-mp4.wasm'))
        this.worker.onmessage = (e) => {
            const msg = e.data
            switch (msg.type) {
            case 'stdout':
            case 'stderr':
                if (msg.data.indexOf('frame=') === 0) {
                    const frame = parseInt(msg.data.split('frame=')[1].split('fps')[0].trim())
                    const totalFrames = this._frameCount
                    const progress = Math.round(frame / totalFrames * 100)
                    this.dispatchEvent({type: 'encode-progress', progress, frame, totalFrames})
                }
                console.log(msg.data + '\n')
                break
            case 'exit':
                console.log('Process exited with code ' + msg.data)
                // worker.terminate();
                break
            case 'done':
                if (msg.data.MEMFS[0].data === undefined) {
                    console.log('video processing failed')
                    return
                }
                this._recordingCallback?.(new Blob([msg.data.MEMFS[0].data], {
                    type: 'video/mp4',
                }))
                console.timeEnd('ffmpeg-record')
                this.setState('stopped')
                break
            default:
                break
            }
        }
    }

    public start() {
        if (this.state === 'recording') {
            console.log('Already recording canvas')
            return
        }
        if (this.state === 'error') {
            console.warn('Resetting from error state.')
        }
        if (this.state !== 'paused') {
            this._frameCount = 0
            // this.images = [];
        }
        this.setState('starting')
        this.setState('recording')
    }

    private _recordingCallback?: (b: Blob) => void

    public stop(recordingCallback: (b: Blob) => void) {
        if (this.state === 'stopped') return
        if (this.state === 'error') {
            console.error('FFMPEGRecorder: Recorder in error state, cannot stop, call start again.')
            return
        }

        this._recordingCallback = recordingCallback
        this.setState('stopping')

        // toBlob calls back later: encode after every requested frame is in the worker
        Promise.all([...this._pendingCaptures]).then(() => this._onStop())
    }

    private _onStop() {
        const width = this._canvas.width % 2 === 0 ? this._canvas.width : this._canvas.width - 1
        // if (this.worker && !this._workerRunning)
        //   //https://gist.github.com/ilblog/5fa2914e0ad666bbb85745dbf4b3f106
        //   console.log("runningggggggggggggggggggg");
        console.time('ffmpeg-record')
        const fps = this.options.frameRate.toString()
        const targetFps = this.options.frameRate.toString()

        const args = [
            '-r', fps,
            '-an', // disable sound
            '-i', `img%06d.${this._mime}`,
            '-frames:v', this._frameCount.toString(),
            '-c:v', 'libx264',
            '-crf', Math.min(28, Math.max(1, this.ffmpegOptions.crf ?? 17)).toString(), // https://trac.ffmpeg.org/wiki/Encode/H.264
            '-filter:v', `scale=${width}:-2`,
            '-pix_fmt', this.ffmpegOptions.pixFmt ?? 'yuv420p',
            '-b:v', this.ffmpegOptions.bitrate ?? '10M',
            '-preset', this.ffmpegOptions.preset ?? 'ultrafast',
            '-r', targetFps,
        ]
        if (this.ffmpegOptions.colorSpace)
            args.push('-colorspace', this.ffmpegOptions.colorSpace)
        if (this.ffmpegOptions.colorTrc)
            args.push('-color_trc', this.ffmpegOptions.colorTrc)
        args.push('out.mp4')
        console.log(args)
        
        // const lastFrame = this._lastCanvasCaptureFrame
        this.worker.postMessage({
            type: 'run',
            // TOTAL_MEMORY: (2 << 12) * 1024000
            arguments: args,
            // MEMFS: this.images,
        })
    }

    requestFrame() {
        if (!super.requestFrame()) return false
        // const data = this.canvas.toDataURL("image/png", 90);
        // this.worker.postMessage({
        //   type: "image",
        //   file: {
        //     name: `img${this.pad(this._frameCount, 3)}.png`,
        //     data,
        //   },
        // });
        this.sendBlobToWorker(this._frameCount - 1)
        return true
    }

    /** The frame captures whose toBlob has not called back yet */
    private _pendingCaptures = new Set<Promise<void>>()
    // private _lastCanvasCaptureFrame = 0

    ffmpegOptions: FFMPEGOptions = {
        imageType: 'jpeg',
        bitrate: '10M',
        crf: 17,
        pixFmt: 'yuv420p',
        preset: 'ultrafast',
        colorTrc: 'bt709',
        colorSpace: 'bt709',
    }

    private get _mime() {
        let mime = this.ffmpegOptions.imageType ?? 'jpeg'
        const allowed = ['png', 'jpeg', 'webp']
        if (!mime || !allowed.includes(mime)) {
            console.warn('FFMPEGRecorder: Unsupported mime type', this.ffmpegOptions.imageType)
            mime = 'jpeg'
        }
        return mime
    }

    sendBlobToWorker(frameCount: number): void {
        if (this._pendingCaptures.size) {
            console.warn('FFMPEGRecorder: Previous frame capture not complete', frameCount - 1)
        }
        const mime = this._mime
        const capture: Promise<void> = new Promise<void>((resolve) => {
            this._canvas.toBlob(
                (data) => {
                // data?.arrayBuffer().then((data)=> )
                //     this._lastCanvasCaptureFrame = frameCount
                    this.worker.postMessage({
                        type: 'image',
                        file: {
                            name: `img${frameCount.toString().padStart(6, '0')}.${mime}`,
                            data,
                        },
                    })
                    resolve()
                },
                `image/${mime}`,
                90,
            )
        })
        this._pendingCaptures.add(capture)
        capture.then(() => this._pendingCaptures.delete(capture))
    }

    pad(n: number | string, width: number) {
        // todo: just use padStart
        const z = '0'
        n = n + ''
        return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n
    }

    public pause() {
        if (this.state === 'paused' || this.state === 'stopped') return

        this.setState('paused')
    }

    setOptions(options: Partial<CanvasRecorderOptions>) {
        super.setOptions(options)
    }
}
