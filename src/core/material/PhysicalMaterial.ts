import {generateUiConfig, UiObjectConfig} from 'uiconfig.js'
import {
    BufferGeometry,
    Camera,
    Color,
    IUniform,
    Material,
    MeshPhysicalMaterial,
    MeshPhysicalMaterialParameters,
    Object3D,
    Scene,
    TangentSpaceNormalMap,
    Vector2,
    WebGLProgramParametersWithUniforms,
    WebGLRenderer,
} from 'three'
import {AnimateTime, SerializationMetaType, shaderReplaceString, ThreeSerialization} from '../../utils'
import {
    IMaterial,
    IMaterialEventMap,
    IMaterialGenerator,
    IMaterialParameters,
    IMaterialTemplate,
    IMaterialUserData,
} from '../IMaterial'
import {MaterialExtension} from '../../materials'
import {iMaterialCommons} from './iMaterialCommons'
import {IObject3D} from '../IObject'
import {ITexture} from '../ITexture'
import {iMaterialUI} from './IMaterialUi'
import {threeMaterialInterpolateProps, threeMaterialPropList} from './threeMaterialPropList'

/**
 * And extension of three.js MeshPhysicalMaterial that can be assigned to objects, and support threepipe features, uiconfig, and serialization.
 *
 * @category Materials
 */
export class PhysicalMaterial<TE extends IMaterialEventMap = IMaterialEventMap> extends MeshPhysicalMaterial<TE & IMaterialEventMap> implements IMaterial<TE> {
    declare ['constructor']: typeof PhysicalMaterial
    public static readonly TypeSlug = 'pmat'
    public static readonly TYPE = 'PhysicalMaterial' // not using .type because it is used by three.js
    assetType = 'material' as const

    declare userData: IMaterialUserData

    public readonly isPhysicalMaterial = true

    readonly appliedMeshes: Set<IObject3D> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {return iMaterialCommons.dispose(super.dispose).call(this)}
    clone(track = false): this {return iMaterialCommons.clone(super.clone).call(this, track)}

    generator?: IMaterialGenerator

    map: ITexture | null = null
    alphaMap: ITexture | null = null
    roughnessMap: ITexture | null = null
    metalnessMap: ITexture | null = null
    normalMap: ITexture | null = null
    bumpMap: ITexture | null = null
    displacementMap: ITexture | null = null


    constructor({customMaterialExtensions, ...parameters}: MeshPhysicalMaterialParameters & IMaterialParameters = {}) {
        super()
        this.fog = false
        this.attenuationDistance = 0 // infinite distance (for Ui)
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
        const f = [
            ['vec3 totalDiffuse = ', 'afterModulation'],
            ['#include <aomap_fragment>', 'beforeModulation'],
            ['#include <lights_physical_fragment>', 'beforeAccumulation'],
            ['#include <clipping_planes_fragment>', 'mainStart'],
        ]
        const v = [
            ['#include <uv_vertex>', 'mainStart'],
        ]
        for (const vElement of v) shader.vertexShader = shaderReplaceString(shader.vertexShader, vElement[0], '#glMarker ' + vElement[1] + '\n' + vElement[0])
        for (const fElement of f) shader.fragmentShader = shaderReplaceString(shader.fragmentShader, fElement[0], '#glMarker ' + fElement[1] + '\n' + fElement[0])

        // for NaN. todo do the same in Unlit and line materials?
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>', 'gl_FragColor = clamp(gl_FragColor, 0.0, 1000.0);\n', {append: true})

        iMaterialCommons.onBeforeCompile.call(this, shader, renderer)

        shader.defines && (shader.defines.INVERSE_ALPHAMAP = this.userData.inverseAlphaMap ? 1 : 0)

        super.onBeforeCompile(shader, renderer)
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        super.onBeforeRender(renderer, scene, camera, geometry, object)
        iMaterialCommons.onBeforeRender.call(this, renderer, scene, camera, geometry, object)

        const t = this.userData.inverseAlphaMap ? 1 : 0
        if (t !== this.defines.INVERSE_ALPHAMAP) {
            this.defines.INVERSE_ALPHAMAP = t
            this.needsUpdate = true
        }
    }

