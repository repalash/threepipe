import {Event, EventDispatcher, Quaternion, Vector3} from 'three'
import {onChange, serializable, serialize} from 'ts-browser-helpers'
import {IUiConfigContainer, uiButton, uiInput, uiNumber, UiObjectConfig, uiPanelContainer, uiVector} from 'uiconfig.js'
import {ICamera} from '../ICamera'

export interface ICameraView{
    name: string
    position: Vector3
    target: Vector3
    quaternion: Quaternion
    zoom: number
    animate(camera?: ICamera, duration?: number): void
    set(camera?: ICamera): void
}

@serializable('CameraView')
@uiPanelContainer('Camera View')
export class CameraView extends EventDispatcher<Event, 'setView'|'animateView'> implements ICameraView, IUiConfigContainer {
    @onChange(CameraView.prototype._nameChanged)
    @serialize() @uiInput() name = 'Camera View'

    @serialize() @uiVector() position = new Vector3()
    @serialize() @uiVector() target = new Vector3()
    @serialize() @uiVector() quaternion = new Quaternion()
    @serialize() @uiNumber() zoom = 1

    @uiButton() set = (camera?: ICamera) => this.dispatchEvent({type: 'setView', camera, view: this})
    @uiButton() animate = (camera?: ICamera, duration?: number) => this.dispatchEvent({type: 'animateView', camera, duration, view: this})

    constructor(name?: string, position?: Vector3, target?: Vector3, quaternion?: Quaternion, zoom?: number) {
        super()
        if (name !== undefined) this.name = name
        if (position) this.position.copy(position)
        if (target) this.target.copy(target)
        if (quaternion) this.quaternion.copy(quaternion)
        if (zoom !== undefined) this.zoom = zoom
    }

    private _nameChanged() {
        if (this.uiConfig) {
            this.uiConfig.label = this.name
            this.uiConfig.uiRefresh?.()
        }
    }

    clone() {
        return new CameraView(this.name, this.position, this.target, this.quaternion, this.zoom)
    }

    uiConfig?: UiObjectConfig
    // uiConfig = generateUiFolder(this.name, this)
}
