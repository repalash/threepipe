import {IObject3D, IObject3DEventMap, IObject3DUserData, IObjectSetDirtyOptions} from './IObject'
import {Color, Scene, Texture} from 'three'
import {IShaderPropertiesUpdater} from '../materials'
import {ICamera} from './ICamera'
import {Box3B} from '../three'
import {ITexture} from './ITexture'
import {IGeometry} from './IGeometry'

export interface AddModelOptions {
    /**
     * Automatically center the object in the scene.
     * @default false
     */
    autoCenter?: boolean,
    /**
     * Automatically center the geometries(pivots) in the object hierarchy before adding.
     * @default false
     */
    centerGeometries?: boolean,
    /**
     * This centers the geometry while keeping the world position, i.e the mesh(Object3D) positions will change.
     * {@link centerGeometries} must be true for this to work.
     * @default true
     */
    centerGeometriesKeepPosition?: boolean,
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
     * {@link autoScale} must be true for this to work.
     * @default 2
     */
    autoScaleRadius?: number
}
export interface AddObjectOptions extends AddModelOptions{
    /**
     * Add directly to the {@link RootScene} object instead of {@link RootScene.modelRoot}
     * @default false
     */
    addToRoot?: boolean
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
// export type ISceneEventTypes =
//     'update' // todo: deprecate, use 'sceneUpdate' instead
// | string

// export interface ISceneEvent<T extends string = ISceneEventTypes> extends IObject3DEvent<T> {
//     scene?: IScene | null
//
//     hierarchyChanged?: boolean // for 'sceneUpdate' event
//     // change?: string
// }

export interface ISceneEventMap extends IObject3DEventMap {
    sceneUpdate: {
        hierarchyChanged?: boolean
        refreshScene?: boolean
        object?: IObject3D
        change?: ISceneEventMap['objectUpdate']['change']

        // args?: any[]
        bubbleToParent?: boolean // objectUpdate, geometryUpdate, geometryChanged
        geometry?: IGeometry|null // geometryUpdate and geometryChanged
        oldGeometry?: IGeometry|null // geometryChanged

        /**
         * @deprecated use {@link refreshScene} instead
         */
        sceneUpdate?: boolean
    } & ISceneSetDirtyOptions
    addSceneObject: {
        object: IObject3D
        options?: AddObjectOptions

        geometryChanged?: boolean
        updateGround?: boolean
    }
    mainCameraChange: {
        lastCamera: ICamera
        camera: ICamera
    }
    mainCameraUpdate: IObject3DEventMap['cameraUpdate']

    renderCameraChange: {
        lastCamera: ICamera | undefined
        camera: ICamera
    },
    // sceneUpdate: {
    //     change?: string
    //     sceneUpdate?: boolean
    //     refreshScene?: boolean
    //     hierarchyChanged: boolean
    //     geometryChanged: boolean
    // }
    environmentChanged: {
        environment: ITexture|null
    }
    backgroundChanged: {
        background: Texture | Color | 'environment' | null
        backgroundColor: Color | null
    }
    // textureAdded: {
    //     texture: ITexture
    // }

    /**
     * @deprecated use {@link mainCameraChange} instead
     */
    activeCameraChange: ISceneEventMap['mainCameraChange']
    /**
     * @deprecated use {@link mainCameraUpdate} instead
     */
    activeCameraUpdate: ISceneEventMap['mainCameraUpdate']
    /**
     * @deprecated use {@link materialUpdate} instead
     */
    sceneMaterialUpdate: IObject3DEventMap['materialUpdate']
    /**
     * @deprecated use {@link objectUpdate} or {@link sceneUpdate} instead
     */
    update: IObject3DEventMap['objectUpdate']
}

export interface ISceneSetDirtyOptions extends IObjectSetDirtyOptions{
    refreshScene?: boolean // duplicated declaration from parent intentionally
}


export type ISceneUserData = IObject3DUserData

// todo improve
export interface IWidget {
    attach(object: any): this;
    detach(): this;
    isWidget: true;

    object: any
    update?(setDirty?: boolean): void

    dispose?(): void
}

export interface IScene<TE extends ISceneEventMap = ISceneEventMap>
    extends Scene<TE>, IObject3D<TE>, IShaderPropertiesUpdater {
    readonly visible: boolean;
    readonly isScene: true;
    /**
     * Main camera that the user controls
     */
    mainCamera: ICamera;
    /**
     * Camera that in currently being rendered.
     */
    renderCamera: ICamera;
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
     * @deprecated use {@link getObjectByName} instead
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
