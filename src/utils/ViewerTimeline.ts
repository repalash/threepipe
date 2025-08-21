import {Clock, EventDispatcher} from 'three'
import {ThreeViewer} from '../viewer'
import {ProgressivePlugin} from '../plugins'
import {uiButton, uiFolderContainer, uiInput, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {onChangeDispatchEvent, serializable, serialize} from 'ts-browser-helpers'
import {OnChangeDispatchEventType} from './browser-helpers'

export interface ViewerTimelineEventMap{
    start: object,
    stop: object,
    reset: object,
    update: object,
    resetOnEndChanged: OnChangeDispatchEventType<boolean>,
    stopOnEndChanged: OnChangeDispatchEventType<boolean>,
    endTimeChanged: OnChangeDispatchEventType<number>
}

@serializable('ViewerTimeline')
@uiFolderContainer('Timeline')
export class ViewerTimeline extends EventDispatcher<ViewerTimelineEventMap> {
    declare uiConfig: UiObjectConfig
    protected _time = 0

    /**
     * Current time in secs
     */
    @uiInput('Time', {readOnly: true})
    get time() {
        return this._time
    }

    /**
     * Set the current time and step a frame
     * @param value
     */
    set time(value: number) {
        if (this._time === value) return
        this.setTime(value, true)
    }

    /**
     * in secs
     */
    @uiInput('Delta', {readOnly: true})
        delta = 0

    /**
     * Maximum time in secs.
     * This is used to limit the time in the timeline.
     * Set to 0 to disable the limit.
     */
    @uiInput('Max Time')
    @serialize()
    @onChangeDispatchEvent('endTimeChanged')
        endTime = 2

    /**
     * Reset the timeline time to 0 when the timeline ends.
     * It is applicable only when the timeline is running and `endTime` is set to a value greater than 0.
     * This can be used to loop the timeline.
     * @default true
     */
    @uiToggle('Reset on End')
    @serialize()
    @onChangeDispatchEvent('resetOnEndChanged')
        resetOnEnd = true

    /**
     * Stop the timeline when it reaches the end.
     * This is applicable only when the timeline is running and `endTime` is set to a value greater than 0.
     * This can be used to stop the timeline when it reaches the end.
     * It is separate from `resetOnEnd`, the timeline is stopped and then reset when both are true.
     * @default false
     */
    @uiToggle('Stop on End')
    @serialize()
    @onChangeDispatchEvent('stopOnEndChanged')
        stopOnEnd = false

    /**
     * Running state.
     */
    @uiInput('Running', {readOnly: true})
        running = false

    /**
     * Returns true if the timeline is running or if it is set to step this/next frame.
     */
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
        this._refreshParams()
        if (!this.running) {
            this.delta = this._clock.getDelta() // this will return 0 always
            this._time = this._clock.elapsedTime
            return
        }
        const d = viewer.getPlugin<ProgressivePlugin>('ProgressivePlugin')?.postFrameConvergedRecordingDelta()
        if (d && d > 0) {
            // recorded frame
            this.delta = d / 1000
            this._clock.oldTime += d
            this._clock.elapsedTime += this.delta
            this._time = this._clock.elapsedTime
            // viewer.setDirty(this) // for next frame
            this.dispatchEvent({type: 'update'})
        } else if (d !== undefined && d === 0) {
            // recording, not converged yet.
            this.delta = 0
            this._time = this._clock.elapsedTime
        } else if (d === undefined || d < 0) {
            // not recording
            this.delta = this._clock.getDelta() // this updates oldTime and elapsedTime
            this._time = this._clock.elapsedTime
            // viewer.setDirty(this) // for next frame
            this.dispatchEvent({type: 'update'})
        }
        this._refreshParams()
    }

    private _refreshParams() {
        const isEnd = this.endTime > 0 && this.time >= this.endTime && this.running
        const isReset = this.resetOnEnd && isEnd
        const isStop = this.stopOnEnd && isEnd
        if (this._stop || isStop) {
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
        if (this._reset || isReset) {
            this._clock.elapsedTime = 0
            this.time = 0
            this.delta = 0
            this._reset = false
            this.dispatchEvent({type: 'reset'})
        }
        this.running = this._clock.running
    }

    // todo better name
    update2(_viewer: ThreeViewer) {
        this._step = false
    }

    setTime(t: number, stepFrame = true) {
        if (t < 0) t = 0
        this._clock.elapsedTime = t
        this._time = t
        this.delta = 0 // reset delta
        // this._start = false
        // this._stop = false
        this._reset = false
        if (!this._start) this._step = stepFrame
        this.dispatchEvent({type: 'update'})
    }
}
