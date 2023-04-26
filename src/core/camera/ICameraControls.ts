import {IUiConfigContainer} from 'uiconfig.js'
import {Camera, Event, EventDispatcher, Object3D, Vector3} from 'three'

export interface ICameraControls<TEvents = 'change'|string> extends IUiConfigContainer<void, 'panel'>, EventDispatcher<Event, TEvents> {
    object: Object3D
    enabled: boolean

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
