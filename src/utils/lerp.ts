import {Color, Texture} from 'three'
import {IRenderManager, ITexture} from '../core'
import {whiteTexture} from '../three'

export interface AnimateTime {t: number, dt: number, rm?: IRenderManager}

// See https://repalash.com/blog/interactive-lerp-animation for details

export function lerpVal(time: AnimateTime&{from?: number|Color|any}, val: number|Color|any, end: number|Color|any): number|Color|any {
    if (typeof val === 'number' && typeof end === 'number') {
        return lerpNumber(time, val, end)
    }
    if (typeof (val as Color)?.r === 'number' && typeof (end as Color)?.r === 'number') {
        return new Color().set(
            lerpNumber(time.from ? {...time, from: (time.from as Color).r} : time, (val as Color).r, (end as Color).r),
            lerpNumber(time.from ? {...time, from: (time.from as Color).g} : time, (val as Color).g, (end as Color).g),
            lerpNumber(time.from ? {...time, from: (time.from as Color).b} : time, (val as Color).b, (end as Color).b)
        )
    }
    if (val?.toArray && end?.toArray && val.clone && val.fromArray) {
        return lerpVector(time, val, end)
    }
    // not handling textures here specifically, to avoid texture arrays for now
    return time.t >= 1 ? end : val
}

export function lerpNumber(time: AnimateTime&{from?: number}, val: number, end: number): number {
    const {t, dt} = time
    let newVal
    if (t <= 0) newVal = time.from !== undefined ? time.from : val
    else if (t >= 1.) newVal = end
    else if (time.from !== undefined) {
        newVal = time.from * (1 - t) + end * t
    } else {
        const l = 1 - t
        const k = Math.max(0, Math.min(dt, l) / l)
        newVal = val + (end - val) * k
    }
    return newVal
}

export function lerpVector(time: AnimateTime&{from?: any}, val: any, end: any): any {
    const valA = val.toArray() as any[]
    const endA = end.toArray() as any[]
    const fromA = time.from ? time.from.toArray() : undefined
    const newValA = valA.map((v, i) => lerpVal(fromA ? {...time, from: fromA[i]} : time, v, endA[i]))
    const newVal = val.clone().fromArray(newValA)
    return newVal
}

export function lerpTexture(time: AnimateTime&{from?: ITexture|null}, val: ITexture|null, end: ITexture|null): ITexture |null {
    if (!time.rm) {
        console.warn('MaterialManager: RenderManager is required for interpolating textures')
        return end
    }
    const {t, dt} = time
    let newVal
    const fromVal = time.from !== undefined ? time.from : val
    if (t <= 0 || t > 0.99 || fromVal === end) {
        newVal = t <= 0 ? fromVal : end
        let rt
        if (val && (val.userData as any)?._lerpTexture && val.isRenderTargetTexture) {
            rt = val._target
        }
        if (rt) {
            time.rm.releaseTempTarget(rt)
        }
    } else {

        const val1 = fromVal || whiteTexture
        let needsInit = false

        let rt
        if (val && (val.userData as any)?._lerpTexture && val.isRenderTargetTexture) {
            rt = val._target
        } else {
            const anyTex = fromVal || end || whiteTexture
            const size = {
                width: anyTex.image?.width || anyTex.image?.naturalWidth || anyTex.image?.videoWidth || 1,
                height: anyTex.image?.height || anyTex.image?.naturalHeight || anyTex.image?.videoHeight || 1,
            }
            rt = time.rm.getTempTarget({
                size: size,
                colorSpace: anyTex.colorSpace,
                type: anyTex.type,
                format: anyTex.format,
                generateMipmaps: anyTex.generateMipmaps,
                minFilter: anyTex.minFilter,
                magFilter: anyTex.magFilter,
                wrapS: anyTex.wrapS,
                wrapT: anyTex.wrapT,
            });
            (rt.texture as Texture).userData._lerpTexture = true
            needsInit = true
        }
        if (rt) {
            if (time.from !== undefined || needsInit) {
                time.rm.blit(rt, {
                    source: val1,
                    respectColorSpace: false,
                    transparent: true,
                    clear: true,
                })
            }
            const l = 1 - t
            const k = Math.max(0, Math.min(dt, l) / l)
            // newVal = val + (end - val) * k
            // newVal = val * (1 - k) + end * k

            time.rm.blit(rt, {
                source: end || whiteTexture,
                respectColorSpace: false,
                transparent: true,
                clear: false,
                blendAlpha: time.from !== undefined ? t : k,
                // blending: NormalBlending,
            })
            newVal = rt.texture as ITexture
        } else {
            newVal = val
        }
    }
    return newVal
}

export function lerpParams(params: Record<string, any>, obj: Record<string, any>, interpolateProps: Set<string>, time: AnimateTime & {from?: Record<string, any>}) {
    for (const key of Object.keys(params)) {
        if (!interpolateProps.has(key)) continue
        const val = obj[key]
        if (val === undefined) continue
        const time2 = time.from ? {...time, from: time.from[key]} : (time as AnimateTime)
        const end = params[key]
        if (typeof val === 'number' && typeof end === 'number') {
            const newVal = lerpNumber(time2, val, end)
            if (newVal === val) delete params[key] // no change
            else params[key] = newVal
        }
        if (val?.isColor && end?.isColor) {
            const newVal = lerpVal(time2, val, end) as Color
            if (newVal.getHex() === val.getHex()) delete params[key] // no change
            else params[key] = newVal
        }
        if ((val === undefined || val === null || val.isTexture) && (end === undefined || end === null || end.isTexture) && (val || end)) {
            const newVal = lerpTexture(time2, val || null as ITexture | null, end || null as ITexture | null)
            if (newVal === val) delete params[key] // no change
            else params[key] = newVal
        }
        // vectors and custom stuff
        if (val?.toArray && end?.toArray && val.clone && val.fromArray && val.equals) {
            const newVal = lerpVector(time2, val, end)
            if (newVal.equals(val)) delete params[key] // no change
            else params[key] = newVal
        }
        if (Array.isArray(val) && Array.isArray(end) && val.length === end.length) {
            // interpolate arrays
            const newVal = val.map((v, i) => lerpVal(time2, v, end[i]))
            if (newVal.every((v, i) => v === val[i])) delete params[key] // no change
            else params[key] = newVal
        }
    }
}
