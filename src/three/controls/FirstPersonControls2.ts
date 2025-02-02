import {EventDispatcher, MathUtils, Object3D, Spherical, Vector3} from 'three'
import {IEvent, now, serialize} from 'ts-browser-helpers'
import {uiInput, uiPanelContainer, uiToggle} from 'uiconfig.js'
import {ICameraControls, ICameraControlsEventMap} from '../../core'

// eslint-disable-next-line @typescript-eslint/naming-convention
const _lookDirection = new Vector3()
// eslint-disable-next-line @typescript-eslint/naming-convention
const _spherical = new Spherical()
// eslint-disable-next-line @typescript-eslint/naming-convention
const _target = new Vector3()

// eslint-disable-next-line @typescript-eslint/naming-convention
const _changeEvent: IEvent<'change'> = {type: 'change'}

// todo bug - this is not showing in the UI. To test, switch to threeFirstPerson controlsMode for Default Camera in the tweakpane editor
@uiPanelContainer('First Person Controls')
export class FirstPersonControls2 extends EventDispatcher<ICameraControlsEventMap> implements ICameraControls {
    readonly object: Object3D
    readonly domElement: HTMLElement | Document

    // API
    @serialize() @uiToggle() enabled = true
    @serialize() @uiToggle() enableKeys = true

    @serialize() @uiInput() movementSpeed = 1.0
    @serialize() @uiInput() lookSpeed = 0.005

    @serialize() @uiToggle() lookVertical = true
    @serialize() @uiToggle() autoForward = false

    @serialize() @uiToggle() activeLook = true

    @serialize() @uiToggle() heightSpeed = false
    @serialize() @uiInput() heightCoef = 1.0
    @serialize() @uiInput() heightMin = 0.0
    @serialize() @uiInput() heightMax = 1.0

    @serialize() @uiToggle() constrainVertical = false
    @serialize() @uiInput() verticalMin = 0
    @serialize() @uiInput() verticalMax = Math.PI

    @serialize() @uiToggle() mouseDragOn = false

    // internals

    autoSpeedFactor = 0.0

    pointerX = 0
    pointerY = 0

    moveForward = false
    moveBackward = false
    moveLeft = false
    moveRight = false
    moveUp = false
    moveDown = false

    viewHalfX = 0
    viewHalfY = 0

    // private variables

    // eslint-disable-next-line @typescript-eslint/naming-convention
    private lat = 0
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private lon = 0

    constructor(object: Object3D, domElement: HTMLElement|Document) {
        super()

        this.object = object
        this.domElement = domElement

        this.onPointerMove = this.onPointerMove.bind(this)
        this.onPointerDown = this.onPointerDown.bind(this)
        this.onPointerUp = this.onPointerUp.bind(this)
        this.onKeyDown = this.onKeyDown.bind(this)
        this.onKeyUp = this.onKeyUp.bind(this)
        this.onContextMenu = this.onContextMenu.bind(this)

        this.domElement.addEventListener('contextmenu', this.onContextMenu)
        ;(this.domElement as HTMLElement).addEventListener('pointermove', this.onPointerMove)
        ;(this.domElement as HTMLElement).addEventListener('pointerdown', this.onPointerDown)
        ;(this.domElement as HTMLElement).addEventListener('pointerup', this.onPointerUp)

        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)

        this.handleResize()

