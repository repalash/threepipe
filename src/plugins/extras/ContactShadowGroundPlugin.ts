import {getOrCall, onChange, serialize} from 'ts-browser-helpers'
import {
    BasicDepthPacking,
    Color,
    Euler,
    LinearFilter,
    MeshDepthMaterial,
    NoBlending,
    NoColorSpace,
    OrthographicCamera,
    RGBAFormat, Texture,
    UnsignedByteType,
    Vector3,
    WebGLRenderTarget,
} from 'three'
import {BaseGroundPlugin} from '../base/BaseGroundPlugin'
import {GBufferRenderPass} from '../../postprocessing'
import {ThreeViewer} from '../../viewer'
import {IRenderTarget} from '../../rendering'
import {uiPanelContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {HVBlurHelper} from '../../three/utils/HVBlurHelper'
import {shaderReplaceString} from '../../utils'
import {PhysicalMaterial} from '../../core'

@uiPanelContainer('Contact Shadow Ground')
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
    private _depthPass?: GBufferRenderPass<'contactShadowGround', WebGLRenderTarget|undefined>
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
        const target = getOrCall(this._depthPass?.target)
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
        if (!this._viewer || !this._depthPass || !this._blurHelper || !this.contactShadows || !this.visible) return

        this._depthPass.scene = this._viewer.scene
        this._depthPass.camera = this.shadowCamera
        this._depthPass.render(this._viewer.renderManager.renderer, null)

        const target = getOrCall(this._depthPass.target)
        if (!target) return

        const blurTarget = this._viewer.renderManager.getTempTarget<IRenderTarget & WebGLRenderTarget>({
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
        this._blurHelper.blur(target.texture, target, blurTarget, this.blurAmount / 256)
        this._blurHelper.blur(target.texture, target, blurTarget, 0.4 * this.blurAmount / 256)
        this._viewer.renderManager.releaseTempTarget(blurTarget)
    }

    protected _refreshTransform() {
        if (!super._refreshTransform()) return false

        if (!this._mesh) return false
        if (!this._viewer) return false

        this.shadowCamera.position.copy(this._mesh.getWorldPosition(new Vector3()))
        this.shadowCamera.setRotationFromEuler(new Euler(Math.PI / 2., 0, 0))
        this.shadowCamera.updateMatrixWorld()
        this._refreshShadowCameraFrustum()

        this._mesh.scale.y = -this.size
        return true
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
        this._material.alphaMap = null
        if (this._material.userData.ssreflDisabled) delete this._material.userData.ssreflDisabled
        if (this._material.userData.ssreflNonPhysical) delete this._material.userData.ssreflNonPhysical
        super._removeMaterial()
    }

    private _depthTex: Texture|null = null
    public refresh(): void {
        if (!this._viewer) return
        if (!this.contactShadows) {
            if (this._material?.alphaMap === this._depthTex) {
                this._material.alphaMap = null
                this._material.setDirty()
            }
            if (this._material?.userData.__csgpParamsSet) {
                delete this._material.userData.__csgpParamsSet
                delete this._material.userData.ssreflDisabled
                delete this._material.userData.ssreflNonPhysical
            }
            this._depthTex = null
        } else {
            this._depthTex = getOrCall(this._depthPass?.target)?.texture || null
        }
        super.refresh()
    }

    protected _createMaterial(material?: PhysicalMaterial): PhysicalMaterial {
        const mat = super._createMaterial(material)
        mat.roughness = 1
        mat.metalness = 0
        mat.color.set(0x111111)
        mat.transparent = true
        // mat.userData.inverseAlphaMap = false // this must be false, if getting inverted colors, check clear color of gbuffer render pass.
        return mat
    }

    protected _refreshMaterial() {
        if (!this._viewer) return false
        const isNewMaterial = super._refreshMaterial()
        if (!this._material) return isNewMaterial
        if (this.contactShadows) {
            this._material.userData.ssreflDisabled = true
            this._material.userData.ssreflNonPhysical = false
            this._material.userData.__csgpParamsSet = true
            this._material.alphaMap = this._depthTex || null
            this._material.setDirty()
        }
        return isNewMaterial
    }

}
