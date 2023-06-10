import {
    Color,
    HalfFloatType,
    IUniform,
    LinearSRGBColorSpace,
    MeshNormalMaterial,
    NearestFilter,
    NoBlending,
    Texture,
    TextureDataType,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {IShaderPropertiesUpdater} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'

export type NormalBufferPluginEventTypes = ''
// type NormalBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type NormalBufferPluginTarget = WebGLRenderTarget
export type NormalBufferPluginPass = GBufferRenderPass<'normal', NormalBufferPluginTarget>
export class NormalBufferPlugin
    extends PipelinePassPlugin<NormalBufferPluginPass, 'normal', NormalBufferPluginEventTypes>
    implements IShaderPropertiesUpdater {

    readonly passId = 'normal'
    public static readonly PluginType = 'NormalBufferPlugin'

    target?: NormalBufferPluginTarget
    texture?: Texture
    readonly material: MeshNormalMaterial = new MeshNormalMaterial({
        blending: NoBlending,
    })
    // private _gbufferPass?: IFilter<GBufferRenderPass<WebGLMultipleRenderTargets>

    createPass(v: ThreeViewer) {
        if (!this.target) this.target = v.renderManager.createTarget<NormalBufferPluginTarget>(
            {
                depthBuffer: true,
                // samples: v.renderManager.composerTarget.samples || 0,
                samples: 0,
                type: this.bufferType,
                magFilter: NearestFilter,
                minFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
        this.texture = this.target.texture
        this.texture.name = 'normalBuffer'

        this.material.userData.isGBufferMaterial = true
        const pass = new GBufferRenderPass('normal', this.target, this.material, new Color(0, 0, 0), 1)
        const preprocessMaterial = pass.preprocessMaterial
        pass.preprocessMaterial = (m) => preprocessMaterial(m, true)
        pass.before = ['render']
        pass.after = []
        pass.required = ['render']
        return pass
    }

    constructor(
        public readonly bufferType: TextureDataType = HalfFloatType,
    ) {
        super()
    }

    onRemove(viewer: ThreeViewer): void {
        if (this.target) {
            viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        return super.onRemove(viewer)
    }

    updateShaderProperties(material: {defines: Record<string, string | number | undefined>; uniforms: {[p: string]: IUniform}}): this {
        if (material.uniforms.tNormal) material.uniforms.tNormal.value = this.texture ?? undefined
        else this._viewer?.console.warn('BaseRenderer: no uniform: tNormal')
        return this
    }

}

