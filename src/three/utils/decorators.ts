import {FnCaller, getOrCall, objectHasOwn, safeSetProperty, ValOrArr, ValOrFunc} from 'ts-browser-helpers'

/**
 *
 * @param uniforms - object for setting uniform value (like ShaderMaterial.uniforms
 * @param propKey - uniform name
 * @param thisTarget - if `this` is the uniform (because uniforms = this wont work). It also adds _ in front of the name
 */
export function uniform({uniforms, propKey, thisTarget = false, onChange}: {uniforms?: any, propKey?: string|symbol, thisTarget?:boolean, onChange?: (...args: any[]) => any} = {}): PropertyDecorator {
    // backing up properties as values are different when called again, no idea why.
    const cUniforms = !!uniforms
    const cPropKey = !!propKey
    const isThis = thisTarget

    return (targetPrototype: any, propertyKey: string|symbol, descriptor?: TypedPropertyDescriptor<any>) => {
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
        const prop = {
            get() {
                return getUniform(this).value
            },
            set(newVal: any) {
                const u = getUniform(this)
                const val = u.value
                if (val === newVal) return
                u.value = newVal
                safeSetProperty(this, 'uniformsNeedUpdate', true, true)
                onChange && FnCaller.callFunction(onChange, this, [propertyKey, newVal])
            },
            // configurable: true,
            // enumerable: true,
        } as any
        // https://github.com/babel/babel/blob/909ed3473968c2ccd75f89e17c37ef4771cc3ff8/packages/babel-helpers/src/helpers/applyDecoratedDescriptor.ts#L11
        if (descriptor) {
            if (objectHasOwn(descriptor, 'value')) delete descriptor.value
            if (objectHasOwn(descriptor, 'writable')) delete descriptor.writable
            // @ts-expect-error not in ts? old prop?
            if (objectHasOwn(descriptor, 'initializer')) delete (descriptor as any).initializer
            return Object.assign(descriptor, prop)
        }
        Object.defineProperty(targetPrototype, propertyKey, prop)
    }
}

// todo migrate to new decorators - https://2ality.com/2022/10/javascript-decorators.html
/**
 * Decorator to create a three.js style define in this.material or this and bind to a property.
 * see also - {@link matDefineBool}
 * @param key - define name
 * @param customDefines - object for setting define value (like ShaderMaterial.defines), otherwise this.material.defines is taken
 * @param thisMat - access this.defines instead of this.material.defines
 * @param onChange - function to call when the value changes. The function is called with the following parameters: [key, newVal]. Note: needsUpdate is set to true for this/material if onChange is not provided.
 * @param processVal - function that processes the value before setting it.
 * @param invProcessVal - function that processes the value before returning it.
 */
export function matDefine(key?: string|symbol, customDefines?: any, thisMat = false, onChange?: (...args: any[]) => any, processVal?: (newVal: any)=>any, invProcessVal?: (val:any)=>any): PropertyDecorator {
    // backing up properties as values are different when called again, no idea why.
    const cDefines = !!customDefines
    const cPropKey = !!key

    return (targetPrototype: any, propertyKey: string|symbol, descriptor?: TypedPropertyDescriptor<any>) => {
        const getTarget = (mat: any)=>{
            const t = cDefines ? customDefines : mat.defines || mat._defines || mat.extraDefines
            const p = cPropKey ? key : propertyKey
            return {t, p}
        }
        const prop = {
            get() {
                const {t, p} = getTarget(thisMat ? this : this.material)
                let res = t[p]
                if (invProcessVal) res = invProcessVal(res)
                return res
            },
            set(newVal: any) {
                const {t, p} = getTarget(thisMat ? this : this.material)
                if (processVal) newVal = processVal(newVal)
                // boolean values are supported in material extender.
                // else if (typeof newVal === 'boolean') { // just in case
                //     console.error('Boolean values are not supported for defines. Use @matDefineBool instead.')
                //     newVal = newVal ? '1' : '0'
                // }
                safeSetProperty(t, p, newVal, true)
                if (newVal === undefined) delete t[p]
                if (onChange && typeof onChange === 'function') {
                    FnCaller.callFunction(onChange, this, [p, newVal])
                } else {
                    safeSetProperty(thisMat ? this : this.material, 'needsUpdate', true, true)
                }
            },
            // configurable: true,
            // enumerable: true,
        } as any
        // https://github.com/babel/babel/blob/909ed3473968c2ccd75f89e17c37ef4771cc3ff8/packages/babel-helpers/src/helpers/applyDecoratedDescriptor.ts#L11
        if (descriptor) {
            if (objectHasOwn(descriptor, 'value')) delete descriptor.value
            if (objectHasOwn(descriptor, 'writable')) delete descriptor.writable
            // @ts-expect-error not in ts? old prop?
            if (objectHasOwn(descriptor, 'initializer')) delete (descriptor as any).initializer
            return Object.assign(descriptor, prop)
        }
        Object.defineProperty(targetPrototype, propertyKey, prop)
    }
}

