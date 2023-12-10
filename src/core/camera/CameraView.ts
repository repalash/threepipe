import {Event, EventDispatcher, Quaternion, Vector3} from 'three'
import {onChange, serializable, serialize} from 'ts-browser-helpers'
import {IUiConfigContainer, uiButton, uiInput, uiNumber, UiObjectConfig, uiPanelContainer, uiVector} from 'uiconfig.js'
import {ICamera} from '../ICamera'
import {generateUUID} from '../../three'

export interface ICameraView extends IUiConfigContainer{
    name: string
    position: Vector3
    target: Vector3
    quaternion: Quaternion
    zoom: number
    isWorldSpace?: boolean
    animate(camera?: ICamera, duration?: number): void
    set(camera?: ICamera): void
    update(camera?: ICamera): void
    delete(camera?: ICamera): void
}

@serializable('CameraView')
@uiPanelContainer('Camera View')
export class CameraView extends EventDispatcher<Event, 'setView'|'animateView'|'updateView'|'deleteView'> implements ICameraView, IUiConfigContainer {
    uuid = generateUUID()
    @onChange(CameraView.prototype._nameChanged)
    @serialize() @uiInput() name = 'Camera View'

    @serialize() @uiVector() position = new Vector3()
    @serialize() @uiVector() target = new Vector3()
    @serialize() @uiVector() quaternion = new Quaternion()
    @serialize() @uiNumber() zoom = 1
    @serialize() isWorldSpace = true

    @uiButton() set = (camera?: ICamera) => this.dispatchEvent({type: 'setView', camera, view: this})
    @uiButton() update = (camera?: ICamera) => this.dispatchEvent({type: 'updateView', camera, view: this})
    @uiButton() delete = (camera?: ICamera) => this.dispatchEvent({type: 'deleteView', camera, view: this})
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
