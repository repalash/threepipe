import {
    ACameraControlsPlugin, ICamera,
    OrthographicCamera2,
    PerspectiveCamera2,
    serialize,
    TControlsCtor,
    uiFolderContainer,
    uiInput,
    uiToggle,
    uiVector,
    Vector3,
} from 'threepipe'
import {GlobeControls} from '3d-tiles-renderer'
import {UiObjectConfig} from 'uiconfig.js'

export class GlobeControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'GlobeControlsPlugin'
    readonly controlsKey = 'globe'

    protected _controlsCtor: TControlsCtor = (object, domElement) => {
        if ((object as ICamera).userData.autoNearFar) {
            console.warn('GlobeControlsPlugin: autoNearFar is not supported with GlobeControlsPlugin, it will be disabled, use EnvironmentControlsPlugin instead to keep default behaviour')
            ;(object as ICamera).userData.autoNearFar = false
        }
        return new GlobeControls2(object.parent ?? undefined, object, !domElement?.ownerDocument ? (domElement || document).documentElement : domElement)
    }
}

@uiFolderContainer('Globe Controls')
export class GlobeControls2 extends GlobeControls {
    @uiToggle() @serialize() declare enabled: boolean
    @uiInput() @serialize() declare cameraRadius: number
    @uiInput() @serialize() declare rotationSpeed: number
    @uiInput() @serialize() declare minAltitude: number
    @uiInput() @serialize() declare maxAltitude: number
    @uiInput() @serialize() declare minDistance: number
    @uiInput() @serialize() maxDistance = 1e9 // should be Infinity but this breaks the UI
    @uiInput() @serialize() declare minZoom: number
    @uiInput() @serialize() maxZoom = 1e9 // should be Infinity but this breaks the UI
    @uiInput() @serialize() declare zoomSpeed: number
    @uiToggle() @serialize() declare adjustHeight: boolean
    @uiToggle() @serialize() declare enableDamping: boolean
    @uiInput() @serialize() declare dampingFactor: number
    @uiToggle() @serialize() declare useFallbackPlane: boolean

    @uiToggle() @serialize() declare nearMargin: number
    @uiToggle() @serialize() declare farMargin: number

    @uiVector() @serialize() declare pivotPoint: Vector3

    declare camera: PerspectiveCamera2 | OrthographicCamera2
    // does nothing right now, required so autoLookAtTarget is not used
    target = new Vector3()

    get object() {
        return this.camera
    }

    declare uiConfig: UiObjectConfig<void, 'folder'>

    // this is a workaround required because GlobeControls changes the near, far and we need it in minNear and minFar
    update(deltaTime?: number) {
        const {near, far} = this.camera
        super.update(deltaTime)
        if (this.camera.userData.autoNearFar || this.camera.userData.autoNearFar === undefined) return
        if (this.camera.near !== near || this.camera.far !== far) {
            this.camera.userData.minNearPlane = this.camera.near // dont set without userData, as that will trigger setDirty
            this.camera.userData.maxFarPlane = this.camera.far
            this.camera.near = near
            this.camera.far = far
            this.camera.updateProjectionMatrix()
        }
    }

}
