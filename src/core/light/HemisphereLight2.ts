import {Color, ColorRepresentation, HemisphereLight, Vector3} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, uiFolderContainer, UiObjectConfig, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'

@uiFolderContainer('Hemisphere Light')
export class HemisphereLight2 extends HemisphereLight implements ILight<undefined> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    declare uiConfig: UiObjectConfig
    readonly isHemisphereLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
    declare visible: boolean

    @uiColor('Sky Color', (that: HemisphereLight2)=>({onChange: ()=>that.setDirty()}))
    declare color: Color
    @uiColor('Ground Color', (that: HemisphereLight2)=>({onChange: ()=>that.setDirty()}))
    declare groundColor: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
    declare intensity: number
    @uiVector('Position', undefined, undefined, (that: HemisphereLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly position: Vector3

    constructor(skyColor?: ColorRepresentation, groundColor?: ColorRepresentation, intensity?: number) {
        super(skyColor, groundColor, intensity)
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
    copy: (source: HemisphereLight|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    // dispatchEvent: (event: ILightEvent) => void
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}
