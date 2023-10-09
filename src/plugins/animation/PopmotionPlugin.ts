import type {Driver} from 'popmotion/lib/animations/types'
import {now} from 'ts-browser-helpers'
import {animate, type AnimationOptions} from 'popmotion'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import type {FrameFadePlugin} from '../pipeline/FrameFadePlugin'
import type {ProgressivePlugin} from '../pipeline/ProgressivePlugin'
import {generateUUID} from '../../three'
import {makeSetterFor} from '../../utils'

export interface AnimationResult{
    id: string
    promise: Promise<string>
    options: AnimationOptions<any>
    stop: () => void
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _stop?: () => void

    targetRef?: {target: any, key: string}
}

/**
 * Popmotion plugin
 *
 * Provides animation capabilities to the viewer using the popmotion library: https://popmotion.io/
 *
 * Overrides the driver in popmotion to sync with the viewer and provide ways to keep track and stop animations.
 *
 * @category Plugin
 */
export class PopmotionPlugin extends AViewerPluginSync<''> {
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
    private _updaters: {u: ((timestamp: number) => void), time: number}[] = []

    dependencies = []

    private _fadeDisabled = false
    /**
     * Disable the frame fade plugin while animation is running
     */
    disableFrameFade = true

    // Same code used in CameraViewPlugin
    private _postFrame = ()=>{
        if (!this._viewer) return
        if (!this.enabled || Object.keys(this.animations).length < 1) {
            this._lastFrameTime = 0
            // console.log('not anim')
            if (this._fadeDisabled) {
                this._viewer.getPlugin<FrameFadePlugin>('FrameFade')?.enable(PopmotionPlugin.PluginType)
                this._fadeDisabled = false
            }
            return
        }
        const time = now() / 1000.0
        if (this._lastFrameTime < 1) this._lastFrameTime = time - 1.0 / 60.0
        let delta = time - this._lastFrameTime
        this._lastFrameTime = time

        // todo: scrolling
        // delta = delta * (this.animateOnScroll ? this._scrollAnimationState : 1)

        const d = this._viewer.getPlugin<ProgressivePlugin>('Progressive')?.postFrameConvergedRecordingDelta()
        if (d && d > 0) delta = d
        if (d === 0) return // not converged yet.
        // if d < 0: not recording, do nothing

        delta *= 1000

        // delta = 16.666 // testing

        if (delta <= 0.001) return

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
                ff.disable(PopmotionPlugin.PluginType)
                this._fadeDisabled = true
            }
        }

        // todo: scrolling
        // if (this._scrollAnimationState < 0.001) this._scrollAnimationState = 0
        // else this._scrollAnimationState *= 1.0 - this.scrollAnimationDamping
    }

    readonly defaultDriver: Driver = (update)=>{
        return {
            start: ()=>this._updaters.push({u:update, time:0}),
            stop: ()=> this._updaters.splice(this._updaters.findIndex(u=>u.u === update), 1),
        }
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        viewer.addEventListener('postFrame', this._postFrame)
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.removeEventListener('postFrame', this._postFrame)
        super.onRemove(viewer)
    }

    readonly animations: Record<string, AnimationResult> = {}

    animateTarget<T>(target: T, key: keyof T, options: AnimationOptions<T[keyof T]>): AnimationResult {
        return this.animate({...options, target, key: key as string})
    }

    animate<V>(options1: AnimationOptions<V> & {target?: any, key?: string}): AnimationResult {
        let targetRef = undefined
        const options = {...options1} as ((typeof options1) & {lastOnUpdate?: (a:V)=>void})
        if (options.target !== undefined) {
            if (options.key === undefined) throw new Error('key must be defined')
            if (!(options.key in options.target)) {
                console.warn('key not present in target, creating', options.key, options.target)
                options.target[options.key] = options.from || 0
            }
            const setter = makeSetterFor(options.target, options.key)
            const fromVal = options.target[options.key]
            options.lastOnUpdate = options.onUpdate
            options.onUpdate = (val: V)=>{
                setter(val)
                options.lastOnUpdate && options.lastOnUpdate(val)
            }
            targetRef = {target: options.target, key: options.key}
            if (options.from === undefined) options.from = fromVal
            delete options.target
            delete options.key
        }

        const uuid = generateUUID()
        const a: AnimationResult = {
            id: uuid,
            options,
            stop: ()=>{
                if (!this.animations[uuid]?._stop) console.warn('Animation not started')
                else this.animations[uuid]?._stop?.()
            },
            promise: undefined as any,
            targetRef,
        }
        this.animations[uuid] = a
        a.promise = new Promise<void>((resolve, reject) => {
            const opts: AnimationOptions<V> = {
                driver: this.defaultDriver,
                ...options,
                onComplete: ()=>{
                    try {
                        options.onComplete && options.onComplete()
                    } catch (e: any) {
                        reject(e)
                        return
                    }
                    resolve()
                },
                onStop: ()=>{
                    try {
                        options.onStop && options.onStop()
                    } catch (e: any) {
                        reject(e)
                        return
                    }
                    resolve()
                },
            }
            // todo: support boolean using timeout.
            const anim = animate(opts)
            this.animations[uuid]._stop = anim.stop
            this.animations[uuid].options = opts
        }).then(()=>{
            delete this.animations[uuid]
            return uuid
        })

        return this.animations[uuid]
    }

    async animateAsync<V>(options: AnimationOptions<V>& {target?: any, key?: string}): Promise<string> {
        return this.animate(options).promise
    }

    async animateTargetAsync<T>(target: T, key: keyof T, options: AnimationOptions<T[keyof T]>): Promise<string> {
        return this.animate({...options, target, key: key as string}).promise
    }

    // todo : animateObject/animateTarget
}
