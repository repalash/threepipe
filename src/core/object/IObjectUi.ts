import {IObject3D} from '../IObject'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {ICamera} from '../ICamera'
import {Vector3} from 'three'
import {ThreeViewer} from '../../viewer'
import {UnlitMaterial} from '../material/UnlitMaterial'
import {PhysicalMaterial} from '../material/PhysicalMaterial'
import {LineMaterial2} from '../material/LineMaterial2'
import {UnlitLineMaterial} from '../material/UnlitLineMaterial'
import {IMaterial} from '../IMaterial'
import {generateUUID} from '../../three'
import {getOrCall} from 'ts-browser-helpers'

declare module '../IObject' {
    interface IObject3D {
        __objExtUiConfigs?: Record<string, UiObjectConfig['children']|undefined>
    }
}

// todo move somewhere?
const defaultMaterial = new UnlitMaterial()
defaultMaterial.name = 'Default Unlit Material'
defaultMaterial.uiConfig = undefined as any
const defaultUnlitLineMaterial = new UnlitLineMaterial()
defaultUnlitLineMaterial.name = 'Default Unlit Line Material'
defaultUnlitLineMaterial.uiConfig = undefined as any
const defaultLineMaterial = new LineMaterial2()
defaultLineMaterial.name = 'Default Line Material'
defaultLineMaterial.uiConfig = undefined as any

export function makeICameraCommonUiConfig(this: ICamera, config: UiObjectConfig): UiObjectConfig[] {
    return [
        {
            type: 'button',
            label: 'Set View',
            value: ()=>{
                this.setViewToMain({ui: true})
                config.uiRefresh?.(true, 'postFrame') // config is parent config
            },
        },
        {
            type: 'button',
            label: 'Activate main',
            hidden: ()=>this?.isMainCamera,
            value: ()=>{
                this.activateMain({ui: true})
                config.uiRefresh?.(true, 'postFrame')
            },
        },
        {
            type: 'button',
            label: 'Deactivate main',
            hidden: ()=>!this?.isMainCamera,
            value: ()=>{
                this.deactivateMain({ui: true})
                config.uiRefresh?.(true, 'postFrame')
            },
        },
        {
            type: 'checkbox',
            label: 'Auto LookAt Target',
            getValue: ()=>this.userData.autoLookAtTarget ?? false,
            setValue: (v: boolean)=>{
                this.userData.autoLookAtTarget = v
                config.uiRefresh?.(true, 'postFrame')
            },
        },
    ]
}

