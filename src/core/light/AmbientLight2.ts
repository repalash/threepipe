import {AmbientLight, Color, ColorRepresentation} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {generateUiConfig, uiColor, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'
import {objectActionsUiConfig} from '../object/IObjectUi'

/**
 * Extension of three.js AmbientLight with additional properties for serialization and UI
 * Ambient light globally illuminates all objects in the scene equally.
 *
 * Note - gltf serialization is handled by {@link GLTFLightExtrasExtension}
 *
 * @category Lights
 */
export class AmbientLight2 extends AmbientLight implements ILight<undefined> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Ambient Light',
        children: [
            ...generateUiConfig(this),
            ...objectActionsUiConfig.call(this),
        ],
    }
    readonly isAmbientLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
    declare visible: boolean

    @uiColor('Color', (that: AmbientLight2)=>({onChange: ()=>that.setDirty()}))
    declare color: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
    declare intensity: number

    constructor(color?: ColorRepresentation, intensity?: number) {
        super(color, intensity)
        iLightCommons.upgradeLight.call(this)
    }

    autoScale() {
        console.warn('AutoScale not supported on Lights')
    }

    autoCenter() {
        console.warn('AutoCenter not supported on Lights')
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
    getObjectById: (id: number) => IObject3D | undefined
    getObjectByName: (name: string) => IObject3D | undefined
    getObjectByProperty: (name: string, value: string) => IObject3D | undefined
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}
