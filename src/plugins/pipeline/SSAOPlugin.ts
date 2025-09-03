import {
    LinearSRGBColorSpace,
    MathUtils,
    Matrix4,
    Texture,
    TextureDataType,
    UnsignedByteType,
    Vector2,
    Vector4,
    WebGLRenderTarget,
} from 'three'
import {ExtendedShaderPass, IPassID, IPipelinePass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiConfig, uiFolderContainer, uiImage, uiSlider, uiToggle} from 'uiconfig.js'
import {
    ICamera,
    IMaterial,
    IRenderManager,
    IScene,
    IWebGLRenderer,
    PerspectiveCamera2,
    PhysicalMaterial,
} from '../../core'
import {getOrCall, glsl, onChange2, serialize, updateBit, ValOrFunc} from 'ts-browser-helpers'
import {MaterialExtension} from '../../materials'
import {shaderReplaceString, shaderUtils} from '../../utils'
import {getTexelDecoding, matDefine, matDefineBool, uniform} from '../../three'
import ssaoPass from './shaders/SSAOPlugin.pass.glsl'
import ssaoPatch from './shaders/SSAOPlugin.patch.glsl'
import {uiConfigMaterialExtension} from '../../materials/MaterialExtender'
import {GBufferPlugin} from './GBufferPlugin'
import {GBufferUpdaterContext} from './GBufferMaterial'

export type SSAOPluginTarget = WebGLRenderTarget

/**
 * SSAO Packing modes for different texture formats and use cases
 *
 * - **Mode 1**: `(r: ssao, gba: depth)` - SSAO in red channel, depth in green/blue/alpha
 * - **Mode 2**: `(rgb: ssao, a: 1)` - SSAO in RGB channels, alpha set to 1
 * - **Mode 3**: `(rgba: packed_ssao)` - Packed SSAO data across all RGBA channels
 * - **Mode 4**: `(rgb: packed_ssao, a: 1)` - Packed SSAO in RGB channels, alpha set to 1
 *
 * @remarks
 * Currently only modes 1 and 2 are fully supported in the shader implementation.
 * Modes 3 and 4 are available for future use but may require additional shader updates.
 */
export type SSAOPacking = 1 | 2 | 3 | 4

/**
 * Screen Space Ambient Occlusion (SSAO) Plugin for enhanced lighting and depth perception in 3D scenes.
 *
 * SSAO is a real-time ambient occlusion technique that approximates the soft shadows that occur in creases,
 * holes, and surfaces that are close to each other. This plugin adds a pre-render pass that calculates
 * ambient occlusion data which is then used by materials during the main render pass.
 *
 * ## Key Features
 * - **Real-time SSAO calculation** using screen-space techniques
 * - **Multiple packing modes** for different texture formats and optimization needs
 * - **Per-material control** - materials can disable SSAO individually via userData
 * - **Configurable quality settings** including sample count, radius, bias, and intensity
 * - **Automatic serialization** of all settings with viewer configuration
 * - **GBuffer integration** for optimized depth and normal data access
 *
 * ## Dependencies
 * This plugin automatically adds {@link GBufferPlugin} as a dependency for efficient depth and normal data.
 *
 * ## Usage Scenarios
 * - **Architectural visualization** - enhances depth perception in interior scenes
 * - **Product visualization** - adds realistic ambient shadows to showcase products
 * - **Game environments** - provides cost-effective ambient occlusion for real-time rendering
 * - **CAD visualization** - improves understanding of complex mechanical assemblies
 *
 * ## Performance Considerations
 * - Use lower `sizeMultiplier` values (0.5-0.75) for better performance on mobile devices
 * - Combine with {@link ProgressivePlugin} and `TemporalAAPlugin` for temporal accumulation
 * - Consider disabling SSAO on transparent or unlit materials to save processing
 *
 * @example Basic Usage
 * ```typescript
 * import {ThreeViewer, SSAOPlugin} from 'threepipe'
 *
 * const viewer = new ThreeViewer({
 *   plugins: [new SSAOPlugin()]
 * })
 *
 * // Access the plugin and configure settings
 * const ssaoPlugin = viewer.getPlugin(SSAOPlugin)!
 * ssaoPlugin.pass.intensity = 1.2
 * ssaoPlugin.pass.radius = 0.5
 * ```
 *
 * @example Per-Material Control
 * ```typescript
 * // Disable SSAO for a specific material
 * material.userData.ssaoDisabled = true
 *
 * // Disable SSAO casting (material won't contribute to AO calculation)
 * material.userData.ssaoCastDisabled = true
 * ```
 *
 * @example High Performance Setup
 * ```typescript
 * const ssaoPlugin = new SSAOPlugin(
 *   UnsignedByteType,  // Buffer type
 *   0.5,               // Size multiplier for better performance
 *   true,              // Enabled
 *   1                  // Packing mode
 * )
 * viewer.addPlugin(ssaoPlugin)
 * ```
 *
 * @category Plugins
 */
