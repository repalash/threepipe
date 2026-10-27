import {SimpleEventDispatcher} from 'ts-browser-helpers'

export type TRecorderStates = 'stopped' | 'recording' | 'paused' | 'error' | 'starting' | 'stopping'

export interface ICanvasRecorder<T extends string=any>
    extends SimpleEventDispatcher<T|TRecorderStates> {
    state: TRecorderStates;
    setOptions: (options: Partial<CanvasRecorderOptions>) => void;
    isRecording: () => boolean;
    requestFrame: () => boolean;
    dispose: () => void;
    options: CanvasRecorderOptions;
    start: () => void;
    pause: () => void;
    stop: (recordingCallback: (b: Blob) => void) => void;
}

export interface CanvasRecorderOptions {
    frameRate: number;
    mimeType: string;
    videoBitsPerSecond?: number;
    stepMode: boolean;
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

    abstract stop(recordingCallback: (b: Blob) => void): void

    protected _ondataavailable: (event: BlobEvent) => void = (event) => {
        if (event.data && event.data.size > 0) {
            this._currentRecording.push(event.data)
        }
    }

}