/**
 * Same as {@link matDefine} but for boolean values. It sets the value to '1' or '0'/undefined.
 * @param key - define name
 * @param customDefines - object for setting define value (like ShaderMaterial.defines), otherwise this.material.defines is taken
 * @param thisMat - access this.defines instead of this.material.defines
 * @param onChange - function to call when the value changes. If a string, it is used as a property name in `this` and called. If a function, it is called. The function is called with the following parameters: key, newVal
 * @param deleteOnFalse - sets to undefined instead of '0' when false. Note deleteOnFalse doesn't work with tweakpane ui because the value will be undefined.
 */
export function matDefineBool(key?: string|symbol, customDefines?: any, thisMat = false, onChange?: (...args: any[]) => any, deleteOnFalse = false): PropertyDecorator {
    // noinspection RedundantConditionalExpressionJS
    return matDefine(key, customDefines, thisMat, onChange, (v: any)=>v ? '1' : deleteOnFalse ? undefined : '0', (v: any|undefined)=>v && v !== '0' ? true : false)
}

/**
 * Binds a property to a value in an object. If the object is a string, it is used as a property name in `this`.
 *
 * @param obj - object to bind to. If a string, it is used as a property name in `this`. If a function, it is called and the result is used as the object/string.
 * @param key - key to bind to. If a string, it is used as a property name in `this`. If a function, it is called and the result is used as the key/string.
 * @param onChange - function to call when the value changes. If a string, it is used as a property name in `this` and called. If a function, it is called. The function is called with the following parameters: key, newVal
 * @param onChangeParams - if true, the parameters passed to the onChange function are [key, newVal]. If false, no parameters are passed. Default = `true`
 * @param processVal - function that processes the value before setting it.
 * @param invProcessVal - function that processes the value before returning it.
 * @param allowUndefined - if `false` - when setting the value to `undefined`, the property will be `delete`d. (this could throw an error if it cant be deleted, set to `true` then).
 */
export function bindToValue({obj, key, processVal, invProcessVal, onChange, onChangeParams = true, allowUndefined = false}: {obj?: ValOrFunc<any>, key?: ValOrFunc<ValOrArr<string | symbol>>, onChange?: ((...args: any[]) => any)|string, processVal?: (newVal: any) => any, invProcessVal?: (val: any) => any, onChangeParams?: boolean, allowUndefined?: boolean}): PropertyDecorator {
    const cPropKey = !!key

    return (targetPrototype: any, propertyKey: string|symbol, descriptor?: TypedPropertyDescriptor<any>) => {
        const getTarget = (_this: any)=>{
            let t = getOrCall(obj) || _this
            if (typeof t === 'string') t = _this[t]
            let p1 = cPropKey ? getOrCall(key) || propertyKey : propertyKey
            let p: string|symbol
            if (Array.isArray(p1)) {
                while (p1.length > 1 && t && typeof t === 'object') {
                    t = t[p1[0]]
                    p1 = p1.slice(1)
                }
                p = p1.length ? p1[0] : propertyKey
            } else p = p1
            return {t, p: p}
        }
        const prop = {
            get() {
                const {t, p} = getTarget(this)
                if (!t || typeof t !== 'object') return
                let res = t[p]
                if (invProcessVal) res = invProcessVal(res)
                return res
            },
            set(newVal: any) {
                const {t, p} = getTarget(this)
                if (!t || typeof t !== 'object') return
                if (processVal) newVal = processVal(newVal)
                const r = safeSetProperty(t, p, newVal, true)
                if (r && newVal === undefined && !allowUndefined) delete t[p]
                let oc = onChange
                if (oc && (typeof oc === 'string' || typeof oc === 'symbol')) oc = this[oc] // todo just call it here directly
                if (oc && typeof oc === 'function') FnCaller.callFunction(oc, this, onChangeParams ? [p, newVal] : [])
            },
            // configurable: true,
            // enumerable: true,
        } as any
        // https://github.com/babel/babel/blob/909ed3473968c2ccd75f89e17c37ef4771cc3ff8/packages/babel-helpers/src/helpers/applyDecoratedDescriptor.ts#L11
        if (descriptor) {
            if (objectHasOwn(descriptor, 'value')) delete descriptor.value
            if (objectHasOwn(descriptor, 'writable')) delete descriptor.writable
            // @ts-expect-error not in ts? old prop?
            if (objectHasOwn(descriptor, 'initializer')) delete (descriptor as any).initializer
            return Object.assign(descriptor, prop)
        }
        Object.defineProperty(targetPrototype, propertyKey, prop)
    }
}
