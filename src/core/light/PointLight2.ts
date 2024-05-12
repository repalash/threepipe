import {Color, ColorRepresentation, PointLight, PointLightShadow, Vector3} from 'three'
import {ILight, ILightEvent} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, uiNumber, UiObjectConfig, uiPanelContainer, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'

@uiPanelContainer('Point Light')
export class PointLight2 extends PointLight implements ILight<PointLightShadow> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    uiConfig: UiObjectConfig
    readonly isPointLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
        visible: boolean

    @uiColor('Color', (that: PointLight2)=>({onChange: ()=>that.setDirty()}))
        color: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
        intensity: number
    @uiNumber('Distance')
    @onChange3('setDirty')
        distance: number
    @uiNumber('Decay')
    @onChange3('setDirty')
        decay: number
    @uiVector('Position', undefined, undefined, (that: PointLight2)=>({onChange: ()=>that.setDirty()}))
    readonly position: Vector3
    @uiToggle('Cast Shadow')
    @onChange3('setDirty')
        castShadow: boolean

    constructor(color?: ColorRepresentation, intensity?: number, distance?: number, decay?: number) {
        super(color, intensity, distance, decay)
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
    copy: (source: PointLight|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ILightEvent) => void
    parent: null
    children: IObject3D[]

    // endregion

}
