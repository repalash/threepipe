import type {Color, Event, IUniform, Material, MaterialParameters, Shader} from 'three'
import type {IDisposable, IJSONSerializable} from 'ts-browser-helpers'
import type {MaterialExtension} from '../materials'
import type {ChangeEvent, IUiConfigContainer} from 'uiconfig.js'
import type {SerializationMetaType} from '../utils'
import type {IObject3D} from './IObject'
import type {ITexture} from './ITexture'
import type {IImportResultUserData} from '../assetmanager'

export type IMaterialParameters = MaterialParameters & {customMaterialExtensions?: MaterialExtension[]}
export type IMaterialEventTypes = 'dispose' | 'materialUpdate' | 'beforeRender' | 'beforeCompile' | 'afterRender' | 'textureUpdate' | 'beforeDeserialize'
export type IMaterialEvent<T extends string = IMaterialEventTypes> = Event & {
    type: T
    bubbleToObject?: boolean
    bubbleToParent?: boolean
    material?: IMaterial

    texture?: ITexture
    oldTexture?: ITexture

    uiChangeEvent?: ChangeEvent
}
export interface IMaterialSetDirtyOptions {
    /**
     * @default true
     */
    bubbleToObject?: boolean,
    /**
     * @default true
     */
    refreshUi?: boolean,
    /**
     * @default true
     */
    needsUpdate?: boolean,
    /**
     * Event from uiconfig.js
     */
    uiChangeEvent?: ChangeEvent,
    [key: string]: any
}
export interface IMaterialUserData extends IImportResultUserData{
    uuid?: string // adding to userdata also, so that its saved in gltf
    /**
     * Automatically dispose material when not used by any object in the scene
     * @default true
     */
    disposeOnIdle?: boolean

    renderToGBuffer?: boolean
    /**
     * Same as {@link renderToGBuffer} for now
     */
    renderToDepth?: boolean

    // only for materials that have envMapIntensity
    separateEnvMapIntensity?: boolean // default: false

    cloneId?: string
    cloneCount?: number

    __envIntensity?: number // temp storage for envMapIntensity while rendering
    __isVariation?: boolean

    inverseAlphaMap?: boolean // only for physical material right now

    [key: string]: any // commented for noe


    // legacy, to be removed
    setDirty?: (options?: IMaterialSetDirtyOptions) => void
}

export interface IMaterial<E extends IMaterialEvent = IMaterialEvent, ET = IMaterialEventTypes> extends Material<E, ET>, IJSONSerializable, IDisposable, IUiConfigContainer {
    constructor: {
        TYPE: string
        TypeSlug: string
        MaterialProperties?: Record<string, any>
        MaterialTemplate?: IMaterialTemplate
    }
    assetType: 'material'
    setDirty(options?: IMaterialSetDirtyOptions): void;

    // clone?: ()=> any;

    needsUpdate: boolean;


    // toJSON same as three.js Material.toJSON
    // toJSON(meta?: any): any;

    // copyProps should be just setValues
    setValues(parameters: Material|(MaterialParameters&{type?:string}), allowInvalidType?: boolean, clearCurrentUserData?: boolean): this;
    toJSON(meta?: SerializationMetaType, _internal?: boolean): any;
    fromJSON(json: any, meta?: SerializationMetaType, _internal?: boolean): this | null;

    extraUniformsToUpload?: Record<string, IUniform>
    materialExtensions?: MaterialExtension[]
    registerMaterialExtensions?: (customMaterialExtensions: MaterialExtension[]) => void;
    unregisterMaterialExtensions?: (customMaterialExtensions: MaterialExtension[]) => void;

    /**
     * Managed internally, do not change manually
     */
    generator?: IMaterialGenerator

    /**
     * Managed internally, do not change manually
     */
    appliedMeshes: Set<IObject3D>
    lastShader?: Shader

    // Note: for userData: add _ in front of for private use, which is preserved while cloning but not serialisation, and __ for private use, which is not preserved while cloning and serialisation
    userData: IMaterialUserData

    /**
     * Disposes the material from the GPU.
     * Set force to false if not sure the material is used by any object in the scene.
     * // todo add check for visible in scene also? or is that overkill
     * @param force - when true, same as three.js dispose. when false, only disposes if disposeOnIdle not false and not used by any object in the scene. default: true
     */
    dispose(force?: boolean): void

    // optional from subclasses, added here for autocomplete
    flatShading?: boolean
    map?: ITexture | null
    alphaMap?: ITexture | null
    envMap?: ITexture | null
    envMapIntensity?: number
    aoMap?: ITexture | null
    lightMap?: ITexture | null
    normalMap?: ITexture | null
    bumpMap?: ITexture | null
    aoMapIntensity?: number
    lightMapIntensity?: number
    roughnessMap?: ITexture | null
    metalnessMap?: ITexture | null
    roughness?: number
    metalness?: number
    transmissionMap?: ITexture | null
    transmission?: number

    color?: Color
    wireframe?: boolean


    isRawShaderMaterial?: boolean
    isPhysicalMaterial?: boolean
    isUnlitMaterial?: boolean

    // [key: string]: any
}


export type IMaterialGenerator<T extends IMaterial = IMaterial> = (params: any)=>T

export interface IMaterialTemplate<T extends IMaterial = IMaterial, TP = any>{
    templateUUID?: string,
    name: string,
    typeSlug?: string,
    alias?: string[], // alternate names
    materialType: string,
    generator?: IMaterialGenerator<T>,

    params?: TP
}
