import {AnyFunction, getOrCall, safeSetProperty, ValOrFunc} from 'ts-browser-helpers'

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
            const uniforms1 = isThis ? target : cUniforms ? uniforms : target.uniforms || target._uniforms || target.extraUniforms
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

function callOnChange(this: any, onChange: (...args: any[]) => any, params: any[]) {
    // same logic as onChange in ts-browser-helpers. todo: loop through object prototype chain like in onChange?
    if (onChange.name) {
        const fn: AnyFunction = this[onChange.name]
        if (fn === onChange)
            onChange.call(this, ...params)
        else if (fn.name.endsWith(`bound ${onChange.name}`))
            fn(...params)
        else onChange(...params)
    } else onChange(...params)
}

/**
 *
 * @param customDefines - object for setting define value (like ShaderMaterial.defines), otherwise this.material.defines is taken
 * @param key - define name
 * @param thisMat - access this.defines instead of this.material.defines
 */
export function matDefine(key?: string|symbol, customDefines?: any, thisMat = false, onChange?: (...args: any[]) => any, processVal?: (newVal: any)=>any, invProcessVal?: (val:any)=>any): PropertyDecorator {
    // backing up properties as values are different when called again, no idea why.
    const cDefines = !!customDefines
    const cPropKey = !!key

    return (targetPrototype: any, propertyKey: string|symbol) => {
        const getTarget = (mat: any)=>{
            const t = cDefines ? customDefines : mat.defines || mat._defines || mat.extraDefines
            const p = cPropKey ? key : propertyKey
            return {t, p}
        }
        Object.defineProperty(targetPrototype, propertyKey, {
            get() {
                const {t, p} = getTarget(thisMat ? this : this.material)
                let res = t[p]
                if (invProcessVal) res = invProcessVal(res)
                return res
            },
            set(newVal: any) {
                const {t, p} = getTarget(thisMat ? this : this.material)
                if (processVal) newVal = processVal(newVal)
                safeSetProperty(t, p, newVal, true)
                if (newVal === undefined) delete t[p]
                if (onChange && typeof onChange === 'function') {
                    callOnChange.call(this, onChange, [p, newVal])
                } else {
                    safeSetProperty(thisMat ? this : this.material, 'needsUpdate', true, true)
                }
            },
            // configurable: true,
            // enumerable: true,
        })
    }
}

/**
 * Binds a property to a value in an object. If the object is a string, it is used as a property name in `this`.
 * @param obj - object to bind to. If a string, it is used as a property name in `this`. If a function, it is called and the result is used as the object/string.
 * @param key - key to bind to. If a string, it is used as a property name in `this`. If a function, it is called and the result is used as the key/string.
 * @param onChange - function to call when the value changes. If a string, it is used as a property name in `this` and called. If a function, it is called. The function is called with the following parameters: key, newVal
 * @param processVal - function that processes the value before setting it.
 * @param invProcessVal - function that processes the value before returning it.
 */
export function bindToValue({obj, key, onChange, processVal, invProcessVal}: {obj?: ValOrFunc<any>, key?: ValOrFunc<string | symbol>, onChange?: ((...args: any[]) => any)|string, processVal?: (newVal: any) => any, invProcessVal?: (val: any) => any}): PropertyDecorator {
    const cPropKey = !!key

    return (targetPrototype: any, propertyKey: string|symbol) => {
        const getTarget = (_this: any)=>{
            let t = getOrCall(obj) || _this
            if (typeof t === 'string') t = _this[t]
            const p = cPropKey ? getOrCall(key) || propertyKey : propertyKey
            return {t, p}
        }
        Object.defineProperty(targetPrototype, propertyKey, {
            get() {
                const {t, p} = getTarget(this)
                let res = t[p]
                if (invProcessVal) res = invProcessVal(res)
                return res
            },
            set(newVal: any) {
                const {t, p} = getTarget(this)
                if (processVal) newVal = processVal(newVal)
                safeSetProperty(t, p, newVal, true)
                if (newVal === undefined) delete t[p]
                let oc = onChange
                if (oc && (typeof oc === 'string' || typeof oc === 'symbol')) oc = this[oc]
                if (oc && typeof oc === 'function') callOnChange.call(this, oc, [p, newVal])
            },
            // configurable: true,
            // enumerable: true,
        })
    }
}
