import {
    BufferGeometry,
    Camera,
    Color,
    FrontSide,
    HalfFloatType,
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
import {PipelinePassPlugin} from '../base/PipelinePassPlugin'
import type {IMaterial, PhysicalMaterial} from '../../core'
import {uiFolderContainer, uiImage} from 'uiconfig.js'

export type NormalBufferPluginEventTypes = ''
// type NormalBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type NormalBufferPluginTarget = WebGLRenderTarget
export type NormalBufferPluginPass = GBufferRenderPass<'normal', NormalBufferPluginTarget>
/**
 * Normal Buffer Plugin
 *
 * Adds a pre-render pass to render the normal buffer to a render target that can be used for postprocessing.
 * @category Plugins
 */
@uiFolderContainer('Normal Buffer Plugin')
export class NormalBufferPlugin
    extends PipelinePassPlugin<NormalBufferPluginPass, 'normal', NormalBufferPluginEventTypes> {

    readonly passId = 'normal'
    public static readonly PluginType = 'NormalBufferPlugin'

    target?: NormalBufferPluginTarget
    @uiImage('Normal Buffer' /* {readOnly: true}*/) texture?: Texture
    readonly material: MeshNormalMaterial = new MeshNormalMaterialOverride({
        blending: NoBlending,
    })

    // @onChange2(NormalBufferPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()

        if (!this.target) this.target = this._viewer.renderManager.createTarget<NormalBufferPluginTarget>(
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
    }
    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this.texture = undefined
    }

    protected _createPass() {
        this._createTarget(true)
        if (!this.target) throw new Error('NormalBufferPlugin: target not created')
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
        bufferType: TextureDataType = HalfFloatType,
        enabled = true,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        return super.onRemove(viewer)
    }

}

class MeshNormalMaterialOverride extends MeshNormalMaterial {
    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onBeforeRender(renderer, scene, camera, geometry, object)

        if (!(object as any).material) return
        const material = (object as any).material as IMaterial & Partial<PhysicalMaterial>

        if (material.bumpMap !== undefined) this.bumpMap = material.bumpMap
        if (material.bumpScale !== undefined) this.bumpScale = material.bumpScale
        // if (material.alphaMap !== undefined) this.alphaMap = material.alphaMap
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest

        if (material.normalMap !== undefined) this.normalMap = material.normalMap
        if (material.normalMapType !== undefined) this.normalMapType = material.normalMapType
        if (material.normalScale !== undefined) this.normalScale.copy(material.normalScale)

        if (material.displacementMap !== undefined) this.displacementMap = material.displacementMap
        if (material.displacementScale !== undefined) this.displacementScale = material.displacementScale
        if (material.displacementBias !== undefined) this.displacementBias = material.displacementBias

        if (material.flatShading !== undefined) this.flatShading = material.flatShading

        if (material.side !== undefined) this.side = material.side

        if (material.wireframe !== undefined) this.wireframe = material.wireframe
        if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onAfterRender(renderer, scene, camera, geometry, object)

        this.bumpMap = null
        this.bumpScale = 1
        // this.alphaMap = null
        this.alphaTest = 0

        this.normalMap = null
        this.normalMapType = TangentSpaceNormalMap

        this.displacementMap = null
        this.displacementScale = 1
        this.displacementBias = 0

        this.flatShading = false

        this.side = FrontSide

        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}
