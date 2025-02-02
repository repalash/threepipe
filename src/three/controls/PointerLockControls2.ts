import {Euler, EventDispatcher, Object3D, Vector3} from 'three'
import {serialize} from 'ts-browser-helpers'
import {uiInput, uiPanelContainer, uiToggle} from 'uiconfig.js'
import {ICameraControls} from '../../core'

// eslint-disable-next-line @typescript-eslint/naming-convention
const _euler = new Euler(0, 0, 0, 'YXZ')
// eslint-disable-next-line @typescript-eslint/naming-convention
const _vector = new Vector3()

// eslint-disable-next-line @typescript-eslint/naming-convention
const _changeEvent = {type: 'change'} as const
// eslint-disable-next-line @typescript-eslint/naming-convention
const _lockEvent = {type: 'lock'} as const
// eslint-disable-next-line @typescript-eslint/naming-convention
const _unlockEvent = {type: 'unlock'} as const

export interface PointerLockControls2EventMap {
    change: Record<string, unknown>
    lock: Record<string, unknown>
    unlock: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const _PI_2 = Math.PI / 2


@uiPanelContainer('Pointer Lock Controls')
export class PointerLockControls2 extends EventDispatcher<PointerLockControls2EventMap> implements ICameraControls<PointerLockControls2EventMap> {
    readonly domElement: HTMLElement
    readonly object: Object3D
    isLocked = false

    @uiToggle() @serialize() enabled = true

    // Set to constrain the pitch of the camera
    // Range is 0 to Math.PI radians
    @uiInput() @serialize() minPolarAngle = 0 // radians
    @uiInput() @serialize() maxPolarAngle = Math.PI // radians

    @uiInput() @serialize() pointerSpeed = 1.0

    @uiToggle() @serialize() autoLockOnClick = true

    constructor(camera: Object3D, domElement: HTMLElement) {

        super()

        this.domElement = domElement
        this.object = camera
        this.onElementClick = this.onElementClick.bind(this)
        this.onMouseMove = this.onMouseMove.bind(this)
        this.onPointerlockChange = this.onPointerlockChange.bind(this)
        this.onPointerlockError = this.onPointerlockError.bind(this)

        this.connect()
    }


    onElementClick(event: Event) {

        if (this.isLocked) return
        if (!this.autoLockOnClick) return

        event.preventDefault()

        this.lock()
    }

    private _movementX = 0
    private _movementY = 0

    onMouseMove(event: MouseEvent) {

        if (!this.isLocked) return

        this._movementX += event.movementX || (event as any).mozMovementX || (event as any).webkitMovementX || 0
        this._movementY += event.movementY || (event as any).mozMovementY || (event as any).webkitMovementY || 0

    }

    onPointerlockChange() {

        if (this.domElement.ownerDocument.pointerLockElement === this.domElement) {

            this.dispatchEvent(_lockEvent)

            this.isLocked = true

        } else {

            this.dispatchEvent(_unlockEvent)

            this.isLocked = false

        }

    }

    onPointerlockError() {

        console.error('THREE.PointerLockControls: Unable to use Pointer Lock API')

    }

    connect() {

        this.domElement.ownerDocument.addEventListener('mousemove', this.onMouseMove)
        this.domElement.ownerDocument.addEventListener('pointerlockchange', this.onPointerlockChange)
        this.domElement.ownerDocument.addEventListener('pointerlockerror', this.onPointerlockError)
        this.domElement.addEventListener('click', this.onElementClick)

    }

    disconnect() {

        this.domElement.ownerDocument.removeEventListener('mousemove', this.onMouseMove)
        this.domElement.ownerDocument.removeEventListener('pointerlockchange', this.onPointerlockChange)
        this.domElement.ownerDocument.removeEventListener('pointerlockerror', this.onPointerlockError)
        this.domElement.removeEventListener('click', this.onElementClick)

    }

    dispose() {

        this.disconnect()

    }

    // getObject() { // retaining this method for backward compatibility
    //
    //     return this.object
    //
    // }


    private _forwardDirection = new Vector3(0, 0, -1)
    getDirection(v: Vector3) {

        return v.copy(this._forwardDirection).applyQuaternion(this.object.quaternion)

    }

    moveForward(distance: number) {

        // move forward parallel to the xz-plane
        // assumes camera.up is y-up

        _vector.setFromMatrixColumn(this.object.matrix, 0)

        _vector.crossVectors(this.object.up, _vector)

        this.object.position.addScaledVector(_vector, distance)

    }

    moveRight(distance: number) {

        _vector.setFromMatrixColumn(this.object.matrix, 0)

        this.object.position.addScaledVector(_vector, distance)

    }

    lock() {

        this.domElement.requestPointerLock()

    }

    unlock() {

        this.domElement.ownerDocument.exitPointerLock()

    }

    update() {

        if (Math.abs(this._movementX) < 0.0001 && Math.abs(this._movementY) < 0.0001) return

        _euler.setFromQuaternion(this.object.quaternion)

        _euler.y -= this._movementX * 0.002 * this.pointerSpeed
        _euler.x -= this._movementY * 0.002 * this.pointerSpeed

        this._movementX = 0
        this._movementY = 0

        _euler.x = Math.max(_PI_2 - this.maxPolarAngle, Math.min(_PI_2 - this.minPolarAngle, _euler.x))

        this.object.quaternion.setFromEuler(_euler)

        this.dispatchEvent(_changeEvent)

    }

}
