import {SimpleEventDispatcher} from 'ts-browser-helpers'

export type TRecorderStates = 'stopped' | 'recording' | 'paused' | 'error' | 'starting' | 'stopping'

export interface ICanvasRecorder<T extends string=any>
    extends SimpleEventDispatcher<T|TRecorderStates> {
    state: TRecorderStates;
    setOptions: (options: Partial<CanvasRecorderOptions>) => void;
    isRecording: () => boolean;
    requestFrame: () => boolean;
    /** A frame still records, so the next frame would wait (a step-mode browser recorder) */
    isBusy?: () => boolean;
    /** Frames are still being written (a frame sink): the next frame waits for them, however long that takes */
    isWriting?: () => boolean;
    dispose: () => void;
    options: CanvasRecorderOptions;
    start: () => void;
    pause: () => void;
    /** Calls back with the recording; an image sequence (written to a folder or a frame sink) has none */
    stop: (recordingCallback: (b?: Blob) => void) => void;
}

/** One frame of an image sequence, given to {@link CanvasRecorderOptions.frameSink}. */
export interface CanvasRecorderFrame {
    blob: Blob;
    /** Starts at 0; frames come in order */
    index: number;
    /** The file name it would have in a folder: `frame_00001.png` */
    name: string;
    mimeType: string;
}

/**
 * Where the frames of an image sequence go: {@link DirectoryFrameSink} (the default where the browser can pick a folder),
 * {@link ZipFrameSink} (the default elsewhere), or your own.
 * Frames come one at a time and in order; a promise from `write` makes the next frame wait, in converge mode.
 */
export interface ICanvasFrameSink {
    /** Before the first frame. A promise delays the recording (a folder picker); an error ends the start in the error state */
    start?(): void | Promise<void>
    write(frame: CanvasRecorderFrame): void | Promise<void>
    /** After the last frame is written, before the recording stops: flush, or make the file. An error is reported */
    finish?(): void | Promise<void>
    /** The recording ended before it stopped (a dispose): let go of what it holds */
    dispose?(): void
}

/** A sink, or just its `write` */
export type CanvasFrameSink = ICanvasFrameSink | ((frame: CanvasRecorderFrame) => void | Promise<void>)

export interface CanvasRecorderOptions {
    frameRate: number;
    mimeType: string;
    videoBitsPerSecond?: number;
    stepMode: boolean;
    /** Image sequences: where the frames go. Default: a {@link DirectoryFrameSink}, or a {@link ZipFrameSink} where the browser can't pick a folder. A failure is reported when the recording stops. */
    frameSink?: CanvasFrameSink;
}

/**
 * Base class for the canvas recorders used by {@link CanvasRecorderPlugin}.
 */
export abstract class ACanvasRecorder<T extends string=any>
    extends SimpleEventDispatcher<T|TRecorderStates>
    implements ICanvasRecorder<T> {
    options: CanvasRecorderOptions
    protected _canvas: HTMLCanvasElement
    private _state: TRecorderStates = 'stopped'
    protected _console = console
    protected _currentRecording: Blob[] = []

    get state() {
        return this._state
    }

    setState(value: 'stopped' | 'recording' | 'paused' | 'error' | 'starting' | 'stopping', event?: any) {
        this._state = value
        this.dispatchEvent({type: value, ...event})
    }

    protected _setOptions(value: Partial<CanvasRecorderOptions>) {
        Object.assign(this.options, value)
    }

    public setOptions(options: Partial<CanvasRecorderOptions>) {
        // todo: remove undefined keys and values from options
        this._setOptions(options)
    }

    constructor(canvas: HTMLCanvasElement, options?: Partial<CanvasRecorderOptions>) {
        super()
        this._canvas = canvas
        this.options = {
            mimeType: 'auto',
            frameRate: 30,
            stepMode: false,
        }
        this._setOptions(options || this.options)
    }

    public isRecording() {
        return this._state === 'recording'
    }

    protected _frameCount = 0

    requestFrame() {
        if (this._state !== 'recording') return false
        this._frameCount++
        return true
    }

    dispose() {
        if (this.isRecording() || this._state === 'paused') {
            this.stop((b) => {
                this._console.warn('disposed with blob', b)
                this.dispose()
            })
            return
        }
    }

    abstract start(): void

    abstract pause(): void

    abstract stop(recordingCallback: (b?: Blob) => void): void

    protected _ondataavailable: (event: BlobEvent) => void = (event) => {
        if (event.data && event.data.size > 0) {
            this._currentRecording.push(event.data)
        }
    }

}
