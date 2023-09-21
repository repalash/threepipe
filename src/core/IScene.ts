import {IObject3D, IObject3DEvent, IObject3DEventTypes, IObject3DUserData, IObjectSetDirtyOptions} from './IObject'
import {Color, Scene} from 'three'
import {IShaderPropertiesUpdater} from '../materials'
import {ICamera} from './ICamera'
import {Box3B} from '../three'
import {ITexture} from './ITexture'

export interface AddObjectOptions {
    /**
     * Add directly to the {@link RootScene} object instead of {@link RootScene.modelRoot}
     * @default false
     */
    addToRoot?: boolean
    /**
     * Automatically center the object in the scene.
     * @default false
     */
    autoCenter?: boolean,
    /**
     * Add a license to the object
     */
    license?: string,
    /**
     * Automatically scale the object according to its bounding box and the {@link autoScaleRadius} setting
     * @default false
     */
    autoScale?: boolean
    /**
     * Radius to use for {@link autoScale}
     * @default 2
     */
    autoScaleRadius?: number
    /**
     * any attached viewer config will be ignored if this is set to true
     * @default true
     */
    importConfig?: boolean

    /**
     * Clear the viewer scene objects before the new object is added. Same as {@link disposeSceneObjects} but does not dispose the objects.
     */
    clearSceneObjects?: boolean
    /**
     * Dispose all the scene objects before the new object is added. Same as {@link clearSceneObjects} but also disposes the objects.
     */
    disposeSceneObjects?: boolean


    // TODO; add more options
}

// | string
export type ISceneEventTypes = IObject3DEventTypes | 'sceneUpdate' | 'addSceneObject' |
    'mainCameraChange' | 'mainCameraUpdate' | 'environmentChanged' | 'backgroundChanged' |
    'update' | // todo: deprecate, use 'sceneUpdate' instead
    'textureAdded' | // todo remove
    'activeCameraChange' | 'activeCameraUpdate' | // todo: deprecate
    'sceneMaterialUpdate' // todo deprecate: use 'materialUpdate' instead
// | string

export interface ISceneEvent<T extends string = ISceneEventTypes> extends IObject3DEvent<T> {
    scene?: IScene | null
    // change?: string
}
export type ISceneSetDirtyOptions = IObjectSetDirtyOptions


export type ISceneUserData = IObject3DUserData

export type IWidget = IObject3D // todo

export interface IScene<E extends ISceneEvent = ISceneEvent, ET extends ISceneEventTypes = ISceneEventTypes>
    extends Scene<E, ET>, IObject3D<E, ET>, IShaderPropertiesUpdater {
    readonly visible: boolean;
    readonly isScene: true;
    mainCamera: ICamera;
    type: 'Scene';

    toJSON(): any; // todo

    modelRoot: IObject3D;
    // sceneObjects: ISceneObject[];
    // environmentLight?: IEnvironmentLight;
    // processors: ObjectProcessorMap<'environment' | 'background'>

    addObject<T extends IObject3D>(imported: T, options?: AddObjectOptions): T&IObject3D;

    setDirty(e?: ISceneSetDirtyOptions): void

    // sceneBounds: Box3B; // last computed scene bounds
    getBounds(precise?: boolean, ignoreInvisible?: boolean): Box3B;

    backgroundIntensity: number;
    envMapIntensity: number;
    fixedEnvMapDirection: boolean;

    environment: ITexture | null;
    background: ITexture | Color | null | 'environment';
    backgroundColor: Color | null;

    // addWidget(widget: IWidget, options?: AnyOptions): void; // todo

    defaultCamera: ICamera
    userData: ISceneUserData


    // region deprecated

    /**
     @deprecated use {@link getObjectByName} instead
     * @param name
     * @param parent
     */
    findObjectsByName(name: string, parent?: any): any[];
    /**
     * @deprecated renamed to {@link mainCamera}
     */
    activeCamera: ICamera;

    // endregion

    // region inherited type fixes
    // re-declaring from IObject3D because: https://github.com/microsoft/TypeScript/issues/16936

    traverse(callback: (object: IObject3D) => void): void
    traverseVisible(callback: (object: IObject3D) => void): void
    traverseAncestors(callback: (object: IObject3D) => void): void
    getObjectById<T extends IObject3D = IObject3D>(id: number): T | undefined
    getObjectByName<T extends IObject3D = IObject3D>(name: string): T | undefined
    getObjectByProperty<T extends IObject3D = IObject3D>(name: string, value: string): T | undefined
    copy(source: this, recursive?: boolean): this
    clone(recursive?: boolean): this
    add(...object: IObject3D[]): this
    remove(...object: IObject3D[]): this
    parent: IObject3D | null
    children: IObject3D[]

    // endregion

}
