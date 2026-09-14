import {Vector4} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {glsl, serialize} from 'ts-browser-helpers'
import {IMaterialUserData, PhysicalMaterial} from '../../core'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {shaderReplaceString, ThreeSerialization} from '../../utils'
import {AssetManager, GLTFWriter2} from '../../assetmanager'
import {RenderManager} from '../../rendering'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import MultiLayerRoughnessPluginPars from './shaders/MultiLayerRoughnessPlugin.pars.glsl'

// eslint-disable-next-line @typescript-eslint/naming-convention
const ShaderChunk = RenderManager.ShaderChunk

export type MultiLayerRoughnessBlendMode = 'mix' | 'additive' | 'chain'

export interface MultiLayerRoughnessLayer {
    /**
     * Presence of this specular lobe. How it maps to the final lobe weight depends on the blend mode.
     */
    weight: number
    /**
     * Roughness of this specular lobe. Final lobe roughness = clamp(roughness + baseRoughness * baseInfluence, 0.0525, 1)
     */
    roughness: number
    /**
     * How much of the material's (mapped) roughness is added to this layer's roughness.
     * 0 = absolute roughness, 1 = base roughness 'lifted' by {@link roughness}.
     */
    baseInfluence: number
}

/**
 * Multi Layer Roughness Plugin
 *
 * Adds a material extension to PhysicalMaterial that blends multiple specular (GGX) lobes with different roughness
 * values on the same surface - "reflection tail-off" seen on real metals, where a sharp core reflection coexists
 * with one or more rougher, fainter reflections caused by sub-pixel micro scratches of varying depth and density.
 *
 * Each extra layer is a copy of the material's specular lobe with its own roughness and weight, evaluated for both
 * direct lights and the environment map (with per-lobe multi-scattering energy compensation).
 * Layer weights can be blended energy-conserving ('mix', default), additive ('additive', like the two-lobe shaders
 * used by ILM on Iron Man 2008), or as a sequential mix chain ('chain', like chained Mix Shader nodes in Blender).
 *
 * It also adds a UI to the material to edit the settings.
 * It uses WEBGI_materials_multi_layer_roughness glTF extension to save the settings in glTF files.
 *
 * Note: screen-space effects (SSR, SSGI) read the base roughness from the GBuffer and are not affected by the extra layers.
 * Rect area lights evaluate only the base lobe.
 * @category Plugins
 */
@uiFolderContainer('Multi Layer Roughness (MatExt)')
export class MultiLayerRoughnessPlugin extends AViewerPluginSync {
    static readonly PluginType = 'MultiLayerRoughnessPlugin'

    static readonly MAX_LAYERS = 4