        this.setOrientation()

    }

    setOrientation() {

        const quaternion = this.object.quaternion

        _lookDirection.set(0, 0, -1).applyQuaternion(quaternion)
        _spherical.setFromVector3(_lookDirection)

        this.lat = 90 - MathUtils.radToDeg(_spherical.phi)
        this.lon = MathUtils.radToDeg(_spherical.theta)

    }

    handleResize() {

        if (this.domElement === document) {

            this.viewHalfX = window.innerWidth / 2
            this.viewHalfY = window.innerHeight / 2

        } else {

            this.viewHalfX = (this.domElement as HTMLElement).offsetWidth / 2
            this.viewHalfY = (this.domElement as HTMLElement).offsetHeight / 2

        }

    }

    onPointerDown(event: PointerEvent) {

        if (this.domElement !== document) {

            (this.domElement as HTMLElement).focus()

        }

        if (this.activeLook) {

            switch (event.button) {

            case 0: this.moveForward = true; break
            case 2: this.moveBackward = true; break
            default: break

            }

        }

        this.mouseDragOn = true

    }

    onPointerUp(event: PointerEvent) {

        if (this.activeLook) {

            switch (event.button) {

            case 0: this.moveForward = false; break
            case 2: this.moveBackward = false; break
            default: break

            }

        }

        this.mouseDragOn = false

    }

    onPointerMove(event: PointerEvent) {

        if (this.domElement === document) {

            this.pointerX = event.pageX - this.viewHalfX
            this.pointerY = event.pageY - this.viewHalfY

        } else {

            this.pointerX = event.pageX - (this.domElement as HTMLElement).offsetLeft - this.viewHalfX
            this.pointerY = event.pageY - (this.domElement as HTMLElement).offsetTop - this.viewHalfY

        }

    }

    onKeyDown(event: KeyboardEvent) {
        if (!this.enableKeys) return

        switch (event.code) {

        case 'ArrowUp':
        case 'KeyW': this.moveForward = true; break

        case 'ArrowLeft':
        case 'KeyA': this.moveLeft = true; break

        case 'ArrowDown':
        case 'KeyS': this.moveBackward = true; break

        case 'ArrowRight':
        case 'KeyD': this.moveRight = true; break

        case 'KeyR': this.moveUp = true; break
        case 'KeyF': this.moveDown = true; break

        default: break

        }

    }

    onKeyUp(event: KeyboardEvent) {
        if (!this.enableKeys) return

        switch (event.code) {

        case 'ArrowUp':
        case 'KeyW': this.moveForward = false; break

        case 'ArrowLeft':
        case 'KeyA': this.moveLeft = false; break

        case 'ArrowDown':
        case 'KeyS': this.moveBackward = false; break

        case 'ArrowRight':
        case 'KeyD': this.moveRight = false; break

        case 'KeyR': this.moveUp = false; break
        case 'KeyF': this.moveDown = false; break

        default: break

        }

    }

    lookAt(x: number|Vector3, y?: number, z?: number) {

        if ((x as Vector3).isVector3) {

            _target.copy(x as Vector3)

        } else {

            if (y === undefined || z === undefined) console.error('FirstPersonControls2.lookAt: y and z parameters are required')
            else _target.set(x as number, y, z)

        }

        this.object.lookAt(_target)

        this.setOrientation()

        return this

    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    private targetPosition = new Vector3()

    private _lastTime = -1 // in ms

    update() {
        const time = now() // in ms
        const delta = (this._lastTime < 0 ? 16 : Math.min(time - this._lastTime, 1000)) / 1000 // in secs
        this._lastTime = time
        // console.log(delta)

        if (!this.enabled) return

        if (this.heightSpeed) {

            const y = MathUtils.clamp(this.object.position.y, this.heightMin, this.heightMax)
            const heightDelta = y - this.heightMin

            this.autoSpeedFactor = delta * (heightDelta * this.heightCoef)

        } else {

            this.autoSpeedFactor = 0.0

        }

        const actualMoveSpeed = delta * this.movementSpeed

        if (this.moveForward || this.autoForward && !this.moveBackward) this.object.translateZ(-(actualMoveSpeed + this.autoSpeedFactor))
        if (this.moveBackward) this.object.translateZ(actualMoveSpeed)

        if (this.moveLeft) this.object.translateX(-actualMoveSpeed)
        if (this.moveRight) this.object.translateX(actualMoveSpeed)

        if (this.moveUp) this.object.translateY(actualMoveSpeed)
        if (this.moveDown) this.object.translateY(-actualMoveSpeed)

        let actualLookSpeed = delta * this.lookSpeed

        if (!this.activeLook) {

            actualLookSpeed = 0

        }

        let verticalLookRatio = 1

        if (this.constrainVertical) {

            verticalLookRatio = Math.PI / (this.verticalMax - this.verticalMin)

        }

        this.lon -= this.pointerX * actualLookSpeed
        if (this.lookVertical) this.lat -= this.pointerY * actualLookSpeed * verticalLookRatio

        this.lat = Math.max(-85, Math.min(85, this.lat))

        let phi = MathUtils.degToRad(90 - this.lat)
        const theta = MathUtils.degToRad(this.lon)

        if (this.constrainVertical) {

            phi = MathUtils.mapLinear(phi, 0, Math.PI, this.verticalMin, this.verticalMax)

        }

        const position = this.object.position

        this.targetPosition.setFromSphericalCoords(1, phi, theta).add(position)

        this.object.lookAt(this.targetPosition)
        this.dispatchEvent(_changeEvent)

    }

    dispose() {

        this.domElement.removeEventListener('contextmenu', this.onContextMenu)
        ;(this.domElement as HTMLElement).removeEventListener('pointerdown', this.onPointerDown)
        ;(this.domElement as HTMLElement).removeEventListener('pointermove', this.onPointerMove)
        ;(this.domElement as HTMLElement).removeEventListener('pointerup', this.onPointerUp)

        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)

    }

    onContextMenu(event: Event) {
        if (!this.enableKeys) return

        event.preventDefault()

    }

}

