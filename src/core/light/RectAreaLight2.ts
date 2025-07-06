import {Color, ColorRepresentation, RectAreaLight} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, uiFolderContainer, uiNumber, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'

@uiFolderContainer('RectArea Light')
export class RectAreaLight2 extends RectAreaLight implements ILight<undefined> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    uiConfig: UiObjectConfig
    readonly isRectAreaLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
    declare visible: boolean

    @uiColor('Color', (that: RectAreaLight2)=>({onChange: ()=>that.setDirty()}))
    declare color: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
    declare intensity: number
    @uiNumber('Width')
    @onChange3('setDirty')
    declare width: number
    @uiNumber('Height')
    @onChange3('setDirty')
    declare height: number
    @uiNumber('Power')
    @onChange3('setDirty')
    declare power: number


    constructor(color?: ColorRepresentation, intensity?: number, width?: number, height?: number) {
        super(color, intensity, width, height)
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
    copy: (source: RectAreaLight|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    // dispatchEvent: (event: ILightEvent) => void
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}
