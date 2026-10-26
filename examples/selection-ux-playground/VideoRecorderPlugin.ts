import {AViewerPluginEventMap, AViewerPluginSync, ICamera, ProgressivePlugin, ThreeViewer} from 'threepipe'

export interface VideoRecordOptions {
    /** Frames per second, default 30 */
    fps?: number
    /** Output size in pixels (made even). Default: the canvas size. A different aspect crops the centre of the view. */
    width?: number
    height?: number
    /** Timeline range in seconds. Default: 0 to the timeline's end time */
    start?: number
    end?: number
    format?: 'mp4' | 'webm'
    /** 'final' waits for the progressive renderer (anti-aliasing, effects) to converge on every frame; slower */
    quality?: 'draft' | 'final'
    /** Bits per second; default from the size and fps */
    bitrate?: number
    /** Look through this camera while recording */
    camera?: ICamera
    signal?: AbortSignal
    /** After each frame; `frame` is the copy that went into the video */
    onProgress?: (done: number, frames: number, frame: HTMLCanvasElement) => void
}

export interface VideoRecordResult {
    blob: Blob
    /** File extension: mp4 or webm */
    ext: string
    frames: number
    width: number
    height: number
    /** 'frames': encoded frame by frame (exact timing); 'realtime': MediaRecorder fallback */
    method: 'frames' | 'realtime'
}

export interface VideoRecorderEventMap extends AViewerPluginEventMap {
    recordStart: {options: VideoRecordOptions}
    recordEnd: {result?: VideoRecordResult, error?: unknown}
}

interface FrameSink {
    method: VideoRecordResult['method']
    ext: string
    add(frame: HTMLCanvasElement, index: number): Promise<void>
    finish(): Promise<Blob>
    cancel(): void
}

/**
 * Records the timeline into a video file, frame by frame: for each frame it moves the timeline to the frame's time,
 * waits for the render (and, at 'final' quality, for the progressive renderer to converge), and encodes the canvas
 * with WebCodecs. Timing is exact however slow a frame is. The file is muxed with mp4-muxer / webm-muxer, loaded on
 * the first recording. Without WebCodecs it falls back to MediaRecorder in real time.
 *
 * It records only the canvas: DOM overlays (icons, panels, the timeline) never show. Things drawn into the canvas
 * (selection outline, grid, widgets) are the app's to hide; listen to `recordStart` / `recordEnd`.
 */
/** What this browser can do: encode frame by frame (WebCodecs), record mp4 or anything in real time (MediaRecorder) */
export function videoSupport() {
    return {
        frameByFrame: typeof (window as any).VideoEncoder === 'function' && typeof (window as any).VideoFrame === 'function',
        mp4: typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4'),
        realtime: typeof MediaRecorder !== 'undefined',
    }
}

export class VideoRecorderPlugin extends AViewerPluginSync<VideoRecorderEventMap> {
    static readonly PluginType = 'VideoRecorderPlugin'
    enabled = true

    /** ES module URLs of the muxers */
    muxerUrls = {
        mp4: 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm',
        webm: 'https://cdn.jsdelivr.net/npm/webm-muxer@5.1.4/+esm',
    }

    private _recording = false
    get recording() {
        return this._recording
    }

