import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {IAnimationLoopEvent, IObject3D} from '../../core'
import {UiObjectConfig} from 'uiconfig.js'
import {
    ComponentCtx,
    ComponentJSON,
    getComponentTypes,
    Object3DComponent,
    setupComponent,
    TObject3DComponent,
} from './components'
import {ViewerEventMap} from '../../viewer/ThreeViewer'
import {teardownComponent} from './components/setupComponent'

export type FunctionPropertyNames<T> = {
    [K in keyof T]: T[K] extends (((...args: any[]) => any)|undefined) ? K : never;
}[keyof T] & string

export interface EntityComponentPluginEventMap extends AViewerPluginEventMap{
    registerComponent: {component: Object3DComponent, object: IObject3D}
    unregisterComponent: {component: Object3DComponent, object: IObject3D}
    addComponentType: {cls: TObject3DComponent}
    removeComponentType: {cls: TObject3DComponent}
}

/**
 * Entity Component Framework plugin for threepipe.
 * Allows attaching reusable components to IObject3D instances.
 * Components can have their own serializable/runtime state, lifecycle methods, and update logic.
 * Components are defined as classes extending Object3DComponent.
 *
 * This system is not documented at the moment.
 */
export class EntityComponentPlugin extends AViewerPluginSync<EntityComponentPluginEventMap> {
    public static readonly PluginType = 'EntityComponentPlugin'

    enabled = true
    protected _running: boolean
    get running() {
        return this._running
    }

    start() {
        if (this._running) return
        this._running = true
        for (const comp of this._components.values()) {
            try {
                comp.start()
            } catch (e) {
                console.error('EntityComponentPlugin: Error starting component', comp)
                console.error(e)
            }
        }
        if (this._viewer && this._components.size) this._viewer.setDirty(this)
    }
    stop() {
        if (!this._running) return
        this._running = false
        for (const comp of this._components.values()) {
            try {
                comp.stop()
            } catch (e) {
                console.error('EntityComponentPlugin: Error stopping component', comp)
                console.error(e)
            }
        }
        if (this._viewer && this._components.size) this._viewer.setDirty(this)
    }

    componentsDispatch<T extends FunctionPropertyNames<Object3DComponent>>(
        type: T, ...args: Parameters<NonNullable<Object3DComponent[T]>>
    ) {
        EntityComponentPlugin.ComponentsDispatch([...this._components.values()], type as any, args)
    }

    private readonly _components: Map<string, Object3DComponent> = new Map()
    private _typeToComponents: Map<string, Set<Object3DComponent>> = new Map()

    readonly componentTypes: Map<string, TObject3DComponent> = new Map()

    static readonly ObjectToComponents: WeakMap<IObject3D, Object3DComponent[]> = new Map()

    static ObjectDispatch<T extends FunctionPropertyNames<Object3DComponent>>(
        object: IObject3D,
        type: T,
        ...args: Parameters<NonNullable<Object3DComponent[T]>>
    ) {
        const comps = EntityComponentPlugin.ObjectToComponents.get(object)
        if (comps) {
            EntityComponentPlugin.ComponentsDispatch(comps, type, args)
        }
    }

    static ComponentsDispatch<T extends FunctionPropertyNames<Object3DComponent>>(
        comps: Object3DComponent[],
        type: T,
        args: Parameters<NonNullable<Object3DComponent[T]>>,
    ) {
        for (const comp of comps) {
            const l = comp[type]
            if (typeof l === 'function') {
                try {
                    l.apply(comp, args)
                } catch (err) {
                    console.error(`EntityComponentPlugin: Error in component ${comp.constructor.ComponentType} handling ${type}`, comp, err)
                }
            }
        }
    }

    static UserDataKey = EntityComponentPlugin.PluginType

    constructor(running = true) {
        super()
        this.componentTypes.set(Object3DComponent.ComponentType, Object3DComponent)
        this._running = running
    }

    addComponentType(type: TObject3DComponent) {
        if (!type || typeof type !== 'function') {
            throw new Error('EntityComponentPlugin: invalid component type')
        }
        if (!type.ComponentType || typeof type.ComponentType !== 'string') {
            throw new Error('EntityComponentPlugin: component type must have a valid string "ComponentType" property')
        }
        if (this.componentTypes.has(type.ComponentType)) {
            console.warn(`EntityComponentPlugin: component type "${type.ComponentType}" already registered`)
            return false
        }
        this.componentTypes.set(type.ComponentType, type)
        this.dispatchEvent({type: 'addComponentType', cls:type})
        // loop through objects
        this._viewer?.object3dManager.getObjects().forEach(object=>this._objectAdd({object, componentType: type.ComponentType}))
        return true
    }

