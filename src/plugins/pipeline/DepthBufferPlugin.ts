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
import {uiFolderContainer, uiImage} from 'uiconfig.js'

export type DepthBufferPluginEventTypes = ''
// type DepthBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type DepthBufferPluginTarget = WebGLRenderTarget
export type DepthBufferPluginPass = GBufferRenderPass<'depth', DepthBufferPluginTarget>

@uiFolderContainer('Depth Buffer Plugin')
export class DepthBufferPlugin
    extends PipelinePassPlugin<DepthBufferPluginPass, 'depth', DepthBufferPluginEventTypes>
    implements IShaderPropertiesUpdater {

    readonly passId = 'depth'
    public static readonly PluginType = 'DepthBufferPlugin'

    target?: DepthBufferPluginTarget

    @uiImage('Depth Buffer' /* {readOnly: true}*/) texture?: Texture

    readonly material: MeshDepthMaterial = new MeshDepthMaterial({
        depthPacking: BasicDepthPacking,
        blending: NoBlending,
    })
    // private _gbufferPass?: IFilter<GBufferRenderPass<WebGLMultipleRenderTargets>

    createPass(v: ThreeViewer) {
        if (!this.target) this.target = v.renderManager.createTarget<DepthBufferPluginTarget>(
            {
                depthBuffer: true,
                samples: v.renderManager.composerTarget.samples || 0,
                type: this.bufferType,
            // magFilter: NearestFilter,
            // minFilter: NearestFilter,
            // generateMipmaps: false,
            // encoding: LinearEncoding,
            })
        this.texture = this.target.texture
        this.texture.name = 'depthBuffer'

        if (this.isPrimaryGBuffer) v.renderManager.gbufferTarget = this.target

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
        public readonly bufferType: TextureDataType = UnsignedByteType,
        public readonly isPrimaryGBuffer = false,
        enabled = true,
    ) {
        super()
        this.enabled = enabled
    }

    onRemove(viewer: ThreeViewer): void {
        if (this.target) {
            viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        return super.onRemove(viewer)
    }

    updateShaderProperties(material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}}): this {
        if (material.uniforms.tDepth) material.uniforms.tDepth.value = this.texture ?? undefined
        else this._viewer?.console.warn('BaseRenderer: no uniform: tDepth')
        return this
    }

}

