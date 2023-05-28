import {IObject3D} from '../IObject'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {ICamera} from '../ICamera'

export function makeIObject3DUiConfig(this: IObject3D, isMesh?:boolean): UiObjectConfig {
    if (!this) return {}
    if (this.uiConfig) return this.uiConfig
    const config: UiObjectConfig = {
        type: 'folder',
        label: this.name || 'unnamed',
        expanded: true,
        limitedUi: true,
        children: [
            {
                type: 'checkbox',
                label: 'Visible',
                property: [this, 'visible'],
                limitedUi: true,
            },
            {
                type: 'button',
                label: 'Pick/Focus',
                value: ()=>{
                    // todo instead of dispatching, make a IObject3D.select function
                    this.dispatchEvent({type: 'select', ui: true, value: this, bubbleToParent: true, focusCamera: true})
                },
            },
            {
                type: 'button',
                label: 'Pick Parent',
                hidden: ()=>!this.parent,
                value: ()=>{
                    const parent = this.parent
                    if (parent) {
                        parent.dispatchEvent({type: 'select', ui: true, bubbleToParent: true, value: parent})
                    }
                },
            },
            {
                type: 'input',
                label: 'Name',
                property: [this, 'name'],
            },
            {
                type: 'checkbox',
                label: 'Casts Shadow',
                hidden: () => !(this as any).isMesh,
                property: [this, 'castShadow'],
                // onChange: this.setDirty,
            },
            {
                type: 'checkbox',
                label: 'Receive Shadow',
                hidden: () => !(this as any).isMesh,
                property: [this, 'receiveShadow'],
                // onChange: this.setDirty,
            },
            {
                type: 'checkbox',
                label: 'Frustum culled',
                property: [this, 'frustumCulled'],
                // onChange: this.setDirty,
            },
            {
                type: 'vec3',
                label: 'Position',
                property: [this, 'position'],
                limitedUi: true,
            },
            {
                type: 'vec3',
                label: 'Rotation',
                property: [this, 'rotation'],
                limitedUi: true,
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
                prompt: ['Auto Scale Radius: Object will be scaled to the given radius', this.userData.autoScaleRadius || '2', true],
                value: ()=>{
                    const def = (this.userData.autoScaleRadius || 2) + ''
                    const res = prompt('Auto Scale Radius: Object will be scaled to the given radius', def)
                    if (res === null) return
                    const rad = parseFloat(res || def)
                    if (Math.abs(rad) > 0) this.autoScale?.(rad)
                },
            },
            // {
            //     type: 'button',
            //     label: 'Auto Center',
            //     value: ()=>{
            //         autoCenterObject3D(object)
            //     },
            // },
            this.userData.license !== undefined ? {
                type: 'input',
                label: 'License/Credits',
                property: [this.userData, 'license'],
                limitedUi: true,
            } : {},
        ],
    }
    if (this.isMesh && isMesh !== false) {
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
            // geometry
            ()=>(this.geometry as IUiConfigContainer)?.uiConfig,
            // material(s)
            ()=>Array.isArray(this.material) ? this.material.length < 1 ? undefined : {
                label: 'Materials',
                type: 'folder',
                children: (this.material as IUiConfigContainer[]).map((a)=>a?.uiConfig).filter(a=>a),
            } : (this.material as IUiConfigContainer)?.uiConfig,
        ]
        ;(config.children as UiObjectConfig[]).push(...ui)
    }
    // todo: if we are replacing all the cameras in the scene, is this even required?
    if (this.isCamera) {
        // todo: move to make camera ui function?
        const ui: UiObjectConfig[] = [
            {
                type: 'button',
                label: 'Set View',
                value: ()=>{
                    // todo: call setView on the camera, which will dispatch the event
                    (this as ICamera).dispatchEvent({type: 'setView', ui: true, camera: this as ICamera})
                    config.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'button',
                label: 'Activate main',
                hidden: ()=>(this as ICamera)?.isMainCamera,
                value: ()=>{
                    // todo: call activateMain on the camera, which will dispatch the event
                    (this as ICamera).dispatchEvent({type: 'activateMain', ui: true, camera: this as ICamera})
                    config.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'button',
                label: 'Deactivate main',
                hidden: ()=>!(this as ICamera)?.isMainCamera,
                value: ()=>{
                    // todo: call activateMain on the camera, which will dispatch the event
                    (this as ICamera).dispatchEvent({type: 'activateMain', ui: true, camera: undefined})
                    config.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'checkbox',
                label: 'Auto LookAt Target',
                getValue: ()=>(this as ICamera).userData.autoLookAtTarget ?? false,
                setValue: (v)=>{
                    (this as ICamera).userData.autoLookAtTarget = v
                    config.uiRefresh?.(true, 'postFrame')
                },
            },
        ]
        ;(config.children as UiObjectConfig[]).push(...ui)
    }

    // todo: lights?

    // todo: issue when selected object is moved to picking from SceneUI
    // (config.children as UiObjectConfig[]).push(makeHierarchyUi(object))
    this.uiConfig = config
    return config

}

// function makeHierarchyUi(object: Object3D, root?: Object3D): UiObjectConfig {
//     const dispatch = ()=>(root || object).dispatchEvent({type: 'select', ui: true, value: object})
//     if (object.children.length === 0) return {
//         type: 'button',
//         label: 'Select ' + (object.name || 'unnamed'),
//         // limitedUi: true,
//         value: dispatch,
//     }
//     return {
//         type: 'folder',
//         label: 'Select ' + (object.name || 'unnamed'),
//         // limitedUi: true,
//         children: object.children.map((child)=>makeHierarchyUi(child, root || object)),
//         value: dispatch,
//         onExpand: dispatch,
//     }
// }
