import {
    BaseEvent,
    Color,
    IUniform,
    Material,
    MeshBasicMaterial,
    MeshBasicMaterialParameters,
    MultiplyOperation,
    Shader,
    WebGLRenderer,
} from 'three'
import {generateUiConfig, UiObjectConfig} from 'uiconfig.js'
import {
    IMaterial,
    IMaterialEventMap,
    IMaterialGenerator,
    IMaterialParameters,
    IMaterialTemplate,
    IMaterialUserData,
} from '../IMaterial'
import {MaterialExtension} from '../../materials'
import {SerializationMetaType, shaderReplaceString, ThreeSerialization} from '../../utils'
import {ITexture} from '../ITexture'
import {iMaterialCommons, threeMaterialPropList} from './iMaterialCommons'
import {IObject3D} from '../IObject'
import {iMaterialUI} from './IMaterialUi'

/**
 * And extension of three.js MeshBasicMaterial that can be assigned to objects, and support threepipe features, uiconfig, and serialization.
 *
 * @category Materials
 */
export class UnlitMaterial<TE extends IMaterialEventMap = IMaterialEventMap> extends MeshBasicMaterial<TE> implements IMaterial<TE> {
    declare ['constructor']: typeof UnlitMaterial

    public static readonly TypeSlug = 'bmat'
    public static readonly TYPE = 'UnlitMaterial' // not using .type because it is used by three.js
    assetType = 'material' as const

    declare userData: IMaterialUserData

    public readonly isUnlitMaterial = true

    readonly appliedMeshes: Set<IObject3D> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {return iMaterialCommons.dispose(super.dispose).call(this)}
    clone(track = false): this {return iMaterialCommons.clone(super.clone).call(this, track)}
    dispatchEvent<T extends Extract<keyof (TE&IMaterialEventMap), string>>(event: BaseEvent<T> & (TE&IMaterialEventMap)[T]): void {iMaterialCommons.dispatchEvent(super.dispatchEvent).call(this, event)}

    generator?: IMaterialGenerator

    envMap: ITexture | null = null

    constructor({customMaterialExtensions, ...parameters}: MeshBasicMaterialParameters & IMaterialParameters = {}) {
        super()
        !this.defines && (this.defines = {})
        this.fog = false
        this.setDirty = this.setDirty.bind(this)
        if (customMaterialExtensions) this.registerMaterialExtensions(customMaterialExtensions)
        iMaterialCommons.upgradeMaterial.call(this)
        this.setValues(parameters)
    }

    // region Material Extension

    materialExtensions: MaterialExtension[] = []
    extraUniformsToUpload: Record<string, IUniform> = {}
    registerMaterialExtensions = iMaterialCommons.registerMaterialExtensions
    unregisterMaterialExtensions = iMaterialCommons.unregisterMaterialExtensions

    customProgramCacheKey(): string {
        return super.customProgramCacheKey() + iMaterialCommons.customProgramCacheKey.call(this)
    }

    onBeforeCompile(shader: Shader, renderer: WebGLRenderer): void { // shader is not Shader but WebglUniforms.getParameters return value type so includes defines
        const f = [
            ['vec3 outgoingLight = ', 'afterModulation'], // added markers before found substring
            ['#include <aomap_fragment>', 'beforeModulation'],
            ['ReflectedLight reflectedLight = ', 'beforeAccumulation'],
            ['#include <clipping_planes_fragment>', 'mainStart'],
        ]
        const v = [
            ['#include <uv_vertex>', 'mainStart'],
        ]

        for (const vElement of v) shader.vertexShader = shaderReplaceString(shader.vertexShader, vElement[0], '#glMarker ' + vElement[1] + '\n' + vElement[0])
        for (const vElement of f) shader.fragmentShader = shaderReplaceString(shader.fragmentShader, vElement[0], '#glMarker ' + vElement[1] + '\n' + vElement[0])

        iMaterialCommons.onBeforeCompile.call(this, shader, renderer)
        // shader.defines.INVERSE_ALPHAMAP = this.userData.inverseAlphaMap ? 1 : 0 // todo

        super.onBeforeCompile(shader, renderer)
    }

    // onBeforeRender(...args: Parameters<IMaterial['onBeforeRender']>): void {
    //     super.onBeforeRender(...args)
    //     iMaterialCommons.onBeforeRender.call(this, ...args)
    //
    //     // const t = this.userData.inverseAlphaMap ? 1 : 0 // todo
    //     // if (t !== this.defines.INVERSE_ALPHAMAP) {
    //     //     this.defines.INVERSE_ALPHAMAP = t
    //     //     this.needsUpdate = true
    //     // }
    // }
    onBeforeRender = iMaterialCommons.onBeforeRenderOverride(super.onBeforeRender)
    onAfterRender = iMaterialCommons.onAfterRenderOverride(super.onAfterRender)

    // endregion

    // region Serialization