    async record(options: VideoRecordOptions = {}): Promise<VideoRecordResult> {
        const viewer = this._viewer
        if (!viewer) throw new Error('VideoRecorderPlugin: not added to a viewer')
        if (this._recording) throw new Error('VideoRecorderPlugin: already recording')
        this._recording = true
        const tl = viewer.timeline
        const fps = options.fps ?? 30
        const start = options.start ?? 0
        const end = options.end ?? (tl.endTime > 0 ? tl.endTime : 5)
        const frames = Math.max(1, Math.round((end - start) * fps))
        const canvas = viewer.canvas
        const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
        const W = even(options.width ?? canvas.width)
        const H = even(options.height ?? canvas.height)
        const format = options.format ?? 'mp4'
        const bitrate = options.bitrate ?? Math.round(Math.min(40e6, Math.max(2e6, W * H * fps * 0.12)))

        // state to restore
        const wasRunning = tl.running
        const oldTime = tl.time
        const rm = viewer.renderManager
        const oldScale = rm.renderScale
        const oldCamera = viewer.scene.mainCamera
        let wakeLock: {release(): Promise<void>} | undefined
        const cleanup = () => {
            wakeLock?.release().catch(() => undefined)
            if (rm.renderScale !== oldScale) rm.renderScale = oldScale
            if (viewer.scene.mainCamera !== oldCamera) oldCamera.activateMain()
            tl.setTime(oldTime)
            if (wasRunning) tl.start()
            this._recording = false
        }

        let sink: FrameSink | undefined
        try {
            this.dispatchEvent({type: 'recordStart', options})
            // keep the screen on: a sleeping screen hides the page
            wakeLock = await (navigator as any).wakeLock?.request('screen').catch(() => undefined)
            if (wasRunning) tl.stop()
            if (options.camera && options.camera !== oldCamera) options.camera.activateMain()
            // render at least as many pixels as the output, in the view's aspect; the copy crops the centre
            const cw = canvas.clientWidth || canvas.width
            const ch = canvas.clientHeight || canvas.height
            const scale = Math.max(W / cw, H / ch)
            if (Math.abs(scale - oldScale) > 1e-3) rm.renderScale = scale

            const copy = document.createElement('canvas')
            copy.width = W
            copy.height = H
            const ctx = copy.getContext('2d')!
            const grab = () => {
                const s = Math.min(canvas.width / W, canvas.height / H)
                const sw = W * s, sh = H * s
                ctx.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, W, H)
            }

            sink = videoSupport().frameByFrame ?
                await this._webCodecsSink(format, W, H, fps, bitrate).catch(e => {
                    console.warn('VideoRecorderPlugin: frame by frame encoding is not available, recording in real time', e)
                    return undefined
                }) : undefined
            sink = sink ?? this._mediaRecorderSink(copy, format, fps, bitrate)

            const progressive = viewer.getPlugin(ProgressivePlugin)
            // a hidden tab gets no animation frames (and slow timers): then the recorder runs the viewer's frames itself
            const runFrame = () => rm.animationLoop(performance.now())
            const nextFrame = async() => {
                if (document.hidden) return runFrame()
                return new Promise<void>(resolve => {
                    const onHide = () => document.hidden && runFrame()
                    document.addEventListener('visibilitychange', onHide)
                    viewer.doOnce('postFrame', () => {
                        document.removeEventListener('visibilitychange', onHide)
                        resolve()
                    })
                })
            }
            // a stop takes effect in the next frame and moves the clock on by that frame: let it pass before seeking
            if (wasRunning) await nextFrame()
            for (let i = 0; i < frames; i++) {
                if (options.signal?.aborted) throw new DOMException('Recording cancelled', 'AbortError')
                tl.setTime(start + i / fps)
                // the timeline moves the animations in the next frame, constraints follow their targets after it
                await nextFrame()
                await nextFrame()
                if (options.quality === 'final' && progressive) {
                    for (let n = 0; n < 512 && !progressive.isConverged(true); n++) await nextFrame()
                }
                grab()
                await sink.add(copy, i)
                options.onProgress?.(i + 1, frames, copy)
            }
            const blob = await sink.finish()
            const result: VideoRecordResult = {blob, ext: sink.ext, frames, width: W, height: H, method: sink.method}
            cleanup()
            this.dispatchEvent({type: 'recordEnd', result})
            return result
        } catch (error) {
            sink?.cancel()
            cleanup()
            this.dispatchEvent({type: 'recordEnd', error})
            throw error
        }
    }

    private async _webCodecsSink(format: 'mp4' | 'webm', width: number, height: number, fps: number, bitrate: number): Promise<FrameSink> {
        const videoEncoderClass = (window as any).VideoEncoder
        const videoFrameClass = (window as any).VideoFrame
        const mp4 = format === 'mp4'
        // H.264 levels from 5.2 down to 3.1, then VP9; the first the browser takes for this size
        const codecs = mp4 ?
            ['avc1.640034', 'avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f'] :
            ['vp09.00.40.08', 'vp09.00.10.08', 'vp8']
        let codec = ''
        for (const c of codecs) {
            const r = await videoEncoderClass.isConfigSupported({codec: c, width, height, bitrate, framerate: fps}).catch(() => null)
            if (r?.supported) {
                codec = c
                break
            }
        }
        if (!codec) throw new Error(`No ${format} video encoder for ${width}×${height}`)
        const M = await import(/* @vite-ignore */ this.muxerUrls[format])
        const target = new M.ArrayBufferTarget()
        const muxer = mp4 ?
            new M.Muxer({target, video: {codec: 'avc', width, height, frameRate: fps}, fastStart: 'in-memory'}) :
            new M.Muxer({target, video: {codec: codec === 'vp8' ? 'V_VP8' : 'V_VP9', width, height, frameRate: fps}})
        let error: unknown
        const encoder = new videoEncoderClass({
            output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
            error: (e: unknown) => error = e,
        })
        encoder.configure({codec, width, height, bitrate, framerate: fps, ...mp4 ? {avc: {format: 'avc'}} : {}})
        const us = 1e6 / fps
        return {
            method: 'frames',
            ext: format,
            add: async(frame, i) => {
                if (error) throw error
                const f = new videoFrameClass(frame, {timestamp: Math.round(i * us), duration: Math.round(us)})
                encoder.encode(f, {keyFrame: i % (fps * 2) === 0})
                f.close()
                // wait for the encoder; 'dequeue' also fires in a hidden tab, where timers are slowed down
                while (encoder.encodeQueueSize > 6) {
                    await new Promise<void>(r => 'ondequeue' in encoder ? encoder.addEventListener('dequeue', () => r(), {once: true}) : setTimeout(r, 4))
                }
            },
            finish: async() => {
                await encoder.flush()
                if (error) throw error
                encoder.close()
                muxer.finalize()
                return new Blob([target.buffer], {type: mp4 ? 'video/mp4' : 'video/webm'})
            },
            cancel: () => {
                if (encoder.state !== 'closed') encoder.close()
            },
        }
    }

    /** Fallback: MediaRecorder on the copy canvas, frames paced in real time (a slow frame shows longer) */
    private _mediaRecorderSink(copy: HTMLCanvasElement, format: 'mp4' | 'webm', fps: number, bitrate: number): FrameSink {
        const types = format === 'mp4' ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm'] : ['video/webm;codecs=vp9', 'video/webm']
        const mimeType = types.find(t => MediaRecorder.isTypeSupported(t))
        if (!mimeType) throw new Error('This browser cannot record video')
        const stream = (copy as any).captureStream(0) as MediaStream
        const track = stream.getVideoTracks()[0] as any
        const rec = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: bitrate})
        const chunks: Blob[] = []
        rec.ondataavailable = e => e.data.size && chunks.push(e.data)
        rec.start()
        const t0 = performance.now()
        return {
            method: 'realtime',
            ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
            add: async(_frame, i) => {
                const wait = t0 + i * 1000 / fps - performance.now()
                if (wait > 0) await new Promise(r => setTimeout(r, wait))
                track.requestFrame?.()
            },
            finish: async() => new Promise<Blob>(resolve => {
                rec.onstop = () => resolve(new Blob(chunks, {type: mimeType.split(';')[0]}))
                rec.stop()
                stream.getTracks().forEach(t => t.stop())
            }),
            cancel: () => {
                if (rec.state !== 'inactive') rec.stop()
                stream.getTracks().forEach(t => t.stop())
            },
        }
    }

    onRemove(viewer: ThreeViewer) {
        this._recording = false
        super.onRemove(viewer)
    }
}
