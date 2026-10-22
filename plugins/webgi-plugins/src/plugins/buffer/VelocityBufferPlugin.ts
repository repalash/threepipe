import {
    BufferGeometry,
    Camera,
    Color,
    DoubleSide,
    GBufferRenderPass,
    ICamera,
    IObject3D,
    IRenderManager,
    IScene,
    IUniform,
    IWebGLRenderer,
    LinearSRGBColorSpace,
    MaterialExtension,
    Matrix3,
    Matrix4,
    NoBlending,
    PipelinePassPlugin,
    Scene,
    ShaderMaterial,
    shaderReplaceString,
    Texture,
    TextureDataType,
    ThreeViewer,
    uiFolderContainer,
    uiImage,
    Group,
    UnsignedByteType,
    Vector2,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'threepipe'
import VelocityBufferUnpack from './shaders/VelocityBufferPlugin.unpack.glsl'
import ssVelocityVert from './shaders/VelocityBufferPlugin.mat.vert.glsl'
import ssVelocityFrag from './shaders/VelocityBufferPlugin.mat.frag.glsl'
import {TemporalAAPlugin} from '../postprocessing/TemporalAAPlugin'

// type VelocityBufferPluginTarget = WebGLRenderTarget
export type VelocityBufferPluginTarget = WebGLRenderTarget
export type VelocityBufferPluginPass = GBufferRenderPass<'velocityBuffer', VelocityBufferPluginTarget>
/**
 * Velocity Buffer Plugin
 *
 * Adds a pre-render pass to render the normal buffer to a render target that can be used for postprocessing.
 * @category Plugins
 */
@uiFolderContainer('Velocity Buffer Plugin (for TAA)')
export class VelocityBufferPlugin
    extends PipelinePassPlugin<VelocityBufferPluginPass, 'velocityBuffer'> {

    readonly passId = 'velocityBuffer'
    public static readonly PluginType = 'VelocityBuffer'
    public static readonly OldPluginType = 'VelocityBufferPlugin' // todo swap

    target?: VelocityBufferPluginTarget
    @uiImage('Velocity Buffer', {readOnly: true}) texture?: Texture
    readonly material: SSVelocityMaterial = new SSVelocityMaterial()

    // @onChange2(VelocityBufferPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()

        if (!this.target) this.target = this._viewer.renderManager.createTarget<VelocityBufferPluginTarget>(
            {
                depthBuffer: true,
                // samples: v.renderManager.composerTarget.samples || 0,
                samples: 0,
                type: this.bufferType,
                // magFilter: NearestFilter,
                // minFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
        this.texture = this.target.texture
        this.texture.name = 'velocityBuffer'

        if (this._pass) this._pass.target = this.target
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
        if (!this.target) throw new Error('VelocityBufferPlugin: target not created')
        this.material.userData.isGBufferMaterial = true
        const v = this._viewer!
        const pass = new class extends GBufferRenderPass {
            private _firstCall = true
            render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget | null, readBuffer?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
                if (v.renderManager.frameCount > 0) return
                if (!this.enabled || !this.camera) return
                const mat = this.overrideMaterial as ShaderMaterial
                mat.uniforms.currentProjectionViewMatrix.value.copy(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse)
                if (this._firstCall) {
                    mat.uniforms.lastProjectionViewMatrix.value.copy(mat.uniforms.currentProjectionViewMatrix.value)
                    this._firstCall = false
                }
                super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
                mat.uniforms.lastProjectionViewMatrix.value.copy(mat.uniforms.currentProjectionViewMatrix.value)
            }
        }(this.passId, this.target, this.material, new Color(0.5, 0.5, 0.5), 1) // clear color 0.5 means 0 velocity
        const preprocessMaterial = pass.preprocessMaterial
        pass.preprocessMaterial = (m) => preprocessMaterial(m, m.userData[VelocityBufferPlugin.PluginType]?.disabled)
        pass.before = ['render']
        pass.after = []
        pass.required = ['render']
        return pass as any
    }

    // automatically register the unpack extension with TAA plugin
    protected readonly _attachToTaa: boolean

    constructor(
        bufferType: TextureDataType = UnsignedByteType,
        enabled = true,
        _attachToTaa = true
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        this._attachToTaa = _attachToTaa
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.forPlugin(TemporalAAPlugin, (taa) => {
            this._attachToTaa && taa.pass?.material.registerMaterialExtensions([this.unpackExtension])
        }, (taa)=>{
            taa.pass?.material?.unregisterMaterialExtensions([this.unpackExtension])
        }, this)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        return super.onRemove(viewer)
    }

    unpackExtension: MaterialExtension = {
        shaderExtender: (shader)=>{
            if(this.isDisabled()) return
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#pragma <velocity_unpack>',
                '\n' + VelocityBufferUnpack + '\n')
        },
        computeCacheKey: ()=>this.isDisabled() ? '' : 'vb',
        extraUniforms: {
            tVelocity: ()=>({value: !this.isDisabled() ? this.target?.texture:null}),
        },
        extraDefines: {
            ['HAS_VELOCITY_BUFFER']: ()=>!this.isDisabled() && this.target?.texture ? 1 : undefined,
        },
        priority: 100,
        isCompatible: () => true,
    }

    setDirty() {
        super.setDirty();
        this.unpackExtension.setDirty?.()
    }

    protected _beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager): boolean {
        if (!super._beforeRender(scene, camera, renderManager)) return false
        const pass = this.pass
        if (!pass) return false
        if (renderManager.frameCount > 0) return false
        pass.scene = scene
        pass.camera = camera
        camera.updateShaderProperties(pass.overrideMaterial as ShaderMaterial)
        return true
    }

}


