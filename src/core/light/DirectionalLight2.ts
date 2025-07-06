import {Color, ColorRepresentation, DirectionalLight, DirectionalLightShadow, Euler, Vector2, Vector3} from 'three'
import {ILight} from './ILight'
import {iLightCommons} from '../object/iLightCommons'
import {IObject3D} from '../IObject'
import {uiColor, uiFolderContainer, uiNumber, UiObjectConfig, uiSlider, uiToggle, uiVector} from 'uiconfig.js'
import {onChange2, onChange3} from 'ts-browser-helpers'
import {bindToValue} from '../../three'

/**
 * Extension of three.js DirectionalLight with additional properties for serialization and UI
 * A directional light is a light source that has a position but no dimensions - a single point in space that emits light in a specific direction.
 *
 * Note - gltf serialization is handled by {@link GLTFLightExtrasExtension}
 *
 * @category Lights
 */
// todo: add Light section in the readme detailing these ...2 lights
@uiFolderContainer('Directional Light')
export class DirectionalLight2 extends DirectionalLight implements ILight<DirectionalLightShadow> {
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
    @uiSlider('Intensity', [0, 100], 0.01)
    @onChange3('setDirty')
    declare intensity: number
    @uiVector('Position', undefined, undefined, (that: DirectionalLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly position: Vector3
    @uiVector('Rotation', undefined, undefined, (that: DirectionalLight2)=>({onChange: ()=>that.setDirty()}))
    declare readonly rotation: Euler
    @uiToggle('Cast Shadow')
    @onChange3('setDirty')
    declare castShadow: boolean

    @uiVector('Shadow Map Size')
    @bindToValue({obj: 'shadow', key: 'mapSize', onChange: DirectionalLight2.prototype._mapSizeChanged, onChangeParams: false})
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

    @uiSlider('Shadow Normal Bias', [-0.1, 0.1], 0.005)
    @bindToValue({obj: 'shadow', key: 'normalBias', onChange: 'setDirty'})
        shadowNormalBias: number

    @uiSlider('Shadow Radius', [0, 5], 0.01)
    @bindToValue({obj: 'shadow', key: 'radius', onChange: 'setDirty'})
        shadowRadius: number

    @uiSlider('Shadow Frustum', [0.1, 50], 0.01)
    @onChange2(DirectionalLight2.prototype._shadowFrustumChanged)
        shadowFrustum: number

    @uiNumber('Shadow Near')
    @bindToValue({obj: 'shadow', key: ['camera', 'near'], onChange: DirectionalLight2.prototype._shadowCamUpdate})
        shadowNear: number

    @uiNumber('Shadow Far')
    @bindToValue({obj: 'shadow', key: ['camera', 'far'], onChange: DirectionalLight2.prototype._shadowCamUpdate})
        shadowFar: number

    protected _shadowFrustumChanged() {
        const v = this.shadowFrustum
        this.shadow.camera.left = -v / 2
        this.shadow.camera.right = v / 2
        this.shadow.camera.top = v / 2
        this.shadow.camera.bottom = -v / 2
        this.shadow.camera.updateProjectionMatrix()
        this.setDirty({change: 'shadowFrustum'})
    }

    protected _shadowCamUpdate(change?: string) {
        this.shadow.camera.updateProjectionMatrix()
        this.setDirty({change})
    }

    constructor(color?: ColorRepresentation, intensity?: number) {
        super(color, intensity)
        this.target.position.set(0, 0, -1) // because of GLTF spec: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_lights_punctual
        this.add(this.target) // todo: make sure the child isn't exported in gltf
        iLightCommons.upgradeLight.call(this)
        this.shadowFrustum = 10
    }

    autoScale() {
        console.warn('DirectionalLight2: AutoScale not supported on Lights')
        return this
    }

    autoCenter() {
        console.warn('DirectionalLight2: AutoCenter not supported on Lights')
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
    // dispatchEvent: (event: ILightEvent) => void
    declare parent: IObject3D | null
    declare children: IObject3D[]

    // endregion

}