@uiFolderContainer('SSAO Plugin')
export class SSAOPlugin
    extends PipelinePassPlugin<SSAOPluginPass, 'ssao'> {

    readonly passId = 'ssao'
    public static readonly PluginType = 'SSAOPlugin'
    public static readonly OldPluginType = 'SSAO'

    /**
     * Plugin dependencies - automatically adds GBufferPlugin for depth and normal data
     * @internal
     */
    dependencies = [GBufferPlugin]

    /** The render target containing SSAO data */
    target?: SSAOPluginTarget

    /** Debug texture preview of the SSAO buffer (read-only) */
    @uiImage('SSAO Buffer', {readOnly: true, tags: ['debug']})
        texture?: Texture

    @uiConfig(undefined, {unwrapContents: true})
    declare protected _pass?: SSAOPluginPass

    /**
     * Buffer data type for the SSAO render target.
     * Cannot be changed after plugin creation.
     *
     * @remarks
     * - `UnsignedByteType` - Standard 8-bit precision, good performance
     * - `HalfFloatType` - 16-bit precision, better quality but slower
     * - `FloatType` - 32-bit precision, highest quality but slowest
     */
    readonly bufferType: TextureDataType

    /**
     * Render target size multiplier relative to the main canvas size.
     * Cannot be changed after plugin creation.
     *
     * @remarks
     * - `1.0` - Full resolution (highest quality)
     * - `0.75` - 75% resolution (good balance)
     * - `0.5` - Half resolution (better performance)
     * - `0.25` - Quarter resolution (mobile performance)
     */
    readonly sizeMultiplier: number

    /**
     * SSAO data packing mode for the render target.
     * Cannot be changed after plugin creation.
     *
     * @see {@link SSAOPacking} for available packing modes
     */
    readonly packing: SSAOPacking

    /**
     * Creates a new SSAOPlugin instance.
     *
     * @param bufferType - Data type for the SSAO buffer (default: UnsignedByteType)
     * @param sizeMultiplier - Size multiplier for the render target (default: 1.0)
     * @param enabled - Whether the plugin is initially enabled (default: true)
     * @param packing - SSAO data packing mode (default: 1)
     */
    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        sizeMultiplier = 1,
        enabled = true,
        packing: SSAOPacking = 1,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        this.sizeMultiplier = sizeMultiplier
        this.packing = packing
    }

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<SSAOPluginTarget>(
                {
                    depthBuffer: false,
                    type: this.bufferType,
                    sizeMultiplier: this.sizeMultiplier,
                    // magFilter: NearestFilter,
                    // minFilter: NearestFilter,
                    // generateMipmaps: false,
                    // encoding: LinearEncoding,
                    colorSpace: LinearSRGBColorSpace,
                })

        this.texture = this.target.texture
        this.texture.name = 'ssaoBuffer'

        // if (this._pass) this._pass.target = this.target
    }

    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this.texture = undefined
    }

    private _gbufferUnpackExtension = undefined as MaterialExtension|undefined
    private _gbufferUnpackExtensionChanged = ()=>{
        if (!this._pass || !this._viewer) throw new Error('SSAOPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this._pass.material.unregisterMaterialExtensions([this._gbufferUnpackExtension])
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this._pass.material.registerMaterialExtensions([this._gbufferUnpackExtension])
        else this._viewer.console.warn('SSAOPlugin: GBuffer unpack extension removed')
    }

    protected _createPass() {
        if (!this._viewer) throw new Error('SSAOPlugin: viewer not set')
        if (!this._viewer.renderManager.gbufferTarget || !this._viewer.renderManager.gbufferUnpackExtension)
            throw new Error('SSAOPlugin: GBuffer target not created. GBufferPlugin or DepthBufferPlugin is required.')
        this._createTarget(true)
        return new SSAOPluginPass(this.passId, ()=>this.target, this.packing)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.forPlugin(GBufferPlugin, (gbuffer) => {
            gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
        }, (gbuffer)=>{
            gbuffer.unregisterGBufferUpdater(this.constructor.PluginType)
        }, this)
        this._gbufferUnpackExtensionChanged()
        viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        return super.onRemove(viewer)
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // legacy
        if (data.passes?.ssao) {
            data = {...data}
            data.pass = data.passes.ssao
            delete data.passes
            if (data.pass.enabled !== undefined) data.enabled = data.pass.enabled
        }
        return super.fromJSON(data, meta)
    }

    updateGBufferFlags(data: Vector4, c: GBufferUpdaterContext): void {
        if (!c.material || !c.material.userData) return
        const disabled = c.material.userData.ssaoCastDisabled || c.material.userData.pluginsDisabled
        const x = disabled ? 0 : 1
        data.w = updateBit(data.w, 3, x)

        if (disabled && this._pass) this._pass.checkGBufferFlag = true
    }
    /**
     * @deprecated use {@link target} instead
     */
    get aoTarget() {
        console.warn('SSAOPlugin: aoTarget is deprecated, use target instead')
        return this.target
    }

}