    removeComponentType(type: TObject3DComponent) {
        if (!type || typeof type !== 'function') {
            throw new Error('EntityComponentPlugin: invalid component type')
        }
        if (!type.ComponentType || typeof type.ComponentType !== 'string') {
            throw new Error('EntityComponentPlugin: component type must have a valid string "ComponentType" property')
        }
        if (!this.componentTypes.has(type.ComponentType)) {
            console.warn(`EntityComponentPlugin: component type "${type.ComponentType}" not registered`)
            return false
        }
        this.dispatchEvent({type: 'removeComponentType', cls:type})
        // loop through objects
        this._viewer?.object3dManager.getObjects().forEach(object=>this._objectRemove({object, componentType: type.ComponentType}))
        this.componentTypes.delete(type.ComponentType)
        return true
    }

    hasComponentType(type: TObject3DComponent | string) {
        const typeStr = typeof type === 'string' ? type : type.ComponentType
        return this.componentTypes.has(typeStr)
    }

    private _onRemove: (()=>void)[] = []
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.object3dManager.getObjects().forEach(object=>this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.scene.addEventListener('objectUpdate', this._objectUpdate)
        const offUpdate = viewer.on('preFrame', {
            order: 1,
            callback: this._preFrame,
        })
        if (offUpdate) this._onRemove.push(offUpdate)
    }

