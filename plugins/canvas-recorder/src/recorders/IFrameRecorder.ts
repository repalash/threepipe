/**
 * Information about the frames of a recording, passed to {@link IFrameRecorder.start}.
 */
export interface FrameRecorderInfo {
    /**
     * Width of the recorded frames in pixels.
     */
    width: number
    /**
     * Height of the recorded frames in pixels.
     */
    height: number
    /**
     * Frames per second.
     */
    fps: number
}

/**
 * A frame-exact recorder. It receives every captured frame with its index, and writes the frames into a file (or a folder).
 * The canvas must be captured synchronously in {@link addFrame}, the encoding and writing can continue asynchronously.
 */
export interface IFrameRecorder {
    /**
     * Mime type of the result, like `video/mp4` or `application/zip`.
     */
    readonly mimeType: string
    /**
     * File extension of the result (without the dot), like `mp4` or `zip`.
     */
    readonly fileExtension: string
    /**
     * Number of frames that are captured but not encoded or written yet.
     */
    readonly pendingFrames: number

    /**
     * Prepare the recorder. Called before the first frame.
     * @param info - frame size and frame rate
     */
    start(info: FrameRecorderInfo): Promise<void>

    /**
     * Capture the current content of the canvas as the frame at `index`.
     * Must read the canvas before it returns, the encoding can be asynchronous.
     * @param canvas - the canvas to capture
     * @param index - frame index, starting at 0
     */
    addFrame(canvas: HTMLCanvasElement, index: number): void

    /**
     * Resolves when {@link pendingFrames} is at most `max`.
     * @param max - maximum number of pending frames
     */
    waitForPending(max: number): Promise<void>

    /**
     * Encode the remaining frames and return the result. `undefined` when the frames are written elsewhere, like into a folder.
     */
    finish(): Promise<Blob | undefined>

    /**
     * Stop and discard the recording.
     */
    cancel(): void
}

/**
 * Returns a canvas with the size of the recording for a source canvas.
 *
 * When the canvas has the recording size, the canvas itself is used.
 * When `allowCrop` is true and the canvas is at most 1px larger (an odd size cropped to an even size), the canvas is used with a crop rectangle.
 * In all other cases (like when the canvas is resized during the recording), the canvas is scaled into a 2D canvas of the recording size.
 */
export class FrameSource {
    private _scratch?: HTMLCanvasElement
    private _warned = false

    constructor(readonly width: number, readonly height: number, readonly allowCrop = false) {
    }

    /**
     * Get the image source and the visible rectangle for a frame.
     * @param canvas - the canvas to capture
     */
    get(canvas: HTMLCanvasElement): {source: HTMLCanvasElement, visibleRect?: DOMRectInit} {
        const dw = canvas.width - this.width
        const dh = canvas.height - this.height
        if (dw === 0 && dh === 0) return {source: canvas}
        if (this.allowCrop && dw >= 0 && dw <= 1 && dh >= 0 && dh <= 1) {
            return {source: canvas, visibleRect: {x: 0, y: 0, width: this.width, height: this.height}}
        }
        if (!this._warned) {
            console.warn(`CanvasRecorder: canvas size changed during the recording (${canvas.width}x${canvas.height}), frames are scaled to ${this.width}x${this.height}`)
            this._warned = true
        }
        if (!this._scratch) {
            this._scratch = document.createElement('canvas')
            this._scratch.width = this.width
            this._scratch.height = this.height
        }
        const ctx = this._scratch.getContext('2d')
        if (!ctx) throw new Error('CanvasRecorder: unable to create a 2d canvas context')
        ctx.clearRect(0, 0, this.width, this.height)
        ctx.drawImage(canvas, 0, 0, this.width, this.height)
        return {source: this._scratch}
    }

    dispose() {
        if (this._scratch) {
            this._scratch.width = 0
            this._scratch.height = 0
            this._scratch = undefined
        }
    }
}
