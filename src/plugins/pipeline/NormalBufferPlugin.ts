import {
    BufferGeometry,
    Camera,
    Color,
    DoubleSide,
    HalfFloatType,
    LinearSRGBColorSpace,
    MeshNormalMaterial,
    MeshNormalMaterialParameters,
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
import {IMaterial, IObject3D, PhysicalMaterial} from '../../core'
import {uiFolderContainer, uiImage} from 'uiconfig.js'

// type NormalBufferPluginTarget = WebGLMultipleRenderTargets | WebGLRenderTarget
export type NormalBufferPluginTarget = WebGLRenderTarget
export type NormalBufferPluginPass = GBufferRenderPass<'normal', NormalBufferPluginTarget|undefined>
/**
 * Normal Buffer Plugin
 *
 * Adds a pre-render pass to render the normal buffer to a render target that can be used for postprocessing.
 * @category Plugins
 */
@uiFolderContainer('Normal Buffer Plugin')
export class NormalBufferPlugin
    extends PipelinePassPlugin<NormalBufferPluginPass, 'normal'> {

    readonly passId = 'normal'
    public static readonly PluginType = 'NormalBufferPlugin'

    target?: NormalBufferPluginTarget
    @uiImage('Normal Buffer', {readOnly: true}) texture?: Texture
    readonly material: MeshNormalMaterial = new MeshNormalMaterialOverride({
        blending: NoBlending,
    })

    // @onChange2(NormalBufferPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()

        // const rm = this._viewer.renderManager
        if (!this.target) this.target = this._viewer.renderManager.createTarget<NormalBufferPluginTarget>(
            {
                depthBuffer: true,
                // samples: rm.msaa ? typeof rm.msaa !== 'number' ? ViewerRenderManager.DEFAULT_MSAA_SAMPLES : rm.msaa : 0,
                samples: 0,
                type: this.bufferType,
                magFilter: NearestFilter,
                minFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
        this.texture = this.target.texture
        this.texture.name = 'normalBuffer'

        // if (this._pass) this._pass.target = this.target
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
        const pass = new GBufferRenderPass(this.passId, ()=>this.target, this.material, new Color(0, 0, 0), 1)
        const preprocessMaterial = pass.preprocessMaterial
        pass.preprocessMaterial = (m) => preprocessMaterial(m, true)

        // not calling super, since we don't want to check for depth here
        // const preprocessObject = pass.preprocessObject
        pass.preprocessObject = (object: IObject3D) => {
            if (object.customNormalMaterial) {
                const mat = object.customNormalMaterial
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
            if (object.customNormalMaterial) {
                delete object.forcedOverrideMaterial
            }
            // postprocessObject(object)
        }


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

    constructor(parameters: MeshNormalMaterialParameters) {
        super(parameters)
        this.reset()
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D) {
        super.onBeforeRender(renderer, scene, camera, geometry, object)

        if (!(object as any).material) return
        const material = (object as any).material as IMaterial & Partial<PhysicalMaterial>

        if (material.bumpMap !== undefined) this.bumpMap = material.bumpMap
        if (material.bumpScale !== undefined) this.bumpScale = material.bumpScale
        // if (material.alphaMap !== undefined) this.alphaMap = material.alphaMap
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

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
        this.reset()
    }

    reset() {
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

        this.side = DoubleSide

        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}
