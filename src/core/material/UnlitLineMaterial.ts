import {Color, IUniform, LineBasicMaterial, LineBasicMaterialParameters, Material, Shader, WebGLRenderer} from 'three'
import {UiObjectConfig} from 'uiconfig.js'
import {
    IMaterial,
    IMaterialEvent,
    IMaterialEventTypes,
    IMaterialGenerator,
    IMaterialParameters,
    IMaterialTemplate,
    IMaterialUserData,
} from '../IMaterial'
import {MaterialExtension} from '../../materials'
import {SerializationMetaType, shaderReplaceString, ThreeSerialization} from '../../utils'
import {iMaterialCommons, threeMaterialPropList} from './iMaterialCommons'
import {IObject3D} from '../IObject'
import {makeSamplerUi} from '../../ui/image-ui'
import {iMaterialUI} from './IMaterialUi'

export type UnlitLineMaterialEventTypes = IMaterialEventTypes | ''

export class UnlitLineMaterial extends LineBasicMaterial<IMaterialEvent, UnlitLineMaterialEventTypes> implements IMaterial<IMaterialEvent, UnlitLineMaterialEventTypes> {
    declare ['constructor']: typeof UnlitLineMaterial

    public static readonly TypeSlug = 'blmat'
    public static readonly TYPE = 'UnlitLineMaterial' // not using .type because it is used by three.js
    assetType = 'material' as const

    declare userData: IMaterialUserData

    public readonly isUnlitLineMaterial = true

    readonly appliedMeshes: Set<IObject3D> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {return iMaterialCommons.dispose(super.dispose).call(this)}
    clone(): this {return iMaterialCommons.clone(super.clone).call(this)}
    dispatchEvent(event: IMaterialEvent): void {iMaterialCommons.dispatchEvent(super.dispatchEvent).call(this, event)}

    generator?: IMaterialGenerator

    constructor({customMaterialExtensions, ...parameters}: LineBasicMaterialParameters & IMaterialParameters = {}) {
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

        super.onBeforeCompile(shader, renderer)
    }

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
    setValues(parameters: Material|(LineBasicMaterialParameters&{type?:string}), allowInvalidType = true, clearCurrentUserData: boolean|undefined = undefined): this {
        if (!parameters) return this
        if (parameters.type && !allowInvalidType && !['LineBasicMaterial', 'LineBasicMaterial2', this.constructor.TYPE].includes(parameters.type)) {
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
     * @param _internal - Calls only super.toJSON, does internal three.js serialization and @serialize tags. Set it to true only if you know what you are doing. This is used in Serialization->serializer->material
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
        label: 'Unlit Line Material',
        uuid: 'MBLM2_' + this.uuid,
        expanded: true,
        onChange: (ev)=>{
            if (!ev.config || ev.config.onChange) return
            // todo set needsUpdate true only for properties that require it like maps.
            this.setDirty({uiChangeEvent: ev, needsUpdate: !!ev.last, refreshUi: !!ev.last})
        },
        children: [
            {
                type: 'input',
                property: [this, 'name'],
            },
            // {
            //     type: 'monitor',
            //     property: [this, 'uuid'],
            // },
            {
                type: 'checkbox',
                property: [this, 'vertexColors'],
            },
            {
                type: 'color',
                property: [this, 'color'],
            },
            makeSamplerUi(this, 'map'),
            {
                type: 'number',
                property: [this, 'linewidth'],
            },
            {
                type: 'dropdown',
                property: [this, 'linecap'],
                children: ['butt', 'round', 'square'].map(label => ({label})),
            },
            {
                type: 'dropdown',
                property: [this, 'linejoin'],
                children: ['bevel', 'round', 'miter'].map(label => ({label})),
            },
            // {
            //     type: 'checkbox',
            //     property: [this, 'fog'],
            // },
            iMaterialUI.blending(this),
            iMaterialUI.polygonOffset(this),
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
        linewidth: 1,
        linecap: 'round',
        linejoin: 'round',
        fog: true,
    }

    static MaterialTemplate: IMaterialTemplate<UnlitLineMaterial, Partial<typeof UnlitLineMaterial.MaterialProperties>> = {
        materialType: UnlitLineMaterial.TYPE,
        name: 'unlit_line',
        typeSlug: UnlitLineMaterial.TypeSlug,
        alias: ['line_basic', 'unlit_line', UnlitLineMaterial.TYPE, UnlitLineMaterial.TypeSlug, 'LineBasicMaterial', 'LineBasicMaterial2'],
        params: {
            color: new Color(1, 1, 1),
        },
        generator: (params) => {
            return new UnlitLineMaterial(params)
        },
    }
}

export class LineBasicMaterial2 extends UnlitLineMaterial {
    constructor(parameters?: LineBasicMaterialParameters) {
        super(parameters)
        console.error('LineBasicMaterial2 is deprecated, use UnlitLineMaterial instead')
    }
}
