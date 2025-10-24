import {Object3DComponent} from './Object3DComponent.ts'
import {ComponentCtx, StatePropConfig, TypedType, TypeSystem} from './componentTypes.ts'
import {objectHasOwn} from 'ts-browser-helpers'
import {generateUiConfig, generateValueConfig, UiObjectConfig} from 'uiconfig.js'
import {SerializationMetaType, ThreeSerialization} from '../../../utils'

function getComponentStateProperties(comp: typeof Object3DComponent) {
    const stateProps = new Set<string|StatePropConfig>()
    let base = comp
    while (base && base !== Object3DComponent && base !== Function.prototype) {
        if (base.StateProperties) {
            base.StateProperties.forEach(p=>stateProps.add(p))
        }
        base = Object.getPrototypeOf(base)
    }
    const props: StatePropConfig[] = []
    stateProps.forEach(p=>props.push(typeof p === 'string' ? {key:p} : p))
    return props
}

function setCompStateProp(v: any, comp: Object3DComponent, propKey: keyof typeof comp, propType: TypedType, defaultValue: any, oldValueRaw?: ItemRef | any) {
    if (v === undefined) {
        console.error('Object3DComponent: state property cannot be set to undefined', propKey, v)
        return
    }
    const oldValue = oldValueRaw !== undefined ? getCompStateProp(comp, propKey, defaultValue, oldValueRaw) : comp[propKey]
    if (oldValue === v) return
    const valType = TypeSystem.GetType(v)
    if (!valType) {
        console.error('Object3DComponent: unsupported type for state property', propKey, v)
        return
    }
    if (!TypeSystem.CanAssign(valType, propType)) {
        console.error('Object3DComponent: assigned value type is not compatible with state property type', propKey, v, valType, propType)
        return
    }
    if (oldValueRaw === undefined)
        oldValueRaw = comp.stateRef[propKey]
    if (oldValueRaw !== undefined && (oldValueRaw as ItemRef).isItemRef) {
        const ref = oldValueRaw as ItemRef
        ReferenceManager.Remove(ref.id, comp, ref)
    }

    assignVal(valType, v, defaultValue, comp, propKey)

    if (oldValue !== undefined && oldValue !== v) {
        comp.stateChangeHandlers[propKey]?.forEach(fn => fn(v, oldValue, propKey))
    }
}

export function getComponentTypes(comp: typeof Object3DComponent) {
    const types = new Set<string>()
    let base = comp
    while (base && base !== Object3DComponent && base !== Function.prototype) {
        if (base.ComponentType) types.add(base.ComponentType)
        base = Object.getPrototypeOf(base)
    }
    return types
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

function getCompStateProp(comp: Object3DComponent, propKey: keyof typeof comp, defaultValue: any, val?: any, warn = true) {
    val = val ?? comp.stateRef[propKey]

    if (val === undefined) return defaultValue
    if ((val as ItemRef).isItemRef) {
        const value = ReferenceManager.Get(val as ItemRef)
        if (!value) {
            if (warn) console.error('Object3DComponent: reference not found for state property', propKey, val)
            return null // todo we should not return null, should be special error object or something
        }
        return value
    }
    return val
}

interface PropMeta {
    config: StatePropConfig;
    propType: TypedType;
    defaultValue: any;
    defaultValueType: TypedType;
    propKey: keyof Object3DComponent;
}

export function setupComponent(comp: Object3DComponent, ctx: ComponentCtx) {
    if (!comp.isObject3DComponent) throw new Error('EntityComponentPlugin: invalid component instance')
    comp.ctx = ctx
    const props = getComponentStateProperties(comp.constructor)

    const uiConfig = comp.uiConfig ?? {
        type: 'folder',
        label: comp.constructor.ComponentType,
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
                return getCompStateProp(comp, propKey, defaultValue)
            },
            set: (v)=>{
                setCompStateProp(v, comp, propKey, propType, defaultValue)
                // todo set dirty on object?
            },
            enumerable: true,
            configurable: true,
        })

        assignVal(defaultValueType, defaultValue, defaultValue, comp, propKey)

        propsMeta.push({
            config: stateProp, propType, defaultValue, defaultValueType, propKey,
        })

        if (uiChildren) {

            // todo flatten nested union types
            const types = typeof propType === 'string' ? [propType] : 'oneOf' in propType ? Array.from(propType.oneOf) : ['unknown']

            const canBeNull = types.includes('null')/* || types.includes('undefined')*/
            const refClasses = types.map(t=>TypeSystem.GetClass(t)).filter(t=>t !== undefined)
            if (refClasses.length === types.length && !canBeNull
                || refClasses.length === types.length - 1 && canBeNull
            ) {
                const newConfig: UiObjectConfig = {
                    type: 'reference' as const,
                    label: stateProp.label ?? propKey + '',
                    property: [comp, propKey],
                    classTypes: refClasses,
                    allowNull: canBeNull,
                    defaultValue: defaultValue,
                    // todo onchange refresh parent
                }
                uiChildren.push(newConfig) // push before this prop config
            }

            // filter only the types that are literal types
            const literalTypes = types.map(t=>typeof t === 'string' ?
                t.startsWith('"') && t.endsWith('"') ? JSON.parse(t) :
                    !isNaN(Number(t)) ? Number(t) :
                        t === 'true' ? true : t === 'false' ? false :
                            typeof t === 'number' || typeof t === 'boolean' ? t : undefined // just in case
                : undefined).filter(t=>t !== undefined)

            uiChildren.push(()=> {
                // should we bind to stateRef? but it could be changed, also it could be deleted when default value is set
                const config = generateValueConfig(comp, propKey, stateProp.label, undefined, false)
                // todo use other metadata like description, hooks
                if (config) {

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
            })
        }
    })
    comp.__propsMeta = propsMeta
    // todo sort children based on props order
    comp.uiConfig = uiConfig
}

