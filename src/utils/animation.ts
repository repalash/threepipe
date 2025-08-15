import {
    animate,
    AnimationOptions,
    anticipate,
    backIn,
    backInOut,
    backOut,
    bounceIn,
    bounceInOut,
    bounceOut,
    circIn,
    circInOut,
    circOut,
    DriverControls,
    easeIn,
    easeInOut,
    easeOut,
    Easing,
    KeyframeOptions,
    keyframes,
    linear,
    PlaybackOptions,
} from '@repalash/popmotion'
import {timeout} from 'ts-browser-helpers'
import {MathUtils} from 'three'

export {animate}

declare module '@repalash/popmotion'{
    interface PlaybackOptions<V> {
        // throwOnStop?: boolean; // instead of this, user can simply throw an error in onStop.
        onEnd?: () => void;
    }
}

export type {AnimationOptions, KeyframeOptions, Easing}

const easeInOutSine: Easing = (x) => -(Math.cos(Math.PI * x) - 1) / 2

// eslint-disable-next-line @typescript-eslint/naming-convention
export const EasingFunctions = {
    linear: linear,
    easeIn: easeIn,
    easeOut: easeOut,
    easeInOut: easeInOut,
    circIn: circIn,
    circOut: circOut,
    circInOut: circInOut,
    backIn: backIn,
    backOut: backOut,
    backInOut: backInOut,
    anticipate: anticipate,
    bounceOut: bounceOut,
    bounceIn: bounceIn,
    bounceInOut: bounceInOut,
    easeInOutSine: easeInOutSine,
}
/**
 * EasingFunctionType:
 * anticipate, backIn, backInOut, backOut, bounceIn, bounceInOut, bounceOut, circIn, circInOut, circOut, easeIn, easeInOut, easeOut, easeInOutSine
 */
export type EasingFunctionType = keyof typeof EasingFunctions

export type AnimateResult = ReturnType<typeof animate>

export function makeSetterFor<V>(target: any, key: string, setDirty?: ()=>void) {
    const v = target[key] as any
    const dirty = ()=>{
        // if (typeof target?.setDirty === 'function') target.setDirty()
        setDirty?.()
    }
    const isBool = typeof v === 'boolean'
    if (v && v.isColor)
        return (a: any) => {
            v.set(a)
            dirty()
        }
    else if (v && typeof v.copy === 'function')
        return (a: any) => {
            v.copy(a)
            dirty()
        }
    else
        return (a: V)=>{
            target[key] = !isBool ? a : !!a
            dirty()
        }
}

export async function animateTarget<V>(target: any, key: string, options: AnimationOptions<V>, animations?: AnimateResult[], forceCurrent = false) {
    if (!(key in target)) {
        console.error('invalid key', key, target)
    }
    const setter = makeSetterFor(target, key)
    const fromVal = forceCurrent || options.from === undefined ? target[key] : options.from
    const onUpdate = (val: V)=>{
        setter(val)
        options.onUpdate && options.onUpdate(val)
    }
    if (typeof fromVal === 'boolean') {
        const {duration} = options as KeyframeOptions // todo: divide by 2? or support keyframes.
        return timeout(duration ?? 0).then(()=>onUpdate(options.to as V))
    } else {
        if (typeof options.to === 'function') {
            options = {...options, to: options.to(fromVal, target)} // need to duplicate options
        }
        return animateAsync({
            ...options,
            from: fromVal,
            onUpdate,
        } as AnimationOptions<V>, animations)
    }
}

export async function animateAsync<V=number>(options: AnimationOptions<V>, animations?: AnimateResult[]) {
    const complete = options.onComplete
    const stop = options.onStop
    const end = options.onEnd
    options = {...options}
    return new Promise<void>((resolve, reject) => {
        const end2 = ()=>{
            try {
                end?.()
            } catch (e: any) {
                reject(e)
                return false
            }
            return true
        }
        options.onComplete = ()=>{
            try {
                complete?.()
            } catch (e: any) {
                if (!end2()) return
                reject(e)
                return
            }
            if (!end2()) return
            resolve()
        }
        options.onStop = ()=>{
            try {
                stop?.()
            } catch (e: any) {
                if (!end2()) return
                reject(e)
                return
            }
            if (!end2()) return
            resolve()
        }
        const an = animate(options)
        if (animations) animations.push(an)
    })
}

export function lerpAngle(a: number, b: number, t: number) {
    const d = b - a
    if (d >= Math.PI) {
        return a + (d - Math.PI * 2) * t
    } else if (d <= -Math.PI) {
        return a + (d + Math.PI * 2) * t
    } else {
        return a + d * t
    }
}

export const lerp = MathUtils.lerp

/**
 * Simplified version of popmption animate that supports seeking around the animation. Used in AnimationObject.ts
 * @param from
 * @param autoplay
 * @param driver
 * @param elapsed
 * @param onPlay
 * @param onStop
 * @param onComplete
 * @param onUpdate
 * @param delay
 * @param canComplete
 * @param options
 */
export function animateKeyframes<V = number>({
    from,
    autoplay = true,
    driver,
    elapsed = 0,
    onPlay,
    onStop,
    onComplete,
    onUpdate,
    delay = 0,
    canComplete = true,
    ...options
}: KeyframeOptions<V> & Omit<PlaybackOptions<V>, 'repeat' | 'repeatType' | 'repeatDelay' | 'onRepeat' | 'type'> & {delay?: number, canComplete?: boolean}) {
    const {to} = options
    let driverControls: DriverControls
    const computedDuration = (options as KeyframeOptions<V>).duration || 0
    let latest: V
    let isComplete = false

    const animation = keyframes({...options, from, to} as any)

    function complete() {
        driverControls.stop()
        onComplete && onComplete()
    }

    function update(delta: number) {
        const running = elapsed >= delay

        elapsed += delta

        if (elapsed < delay) {
            if (!running) return
        }

        const el = Math.max(0, elapsed - delay)

        if (!isComplete || el <= (computedDuration || 0)) {
            const state = animation.next(el)
            latest = state.value as any

            isComplete = state.done
        }

        onUpdate?.(latest)

        if (isComplete && canComplete) {
            complete()
        }
    }

    function play() {
        onPlay?.()
        driverControls = driver!(update)
        driverControls.start()
    }

    autoplay && play()

    return {
        stop: () => {
            onStop?.()
            driverControls.stop()
        },
    }
}
