import {
    ClampToEdgeWrapping,
    Color,
    DepthTexture,
    FloatType,
    IUniform,
    NoBlending,
    ShaderMaterialParameters,
    Texture,
    TextureDataType,
    UnsignedByteType,
    UnsignedIntType,
    UnsignedShortType,
    WebGLMultipleRenderTargets,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer, ViewerRenderManager} from '../../viewer'
import {MaterialExtension} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiFolderContainer, uiImage} from 'uiconfig.js'
import {shaderReplaceString} from '../../utils'
import GBufferUnpack from './shaders/GBufferPlugin.unpack.glsl'
import {ICamera, IMaterialParameters, IObject3D, IRenderManager, IScene, ITexture} from '../../core'
import {GBufferMaterial, GBufferUpdater} from './GBufferMaterial'

export type GBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
// export type GBufferPluginTarget = WebGLRenderTarget
export type GBufferPluginPass = GBufferRenderPass<'gbuffer', GBufferPluginTarget|undefined>

/**
 * G-Buffer Plugin
 *
 * Adds a pre-render pass to render the g-buffer(depth+normal+flags) to render target(s) that can be used as gbuffer and for postprocessing.
 * @category Plugins
 */
@uiFolderContainer('G-Buffer Plugin')
export class GBufferPlugin
    extends PipelinePassPlugin<GBufferPluginPass, 'gbuffer'> {

    readonly passId = 'gbuffer'
    public static readonly PluginType = 'GBuffer'

    target?: GBufferPluginTarget

    // @uiConfig({readOnly: true}) //  todo: fix bug in uiconfig or tpImageGenerator because of which 0 index is not showing in the UI, when we uncomment this
    textures: Texture[] = []

    @uiImage(undefined, {readOnly: true})
    get normalDepthTexture(): ITexture|undefined {
        return this.textures[0]
    }

    @uiImage(undefined, {readOnly: true})
    get flagsTexture(): ITexture|undefined {
        return this.textures[1]
    }

    @uiImage(undefined, {readOnly: true})
    get depthTexture(): (ITexture&DepthTexture)|undefined {
        return this.target?.depthTexture
    }

    // @uiConfig() // not supported in this material yet
    material?: GBufferMaterial

    // @onChange(GBufferPlugin.prototype._depthPackingChanged)
    // @uiDropdown('Depth Packing', threeConstMappings.DepthPackingStrategies.uiConfig) packing: DepthPackingStrategies

    // @onChange2(GBufferPlugin.prototype._createTargetAndMaterial)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @uiToggle()
    // @onChange2(GBufferPlugin.prototype._createTargetAndMaterial)
    readonly isPrimaryGBuffer: boolean // cannot be changed after creation (for now)

    // protected _depthPackingChanged() {
    //     this.material.depthPacking = this.depthPacking
    //     this.material.needsUpdate = true
    //     if (this.unpackExtension && this.unpackExtension.extraDefines) {
    //         this.unpackExtension.extraDefines.DEPTH_PACKING = this.depthPacking
    //         this.unpackExtension.setDirty?.()
    //     }
    //     this.setDirty()
    // }

    unpackExtension: MaterialExtension = {
        /**
         * Use this in shader to get the snippet
         * ```
         * // for gbuffer
         * #include <packing>
         * #define THREE_PACKING_INCLUDED
         * ```
         * or if you don't need packing include
         * ```
         * #include <gbuffer_unpack>
         * ```
         * @param shader
         */
        shaderExtender: (shader)=>{
            const includes = ['gbuffer_unpack', 'packing'] as const
            const include = includes.find(i=>shader.fragmentShader.includes(`#include <${i}>`))
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                `#include <${include}>`,
                '\n' + GBufferUnpack + '\n', {append: include === 'packing'})
        },
        extraUniforms: {
            tNormalDepth: ()=>({value: this.normalDepthTexture}),
            tGBufferFlags: ()=>({value: this.flagsTexture}),
            tGBufferDepthTexture: ()=>({value: this.depthTexture}),
        },
        extraDefines: {
            // ['GBUFFER_PACKING']: BasicDepthPacking,
            ['HAS_NORMAL_DEPTH_BUFFER']: ()=>this.normalDepthTexture ? 1 : undefined,
            ['GBUFFER_HAS_DEPTH_TEXTURE']: ()=>this.depthTexture ? 1 : undefined,
            ['GBUFFER_HAS_FLAGS']: ()=>this.flagsTexture ? 1 : undefined,
            // ['HAS_FLAGS_BUFFER']: ()=>this.flagsTexture ? 1 : undefined,
            ['HAS_GBUFFER']: ()=>this.isPrimaryGBuffer && this.normalDepthTexture ? 1 : undefined,
            // LINEAR_DEPTH: 1, // to tell that the depth is linear. todo; see SSAOPlugin. also add support in DepthBufferPlugin?
        },
        priority: 100,
        isCompatible: () => true,
    }

    createMaterial() {
        const useMultiple = this._viewer?.renderManager.isWebGL2 && this.renderFlagsBuffer
        return new GBufferMaterial(useMultiple, {
            blending: NoBlending,
            transparent: true,
        })
    }

    private _isPrimaryGBufferSet = false
    protected _createTargetAndMaterial(recreateTarget = true) {
        if (!this._viewer) return
        if (recreateTarget) this._disposeTarget()
        const useMultiple = this._viewer?.renderManager.isWebGL2 && this.renderFlagsBuffer
        if (!this.target) {
            const rm = this._viewer.renderManager
            this.target = this._viewer.renderManager.createTarget<GBufferPluginTarget>(
                {
                    depthBuffer: true,
                    samples: this._viewer.renderManager.zPrepass && this.isPrimaryGBuffer && rm.msaa ? // requirement for zPrepass
                        typeof rm.msaa !== 'number' ? ViewerRenderManager.DEFAULT_MSAA_SAMPLES : rm.msaa : 0,
                    type: this.bufferType,
                    textureCount: useMultiple ? 2 : 1,
                    depthTexture: this.renderDepthTexture,
                    depthTextureType: this.depthTextureType,
                    // magFilter: NearestFilter,
                    // minFilter: NearestFilter,
                    // generateMipmaps: false,
                    // encoding: LinearEncoding,
                    wrapS: ClampToEdgeWrapping,
                    wrapT: ClampToEdgeWrapping,
                })
            if (Array.isArray(this.target.texture)) {
                this.target.texture[0].name = 'gbufferDepthNormal'
                this.target.texture[1].name = 'gbufferFlags'
                this.textures = this.target.texture

                // todo flag buffer filtering?
                // const flagTexture = this.flagsTexture
                // flagTexture.generateMipmaps = false
                // flagTexture.minFilter = NearestFilter
                // flagTexture.magFilter = NearestFilter

            } else {
                this.target.texture.name = 'gbufferDepthNormal'
                this.textures.push(this.target.texture)
            }
        }

        if (!this.material) {
            this.material = this.createMaterial()
        }

        // if (this._pass) this._pass.target = this.target

        if (this.isPrimaryGBuffer) {
            this._viewer.renderManager.gbufferTarget = this.target
            this._viewer.renderManager.gbufferUnpackExtension = this.unpackExtension
            this._viewer.renderManager.screenPass.material.registerMaterialExtensions([this.unpackExtension])
            this._isPrimaryGBufferSet = true
        }
    }

    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this.textures = []
        if (this._isPrimaryGBufferSet) { // using a separate flag as when isPrimaryGBuffer is changed, we cannot check it.
            this._viewer.renderManager.gbufferTarget = undefined
            this._viewer.renderManager.gbufferUnpackExtension = undefined
            // this._viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this.unpackExtension]) // todo
            this._isPrimaryGBufferSet = false
        }
    }

    protected _createPass() {
        this._createTargetAndMaterial(true)
        if (!this.target) throw new Error('GBufferPlugin: target not created')
        if (!this.material) throw new Error('GBufferPlugin: material not created')
        this.material.userData.isGBufferMaterial = true
        const pass = new GBufferRenderPass(this.passId, ()=>this.target, this.material, new Color(1, 1, 1), 1)
        const preprocessMaterial = pass.preprocessMaterial
        pass.preprocessMaterial = (m) => preprocessMaterial(m, m.userData.renderToDepth) // if renderToDepth is undefined then renderToGbuffer is taken internally

        // not calling super, since we don't want to check for depth here
        // const preprocessObject = pass.preprocessObject
        pass.preprocessObject = (object: IObject3D) => {
            if (object.customGBufferMaterial) {
                const mat = object.customGBufferMaterial
                mat.allowOverride = false
                // todo save the current forcedOverrideMaterial to restore it later?
                object.forcedOverrideMaterial = mat
                return null
            }
            // return preprocessObject(object)
            return object.material
        }

        // const postprocessObject = pass.postprocessObject
        pass.postprocessObject = (object: IObject3D) => {
            if (object.customGBufferMaterial) {
                delete object.forcedOverrideMaterial
            }
            // postprocessObject(object)
        }

        pass.before = ['render']
        pass.after = []
        pass.required = ['render']
        return pass
    }

    protected _beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager): boolean {
        if (!super._beforeRender(scene, camera, renderManager) || !this.material) return false
        camera.updateShaderProperties(this.material)
        return true
    }

    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        isPrimaryGBuffer = true,
        enabled = true,
        public renderFlagsBuffer: boolean = true,
        public renderDepthTexture: boolean = false,
        public depthTextureType: typeof UnsignedShortType | typeof UnsignedIntType | typeof FloatType /* | typeof UnsignedInt248Type*/ = UnsignedIntType,
        // packing: DepthPackingStrategies = BasicDepthPacking,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        this.isPrimaryGBuffer = isPrimaryGBuffer
        // this.depthPacking = depthPacking
    }

    registerGBufferUpdater(key: string, updater: GBufferUpdater['updateGBufferFlags']): void {
        if (this.material) this.material.flagUpdaters.set(key, updater)
    }

    unregisterGBufferUpdater(key: string): void {
        if (this.material) this.material.flagUpdaters.delete(key)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        this.material?.dispose()
        this.material = undefined
        return super.onRemove(viewer)
    }

    /**
     * @deprecated use {@link normalDepthTexture} instead
     */
    getDepthNormal() {
        return this.textures.length > 0 ? this.textures[0] : undefined
    }
    /**
     * @deprecated use {@link flagsTexture} instead
     */
    getFlagsTexture() {
        return this.textures.length > 1 ? this.textures[1] : undefined
    }

    /**
     * @deprecated use {@link target} instead
     */
    getTarget() {
        return this.target
    }

    /**
     * @deprecated use {@link unpackExtension} instead
     */
    getUnpackSnippet(): string {
        return GBufferUnpack
    }

    /**
     * @deprecated use {@link unpackExtension} instead, it adds the same uniforms and defines
     * @param material
     */
    updateShaderProperties(material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}, needsUpdate?: boolean}): this {
        if (material.uniforms.tNormalDepth) material.uniforms.tNormalDepth.value = this.normalDepthTexture ?? undefined
        else this._viewer?.console.warn('BaseRenderer: no uniform: tNormalDepth')
        if (material.uniforms.tGBufferFlags) {
            material.uniforms.tGBufferFlags.value = this.flagsTexture ?? undefined
            const t = material.uniforms.tGBufferFlags.value ? 1 : 0
            if (t !== material.defines.GBUFFER_HAS_FLAGS) {
                material.defines.GBUFFER_HAS_FLAGS = t
                material.needsUpdate = true
            }
        }
        return this
    }

}

/**
 * @deprecated use GBufferMaterial instead
 */
export class DepthNormalMaterial extends GBufferMaterial {
    constructor(multipleRT: boolean, parameters?: ShaderMaterialParameters & IMaterialParameters) {
        super(multipleRT, parameters)
        console.warn('DepthNormalMaterial is deprecated, use GBufferMaterial instead')
    }
}
