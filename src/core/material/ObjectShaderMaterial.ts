import {
    IUniform,
    Material,
    ShaderMaterial,
    ShaderMaterialParameters,
    WebGLProgramParametersWithUniforms,
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
import {AnimateTime, SerializationMetaType, shaderUtils, ThreeSerialization} from '../../utils'
import {iMaterialCommons} from './iMaterialCommons'
import {IObject3D} from '../IObject'
import {iMaterialUI} from './IMaterialUi'
import {threeMaterialInterpolateProps, threeMaterialPropList} from './threeMaterialPropList'

/**
 * And extension of three.js ShaderMaterial that can be assigned to objects, and support threepipe features, uiconfig, and serialization.
 *
 * @category Materials
 */
export class ObjectShaderMaterial<TE extends IMaterialEventMap = IMaterialEventMap> extends ShaderMaterial<TE & IMaterialEventMap> implements IMaterial<TE> {
    declare ['constructor']: typeof ObjectShaderMaterial

    public static readonly TypeSlug = 'shmat'
    public static readonly TYPE = 'ObjectShaderMaterial' // not using .type because it is used by three.js
    assetType = 'material' as const

    declare userData: IMaterialUserData

    public readonly isObjectShaderMaterial = true

    readonly appliedMeshes: Set<IObject3D> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {return iMaterialCommons.dispose(super.dispose).call(this)}
    clone(track = false): this {return iMaterialCommons.clone(super.clone).call(this, track)}

    generator?: IMaterialGenerator

    // envMap: ITexture | null = null

    constructor({customMaterialExtensions, ...parameters}: ShaderMaterialParameters & IMaterialParameters = {}) {
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

    onBeforeCompile(shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void { // shader is not Shader but WebglUniforms.getParameters return value type so includes defines
        // const f = [
        //     ['vec3 outgoingLight = ', 'afterModulation'], // added markers before found substring
        //     ['#include <aomap_fragment>', 'beforeModulation'],
        //     ['ReflectedLight reflectedLight = ', 'beforeAccumulation'],
        //     ['#include <clipping_planes_fragment>', 'mainStart'],
        // ]
        // const v = [
        //     ['#include <uv_vertex>', 'mainStart'],
        // ]
        //
        // for (const vElement of v) shader.vertexShader = shaderReplaceString(shader.vertexShader, vElement[0], '#glMarker ' + vElement[1] + '\n' + vElement[0])
        // for (const vElement of f) shader.fragmentShader = shaderReplaceString(shader.fragmentShader, vElement[0], '#glMarker ' + vElement[1] + '\n' + vElement[0])

        iMaterialCommons.onBeforeCompile.call(this, shader, renderer)
        // shader.defines.INVERSE_ALPHAMAP = this.userData.inverseAlphaMap ? 1 : 0

        super.onBeforeCompile(shader, renderer)
    }

    // onBeforeRender(...args: Parameters<IMaterial['onBeforeRender']>): void {
    //     super.onBeforeRender(...args)
    //     iMaterialCommons.onBeforeRender.call(this, ...args)
    // }

    /** @ignore */
    onBeforeRender = iMaterialCommons.onBeforeRenderOverride(super.onBeforeRender)
    /** @ignore */
    onAfterRender = iMaterialCommons.onAfterRenderOverride(super.onAfterRender)

    // endregion

    // region Serialization

    /**
     * Sets the values of this material based on the values of the passed material or an object with material properties
     * The input is expected to be a valid material or a deserialized material parameters object(including the deserialized userdata)
     * @param parameters - material or material parameters object
     * @param allowInvalidType - if true, the type of the oldMaterial is not checked. Objects without type are always allowed.
     * @param clearCurrentUserData - if undefined, then depends on material.isMaterial. if true, the current userdata is cleared before setting the new values, because it can have data which wont be overwritten if not present in the new material.
     * @param time - optional data to animate(lerp) from current value to the target value.
     */
    setValues(parameters: Material|(ShaderMaterialParameters&{type?:string}), allowInvalidType = true, clearCurrentUserData: boolean|undefined = undefined, time?: AnimateTime): this {
        if (!parameters) return this
        if (parameters.type && !allowInvalidType && !['ShaderMaterial', 'ShaderMaterial2', 'ExtendedShaderMaterial', this.constructor.TYPE].includes(parameters.type)) {
            console.error('Material type is not supported:', parameters.type)
            return this
        }
        iMaterialCommons.setValues(super.setValues).call(this, parameters, allowInvalidType, clearCurrentUserData, time)

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
        return ThreeSerialization.Serialize(this, meta, false) // this will call toJSON again, but with _internal=true, that's why we set isThis to false.
    }

    /**
     * Deserializes the material from JSON.
     * Textures should be loaded and in meta.textures before calling this method.
     * todo - needs to be tested
     * @param data
     * @param meta
     * @param _internal
     */
    fromJSON(data: any, meta?: SerializationMetaType, _internal = false): this | null {
        if (_internal) {
            ThreeSerialization.Deserialize(data, this, meta, true)
            return this.setValues(data)
        }
        this.dispatchEvent({type: 'beforeDeserialize', data, meta, bubbleToObject: true, bubbleToParent: true})
        return this
    }

    // endregion

    // region UI Config

    // todo dispose ui config
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Shader Material',
        uuid: 'OSM2_' + this.uuid,
        expanded: true,
        onChange: (ev)=>{
            if (!ev.config || ev.config.onChange) return
            let key = Array.isArray(ev.config.property) ? ev.config.property[1] : ev.config.property
            key = typeof key === 'string' ? key : undefined
            // todo set needsUpdate true only for properties that require it like maps.
            this.setDirty({uiChangeEvent: ev, needsUpdate: !!ev.last, refreshUi: !!ev.last, change: key})
        },
        children: [
            ...generateUiConfig(this),
            ...iMaterialUI.base(this),
            iMaterialUI.blending(this),
            iMaterialUI.polygonOffset(this),
            ...iMaterialUI.misc(this),
        ],
    }

    // endregion UI Config


    // Class properties can also be listed with annotations like @serialize or @property
    // used for serialization // todo change for shadermaterial
    static readonly MaterialProperties = {
        ...threeMaterialPropList,

        defines: {},
        uniforms: {},
        uniformsGroups: [],

        vertexShader: '',
        fragmentShader: '',

        linewidth: 1,

        wireframe: false,
        wireframeLinewidth: 1,

        fog: false, // set to use scene fog
        lights: false, // set to use scene lights
        clipping: false, // set to use user-defined clipping planes

        forceSinglePass: true,

        extensions: {
            derivatives: false, // set to use derivatives
            fragDepth: false, // set to use fragment depth values
            drawBuffers: false, // set to use draw buffers
            shaderTextureLOD: false, // set to use shader texture LOD
        },

        // When rendered geometry doesn't include these attributes but the material does,
        // use these default values in WebGL. This avoids errors when buffer data is missing.
        defaultAttributeValues: {
            'color': [1, 1, 1],
            'uv': [0, 0],
            'uv1': [0, 0],
        },

        index0AttributeName: undefined,
        uniformsNeedUpdate: false,

        glslVersion: null,
        flatShading: false,
    }

    static readonly InterpolateProperties = [
        ...threeMaterialInterpolateProps,
        'linewidth',
        'wireframeLinewidth',
    ]

    static MaterialTemplate: IMaterialTemplate<ObjectShaderMaterial, Partial<typeof ObjectShaderMaterial.MaterialProperties>> = {
        materialType: ObjectShaderMaterial.TYPE,
        name: 'shader',
        typeSlug: ObjectShaderMaterial.TypeSlug,
        alias: ['shader', ObjectShaderMaterial.TYPE, ObjectShaderMaterial.TypeSlug, 'ShaderMaterial', 'ShaderMaterial2', 'ExtendedShaderMaterial'],
        params: {
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: shaderUtils.defaultFragment,
        },
        generator: (params) => {
            return new ObjectShaderMaterial(params)
        },
    }
}

// todo gltf material extension
