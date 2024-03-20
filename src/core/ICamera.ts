import {Camera, Vector3} from 'three'
import {IObject3D, IObject3DEvent, IObject3DEventTypes, IObject3DUserData, IObjectSetDirtyOptions} from './IObject'
import {IShaderPropertiesUpdater} from '../materials'
import {ICameraControls, TControlsCtor} from './camera/ICameraControls'
import {CameraView, ICameraView} from './camera/CameraView'

/**
 * Available modes for {@link ICamera.controlsMode} property.
 * This is defined just for autocomplete, these and any other control type can be added by plugins
 */
export type TCameraControlsMode = '' | 'orbit' | 'deviceOrientation' | 'threeFirstPerson' | 'pointerLock' | string

export interface ICameraUserData extends IObject3DUserData {
    autoNearFar?: boolean // default = true
    minNearPlane?: number // default = 0.2
    maxFarPlane?: number // default = 1000
    autoLookAtTarget?: boolean // default = false, only for when controls and interactions are disabled

    __lastScale?: Vector3,
    __isMainCamera?: boolean,
    __cameraSetup?: boolean,

    // [key: string]: any // commented for noe
}

export interface ICamera<E extends ICameraEvent = ICameraEvent, ET extends ICameraEventTypes = ICameraEventTypes> extends Camera<E, ET>, IObject3D<E, ET>, IShaderPropertiesUpdater {
    assetType: 'camera'
    readonly isCamera: true
    setDirty(options?: ICameraSetDirtyOptions): void;

    readonly isMainCamera: boolean;
    readonly isPerspectiveCamera?: boolean;
    readonly isOrthographicCamera?: boolean;

    activateMain(options?: Partial<ICameraEvent>, _internal?: boolean, _refresh?: boolean): void;
    deactivateMain(options?: Partial<ICameraEvent>, _internal?: boolean, _refresh?: boolean): void;

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

    readonly interactionsEnabled: boolean;
    setInteractions(enabled: boolean, by: string): void;

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
    setViewToMain(eventOptions: Partial<ICameraEvent>): void
    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse(callback: (object: IObject3D) => void): void
    traverseVisible(callback: (object: IObject3D) => void): void
    traverseAncestors(callback: (object: IObject3D) => void): void
    getObjectById<T extends IObject3D = IObject3D>(id: number): T | undefined
    getObjectByName<T extends IObject3D = IObject3D>(name: string): T | undefined
    getObjectByProperty<T extends IObject3D = IObject3D>(name: string, value: string): T | undefined
    copy(source: this, recursive?: boolean, distanceFromTarget?: number, worldSpace?: boolean, ...args: any[]): this
    clone(recursive?: boolean): this
    add(...object: IObject3D[]): this
    remove(...object: IObject3D[]): this
    parent: IObject3D | null
    children: IObject3D[]

    // endregion
}


export type ICameraEventTypes = IObject3DEventTypes | 'update'// | string
export type ICameraEvent = Omit<IObject3DEvent, 'type'> & {
    type: ICameraEventTypes
    camera?: ICamera | null
    // change?: string
}
export type ICameraSetDirtyOptions = IObjectSetDirtyOptions

