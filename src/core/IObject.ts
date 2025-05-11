import {IMaterial, IMaterialEventMap} from './IMaterial'
import {Box3, EventListener2, Object3D, Object3DEventMap, Sphere, Vector3} from 'three'
import {ChangeEvent, IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {IGeometry, IGeometryEventMap} from './IGeometry'
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
        select: { // todo
            ui?: boolean
            focusCamera?: boolean
            bubbleToParent?: boolean
            object: IObject3D
            value?: IObject3D /* | Material*/ // todo is this required?

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
    }
    objectUpdate: {
        object: IObject3D
        change?: string
        args?: any[]
        bubbleToParent: boolean
    }
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
    geometryUpdate: {
        object: IObject3D
        geometry: IGeometry
        // oldGeometry: IGeometry
        bubbleToParent: boolean
    }
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
    } & ICameraSetDirtyOptions
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

}

export interface IObjectSetDirtyOptions extends ISetDirtyCommonOptions{
    /**
     * Bubble event to parent root(scene).
     */
    bubbleToParent?: boolean
    /**
     * Change identifier that triggered the setDirty call.
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

    // region root scene model root

    /**
     * is it modelRoot in RootScene, used during serialization nad traversing ancestors
     */
    rootSceneModelRoot?: boolean
    __gltfAsset?: GLTF['asset']
    __gltfExtras?: GLTF['userData']
    // endregion



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

export interface IObject3D<TE extends IObject3DEventMap = IObject3DEventMap> extends Object3D<TE>, IUiConfigContainer {
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
    readonly isObject3D: true

    material?: IMaterial | IMaterial[]
    /**
     * Same as material but always returns an array.
     * To set, just set `material` property
     */
    readonly materials?: IMaterial[]
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _currentMaterial?: IMaterial | IMaterial[] | null
    geometry?: IGeometry
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


    // eslint-disable-next-line @typescript-eslint/naming-convention
    _onGeometryUpdate?: EventListener2<'geometryUpdate', IGeometryEventMap, IGeometry>


    objectProcessor?: IObjectProcessor

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

    // endregion

}