    @uiToggle('Enabled', (that: MultiLayerRoughnessPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    private _uniforms: any = {
        mlrLayers: {value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()]},
        mlrBaseWeight: {value: 1},
    }

    static AddMultiLayerRoughness(material: PhysicalMaterial, params?: Partial<NonNullable<IMaterialUserData['_multiLayerRoughness']>>): IMaterialUserData['_multiLayerRoughness']|null {
        const ud = material?.userData
        if (!ud) return null
        if (!ud._multiLayerRoughness) ud._multiLayerRoughness = {}
        const state = ud._multiLayerRoughness!
        state.enabled = true
        if (state.blendMode === undefined) state.blendMode = 'mix'
        if (state.layers === undefined) state.layers = [{weight: 0.3, roughness: 0.45, baseInfluence: 0}]
        params && Object.assign(state, params)
        if (state.layers!.length > MultiLayerRoughnessPlugin.MAX_LAYERS) state.layers = state.layers!.slice(0, MultiLayerRoughnessPlugin.MAX_LAYERS)
        if (material.setDirty) material.setDirty()
        return state
    }

    /**
     * Resolves the per-layer weights and the base lobe weight from the blend mode.
     * 'mix' - energy conserving: base gets 1 - sum(weights), all renormalized if the sum exceeds 1.
     * 'additive' - base stays 1, layers are added on top (not energy conserving).
     * 'chain' - sequential mix chain (Blender Mix Shader style): each layer scales down everything below it.
     */
    private _resolveWeights(layers: MultiLayerRoughnessLayer[], mode: MultiLayerRoughnessBlendMode): {weights: number[], base: number} {
        const ws = layers.map(l=>Math.min(Math.max(l.weight ?? 0, 0), 1))
        switch (mode) {
        case 'additive':
            return {weights: ws, base: 1}
        case 'chain': {
            const weights = ws.map((w, i)=>ws.slice(i + 1).reduce((p, x)=>p * (1 - x), w))
            return {weights, base: ws.reduce((p, x)=>p * (1 - x), 1)}
        }
        default: { // mix
            const sum = ws.reduce((a, b)=>a + b, 0)
            return sum > 1 ? {weights: ws.map(w=>w / sum), base: 0} : {weights: ws, base: 1 - sum}
        }
        }
    }

    readonly materialExtension: MaterialExtension = {
        uuid: MultiLayerRoughnessPlugin.PluginType,
        priority: 8, // less than AnisotropyPlugin(10, applied first) so we can patch its BRDF_GGX_Anisotropy call, more than sscs(5)
        shaderExtender: (shader, material: PhysicalMaterial, _renderer) => {
            const state = material?.userData._multiLayerRoughness
            if (this.isDisabled() || !state?.enabled || !state.layers?.length) return

            // expand the chunks we patch, if not already expanded by another extension (like AnisotropyPlugin)
            if (shader.fragmentShader.includes('#include <lights_physical_pars_fragment>'))
                shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', ShaderChunk.lights_physical_pars_fragment)
            if (shader.fragmentShader.includes('#include <lights_fragment_maps>'))
                shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', ShaderChunk.lights_fragment_maps)

            // uniforms, globals and helpers, before RE_Direct_Physical (BRDF_GGX and the PhysicalMaterial struct are defined above it)
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'void RE_Direct_Physical(', MultiLayerRoughnessPluginPars + '\n', {prepend: true})

            // direct light - evaluate the specular BRDF once per layer with the layer's roughness.
            // the line reads `... * BRDF_GGX( ..., material )` normally, or `... * BRDF_GGX_Anisotropy( ..., material.roughness, ... )`
            // when the webgi AnisotropyPlugin (applied before this, higher priority) has patched it.
            const directLine = shader.fragmentShader.match(/reflectedLight\.directSpecular \+= irradiance \* (BRDF_GGX(?:_\w+)?\( [^;]+\));/)
            if (!directLine) {
                this._viewer?.console.error('MultiLayerRoughnessPlugin - direct specular accumulation line not found in shader, cannot apply layers to direct lights.', material)
            } else {
                const call = directLine[1]
                const lobeCall = call.includes('material.roughness') ?
                    call.replaceAll('material.roughness', 'mlrRough') : // anisotropy(or other) variant with explicit roughness argument
                    call.replace(/material\s*\)$/, 'mlrLobe )') // stock BRDF_GGX( ..., material ) - swap the struct
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, directLine[0], glsl`
#if defined( MLR_LAYER_COUNT ) && MLR_LAYER_COUNT > 0
	reflectedLight.directSpecular += irradiance * mlrBaseWeight * ${call};
	{
		float mlrRough;
		PhysicalMaterial mlrLobe = material;
		for ( int i = 0; i < MLR_LAYER_COUNT; i ++ ) {
			mlrRough = mlrLayerRoughness( mlrLayers[ i ], material.roughness );
			mlrLobe.roughness = mlrRough;
			#ifdef USE_ANISOTROPY
				mlrLobe.alphaT = mix( pow2( mlrRough ), 1.0, pow2( material.anisotropy ) );
			#endif
			reflectedLight.directSpecular += irradiance * mlrLayers[ i ].x * ${lobeCall};
		}
	}
#else
	${directLine[0]}
#endif
`)
            }

            // environment map - one radiance (env mip) sample per layer with the layer's roughness.
            // matches both getIBLRadiance and getIBLAnisotropyRadiance, with any normal (AnisotropyPlugin swaps in a bent normal).
            const radianceLines = [...shader.fragmentShader.matchAll(/radiance \+= (getIBL\w*Radiance\( [^;]*material\.roughness[^;]*\));\n/g)]
            if (!radianceLines.length) {
                this._viewer?.console.error('MultiLayerRoughnessPlugin - IBL radiance line not found in shader, cannot apply layers to environment lighting.', material)
            } else for (const line of radianceLines) {
                shader.fragmentShader = shaderReplaceString(shader.fragmentShader, line[0], glsl`
#if defined( MLR_LAYER_COUNT ) && MLR_LAYER_COUNT > 0
		for ( int i = 0; i < MLR_LAYER_COUNT; i ++ ) {
			mlrRadiances[ i ] += ${line[1].replaceAll('material.roughness', 'mlrLayerRoughness( mlrLayers[ i ], material.roughness )')};
		}
#endif
`, {append: true})
            }

