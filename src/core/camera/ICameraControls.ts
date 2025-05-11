import {IUiConfigContainer} from 'uiconfig.js'
import {Camera, EventDispatcher, Object3D, Vector3} from 'three'

export interface ICameraControlsEventMap {
    change: object
}

export interface ICameraControls<TE extends ICameraControlsEventMap = ICameraControlsEventMap> extends IUiConfigContainer<void, 'panel'|'folder'>, EventDispatcher<TE> {
    object: Object3D
    enabled: boolean
    domElement?: HTMLElement | Document;

    dispose(): void

    update(): void

    // optional items
    target?: Vector3
    autoRotate?: boolean
    minDistance?: number
    maxDistance?: number
    minZoom?: number
    maxZoom?: number
    enableDamping?: boolean
    enableZoom?: boolean
    enableRotate?: boolean
}

export type TControlsCtor = (camera: Camera, domElement?: HTMLCanvasElement|Document)=>ICameraControls
