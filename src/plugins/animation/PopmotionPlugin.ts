import {now} from 'ts-browser-helpers'
import {animate, type AnimationOptions, Driver, KeyframeOptions, PlaybackOptions} from '@repalash/popmotion' // todo: its not able to import from fork anymore since animateKeyframes is used, it can be imported from main.
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {FrameFadePlugin} from '../pipeline/FrameFadePlugin'
import type {ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import {generateUUID} from '../../three'
import {
    animateCameraToViewLinear,
    animateCameraToViewSpherical,
    EasingFunctions,
    extractAnimationKey,
    IAnimationObject,
    IAnimSet,
    makeSetterFor,
} from '../../utils'
import {ICamera, ICameraView} from '../../core'
import {animateKeyframes} from '../../utils/animation'

export interface AnimationResult{
    id: string
    promise: Promise<string>
    options: AnimationOptions<any>
    stop: () => void
    anims: AnimationResult[]
    stopped?: boolean
    // completed: boolean

    // eslint-disable-next-line @typescript-eslint/naming-convention
    _stop?: () => void
}

/**
 * Popmotion plugin
 *
 * Provides animation capabilities to the viewer using the popmotion library: https://popmotion.io/
 *
 * Overrides the driver in popmotion to sync with the viewer and provide ways to keep track and stop animations.
 *
 * @category Plugins
 */
export class PopmotionPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'PopmotionPlugin'
    enabled = true

    toJSON: any = undefined // disable serialization
    fromJSON: any = undefined // disable serialization

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this._postFrame = this._postFrame.bind(this)
    }

    // private _animating = false
    private _lastFrameTime = 0 // for post frame
    private _lastPreFrameTime = 0 // for pre frame
    private _updaters: {u: ((timestamp: number) => void), time: number}[] = []
    private _timelineUpdaters: {u: ((timestamp: number) => void), time: number}[] = []

    dependencies = []

    private _fadeDisabled = false

    /**
     * Disable the frame fade plugin while animation is running
     */
    disableFrameFade = true

    autoIncrementTime = true

    // Same code used in CameraViewPlugin
    private _postFrame = ()=>{
        if (!this._viewer) return
        if (this.isDisabled() || Object.keys(this._updaters).length < 1) {
            this._lastFrameTime = 0
            // console.log('not anim')
            if (this._fadeDisabled) {
                this._viewer.getPlugin<FrameFadePlugin>('FrameFade')?.enable(this)
                this._fadeDisabled = false
            }
            return
        }

        let delta
        if (this.autoIncrementTime) {
            const time = now() / 1000.0
            if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 60.0
            delta = time - this._lastFrameTime

            this._lastFrameTime = time

            const d = this._viewer.getPlugin<ProgressivePlugin>('Progressive')?.postFrameConvergedRecordingDelta()
            if (d && d > 0) delta = d
            if (d === 0) delta = 0 // not converged yet.
            // if d < 0: not recording, do nothing

        } else {
            const time = this._viewer.timeline.time
            // if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 60.0
            delta = time - this._lastFrameTime

            this._lastFrameTime = time
        }

        // todo: scrolling
        // delta = delta * (this.animateOnScroll ? this._scrollAnimationState : 1)

        delta *= 1000

        // delta = 16.666 // testing

        if (Math.abs(delta) <= 0.0001) return

        this._updaters.forEach(u=>{
            let dt = delta
            if (u.time + dt < 0) dt = -u.time
            u.time += dt
            if (Math.abs(dt) > 0.001)
                u.u(dt)
        })

        if (!this._fadeDisabled && this.disableFrameFade) {
            const ff = this._viewer.getPlugin<FrameFadePlugin>('FrameFade')
            if (ff) {
                ff.disable(this)
                this._fadeDisabled = true
            }
        }

        // todo: scrolling
        // if (this._scrollAnimationState < 0.001) this._scrollAnimationState = 0
        // else this._scrollAnimationState *= 1.0 - this.scrollAnimationDamping
    }
    private _preFrame = ()=>{
        if (!this._viewer) return
        if (this.isDisabled() || Object.keys(this._timelineUpdaters).length < 1) {
            this._lastPreFrameTime = 0
            return
        }

        const time = this._viewer.timeline.time * 1000
        // if (this._lastPreFrameTime < 1) this._lastPreFrameTime = time - 1.0 / 60.0
        const delta = time - this._lastPreFrameTime

        this._lastPreFrameTime = time

        if (Math.abs(delta) <= 0.0001) return

        // dont clamp delta

        this._timelineUpdaters.forEach(u=>{
            let dt = delta
            if (u.time !== time) dt = time - u.time
            if (u.time + dt < 0) dt = -u.time
            u.time += dt
            if (Math.abs(dt) > 0.001) u.u(dt)
        })
    }

    readonly defaultDriver: Driver = (update)=>{
        return {
            start: ()=>this._updaters.push({u:update, time:0}),
            stop: ()=> {
                const index = this._updaters.findIndex(u => u.u === update)
                if (index >= 0) this._updaters.splice(index, 1)
            },
        }
    }
    readonly timelineDriver: Driver = (update)=> ({
        start: () => this._timelineUpdaters.push({u: update, time: 0}),
        stop: () => {
            const index = this._timelineUpdaters.findIndex(u => u.u === update)
            if (index >= 0) this._timelineUpdaters.splice(index, 1)
        },
    })



    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        viewer.addEventListener('postFrame', this._postFrame)
        viewer.addEventListener('preFrame', this._preFrame)
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.removeEventListener('postFrame', this._postFrame)
        super.onRemove(viewer)
    }

    readonly animations: Record<string, AnimationResult> = {}

    animate<V>(options1: AnimationOptions<V> & {target?: any, key?: string/* , delay?: number, canComplete?: boolean*/}, animateFunc?: typeof animate | typeof animateKeyframes): AnimationResult {
        const {target, key, ...options} = {...options1} as ((typeof options1) & {lastOnUpdate?: (a:V)=>void})
        let from = options.from
        let to = options.to
        if (target !== undefined) {
            if (key === undefined) throw new Error('PopmotionPlugin - key must be defined when animating in target')
            if (!(key in target)) {
                this._viewer?.console.warn('PopmotionPlugin - key not present in target, creating', key, target)
                target[key] = from ?? 0
            }
            const setter = makeSetterFor(target, key)
            const fromVal = ()=>target[key]
            options.lastOnUpdate = options.onUpdate
            options.onUpdate = (val: V)=>{
                setter(val)
                options.lastOnUpdate && options.lastOnUpdate(val)
            }
            if (from === undefined && (!Array.isArray(to) || to.length < 2)) from = fromVal()
        }

        const a = this.createAnimationResult(options)
        a.promise = new Promise<void>((resolve, reject) => {
            const end2 = ()=>{
                try {
                    options.onEnd && options.onEnd()
                } catch (e: any) {
                    reject(e)
                    return false
                }
                return true
            }
            //
            // const kf = []
            // const off = []
            // if (from !== undefined) {
            //     kf.push(from)
            //     off.push(0)
            //     console.log('from', from, options)
            // }
            // if (Array.isArray(to)) {
            //     kf.push(...to)
            //     const opOff = (options as KeyframeOptions).offset || []
            //     for (const n of opOff) {
            //         off.push(n)
            //     }
            //     if (to.length !== opOff.length) {
            //         console.warn('PopmotionPlugin - to and offset length mismatch', kf, off, options)
            //         for (let i = opOff.length; i < to.length; i++) {
            //             off.push(1)
            //         }
            //     }
            // } else {
            //     if (to !== undefined) {
            //         kf.push(to)
            //         off.push(1)
            //     }
            // }

            // from = kf[0] as any
            const from1 = from ?? (Array.isArray(to) ? to[0] : from)
            if (from1 === undefined) {
                console.warn('from is undefined', options)
                resolve()
                return
            }
            const isBool = typeof from1 === 'boolean'
            // const duration = (options as KeyframeOptions).duration
            // if (duration !== undefined && delay !== undefined && delay > 0 && kf.length > 0) {
            //     kf.splice(1, 0, from)
            //     off.splice(1, 0, delay / (duration + delay))
            // }
            // console.log(kf, off)

            if (Array.isArray(to) && to.length < 2) {
                to = to[0] as any
            }

            const opts: AnimationOptions<V> = {
                ...options,
                driver: options.driver || this.defaultDriver,
                // duration: duration !== undefined ? duration + (delay || 0) : undefined,
                // to: !isBool ? [...kf] as any : kf.map((v: number)=>v >= 1 ? true : false) as any,
                to: to as any,
                from: from,
                // from: undefined,
                // to: options.to,
                // from: options.from,
                // offset: [...off],
                onUpdate: (v)=>{
                    if (!options.onUpdate) return
                    // console.log(v)
                    if (isBool) options.onUpdate((v as number) >= 1 ? true : false as any)
                    else options.onUpdate(v)
                },
                onComplete: async()=>{
                    // a.completed = true
                    // this._drivers[a.id]?.stop()
                    try {
                        // if (isBool && !this.animations[uuid].stopped) options.onUpdate?.(to as any)
                        options.onComplete && await options.onComplete()
                    } catch (e: any) {
                        if (!end2()) return
                        reject(e)
                        return
                    }
                    if (!end2()) return
                    resolve()
                },
                onStop: async()=>{
                    try {
                        options.onStop && await options.onStop()
                    } catch (e: any) {
                        if (!end2()) return
                        reject(e)
                        return
                    }
                    resolve()
                },
            }
            const anim = animateFunc ? animateFunc(opts) : animate(opts)
            a._stop = anim.stop
            a.options = opts
        }).then(()=>{
            delete this.animations[a.id]
            return a.id
        })

        return a
    }

    async animateAsync<V>(options: AnimationOptions<V>& {target?: any, key?: string}, animations?: AnimationResult[]): Promise<string> {
        const anim = this.animate(options)
        if (animations) animations.push(anim)
        return anim.promise
    }

    // region animation utils

    /**
     * Similar to animate, but specifically for numbers, defaults from 0 to 1. Also calls onUpdate with the delta value.
     * @param options
     */
    animateNumber(options: Omit<PlaybackOptions<number> & KeyframeOptions<number>, 'from'|'to'|'onUpdate'> & {
        from?: number,
        to?: number,
        onUpdate?: (value: number, delta: number) => void
    }): AnimationResult {
        let lastVal = options.from ?? 0
        return this.animate({
            ...options,
            from: lastVal,
            to: options.to ?? 1,
            onUpdate: (v: number) => {
                const dv = v - lastVal
                lastVal = v
                options.onUpdate && options.onUpdate(v, dv)
            },
        })
    }

    timeout(ms: number, options?: AnimationOptions<number>/* &{delay?: number, canComplete?: boolean}*/): AnimationResult {
        return this.animate({
            from: 0, to: ms, duration: ms,
            ...options,
        })
    }

    async animateTargetAsync<T>(target: T, key: keyof T, options: AnimationOptions<T[keyof T]>, animations?: AnimationResult[]): Promise<string> {
        const anim = this.animate({...options, target, key: key as string})
        if (animations) animations.push(anim)
        return anim.promise
    }

    /**
     * @deprecated - use {@link animate} instead
     * @param target
     * @param key
     * @param options
     */
    animateTarget<T>(target: T, key: keyof T, options: AnimationOptions<T[keyof T]>/* &{delay?: number, canComplete?: boolean}*/): AnimationResult {
        return this.animate({...options, target, key: key as string})
    }

    animateCamera(camera: ICamera, view: ICameraView, spherical = true, options?: Partial<AnimationOptions<any>>) {
        const anim = spherical ?
            animateCameraToViewSpherical(camera, view) :
            animateCameraToViewLinear(camera, view)
        return this.animate({
            ease: EasingFunctions.linear,
            ...anim, ...options,
            duration: ((options as KeyframeOptions).duration ?? 1000) * (view.duration ?? 1),
        })
    }

    async animateCameraAsync(camera: ICamera, view: ICameraView, spherical = true, options?: Partial<AnimationOptions<any>>, animations?: AnimationResult[]) {
        const anim = this.animateCamera(camera, view, spherical, options)
        if (animations) animations.push(anim)
        return anim.promise
    }

    // endregion animation utils

    createAnimationResult(options: AnimationOptions<any> = {}) {
        const uuid = generateUUID()
        return this.animations[uuid] = {
            id: uuid,
            options: options,
            stop: () => this.stopAnimationResult(uuid),
            stopped: false,
            ['_stop']: () => {
                return
            },
            anims: [] as AnimationResult[],
            promise: undefined as any,
            // completed: false,
        }
    }

    stopAnimationResult(uuid: string) {
        const a1 = this.animations[uuid]
        if (!a1 || a1.stopped) return
        if (!a1._stop) console.warn('Animation not started')
        else if (typeof a1._stop === 'function') a1._stop()
        a1.anims?.forEach(anim => anim.stop())
        a1.stopped = true
    }

    // region animation object

    animateObject<V>(o: IAnimationObject<V>, delay?: number, canComplete = true, driver?: Driver, delay2?: number): AnimationResult {
        // if (typeof o.animate === 'function' && _external) {
        //     return o.animate(delay, canComplete)
        // }
        const {key: key1, tar, onChange: accOnUpdate} = extractAnimationKey(o)
        let key = key1
        if (tar && key && !(key in tar)) {
            console.error('PopmotionPlugin invalid key', key, tar, o)
            // throw ''
            key = undefined
        }

        const a = this.createAnimationResult(o.options)
        if (canComplete) o.result = a
        delay = (delay || 0) + ((delay2 ?? o.delay) || 0)
        a.anims = o.animSet ? [...a.anims, this.animateSet(o.animSet, o.animSetParallel ?? false, delay, canComplete, driver)] : a.anims
        const oUpdaters = o.updater ?? []

        const opts = !key || !tar ? {
            to: [0, 1],
        } : {
            target: tar, key,
            to: o.values,
            offset: o.offsets,
        }

        // todo add repeat, repeatDelay, repeatType by changing `to` and duration

        a.anims.push(this.animate({
            ...opts,
            driver,
            ease: typeof o.ease === 'string' ? EasingFunctions[o.ease] : o.ease,
            duration: o.duration,
            ...o.options,
            // @ts-expect-error implemented in animateKeyframes
            canComplete, delay,
            onUpdate: (v) => {
                o.options.onUpdate && o.options.onUpdate(v as any)
                accOnUpdate && accOnUpdate()
                oUpdaters.forEach(value => value && value())
            },
        }, animateKeyframes)) // animateKeyframes implements delay and canComplete

        a.promise = Promise.all(a.anims.map(async n=>n.promise)).then(()=>{
            // a.completed = true
            a.anims = []
            delete this.animations[a.id]
            if (o.result === a) o.result = undefined
            return a.id
        })
        return a
    }

    animateSet(anims: IAnimSet, parallel = false, delay1 = 0, canComplete = true, driver?: Driver): AnimationResult {
        const a = this.createAnimationResult()
        if (parallel) {
            a.anims = anims.map(anim => this.animateObject(anim, delay1, canComplete, driver))
        } else {
            let d = delay1
            for (const anim of anims) {
                a.anims.push(this.animateObject(anim, d, canComplete, driver))
                const {
                    delay = 0,
                    duration = 0,
                    options,
                } = anim

                d += delay + duration + (duration + (options.repeatDelay || 0)) * (options.repeat || 0)
            }
        }
        a.promise = Promise.all(a.anims.map(async n=>n.promise)).then(()=>{
            // a.completed = true
            a.anims = []
            delete this.animations[a.id]
            return a.id
        })
        return a
    }

    // endregion animation object

}