            // indirect specular - per-lobe DFG (multi-scattering energy compensation), weighted.
            // the base single scattering pairs with the base radiance, each lobe's with its own radiance sample.
            // lobe multi-scattering shares cosineWeightedIrradiance with the base, so it's folded into multiScattering.
            // total scattering (used to rebalance indirect diffuse) becomes the weighted sum over all lobes.
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'vec3 totalScattering = singleScattering + multiScattering;', glsl`
#if defined( MLR_LAYER_COUNT ) && MLR_LAYER_COUNT > 0
	singleScattering *= mlrBaseWeight;
	multiScattering *= mlrBaseWeight;
	vec3 mlrExtraScatter = vec3( 0.0 );
	{
		vec3 mlrSingle; vec3 mlrMulti;
		for ( int i = 0; i < MLR_LAYER_COUNT; i ++ ) {
			mlrSingle = vec3( 0.0 ); mlrMulti = vec3( 0.0 );
			float mlrRough = mlrLayerRoughness( mlrLayers[ i ], material.roughness );
			#ifdef USE_IRIDESCENCE
				computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, mlrRough, mlrSingle, mlrMulti );
			#else
				computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, mlrRough, mlrSingle, mlrMulti );
			#endif
			reflectedLight.indirectSpecular += mlrLayers[ i ].x * mlrRadiances[ i ] * mlrSingle;
			multiScattering += mlrLayers[ i ].x * mlrMulti;
			mlrExtraScatter += mlrLayers[ i ].x * mlrSingle;
		}
	}
	vec3 totalScattering = singleScattering + multiScattering + mlrExtraScatter;
#else
	vec3 totalScattering = singleScattering + multiScattering;
#endif
`)
        },
        onObjectRender: (_, material: PhysicalMaterial) => {
            const state = material.userData._multiLayerRoughness
            const layers = state?.enabled ? state.layers ?? [] : []
            const count = Math.min(layers.length, MultiLayerRoughnessPlugin.MAX_LAYERS)
            if (count) {
                const {weights, base} = this._resolveWeights(layers, state!.blendMode ?? 'mix')
                for (let i = 0; i < count; i++) {
                    const l = layers[i]
                    this._uniforms.mlrLayers.value[i].set(weights[i], l.roughness ?? 0, l.baseInfluence ?? 0, 0)
                }
                this._uniforms.mlrBaseWeight.value = base
            }
            updateMaterialDefines({
                ['MLR_LAYER_COUNT']: this.isDisabled() ? 0 : count,
            }, material)
        },
        extraUniforms: {
            // ...this._uniforms, // done in constructor
        },
        computeCacheKey: (material: PhysicalMaterial) => {
            const state = material.userData._multiLayerRoughness
            return (this.isDisabled() ? '0' : '1') + (state?.enabled ? '1' : '0') + (state?.layers?.length ?? 0)
        },
        isCompatible: (material: PhysicalMaterial) => {
            return material.isPhysicalMaterial
        },
        getUiConfig: (material: PhysicalMaterial) => {
            const viewer = this._viewer!
            if (material.userData._multiLayerRoughness === undefined) material.userData._multiLayerRoughness = {}
            const state = material.userData._multiLayerRoughness
            const layerUi = (layer: MultiLayerRoughnessLayer, i: number): UiObjectConfig=>({
                type: 'folder',
                label: 'Layer ' + (i + 1),
                children: [
                    {
                        type: 'slider',
                        label: 'Weight',
                        bounds: [0, 1],
                        property: [layer, 'weight'],
                    },
                    {
                        type: 'slider',
                        label: 'Roughness',
                        bounds: [0, 1],
                        property: [layer, 'roughness'],
                    },
                    {
                        type: 'slider',
                        label: 'Base Influence',
                        bounds: [0, 1],
                        property: [layer, 'baseInfluence'],
                    },
                    {
                        type: 'button',
                        label: 'Remove Layer',
                        value: ()=>{
                            state.layers?.splice(i, 1)
                            if (material.setDirty) material.setDirty()
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                ],
            })
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'Multi Layer Roughness',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state.enabled || false
                        },
                        set value(v) {
                            if (v === state.enabled) return
                            if (v) {
                                if (!MultiLayerRoughnessPlugin.AddMultiLayerRoughness(material))
                                    viewer.dialog.alert('Cannot add multi layer roughness.')
                            } else {
                                state.enabled = false
                                if (material.setDirty) material.setDirty()
                            }
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'dropdown',
                        label: 'Blend Mode',
                        hidden: () => !state.enabled,
                        property: [state, 'blendMode'],
                        children: (['mix', 'additive', 'chain'] as const).map(value => ({label: value, value})),
                        onChange: ()=>{
                            if (material.setDirty) material.setDirty()
                        },
                    },
                    ()=>state.enabled ? state.layers?.map((l, i)=>layerUi(l, i)) ?? [] : [],
                    {
                        type: 'button',
                        label: 'Add Layer',
                        hidden: () => !state.enabled || (state.layers?.length ?? 0) >= MultiLayerRoughnessPlugin.MAX_LAYERS,
                        value: ()=>{
                            const last = state.layers?.[state.layers.length - 1]
                            state.layers = [...state.layers ?? [], {
                                weight: (last?.weight ?? 0.6) / 2,
                                roughness: Math.min((last?.roughness ?? 0.2) + 0.25, 1),
                                baseInfluence: last?.baseInfluence ?? 0,
                            }]
                            if (material.setDirty) material.setDirty()
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                ],
            }
            return config
        },
    }

    setDirty = (): void => {
        this.materialExtension.setDirty?.()
        this._viewer?.setDirty()
    }

    constructor() {
        super()
        Object.assign(this.materialExtension.extraUniforms!, this._uniforms)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
        v.assetManager.registerGltfExtension(multiLayerRoughnessGLTFExtension)
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.unregisterGltfExtension(multiLayerRoughnessGLTFExtension.name)
        return super.onRemove(v)
    }
}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        _multiLayerRoughness?: {
            enabled?: boolean
            /**
             * How layer weights are combined with the base lobe. Default 'mix' (energy conserving).
             */
            blendMode?: MultiLayerRoughnessBlendMode
            /**
             * Extra specular lobes, max {@link MultiLayerRoughnessPlugin.MAX_LAYERS}.
             */
            layers?: MultiLayerRoughnessLayer[]
        }
    }
}

