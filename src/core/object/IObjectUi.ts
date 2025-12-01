import {IObject3D} from '../IObject'
import {UiObjectConfig} from 'uiconfig.js'
import {ICamera} from '../ICamera'
import {Vector3} from 'three'
import {ThreeViewer} from '../../viewer'
import {generateUUID} from '../../three'
import {getOrCall} from 'ts-browser-helpers'
import {iCameraCommons} from './iCameraCommons'
import {iObjectCommons} from './iObjectCommons'

declare module '../IObject' {
    interface IObject3D {
        __objExtUiConfigs?: Record<string, UiObjectConfig['children']|undefined>
    }
}

export function makeICameraCommonUiConfig(this: ICamera): UiObjectConfig[] {
    return [
        {
            type: 'checkbox',
            label: 'Auto LookAt Target',
            getValue: ()=>this.userData.autoLookAtTarget ?? false,
            setValue: (v: boolean)=>{
                this.userData.autoLookAtTarget = v
                this.uiConfig?.uiRefresh?.(true, 'postFrame')
            },
        },
        {
            type: 'input',
            label: 'Auto Near Far',
            property: [this, 'autoNearFar'],
        },
        {
            type: 'number',
            label: 'Min Near',
            hidden: ()=>!this.autoNearFar,
            // property: [this, 'minNearPlane'],
            getValue: ()=>{
                return this.userData.minNearPlane ?? iCameraCommons.defaultMinNear
            },
            setValue: (v: number)=>{
                if (v === iCameraCommons.defaultMinNear) delete this.userData.minNearPlane
                else this.userData.minNearPlane = v
            },
        },
        {
            type: 'number',
            label: 'Max Far',
            hidden: ()=>!this.autoNearFar,
            // property: [this, 'maxFarPlane'],
            getValue: ()=>{
                return this.userData.maxFarPlane ?? iCameraCommons.defaultMaxFar
            },
            setValue: (v: number)=>{
                if (v === iCameraCommons.defaultMaxFar) delete this.userData.maxFarPlane
                else this.userData.maxFarPlane = v
            },
        },
        {
            type: 'number',
            label: 'Near',
            readOnly: ()=>this.autoNearFar,
            property: [this, 'near'],
        },
        {
            type: 'number',
            label: 'Far',
            readOnly: ()=>this.autoNearFar,
            property: [this, 'far'],
        },
        ()=>({ // because controlsCtors can change
            type: 'dropdown',
            label: 'Controls Mode',
            property: [this, 'controlsMode'],
            children: ['', 'orbit', ...this.controlsCtors.keys()].map(v=>({label: v === '' ? 'none' : v, value:v})),
            onChange: () => this.refreshCameraControls(),
        }),
        {
            type: 'button',
            label: 'Set View',
            tags: ['context-menu'],
            value: ()=>{
                this.setViewToMain({ui: true})
                this.uiConfig?.uiRefresh?.(true, 'postFrame') // config is parent config
            },
        },
        {
            type: 'button',
            label: 'Activate main',
            hidden: ()=>this?.isMainCamera,
            tags: ['context-menu'],
            value: ()=>{
                this.activateMain({ui: true})
                this.uiConfig?.uiRefresh?.(true, 'postFrame')
            },
        },
        {
            type: 'button',
            label: 'Deactivate main',
            tags: ['context-menu'],
            hidden: ()=>!this?.isMainCamera,
            value: ()=>{
                this.deactivateMain({ui: true})
                this.uiConfig?.uiRefresh?.(true, 'postFrame')
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
        expanded: true,
        onChange: (ev)=>{
            // todo this calls setDirty when some material prop changes as well, that needs to be ignored.
            // console.log('onchange', this)
            if (!ev.config || ev.config.onChange) return // todo check onChange in configPath
            let key = Array.isArray(ev.config.property) ? ev.config.property[1] : ev.config.property
            key = typeof key === 'string' ? key : undefined
            this.setDirty && this.setDirty({uiChangeEvent: ev, refreshScene: false, refreshUi: !!ev.last, change: key})
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
            {
                type: 'input',
                property: [this, 'uuid'],
                disabled: true,
                tags: ['advanced'],
            },
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
                label: 'Scale to Radius',
                tags: ['context-menu', 'interaction'],
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
                tags: ['context-menu', 'interaction'],
                hidden: ()=>!this.autoCenter,
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
            ...objectActionsUiConfig.call(this),
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
        ]
        ;(config.children as UiObjectConfig[]).push(...ui)
    }
    // todo: if we are replacing all the cameras in the scene, is this even required?
    if (this.isCamera) {
        const ui: UiObjectConfig[] = makeICameraCommonUiConfig.call(this as ICamera)
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

export function incrementObjectCloneName(obj: IObject3D, clone: IObject3D, name?: string) {
    name = name ?? obj.name
    const match = name.match(/\(copy( (\d+))?\)$/)
    if (match) {
        let copyNum = match[2] ? parseInt(match[2]) + 1 : 2
        let newName = name.replace(/\(copy( \d+)?\)$/, `(copy ${copyNum})`)
        const parent = obj.parent
        if (parent && parent !== clone.parent) {
            const names = new Set(parent.children.filter(c=>c !== obj).map(c=>c.name))
            for (let i = 0; i < 1000; i++) {
                if (!names.has(newName)) break
                copyNum++
                newName = name.replace(/\(copy( \d+)?\)$/, `(copy ${copyNum})`)
            }
        }
        clone.name = newName
    } else {
        clone.name = name + ' (copy)'
    }
}

export function objectActionsUiConfig(this: IObject3D): UiObjectConfig[] {
    return [{
        type: 'button',
        label: 'Duplicate Object',
        tags: ['context-menu'],
        value: async(e?: any)=>{
            return iObjectCommons.duplicateObject(this, e)
        },
    },
    {
        type: 'button',
        label: 'Delete Object',
        tags: ['context-menu'],
        value: async(e?: any)=>{
            return iObjectCommons.deleteObject(this, e)
        },
    }]
}