    private _preFrame = (e: ViewerEventMap['preFrame'])=>{
        if (this.isDisabled() || !this._running || !this._viewer?.renderEnabled) return
        let dirty = false
        // todo component exec sort order?
        this._components.forEach((comp)=>{
            try {
                const res = comp.update(e as IAnimationLoopEvent)
                if (res === true) dirty = true
            } catch (err: any) {
                console.error(`EntityComponentPlugin: Error updating component ${comp.constructor.ComponentType}`, comp, err)
            }
        })
        if (dirty) this._viewer?.setDirty(this)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object=>this._objectRemove({object}))
        viewer.scene.removeEventListener('objectUpdate', this._objectUpdate)
        this._onRemove.forEach(f=>f())
        super.onRemove(viewer)
    }

    static GetObjectData(obj: IObject3D) {
        let data = obj.userData[EntityComponentPlugin.UserDataKey] as Record<string, ComponentJSON>|undefined
        if (data) {
            if (typeof data !== 'object') {
                console.warn(`EntityComponentPlugin: userData.${EntityComponentPlugin.UserDataKey} is not an object`, obj)
                data = {}
                obj.userData[EntityComponentPlugin.UserDataKey] = data
            }
        }
        return data || null
    }

    addComponent<T extends TObject3DComponent = TObject3DComponent>(obj: IObject3D, stateOrType: ComponentJSON|string|T, id?: string) {
        if (!this._viewer) throw new Error('EntityComponentPlugin: no viewer')
        const state = !stateOrType ?
            {type: 'Object3DComponent', state: {}} :
            typeof stateOrType === 'string' ? {type: stateOrType, state: {}} :
                (stateOrType as TObject3DComponent).ComponentType ? {type: (stateOrType as TObject3DComponent).ComponentType, state: {}} :
                    stateOrType && typeof (stateOrType as ComponentJSON).type === 'string' && (stateOrType as ComponentJSON).state ? (stateOrType as ComponentJSON) :
                        {type: 'Object3DComponent', state: {}}

        if ((stateOrType as TObject3DComponent).ComponentType) {
            if (!this.hasComponentType((stateOrType as TObject3DComponent))) {
                this.addComponentType(stateOrType as TObject3DComponent)
            }
        }

        const comp = this.registerComponent(obj, state, id) as InstanceType<T>
        if (!comp) throw new Error('EntityComponentPlugin: cannot create component of type ' + state.type)
        let data = EntityComponentPlugin.GetObjectData(obj)
        if (!data) {
            data = {}
            obj.userData[EntityComponentPlugin.UserDataKey] = data
        }
        if (!data[comp.uuid]) {
            data[comp.uuid] = {state: comp.stateRef, type: comp.constructor.ComponentType}
        } else {
            data[comp.uuid].type = comp.constructor.ComponentType
            data[comp.uuid].state = comp.stateRef
        }
        obj.setDirty && obj.setDirty({change: `userData.${EntityComponentPlugin.UserDataKey}`, source: 'EntityComponentPlugin.addComponent', refreshUi: true})
        // undo/redo action
        const action = {
            undo: ()=>{
                const r = this.removeComponent(obj, action.component.uuid)
                if (r) action.redo = r.undo
            },
            redo: ()=>{
                this.addComponent(obj, stateOrType)
            },
            component: comp,
        }
        return action
    }

    removeComponent(obj: IObject3D, id: string) {
        if (!this._viewer) return
        const comp = this._components.get(obj.uuid + id)
        if (!comp) return
        const type = comp.constructor.ComponentType
        const state = this.unregisterComponent(comp)
        const data = EntityComponentPlugin.GetObjectData(obj)
        if (data) {
            delete data[id]
            if (Object.keys(data).length === 0) {
                delete obj.userData[EntityComponentPlugin.UserDataKey]
            }
            obj.setDirty && obj.setDirty({change: `userData.${EntityComponentPlugin.UserDataKey}`, source: 'EntityComponentPlugin.removeComponent', refreshUi: true})
        }
        const action = {
            state: state,
            undo: ()=>{
                if (action.state) this.addComponent(obj, {type, state: action.state}, id)
            },
            redo: ()=>{
                this.removeComponent(obj, id)
            },
        }
        return action
    }

    static GetComponentData<T extends TObject3DComponent = TObject3DComponent>(obj: IObject3D, type: string|T) {
        if (!obj) return null
        const data = EntityComponentPlugin.GetObjectData(obj)
        if (!data) return null
        const typeTarget = typeof type === 'string' ? [type] : [...getComponentTypes(type)]
        for (const [k, v] of Object.entries(data)) {
            for (const t of typeTarget) {
                if (v.type === t) return {id: k, ...v} as {id: string} & ComponentJSON
            }
        }
        const c = EntityComponentPlugin.GetComponent(obj, type)
        if (c) return {id: c.uuid, type: c.constructor.ComponentType, state: c.stateRef} as {id: string} & ComponentJSON
        return null
    }

    static GetComponents<T extends TObject3DComponent = TObject3DComponent>(obj: IObject3D, type: string|T) {
        if (!obj) return []
        const comps = EntityComponentPlugin.ObjectToComponents.get(obj) || []
        const typeTarget = typeof type === 'string' ? [type] : [...getComponentTypes(type)]
        return comps.filter(c=>{
            const types = getComponentTypes(c.constructor)
            return typeTarget.some(t=>types.has(t))
        }) as InstanceType<T>[]
    }

    static GetComponent<T extends TObject3DComponent = TObject3DComponent>(obj: IObject3D, type: string|T) {
        if (!obj) return null
        const comps = EntityComponentPlugin.ObjectToComponents.get(obj) || []
        const typeTarget = typeof type === 'string' ? [type] : [...getComponentTypes(type)]
        for (const c of comps) {
            const types = getComponentTypes(c.constructor)
            for (const t of typeTarget) {
                if (types.has(t)) return c as InstanceType<T>
            }
        }
        return null
    }

    static GetComponentInParent<T extends TObject3DComponent = TObject3DComponent>(object: IObject3D, type: string|T) {
        if (!object) return null
        let obj: IObject3D|null = object
        let comp: InstanceType<T> | null = null
        while (!comp && obj) {
            comp = EntityComponentPlugin.GetComponent(obj, type)
            obj = obj.parent
        }
        return comp
    }

    static GetComponentsInParent<T extends TObject3DComponent = TObject3DComponent>(object: IObject3D, type: string|T) {
        if (!object) return []
        let obj: IObject3D|null = object
        const comps: InstanceType<T>[] = []
        while (obj) {
            comps.push(...EntityComponentPlugin.GetComponents(obj, type))
            obj = obj.parent
        }
        return comps
    }

    /**
     * Get all components of a specific type from the plugin instance
     * @param type - The component type (string or class)
     * @returns Array of components matching the specified type
     */
    getComponentsOfType<T extends TObject3DComponent = TObject3DComponent>(type: string|T): InstanceType<T>[] {
        const typeStr = typeof type === 'string' ? type : type.ComponentType
        const compSet = this._typeToComponents.get(typeStr)
        if (!compSet) return []
        return [...compSet] as InstanceType<T>[]
    }

    /**
     * Get the first component of a specific type from the plugin instance
     * @param type - The component type (string or class)
     * @returns The first component matching the specified type, or null if not found
     */
    getComponentOfType<T extends TObject3DComponent = TObject3DComponent>(type: string|T): InstanceType<T> | null {
        const typeStr = typeof type === 'string' ? type : type.ComponentType
        const compSet = this._typeToComponents.get(typeStr)
        if (!compSet || compSet.size === 0) return null
        return compSet.values().next().value as InstanceType<T>
    }

    registerComponent(obj: IObject3D, state: ComponentJSON, id?: string) {
        if (!this._viewer) throw new Error('EntityComponentPlugin: no viewer')
        if (!obj) throw new Error('EntityComponentPlugin: no object')
        if (!state || typeof state !== 'object') {
            console.warn('EntityComponentPlugin: invalid component state', state, obj)
            state = {type: 'Object3DComponent', state: {}}
        }
        if (id) {
            const comp = this._components.get(obj.uuid + id)
            if (comp) {
                if (comp.object !== obj) {
                    console.error(`EntityComponentPlugin: component with id ${id} already exists on a different object`)
                    comp.object = obj
                }
                if (comp.constructor.ComponentType !== state.type) {
                    console.warn(`EntityComponentPlugin: component with id ${id} type mismatch (${comp.constructor.ComponentType} != ${state.type}), removing previous component and creating new one`)
                    this.unregisterComponent(comp)
                    // continue to create new component
                } else {
                    comp.setState(state.state)
                }
                return comp
            }
        }
        const cls = this.componentTypes.get(state.type)

        // todo why making a new one for every component?
        const ctx: ComponentCtx = {
            viewer: this._viewer,
            ecp: this,
            // object: obj,
            plugin: (p)=>{
                const i = ctx.viewer?.getPlugin(p)
                if (!i) {
                    throw new Error(`EntityComponentPlugin: cannot find plugin ${typeof p === 'string' ? p : p.name}`)
                }
                return i
            },
            // component(c) {
            //     const comp = EntityComponentPlugin.GetComponent(ctx.object, c)
            //     if (!comp) {
            //         throw new Error(`EntityComponentPlugin: cannot find component ${typeof c === 'string' ? c : c.name} on object`)
            //     }
            //     return comp
            // },
        }
        let comp
        try {
            // todo when cls doesnt exist, and a component type is registered, it needs to be recreated
            comp = cls ? new cls() : new Object3DComponent()
            if (!cls) {
                console.error('EntityComponentPlugin: unknown component type ' + state.type, obj)
                comp._sType = state.type
            }

            if (id) comp.uuid = id
            setupComponent(comp, ctx)
        } catch (e) {
            console.error('EntityComponentPlugin: Error creating component of type ' + state.type)
            console.error(e)
            return null
        }
        this._components.set(obj.uuid + comp.uuid, comp)
        EntityComponentPlugin.ObjectToComponents.set(obj, [...EntityComponentPlugin.ObjectToComponents.get(obj) || [], comp])

        const typeSet = this._typeToComponents.get(comp.constructor.ComponentType) || new Set()
        typeSet.add(comp)
        this._typeToComponents.set(comp.constructor.ComponentType, typeSet)

        try {
            comp.init(obj, state.state)
        } catch (e) {
            console.error('EntityComponentPlugin: Error initializing component', comp)
            console.error(e)
        }
        this.dispatchEvent({type: 'registerComponent', component: comp, object: obj})
        try {
            if (this.running) comp.start()
        } catch (e) {
            console.error('EntityComponentPlugin: Error starting component', comp)
            console.error(e)
        }
        return comp
    }

    unregisterComponent(comp: Object3DComponent) {
        if (!comp) return
        const obj = comp.object
        let state: Record<string, any>|null = null
        if (!obj) {
            console.warn('EntityComponentPlugin: component already destroyed', comp)
        } else {
            try {
                if (this.running) comp.stop()
            } catch (e) {
                console.error('EntityComponentPlugin: Error stopping component', comp)
                console.error(e)
            }
            // this.dispatchEvent({type: 'unregisterComponent', component: comp, object: obj})
            try {
                state = comp.destroy()
            } catch (e) {
                console.error('EntityComponentPlugin: Error destroying component', comp)
                console.error(e)
            }
        }
        this._components.delete(obj.uuid + comp.uuid)

        const typeSet = this._typeToComponents.get(comp.constructor.ComponentType)
        if (typeSet) {
            typeSet.delete(comp)
            if (typeSet.size === 0) {
                this._typeToComponents.delete(comp.constructor.ComponentType)
            }
        }

        teardownComponent(comp)
        const comps = EntityComponentPlugin.ObjectToComponents.get(obj) || []
        const index = comps.indexOf(comp)
        if (index !== -1) {
            comps.splice(index, 1)
            if (comps.length === 0) {
                EntityComponentPlugin.ObjectToComponents.delete(obj)
            }
        }
        if (obj) this.dispatchEvent({type: 'unregisterComponent', component: comp, object: obj})
        return state
    }

    static AddObjectUiConfig = true

    private _objectAdd = (e: {object?: IObject3D, componentType?: string})=>{
        const obj = e.object
        if (!obj) return
        if (obj.isWidget) return

        // Add getComponent method to object
        if (!obj.getComponent) {
            obj.getComponent = <T extends TObject3DComponent>(type: T | string, self = false) => {
                if (self) return EntityComponentPlugin.GetComponent(obj, type)
                return EntityComponentPlugin.GetComponentInParent(obj, type) ||
                    this.getComponentOfType(type)
            }
        }

        if (!(obj as any)._compUiInit && obj.uiConfig?.children && EntityComponentPlugin.AddObjectUiConfig) {
            (obj as any)._compUiInit = true
            const dropdown = {
                type: 'dropdown',
                label: 'Add Component',
                value: '',
                children: [{
                    label: 'Select component type',
                    value: '',
                }, ()=>{
                    return [...this.componentTypes.values()].map(v=>({
                        label: v.ComponentType,
                        value: v.ComponentType,
                    }))
                }],
            }
            obj.uiConfig.children.push({
                type: 'folder',
                label: 'Components',
                tags: [EntityComponentPlugin.PluginType],
                children: [
                    dropdown,
                    {
                        type: 'button',
                        label: 'Add Component',
                        // disabled: ()=>!dropdown.value,
                        onClick: () => {
                            if (!dropdown.value) return
                            return this.addComponent(obj, dropdown.value)
                        },
                    },
                    ()=>{
                        const data = EntityComponentPlugin.GetObjectData(obj)
                        const children = !data ? [] : Object.keys(data).map((k)=>{
                            const comp = this._components.get(obj.uuid + k)
                            return comp?.uiConfig
                        }).filter(c=>!!c) as UiObjectConfig[]
                        return children
                    },
                ]})
        }

        const data = EntityComponentPlugin.GetObjectData(obj)
        if (!data) return
        Object.entries(data).forEach(([k, v])=>{
            if (e.componentType && v.type !== e.componentType) return
            const comp = this.registerComponent(obj, v, k)
            if (comp) data[k].state = comp.stateRef
        })

    }

    private _objectRemove = (e: {object?: IObject3D, componentType?: string})=>{
        const obj = e.object
        if (!obj) return
        const data = EntityComponentPlugin.GetObjectData(obj)

        // Remove getComponent method from object
        if (obj.getComponent) {
            delete obj.getComponent
        }

        // remove ui config by tags
        if ((obj as any)._compUiInit && obj.uiConfig?.children) {
            (obj as any)._compUiInit = false
            obj.uiConfig.children = obj.uiConfig.children.filter(c=>{
                if (typeof c === 'object' && c.tags && Array.isArray(c.tags) && c.tags.includes(EntityComponentPlugin.PluginType)) {
                    return false
                }
            })
        }

        if (!data) return
        Object.entries(data).forEach(([k, v])=>{
            if (e.componentType && v.type !== e.componentType) return
            const comp = this._components.get(obj.uuid + k)
            if (comp) {
                if (comp.object !== obj) {
                    console.warn(`EntityComponentPlugin: component with id ${k} exists on a different object`)
                    return
                }
                const r = this.unregisterComponent(comp)
                if (r) v.state = r
            } else if (v) {
                // console.warn(`EntityComponentPlugin: component with id ${k} not found`, obj)
                // data[k] = v
            }
        })
    }

    private _objectUpdate = (e: {object?: IObject3D, change?: string})=>{
        if (e.change === 'deserialize') {
            const obj = e.object
            if (!obj) return
            this._objectAdd(e)
        }
    }
}

export const ECS = EntityComponentPlugin

// Augment IObject3D interface to include getComponent method
declare module '../../core/IObject' {
    interface IObject3D {
        /**
         * Get a component attached to this object or in its parent hierarchy, or get a component of the specified type from the global registry.
         * This method is added by EntityComponentPlugin when the object is added to the scene.
         * @param type - The component type (string or class)
         * @param self - If true, only search this object; if false, search parents and global registry
         * @returns The component instance if found, or null
         */
        getComponent?<T extends TObject3DComponent>(type: T | string, self?: boolean): InstanceType<T> | null
    }
}
