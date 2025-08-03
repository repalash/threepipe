import {Clock, EventDispatcher} from 'three'
import {ThreeViewer} from '../viewer'
import {ProgressivePlugin} from '../plugins'
import {uiButton, uiFolderContainer, uiInput} from 'uiconfig.js'

@uiFolderContainer('Timeline')
export class ViewerTimeline extends EventDispatcher<{start: object, stop: object, reset: object, update: object}> {
    /**
     * in secs
     */
    @uiInput('Time', {readOnly: true})
        time = 0

    /**
     * in secs
     */
    @uiInput('Delta', {readOnly: true})
        delta = 0

    /**
     * Running state.
     */
    @uiInput('Running', {readOnly: true})
        running = false

    shouldRun() {
        return this.running || this._step
    }

    protected _clock = new Clock(false)

    private _start = false
    private _stop = false
    private _reset = false

    // this is seek, not step actually
    private _step = false

    @uiButton('Start')
    start() {
        this._start = true // start next frame
        if (this._stop) this._stop = false
        if (this._step) this._step = false
    }

    @uiButton('Stop')
    stop() {
        this._stop = true // stop next frame
        if (this._start) this._start = false
        if (this._step) this._step = false
    }

    // @uiButton('Step')
    // step() {
    //     if ((this.running || this._start) && !this._stop) return
    //     this._step = true // stop next frame
    // }

    @uiButton('Reset')
    reset() {
        this._reset = true // reset next frame
        if (this._step) this._step = false // dont step if called before reset
        // if (this._start) this._start = false
        // if (this._stop) this._stop = false
    }

    update(viewer: ThreeViewer) {
        if (this._stop) {
            this._clock.stop()
            this._start = false
            this._stop = false
            this.running = this._clock.running
            this.dispatchEvent({type: 'stop'})
        }
        if (this._start) {
            this._clock.start()
            this._clock.elapsedTime = this.time
            this._start = false
            this.running = this._clock.running
            this.dispatchEvent({type: 'start'})
        }
        if (this._reset) {
            this._clock.elapsedTime = 0
            this.time = 0
            this.delta = 0
            this._reset = false
            this.dispatchEvent({type: 'reset'})
        }
        this.running = this._clock.running

        if (!this.running) {
            this.delta = this._clock.getDelta() // this will return 0 always
            this.time = this._clock.elapsedTime
            return
        }
        const d = viewer.getPlugin<ProgressivePlugin>('ProgressivePlugin')?.postFrameConvergedRecordingDelta()
        if (d && d > 0) {
            // recorded frame
            this.delta = d / 1000
            this._clock.oldTime += d
            this._clock.elapsedTime += this.delta
            this.time = this._clock.elapsedTime
            // viewer.setDirty(this) // for next frame
            this.dispatchEvent({type: 'update'})
        } else if (d !== undefined && d === 0) {
            // recording, not converged yet.
            this.delta = 0
            this.time = this._clock.elapsedTime
        } else if (d === undefined || d < 0) {
            // not recording
            this.delta = this._clock.getDelta() // this updates oldTime and elapsedTime
            this.time = this._clock.elapsedTime
            // viewer.setDirty(this) // for next frame
            this.dispatchEvent({type: 'update'})
        }
    }

    // todo better name
    update2(_viewer: ThreeViewer) {
        this._step = false
    }


    setTime(t: number, stepFrame = true) {
        if (t < 0) t = 0
        this._clock.elapsedTime = t
        this.time = t
        this.delta = 0 // reset delta
        // this._start = false
        // this._stop = false
        this._reset = false
        if (!this._start) this._step = stepFrame
        this.dispatchEvent({type: 'update'})
    }
}