/**
 * MultiLayerRoughness Materials Extension
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_multi_layer_roughness.html (todo - fix link)
 */
class GLTFMaterialsMultiLayerRoughnessExtensionImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser) {
        this.parser = parser
        this.name = multiLayerRoughnessGLTFExtension.name
    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {
        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]
        if (!materialDef.extensions || !materialDef.extensions[this.name]) return
        const extension = materialDef.extensions[this.name]
        if (!materialParams.userData) materialParams.userData = {}
        MultiLayerRoughnessPlugin.AddMultiLayerRoughness(materialParams)
        ThreeSerialization.Deserialize(extension, materialParams.userData._multiLayerRoughness)
    }
}

const glTFMaterialsMultiLayerRoughnessExtensionExport = (w: GLTFWriter2)=> ({
    writeMaterial: (material: any, materialDef: any) => {
        const state = material.userData._multiLayerRoughness
        if (!material.isMeshStandardMaterial || !state?.enabled || !state.layers?.length) return
        materialDef.extensions = materialDef.extensions || {}

        const extensionDef: any = ThreeSerialization.Serialize(state)

        materialDef.extensions[ multiLayerRoughnessGLTFExtension.name ] = extensionDef
        w.extensionsUsed[ multiLayerRoughnessGLTFExtension.name ] = true
    },
})

export const multiLayerRoughnessGLTFExtension = {
    name: 'WEBGI_materials_multi_layer_roughness',
    import: (p) => new GLTFMaterialsMultiLayerRoughnessExtensionImport(p),
    export: glTFMaterialsMultiLayerRoughnessExtensionExport,
    textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]
