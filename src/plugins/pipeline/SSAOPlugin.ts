import {
    LinearSRGBColorSpace,
    Matrix4,
    Texture,
    TextureDataType,
    UnsignedByteType,
    Vector2,
    Vector3,
    Vector4,
    WebGLRenderTarget,
} from 'three'
import {ExtendedShaderPass, IPassID, IPipelinePass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiConfig, uiFolderContainer, uiImage, uiSlider} from 'uiconfig.js'
import {ICamera, IMaterial, IRenderManager, IScene, IWebGLRenderer, PhysicalMaterial} from '../../core'
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
 * SSAO Plugin
 *
 * Adds Screen Space Ambient Occlusion (SSAO) to the scene.
 * Adds a pass to calculate AO, which is then read by materials in the render pass.
 * @category Plugins
 */
@uiFolderContainer('SSAO Plugin')
export class SSAOPlugin
    extends PipelinePassPlugin<SSAOPluginPass, 'ssao'> {

    readonly passId = 'ssao'
    public static readonly PluginType = 'SSAOPlugin'
    public static readonly OldPluginType = 'SSAO'

    dependencies = [GBufferPlugin]

    target?: SSAOPluginTarget
    @uiImage('SSAO Buffer', {readOnly: true, tags: ['debug']}) texture?: Texture

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: SSAOPluginPass

    // @onChange2(SSAOPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @onChange2(SSAOPlugin.prototype._createTarget)
    // @uiSlider('Buffer Size Multiplier', [0.25, 2.0], 0.25)
    readonly sizeMultiplier: number // cannot be changed after creation (for now)

    // @uiDropdown
    readonly packing: SSAOPacking // cannot be changed after creation (for now)

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
                saoBiasEpsilon: {value: new Vector3(1, 1, 1)},

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

    private _updateParameters() {
        // const projectionScale = 1 / (Math.tan(DEG2RAD * (camera as any).fov / 2) * 2);
        const saoData = this.material.uniforms.saoData.value
        // saoData.x = projectionScale;
        saoData.y = this.intensity
        saoData.z = this.occlusionWorldRadius
        // saoData.w = this.accIndex_++;

        const saoBiasEpsilon = this.material.uniforms.saoBiasEpsilon.value
        saoBiasEpsilon.x = this.bias
        saoBiasEpsilon.y = 0.001
        saoBiasEpsilon.z = this.falloff

        // this.material.uniforms.size.value.set(this._target.texture.image?.width, this._target.texture.image?.height)
    }

    beforeRender(_: IScene, camera: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        this.updateShaderProperties([camera, renderManager])
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
