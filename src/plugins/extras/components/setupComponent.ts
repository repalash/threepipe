import {Object3DComponent} from './Object3DComponent'
import {ComponentCtx, StatePropConfig, TypedType, TypeSystem} from './componentTypes'
import {objectHasOwn} from 'ts-browser-helpers'
import {generateUiConfig, generateValueConfig, UiObjectConfig} from 'uiconfig.js'
import {ReferenceManager} from './ReferenceManager'

interface PropMeta {
    config: StatePropConfig;
    propType: TypedType;
    defaultValue: any;
    defaultValueType: TypedType;
    propKey: keyof Object3DComponent;
}

// const compType = /* @__PURE__ */ new WeakMap<typeof Object3DComponent, Set<string>>()
export function getComponentTypes(comp: typeof Object3DComponent) {
    // const cache = compType.get(comp)
    // if (cache) return cache
    const types = new Set<string>()
    let base = comp
    while (base && base !== Object3DComponent && base !== Function.prototype) {
        if (base.ComponentType) types.add(base.ComponentType)
        base = Object.getPrototypeOf(base)
    }
    // compType.set(comp, types)
    return types
}

export function setupComponent(comp: Object3DComponent, ctx: ComponentCtx) {
    if (!comp.isObject3DComponent) throw new Error('EntityComponentPlugin: invalid component instance')
    comp.ctx = ctx
    const props = getComponentStateProperties(comp.constructor)

    const uiConfig = comp.uiConfig ?? {
        type: 'folder',
        label: ()=>comp._sType ? `Missing (${comp._sType})` : comp.constructor.ComponentType,
        expanded: false,
        children: generateUiConfig(comp),
    }
    const uiChildren = uiConfig.children as UiObjectConfig['children'] | undefined

    const propsMeta: PropMeta[] = []

    props.forEach(stateProp=>{
        const propKey: keyof typeof comp = stateProp.key as any
        if (!objectHasOwn(comp, propKey)) {
            console.error('Object3DComponent: state property not found on component', stateProp, comp)
            return
        }
        const defaultValue = stateProp.default ?? comp[propKey]
        if (defaultValue === undefined) {
            console.error('Object3DComponent: state property default value must be set', stateProp, comp)
            return
        }
        const defaultValueType = TypeSystem.GetType(defaultValue)
        if (!defaultValueType) {
            console.error('Object3DComponent: unsupported type for state property', stateProp, defaultValue)
            return
        }
        const propType = stateProp.type ?? TypeSystem.NonLiteral(defaultValueType)
        if (!TypeSystem.CanAssign(defaultValueType, propType)) {
            console.error('Object3DComponent: default value type is not compatible with state property type', stateProp, defaultValue, defaultValueType, propType)
            return
        }
        // console.log('[Object3DComponent] setup state property', stateProp.key, 'type:', propType, 'default:', defaultValue)

        // const refDef = TypeSystem.GetClass(defaultValueType)
        // if (refDef) {
        //     const id = refDef.getId(defaultValue)
        //     if (!id) {
        //         console.error('Object3DComponent: cannot get reference id for default value of state property', stateProp, defaultValue, id)
        //     } else {
        //         ReferenceManager.Add(id, defaultValue, comp) // ignore ret value
        //     }
        // }

        delete comp[propKey]

        Object.defineProperty(comp, propKey, {
            get: ()=>{
                return getStateProperty(comp, propKey, defaultValue)
            },
            set: (v)=>{
                setStateProperty(v, comp, propKey, propType, defaultValue)
                // todo set dirty on object?
            },
            enumerable: true,
            configurable: true,
        })

        assignVal(defaultValueType, defaultValue, defaultValue, comp, propKey)

        const prop = {
            config: stateProp, propType, defaultValue, defaultValueType, propKey,
        }
        propsMeta.push(prop)

        if (uiChildren) {
            const uiC = generateComponentPropertyUi(comp, prop)
            if (uiC?.length) uiChildren.push(...uiC)
        }
    })

    ComponentCache.InstanceProperties.set(comp, propsMeta)

    uiChildren?.push({
        type: 'button',
        label: 'Reset to Default',
        uuid: 'reset_to_default',
        tags: ['context-menu'],
        value: () => {
            const lastState = {} as any
            propsMeta.forEach(({propKey, defaultValue}) => {
                // @ts-expect-error todo fix ts
                comp[propKey] = defaultValue
                lastState[propKey] = comp[propKey]
            })
            return ()=>{
                // undo
                propsMeta.forEach(({propKey}) => {
                    // @ts-expect-error todo fix ts
                    comp[propKey] = lastState[propKey]
                })
            }
        },
    }, {
        type: 'button',
        label: 'Remove Component',
        uuid: 'remove_component',
        tags: ['context-menu'],
        value: () => {
            return ctx.ecp.removeComponent(comp.object, comp.uuid)
        },
    })
    // todo sort children based on props order
    comp.uiConfig = uiConfig
}

