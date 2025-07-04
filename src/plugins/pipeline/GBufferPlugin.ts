import {
    BufferGeometry,
    Camera,
    ClampToEdgeWrapping,
    Color,
    DepthTexture,
    DoubleSide,
    FloatType,
    GLSL1,
    GLSL3,
    IUniform,
    NoBlending,
    NormalMapTypes,
    Object3D,
    Scene,
    ShaderMaterialParameters,
    TangentSpaceNormalMap,
    Texture,
    TextureDataType,
    UniformsLib,
    UniformsUtils,
    UnsignedByteType,
    UnsignedIntType,
    UnsignedShortType,
    Vector2,
    Vector4,
    WebGLMultipleRenderTargets,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer, ViewerRenderManager} from '../../viewer'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiFolderContainer, uiImage} from 'uiconfig.js'
import {shaderReplaceString} from '../../utils'
import GBufferUnpack from './shaders/GBufferPlugin.unpack.glsl'
import GBufferMatVert from './shaders/GBufferPlugin.mat.vert.glsl'
import GBufferMatFrag from './shaders/GBufferPlugin.mat.frag.glsl'
import {
    ICamera,
    IMaterial,
    IMaterialParameters,
    IRenderManager,
    IScene,
    ITexture,
    PhysicalMaterial,
    ShaderMaterial2,
} from '../../core'

export type GBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
// export type GBufferPluginTarget = WebGLRenderTarget
export type GBufferPluginPass = GBufferRenderPass<'gbuffer', GBufferPluginTarget|undefined>

export interface GBufferUpdaterContext {
    material: IMaterial, renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D
}
export interface GBufferUpdater {
    updateGBufferFlags: (data: Vector4, context: GBufferUpdaterContext) => void
}

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
            this.material = new GBufferMaterial(useMultiple, {
                blending: NoBlending,
                transparent: true,
            })
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
 * Renders DepthNormal to a texture and flags to another
 */
export class GBufferMaterial extends ShaderMaterial2 {

