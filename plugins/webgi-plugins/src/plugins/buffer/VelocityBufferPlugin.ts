import {
    BufferGeometry,
    Camera,
    Color,
    DataTexture,
    FloatType,
    InstancedMesh,
    NearestFilter,
    RGBAFormat,
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
        // `disabled` is the opposite of renderToGBuffer; undefined keeps the material's own renderToGBuffer
        pass.preprocessMaterial = (m) => {
            const disabled = m.userData[VelocityBufferPlugin.PluginType]?.disabled
            return preprocessMaterial(m, disabled === undefined ? undefined : !disabled)
        }
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
        // instanced meshes: the previous frame's instance matrices, 4 texels (columns) per instance, 1024 per row
        instanceMatrixPrevious: {value: null},
        hasInstanceMatrixPrevious: {value: false},
    }

    /**
     * The world matrix of each object in the last and in this frame's velocity render. Advanced once per render
     * (`frame`): an object with several material groups is drawn (and gets onBeforeRender) once per group, and
     * copying the matrix at each draw left every group after the first with no motion.
     */
    private _previousWorldMatrices: Record<string, {previous: Matrix4, current: Matrix4, frame: number}> = {}
    /**
     * Previous instance matrices per instanced mesh: two float textures, the one written last frame is read by this
     * frame's draw while this frame's matrices go into the other (once per render, for all of the mesh's groups).
     * Without them every instance got the mesh's motion only (camera motion for a static mesh), so TAA and the
     * SSGI/SSR history smeared moving instances.
     */
    private _previousInstanceMatrices: Record<string, {textures: [DataTexture, DataTexture], data: [Float32Array, Float32Array], read: 0 | 1, valid: boolean, capacity: number, frame: number, readNow: DataTexture | null}> = {}

    private _instancePrevious(object: InstancedMesh, frame: number) {
        const capacity = object.instanceMatrix.count
        let e = this._previousInstanceMatrices[object.uuid]
        if (!e || e.capacity !== capacity) {
            if (e) e.textures.forEach(t => t.dispose())
            else (object as any as IObject3D).addEventListener?.('dispose', () => {
                const d = this._previousInstanceMatrices[object.uuid]
                if (d) d.textures.forEach(t => t.dispose())
                delete this._previousInstanceMatrices[object.uuid]
                delete this._previousWorldMatrices[object.uuid]
            })
            // the texture's layout is the instanceMatrix array's: instance i's 16 floats at i * 16
            const width = 4 * Math.min(capacity, 1024), height = Math.ceil(capacity / 1024)
            const data = [new Float32Array(width * height * 4), new Float32Array(width * height * 4)] as const
            const make = (i: 0 | 1) => {
                const t = new DataTexture(data[i], width, height, RGBAFormat, FloatType)
                t.minFilter = t.magFilter = NearestFilter
                t.generateMipmaps = false
                t.name = 'instanceMatrixPrevious'
                return t
            }
            e = this._previousInstanceMatrices[object.uuid] = {textures: [make(0), make(1)], data: [data[0], data[1]], read: 0, valid: false, capacity, frame: -1, readNow: null}
        }
        if (e.frame !== frame) {
            e.frame = frame
            e.readNow = e.valid ? e.textures[e.read] : null
            // this frame's matrices, for the next frame
            const w = 1 - e.read as 0 | 1
            e.data[w].set(object.instanceMatrix.array)
            e.textures[w].needsUpdate = true
            e.read = 1 - e.read as 0 | 1
            e.valid = true
        }
        const u = this.extraUniformsToUpload
        u.instanceMatrixPrevious.value = e.readNow
        u.hasInstanceMatrixPrevious.value = !!e.readNow
    }

    dispose() {
        for (const e of Object.values(this._previousInstanceMatrices)) e.textures.forEach(t => t.dispose())
        this._previousInstanceMatrices = {}
        this._previousWorldMatrices = {}
        super.dispose()
    }

    // this gets called for each object.
    onBeforeRender(_r: WebGLRenderer, _s: Scene, _c: Camera, _geometry: BufferGeometry, object: IObject3D, group: Group) {
        super.onBeforeRender(_r, _s, _c, _geometry, object, group)
        // one velocity render is one renderer.render call: its frame counter tells a new frame from another group's draw
        const frame = _r.info.render.frame
        let world = this._previousWorldMatrices[object.uuid]
        if (!world) world = this._previousWorldMatrices[object.uuid] = {previous: object.matrixWorld.clone(), current: object.matrixWorld.clone(), frame}
        else if (world.frame !== frame) {
            world.previous.copy(world.current)
            world.current.copy(object.matrixWorld)
            world.frame = frame
        }
        this.extraUniformsToUpload.modelMatrixPrevious.value.copy(world.previous)

        if ((object as any).isInstancedMesh) this._instancePrevious(object as any as InstancedMesh, frame)
        else {
            this.extraUniformsToUpload.instanceMatrixPrevious.value = null
            this.extraUniformsToUpload.hasInstanceMatrixPrevious.value = false
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
            if (x === undefined) {
                delete this.defines.USE_ALPHAMAP
                delete this.defines.ALPHAMAP_UV
            } else {
                this.defines.USE_ALPHAMAP = x
                this.defines.ALPHAMAP_UV = 'uv' // uv_vertex needs the channel for vAlphaMapUv, as in GBufferMaterial
            }
            this.needsUpdate = true
        }
        const alphaMap = this.uniforms.alphaMap.value as Texture | null
        if (alphaMap) {
            if (alphaMap.matrixAutoUpdate) alphaMap.updateMatrix()
            this.uniforms.alphaMapTransform.value.copy(alphaMap.matrix)
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
