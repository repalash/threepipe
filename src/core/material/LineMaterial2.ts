import {generateUiConfig, uiColor, uiInput, uiNumber, UiObjectConfig, uiToggle, uiVector} from 'uiconfig.js'
import {
    BufferGeometry,
    Camera,
    Color,
    IUniform,
    Material,
    Object3D,
    Scene,
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
import {iMaterialUI} from './IMaterialUi'
import {LineMaterial, type LineMaterialParameters} from 'three/examples/jsm/lines/LineMaterial.js'
import {threeMaterialInterpolateProps, threeMaterialPropList} from './threeMaterialPropList'

/**
 * And extension of three.js LineMaterial that can be assigned to lines, and support threepipe features, uiconfig, and serialization.
 *
 * @category Materials
 */
export class LineMaterial2<TE extends IMaterialEventMap = IMaterialEventMap> extends LineMaterial<TE & IMaterialEventMap> implements IMaterial<TE> {
    declare ['constructor']: typeof LineMaterial2
    public static readonly TypeSlug = 'lmat'
    public static readonly TYPE = 'LineMaterial2' // not using .type because it is used by three.js
    assetType = 'material' as const

    declare userData: IMaterialUserData

    public readonly isLineMaterial2 = true

    readonly appliedMeshes: Set<IObject3D> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {return iMaterialCommons.dispose(super.dispose).call(this)}
    clone(track = false): this {return iMaterialCommons.clone(super.clone).call(this, track)}

    generator?: IMaterialGenerator

    constructor({customMaterialExtensions, ...parameters}: LineMaterialParameters & IMaterialParameters = {}) {
        super()
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
        const f = [
            ['vec4 diffuseColor = ', 'beforeAccumulation'],
            ['#include <clipping_planes_fragment>', 'mainStart'],
        ]
        const v = [
            ['#ifdef USE_COLOR', 'mainStart'],
        ]
        for (const vElement of v) shader.vertexShader = shaderReplaceString(shader.vertexShader, vElement[0], '#glMarker ' + vElement[1] + '\n' + vElement[0])
        for (const fElement of f) shader.fragmentShader = shaderReplaceString(shader.fragmentShader, fElement[0], '#glMarker ' + fElement[1] + '\n' + fElement[0])

        iMaterialCommons.onBeforeCompile.call(this, shader, renderer)

        super.onBeforeCompile(shader, renderer)
    }

    autoUpdateResolution = true

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        if (this.autoUpdateResolution) renderer.getSize(this.resolution)
        super.onBeforeRender(renderer, scene, camera, geometry, object)
        iMaterialCommons.onBeforeRender.call(this, renderer, scene, camera, geometry, object)
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D): void {
        super.onAfterRender(renderer, scene, camera, geometry, object)
        iMaterialCommons.onAfterRender.call(this, renderer, scene, camera, geometry, object)
    }

    // endregion


    // region UI Config

    @uiInput() declare name: string
    @uiColor() declare color: Color
    @uiToggle() declare dashed: boolean
    @uiNumber() declare dashScale: number
    @uiNumber() declare dashSize: number
    @uiNumber() declare dashOffset: number
    @uiNumber() declare gapSize: number
    @uiNumber() declare linewidth: number
    @uiVector() declare resolution: Vector2
    @uiToggle() declare alphaToCoverage: boolean
    @uiToggle() declare worldUnits: boolean
    // @uiToggle() declare fog = true


    // todo dispose ui config
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Line Material',
        uuid: 'MPM2_' + this.uuid,
        expanded: true,
        onChange: (ev)=>{
            if (!ev.config || ev.config.onChange) return
            // this.uniformsNeedUpdate = true
            // this.appliedMeshes.forEach(m=>{
            //     if ((m.isLineSegments2 || m.isLineSegments) && m.computeLineDistances) {
            //         m.computeLineDistances()
            //     }
            // })
            let key = Array.isArray(ev.config.property) ? ev.config.property[1] : ev.config.property
            key = typeof key === 'string' ? key : undefined
            // todo set needsUpdate true only for properties that require it like maps.
            this.setDirty({uiChangeEvent: ev, needsUpdate: !!ev.last, refreshUi: !!ev.last, change: key})
        },
        children: [
            ...generateUiConfig(this) || [],
            iMaterialUI.blending(this),
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
     * @param time
     */
    setValues(parameters: Material|(LineMaterialParameters&{type?:string}), allowInvalidType = true, clearCurrentUserData: boolean|undefined = undefined, time?: AnimateTime): this {
        if (!parameters) return this
        if (parameters.type && !allowInvalidType && !['LineMaterial', this.constructor.TYPE].includes(parameters.type) && !(parameters as LineMaterial2).isLineMaterial && !(parameters as LineMaterial2).isLineMaterial2) {
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
     * Note: some properties that are not serialized in Material.toJSON when they are default values (like side, alphaTest, blending, maps), they wont be reverted back if not present in JSON
     * If _internal = true, Textures should be loaded and in meta.textures before calling this method.
     * @param data
     * @param meta
     * @param _internal
     */
    fromJSON(data: any, meta?: SerializationMetaType, _internal = false): this | null {
        if (_internal) {
            ThreeSerialization.Deserialize(data, this, meta, true)
            return this.setValues(data) // todo remove this and add @serialize decorator to properties
        }
        this.dispatchEvent({type: 'beforeDeserialize', data, meta, bubbleToObject: true, bubbleToParent: true})
        return this
    }

    // endregion

    // used for serialization and used in setValues
    static readonly MaterialProperties = {
        // keep updated with properties in LineMaterial.js
        ...threeMaterialPropList,

        color: new Color(0xffffff),
        dashed: false,
        dashScale: 1,
        dashSize: 1,
        dashOffset: 0,
        gapSize: 1,
        linewidth: 1,
        resolution: new Vector2(1, 1),
        alphaToCoverage: false,
        worldUnits: false,

        uniforms: {},
        defines: {},
        extensions: {},
        clipping: false,
        fog: true,
        fragmentShader: '',
        vertexShader: '',

    }

    static readonly InterpolateProperties = [
        ...threeMaterialInterpolateProps,
        'color',
        'dashScale',
        'dashSize',
        'dashOffset',
        'gapSize',
        'linewidth',
        'resolution',
    ]

    static MaterialTemplate: IMaterialTemplate<LineMaterial2, Partial<typeof LineMaterial2.MaterialProperties>> = {
        materialType: LineMaterial2.TYPE,
        name: 'line',
        typeSlug: LineMaterial2.TypeSlug,
        alias: ['line', 'line_physical', LineMaterial2.TYPE, LineMaterial2.TypeSlug, 'LineMaterial'],
        params: {
            color: new Color(1, 1, 1),
        },
        generator: (params) => {
            return new LineMaterial2(params)
        },
    }

}

export class MeshLineMaterial extends LineMaterial2 {}