export function refreshAllStateProperties(comp: Object3DComponent, lastState: Object3DComponent['stateRef']) {
    if (!comp.isObject3DComponent) throw new Error('EntityComponentPlugin: invalid component instance')
    const props = comp.__propsMeta ?? []

    props.forEach(({propKey, defaultValue, propType})=>{
        // console.log('[Object3DComponent] refresh state property', propKey)

        const oldValueRaw = lastState ? lastState[propKey] : undefined

        const valRaw = comp.stateRef[propKey]
        let val
        if (valRaw && (valRaw as ItemRef).isItemRef && (valRaw as ItemRef)._itemObject) {
            val = (valRaw as ItemRef)._itemObject
            ;(valRaw as ItemRef)._itemObject = undefined
        } else val = getCompStateProp(comp, propKey, defaultValue, valRaw, false)

        setCompStateProp(val, comp, propKey, propType, defaultValue, oldValueRaw)

    })
}

export function teardownComponent(comp: Object3DComponent) {
    if (!comp.isObject3DComponent) throw new Error('EntityComponentPlugin: invalid component instance')
    // const props = getComponentStateProperties(comp.constructor)
    // props.forEach(p=>{
    // })
    ReferenceManager.Delete(comp)
    delete comp.__propsMeta
}

class ItemRef {
    readonly isItemRef = true
    id: string
    constructor(id?: string) {
        this.id = id || ''
    }
    toJSON(meta?: SerializationMetaType) {
        if (!this.id) return {}
        if (meta) {
            if (!meta.typed) meta.typed = {}
            if (!meta.typed[this.id]) {
                const item = ReferenceManager.Get(this)
                if (item) {
                    if (item.__rootPath) {
                        meta.typed[this.id] = {
                            external: true,
                            rootPath: item.__rootPath,
                            rootPathOptions: item.__rootPathOptions,
                        }
                    } else {
                        meta.typed[this.id] = ThreeSerialization.Serialize(item, meta)
                    }
                }
            }
        }
        return {id: this.id}
    }

    ['_itemObject']: any

    fromJSON(data: any, meta?: SerializationMetaType) {
        if (data && typeof data.id === 'string') {
            this.id = data.id
            if (meta?.typed) {
                const itemData = meta.typed[this.id]
                const isLoaded = meta.__isLoadedResources
                const itemObject = isLoaded && itemData ? itemData : ThreeSerialization.Deserialize(itemData, meta)
                if (itemObject?.external && itemObject.rootPath) {
                    console.warn('External resource is expected to be loaded already in ImportMeta phase:', itemObject)
                } else {
                    this._itemObject = itemObject
                    if (isLoaded) meta.typed[this.id] = itemObject // cache the deserialized object, isLoaded is also true when resources are being loaded in ImportMeta
                }
            }
        }
        return this
    }
}
ThreeSerialization.MakeSerializable(ItemRef as any, 'ItemRef')

interface Item{
    id: string;
    refs: Map<any, Set<ItemRef>>;
    object: any
}
export class ReferenceManager {

    static Objects: Map<string, Item> = new Map()

    static Get(ref: ItemRef) {
        const item = this.Objects.get(ref.id)
        return item ? item.object : null
    }

    // static GetObjects(ids: string[]) {
    //     const objects: Item[] = []
    //     for (const id of ids) {
    //         const item = this.Objects.get(id)
    //         if (item?.object) objects.push(item)
    //     }
    //     return objects
    // }

    static Add(id: string, object: any, refOwner: any) {
        let item = this.Objects.get(id)
        if (!item) {
            item = {
                id,
                refs: new Map<any, Set<ItemRef>>(),
                object,
            }
            this.Objects.set(id, item)
        }
        // const count = item.refs.get(refOwner) || 0
        // item.refs.set(refOwner, count + 1)
        let refSet = item.refs.get(refOwner)
        if (!refSet) {
            refSet = new Set<ItemRef>()
            item.refs.set(refOwner, refSet)
        }
        const ref = new ItemRef(id)
        refSet.add(ref)
        return ref
    }

    static Remove(id: string, refOwner: any, ref: ItemRef) {
        const item = this.Objects.get(id)
        if (item) {
            const refs = item.refs.get(refOwner)
            if (refs && refs.has(ref)) {
                refs.delete(ref)
                if (refs.size === 0) {
                    item.refs.delete(refOwner)
                    if (item.refs.size === 0) {
                        this.Objects.delete(id)
                    }
                }
            }
        }
    }

    static Delete(object: any) {
        if (object) {
            for (const [id, item] of [...this.Objects]) {
                // object references
                item.refs.delete(object)
                if (item.refs.size === 0) {
                    this.Objects.delete(id)
                }
                // refs to object
                if (item.object === object) {
                    this.Objects.delete(id)
                }
            }
        } else {
            // this.Objects.clear()
        }
    }

}

declare module './Object3DComponent.ts'{
    interface Object3DComponent{
        __propsMeta?: PropMeta[];
    }
}