@uiFolderContainer('SSAO Pass')
export class SSAOPluginPass extends ExtendedShaderPass implements IPipelinePass {
    before = ['render']
    after = ['gbuffer', 'depth']
    required = ['render'] // gbuffer required check done in plugin.

    // todo bilateralPass
    // @serialize() readonly bilateralPass: BilateralFilterPass

    // todo old deserialize
    // @serialize() readonly parameters: SSAOParams = {
    //     intensity: 0.25,
    //     occlusionWorldRadius: 1,
    //     bias: 0.001,
    //     falloff: 1.3,
    // }
    @serialize()
    @uiSlider('Intensity', [0, 4], 0.0001)
    @onChange2(SSAOPluginPass.prototype.setDirty)
        intensity = 0.25

    @serialize()
    @uiSlider('Occlusion World Radius', [0.1, 8], 0.01)
    @onChange2(SSAOPluginPass.prototype.setDirty)
        occlusionWorldRadius = 1

    /**
     * Whether to automatically adapt the occlusion radius based on the scene size.
     * This is useful when scene is not centered or normalized
     */
    @serialize()
    @onChange2(SSAOPluginPass.prototype.setDirty)
    @uiToggle()
        autoRadius = false

    @serialize()
    @uiSlider('Bias', [0.00001, 0.01], 0.00001)
    @onChange2(SSAOPluginPass.prototype.setDirty)
        bias = 0.001

    @serialize()
    @uiSlider('Falloff', [0.01, 3], 0.01)
    @onChange2(SSAOPluginPass.prototype.setDirty)
        falloff = 1.3

    @serialize()
    @uiSlider('Num Samples', [1, 11], 1, {tags: ['performance']})
    @matDefine('NUM_SAMPLES', undefined, undefined, SSAOPluginPass.prototype.setDirty)
        numSamples = 8

