import {Camera, Vector3} from 'three'
import {IObject3D, IObject3DEventMap, IObject3DUserData, IObjectSetDirtyOptions} from './IObject'
import {IShaderPropertiesUpdater} from '../materials'
import {ICameraControls, TControlsCtor} from './camera/ICameraControls'
import {CameraView, ICameraView} from './camera/CameraView'

/**
 * Available modes for {@link ICamera.controlsMode} property.
 * This is defined just for autocomplete, these and any other control type can be added by plugins
 */
export type TCameraControlsMode = '' | 'orbit' | 'deviceOrientation' | 'threeFirstPerson' | 'pointerLock' | string

export interface ICameraUserData extends IObject3DUserData {
    /**
     * Automatically calculate near and far planes based on the scene bounding box.
     */
    autoNearFar?: boolean
    /**
     * Minimum near plane distance. (when {@link autoNearFar} is true)
     * Or the near plane distance when {@link autoNearFar} is false.
     * @default 0.2
     */
    minNearPlane?: number
    /**
     * Maximum far plane distance. (when {@link autoNearFar} is true)
     * Or the far plane distance when {@link autoNearFar} is false.
     * @default 1000
     */
    maxFarPlane?: number
    /**
     * Automatically rotate camera to look at(lookAt) the target.
     * Only for when controls and interactions are disabled.
     * @default false
     */
    autoLookAtTarget?: boolean
    /**
     * Automatically move the camera(dolly) based on the scene size when the field of view(fov) changes.
     * Works when controls are enabled or autoLookAtTarget is true.
     *
     * Note - The camera must be added to RootScene for this to work
     */
    dollyFov?: boolean

    /**
     * Disable jitter for this camera. (for {@link SSAAPlugin})
     * @default false
     */
    disableJitter?: boolean

    __lastScale?: Vector3,
    __isMainCamera?: boolean,
    __cameraSetup?: boolean,

    // [key: string]: any // commented for noe
}

export interface ICamera<TE extends ICameraEventMap = ICameraEventMap> extends Camera<TE>, IObject3D<TE, undefined, undefined>, IShaderPropertiesUpdater {
    assetType: 'camera'
    readonly isCamera: true
    setDirty(options?: ICameraSetDirtyOptions): void;

    readonly isMainCamera: boolean;
    readonly isPerspectiveCamera?: boolean;
    readonly isOrthographicCamera?: boolean;

    activateMain(options?: Omit<ICameraEventMap['activateMain'], 'bubbleToParent'>, _internal?: boolean, _refresh?: boolean): void;
    deactivateMain(options?: Omit<ICameraEventMap['activateMain'], 'bubbleToParent'>, _internal?: boolean, _refresh?: boolean): void;

    /**
     * @deprecated use `this` instead
     */
    cameraObject: this
    readonly controls: ICameraControls|undefined;
    // getControls<T extends TControls>(): T|undefined;

    refreshTarget(): void;
    refreshAspect(setDirty?: boolean): void;

    /**
     * Target of camera, in world(global) coordinates.
     */
    target: Vector3,
    /**
     * Local position of camera.
     */
    position: Vector3,

    /**
     * If interactions are enabled for this camera. It can be disabled by some code or plugin.
     * see also {@link setInteractions}
     * @deprecated use {@link canUserInteract} to check if the user can interact with this camera
     * @readonly
     */
    readonly interactionsEnabled: boolean;
    setInteractions(enabled: boolean, by: string, setDirty?: boolean): void;

    /**
     * Check whether user can interact with this camera.
     * Interactions can be enabled/disabled in a variety of ways,
     * like {@link setInteractions}, {@link controlsMode}, {@link isMainCamera} property
     */
    readonly canUserInteract: boolean;

    zoom: number;
    /**
     * Camera frustum aspect ratio, window width divided by window height.
     * It can be managed internally if {@link autoAspect} is true.
     * @default 1
     */
    aspect: number;
    /**
     * Automatically manage aspect ratio based on window/canvas size.
     */
    autoAspect: boolean;

    controlsMode?: TCameraControlsMode; // todo add more.
    // controlsEnabled: boolean; // use controlsMode = '' instead


    /**
     * Automatically managed when {@link autoNearFar} is `true`. See also {@link minNearPlane}
     */
    near: number;
    /**
     * Automatically managed when {@link autoNearFar} is `true`. See also {@link maxFarPlane}
     */
    far: number;

    // also in userData
    autoNearFar: boolean // default = true
    minNearPlane: number // default = 0.2
    maxFarPlane: number // default = 1000

    // todo
    // Note: for userData: add _ in front of for private use, which is preserved while cloning but not serialisation, and __ for private use, which is not preserved while cloning and serialisation
    userData: ICameraUserData
    /**
     * @deprecated use {@link isMainCamera} instead
     */
    isActiveCamera: boolean;

    setControlsCtor(key: string, ctor: TControlsCtor, replace?: boolean): void;
    removeControlsCtor(key: string): void;
    refreshCameraControls(setDirty?: boolean): void

    updateProjectionMatrix(): void
    fov?: number

    /**
     * Refresh the camera frustum planes from frustumSize. Only for orthographic cameras.
     * @param setDirty
     */
    refreshFrustum?(setDirty?: boolean): void

    getView<T extends ICameraView = CameraView>(worldSpace?: boolean, cameraView?: T): T
    setView(view: ICameraView): void

    /**
     * Set camera view from another camera.
     * @param camera
     * @param distanceFromTarget - default = 4
     * @param worldSpace - default = true
     */
    setViewFromCamera(camera: ICamera|Camera, distanceFromTarget?: number, worldSpace?: boolean): void

    /**
     * Dispatches the `setView` event which triggers the main camera to set its view to this camera's view.
     * @param eventOptions
     */
    setViewToMain(eventOptions: Pick<ICameraEventMap['setView'], 'ui'>): void

    /**
     * Set the canvas which is used as dom element in controls, etc.
     * This is done by the viewer/scene when main camera is changed
     * @param canvas
     * @param refresh
     */
    setCanvas(canvas: HTMLCanvasElement|undefined, refresh?: boolean): void; // todo make optional

    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse(callback: (object: IObject3D) => void): void
    traverseVisible(callback: (object: IObject3D) => void): void
    traverseAncestors(callback: (object: IObject3D) => void): void
    getObjectById<T extends IObject3D = IObject3D>(id: number): T | undefined
    getObjectByName<T extends IObject3D = IObject3D>(name: string): T | undefined
    getObjectByProperty<T extends IObject3D = IObject3D>(name: string, value: string): T | undefined
    copy(source: ICamera|Camera, recursive?: boolean, distanceFromTarget?: number, worldSpace?: boolean, ...args: any[]): this
    clone(recursive?: boolean): this
    add(...object: IObject3D[]): this
    remove(...object: IObject3D[]): this
    parent: IObject3D | null
    children: IObject3D[]

    // endregion

    /**
     * @internal world position cache for shader updates and other purposes
     */
    _positionWorld: Vector3

    /**
     * @internal reference to the canvas element used for rendering. (for aspect ratio, etc.)
     */
    _canvas?: HTMLCanvasElement
}


// export type ICameraEventTypes = IObject3DEventTypes | 'update'// | string
// export type ICameraEvent = Omit<IObject3DEvent, 'type'> & {
//     type: ICameraEventTypes
//     camera?: ICamera | null
//     // change?: string
// }
export type ICameraSetDirtyOptions = IObjectSetDirtyOptions

export interface ICameraEventMap extends IObject3DEventMap {
    update: {
        camera: ICamera
        bubbleToParent: false
        // todo
    } & ICameraSetDirtyOptions
}
