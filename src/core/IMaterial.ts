import {
    BufferGeometry,
    Camera,
    Color, Event,
    IUniform,
    Material,
    MaterialEventMap,
    MaterialParameters,
    Object3D,
    Scene, Texture,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from 'three'
import type {IDisposable, IJSONSerializable} from 'ts-browser-helpers'
import type {MaterialExtension} from '../materials'
import type {ChangeEvent, IUiConfigContainer} from 'uiconfig.js'
import type {SerializationMetaType} from '../utils'
import type {IObject3D} from './IObject'
import {ISetDirtyCommonOptions} from './IObject'
import type {ITexture} from './ITexture'
import type {IImportResultUserData} from '../assetmanager'
import {AnimateTime} from '../utils'

export type IMaterialParameters = MaterialParameters & {customMaterialExtensions?: MaterialExtension[]}
// export type IMaterialEventTypes = 'dispose' | 'materialUpdate' | 'beforeRender' | 'beforeCompile' | 'afterRender' | 'textureUpdate' | 'beforeDeserialize'
// export type IMaterialEvent<T extends string = IMaterialEventTypes> = Event & {
//     type: T
//     bubbleToObject?: boolean
//     bubbleToParent?: boolean
//     material?: IMaterial
//
//     texture?: ITexture
//     oldTexture?: ITexture
//
//     uiChangeEvent?: ChangeEvent
// }

export interface IMaterialEventMap extends MaterialEventMap{
    beforeCompile: {
        shader: WebGLProgramParametersWithUniforms
        renderer: WebGLRenderer
    }
    beforeRender: {
        renderer: WebGLRenderer
        scene: Scene
        camera: Camera
        geometry: BufferGeometry
        object: Object3D
    }
    afterRender: {
        renderer: WebGLRenderer
        scene: Scene
        camera: Camera
        geometry: BufferGeometry
        object: Object3D
    }
    /**
     * Fires when the material is set/added to a mesh
     * This is applicable of all types of Object3D, like Line etc, not just Mesh
     */
    addToMesh: {
        object: Object3D
    }
    /**
     * Fires when the material is changed/removed to a mesh
     * This is applicable of all types of Object3D, like Line etc, not just Mesh
     */
    removeFromMesh: {
        object: Object3D
    }
    /**
     * For internal use
     */
    beforeDeserialize: {
        data: unknown
        meta?: SerializationMetaType
        bubbleToObject: boolean
        bubbleToParent: boolean
    }
    texturesChanged: {
        textures: Set<ITexture>
        oldTextures: Set<ITexture>
        addedTextures: Set<ITexture>
        removedTextures: Set<ITexture>
        material: IMaterial
        bubbleToObject?: boolean
        bubbleToParent?: boolean
    }
}

declare module 'three'{
    export interface MaterialEventMap{
        materialUpdate: {
            // These are handled in dispatchEvent override in iMaterialCommons
            bubbleToObject?: boolean
            bubbleToParent?: boolean
            uiChangeEvent?: ChangeEvent
        } & IMaterialSetDirtyOptions
        textureUpdate: {
            texture: ITexture
            bubbleToObject?: boolean
            bubbleToParent?: boolean
            uiChangeEvent?: ChangeEvent
        }
        select: { // todo remove?
            ui?: boolean
            // focusCamera?: boolean // todo ?
            bubbleToObject?: boolean
            bubbleToParent?: boolean
            material: IMaterial
            value?: /* IObject3D | */ IMaterial | null // todo is this required?

            source?: string // who is triggering the event. so that recursive events can be prevented
        } /* & IObjectSetDirtyOptions*/
    }
}

export interface IMaterialSetDirtyOptions extends ISetDirtyCommonOptions{
    /**
     * @default true
     */
    bubbleToObject?: boolean,
    /**
     * @default true
     */
    needsUpdate?: boolean,

    /**
     * Change identifier that triggered the `setDirty` call.
     * This is different from `key` in that it is used to identify the property/key that is changed. In many cases these could be same, but they could also be different eg, key might be x, with change being position.
     */
    change?: string | keyof IMaterial

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
     * Same as {@link renderToGBuffer} but for depth only, not normal or flags etc
     */
    renderToDepth?: boolean

    /**
     * Flag to tell the scene to prefer `material.envMapIntensity` over `scene.envMapIntensity`
     * only for materials that have envMapIntensity
     */
    separateEnvMapIntensity?: boolean // default: false
    /**
     * The environment map to use in the `RootScene`. To use this, object with the material must be in the RootScene, and the key should exist in the `RootScene`'s `textureSlots`.
     *
     * only for materials that have envMap
     */
    envMapSlotKey?: string

    /**
     * Automatically register this material in the {@link MaterialManager} when added to the scene.
     * This provides hook to other plugins to extend the material, add uiconfig etc.
     * @default true
     */
    autoRegisterInManager?: boolean

    cloneId?: string
    cloneCount?: number

    __envIntensity?: number // temp storage for envMapIntensity while rendering
    __isVariation?: boolean

    inverseAlphaMap?: boolean // only for physical material right now

    /**
     * See {@link MaterialManager.dispose} as {@link BaseGroundPlugin._refreshMaterial}
     */
    runtimeMaterial?: boolean

    /**
     * See {@link GBufferPlugin}
     */
    gBufferData?: {
        materialId?: number
        /**
         * @default true
         */
        tonemapEnabled?: boolean

        [key: string]: any
    }

    /**
     * Force a depth value in GBuffer.
     * This is useful to force center values like 0 to the depth.
     */
    forcedLinearDepth?: number // todo uiconfig for this in imaterial?

    /**
     * General flag to disable multiple plugins on the material at once, like SSAO, SSR, Bloom etc.
     */
    pluginsDisabled?: boolean // todo uiconfig for this in imaterial?

    // todo: move these to respective plugins

    /**
     * For SSCSPlugin
     */
    sscsDisabled?: boolean
    /**
     * For SSRPlugin
     */
    ssreflDisabled?: boolean
    /**
     * For SSRPlugin
     */
    ssreflNonPhysical?: boolean

    [key: string]: any


    // legacy, to be removed
    /**
     * @deprecated
     */
    setDirty?: (options?: IMaterialSetDirtyOptions) => void
    /**
     * @deprecated Use {@link postTonemap.tonemapEnabled} instead. This is kept because used in old files.
     */
    postTonemap?: boolean
}

export interface AnimateTimeMaterial extends AnimateTime{from?: IMaterial}

export interface IMaterial<TE extends IMaterialEventMap = IMaterialEventMap> extends Material<TE>, IJSONSerializable, IDisposable, IUiConfigContainer {
    constructor: {
        TYPE: string
        TypeSlug: string
        MaterialProperties?: Record<string, any>
        MapProperties?: string[]
        InterpolateProperties?: string[]
        MaterialTemplate?: IMaterialTemplate
    }
    assetType: 'material'
    setDirty(options?: IMaterialSetDirtyOptions): void;

    // clone?: ()=> any;

    needsUpdate: boolean;


    // toJSON same as three.js Material.toJSON
    // toJSON(meta?: any): any;

    // copyProps should be just setValues
    setValues(parameters: Material|(MaterialParameters&{type?:string}), allowInvalidType?: boolean, clearCurrentUserData?: boolean, time?: AnimateTimeMaterial): this;
    toJSON(meta?: SerializationMetaType, _internal?: boolean): any;
    fromJSON(json: any, meta?: SerializationMetaType, _internal?: boolean): this | null;

    extraUniformsToUpload: Record<string, IUniform>
    materialExtensions: MaterialExtension[]
    registerMaterialExtensions: (customMaterialExtensions: MaterialExtension[]) => void;
    unregisterMaterialExtensions: (customMaterialExtensions: MaterialExtension[]) => void;

    /**
     * Managed internally, do not change manually
     */
    generator?: IMaterialGenerator

    /**
     * Objects in the scene that are using this material.
     * This is set in the {@link Object3DManager} when the objects are added/removed from the scene. Do not modify this set directly.
     */
    appliedMeshes: Set<IObject3D>

    lastShader?: WebGLProgramParametersWithUniforms

    // Note: for userData: add _ in front of for private use, which is preserved while cloning but not serialisation, and __ for private use, which is not preserved while cloning and serialisation
    userData: IMaterialUserData

    /**
     * Disposes the material from the GPU.
     * Set force to false if not sure the material is used by any object in the scene.
     * // todo add check for visible in scene also? or is that overkill
     * @param force - when true, same as three.js dispose. when false, only disposes if disposeOnIdle not false and not used by any object in the scene. default: true
     */
    dispose(force?: boolean): void

    /**
     * Clones the Material.
     * This is a shallow clone, so the properties are copied by reference.
     *
     * @param track - if true, the clone id and count will be tracked in the userData and a suffix will be appended to the name. default - false
     */
    clone(track?: boolean): this;

    // optional from subclasses, added here for autocomplete
    color?: Color
    wireframe?: boolean
    flatShading?: boolean
    map?: ITexture | null
    alphaMap?: ITexture | null
    envMap?: ITexture | null
    envMapIntensity?: number
    aoMap?: ITexture | null
    lightMap?: ITexture | null
    normalMap?: ITexture | null
    bumpMap?: ITexture | null
    displacementMap?: ITexture | null
    aoMapIntensity?: number
    lightMapIntensity?: number
    roughnessMap?: ITexture | null
    metalnessMap?: ITexture | null
    roughness?: number
    metalness?: number
    transmissionMap?: ITexture | null
    transmission?: number
    emissiveMap?: ITexture | null
    emissiveIntensity?: number
    emissive?: Color

    linewidth?: number

    isRawShaderMaterial?: boolean
    isPhysicalMaterial?: boolean
    isLineMaterial?: boolean
    isUnlitMaterial?: boolean
    isGBufferMaterial?: boolean
    isLineMaterial2?: boolean
    isUnlitLineMaterial?: boolean

    // [key: string]: any

    // private
    ['__textureUpdate']?: (e: Event<'update', Texture>)=>void
    ['_mapRefs']?: Set<ITexture>

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
