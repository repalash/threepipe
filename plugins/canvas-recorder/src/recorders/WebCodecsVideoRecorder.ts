import {ArrayBufferTarget, Muxer} from 'mp4-muxer'
import {
    evenSize,
    getCodecFromString,
    getDefaultBitrate,
    getFrameTiming,
    getVideoCodecString,
    VideoCodecName,
} from '../codecs'
import {FrameRecorderInfo, FrameSource, IFrameRecorder} from './IFrameRecorder'

export interface WebCodecsVideoRecorderOptions {
    /**
     * Codec family. `auto` tries `avc` (H.264), then `vp9`, then `av1`, and uses the first one the browser can encode.
     * @default 'auto'
     */
    codec?: 'auto' | VideoCodecName
    /**
     * Full WebCodecs codec string, like `avc1.640033` or `hvc1.1.6.L123.B0`. Overrides {@link codec}.
     * By default, the string is computed from the codec family, the frame size and the frame rate (like `avc1.64002A` for 1080p at 60 fps).
     */
    codecString?: string
    /**
     * Bits per second. `0` or `undefined` computes a default from the frame size and the frame rate (about 15 Mbit/s for 1080p at 60 fps).
     */
    bitrate?: number
    /**
     * Seconds between key frames.
     * @default 2
     */
    keyFrameInterval?: number
    /**
     * Hardware acceleration preference. With `prefer-hardware`, the recorder falls back to `no-preference` when the browser has no hardware encoder for the codec.
     * @default 'prefer-hardware'
     */
    hardwareAcceleration?: HardwareAcceleration
    /**
     * Bitrate mode of the encoder.
     * @default 'variable'
     */
    bitrateMode?: VideoEncoderBitrateMode
}

/**
 * Checks if the browser has the WebCodecs `VideoEncoder` and `VideoFrame` APIs. They need a secure context (https or localhost).
 */
export function isWebCodecsSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function'
}

/**
 * Finds a supported encoder configuration.
 * @param options - recorder options
 * @param width - frame width (even)
 * @param height - frame height (even)
 * @param fps - frames per second
 * @returns the configuration and the codec family, or `undefined` if the browser cannot encode any of the requested codecs
 */
export async function findVideoEncoderConfig(options: WebCodecsVideoRecorderOptions, width: number, height: number, fps: number): Promise<{config: VideoEncoderConfig, codec: VideoCodecName} | undefined> {
    if (!isWebCodecsSupported()) return undefined
    const bitrate = options.bitrate || getDefaultBitrate(width, height, fps)
    const candidates: {codec: VideoCodecName, codecString: string}[] = []
    if (options.codecString) {
        const codec = getCodecFromString(options.codecString)
        if (!codec) throw new Error('CanvasRecorder: unsupported codec string ' + options.codecString)
        candidates.push({codec, codecString: options.codecString})
    } else {
        const codecs: VideoCodecName[] = !options.codec || options.codec === 'auto' ? ['avc', 'vp9', 'av1'] : [options.codec]
        for (const codec of codecs) {
            const codecString = getVideoCodecString(codec, width, height, fps, bitrate)
            if (codecString) candidates.push({codec, codecString})
        }
    }
    const hw = options.hardwareAcceleration ?? 'prefer-hardware'
    const accelerations: HardwareAcceleration[] = hw === 'prefer-hardware' ? ['prefer-hardware', 'no-preference'] : [hw]
    for (const {codec, codecString} of candidates) {
        for (const hardwareAcceleration of accelerations) {
            const config: VideoEncoderConfig = {
                codec: codecString,
                width, height,
                bitrate,
                framerate: fps,
                hardwareAcceleration,
                bitrateMode: options.bitrateMode ?? 'variable',
                latencyMode: 'quality',
            }
            // AVCC format: length-prefixed NAL units with the avcC box in the decoder config, required for MP4
            if (codec === 'avc') config.avc = {format: 'avc'}
            if (codec === 'hevc') (config as any).hevc = {format: 'hevc'}
            try {
                const support = await VideoEncoder.isConfigSupported(config)
                if (support.supported) return {config: support.config ?? config, codec}
            } catch {
                // invalid config (like an unknown codec string), try the next one
            }
        }
    }
    return undefined
}