    /**
     * Sets the values of this material based on the values of the passed material or an object with material properties
     * The input is expected to be a valid material or a deserialized material parameters object(including the deserialized userdata)
     * @param parameters - material or material parameters object
     * @param allowInvalidType - if true, the type of the oldMaterial is not checked. Objects without type are always allowed.
     * @param clearCurrentUserData - if undefined, then depends on material.isMaterial. if true, the current userdata is cleared before setting the new values, because it can have data which wont be overwritten if not present in the new material.
     */
    setValues(parameters: Material|(MeshBasicMaterialParameters&{type?:string}), allowInvalidType = true, clearCurrentUserData: boolean|undefined = undefined): this {
        if (!parameters) return this
        if (parameters.type && !allowInvalidType && !['MeshBasicMaterial', 'MeshBasicMaterial2', this.constructor.TYPE].includes(parameters.type)) {
            console.error('Material type is not supported:', parameters.type)
            return this
        }
        if (clearCurrentUserData === undefined) clearCurrentUserData = (<Material>parameters).isMaterial
        if (clearCurrentUserData) this.userData = {}
        iMaterialCommons.setValues(super.setValues).call(this, parameters)

        this.userData.uuid = this.uuid
        return this
    }
    copy(source: Material|any): this {
        return this.setValues(source, false)
    }

    /**
     * Serializes this material to JSON.
     * @param meta - metadata for serialization
     * @param _internal - Calls only super.toJSON, does internal three.js serialization and `@serialize` tags. Set it to true only if you know what you are doing. This is used in Serialization->serializer->material
     */
    toJSON(meta?: SerializationMetaType, _internal = false): any {
        if (_internal) return {
            ...super.toJSON(meta),
            ...ThreeSerialization.Serialize(this, meta, true), // this will serialize the properties of this class(like defined with @serialize and @serialize attribute)
        }
        return ThreeSerialization.Serialize(this, meta, false) // this will call toJSON again, but with baseOnly=true, that's why we set isThis to false.
    }

    /**
     * Deserializes the material from JSON.
     * Textures should be loaded and in meta.textures before calling this method.
     * @param data
     * @param meta
     * @param _internal
     */
    fromJSON(data: any, meta?: SerializationMetaType, _internal = false): this | null {
        if (_internal) {
            ThreeSerialization.Deserialize(data, this, meta, true)
            return this.setValues(data)
        }
        // this will deserialize the material from the outside because we need access to the viewer to load textures
        // todo check if the material is in scene? if not, show an error/warning?
        this.dispatchEvent({type: 'beforeDeserialize', data, meta, bubbleToObject: true, bubbleToParent: true})
        return this
    }

    // endregion

    // region UI Config

    // todo dispose ui config
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Unlit Material',
        uuid: 'MBM2_' + this.uuid,
        expanded: true,
        onChange: (ev)=>{
            if (!ev.config || ev.config.onChange) return
            // todo set needsUpdate true only for properties that require it like maps.
            this.setDirty({uiChangeEvent: ev, needsUpdate: !!ev.last, refreshUi: !!ev.last})
        },
        children: [
            ...iMaterialUI.base(this),
            ...generateUiConfig(this),
            iMaterialUI.blending(this),
            iMaterialUI.aoLightMap(this),
            iMaterialUI.polygonOffset(this),
            // iMaterialUI.environment(this),
            ...iMaterialUI.misc(this),
        ],
    }

    // endregion UI Config


    // Class properties can also be listed with annotations like @serialize or @property
    // used for serialization
    static readonly MaterialProperties = {
        ...threeMaterialPropList,

        color: new Color(0xffffff),
        map: null,
        lightMap: null,
        lightMapIntensity: 1,
        aoMap: null,
        aoMapIntensity: 1,
        specularMap: null,
        alphaMap: null,
        envMap: null,
        combine: MultiplyOperation,
        envMapIntensity: 1,
        reflectivity: 1,
        refractionRatio: 0.98,
        wireframe: false,
        wireframeLinewidth: 1,
        wireframeLinecap: 'round',
        wireframeLinejoin: 'round',
        skinning: false,
        fog: true,
        flatShading: false,
    }

    static MaterialTemplate: IMaterialTemplate<UnlitMaterial, Partial<typeof UnlitMaterial.MaterialProperties>> = {
        materialType: UnlitMaterial.TYPE,
        name: 'unlit',
        typeSlug: UnlitMaterial.TypeSlug,
        alias: ['basic', 'unlit', UnlitMaterial.TYPE, UnlitMaterial.TypeSlug, 'MeshBasicMaterial', 'MeshBasicMaterial2'],
        params: {
            color: new Color(1, 1, 1),
        },
        generator: (params) => {
            return new UnlitMaterial(params)
        },
    }
}

export class MeshBasicMaterial2 extends UnlitMaterial {
    constructor(parameters?: MeshBasicMaterialParameters) {
        super(parameters)
        console.error('MeshBasicMaterial2 is deprecated, use UnlitMaterial instead')
    }
}