    /**
     * Whether to check for gbuffer flag or not. This is used to disable SSAO casting by some objects. its enabled automatically by the SSAOPlugin when required.
     * This is disabled by default so that we dont read texture for no reason.
     */
    @matDefineBool('CHECK_GBUFFER_FLAG')
        checkGBufferFlag = false

    // todo after bilateralPass is implemented
    // @bindToValue({obj: 'bilateralPass', key: 'enabled', onChange: 'setDirty'})
    // smoothEnabled = true
    // todo after bilateralPass is implemented
    // @bindToValue({obj: 'bilateralPass', key: 'enabled', onChange: 'setDirty'})
    // smoothEdgeSharpness = true

    @uiSlider('Split', [0, 1], 0.01, {tags: ['debug']})
    @serialize() @uniform({propKey: 'ssaoSplitX', onChange: SSAOPluginPass.prototype.setDirty})
        split = 0

    constructor(public readonly passId: IPassID, public target?: ValOrFunc<WebGLRenderTarget|undefined>, packing: SSAOPacking = 1) {
        super({
            defines: {
                ['LINEAR_DEPTH']: 1, // todo set from unpack extension
                ['NUM_SAMPLES']: 11,
                ['NUM_SPIRAL_TURNS']: 3,
                ['SSAO_PACKING']: packing, // 1 is (r: ssao, gba: depth), 2 is (rgb: ssao, a: 1), 3 is (rgba: packed_ssao), 4 is (rgb: packed ssao, a: 1)
                ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
                ['CHECK_GBUFFER_FLAG']: 0,
            },
            uniforms: {
                // tLastThis: {value: null},
                screenSize: {value: new Vector2(0, 0)}, // set in ExtendedRenderMaterial
                saoData: {value: new Vector4()},
                frameCount: {value: 0}, // set in RenderManager
                cameraNearFar: {value: new Vector2(0.1, 1000)}, // set in PerspectiveCamera2
                projection: {value: new Matrix4()}, // set in PerspectiveCamera2
                saoBiasEpsilon: {value: new Vector4(1, 1, 1, 1)},
                sceneBoundingRadius: {value: 0},

                // split mode
                ssaoSplitX: {value: 0.5},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: ssaoPass,

        }, 'tDiffuse') // why is tLastThis not here. because encoding and size doesnt matter?

        this.needsSwap = false
        this.clear = true
        // this.bilateralPass = new BilateralFilterPass(this._target as any, gBufferUnpack, 'rrrr')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4((1.0-b.r) * a.xyz, a.a);')
        // this._getUiConfig = this._getUiConfig.bind(this)
    }

    copyToWriteBuffer = false

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        this.needsSwap = false
        if (!this.enabled) return

        const target = getOrCall(this.target)
        if (!target) {
            console.warn('SSAOPluginPass: target not defined')
            return
        }
        this._updateParameters()
        // if (!this.material.defines.HAS_GBUFFER) {
        //     console.warn('SSAOPluginPass: DepthNormalBuffer required for ssao')
        // }

        // tLastThis is not used anymore. the ssao is merged across frames with progressive plugin
        // renderer.renderManager.blit(writeBuffer, {
        //     source: target.texture,
        //     respectColorSpace: true,
        // })
        // this.uniforms.tLastThis.value = writeBuffer.texture
        super.render(renderer, target, readBuffer, deltaTime, maskActive)

        // todo
        // if (this.smoothEnabled) {
        //     this.bilateralPass.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        // }

        if (this.copyToWriteBuffer) {
            renderer.renderManager.blit(writeBuffer, {
                source: target.texture,
                respectColorSpace: true,
            })
            this.needsSwap = true
        }

    }

