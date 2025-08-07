import {Vector2, Vector2Tuple, Vector3, Vector3Tuple, Vector4, Vector4Tuple} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {IMaterial, IMaterialUserData, IObject3D, PhysicalMaterial} from '../../core'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {shaderReplaceString, ThreeSerialization} from '../../utils'
import {AssetManager, GLTFWriter2} from '../../assetmanager'
import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import NoiseBumpMaterialPluginPars from './shaders/NoiseBumpMaterialPlugin.pars.glsl'
import NoiseBumpMaterialPluginPatch from './shaders/NoiseBumpMaterialPlugin.patch.glsl'

/**
 * NoiseBump Materials Extension
 * Adds a material extension to PhysicalMaterial to add support for sparkle bump / noise bump by creating procedural bump map from noise to simulate sparkle flakes.
 * It uses voronoise function from blender along with several additions to generate the noise for the generation.
 * It also adds a UI to the material to edit the settings.
 * It uses WEBGI_materials_noise_bump glTF extension to save the settings in glTF files.
 * @category Plugins
 */
@uiFolderContainer('Noise/Sparkle Bump (MatExt)')
export class NoiseBumpMaterialPlugin extends AViewerPluginSync {
    static readonly PluginType = 'NoiseBumpMaterialPlugin'

    @uiToggle('Enabled', (that: NoiseBumpMaterialPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    // private _defines: any = {
    // }
    private _uniforms: any = {
        noiseBumpParams: {value: new Vector2()}, // u scale, v scale,
        noiseBumpScale: {value: 0.05},
        noiseBumpFlakeScale: {value: 1000.0},
        noiseFlakeClamp: {value: 1.0},
        noiseFlakeRadius: {value: 0.5},
        flakeParams: {value: new Vector4(0, 1, 3, 0)},
        flakeFallOffParams: {value: new Vector3(0, 1, 0)},
        useColorFlakes: {value: false},
    }

    public static AddNoiseBumpMaterial(material: IMaterial, params?: IMaterialUserData['_noiseBumpMat']): boolean {
        const ud = material?.userData
        if (!ud) return false
        if (!ud._noiseBumpMat) {
            ud._noiseBumpMat = {}
        }
        const tf = ud._noiseBumpMat
        tf.hasBump = true
        if (tf.bumpNoiseParams === undefined) tf.bumpNoiseParams = new Vector2(0.5, 0.5)
        if (tf.bumpScale === undefined) tf.bumpScale = 0.05
        if (tf.flakeScale === undefined) tf.flakeScale = 0.05
        if (tf.flakeClamp === undefined) tf.flakeClamp = 1
        if (tf.flakeRadius === undefined) tf.flakeRadius = 0.3
        if (tf.useColorFlakes === undefined) tf.useColorFlakes = false
        if (tf.flakeParams === undefined) tf.flakeParams = new Vector4(0, 1, 3, 0)
        if (tf.flakeFallOffParams === undefined) tf.flakeFallOffParams = new Vector3(0, 1, 0)
        params && Object.assign(tf, params)
        if (material.setDirty) material.setDirty()
        return true
    }

    readonly materialExtension: MaterialExtension = {
        parsFragmentSnippet: (_, material: PhysicalMaterial)=>{
            if (this.isDisabled() || !material?.userData._noiseBumpMat?.hasBump) return ''
            return NoiseBumpMaterialPluginPars
        },
        shaderExtender: (shader, material: PhysicalMaterial) => {
            if (this.isDisabled() || !material?.userData._noiseBumpMat?.hasBump) return
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#glMarker beforeAccumulation', NoiseBumpMaterialPluginPatch, {prepend: true})
            shader.defines && (shader.defines.USE_UV = '')
            shader.extensionDerivatives = true
        },
        onObjectRender: (_: IObject3D, material) => {
            const tfUd = material.userData._noiseBumpMat
            if (!tfUd?.hasBump) return

            if (Array.isArray(tfUd.bumpNoiseParams)) this._uniforms.noiseBumpParams.value.fromArray(tfUd.bumpNoiseParams)
            else this._uniforms.noiseBumpParams.value.copy(tfUd.bumpNoiseParams)
            this._uniforms.noiseBumpScale.value = tfUd.bumpScale
            this._uniforms.noiseBumpFlakeScale.value = tfUd.flakeScale
            this._uniforms.noiseFlakeClamp.value = tfUd.flakeClamp
            this._uniforms.noiseFlakeRadius.value = tfUd.flakeRadius
            if (Array.isArray(tfUd.flakeParams)) this._uniforms.flakeParams.value.fromArray(tfUd.flakeParams)
            else this._uniforms.flakeParams.value.copy(tfUd.flakeParams)
            if (Array.isArray(tfUd.flakeFallOffParams)) this._uniforms.flakeFallOffParams.value.fromArray(tfUd.flakeFallOffParams)
            else this._uniforms.flakeFallOffParams.value.copy(tfUd.flakeFallOffParams)
            this._uniforms.useColorFlakes.value = tfUd.useColorFlakes

            updateMaterialDefines({
                // ...this._defines,
                ['NOISE_BUMP_MATERIAL_ENABLED']: +!this.isDisabled(),
            }, material)
        },
        extraUniforms: {
            // ...this._uniforms, // done in constructor
        },
        computeCacheKey: (material1: PhysicalMaterial) => {
            return (this.isDisabled() ? '0' : '1') + (material1.userData._noiseBumpMat?.hasBump ? '1' : '0')
        },
        isCompatible: (material1: PhysicalMaterial) => material1.isPhysicalMaterial,
        getUiConfig: material => { // todo use uiConfigMaterialExtension
            const viewer = this._viewer!
            if (material.userData._noiseBumpMat === undefined) material.userData._noiseBumpMat = {}
            const state = material.userData._noiseBumpMat
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'SparkleBump (NoiseBump)',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state.hasBump || false
                        },
                        set value(v) {
                            if (v === state.hasBump) return
                            if (v) {
                                if (!NoiseBumpMaterialPlugin.AddNoiseBumpMaterial(material))
                                    viewer.dialog.alert('Cannot add NoiseBumpMaterial.')
                            } else {
                                state.hasBump = false
                                if (material.setDirty) material.setDirty()
                            }
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'vec4',
                        label: 'Bump Noise Params',
                        bounds: [0, 1],
                        hidden: () => !state.hasBump,
                        property: [state, 'bumpNoiseParams'],
                    },
                    {
                        type: 'slider',
                        label: 'Bump Scale',
                        bounds: [0, 0.001],
                        stepSize: 0.00001,
                        hidden: () => !state.hasBump,
                        property: [state, 'bumpScale'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Scale',
                        bounds: [100, 10000],
                        stepSize: 0.0001,
                        hidden: () => !state.hasBump,
                        property: [state, 'flakeScale'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Clamp',
                        bounds: [0, 1],
                        stepSize: 1,
                        hidden: () => !state.hasBump,
                        property: [state, 'flakeClamp'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Radius',
                        bounds: [0.01, 1],
                        stepSize: 0.001,
                        hidden: () => !state.hasBump,
                        property: [state, 'flakeRadius'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Roughness',
                        bounds: [0., 1],
                        stepSize: 0.01,
                        hidden: () => !state.hasBump,
                        property: [state.flakeParams, 'x'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Metalness',
                        bounds: [0., 1],
                        stepSize: 0.01,
                        hidden: () => !state.hasBump,
                        property: [state.flakeParams, 'y'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Strength',
                        bounds: [0.0, 100],
                        stepSize: 0.001,
                        hidden: () => !state.hasBump,
                        property: [state.flakeParams, 'z'],
                    },
                    {
                        type: 'slider',
                        label: 'Flake Threshold',
                        bounds: [0.1, 10],
                        stepSize: 0.001,
                        hidden: () => !state.hasBump,
                        property: [state.flakeParams, 'w'],
                    },
                    {
                        type: 'slider',
                        label: 'Falloff',
                        stepSize: 1,
                        bounds: [0, 1],
                        hidden: () => !state.hasBump,
                        property: [state.flakeFallOffParams, 'x'],
                    },
                    {
                        type: 'slider',
                        label: 'Linear falloff factor',
                        bounds: [0., 10],
                        stepSize: 0.001,
                        hidden: () => !state.hasBump,
                        property: [state.flakeFallOffParams, 'y'],
                    },
                    {
                        type: 'slider',
                        label: 'Quadratic falloff factor',
                        bounds: [0., 10],
                        stepSize: 0.001,
                        hidden: () => !state.hasBump,
                        property: [state.flakeFallOffParams, 'z'],
                    },
                    {
                        type: 'checkbox',
                        label: 'Colored Flakes',
                        hidden: () => !state.hasBump,
                        property: [state, 'useColorFlakes'],
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
        v.assetManager.registerGltfExtension(noiseBumpMaterialGLTFExtension)
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        v.assetManager.unregisterGltfExtension(noiseBumpMaterialGLTFExtension.name)
        return super.onRemove(v)
    }

    /**
     * @deprecated - use {@link noiseBumpMaterialGLTFExtension}
     */
    public static readonly NOISE_BUMP_MATERIAL_GLTF_EXTENSION = 'WEBGI_materials_noise_bump'

}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        _noiseBumpMat?: {
            hasBump?: boolean
            bumpNoiseParams?: Vector2Tuple | Vector2
            bumpScale?: number
            flakeScale?: number
            flakeClamp?: number
            flakeRadius?: number
            useColorFlakes?: boolean
            flakeParams?: Vector4Tuple | Vector4
            flakeFallOffParams?: Vector3Tuple | Vector3
        }
    }
}

/**
 * FragmentClipping Materials Extension
 *
 * Specification: https://threepipe.org/docs/gltf-extensions/WEBGI_materials_fragment_clipping_extension.html (todo - fix link)
 */
class GLTFMaterialsNoiseBumpMaterialImport implements GLTFLoaderPlugin {
    public name: string
    public parser: GLTFParser

    constructor(parser: GLTFParser) {
        this.parser = parser
        this.name = noiseBumpMaterialGLTFExtension.name
    }

    async extendMaterialParams(materialIndex: number, materialParams: any) {
        const parser = this.parser
        const materialDef = parser.json.materials[materialIndex]
        if (!materialDef.extensions || !materialDef.extensions[this.name]) return
        const extension = materialDef.extensions[this.name]
        if (!materialParams.userData) materialParams.userData = {}
        NoiseBumpMaterialPlugin.AddNoiseBumpMaterial(materialParams)
        ThreeSerialization.Deserialize(extension, materialParams.userData._noiseBumpMat)
    }
}

const glTFMaterialsNoiseBumpMaterialExport = (w: GLTFWriter2)=> ({
    writeMaterial: (material: any, materialDef: any) => {
        if (!material.isMeshStandardMaterial || !material.userData._noiseBumpMat?.hasBump) return
        materialDef.extensions = materialDef.extensions || {}

        const extensionDef: any = ThreeSerialization.Serialize(material.userData._noiseBumpMat)

        materialDef.extensions[ noiseBumpMaterialGLTFExtension.name ] = extensionDef
        w.extensionsUsed[ noiseBumpMaterialGLTFExtension.name ] = true
    },
})

export const noiseBumpMaterialGLTFExtension = {
    name: 'WEBGI_materials_noise_bump',
    import: (p) => new GLTFMaterialsNoiseBumpMaterialImport(p),
    export: glTFMaterialsNoiseBumpMaterialExport,
    textures: undefined,
} satisfies AssetManager['gltfExtensions'][number]