export function refreshAllStateProperties(comp: Object3DComponent, lastState: Object3DComponent['stateRef']) {
    if (!comp.isObject3DComponent) throw new Error('EntityComponentPlugin: invalid component instance')
    const props = ComponentCache.InstanceProperties.get(comp)
    if (!props) return

    for (const {propKey, defaultValue, propType} of props) {
        // console.log('[Object3DComponent] refresh state property', propKey)
        const oldValueRaw = lastState ? lastState[propKey] : undefined

        const valRaw = comp.stateRef[propKey]

        let val
        const cc = ReferenceManager.GetCached(valRaw)
        if (cc !== undefined) val = cc
        else val = getStateProperty(comp, propKey, defaultValue, valRaw, false)

        setStateProperty(val, comp, propKey, propType, defaultValue, oldValueRaw)

    }
}

export function teardownComponent(comp: Object3DComponent) {
    if (!comp.isObject3DComponent) throw new Error('EntityComponentPlugin: invalid component instance')
    // const props = getComponentStateProperties(comp.constructor)
    // props.forEach(p=>{
    // })
    ReferenceManager.Delete(comp)
    ComponentCache.InstanceProperties.delete(comp)
}


class ComponentCache {
    static TypeProperties: WeakMap<typeof Object3DComponent, StatePropConfig[]> = new Map()
    static InstanceProperties: WeakMap<Object3DComponent, PropMeta[]> = new Map()
}

function getComponentStateProperties(comp: typeof Object3DComponent) {
    const cache = ComponentCache.TypeProperties.get(comp)
    if (cache) return cache

    const stateProps : Map<string, [StatePropConfig, any, number]> = new Map()
    let base = comp
    let order = 0
    while (base && base !== Function.prototype) {
        if (base.StateProperties) {
            for (const p of base.StateProperties) {
                const key = typeof p === 'string' ? p : p.key
                const exis = stateProps.get(key)
                if (exis) {
                    const cons = exis[1]
                    if (cons === base) {
                        // same class property duplicate
                        console.error('Object3DComponent: duplicate state property in class', key, base)
                    } else {
                        // derived class property overrides base class property
                        console.warn('Object3DComponent: state property overridden in derived class', key, base, cons)
                    }
                    continue
                }
                // todo check order in prop config also
                stateProps.set(key, [typeof p === 'string' ? {key: p} : p, base, order])
                order += 0.001
            }
        }
        if (base === Object3DComponent) break
        base = Object.getPrototypeOf(base)
        order -= 1
    }
    return Array.from(stateProps.values())
        .sort((a, b)=>a[2] - b[2])
        .map(v=>v[0])
}

function getStateProperty(comp: Object3DComponent, propKey: keyof typeof comp, defaultValue: any, val?: any, warn = true) {
    val = val ?? comp.stateRef[propKey]

    if (val === undefined) return defaultValue

    const resolved = ReferenceManager.GetOp(val, warn)
    if (resolved !== undefined) return resolved

    return val
}

