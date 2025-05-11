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
    @uiToggle() @serialize() enabled: boolean
    @uiInput() @serialize() cameraRadius: number
    @uiInput() @serialize() rotationSpeed: number
    @uiInput() @serialize() minAltitude: number
    @uiInput() @serialize() maxAltitude: number
    @uiInput() @serialize() minDistance: number
    @uiInput() @serialize() maxDistance = 1e9 // should be Infinity but this breaks the UI
    @uiInput() @serialize() minZoom: number
    @uiInput() @serialize() maxZoom = 1e9 // should be Infinity but this breaks the UI
    @uiInput() @serialize() zoomSpeed: number
    @uiToggle() @serialize() adjustHeight: boolean
    @uiToggle() @serialize() enableDamping: boolean
    @uiInput() @serialize() dampingFactor: number
    @uiToggle() @serialize() useFallbackPlane: boolean

    @uiVector() @serialize() pivotPoint: Vector3

    // does nothing right now, required so autoLookAtTarget is not used
    target = new Vector3()

    get object() {
        // @ts-expect-error not in ts
        return this.camera as Camera/* |null*/
    }

    declare uiConfig: UiObjectConfig<void, 'folder'>
}
