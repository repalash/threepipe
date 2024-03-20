import {onChange, serialize} from 'ts-browser-helpers'
import {
    BasicDepthPacking,
    Color,
    Euler,
    LinearFilter,
    MeshDepthMaterial,
    NoBlending,
    NoColorSpace,
    OrthographicCamera,
    RGBAFormat,
    UnsignedByteType,
    Vector3,
    WebGLRenderTarget,
} from 'three'
import {BaseGroundPlugin} from '../base/BaseGroundPlugin'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {IRenderTarget} from '../../rendering'
import {uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {HVBlurHelper} from '../../three/utils/HVBlurHelper'
import {shaderReplaceString} from '../../utils'

@uiFolderContainer('Contact Shadow Ground')
export class ContactShadowGroundPlugin extends BaseGroundPlugin {
    static readonly PluginType = 'ContactShadowGroundPlugin'

    @uiToggle('Contact Shadows')
    @onChange(ContactShadowGroundPlugin.prototype.refresh)
    @serialize() contactShadows = true

    @uiSlider('Shadow Scale', [0, 2])
    @serialize()
    @onChange(ContactShadowGroundPlugin.prototype._refreshShadowCameraFrustum)
        shadowScale = 1

    @uiSlider('Shadow Height', [0, 20])
    @serialize()
    @onChange(ContactShadowGroundPlugin.prototype._refreshShadowCameraFrustum)
        shadowHeight = 5

    @uiSlider('Blur Amount', [0, 10])
    @serialize()
    @onChange(ContactShadowGroundPlugin.prototype._setDirty)
        blurAmount = 1


    shadowCamera = new OrthographicCamera(-1, 1, 1, -1, 0.001, this.shadowHeight)
    private _depthPass?: GBufferRenderPass<'contactShadowGround', WebGLRenderTarget>
    private _blurHelper?: HVBlurHelper

    constructor() {
        super()
        this._refreshShadowCameraFrustum = this._refreshShadowCameraFrustum.bind(this)
        this.refresh = this.refresh.bind(this)
    }

    onAdded(viewer: ThreeViewer): void {
        const target = viewer.renderManager.createTarget<IRenderTarget & WebGLRenderTarget>({
            type: UnsignedByteType,
            format: RGBAFormat,
            colorSpace: NoColorSpace,
            size: {width: 512, height: 512},
            generateMipmaps: false,
            depthBuffer: true,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            // isAntialiased: this._viewer.isAntialiased,
        })
        target.texture.name = 'groundContactDepthTexture'

        // https://github.com/mrdoob/three.js/blob/master/examples/webgl_shadow_contact.html
        const material = new MeshDepthMaterial({
            // depthPacking: RGBADepthPacking, // todo
            depthPacking: BasicDepthPacking,
            transparent: false,
            blending: NoBlending,
        })
        material.onBeforeCompile = (shader) => {
            shader.uniforms.opacity.value = 1.
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
                'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), 1.0 );',
                // 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
            )
        }

        this._depthPass = new GBufferRenderPass('contactShadowGround', target, material, new Color(0, 0, 0), 0)
        this._blurHelper = new HVBlurHelper(viewer)
        super.onAdded(viewer)
    }

    onRemove(viewer: ThreeViewer): void {
        const target = this._depthPass?.target
        if (target) this._viewer?.renderManager.disposeTarget(target)
        this._depthPass?.dispose()
        this._depthPass = undefined
        this._blurHelper?.dispose()
        this._blurHelper = undefined
        return super.onRemove(viewer)
    }
    // todo: dispose target, material, pass and stuff

    protected _postFrame() {
        super._postFrame()
        if (!this._viewer) return

    }

    protected _preRender() {
        super._preRender()
        if (!this._viewer || !this._depthPass || !this._blurHelper) return

        this._depthPass.scene = this._viewer.scene
        this._depthPass.camera = this.shadowCamera
        this._depthPass.render(this._viewer.renderManager.renderer, null)

        const blurTarget = this._viewer.renderManager.getTempTarget<IRenderTarget&WebGLRenderTarget>({
            type: UnsignedByteType,
            format: RGBAFormat,
            colorSpace: NoColorSpace,
            size: {width: 1024, height: 1024},
            generateMipmaps: false,
            depthBuffer: false,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            // isAntialiased: this._viewer.isAntialiased,
        })

        this._blurHelper.blur(this._depthPass.target.texture, this._depthPass.target, blurTarget, this.blurAmount / 256)
        this._blurHelper.blur(this._depthPass.target.texture, this._depthPass.target, blurTarget, 0.4 * this.blurAmount / 256)

        this._viewer.renderManager.releaseTempTarget(blurTarget)

    }

    protected _refreshTransform() {
        super._refreshTransform()

        if (!this._mesh) return
        if (!this._viewer) return

        this.shadowCamera.position.copy(this._mesh.getWorldPosition(new Vector3()))
        this.shadowCamera.setRotationFromEuler(new Euler(Math.PI / 2., 0, 0))
        this.shadowCamera.updateMatrixWorld()
        this._refreshShadowCameraFrustum()

        this._mesh.scale.y = -this.size
    }

    private _refreshShadowCameraFrustum() {
        if (!this.shadowCamera) return
        this.shadowCamera.left = -this.size / (2 * this.shadowScale)
        this.shadowCamera.right = this.size / (2 * this.shadowScale)
        this.shadowCamera.top = this.size / (2 * this.shadowScale)
        this.shadowCamera.bottom = -this.size / (2 * this.shadowScale)
        this.shadowCamera.far = this.shadowHeight
        this.shadowCamera.updateProjectionMatrix()
        this._setDirty()
    }
    private _setDirty() {
        this._viewer?.setDirty()
    }

    protected _removeMaterial() {
        if (!this._material) return
        // todo: remove map or render target thats assigned
        super._removeMaterial()
    }

    public refresh(): void {
        if (!this._viewer) return
        // todo: shadow enabled check
        super.refresh()
    }

    protected _refreshMaterial(): boolean {
        if (!this._viewer) return false
        const isNewMaterial = super._refreshMaterial()
        if (!this._material) return isNewMaterial
        this._material.alphaMap = this._depthPass?.target.texture || null

        if (isNewMaterial) {
            this._material.roughness = 1
            this._material.metalness = 0
            this._material.color.set(0x111111)
            this._material.transparent = true
            this._material.userData.ssreflDisabled = true // todo: unset this in remove material.
            this._material.userData.ssreflNonPhysical = false
            // this._material.materialObject.userData.inverseAlphaMap = false // this must be false, if getting inverted colors, check clear color of gbuffer render pass.
        }

        return isNewMaterial

    }

}