export function makeIObject3DUiConfig(this: IObject3D, isMesh?:boolean): UiObjectConfig {
    if (!this) return {}
    if (this.uiConfig) return this.uiConfig
    const config: UiObjectConfig = {
        type: 'folder',
        label: ()=>this.name || 'unnamed',
        onChange: (ev)=>{
            // todo this calls setDirty when some material prop changes as well, that needs to be ignored.
            // console.log('onchange', this)
            if (!ev.config || ev.config.onChange) return // todo check onChange in configPath
            let key = Array.isArray(ev.config.property) ? ev.config.property[1] : ev.config.property
            key = typeof key === 'string' ? key : undefined
            this.setDirty({uiChangeEvent: ev, refreshScene: false, refreshUi: !!ev.last, change: key})
        },
        children: [
            {
                type: 'checkbox',
                label: 'Visible',
                property: [this, 'visible'],
                onChange: (e)=>{
                    this.setDirty?.({uiChangeEvent: e, refreshScene: true, refreshUi: true, change: 'visible'})
                },
            },
            // moved to PickingPlugin
            // {
            //     type: 'button',
            //     label: 'Pick/Focus', // todo: move to the plugin that does the picking
            //     value: ()=>{
            //         this.dispatchEvent({type: 'select', ui: true, object: this, bubbleToParent: true, focusCamera: true})
            //     },
            // },
            // {
            //     type: 'button',
            //     label: 'Pick Parent', // todo: move to the plugin that does the picking
            //     hidden: ()=>!this.parent,
            //     value: ()=>{
            //         const parent = this.parent
            //         if (parent) {
            //             parent.dispatchEvent({type: 'select', ui: true, bubbleToParent: true, object: parent})
            //         }
            //     },
            // },
            {
                type: 'input',
                label: 'Name',
                property: [this, 'name'],
                onChange: (e)=>{
                    if (e.last) this.setDirty?.({uiChangeEvent: e, refreshScene: true, frameFade: false, refreshUi: true, change: 'name'})
                },
            },
            {
                type: 'checkbox',
                label: 'Casts Shadow',
                hidden: () => !this.isMesh,
                property: [this, 'castShadow'],
                onChange: (e)=>{
                    this.setDirty?.({uiChangeEvent: e, refreshScene: true, refreshUi: true, change: 'castShadow'})
                },
            },
            {
                type: 'checkbox',
                label: 'Receive Shadow',
                hidden: () => !this.isMesh,
                property: [this, 'receiveShadow'],
                onChange: (e)=>{
                    this.setDirty?.({uiChangeEvent: e, refreshScene: true, refreshUi: true, change: 'receiveShadow'})
                },
            },
            {
                type: 'checkbox',
                label: 'Frustum culled',
                property: [this, 'frustumCulled'],
            },
            {
                type: 'vec3',
                label: 'Position',
                property: [this, 'position'],
            },
            {
                type: 'vec3',
                label: 'Rotation',
                property: [this, 'rotation'],
            },
            {
                type: 'vec3',
                label: 'Scale',
                property: [this, 'scale'],
            },
            {
                type: 'input',
                label: 'Render Order',
                property: [this, 'renderOrder'],
            },
            {
                type: 'button',
                label: 'Auto Scale',
                hidden: ()=>!this.autoScale,
                // prompt: ['Auto Scale Radius: Object will be scaled to the given radius', this.userData.autoScaleRadius || '2', true],
                value: async()=>{
                    const def = (this.userData.autoScaleRadius || 2) + ''
                    const res = await ThreeViewer.Dialog.prompt('Auto Scale Radius: Object will be scaled to the given radius', def)
                    if (res === null) return
                    const rad = parseFloat(res || def)
                    if (Math.abs(rad) > 0) {
                        return {
                            action: ()=>this.autoScale?.(rad),
                            undo: ()=>this.autoScale?.(rad, undefined, undefined, true),
                        }
                    }
                },
            },
            {
                type: 'button',
                label: 'Auto Center',
                value: ()=>{
                    // const res = await ThreeViewer.Dialog.confirm('Auto Center: Object will be centered, are you sure you want to proceed?')
                    // if (!res) return
                    return {
                        action: ()=>this.autoCenter?.(true),
                        undo: ()=>this.autoCenter?.(true, true),
                    }
                },
            },
            {
                type: 'button',
                label: 'Pivot to Node Center',
                tags: ['context-menu', 'interaction'],
                value: async()=>{
                    const res = await ThreeViewer.Dialog.confirm('Pivot to Center: Adjust the pivot to bounding box center. The object will rotate around the new pivot, are you sure you want to proceed?')
                    if (!res) return
                    return this.pivotToBoundsCenter?.(true) // return value is the undo function
                },
            },
            {
                type: 'button',
                label: 'Duplicate Object',
                tags: ['context-menu'],
                value: async()=>{
                    const parent = this.parent
                    const clone = this.clone(true) as IObject3D
                    clone.name = this.name + ' (copy)'
                    return {
                        action: ()=>{
                            if (parent && !clone.parent)
                                parent.add(clone) // todo same index?
                        },
                        undo: ()=>{
                            if (clone.parent === parent)
                                clone.removeFromParent()
                        },
                    }
                },
            },
            {
                type: 'button',
                label: 'Delete Object',
                tags: ['context-menu'],
                value: async()=>{
                    const res = await ThreeViewer.Dialog.confirm('Delete Object: Are you sure you want to delete this object?')
                    if (!res) return
                    const parent = this.parent
                    this.dispose(true)
                    return ()=>{ // undo
                        if (parent) parent.add(this)
                    }
                },
            },
            {
                type: 'folder',
                label: 'Rotate model',
                children: [
                    'X +', 'X -', 'Y +', 'Y -', 'Z +', 'Z -',
                ].map((l)=>{
                    return {
                        type: 'button',
                        label: 'Rotate ' + l + '90',
                        value: ()=>{
                            const axis = new Vector3(l.includes('X') ? 1 : 0, l.includes('Y') ? 1 : 0, l.includes('Z') ? 1 : 0)
                            const angle = Math.PI / 2 * (l.includes('-') ? -1 : 1)
                            return {
                                action: ()=>{
                                    this.rotateOnAxis(axis, angle)
                                    this.setDirty?.({refreshScene: true, refreshUi: false})
                                },
                                undo: ()=>{
                                    this.rotateOnAxis(axis, -angle)
                                    this.setDirty?.({refreshScene: true, refreshUi: false})
                                },
                            }
                        },
                    }
                }),
            },
            this.userData.license !== undefined ? {
                type: 'input',
                label: 'License/Credits',
                property: [this.userData, 'license'],
            } : {},
        ],
    }
    if ((this.isLine || this.isMesh) && isMesh !== false) {
        // todo: move to make mesh ui function?
        const ui = [
            // morph targets
            ()=>{
                const dict = Object.entries(this.morphTargetDictionary || {})
                return dict.length ? {
                    label: 'Morph Targets',
                    type: 'folder',
                    children: dict.map(([name, i])=>({
                        type: 'slider',
                        label: name,
                        bounds: [0, 1],
                        stepSize: 0.0001,
                        property: [this.morphTargetInfluences, i as any],
                        onChange: (e: any)=>{
                            this.setDirty?.({refreshScene: e.last, frameFade: false, refreshUi: false})
                        },
                    })),
                } : undefined
            },
            {
                type: 'divider',
            },
            // geometry
            ()=>(this.geometry as IUiConfigContainer)?.uiConfig,
            // material(s)
            ()=>Array.isArray(this.material) ? this.material.length < 1 ? undefined : {
                label: 'Materials',
                type: 'folder',
                children: (this.material as IUiConfigContainer[]).map((a)=>a?.uiConfig).filter(a=>a),
            } : (this.material as IUiConfigContainer)?.uiConfig,
            {
                label: 'Remove Material(s)',
                type: 'button',
                hidden: ()=>!this.materials?.length || this.materials.length === 1 && (<IMaterial[]>[defaultMaterial, defaultLineMaterial, defaultUnlitLineMaterial]).includes(this.materials[0]),
                value: ()=>{
                    const mat = this.materials
                    this.material = this.isLineSegments2 ?
                        [defaultLineMaterial] : this.isLineSegments ?
                            [defaultUnlitLineMaterial] : [defaultMaterial]
                    return ()=> this.material = mat
                },
            },
            {
                label: 'New Line Material',
                type: 'button',
                hidden: ()=>!this.isLineSegments2 || !(!this.materials?.length || this.materials.length === 1 && this.materials[0] === defaultLineMaterial),
                value: ()=>{
                    const mat = this.materials
                    this.material = [new LineMaterial2()]
                    return ()=> this.material = mat
                },
            },
            {
                label: 'New Unlit Line Material',
                type: 'button',
                hidden: ()=>!this.isLineSegments || !(!this.materials?.length || this.materials.length === 1 && this.materials[0] === defaultUnlitLineMaterial),
                value: ()=>{
                    const mat = this.materials
                    this.material = [new UnlitLineMaterial()]
                    return ()=> this.material = mat
                },
            },
            {
                label: 'New Physical Material',
                type: 'button',
                hidden: ()=>!(!this.materials?.length || this.materials.length === 1 && this.materials[0] === defaultMaterial) || !!this.isLineSegments2 || !!this.isLineSegments,
                value: ()=>{
                    const mat = this.materials
                    this.material = [new PhysicalMaterial()]
                    return ()=> this.material = mat
                },
            },
            {
                label: 'New Unlit Material',
                type: 'button',
                hidden: ()=>!(!this.materials?.length || this.materials.length === 1 && this.materials[0] === defaultMaterial) || !!this.isLineSegments2 || !!this.isLineSegments,
                value: ()=>{
                    const mat = this.materials
                    this.material = [new UnlitMaterial()]
                    return ()=> this.material = mat
                },
            },
        ]
        ;(config.children as UiObjectConfig[]).push(...ui)
    }
    // todo: if we are replacing all the cameras in the scene, is this even required?
    if (this.isCamera) {
        const ui: UiObjectConfig[] = makeICameraCommonUiConfig.call(this as ICamera, config)
        ;(config.children as UiObjectConfig[]).push(...ui)
    }
    (config.children as UiObjectConfig[]).push(objectExtensionsUiConfig.call(this))

    // todo: lights?

    this.uiConfig = config
    return config

}

export function objectExtensionsUiConfig(this: IObject3D) {
    return (parent: any) => this.objectExtensions?.flatMap(v => {
        v.uuid = v.uuid || generateUUID()
        // caching the uiconfig here. todo: reset the uiconfig when cache key changes? or we could just return a dynamic/function uiconfig from getUiConfig
        this.__objExtUiConfigs = this.__objExtUiConfigs || {}
        if (!this.__objExtUiConfigs[v.uuid]) this.__objExtUiConfigs[v.uuid] = v.getUiConfig ? v.getUiConfig(this, this.uiConfig?.uiRefresh) : undefined
        return this.__objExtUiConfigs[v.uuid]?.flatMap(m=>getOrCall(m, parent)) // todo use uiconfigmethods resolve children
    }).filter(v => v)
}
