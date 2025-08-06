import {AnimateTime} from '../core/IMaterial'
import {Color, Texture} from 'three'
import {ITexture} from '../core'
import {whiteTexture} from '../three'

export function lerpVal(time: AnimateTime, val: number|Color|any, end: number|Color|any): number|Color|any {
    if (typeof val === 'number' && typeof end === 'number') {
        return lerpNumber(time, val, end)
    }
    if (typeof (val as Color)?.r === 'number' && typeof (end as Color)?.r === 'number') {
        return new Color().set(
            lerpNumber(time, (val as Color).r, (end as Color).r),
            lerpNumber(time, (val as Color).g, (end as Color).g),
            lerpNumber(time, (val as Color).b, (end as Color).b)
        )
    }
    if (val?.toArray && end?.toArray && val.clone && val.fromArray) {
        return lerpVector(time, val, end)
    }
    // not handling textures here specifically, to avoid texture arrays for now
    return time.t >= 1 ? end : val
}

export function lerpNumber(time: AnimateTime, val: number, end: number): number {
    const {t, dt} = time
    let newVal
    if (t < 0) newVal = val
    else if (t >= 1.) newVal = end
    else {
        // const td = t - d
        // const start = (val - (1 - td) * end) / td
        // v = end * td + start * (1 - td)
        // const start = td < 0 ? val : (val - td * end) / (1 - td)
        const l = 1 - t
        const k = Math.max(0, Math.min(dt, l) / l)
        newVal = val + (end - val) * k
    }
    return newVal
}

export function lerpVector(time: AnimateTime, val: any, end: any): any {
    const valA = val.toArray() as any[]
    const endA = end.toArray() as any[]
    const newValA = valA.map((v, i) => lerpVal(time, v, endA[i]))
    const newVal = val.clone().fromArray(newValA)
    return newVal
}


// timeleft, val, end, dt
// val -> end in timeleft
// val -> x in dt
// x = val + (end - val) * dt / timeleft

export function lerpTexture(time: AnimateTime, val: ITexture|null, end: ITexture|null): ITexture |null {
    if (!time.rm) {
        console.warn('MaterialManager: RenderManager is required for interpolating textures')
        return end
    }
    const {t, dt} = time
    let newVal
    if (t <= 0 || t > 0.99 || val === end) {
        newVal = t <= 0 ? val : end
        let rt
        if (val && (val.userData as any)?._lerpTexture && val.isRenderTargetTexture) {
            rt = val._target
        }
        if (rt) {
            time.rm.releaseTempTarget(rt)
        }
    } else {
        const l = 1 - t
        const k = Math.max(0, Math.min(dt, l) / l)
        // newVal = val + (end - val) * k
        // newVal = val * (1 - k) + end * k

        let rt
        if (val && (val.userData as any)?._lerpTexture && val.isRenderTargetTexture) {
            rt = val._target
        } else {
            const anyTex = val || end || whiteTexture
            const val1 = val || whiteTexture
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
            time.rm.blit(rt, {
                source: val1,
                respectColorSpace: false,
                transparent: true,
                clear: true,
            })
        }
        if (rt) {
            time.rm.blit(rt, {
                source: end || whiteTexture,
                respectColorSpace: false,
                transparent: true,
                clear: false,
                blendAlpha: k,
                // blending: NormalBlending,
            })
            newVal = rt.texture as ITexture
        } else {
            newVal = val
        }
    }
    return newVal
}

export function lerpParams(params: Record<string, any>, obj: Record<string, any>, interpolateProps: Set<string>, time: AnimateTime) {
    for (const key of Object.keys(params)) {
        if (!interpolateProps.has(key)) continue
        const val = obj[key]
        if (val === undefined) continue
        const end = params[key]
        if (typeof val === 'number' && typeof end === 'number') {
            const newVal = lerpNumber(time, val, end)
            if (newVal === val) delete params[key] // no change
            else params[key] = newVal
        }
        if (val?.isColor && end?.isColor) {
            const newVal = lerpVal(time, val, end) as Color
            if (newVal.getHex() === val.getHex()) delete params[key] // no change
            else params[key] = newVal
        }
        if ((val === undefined || val === null || val.isTexture) && (end === undefined || end === null || end.isTexture) && (val || end)) {
            const newVal = lerpTexture(time, val || null as ITexture | null, end || null as ITexture | null)
            if (newVal === val) delete params[key] // no change
            else params[key] = newVal
        }
        // vectors and custom stuff
        if (val?.toArray && end?.toArray && val.clone && val.fromArray && val.equals) {
            const newVal = lerpVector(time, val, end)
            if (newVal.equals(val)) delete params[key] // no change
            else params[key] = newVal
        }
        if (Array.isArray(val) && Array.isArray(end) && val.length === end.length) {
            // interpolate arrays
            const newVal = val.map((v, i) => lerpVal(time, v, end[i]))
            if (newVal.every((v, i) => v === val[i])) delete params[key] // no change
            else params[key] = newVal
        }
    }
}
