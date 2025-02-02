import {Euler, EulerOrder, EventDispatcher, MathUtils, Object3D, Quaternion, Vector3} from 'three'
import {IEvent, now, serialize} from 'ts-browser-helpers'
import {uiButton, uiPanelContainer, uiSlider} from 'uiconfig.js'
import {ICameraControls, ICameraControlsEventMap} from '../../core'

// eslint-disable-next-line @typescript-eslint/naming-convention
const _zee = new Vector3(0, 0, 1)
// eslint-disable-next-line @typescript-eslint/naming-convention
const _euler = new Euler()
// eslint-disable-next-line @typescript-eslint/naming-convention
const _q0 = new Quaternion()
// eslint-disable-next-line @typescript-eslint/naming-convention
const _q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)) // - PI/2 around the x-axis
// eslint-disable-next-line @typescript-eslint/naming-convention
const _q2 = new Quaternion() // - PI/2 around the x-axis

// eslint-disable-next-line @typescript-eslint/naming-convention
const _changeEvent: IEvent<'change'> = {type: 'change'}

const EPS = 0.000001

@uiPanelContainer('Device Orientation Controls')
export class DeviceOrientationControls2 extends EventDispatcher<ICameraControlsEventMap> implements ICameraControls {
    object: Object3D
    enabled = false // do not serialize this as it signifies weather this is active.
    deviceOrientation?: DeviceOrientationEvent
    screenOrientation?: ScreenOrientation
    lastOrder: EulerOrder = 'XYZ'
    @serialize()
    @uiSlider('Damping', [0, 1], 0.01)
        dampingFactor = 0.05
    lastQuaternion = new Quaternion()

    constructor(object: Object3D) {

        super()

        if (window.isSecureContext === false) {

            console.error('DeviceOrientationControls2: DeviceOrientationEvent is only available in secure contexts (https)')

        }

        this.object = object

        this.lastOrder = this.object.rotation.order
        this.object.rotation.reorder('YXZ')

        // this.enabled = true

        this.connect()

    }

    onDeviceOrientationChangeEvent = (event: DeviceOrientationEvent) => {
        this.deviceOrientation = event
    }

    onScreenOrientationChangeEvent = () => {
        this.screenOrientation = screen.orientation
    }

    private _initQuaternion = new Quaternion()
    private _initQuaternionInvert = new Quaternion()
    private _initQuaternionDest = new Quaternion()

    @uiButton('Reset View')
    resetView() {
        (this._initQuaternionDest as any).__init = false
    }

    @uiButton()
    connect() {
        if (this.enabled) return

        this.onScreenOrientationChangeEvent() // run once on load

        // iOS 13+

        if (window.DeviceOrientationEvent !== undefined && typeof (window.DeviceOrientationEvent as any).requestPermission === 'function') {

            (window.DeviceOrientationEvent as any).requestPermission().then((response: string)=>{

                if (response == 'granted') {

                    window.addEventListener('orientationchange', this.onScreenOrientationChangeEvent)
                    window.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent)

                }

            }).catch((error: any)=>{

                console.error('DeviceOrientationControls2: Unable to use DeviceOrientation API:', error)

            })

        } else {

            window.addEventListener('orientationchange', this.onScreenOrientationChangeEvent)
            window.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent)

        }

        this.enabled = true
        this._initQuaternion.copy(this.object.quaternion)
        this._initQuaternionInvert.copy(this.object.quaternion).invert()

    }

    @uiButton()
    disconnect() {
        if (!this.enabled) return

        window.removeEventListener('orientationchange', this.onScreenOrientationChangeEvent)
        window.removeEventListener('deviceorientation', this.onDeviceOrientationChangeEvent)
        this._initQuaternion.identity()
        this._initQuaternionInvert.identity()
        this._initQuaternionDest = new Quaternion() // need to set a new instance here.
        this.object.rotation.reorder(this.lastOrder)
        this.lastOrder = 'XYZ'

        this.enabled = false

    }

    update() {

        if (!this.enabled) return

        const device = this.deviceOrientation

        if (device) {

            const alpha = device.alpha !== null ? MathUtils.degToRad(device.alpha) : 0 // Z

            const beta = device.beta !== null ? MathUtils.degToRad(device.beta) : 0 // X'

            const gamma = device.gamma !== null ? MathUtils.degToRad(device.gamma) : 0 // Y''

            const orient = this.screenOrientation ? MathUtils.degToRad(this.screenOrientation.angle) : 0 // O

            this.setObjectQuaternion(alpha, beta, gamma, orient)

            if (8 * (1 - this.lastQuaternion.dot(this.object.quaternion)) > EPS) {

                this.lastQuaternion.copy(this.object.quaternion)
                this.dispatchEvent(_changeEvent)

            }

        }

    }

    dispose() {

        this.disconnect()

    }

    private _lastTime = -1

    // The angles alpha, beta and gamma form a set of intrinsic Tait-Bryan angles of type Z-X'-Y''
    setObjectQuaternion(alpha: number, beta: number, gamma: number, orient: number): void {
        // if(_lastTime < 0)
        const time = now() / 1000

        _euler.set(beta, alpha, -gamma, 'YXZ') // 'ZXY' for the device, but 'YXZ' for us

        _q2.setFromEuler(_euler) // orient the device

        _q2.multiply(_q1) // camera looks out the back of the device, not the top

        _q2.multiply(_q0.setFromAxisAngle(_zee, -orient)) // adjust for screen orientation

        // debugger
        if (!(this._initQuaternionDest as any).__init) {
            this._initQuaternionDest.copy(_q2).invert()
            ;(this._initQuaternionDest as any).__init = true
        }

        _q2.premultiply(this._initQuaternionDest)

        const mTime = 1 / 60
        this.object.quaternion.multiply(this._initQuaternionInvert)
        this.object.quaternion.slerp(_q2, this.dampingFactor / (Math.min(1, time - this._lastTime) / mTime))
        this.object.quaternion.multiply(this._initQuaternion)
        // console.log(time - this._lastTime, mTime)

        this._lastTime = time
    }

}
