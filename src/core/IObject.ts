import {IMaterial, IMaterialEventMap, IMaterialSetDirtyOptions} from './IMaterial'
import {Box3, EventListener2, Material, Object3D, Object3DEventMap, Sphere, Vector3} from 'three'
import {ChangeEvent, IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {IGeometry, IGeometryEventMap, IGeometrySetDirtyOptions} from './IGeometry'
import {IImportResultUserData} from '../assetmanager'
import {GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {ICamera, type ICameraSetDirtyOptions} from './ICamera'

// export type IObject3DEventTypes = 'dispose' | 'materialUpdate' | 'objectUpdate' | 'textureUpdate' | 'geometryChanged' |
//     'materialChanged' | 'geometryUpdate' | 'added' | 'removed' | 'select' | 'beforeDeserialize' |
//     'setView' | 'activateMain' | 'cameraUpdate' // from camera
// | string
// export interface IObject3DEvent<T extends string = IObject3DEventTypes> extends Event {
//     type: T
//     object?: IObject3D // object that triggered the event, target might be parent in case of bubbleToParent
//     bubbleToParent?: boolean // bubble event to parent root
//     change?: string  // todo - add to new type...
//     material?: IMaterial|undefined|IMaterial[] // from materialUpdate and materialChanged
//     oldMaterial?: IMaterial|undefined|IMaterial[] // from materialChanged
//     geometry?: IGeometry|undefined // from geometryUpdate, geometryChanged
//     oldGeometry?: IGeometry|undefined // from geometryChanged
//     source?: any // todo - add to new type...
// }

declare module 'three'{
    export interface Object3DEventMap{
        select: { // todo remove?
            ui?: boolean
            focusCamera?: boolean
            bubbleToParent?: boolean
            object: IObject3D
            value?: IObject3D|null /* | Material*/ // todo is this required?

            source?: string // who is triggering the event. so that recursive events can be prevented
        } /* & IObjectSetDirtyOptions*/
    }
}
// [key: keyof Object3DEventMap]: Object3DEventMap[key] & {
//     bubbleToParent?: boolean
// }
export interface IObject3DEventMap extends Object3DEventMap{
    dispose: {
        // object: IObject3D
        // todo
        bubbleToParent: false
    }
    materialUpdate: {
        // object: IObject3D
        material: IMaterial|IMaterial[]
    } & IMaterialSetDirtyOptions
    objectUpdate: {
        object: IObject3D
        args?: any[]
        bubbleToParent: boolean
    } & Omit<IObjectSetDirtyOptions, 'bubbleToParent'>
    textureUpdate: {
        // object: IObject3D
        // todo
    }
    geometryChanged: {
        object: IObject3D
        geometry: IGeometry|null
        oldGeometry: IGeometry|null
        bubbleToParent: boolean
    }
    materialChanged: {
        object: IObject3D
        material: IMaterial|IMaterial[]|null
        oldMaterial: IMaterial|IMaterial[]|null
        bubbleToParent: boolean
    }
    texturesChanged: IMaterialEventMap['texturesChanged']
    geometryUpdate: {
        object: IObject3D
        geometry: IGeometry
        // oldGeometry: IGeometry
        bubbleToParent: boolean
    } & IGeometrySetDirtyOptions
    added: {
        // object: IObject3D
        // todo
    }
    removed: {
        // object: IObject3D
        // todo
    }
    beforeDeserialize: { // from material
        material: IMaterial
        // todo
    } & IMaterialEventMap['beforeDeserialize']
    setView: {
        ui?: boolean
        camera: ICamera
        bubbleToParent: boolean
        // object: IObject3D
        // todo
    }
    activateMain: {
        ui?: boolean
        camera?: ICamera | null
        bubbleToParent: boolean
        // object: IObject3D
    }
    cameraUpdate: {
        ui?: boolean
        camera?: ICamera
        // object: IObject3D
        bubbleToParent: boolean
        // todo
    } & Omit<ICameraSetDirtyOptions, 'bubbleToParent'>
    parentRootChanged: {
        object: IObject3D
        oldParentRoot: IObject3D|undefined
        bubbleToParent: boolean
    }
}
// Record<keyof IObject3DEventMap0, IObject3DEventMap0[keyof IObject3DEventMap0] & {
//     // bubbleToParent?: boolean
// }>

export interface ISetDirtyCommonOptions {
    /**
     * Trigger UI Config Refresh along with setDirty.
     * Default `true`. Set to `false` to prevent UI Config refresh.
     */
    refreshUi?: boolean

    /**
     * Enable/disable frame fade using {@link FrameFadePlugin}
     * Default `true`. when the plugin is enabled and has corresponding flags enabled
     */
    frameFade?: boolean // for plugins
    /**
     * Duration for `frameFade` in ms. Check {@link FrameFadePlugin} for more details.
     */
    fadeDuration?: number // for plugins

    /**
     * Event from uiconfig.js when some value changes from the UI.
     */
    uiChangeEvent?: ChangeEvent,

    /**
     * Source identifier of who is triggering the event. so that recursive events can be prevented
     */
    source?: string

    /**
     * Key to identify the change. This is used to identify the change in the event. Can be used interchangeably with {@link change}.
     * Set from `onChange3` etc.
     */
    key?: string

    /**
     * Set to true if this is the last value in a user input chain. (like when mouse up on slider)
     */
    last?: boolean
    /**
     * Indicates that this change in from an `undo` operation.
     */
    undo?: boolean

    // value: any;
    // oldValue: any;
}

export interface IObjectSetDirtyOptions extends ISetDirtyCommonOptions{
    /**
     * Bubble event to parent root(scene).
     */
    bubbleToParent?: boolean

    /**
     * Change identifier that triggered the `setDirty` call.
     * This is different from `key` in that it is used to identify the property/key that is changed. In many cases these could be same, but they could also be different eg, key might be x, with change being position.
     */
    change?: string | keyof IObject3D

    /**
     * Update scene(bounds, shadows, plugins, etc) after setting dirty.
     */
    refreshScene?: boolean

    /**
     * Indicate whether the geometry has been changed to properly refresh plugins like ground, shadows.
     */
    geometryChanged?: boolean

    /**
     * update scene after setting dirty
     *
     * @deprecated use {@link refreshScene} instead
     */
    sceneUpdate?: boolean

    // [key: string]: any
}

export interface IObjectProcessor { // todo, should be viewer
    processObject: (object: IObject3D) => void
}

export interface IObject3DUserData extends IImportResultUserData {
    uuid?: string

    /**
     * When true, this object will not be exported when exporting the scene with {@link AssetExporter.exportObject}
     */
    excludeFromExport?: boolean

    autoCentered?: boolean
    isCentered?: boolean

    autoScaleRadius?: number
    autoScaled?: boolean

    geometriesCentered?: boolean

    /**
     * should this object be taken into account when calculating bounding box, default true
     */
    bboxVisible?: boolean

    /**
     * Is centered in a parent object.
     */
    pseudoCentered?: boolean

    license?: string

    /**
     * When false, this object will not be selectable when clicking on it.
     */
    userSelectable?: boolean

    /**
     * Disables `bubbleToParent` in setDirty calls on the object. As an effect scene, viewer are not updated on property change. See progressive-hdr-shadows-exp or any baker.
     */
    autoUpdateParent?: boolean

    /**
     * For Physics plugins
     */
    physicsMass?: number

    /**
     * see {@link GLTFAnimationPlugin}
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    gltfAnim_SyncMaxDuration?: boolean

    /**
     * Automatically register this object in the {@link AssetManager} when added to the scene.
     * This provides hook to other plugins to extend the object, add uiconfig, etc.
     * @default true
     */
    autoRegisterInManager?: boolean

    /**
     * Settings for TransformControls2 when this object is selected. See {@link TransformControlsPlugin}
     */
    transformControls?: {
        showX?: boolean
        showY?: boolean
        showZ?: boolean
        translationSnap?: number
        rotationSnap?: number
        scaleSnap?: number
        space?: 'local' | 'world'
        mode?: 'translate' | 'rotate' | 'scale'
        lockProps?: string[]
    }

    // region root scene model root

    /**
     * is it modelRoot in RootScene, used during serialization nad traversing ancestors
     */
    rootSceneModelRoot?: boolean
    __gltfAsset?: GLTF['asset']
    __gltfExtras?: GLTF['userData']

    // endregion

    /**
     * Auto dispose when removed from the scene.
     * Note - this is only used when {@link Object3DManager.autoDisposeObjects} is `true`
     * @default true
     */
    disposeOnIdle?: boolean

    __objectSetup?: boolean
    __meshSetup?: boolean
    // [key: string]: any // commented for noe

    // legacy
    /**
     * @deprecated
     */
    dispose?: any
    /**
     * @deprecated
     */
    setMaterial?: any
    /**
     * @deprecated
     */
    setGeometry?: any
    /**
     * @deprecated
     */
    setDirty?: any

    /**
     * Used in {@link GLTFObject3DExtrasExtension} and {@link iObjectCommons.upgradeObject3D}
     */
    __keepShadowDef?: boolean
    /**
     * Events that should be bubbled to parent root without the need to set bubbleToParent in the event.
     * todo: remove support for this
     */
    __autoBubbleToParentEvents?: string[]

    [key: string]: any
}


export interface IObjectExtension {
    uuid: string
    /**
     * Function to check if this object extension is compatible with the given object.
     * If not compatible, the object extension will not be added to the object.
     * This is only checked when the extension is registered.
     *
     * The extension is assumed to be compatible if this function is not defined
     * @param object
     */
    isCompatible?: (object: IObject3D) => boolean|undefined

    /**
     * Function to return the UI config for this material extension.
     * This is called once when the material extension is registered.
     * @param material
     */
    getUiConfig?: (material: IObject3D, refreshUi?: UiObjectConfig['uiRefresh']) => (UiObjectConfig['children'] | undefined)

    /**
     * Function to be called when the object the extension is added on the object. This generally happens when either the object is registered or extnsion is added
     * @param object
     */
    onRegister?: (object: IObject3D) => void
}

export interface IObject3D<TE extends IObject3DEventMap = IObject3DEventMap, TG extends IGeometry | undefined= IGeometry | undefined, TM extends IMaterial | IMaterial[] | undefined = IMaterial | IMaterial[] | undefined> extends Object3D<TE>, IUiConfigContainer {
    assetType: 'model' | 'light' | 'camera' | 'widget'
    isLight?: boolean
    isCamera?: boolean
    isMesh?: boolean
    isMeshLine?: boolean
    isLine?: boolean
    isLine2?: boolean
    isLineSegments?: boolean
    isLineSegments2?: boolean
    // isGroup?: boolean
    isScene?: boolean
    // isHelper?: boolean
    isWidget?: boolean
    isPoints?: boolean
    readonly isObject3D: true

    geometry?: TG
    material?: TM
    /**
     * Same as material but always returns an array.
     * To set, just set `material` property
     */
    readonly materials?: IMaterial[]
    currentMaterial?: IMaterial | IMaterial[] | null
    morphTargetDictionary?: Record<string, number>
    morphTargetInfluences?: number[]
    updateMorphTargets?(): void

    // eslint-disable-next-line @typescript-eslint/naming-convention
    _currentGeometry?: IGeometry | null

    /**
     * Dispatches 'objectUpdate' event on object.
     * @param e
     */
    setDirty(e?: IObjectSetDirtyOptions): void

    /**
     * Parent/Ancestor of this object to bubble events to. This is set internally by setupObject3D.
     */
    parentRoot?: IObject3D | null

    uiConfig?: UiObjectConfig
    refreshUi(): void

    // Note: for userData: add _ in front of for private use, which is preserved while cloning but not serialisation, and __ for private use, which is not preserved while cloning and serialisation
    userData: IObject3DUserData

    /**
     * Scales the object to fit the given radius.
     *
     * @param autoScaleRadius - optional (taken from userData.autoScaleRadius by default)
     * @param isCentered - optional (taken from userData.isCentered by default)
     * @param setDirty - true by default
     * @param undo - undo any previous autoScale operation
     */
    autoScale?(autoScaleRadius?: number, isCentered?: boolean, setDirty?: boolean, undo?: boolean): this

    /**
     * Moves the bounding box center of the object to the center of the world
     *
     * @param setDirty - calls {@link setDirty} @default true
     * @param undo - undo any previous autoCenter operation
     */
    autoCenter?(setDirty?: boolean, undo?: boolean): this

    /**
     * Moves the object pivot to the center of the bounding box.
     *
     * The object will rotate around the new pivot.
     *
     * @param setDirty - calls {@link setDirty} @default true
     * @returns undo function
     */
    pivotToBoundsCenter?(setDirty?: boolean): () => void

    /**
     * Moves the object pivot to the given point
     *
     * The object will rotate around the new pivot.
     *
     * @param point - point to move the pivot to
     * @param setDirty - calls {@link setDirty} @default true
     * @returns undo function
     */
    pivotToPoint?(point: Vector3, setDirty?: boolean): this

    /**
     * @deprecated use object directly
     */
    modelObject: this

    objectProcessor?: IObjectProcessor
    objectExtensions?: IObjectExtension[]

    // __disposed?: boolean
    /**
     * @param removeFromParent - remove from parent. Default true
     */
    dispose(removeFromParent?: boolean): void;

    /**
     * A promise can be set by the object to indicate that the object is loading.
     * This can be used by the scene, viewer, plugins to defer actions until the object is loaded.
     */
    _loadingPromise?: Promise<void>

    /**
     * For InstancedMesh, SkinnedMesh etc
     */
    boundingBox?: Box3 | null
    /**
     * For InstancedMesh, SkinnedMesh etc
     */
    boundingSphere?: Sphere | null
    /**
     * For InstancedMesh, SkinnedMesh etc
     * Computes bounding box, updating {@link boundingBox | .boundingBox} attribute.
     * @remarks Bounding boxes aren't computed by default. They need to be explicitly computed, otherwise they are `null`.
     */
    computeBoundingBox?(): void;

    /**
     * For InstancedMesh, SkinnedMesh etc
     * Computes bounding sphere, updating {@link boundingSphere | .boundingSphere} attribute.
     * @remarks bounding spheres aren't computed by default. They need to be explicitly computed, otherwise they are `null`.
     */
    computeBoundingSphere?(): void;

    /**
     * For LineSegments, Line2 etc
     */
    computeLineDistances?(): void

    /**
     * Set to `false` to disable propagation of any events from its children.
     */
    acceptChildEvents?: boolean
    /**
     * Set to `false` to disable automatic call of `upgradeObject3D` when a child is added.
     */
    autoUpgradeChildren?: boolean

    /**
     * Required for Light shadows and plugins like DepthBufferPlugin
     */
    customDepthMaterial?: Material
    /**
     * Required for PointLight shadows
     */
    customDistanceMaterial?: Material
    /**
     * Required for plugins like GBufferPlugin
     */
    customGBufferMaterial?: Material
    /**
     * Required for plugins like NormalBufferPlugin
     */
    customNormalMaterial?: Material

    /**
     * If this is set, it will be returned when accessing `material` property.
     * see {@link GBufferRenderPass} for sample usage
     */
    forcedOverrideMaterial?: Material

    /**
     * Traverse only upgraded objects with extra options
     * @param callback
     * @param options
     */
    traverseModels?(callback: (object: IObject3D) => boolean | void, options: {
        visible: boolean,
        widgets: boolean,
        [key: string]: any
    }): void

    /**
     * @internal - store for the actual material. see also {@link currentMaterial}
     */
    ['_currentMaterial']?: IMaterial | IMaterial[] | null
    /**
     * @internal - store for the actual customDepthMaterial
     */
    ['_customDepthMaterial']?: Material
    /**
     * @internal - store for the actual customNormalMaterial
     */
    ['_customNormalMaterial']?: Material
    /**
     * @internal - store for the actual customGBufferMaterial
     */
    ['_customGBufferMaterial']?: Material
    /**
     * @internal - for embedded objects
     */
    ['_onGeometryUpdate']?: EventListener2<'geometryUpdate', IGeometryEventMap, IGeometry>

    /**
     * @internal - for embedded objects
     */
    ['_rootPathRefreshed']?: boolean
    /**
     * @internal - when embedded objects are loading
     */
    ['_rootPathRefreshing']?: boolean
    /**
     * @internal - for embedded objects
     */
    ['_sChildren']?: Object3D[]

    // constructor: {
    //     // TYPE: string
    //     // TypeSlug: string
    //     ObjectProperties?: Record<string, any>
    //     MapProperties?: string[]
    //     InterpolateProperties?: string[]
    // }

    // region inherited type fixes

    traverse(callback: (object: IObject3D) => void): void
    traverseVisible(callback: (object: IObject3D) => void): void
    traverseAncestors(callback: (object: IObject3D) => void): void
    getObjectById<T extends IObject3D = IObject3D>(id: number): T | undefined
    getObjectByName<T extends IObject3D = IObject3D>(name: string): T | undefined
    getObjectByProperty<T extends IObject3D = IObject3D>(name: string, value: string): T | undefined
    copy(source: this, recursive?: boolean, ...args: any[]): this
    clone(recursive?: boolean): this
    add(...object: Object3D[]): this
    remove(...object: IObject3D[]): this
    parent: IObject3D | null
    children: IObject3D[]

    // end region

}

export interface IMesh<TE extends IObject3DEventMap = IObject3DEventMap, TG extends IGeometry= IGeometry, TM extends IMaterial | IMaterial[] = IMaterial | IMaterial[]> extends IObject3D<TE, TG, TM>, IUiConfigContainer {
    geometry: TG
    material: TM
}

