import {
    BasicDepthPacking,
    Color,
    IUniform,
    MeshDepthMaterial,
    NoBlending,
    Texture,
    TextureDataType,
    UnsignedByteType,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {IShaderPropertiesUpdater} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'

export type DepthBufferPluginEventTypes = ''
// type DepthBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type DepthBufferPluginTarget = WebGLRenderTarget
export type DepthBufferPluginPass = GBufferRenderPass<'depth', DepthBufferPluginTarget>
export class DepthBufferPlugin
    extends PipelinePassPlugin<DepthBufferPluginPass, 'depth', DepthBufferPluginEventTypes>
    implements IShaderPropertiesUpdater {

    readonly passId = 'depth'
    public static readonly PluginType = 'DepthBufferPlugin'

    private _depthTarget?: DepthBufferPluginTarget
    private _depthTexture?: Texture
    readonly material: MeshDepthMaterial = new MeshDepthMaterial({
        depthPacking: BasicDepthPacking,
        blending: NoBlending,
    })
    // private _gbufferPass?: IFilter<GBufferRenderPass<WebGLMultipleRenderTargets>

    createPass(v: ThreeViewer) {
        const target = v.renderManager.createTarget<DepthBufferPluginTarget>(
            {
                depthBuffer: true,
                samples: v.renderManager.composerTarget.samples || 0,
                type: this.bufferType,
                // magFilter: NearestFilter,
                // minFilter: NearestFilter,
                // generateMipmaps: false,
                // encoding: LinearEncoding,
            })
        target.texture.name = 'depthBuffer'
        this._depthTexture = target.texture
        this._depthTarget = target

        if (this.isPrimaryGBuffer) v.renderManager.gbufferTarget = target

        this.material.userData.isGBufferMaterial = true
        const pass = new GBufferRenderPass('depth', target, this.material, new Color(0, 0, 0), 1)
        pass.before = ['render']
        pass.after = []
        pass.required = ['render']
        return pass
    }

    constructor(
        public readonly bufferType: TextureDataType = UnsignedByteType,
        public readonly isPrimaryGBuffer = false
    ) {
        super()
    }

    onRemove(viewer: ThreeViewer): void {
        if (this._depthTarget) {
            viewer.renderManager.disposeTarget(this._depthTarget)
            this._depthTarget = undefined
        }
        return super.onRemove(viewer)
    }

    getTarget() {
        return this._depthTarget
    }

    updateShaderProperties(material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}}): this {
        if (material.uniforms.tDepth) material.uniforms.tDepth.value = this._depthTexture ?? undefined
        else this._viewer?.console.warn('BaseRenderer: no uniform: tDepth')
        return this
    }

}

