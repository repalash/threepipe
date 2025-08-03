import {EventDispatcher, Quaternion, Vector3} from 'three'
import {onChange3, serializable, serialize} from 'ts-browser-helpers'
import {IUiConfigContainer, uiButton, uiInput, uiNumber, UiObjectConfig, uiPanelContainer, uiVector} from 'uiconfig.js'
import {ICamera} from '../ICamera'
import {generateUUID} from '../../three'

export interface ICameraView extends IUiConfigContainer{
    name: string
    position: Vector3
    target: Vector3
    quaternion: Quaternion
    zoom: number
    /*
     * Duration multiplier when the camera is animating to the view.
     */
    duration?: number
    isWorldSpace?: boolean
    animate?(camera?: ICamera, duration?: number): void
    set?(camera?: ICamera): void
    update?(camera?: ICamera): void
    delete?(camera?: ICamera): void
    setDirty?: (ops?: any)=> void
}

export interface CameraViewEventMap {
    setView: {camera?: ICamera, view: ICameraView}
    animateView: {camera?: ICamera, duration?: number, view: ICameraView}
    updateView: {camera?: ICamera, view: ICameraView}
    deleteView: {camera?: ICamera, view: ICameraView}
    update: {key?: string}
}

@serializable('CameraView')
@uiPanelContainer('Camera View')
export class CameraView extends EventDispatcher<CameraViewEventMap> implements ICameraView, IUiConfigContainer {
    uuid = generateUUID()

    @onChange3('setDirty')
    @serialize() @uiInput() name = 'Camera View'

    @onChange3('setDirty')
    @serialize() @uiVector() position = new Vector3()
    @onChange3('setDirty')
    @serialize() @uiVector() target = new Vector3()
    @onChange3('setDirty')
    @serialize() @uiVector() quaternion = new Quaternion()
    @onChange3('setDirty')
    @serialize() @uiNumber() zoom = 1
    /**
     * Duration multiplier. Set to 0 for instant camera jump.
     */
    @onChange3('setDirty')
    @serialize() @uiNumber() duration = 1
    @onChange3('setDirty')
    @serialize() isWorldSpace = true

    @uiButton() set = (camera?: ICamera) => this.dispatchEvent({type: 'setView', camera, view: this})
    @uiButton() update = (camera?: ICamera) => this.dispatchEvent({type: 'updateView', camera, view: this})
    @uiButton() delete = (camera?: ICamera) => this.dispatchEvent({type: 'deleteView', camera, view: this})
    @uiButton() animate = (camera?: ICamera, duration?: number) => this.dispatchEvent({type: 'animateView', camera, duration, view: this})

    constructor(name?: string, position?: Vector3, target?: Vector3, quaternion?: Quaternion, zoom?: number, duration = 1, isWoldSpace?: boolean) {
        super()
        if (name !== undefined) this.name = name
        if (position) this.position.copy(position)
        if (target) this.target.copy(target)
        if (quaternion) this.quaternion.copy(quaternion)
        if (zoom !== undefined) this.zoom = zoom
        if (duration !== undefined && duration !== 0) this.duration = duration
        if (isWoldSpace !== undefined) this.isWorldSpace = isWoldSpace
    }

    setDirty = (ops?: any) => {
        this.dispatchEvent({...ops, type: 'update'})
        if (this.uiConfig) {
            if (ops?.key === 'name') {
                this.uiConfig.label = this.name
                this.uiConfig.uiRefresh?.()
            } else {
                this.uiConfig.uiRefresh?.(true, 'postFrame')
            }
        }
    }

    clone() {
        return new CameraView(this.name, this.position, this.target, this.quaternion, this.zoom, this.duration, this.isWorldSpace)
    }

    uiConfig?: UiObjectConfig
    // uiConfig = generateUiFolder(this.name, this)

}