    /**
     * onAfterRender is called after the material is rendered
     * @ignore
     */
    onAfterRender = iMaterialCommons.onAfterRenderOverride(super.onAfterRender)

    // endregion


    // region UI Config

    // todo dispose ui config
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Physical Material',
        uuid: 'MPM2_' + this.uuid,
        expanded: true,
        onChange: (ev)=>{
            if (!ev.config || ev.config.onChange) return
            // todo frameFade
            let key = Array.isArray(ev.config.property) ? ev.config.property[1] : ev.config.property
            key = typeof key === 'string' ? key : undefined
            // todo set needsUpdate true only for properties that require it like maps.
            this.setDirty({uiChangeEvent: ev, needsUpdate: !!ev.last, refreshUi: !!ev.last, change: key})
        },
        children: [
            ...iMaterialUI.base(this),
            ...generateUiConfig(this),
            iMaterialUI.blending(this),
            iMaterialUI.roughMetal(this),
            iMaterialUI.bumpNormal(this),
            iMaterialUI.emission(this),
            iMaterialUI.transmission(this),
            iMaterialUI.environment(this),
            iMaterialUI.aoLightMap(this),
            iMaterialUI.clearcoat(this),
            iMaterialUI.iridescence(this),
            iMaterialUI.sheen(this),
            iMaterialUI.polygonOffset(this),
            ...iMaterialUI.misc(this),
        ],
    }

    // endregion UI Config


    // region Serialization

    /**
     * Sets the values of this material based on the values of the passed material or an object with material properties
     * The input is expected to be a valid material or a deserialized material parameters object(including the deserialized userdata)
     * @param parameters - material or material parameters object
     * @param allowInvalidType - if true, the type of the oldMaterial is not checked. Objects without type are always allowed.
     * @param clearCurrentUserData - if undefined, then depends on material.isMaterial. if true, the current userdata is cleared before setting the new values, because it can have data which wont be overwritten if not present in the new material.
     * @param time - optional data to animate(lerp) from current value to the target value.
     */
    setValues(parameters: Material|(MeshPhysicalMaterialParameters&{type?:string}), allowInvalidType = true, clearCurrentUserData: boolean|undefined = undefined, time?: AnimateTime): this {
        if (!parameters) return this
        if (parameters.type && !allowInvalidType && !['MeshPhysicalMaterial', 'MeshStandardMaterial', 'MeshStandardMaterial2', this.constructor.TYPE].includes(parameters.type)) {
            console.error('Material type is not supported:', parameters.type)
            return this
        }

        // Blender exporter used to export a scalar. See three.js:#7459
        if (typeof (<any>parameters).normalScale === 'number') {
            (<any>parameters).normalScale = [(<any>parameters).normalScale, (<any>parameters).normalScale]
        }

        if ((parameters as any).ior !== undefined) this.ior = (parameters as any).ior // ior is not serialized in MeshPhysicalMaterial.toJSON, so we need to set it here
        iMaterialCommons.setValues(super.setValues).call(this, parameters, allowInvalidType, clearCurrentUserData, time)

        if (!isFinite(this.attenuationDistance)) this.attenuationDistance = 0 // hack for ui

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
     * Note: some properties that are not serialized in Material.toJSON when they are default values (like side, alphaTest, blending, maps), they wont be reverted back if not present in JSON
     * If _internal = true, Textures should be loaded and in meta.textures before calling this method.
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

    // used for serialization
    static readonly MaterialProperties = {
        // keep updated with properties in MeshStandardMaterial.js
        ...threeMaterialPropList,

        color: new Color(0xffffff),
        roughness: 1,
        metalness: 0,
        map: null,
        lightMap: null,
        lightMapIntensity: 1,
        aoMap: null,
        aoMapIntensity: 1,
        emissive: '#000000',
        emissiveIntensity: 1,
        emissiveMap: null,
        bumpMap: null,
        bumpScale: 1,
        normalMap: null,
        normalMapType: TangentSpaceNormalMap,
        normalScale: new Vector2(1, 1),
        displacementMap: null,
        displacementScale: 1,
        displacementBias: 0,
        roughnessMap: null,
        metalnessMap: null,
        alphaMap: null,
        envMap: null,
        envMapIntensity: 1,
        // refractionRatio: 0,
        wireframe: false,
        wireframeLinewidth: 1,
        wireframeLinecap: 'round',
        wireframeLinejoin: 'round',
        flatShading: false,
        fog: true,

        // skinning: false,

        // vertexTangents: false, //removed from threejs

        // morphTargets: false,
        // morphNormals: false,

        // GLTF Extensions // todo: supported anywhere?

        // glossiness: 0,
        // glossinessMap: null,

        // specularColor: new Color(0),
        // specularColorMap: null,



        // keep updated with properties in MeshPhysicalMaterial.js
        clearcoat: 0,
        clearcoatMap: null,
        clearcoatRoughness: 0,
        clearcoatRoughnessMap: null,
        clearcoatNormalScale: new Vector2(1, 1),
        clearcoatNormalMap: null,

        reflectivity: 0.5, // because this is used in Material.js->toJSON and fromJSON instead of ior

        iridescence: 0,
        iridescenceMap: null,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [100, 400],
        iridescenceThicknessMap: null,

        sheen: 0,
        sheenColor: new Color(0x000000),
        sheenColorMap: null,
        sheenRoughness: 1.0,
        sheenRoughnessMap: null,

        transmission: 0,
        transmissionMap: null,
        thickness: 0,
        thicknessMap: null,
        attenuationDistance: Infinity,
        attenuationColor: new Color(1, 1, 1),

        specularIntensity: 1.0,
        specularIntensityMap: null,
        specularColor: new Color(1, 1, 1),
        specularColorMap: null,

        anisotropy: 0,
        anisotropyRotation: 0,
        anisotropyMap: null,
    }
    static readonly MapProperties = [
        'map',
        'lightMap',
        'aoMap',
        'emissiveMap',
        'bumpMap',
        'normalMap',
        'displacementMap',
        'roughnessMap',
        'metalnessMap',
        'alphaMap',
        'envMap',
        // glossinessMap
        // specularColorMap
        'clearcoatMap',
        'clearcoatRoughnessMap',
        'clearcoatNormalMap',
        'iridescenceMap',
        'iridescenceThicknessMap',
        'sheenColorMap',
        'sheenRoughnessMap',
        'transmissionMap',
        'thicknessMap',
        'specularIntensityMap',
        'specularColorMap',
        'anisotropyMap',
    ]


    static readonly InterpolateProperties = [
        ...threeMaterialInterpolateProps,
        'color',
        'emissive',
        'roughness',
        'metalness',
        'lightMapIntensity',
        'aoMapIntensity',
        'emissiveIntensity',
        'bumpScale',
        'normalScale',
        'displacementScale',
        'displacementBias',
        'envMapIntensity',
        'wireframeLinewidth',
        'reflectivity',
        'clearcoat',
        'clearcoatRoughness',
        'clearcoatNormalScale',
        'iridescence',
        'iridescenceIOR',
        'iridescenceThicknessRange',
        'sheen',
        'sheenColor',
        'sheenRoughness',
        'transmission',
        'thickness',
        'attenuationDistance',
        'attenuationColor',
        'specularIntensity',
        'specularColor',
        'anisotropy',
        'anisotropyRotation',
    ]


    static MaterialTemplate: IMaterialTemplate<PhysicalMaterial, Partial<typeof PhysicalMaterial.MaterialProperties>> = {
        materialType: PhysicalMaterial.TYPE,
        name: 'physical',
        typeSlug: PhysicalMaterial.TypeSlug,
        alias: ['standard', 'physical', PhysicalMaterial.TYPE, PhysicalMaterial.TypeSlug, 'MeshStandardMaterial', 'MeshStandardMaterial2', 'MeshPhysicalMaterial'],
        params: {
            color: new Color(1, 1, 1),
        },
        generator: (params) => {
            return new PhysicalMaterial(params)
        },
    }
}

export class MeshStandardMaterial2 extends PhysicalMaterial {
    constructor(parameters?: MeshPhysicalMaterialParameters) {
        super(parameters)
        console.error('MeshStandardMaterial2 is deprecated, use UnlitMaterial instead')
    }
}
