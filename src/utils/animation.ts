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
    easeIn,
    easeInOut,
    easeOut,
    Easing,
    KeyframeOptions,
    linear,
} from 'popmotion'
import {timeout} from 'ts-browser-helpers'
import {MathUtils} from 'three'

export {animate}
export type {AnimationOptions, KeyframeOptions, Easing}

function easeInOutSine(x: number): number {
    return -(Math.cos(Math.PI * x) - 1) / 2
}

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
        if (typeof target?.setDirty === 'function') target.setDirty()
        setDirty?.()
    }
    if (v && typeof v.copy === 'function')
        return (a: any) => {
            v.copy(a)
            dirty()
        }
    else
        return (a: V)=>{
            target[key] = a
            dirty()
        }
}

export async function animateTarget<V>(target: any, key: string, options: AnimationOptions<V>, animations?: AnimateResult[]) {
    if (!(key in target)) {
        console.error('invalid key', key, target)
    }
    const setter = makeSetterFor(target, key)
    const fromVal = target[key]
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
    options = {...options}
    return new Promise<void>((resolve, reject) => {
        options.onComplete = ()=>{
            try {
                complete?.()
            } catch (e: any) {
                reject(e)
                return
            }
            resolve()
        }
        options.onStop = ()=>{
            try {
                stop?.()
            } catch (e: any) {
                reject(e)
                return
            }
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
