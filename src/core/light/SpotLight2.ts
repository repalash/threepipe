import {Color, ColorRepresentation, Euler, SpotLight, SpotLightShadow, Vector2, Vector3} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, uiFolderContainer, uiInput, uiNumber, UiObjectConfig, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange3} from 'ts-browser-helpers'
import {bindToValue} from '../../three'

/**
 * Extension of three.js SpotLight with additional properties for serialization and UI
 *
 * Note - gltf serialization is handled by {@link GLTFLightExtrasExtension}
 */
@uiFolderContainer('Spot Light')
export class SpotLight2 extends SpotLight implements ILight<SpotLightShadow> {
    assetType = 'light' as const
    setDirty = iLightCommons.setDirty
    refreshUi = iLightCommons.refreshUi
    uiConfig: UiObjectConfig
    readonly isSpotLight2 = true

    @uiToggle('Enabled')
    @onChange3('setDirty')
    declare visible: boolean

    @uiColor('Color', (that: SpotLight2)=>({onChange: ()=>that.setDirty()}))
    declare color: Color
    @uiSlider('Intensity', [0, 30], 0.01)
    @onChange3('setDirty')
    declare intensity: number
    @uiSlider('Angle', [0, 2], 0.01)
    @onChange3('setDirty')
    declare angle: number
    @uiSlider('Penumbra', [0, 0.9999], 0.01)
    @onChange3('setDirty')
    declare penumbra: number
    @uiInput('Distance')
    @onChange3('setDirty')
    declare distance: number
    @uiInput('Decay')
    @onChange3('setDirty')
    declare decay: number
    @uiVector('Position', undefined, undefined, (that: SpotLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly position: Vector3
    @uiVector('Rotation', undefined, undefined, (that: SpotLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly rotation: Euler
    @uiToggle('Cast Shadow')
    @onChange3('setDirty')
    declare castShadow: boolean

    @uiVector('Shadow Map Size')
    @bindToValue({obj: 'shadow', key: 'mapSize', onChange: SpotLight2.prototype._mapSizeChanged, onChangeParams: false})
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

    @uiSlider('Shadow Focus', [0, 1], 0.001)
    @bindToValue({obj: 'shadow', key: 'focus', onChange: 'setDirty'})
        shadowFocus: number

    @uiNumber('Shadow Near')
    @bindToValue({obj: 'shadow', key: ['camera', 'near'], onChange: SpotLight2.prototype._shadowCamUpdate})
        shadowNear: number

    @uiNumber('Shadow Far')
    @bindToValue({obj: 'shadow', key: ['camera', 'far'], onChange: SpotLight2.prototype._shadowCamUpdate})
        shadowFar: number

    @uiNumber('Shadow Aspect')
    @bindToValue({obj: 'shadow', key: 'aspect', onChange: SpotLight2.prototype._shadowCamUpdate})
        shadowAspect: number

    @uiSlider('Shadow FOV', [1, 179], 1)
    @bindToValue({obj: 'shadow', key: 'fov', onChange: SpotLight2.prototype._shadowCamUpdate})
        shadowFov: number

    protected _shadowCamUpdate(change?: string) {
        this.shadow.camera.updateProjectionMatrix()
        this.setDirty({change})
    }

    constructor(color?: ColorRepresentation, intensity?: number, distance?: number,
        angle?: number,
        penumbra?: number,
        decay?: number) {
        super(color, intensity, distance, angle, penumbra, decay)
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
    copy: (source: SpotLight|IObject3D, recursive?: boolean, ...args: any[]) => this
    clone: (recursive?: boolean) => this
    remove: (...object: IObject3D[]) => this
    // dispatchEvent: (event: ILightEvent) => void
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}