/**
 * Frame-exact video recorder using WebCodecs.
 * Each captured frame becomes a `VideoFrame` with a timestamp computed from the frame index, it is encoded with a `VideoEncoder`
 * (H.264 by default) and muxed into an MP4 file in the browser with [mp4-muxer](https://github.com/Vanilagy/mp4-muxer).
 */
export class WebCodecsVideoRecorder implements IFrameRecorder {
    readonly mimeType = 'video/mp4'
    readonly fileExtension = 'mp4'

    /**
     * The codec string in use, like `avc1.64002A`. Set in {@link start}.
     */
    codecString = ''
    /**
     * The encoder configuration in use. Set in {@link start}.
     */
    config?: VideoEncoderConfig

    private _encoder?: VideoEncoder
    private _muxer?: Muxer<ArrayBufferTarget>
    private _source?: FrameSource
    private _fps = 30
    private _keyFrameEvery = 60
    private _error?: Error

    constructor(public options: WebCodecsVideoRecorderOptions = {}) {
    }

    get pendingFrames() {
        return this._encoder?.encodeQueueSize ?? 0
    }

    async start(info: FrameRecorderInfo): Promise<void> {
        const width = evenSize(info.width)
        const height = evenSize(info.height)
        const found = await findVideoEncoderConfig(this.options, width, height, info.fps)
        if (!found) throw new Error(`CanvasRecorder: no supported WebCodecs video encoder for ${this.options.codecString || this.options.codec || 'auto'} at ${width}x${height} ${info.fps}fps`)
        const {config, codec} = found
        this.config = config
        this.codecString = config.codec
        this._fps = info.fps
        this._keyFrameEvery = Math.max(1, Math.round((this.options.keyFrameInterval ?? 2) * info.fps))
        this._source = new FrameSource(width, height, true)
        this._error = undefined

        const muxer = new Muxer({
            target: new ArrayBufferTarget(),
            video: {codec, width, height, frameRate: info.fps},
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset',
        })
        this._muxer = muxer
        const encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => {
                this._error = e instanceof Error ? e : new Error(String(e))
            },
        })
        encoder.configure(config)
        this._encoder = encoder
    }

    addFrame(canvas: HTMLCanvasElement, index: number): void {
        if (this._error) throw this._error
        if (!this._encoder || !this._source || this._encoder.state !== 'configured') throw new Error('CanvasRecorder: video encoder is not running')
        const {source, visibleRect} = this._source.get(canvas)
        const timing = getFrameTiming(index, this._fps)
        const frame = new VideoFrame(source, {...timing, visibleRect})
        try {
            this._encoder.encode(frame, {keyFrame: index % this._keyFrameEvery === 0})
        } finally {
            frame.close()
        }
    }

    async waitForPending(max: number): Promise<void> {
        const encoder = this._encoder
        while (encoder && encoder.state === 'configured' && encoder.encodeQueueSize > max && !this._error) {
            await new Promise<void>((resolve) => {
                const done = () => {
                    clearTimeout(t)
                    encoder.removeEventListener('dequeue', done)
                    resolve()
                }
                // the dequeue event is not available in all browsers, poll as a fallback
                const t = setTimeout(done, 20)
                encoder.addEventListener('dequeue', done)
            })
        }
        if (this._error) throw this._error
    }

    async finish(): Promise<Blob | undefined> {
        const encoder = this._encoder
        const muxer = this._muxer
        this._encoder = undefined
        this._muxer = undefined
        this._source?.dispose()
        this._source = undefined
        if (!encoder || !muxer) return undefined
        try {
            if (encoder.state === 'configured') await encoder.flush()
        } finally {
            if (encoder.state !== 'closed') encoder.close()
        }
        if (this._error) throw this._error
        muxer.finalize()
        return new Blob([muxer.target.buffer], {type: this.mimeType})
    }

    cancel(): void {
        const encoder = this._encoder
        this._encoder = undefined
        this._muxer = undefined
        this._source?.dispose()
        this._source = undefined
        if (encoder && encoder.state !== 'closed') encoder.close()
    }
}