function setStateProperty(v: any, comp: Object3DComponent, propKey: keyof typeof comp, propType: TypedType, defaultValue: any, oldValueRaw?: any) {
    if (v === undefined) {
        console.error('Object3DComponent: state property cannot be set to undefined', propKey, v)
        return
    }
    const oldValue = oldValueRaw !== undefined ? getStateProperty(comp, propKey, defaultValue, oldValueRaw) : comp[propKey]
    if (oldValue === v) return
    const valType = TypeSystem.GetType(v)
    if (!valType) {
        console.error('Object3DComponent: unsupported type for state property', propKey, v)
        return
    }
    // todo skip type checking when running in production
    if (!TypeSystem.CanAssign(valType, propType)) {
        console.error('Object3DComponent: assigned value type is not compatible with state property type', propKey, v, valType, propType)
        return
    }
    if (oldValueRaw === undefined)
        oldValueRaw = comp.stateRef[propKey]

    ReferenceManager.RemoveOp(oldValueRaw, comp)

    assignVal(valType, v, defaultValue, comp, propKey)

    if (oldValue !== undefined && oldValue !== v) {
        comp.stateChangeHandlers[propKey]?.forEach(fn => fn(v, oldValue, propKey))
    }
}

function assignVal(valType: TypedType, v: any, defaultValue: any, comp: Object3DComponent, propKey: keyof typeof comp) {
    let res
    const refDefNew = TypeSystem.GetClass(valType)
    if (refDefNew) {
        const newRefId = refDefNew.getId(v)
        if (!newRefId) {
            console.error('Object3DComponent: cannot get reference id for value of state property', propKey, v)
            return
        } else {
            res = ReferenceManager.Add(newRefId, v, comp)
        }
    } else {
        // if it's not a class instance and same as default value, we can just delete it from stateRef to save space
        if (v === defaultValue) {
            res = undefined
        } else {
            res = v
        }
    }
    if (res === undefined) delete comp.stateRef[propKey]
    else comp.stateRef[propKey] = res
}

function generateComponentPropertyUi(comp: Object3DComponent, prop: PropMeta) {
    const {config: stateProp, propType, defaultValue, propKey} = prop

    // todo flatten nested union types
    const types = typeof propType === 'string' ? [propType] : 'oneOf' in propType ? Array.from(propType.oneOf) : ['unknown']

    const canBeNull = types.includes('null')/* || types.includes('undefined')*/
    const classTypes = types.map(t=>TypeSystem.GetClass(t)).filter(t=>t !== undefined)

    const res: UiObjectConfig[] = []
    // only class types or null
    if (classTypes.length === types.length && !canBeNull
        || classTypes.length === types.length - 1 && canBeNull
    ) {
        const newConfig: UiObjectConfig = {
            type: 'reference' as const,
            label: stateProp.label ?? propKey + '',
            property: [comp, propKey],
            classTypes: classTypes,
            allowNull: canBeNull,
            defaultValue: defaultValue,
            // todo onchange refresh parent
        }
        res.push(newConfig)
    }

    // filter only the types that are literal types
    const literalTypes = types.map(t=>typeof t === 'string' ?
        t.startsWith('"') && t.endsWith('"') ? JSON.parse(t) :
            !isNaN(Number(t)) ? Number(t) :
                t === 'true' ? true : t === 'false' ? false :
                    typeof t === 'number' || typeof t === 'boolean' ? t : undefined // just in case
        : undefined).filter(t=>t !== undefined)

    const uiC = ()=> {
        // should we bind to stateRef? but it could be changed, also it could be deleted when default value is set
        const config = generateValueConfig(comp, propKey, stateProp.label, undefined, false)
        // todo use other metadata like description, hooks
        if (config) {
            if (typeof config === 'object') {
                config.uuid = propKey // similar to react key
                config.dispatchMode = 'immediate' // todo make this the default in uiconfig/uiconfig-react
                // config.multiline = true
            }

            // all types are literal types, can be a dropdown. we can do more advanced type analysis later
            if (literalTypes.length > 0 && literalTypes.length === types.length) {
                if (config.type === 'input' || config.type === 'number' || config.type === 'string') {
                    config.type = 'dropdown'
                    config.children = literalTypes.map(t => {
                        const label = typeof t === 'string' ? t : typeof t === 'number' ? t.toString() : typeof t === 'boolean' ? t ? 'true' : 'false' : t + ''
                        return {label: label, value: t}
                    })
                }
            }

            return config
        }
        return undefined
    }
    res.push(uiC)

    return res
}

