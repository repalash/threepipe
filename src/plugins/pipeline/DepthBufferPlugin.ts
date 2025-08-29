import {
    RGBADepthPacking,
    BufferGeometry,
    Camera,
    Color,
    DepthPackingStrategies,
    DoubleSide,
    FrontSide,
    MeshDepthMaterial,
    MeshDepthMaterialParameters,
    NoBlending,
    Object3D,
    Scene,
    Texture,
    TextureDataType,
    UnsignedByteType,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer, ViewerRenderManager} from '../../viewer'
import {MaterialExtension} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiDropdown, uiFolderContainer, uiImage} from 'uiconfig.js'
import {shaderReplaceString} from '../../utils'
import {onChange} from 'ts-browser-helpers'
import DepthBufferUnpack from './shaders/DepthBufferPlugin.unpack.glsl'
import {threeConstMappings} from '../../three'
import {IMaterial, PhysicalMaterial} from '../../core'

// type DepthBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type DepthBufferPluginTarget = WebGLRenderTarget
export type DepthBufferPluginPass = GBufferRenderPass<'depth', DepthBufferPluginTarget|undefined>

/**
 * Depth Buffer Plugin
 *
 * Adds a pre-render pass to render the depth buffer to a render target that can be used as gbuffer or for postprocessing.
 * @category Plugins
 */
@uiFolderContainer('Depth Buffer Plugin')
export class DepthBufferPlugin
    extends PipelinePassPlugin<DepthBufferPluginPass, 'depth'> {

    readonly passId = 'depth'
    public static readonly PluginType = 'DepthBufferPlugin'

    target?: DepthBufferPluginTarget

    @uiImage('Depth Buffer', {readOnly: true}) texture?: Texture

    // @uiConfig() // not supported in this material yet
    readonly material: MeshDepthMaterial = new MeshDepthMaterialOverride({
        depthPacking: RGBADepthPacking,
        blending: NoBlending,
        transparent: true,
    })

    @onChange(DepthBufferPlugin.prototype._depthPackingChanged)
    @uiDropdown('Depth Packing', threeConstMappings.DepthPackingStrategies.uiConfig) depthPacking: DepthPackingStrategies

    // @onChange2(DepthBufferPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now) todo line 139: unregisterMaterialExtensions, maybe because the priority is not set so its added at the end?

    // @uiToggle()
    // @onChange2(DepthBufferPlugin.prototype._createTarget)
    readonly isPrimaryGBuffer: boolean // cannot be changed after creation (for now)

    protected _depthPackingChanged() {
        this.material.depthPacking = this.depthPacking
        this.material.needsUpdate = true
        if (this.unpackExtension && this.unpackExtension.extraDefines) {
            this.unpackExtension.extraDefines.DEPTH_PACKING = this.depthPacking
            this.unpackExtension.setDirty?.()
        }
        this.setDirty()
    }

    unpackExtension: MaterialExtension = {
        shaderExtender: (shader)=>{
            const includes = ['depth_buffer_unpack', 'gbuffer_unpack', 'packing'] as const
            const include = includes.find(i=>shader.fragmentShader.includes(`#include <${i}>`))
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                `#include <${include}>`,
                '\n' + DepthBufferUnpack + '\n', {append: include === 'packing'})
        },
        extraUniforms: {
            tDepthBuffer: ()=>({value: this.target?.texture}),
        },
        extraDefines: {
            ['DEPTH_PACKING']: RGBADepthPacking,
            ['HAS_DEPTH_BUFFER']: ()=>this.target?.texture ? 1 : undefined,
            ['HAS_GBUFFER']: ()=>this.isPrimaryGBuffer && this.target?.texture ? 1 : undefined,
        },
        priority: 100,
        isCompatible: () => true,
    }

    private _isPrimaryGBufferSet = false
    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()
        const rm = this._viewer.renderManager
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<DepthBufferPluginTarget>(
                {
                    depthBuffer: true,
                    samples: this._viewer.renderManager.zPrepass && this.isPrimaryGBuffer && rm.msaa ? // requirement for zPrepass
                        typeof rm.msaa !== 'number' ? ViewerRenderManager.DEFAULT_MSAA_SAMPLES : rm.msaa : 0,
                    type: this.bufferType,
                    // magFilter: NearestFilter,
                    // minFilter: NearestFilter,
                    // generateMipmaps: false,
                    // encoding: LinearEncoding,
                })

        this.texture = this.target.texture
        this.texture.name = 'depthBuffer'

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
        this.texture = undefined
        if (this._isPrimaryGBufferSet) { // using a separate flag as when isPrimaryGBuffer is changed, we cannot check it.
            this._viewer.renderManager.gbufferTarget = undefined
            this._viewer.renderManager.gbufferUnpackExtension = undefined
            // this._viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this.unpackExtension]) // todo this has an issue
            this._isPrimaryGBufferSet = false
        }
    }

    protected _createPass() {
        this._createTarget(true)
        if (!this.target) throw new Error('DepthBufferPlugin: target not created')
        this.material.userData.isGBufferMaterial = true
        const pass = new GBufferRenderPass(this.passId, ()=>this.target, this.material, new Color(0, 0, 0), 1)
        const preprocessMaterial = pass.preprocessMaterial
        pass.preprocessMaterial = (m) => preprocessMaterial(m, m.userData.renderToDepth) // if renderToDepth is undefined then renderToGbuffer is taken internally
        pass.before = ['render']
        pass.after = []
        pass.required = ['render']
        return pass
    }

    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        isPrimaryGBuffer = false,
        enabled = true,
        depthPacking: DepthPackingStrategies = RGBADepthPacking,
    ) {
        super()
        this.enabled = enabled
        this.depthPacking = depthPacking
        this.bufferType = bufferType
        this.isPrimaryGBuffer = isPrimaryGBuffer
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        return super.onRemove(viewer)
    }

}

class MeshDepthMaterialOverride extends MeshDepthMaterial {

    constructor(parameters: MeshDepthMaterialParameters) {
        super(parameters)
        this.reset()
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onBeforeRender(renderer, scene, camera, geometry, object)

        let material = (object as any).material as IMaterial & Partial<PhysicalMaterial>
        if (Array.isArray(material)) { // todo: add support for multi materials.
            material = material[0]
        }
        if (!material) return

        if (material.map !== undefined) this.map = material.map // in case there is alpha in the map.
        if (material.side !== undefined) this.side = material.side ?? FrontSide
        if (material.alphaMap !== undefined) this.alphaMap = material.alphaMap
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

        if (material.displacementMap !== undefined) this.displacementMap = material.displacementMap
        if (material.displacementScale !== undefined) this.displacementScale = material.displacementScale
        if (material.displacementBias !== undefined) this.displacementBias = material.displacementBias

        if (material.wireframe !== undefined) this.wireframe = material.wireframe
        if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

        this.needsUpdate = true

    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onAfterRender(renderer, scene, camera, geometry, object)

        this.reset()
    }

    reset() {
        this.map = null
        this.side = DoubleSide
        this.alphaMap = null
        this.alphaTest = 0.001
        this.alphaHash = false

        this.displacementMap = null
        this.displacementScale = 1
        this.displacementBias = 0

        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}
