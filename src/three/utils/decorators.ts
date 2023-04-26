import {safeSetProperty} from 'ts-browser-helpers'

/**
 *
 * @param uniforms - object for setting uniform value (like ShaderMaterial.uniforms
 * @param propKey - uniform name
 * @param thisTarget - if `this` is the uniform (because uniforms = this wont work). It also adds _ in front of the name
 */
export function uniform({uniforms, propKey, thisTarget = false}: {uniforms?: any, propKey?: string|symbol, thisTarget?:boolean} = {}): PropertyDecorator {
    // backing up properties as values are different when called again, no idea why.
    const cUniforms = !!uniforms
    const cPropKey = !!propKey
    const isThis = thisTarget

    return (targetPrototype: any, propertyKey: string|symbol) => {
        const getUniform = (target: any)=>{
            const uniforms1 = isThis ? target : cUniforms ? uniforms : target.uniforms || target._uniforms
            let propKey1 = cPropKey ? propKey : propertyKey
            if (isThis) propKey1 = '_' + (propKey1 as string)
            let a = uniforms1[propKey1!]
            if (!a) {
                a = {value: null}
                uniforms1[propKey1!] = a
            }
            return a
        }
        Object.defineProperty(targetPrototype, propertyKey, {
            get() {
                return getUniform(this).value
            },
            set(newVal: any) {
                getUniform(this).value = newVal
                safeSetProperty(this, 'uniformsNeedUpdate', true, true)
            },
            // configurable: true,
            // enumerable: true,
        })
    }
}

/**
 *
 * @param customDefines - object for setting define value (like ShaderMaterial.defines), otherwise this.material.defines is taken
 * @param key - define name
 * @param thisMat - access this.defines instead of this.material.defines
 */
export function matDefine(key?: string|symbol, customDefines?: any, thisMat = false, onChange?: (...args: any[]) => any): PropertyDecorator {
    // backing up properties as values are different when called again, no idea why.
    const cDefines = !!customDefines
    const cPropKey = !!key

    return (targetPrototype: any, propertyKey: string|symbol) => {
        const getTarget = (mat: any)=>{
            const t = cDefines ? customDefines : mat.defines || mat._defines
            const p = cPropKey ? key : propertyKey
            return {t, p}
        }
        Object.defineProperty(targetPrototype, propertyKey, {
            get() {
                const {t, p} = getTarget(thisMat ? this : this.material)
                return t[p]
            },
            set(newVal: any) {
                const {t, p} = getTarget(thisMat ? this : this.material)
                safeSetProperty(t, p, newVal, true)
                if (typeof onChange === 'function') {
                    const params = [p, newVal]
                    // same logic as onChange in refl.ts
                    if (onChange.name) {
                        const fn = this[onChange.name]
                        if (fn === onChange)
                            onChange.call(this, ...params)
                        else if (fn.name === `bound ${onChange.name}`)
                            fn(...params)
                        else onChange(...params)
                    } else {
                        onChange(...params)
                    }
                } else {
                    safeSetProperty(thisMat ? this : this.material, 'needsUpdate', true, true)
                }
            },
            // configurable: true,
            // enumerable: true,
        })
    }
}
