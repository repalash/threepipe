import {Matrix4, Texture, TextureDataType, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget} from 'three'
import {ExtendedShaderPass, IPassID, IPipelinePass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiConfig, uiFolderContainer, uiImage, uiSlider} from 'uiconfig.js'
import {ICamera, IMaterial, IRenderManager, IScene, IWebGLRenderer, PhysicalMaterial} from '../../core'
import {getOrCall, glsl, onChange2, serialize, ValOrFunc} from 'ts-browser-helpers'
import {MaterialExtension} from '../../materials'
import {shaderReplaceString, shaderUtils} from '../../utils'
import {getTexelDecoding, matDefine} from '../../three'
import ssaoPass from './shaders/SSAOPlugin.pass.glsl'
import ssaoPatch from './shaders/SSAOPlugin.patch.glsl'
import {uiConfigMaterialExtension} from '../../materials/MaterialExtender'
import {GBufferPlugin} from './GBufferPlugin'

export type SSAOPluginEventTypes = ''
export type SSAOPluginTarget = WebGLRenderTarget

/**
 * SSAO Plugin
 *
 * Adds a post-render pass to blend the last frame with the current frame.
 * This can be used to create a progressive rendering effect which is useful for progressive shadows, gi, denoising, baking, anti-aliasing, and many other effects.
 * @category Plugins
 */
@uiFolderContainer('SSAO Plugin')
export class SSAOPlugin
    extends PipelinePassPlugin<SSAOPluginPass, 'ssao', SSAOPluginEventTypes> {

    readonly passId = 'ssao'
    public static readonly PluginType = 'SSAOPlugin'

    dependencies = [GBufferPlugin]

    target?: SSAOPluginTarget
    @uiImage('SSAO Buffer' /* {readOnly: true}*/) texture?: Texture

    @uiConfig() protected _pass?: SSAOPluginPass

    // @onChange2(SSAOPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @onChange2(SSAOPlugin.prototype._createTarget)
    // @uiSlider('Buffer Size Multiplier', [0.25, 2.0], 0.25)
    readonly sizeMultiplier: number // cannot be changed after creation (for now)

    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        sizeMultiplier = 1,
        enabled = true,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        this.sizeMultiplier = sizeMultiplier
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
                })

        this.texture = this.target.texture
        this.texture.name = 'ssaoBuffer'

        if (this._pass) this._pass.target = this.target
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
        const pass = new SSAOPluginPass(this.passId, this.target)
        pass.before = ['render']
        pass.after = ['gbuffer', 'depth']
        pass.required = ['render'] // gbuffer required check above.
        return pass
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._gbufferUnpackExtensionChanged()
        viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        return super.onRemove(viewer)
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
    before = ['screen']
    after = ['render']
    required = ['render']

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
    @uiSlider('Intensity', [0, 4], 0.01)
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
    @uiSlider('Num Samples', [1, 11], 1)
    @matDefine('NUM_SAMPLES', undefined, undefined, SSAOPluginPass.prototype.setDirty)
        numSamples = 8

    // todo after bilateralPass is implemented
    // @bindToValue({obj: 'bilateralPass', key: 'enabled', onChange: 'setDirty'})
    // smoothEnabled = true
    // todo after bilateralPass is implemented
    // @bindToValue({obj: 'bilateralPass', key: 'enabled', onChange: 'setDirty'})
    // smoothEdgeSharpness = true

    constructor(public readonly passId: IPassID, public target?: ValOrFunc<WebGLRenderTarget|undefined>) {
        super({
            defines: {
                ['LINEAR_DEPTH']: 1, // todo set from unpack extension
                ['NUM_SAMPLES']: 11,
                ['NUM_SPIRAL_TURNS']: 3,
                ['SSAO_PACKING']: 1, // 1 is (r: ssao, gba: depth), 2 is (rgb: ssao, a: 1), 3 is (rgba: packed_ssao), 4 is (rgb: packed_ssao, a: 1)
                ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
            },
            uniforms: {
                tLastThis: {value: null},
                screenSize: {value: new Vector2(0, 0)}, // set in ExtendedRenderMaterial
                saoData: {value: new Vector4()},
                frameCount: {value: 0}, // set in RenderManager
                cameraNearFar: {value: new Vector2(0.1, 1000)}, // set in PerspectiveCamera2
                projection: {value: new Matrix4()}, // set in PerspectiveCamera2
                saoBiasEpsilon: {value: new Vector3(1, 1, 1)},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: ssaoPass,

        }, 'tDiffuse')

        this.needsSwap = false
        this.clear = true
        // this.bilateralPass = new BilateralFilterPass(this._target as any, gBufferUnpack, 'rrrr')
        // this._multiplyPass = new GenericBlendTexturePass(this._target.texture as any, 'c = vec4((1.0-b.r) * a.xyz, a.a);')
    }

    render(renderer: IWebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (!this.enabled) return
        const target = getOrCall(this.target)
        if (!target) {
            console.warn('SSAOPluginPass: target not defined')
            return
        }
        this._updateParameters()
        if (!this.material.defines.HAS_GBUFFER) {
            console.warn('SSAOPluginPass: DepthNormalBuffer required for ssao')
        }
        renderer.renderManager.blit(writeBuffer, {
            source: target.texture,
        })
        this.uniforms.tLastThis.value = writeBuffer.texture
        super.render(renderer, target, readBuffer, deltaTime, maskActive)

        // todo
        // if (this.smoothEnabled) {
        //     this.bilateralPass.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
        // }
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
        },
        shaderExtender: (shader, _material, _renderer) => {
            if (!shader.defines.SSAO_ENABLED) return
            // todo: only SSAO_PACKING = 1 and 2 is supported. Not 3 and 4 right now.
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <aomap_fragment>', ssaoPatch)
        },
        onObjectRender: (_object, material, renderer: any) => {
            const opaque = !material.transparent && (!material.transmission || material.transmission < 0.001)
            const x: any = this.enabled && opaque &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.ssaoDisabled ? 1 : 0

            if (material.defines!.SSAO_ENABLED !== x) {
                material.defines!.SSAO_ENABLED = x
                material.needsUpdate = true
            }
        },
        parsFragmentSnippet: (renderer)=>glsl`
             uniform sampler2D tSSAOMap;
             ${getTexelDecoding('tSSAOMap', getOrCall(this.target)?.texture, renderer!.capabilities.isWebGL2)}
             #include <simpleCameraHelpers>
        `,
        computeCacheKey: () => {
            return this.enabled ? '1' : '0' + getOrCall(this.target)?.texture?.colorSpace
        },
        uuid: SSAOPlugin.PluginType,
        ...uiConfigMaterialExtension(this._getUiConfig, SSAOPlugin.PluginType),
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
    }
}
