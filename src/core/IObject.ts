import {IDisposable} from 'ts-browser-helpers'
import {IMaterial} from './IMaterial'
import {Event, Object3D} from 'three'
import {ChangeEvent, IUiConfigContainer, UiObjectConfig} from 'uiconfig.js'
import {IGeometry, IGeometryEvent} from './IGeometry'
import {IImportResultUserData} from '../assetmanager'
import {GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js'

export type IObject3DEventTypes = 'dispose' | 'materialUpdate' | 'objectUpdate' | 'textureUpdate' | 'geometryChanged' |
    'materialChanged' | 'geometryUpdate' | 'added' | 'removed' | 'select' | 'beforeDeserialize' |
    'setView' | 'activateMain' | 'cameraUpdate' // from camera
    // | string
export interface IObject3DEvent<T extends string = IObject3DEventTypes> extends Event {
    type: T
    object?: IObject3D // object that triggered the event, target might be parent in case of bubbleToParent
    bubbleToParent?: boolean // bubble event to parent root
    change?: string
    material?: IMaterial|undefined|IMaterial[] // from materialUpdate and materialChanged
    oldMaterial?: IMaterial|undefined|IMaterial[] // from materialChanged
    geometry?: IGeometry|undefined // from geometryUpdate, geometryChanged
    oldGeometry?: IGeometry|undefined // from geometryChanged
    source?: any
}

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
    bubbleToParent?: boolean // bubble event to parent root
    change?: string
    refreshScene?: boolean // update scene after setting dirty

    geometryChanged?: boolean // whether to refresh stuff like ground.

    /**
     * @deprecated use {@link refreshScene} instead
     */
    sceneUpdate?: boolean // update scene after setting dirty

    [key: string]: any
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
}

export interface IObject3D<E extends Event = IObject3DEvent, ET = IObject3DEventTypes> extends Object3D<E, ET>, IUiConfigContainer, IDisposable {
    assetType: 'model' | 'light' | 'camera' | 'widget'
    isLight?: boolean
    isCamera?: boolean
    isMesh?: boolean
    isLine?: boolean
    // isGroup?: boolean
    isScene?: boolean
    // isHelper?: boolean
    isWidget?: boolean
    readonly isObject3D: true

    material?: IMaterial | IMaterial[]
    /**
     * Same as material but always returns an array.
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
     *
     * @param autoScaleRadius - optional (taken from userData.autoScaleRadius by default)
     * @param isCentered - optional (taken from userData.isCentered by default)
     * @param setDirty - true by default
     */
    autoScale?<T extends IObject3D>(autoScaleRadius?: number, isCentered?: boolean, setDirty?: boolean): T

    /**
     *
     * @param setDirty - calls {@link setDirty} @default true
     */
    autoCenter?<T extends IObject3D>(setDirty?: boolean): T

    /**
     * @deprecated use object directly
     */
    modelObject: this


    // eslint-disable-next-line @typescript-eslint/naming-convention
    _onGeometryUpdate?: (e: IGeometryEvent<'geometryUpdate'>) => void

    objectProcessor?: IObjectProcessor

    // __disposed?: boolean
    /**
     *
     * @param removeFromParent - remove from parent. Default true
     */
    dispose(removeFromParent?: boolean): void;

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
