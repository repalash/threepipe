import {
    ACameraControlsPlugin,
    Camera,
    serialize,
    TControlsCtor,
    uiFolderContainer,
    uiInput,
    uiToggle,
    uiVector,
    Vector3,
} from 'threepipe'
import {EnvironmentControls} from '3d-tiles-renderer'
import {UiObjectConfig} from 'uiconfig.js'

export class EnvironmentControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'EnvironmentControlsPlugin'
    readonly controlsKey = 'environment'

    protected _controlsCtor: TControlsCtor = (object, domElement) => {
        return new EnvironmentControls2(object.parent ?? undefined, object, !domElement?.ownerDocument ? (domElement || document).documentElement : domElement)
    }
}

@uiFolderContainer('Environment Controls')
export class EnvironmentControls2 extends EnvironmentControls {
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

    @uiVector() @serialize() declare pivotPoint: Vector3

    // does nothing right now, required so autoLookAtTarget is not used
    target = new Vector3()

    get object() {
        // @ts-expect-error not in ts
        return this.camera as Camera/* |null*/
    }

    declare uiConfig: UiObjectConfig<void, 'folder'>
}
