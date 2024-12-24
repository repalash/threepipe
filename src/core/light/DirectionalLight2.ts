import {Color, ColorRepresentation, DirectionalLight, DirectionalLightShadow, Euler, Vector3} from 'three'
import {ILight, ILightEvent, ILightEventTypes} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, UiObjectConfig, uiPanelContainer, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'

// todo: add LightShadow uiconfig
// todo: add Light section in the readme detailing these ...2 lights
@uiPanelContainer('Directional Light')
export class DirectionalLight2<
    E extends ILightEvent = ILightEvent,
    ET extends ILightEventTypes = ILightEventTypes
> extends DirectionalLight<E, ET> implements ILight<DirectionalLightShadow> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    declare uiConfig: UiObjectConfig
    readonly isDirectionalLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
    declare visible: boolean

    @uiColor('Color', (that: DirectionalLight2)=>({onChange: ()=>that.setDirty()}))
    declare color: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
    declare intensity: number
    @uiVector('Position', undefined, undefined, (that: DirectionalLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly position: Vector3
    @uiVector('Rotation', undefined, undefined, (that: DirectionalLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly rotation: Euler
    @uiToggle('Cast Shadow')
    @onChange3('setDirty')
    declare castShadow: boolean

    constructor(color?: ColorRepresentation, intensity?: number) {
        super(color, intensity)
        this.target.position.set(0, 0, -1) // because of GLTF spec: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_lights_punctual
        this.add(this.target) // todo: make sure the child isn't exported in gltf
        iLightCommons.upgradeLight.call(this)
    }

    autoScale() {
        console.warn('AutoScale not supported on Lights')
        return this
    }

    autoCenter() {
        console.warn('AutoCenter not supported on Lights')
        return this
    }

    /**
     * @deprecated use `this` instead
     */
    get lightObject(): this {
        return this
    }

    /**
     * @deprecated use `this` instead
     */
    get modelObject(): this {
        return this
    }


    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse: (callback: (object: IObject3D) => void) => void
    traverseVisible: (callback: (object: IObject3D) => void) => void
    traverseAncestors: (callback: (object: IObject3D) => void) => void
    getObjectById: <T extends IObject3D = IObject3D>(id: number) => T | undefined
    getObjectByName: <T extends IObject3D = IObject3D>(name: string) => T | undefined
    getObjectByProperty: <T extends IObject3D = IObject3D>(name: string, value: string) => T | undefined
    copy: (source: DirectionalLight|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ILightEvent) => void
    declare parent: null
    declare children: IObject3D[]

    // endregion

}