declare module 'threepipe' {
    interface IMaterialUserData {
        [VelocityBufferPlugin.PluginType]?: {
            /**
             * Disables rendering to the velocity buffer.
             */
            disabled?: boolean
        }
    }
}
export class SSVelocityMaterial extends ShaderMaterial {

    constructor() {
        super({
            vertexShader: ssVelocityVert,
            fragmentShader: ssVelocityFrag,
            uniforms: {
                cameraNearFar: {value: new Vector2(0.1, 1000)},
                alphaMap: {value: null},
                map: {value: null},
                alphaTest: {value: null},
                alphaMapTransform: {value: /* @__PURE__*/ new Matrix3()},
                currentProjectionViewMatrix: {value: new Matrix4()},
                lastProjectionViewMatrix: {value: new Matrix4()},
            },
            blending: NoBlending, // todo?
        })
    }

    extraUniformsToUpload: Record<string, IUniform> = {
        modelMatrixPrevious: {value: new Matrix4().identity()},
    }

    private _previousWorldMatrices: Record<string, Matrix4> = {}

    // this gets called for each object.
    onBeforeRender(_r: WebGLRenderer, _s: Scene, _c: Camera, _geometry: BufferGeometry, object: IObject3D, group: Group) {
        super.onBeforeRender(_r, _s, _c, _geometry, object, group)
        const prevMatrix = this._previousWorldMatrices[object.uuid]
        this.extraUniformsToUpload.modelMatrixPrevious.value.copy(prevMatrix ?? object.matrixWorld)

        // todo: make sure all objects are only rendered once.
        if (prevMatrix) {
            prevMatrix.copy(object.matrixWorld)
        } else {
            this._previousWorldMatrices[object.uuid] = object.matrixWorld.clone()
        }

        // todo: add support for all this in the shaders.
        let mat = object.material

        if (Array.isArray(mat)) { // todo: add support for multi materials.
            mat = mat[0]
        }
        this.uniforms.alphaMap.value = mat?.alphaMap ?? null
        this.uniforms.alphaTest.value = !mat || !mat.alphaTest || mat.alphaTest < 0.0000001 ? 0.001 : mat.alphaTest

        let x = this.uniforms.alphaMap.value ? 1 : undefined
        if (x !== this.defines.USE_ALPHAMAP) {
            if (x === undefined) delete this.defines.USE_ALPHAMAP
            else this.defines.USE_ALPHAMAP = x
            this.needsUpdate = true
        }
        // the colour map's alpha cuts out only on alpha-tested materials (leaf cards), never on opaque ones
        this.uniforms.map.value = mat?.alphaTest && mat.alphaTest > 0 ? mat.map ?? null : null
        x = this.uniforms.map.value ? 1 : undefined
        if (x !== this.defines.USE_MAP_ALPHA) {
            if (x === undefined) delete this.defines.USE_MAP_ALPHA
            else this.defines.USE_MAP_ALPHA = x
            this.needsUpdate = true
        }
        x = mat?.userData.ALPHA_I_RGBA_PACKING ? 1 : undefined
        if (x !== this.defines.ALPHA_I_RGBA_PACKING) {
            if (x === undefined) delete this.defines.ALPHA_I_RGBA_PACKING
            else this.defines.ALPHA_I_RGBA_PACKING = x
            this.needsUpdate = true
        }

        this.side = mat?.side ?? DoubleSide
    }
}
