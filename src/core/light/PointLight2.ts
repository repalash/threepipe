import {Color, ColorRepresentation, PointLight, PointLightShadow, Vector2, Vector3} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {generateUiConfig, uiColor, uiInput, uiNumber, UiObjectConfig, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'
import {bindToValue} from '../../three'
import {objectActionsUiConfig} from '../object/IObjectUi'

/**
 * Extension of three.js PointLight with additional properties for serialization and UI
 * A point light emits light in all directions from a single point in space.
 *
 * Note - gltf serialization is handled by {@link GLTFLightExtrasExtension}
 *
 * @category Lights
 */
export class PointLight2 extends PointLight implements ILight<PointLightShadow> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Point Light',
        children: [
            ...generateUiConfig(this),
            ...objectActionsUiConfig.call(this),
        ],
    }
    readonly isPointLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
    declare visible: boolean

    @uiInput('Name')
    @onChange3('setDirty')
    declare name: string

    @uiColor('Color', (that: PointLight2)=>({onChange: ()=>that.setDirty()}))
    declare color: Color
    @uiNumber('Intensity')
    @onChange3('setDirty')
    declare intensity: number
    @uiNumber('Distance')
    @onChange3('setDirty')
    declare distance: number
    @uiNumber('Decay')
    @onChange3('setDirty')
    declare decay: number
    @uiNumber('Power')
    @onChange3('setDirty')
    declare power: number

    @uiVector('Position', undefined, undefined, (that: PointLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly position: Vector3

    @uiToggle('Cast Shadow')
    @onChange3('setDirty')
    declare castShadow: boolean

    @uiVector('Shadow Map Size')
    @bindToValue({obj: 'shadow', key: 'mapSize', onChange: PointLight2.prototype._mapSizeChanged, onChangeParams: false})
        shadowMapSize: Vector2

    protected _mapSizeChanged() {
        this.shadow.map?.dispose()
        this.shadow.mapPass?.dispose()
        this.shadow.map = null as any
        this.shadow.mapPass = null as any
        this.setDirty({change: 'shadowMapSize'})
    }

    @uiSlider('Shadow Bias', [-0.001, 0.001], 0.00001)
    @bindToValue({obj: 'shadow', key: 'bias', onChange: 'setDirty'})
        shadowBias: number

    @uiSlider('Shadow Radius', [0, 5], 0.01)
    @bindToValue({obj: 'shadow', key: 'radius', onChange: 'setDirty'})
        shadowRadius: number

    @uiNumber('Shadow Near')
    @bindToValue({obj: 'shadow', key: ['camera', 'near'], onChange: PointLight2.prototype._shadowCamUpdate})
        shadowNear: number

    @uiNumber('Shadow Far')
    @bindToValue({obj: 'shadow', key: ['camera', 'far'], onChange: PointLight2.prototype._shadowCamUpdate})
        shadowFar: number

    @uiNumber('Shadow Aspect')
    @bindToValue({obj: 'shadow', key: 'aspect', onChange: PointLight2.prototype._shadowCamUpdate})
        shadowAspect: number

    @uiSlider('Shadow FOV', [1, 179], 1)
    @bindToValue({obj: 'shadow', key: 'fov', onChange: PointLight2.prototype._shadowCamUpdate})
        shadowFov: number

    protected _shadowCamUpdate(change?: string) {
        this.shadow.camera.updateProjectionMatrix()
        this.setDirty({change})
    }
    constructor(color?: ColorRepresentation, intensity?: number, distance?: number, decay?: number) {
        super(color, intensity, distance, decay)
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