    private _projScale = 1
    private _updateParameters() {
        // const projectionScale = 1 / (Math.tan(DEG2RAD * (camera as any).fov / 2) * 2);
        const saoData = this.material.uniforms.saoData.value
        // saoData.x = projectionScale;
        saoData.y = this.intensity
        saoData.z = this.occlusionWorldRadius
        // saoData.w = this.accIndex_++;

        saoData.z *= this._projScale * 0.25//* 100 / 2

        const saoBiasEpsilon = this.material.uniforms.saoBiasEpsilon.value
        saoBiasEpsilon.x = this.bias
        saoBiasEpsilon.y = 0.001
        saoBiasEpsilon.z = this.falloff

        if (this.autoRadius) {
            saoBiasEpsilon.w = Math.min(this.material.uniforms.sceneBoundingRadius.value, 100)
        } else {
            saoBiasEpsilon.w = 1
        }

        // this.material.uniforms.size.value.set(this._target.texture.image?.width, this._target.texture.image?.height)
    }

    beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        this.updateShaderProperties([camera, renderManager, scene])
        const fov = Math.max(1, (scene.mainCamera as PerspectiveCamera2).fov ?? 1)
        const h = renderManager?.webglRenderer.domElement.height || 1
        const w = 1 // renderManager?.webglRenderer.domElement.width || 1
        this._projScale = h / (2 * w * Math.tan(0.5 * fov * MathUtils.DEG2RAD))
    }

    readonly materialExtension: MaterialExtension = {
        extraUniforms: {
            tSSAOMap: ()=>({value: getOrCall(this.target)?.texture ?? null}),
            ssaoSplitX: this.material.uniforms.ssaoSplitX,
        },
        shaderExtender: (shader, _material, _renderer) => {
            if (!shader.defines?.SSAO_ENABLED) return
            // todo: only SSAO_PACKING = 1 and 2 are supported. Not 3 and 4 right now.
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <aomap_fragment>', ssaoPatch)
        },
        onObjectRender: (_object, material, renderer: any) => {
            // const opaque = !material.transparent && (!material.transmission || material.transmission < 0.001)
            const x: any = this.enabled && // opaque &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.pluginsDisabled &&
            !material.userData?.ssaoDisabled ? this.split > 0 ? 2 : 1 : 0

            if (material.defines!.SSAO_ENABLED !== x) {
                material.defines!.SSAO_ENABLED = x
                material.needsUpdate = true
            }
        },
        parsFragmentSnippet: ()=>glsl`
             uniform sampler2D tSSAOMap;
            #if defined(SSAO_ENABLED) && SSAO_ENABLED == 2
            uniform float ssaoSplitX;
            #endif
             ${getTexelDecoding('tSSAOMap', getOrCall(this.target)?.texture.colorSpace)}
             #include <simpleCameraHelpers>
        `,
        computeCacheKey: () => {
            return (this.enabled ? '1' : '0') + getOrCall(this.target)?.texture?.colorSpace
        },
        uuid: SSAOPlugin.PluginType,
        ...uiConfigMaterialExtension(this._getUiConfig.bind(this), SSAOPlugin.PluginType),
        isCompatible: material => {
            return (material as PhysicalMaterial).isPhysicalMaterial
        },
    }

    /**
     * Returns a uiConfig to toggle SSAO on a material.
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    protected _getUiConfig(material: IMaterial) {
        return {
            type: 'folder',
            label: 'SSAO',
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return !(material.userData.ssaoDisabled ?? false)
                    },
                    set value(v) {
                        if (v === !(material.userData.ssaoDisabled ?? false)) return
                        material.userData.ssaoDisabled = !v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
                {
                    type: 'checkbox',
                    label: 'Cast SSAO',
                    get value() {
                        return !(material.userData.ssaoCastDisabled ?? false)
                    },
                    set value(v) {
                        if (v === !(material.userData.ssaoCastDisabled ?? false)) return
                        material.userData.ssaoCastDisabled = !v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
            ],
        }
    }

}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        /**
         * Disable SSAOPlugin for this material.
         */
        ssaoDisabled?: boolean
        /**
         * Cast SSAO on other objects.
         * if casting is not working when this is false, ensure render to depth is true, like for transparent objects
         */
        ssaoCastDisabled?: boolean
    }
}
