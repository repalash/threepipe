import {Color, ColorRepresentation, HemisphereLight, Vector3} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {generateUiConfig, uiColor, UiObjectConfig, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'
import {objectActionsUiConfig} from '../object/IObjectUi'

/**
 * Extension of three.js HemisphereLight with additional properties for serialization and UI
 * A hemisphere light is positioned directly above the scene and emits light that decreases from the sky color to the ground color.
 *
 * Note - gltf serialization is handled by {@link GLTFLightExtrasExtension}
 *
 * @category Lights
 */
export class HemisphereLight2 extends HemisphereLight implements ILight<undefined> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Hemisphere Light',
        children: [
            ...generateUiConfig(this),
            ...objectActionsUiConfig.call(this),
        ],
    }
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

    declare traverse: (callback: (object: IObject3D) => void) => void
    declare traverseVisible: (callback: (object: IObject3D) => void) => void
    declare traverseAncestors: (callback: (object: IObject3D) => void) => void
    declare getObjectById: (id: number) => IObject3D | undefined
    declare getObjectByName: (name: string) => IObject3D | undefined
    declare getObjectByProperty: (name: string, value: string) => IObject3D | undefined
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}
