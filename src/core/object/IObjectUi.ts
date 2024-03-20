import {IObject3D} from '../IObject'
import {IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {ICamera} from '../ICamera'
import {Vector3} from 'three'

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
            setValue: (v)=>{
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
        expanded: true,
        onChange: (ev)=>{
            if (!ev.config || ev.config.onChange) return
            this.setDirty({uiChangeEvent: ev, refreshScene: false, refreshUi: true})
        },
        children: [
            {
                type: 'checkbox',
                label: 'Visible',
                property: [this, 'visible'],
            },
            {
                type: 'button',
                label: 'Pick/Focus', // todo: move to the plugin that does the picking
                value: ()=>{
                    this.dispatchEvent({type: 'select', ui: true, object: this, bubbleToParent: true, focusCamera: true})
                },
            },
            {
                type: 'button',
                label: 'Pick Parent', // todo: move to the plugin that does the picking
                hidden: ()=>!this.parent,
                value: ()=>{
                    const parent = this.parent
                    if (parent) {
                        parent.dispatchEvent({type: 'select', ui: true, bubbleToParent: true, object: parent})
                    }
                },
            },
            {
                type: 'input',
                label: 'Name',
                property: [this, 'name'],
                onChange: (e: any)=>{
                    if (e.last) this.setDirty?.({refreshScene: true, frameFade: false, refreshUi: true})
                },
            },
            {
                type: 'checkbox',
                label: 'Casts Shadow',
                hidden: () => !(this as any).isMesh,
                property: [this, 'castShadow'],
            },
            {
                type: 'checkbox',
                label: 'Receive Shadow',
                hidden: () => !(this as any).isMesh,
                property: [this, 'receiveShadow'],
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
                prompt: ['Auto Scale Radius: Object will be scaled to the given radius', this.userData.autoScaleRadius || '2', true],
                value: ()=>{
                    const def = (this.userData.autoScaleRadius || 2) + ''
                    const res = prompt('Auto Scale Radius: Object will be scaled to the given radius', def)
                    if (res === null) return
                    const rad = parseFloat(res || def)
                    if (Math.abs(rad) > 0) this.autoScale?.(rad)
                },
            },
            {
                type: 'button',
                label: 'Auto Center',
                value: ()=>{
                    const res = confirm('Auto Center: Object will be centered, are you sure you want to proceed?')
                    if (!res) return
                    this.autoCenter?.(true)
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
                            this.rotateOnAxis(new Vector3(l.includes('X') ? 1 : 0, l.includes('Y') ? 1 : 0, l.includes('Z') ? 1 : 0), Math.PI / 2 * (l.includes('-') ? -1 : 1))
                            this.setDirty?.({refreshScene: true, refreshUi: false})
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
        const ui: UiObjectConfig[] = makeICameraCommonUiConfig.call(this as ICamera, config)
        ;(config.children as UiObjectConfig[]).push(...ui)
    }

    // todo: lights?

    this.uiConfig = config
    return config

}