    constructor(multipleRT = true, parameters?: ShaderMaterialParameters & IMaterialParameters) {
        super({
            vertexShader: GBufferMatVert,
            fragmentShader: GBufferMatFrag,
            uniforms: UniformsUtils.merge([
                UniformsLib.common,
                UniformsLib.bumpmap,
                UniformsLib.normalmap,
                UniformsLib.displacementmap,
                {
                    cameraNearFar: {value: new Vector2(0.1, 1000)}, // this has to be set from outside
                    flags: {value: new Vector4(255, 255, 255, 255)},
                },
            ]),
            defines: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                IS_GLSL3: multipleRT ? '1' : '0',
            },
            glslVersion: multipleRT ? GLSL3 : GLSL1,
            ...parameters,
        })
        this.reset()
    }

    flagUpdaters: Map<string, GBufferUpdater['updateGBufferFlags']> = new Map()
    normalMapType: NormalMapTypes = TangentSpaceNormalMap
    flatShading = false

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onBeforeRender(renderer, scene, camera, geometry, object)

        let material = (object as any).material as IMaterial & Partial<PhysicalMaterial>
        if (Array.isArray(material)) { // todo: add support for multi materials.
            material = material[0]
        }
        if (!material) return

        const setMap = (key: keyof IMaterial)=>{
            const map = material[key]
            if (!map) return
            this.uniforms[key].value = map
            if (!this.uniforms[key + 'Transform']) console.error('GBufferMaterial: ' + key + 'Transform is not defined in uniform')
            else {
                if ((map as Texture).isTexture)
                    renderer.materials.refreshTransformUniform((map as Texture), this.uniforms[key + 'Transform'])
            }
        }

        setMap('map')

        if (material.side !== undefined) this.side = material.side ?? DoubleSide
        setMap('alphaMap')
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

        setMap('bumpMap')
        if (material.bumpScale !== undefined) this.uniforms.bumpScale.value = material.bumpScale

        setMap('normalMap')
        if (material.normalScale !== undefined) this.uniforms.normalScale.value.copy(material.normalScale)
        if (material.normalMapType !== undefined) this.normalMapType = material.normalMapType
        if (material.flatShading !== undefined) this.flatShading = material.flatShading

        setMap('displacementMap')
        if (material.displacementScale !== undefined) this.uniforms.displacementScale.value = material.displacementScale
        if (material.displacementBias !== undefined) this.uniforms.displacementBias.value = material.displacementBias

        if (material.wireframe !== undefined) this.wireframe = material.wireframe
        if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

        /*
         GBuffer Flags has the following data
         1st Rendertarget has Depth and Normal buffers
         2nd Render Target::
          x : Empty
          y : first 3 bits lut index, second 5 bits bevel radius
          z : material id (userData.gBufferData?.materialId, userData.matId)
          w : this field is for setting bits - lutEnable-0, tonemap-1, bloom-2, ssao(cast)-3, dof-4, diamondMask-5
        */

        this.uniforms.flags.value.set(255, 255, 255, 255)

        const materialId = material.userData.gBufferData?.materialId ?? material.userData.matId // matId for backward compatibility
        this.uniforms.flags.value.z = materialId || 0

        this.flagUpdaters.forEach((updater)=> updater(this.uniforms.flags.value, {material, renderer, scene, camera, geometry, object}))

        this.uniforms.flags.value.x /= 255
        this.uniforms.flags.value.y /= 255
        this.uniforms.flags.value.z /= 255
        this.uniforms.flags.value.w /= 255

        this.uniformsNeedUpdate = true

        updateMaterialDefines({
            // ['USE_ALPHAMAP']: this.uniforms.alphaMap.value ? 1 : undefined,
            ['ALPHAMAP_UV']: this.uniforms.alphaMap.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
            ['USE_DISPLACEMENTMAP']: this.uniforms.displacementMap.value ? 1 : undefined,
            ['DISPLACEMENTMAP_UV']: this.uniforms.displacementMap.value ? 'uv' : undefined, // todo use getChannel, see WebGLPrograms.js
            ['ALPHA_I_RGBA_PACKING']: material.userData.ALPHA_I_RGBA_PACKING ? 1 : undefined,
            ['FORCED_LINEAR_DEPTH']: material.userData.forcedLinearDepth ?? undefined, // todo add to DepthBufferPlugin as well.
        }, material)

        // todo: do the same in DepthBufferPlugin and NormalBufferPlugin
        // what about the material extension settings in the userData of the source materials?
        if (material.materialExtensions?.length) {
            this.registerMaterialExtensions(material.materialExtensions)
        }

        // this.transparent = true
        this.needsUpdate = true

    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onAfterRender(renderer, scene, camera, geometry, object)

        let material = (object as any).material as IMaterial & Partial<PhysicalMaterial>
        if (Array.isArray(material)) { // todo: add support for multi materials.
            material = material[0]
        }
        if (!material) return

        if (material.materialExtensions?.length) {
            this.unregisterMaterialExtensions(material.materialExtensions)
        }

        this.reset()
    }

    reset() {
        this.uniforms.map.value = null
        this.side = DoubleSide
        this.uniforms.alphaMap.value = null
        this.alphaTest = 0.001
        this.alphaHash = false

        this.uniforms.bumpMap.value = null
        this.uniforms.bumpScale.value = 1

        this.uniforms.normalMap.value = null
        this.uniforms.normalScale.value.set(1, 1)
        this.normalMapType = TangentSpaceNormalMap
        this.flatShading = false

        this.uniforms.displacementMap.value = null
        this.uniforms.displacementScale.value = 1
        this.uniforms.displacementBias.value = 0

        this.uniforms.flags.value.set(255, 255, 255, 255)

        this.wireframe = false
        this.wireframeLinewidth = 1
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
