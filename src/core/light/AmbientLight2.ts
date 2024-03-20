import {AmbientLight, Color, ColorRepresentation} from 'three'
import {ILight, ILightEvent} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, uiPanelContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'

@uiPanelContainer('Ambient Light')
export class AmbientLight2 extends AmbientLight implements ILight<undefined> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    readonly isAmbientLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
        visible: boolean

    @uiColor('Color', (that: AmbientLight2)=>({onChange: ()=>that.setDirty()}))
        color: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
        intensity: number

    constructor(color?: ColorRepresentation, intensity?: number) {
        super(color, intensity)
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
    copy: (source: AmbientLight|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    dispatchEvent: (event: ILightEvent) => void
    parent: null
    children: IObject3D[]

    // endregion

}
