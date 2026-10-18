import {OrbitControls, OrbitControlsEventMap} from 'three/examples/jsm/controls/OrbitControls.js'
import {IUiConfigContainer, uiInput, UiObjectConfig, uiPanelContainer, uiToggle, uiVector} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {ICameraControls} from '../../core'
import {Quaternion, Spherical, Vector2, Vector3} from 'three'

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

    // OrbitControls' pending input, untyped in three's declarations.
    declare protected _sphericalDelta: Spherical
    declare protected _panOffset: Vector3
    declare protected _scale: number
    declare protected _performCursorZoom: boolean
    declare protected _mouse: Vector2

    private _idlePosition = new Vector3()
    private _idleQuaternion = new Quaternion()
    private _idleTarget = new Vector3()

    /**
     * `OrbitControls.update` rebuilds the camera position from spherical coordinates on every call, and that
     * round trip is not exact: a camera placed at `[6, 4, 6]` reads `[6, 4, 6.000000000000001]` after the
     * next frame, and everything serialised from it (the viewer config in an export) changes with it. When
     * no input is pending - no rotate, pan or dolly delta, no auto-rotate, no cursor zoom - and the update
     * moved the camera only by that rounding, put it back exactly where it was. Constraints still apply:
     * a camera outside its limits moves by more than rounding and keeps the move.
     */
    update(deltaTime?: number | null): boolean {
        const d = this._sphericalDelta
        const idle = !this.autoRotate && !!d && d.theta === 0 && d.phi === 0 && d.radius === 0
            && this._panOffset.lengthSq() === 0 && this._scale === 1 && !this._performCursorZoom
        if (!idle) return super.update(deltaTime)
        const position = this._idlePosition.copy(this.object.position)
        const quaternion = this._idleQuaternion.copy(this.object.quaternion)
        const target = this._idleTarget.copy(this.target)
        const changed = super.update(deltaTime)
        // a few ulps of the coordinates' magnitude
        const noise = 1e-24 * Math.max(1, position.lengthSq(), target.lengthSq())
        if (this.object.position.distanceToSquared(position) <= noise && this.target.distanceToSquared(target) <= noise
            && 1 - Math.abs(this.object.quaternion.dot(quaternion)) <= 1e-12) {
            this.object.position.copy(position)
            this.object.quaternion.copy(quaternion)
            this.target.copy(target)
            this.object.updateMatrixWorld()
        }
        return changed
    }
}
