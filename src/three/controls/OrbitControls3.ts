import {OrbitControls, OrbitControlsEventMap} from 'three/examples/jsm/controls/OrbitControls.js'
import {IUiConfigContainer, uiInput, UiObjectConfig, uiPanelContainer, uiToggle, uiVector} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {ICameraControls} from '../../core'
import {Vector3} from 'three'

@uiPanelContainer('Orbit Controls')
export class OrbitControls3 extends OrbitControls implements IUiConfigContainer, ICameraControls<OrbitControlsEventMap> {
    uiConfig?: UiObjectConfig<void, 'panel'>

    @serialize() type = 'OrbitControls'

    @uiToggle() enabled = true

    @uiToggle() @serialize() dollyZoom = false
    @uiToggle() @serialize() zoomToCursor = false

    @uiToggle() @serialize() enableDamping = true
    @uiInput() @serialize() dampingFactor = 0.08

    @uiToggle() @serialize() autoRotate = false
    @uiInput() @serialize() autoRotateSpeed = 2.0

    @uiToggle() @serialize() enableZoom = true
    @uiInput() @serialize() zoomSpeed = 0.15
    @uiInput() @serialize() maxZoomSpeed = 0.20

    @uiToggle() @serialize() enableRotate = true
    @uiInput() @serialize() rotateSpeed = 2.0

    @uiToggle() @serialize() enablePan = true
    @uiInput() @serialize() panSpeed = 1.0

    @uiInput() @serialize() autoPushTarget = false
    @uiInput() @serialize() autoPullTarget = false
    @uiInput() @serialize() minDistance = 0.35
    @uiInput() @serialize() maxDistance = 1e6 // should be Infinity but this breaks the UI

    @uiInput() @serialize() minZoom = 0.01
    @uiInput() @serialize() maxZoom = 1e6 // should be Infinity but this breaks the UI

    @uiInput() @serialize() minPolarAngle = 0
    @uiInput() @serialize() maxPolarAngle = Math.PI

    @uiInput() @serialize() minAzimuthAngle = -1e6 // should be -Infinity but this breaks the UI
    @uiInput() @serialize() maxAzimuthAngle = 1e6 // should be Infinity but this breaks the UI

    @uiVector() @serialize() clampMin = new Vector3(-1e6, -1e6, -1e6) // should be -Infinity but this breaks the UI
    @uiVector() @serialize() clampMax = new Vector3(1e6, 1e6, 1e6) // should be Infinity but this breaks the UI

    // @uiToggle()
    @serialize() screenSpacePanning = true
    // @uiInput()
    @serialize() keyPanSpeed = 7.0

    throttleUpdate = 60 // throttle to 60 updates per second (implemented in OrbitControls.js.update() method)

    stopDamping!: () => void
}
