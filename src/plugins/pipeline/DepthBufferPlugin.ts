import {
    BasicDepthPacking,
    Color,
    DepthPackingStrategies,
    MeshDepthMaterial,
    NoBlending,
    Texture,
    TextureDataType,
    UnsignedByteType,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {MaterialExtension} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import {uiDropdown, uiFolderContainer, uiImage} from 'uiconfig.js'
import {shaderReplaceString} from '../../utils'
import {onChange} from 'ts-browser-helpers'
import DepthBufferUnpack from './shaders/DepthBufferPlugin.unpack.glsl'
import {threeConstMappings} from '../../three'

export type DepthBufferPluginEventTypes = ''
// type DepthBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type DepthBufferPluginTarget = WebGLRenderTarget
export type DepthBufferPluginPass = GBufferRenderPass<'depth', DepthBufferPluginTarget>

/**
 * Depth Buffer Plugin
 *
 * Adds a pre-render pass to render the depth buffer to a render target that can be used as gbuffer or for postprocessing.
 * @category Plugins
 */
@uiFolderContainer('Depth Buffer Plugin')
export class DepthBufferPlugin
    extends PipelinePassPlugin<DepthBufferPluginPass, 'depth', DepthBufferPluginEventTypes> {

    readonly passId = 'depth'
    public static readonly PluginType = 'DepthBufferPlugin'

    target?: DepthBufferPluginTarget

    @uiImage('Depth Buffer' /* {readOnly: true}*/) texture?: Texture

    readonly material: MeshDepthMaterial = new MeshDepthMaterial({
        depthPacking: BasicDepthPacking,
        blending: NoBlending,
    })

    @onChange(DepthBufferPlugin.prototype._depthPackingChanged)
    @uiDropdown('Depth Packing', threeConstMappings.DepthPackingStrategies.uiConfig) depthPacking: DepthPackingStrategies

    // @onChange2(DepthBufferPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

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
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#include <packing>',
                '\n' + DepthBufferUnpack + '\n', {append: true})
        },
        extraUniforms: {
            tDepthBuffer: ()=>({value: this.target?.texture}),
        },
        extraDefines: {
            ['DEPTH_PACKING']: BasicDepthPacking,
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
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<DepthBufferPluginTarget>(
                {
                    depthBuffer: true,
                    samples: this._viewer.renderManager.composerTarget.samples || 0,
                    type: this.bufferType,
                    // magFilter: NearestFilter,
                    // minFilter: NearestFilter,
                    // generateMipmaps: false,
                    // encoding: LinearEncoding,
                })

        this.texture = this.target.texture
        this.texture.name = 'depthBuffer'

        if (this.isPrimaryGBuffer) {
            this._viewer.renderManager.gbufferTarget = this.target
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
            // this._viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this.unpackExtension]) // todo
            this._isPrimaryGBufferSet = false
        }
    }

    protected _createPass() {
        this._createTarget(true)
        if (!this.target) throw new Error('DepthBufferPlugin: target not created')
        this.material.userData.isGBufferMaterial = true
        const pass = new GBufferRenderPass('depth', this.target, this.material, new Color(0, 0, 0), 1)
        const preprocessMaterial = pass.preprocessMaterial
        pass.preprocessMaterial = (m) => preprocessMaterial(m, m.userData.renderToDepth)
        pass.before = ['render']
        pass.after = []
        pass.required = ['render']
        return pass
    }

    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        isPrimaryGBuffer = false,
        enabled = true,
        depthPacking: DepthPackingStrategies = BasicDepthPacking,
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

