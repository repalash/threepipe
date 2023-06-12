import {
    BufferGeometry,
    Camera,
    Color,
    FrontSide,
    HalfFloatType,
    IUniform,
    LinearSRGBColorSpace,
    MeshNormalMaterial,
    NearestFilter,
    NoBlending,
    Object3D,
    Scene,
    TangentSpaceNormalMap,
    Texture,
    TextureDataType,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'three'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {IShaderPropertiesUpdater} from '../../materials'
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import type {IMaterial, PhysicalMaterial} from '../../core'

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
    readonly material: MeshNormalMaterial = new MeshNormalMaterial2({
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

class MeshNormalMaterial2 extends MeshNormalMaterial {
    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onBeforeRender(renderer, scene, camera, geometry, object)

        if (!(object as any).material) return
        const material = (object as any).material as IMaterial & Partial<PhysicalMaterial>

        if (material.bumpMap !== undefined) this.bumpMap = material.bumpMap
        if (material.bumpScale !== undefined) this.bumpScale = material.bumpScale

        if (material.normalMap !== undefined) this.normalMap = material.normalMap
        if (material.normalMapType !== undefined) this.normalMapType = material.normalMapType
        if (material.normalScale !== undefined) this.normalScale.copy(material.normalScale)

        if (material.displacementMap !== undefined) this.displacementMap = material.displacementMap
        if (material.displacementScale !== undefined) this.displacementScale = material.displacementScale
        if (material.displacementBias !== undefined) this.displacementBias = material.displacementBias

        if (material.flatShading !== undefined) this.flatShading = material.flatShading

        if (material.side !== undefined) this.side = material.side
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onAfterRender(renderer, scene, camera, geometry, object)

        this.bumpMap = null
        this.bumpScale = 1

        this.normalMap = null
        this.normalMapType = TangentSpaceNormalMap

        this.displacementMap = null
        this.displacementScale = 1
        this.displacementBias = 0

        this.flatShading = false

        this.side = FrontSide
    }
}
