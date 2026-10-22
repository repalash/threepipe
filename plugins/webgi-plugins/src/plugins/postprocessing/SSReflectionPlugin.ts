import {
    ExtendedShaderPass,
    GBufferPlugin,
    getOrCall,
    getTexelDecoding,
    glsl,
    GLSL3,
    HalfFloatType,
    ICamera,
    IMaterial,
    IPassID,
    IPipelinePass,
    IRenderManager,
    IScene,
    IWebGLRenderer,
    LinearSRGBColorSpace,
    matDefine,
    matDefineBool,
    MaterialExtension,
    onChange,
    Matrix3,
    Matrix4,
    PhysicalMaterial,
    PipelinePassPlugin,
    ProgressivePlugin,
    serialize,
    shaderReplaceString,
    shaderUtils,
    SSAAPlugin,
    Texture,
    TextureDataType,
    ThreeViewer,
    uiConfig,
    uiConfigMaterialExtension,
    uiFolderContainer,
    uiImage,
    uiSlider,
    uiToggle,
    uiVector,
    uniform,
    updateMaterialDefines,
    ValOrFunc,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
// import ssreflPass from './shaders/SSReflectionPlugin.pass.glsl' // todo
// import ssreflPatch from './shaders/SSReflectionPlugin.patch.glsl'
import samplePointHelpers from './shaders/samplePointHelpers.glsl'
import ssrtShader from './shaders/ssrt.glsl'
// import ssrShader from './shaders/ssreflection.glsl'
import ssreflPatch from './shaders/ssrPatch.glsl'
import ssrShaderMain from './shaders/ssreflectionMain.glsl'
import ssrUpsample from './shaders/ssreflectionUpsample.glsl'
import {getShaders} from "../../utils/shaders";
import {VelocityBufferPlugin} from "../buffer/VelocityBufferPlugin";
import {SpatioTemporalDenoiser} from '../../passes/SpatioTemporalDenoiser'
import {writesGBuffer} from '../../utils/writesGBuffer'

export type SSReflectionPluginTarget = WebGLRenderTarget

const passId = 'ssrefl'
type SSReflectionPassId = typeof passId

/**
 * SSReflection Plugin
 *
 * Adds screen space reflections to the scene. Two modes (constructor):
 * - inline (default): every material traces its reflection rays in its own shader;
 * - trace pass (`inlineShaderRayTrace = false`): a full-screen pass traces the rays from the G-buffer (with the
 *   roughness that this plugin writes into the G-buffer flags), and a {@link SpatioTemporalDenoiser} in reflection mode
 *   reprojects and filters them, so the reflections stay clean in motion. Materials that do not write the G-buffer
 *   (glass, alpha-blended) still trace inline.
 * @category Plugins
 */
@uiFolderContainer('SSReflection Plugin')
export class SSReflectionPlugin
    extends PipelinePassPlugin<SSReflectionPluginPass, SSReflectionPassId> {

    readonly passId = passId
    public static readonly PluginType = 'SSReflectionPlugin'
    public static readonly OldPluginType = 'SSReflection'

    dependencies = [GBufferPlugin, SSAAPlugin]

    /**
     * Denoised reflections (trace pass mode), read by the materials.
     */
    target?: SSReflectionPluginTarget
    /**
     * Raw trace output (trace pass mode): the reflections and their hit distance and roughness (always half float).
     */
    rawTarget?: SSReflectionPluginTarget
    /**
     * Half-resolution trace only: the raw trace upsampled to full resolution, the input of the denoiser.
     */
    rawFullTarget?: SSReflectionPluginTarget
    @uiImage('SSReflection Buffer', {readOnly: true, hideOnEmpty: true}) texture?: Texture

    /**
     * Trace pass mode only: traces one pixel of every 2x2 block per frame (a different one each frame) and upsamples
     * with the depth and normals, so the trace costs about a quarter. The denoiser runs at full resolution.
     * On the ssrGloss floor (roughness 0.2-0.5) it was also steadier in camera motion than the full-resolution trace,
     * because the upsample smooths the input of the temporal filter. Mirrors trace inline either way
     * ({@link SSReflectionPluginPass.mirrorRoughness}), so the lower resolution does not blur them.
     */
    @uiToggle('Half-resolution trace', (that: SSReflectionPlugin)=>({hidden: ()=>that.inlineShaderRayTrace}))
    @onChange(SSReflectionPlugin.prototype._halfResolutionTraceChanged)
    @serialize() halfResolutionTrace = true

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: SSReflectionPluginPass

    // @onChange2(SSReflectionPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @onChange2(SSReflectionPlugin.prototype._createTarget)
    // @uiSlider('Buffer Size Multiplier', [0.25, 2.0], 0.25)
    readonly sizeMultiplier: number // cannot be changed after creation (for now)


    constructor(
        // previously inlineSSR
        public readonly inlineShaderRayTrace = true, // todo: we need roughness in gbuffer for proper inline. this has other advantages also like we can do blurring and denoising etc
        bufferType: TextureDataType = HalfFloatType, // only when inline is false
        sizeMultiplier = 1, // only when inline is false; must be 1 (see below)
        enabled = true,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        if (!inlineShaderRayTrace && sizeMultiplier !== 1) {
            // The passes sample the packed G-buffer (depth and normal in 8-bit pairs, linear filtering) at their own
            // pixel centers; at another size those fall between G-buffer texels and the interpolated bytes give wrong
            // depths and normals (the reflections blew up to white at 0.5). halfResolutionTrace is the cheaper trace.
            console.warn('SSReflectionPlugin: the trace pass mode needs sizeMultiplier 1; use halfResolutionTrace for a cheaper trace')
            sizeMultiplier = 1
        }
        this.sizeMultiplier = sizeMultiplier
    }

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()
        if (this.inlineShaderRayTrace) return // no need to create.
        const options = {
            depthBuffer: false,
            type: this.bufferType,
            sizeMultiplier: this.sizeMultiplier,
            colorSpace: LinearSRGBColorSpace,
            generateMipmaps: false,
        }
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<SSReflectionPluginTarget>(options)
        // 2 textures: the reflections, and their hit distance and roughness (see ssreflectionMain.glsl)
        const rawOptions = {...options, type: HalfFloatType, textureCount: 2}
        if (!this.rawTarget)
            this.rawTarget = this._viewer.renderManager.createTarget<SSReflectionPluginTarget>({
                ...rawOptions, sizeMultiplier: this.sizeMultiplier * (this.halfResolutionTrace ? 0.5 : 1)})
        if (!this.rawFullTarget && this.halfResolutionTrace)
            this.rawFullTarget = this._viewer.renderManager.createTarget<SSReflectionPluginTarget>(rawOptions)
        this.texture = this.target.texture
        this.texture.name = 'ssreflBuffer'
        this.rawTarget.textures[0].name = 'ssreflRaw'
        this.rawTarget.textures[1].name = 'ssreflRawData'

        // if (this._pass) this._pass.target = this.target
    }

    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this._disposeRawTargets()
        this.texture = undefined
    }

    protected _disposeRawTargets() {
        if (!this._viewer) return
        if (this.rawTarget) {
            this._viewer.renderManager.disposeTarget(this.rawTarget)
            this.rawTarget = undefined
        }
        if (this.rawFullTarget) {
            this._viewer.renderManager.disposeTarget(this.rawFullTarget)
            this.rawFullTarget = undefined
        }
    }

    protected _halfResolutionTraceChanged() {
        if (!this._viewer || this.inlineShaderRayTrace) return
        this._disposeRawTargets()
        this._createTarget(false)
        this._pass?.denoiser?.reset()
        this.setDirty()
    }

    private _gbufferUnpackExtension = undefined as MaterialExtension|undefined
    private _gbufferUnpackExtensionChanged = ()=>{
        if (!this._pass || !this._viewer) throw new Error('SSReflectionPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(undefined)
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(this._gbufferUnpackExtension)
        else this._viewer.console.warn('SSReflectionPlugin: GBuffer unpack extension removed')
    }

    protected _createPass() {
        if (!this._viewer) throw new Error('SSReflectionPlugin: viewer not set')
        if (!this._viewer.renderManager.gbufferTarget || !this._viewer.renderManager.gbufferUnpackExtension)
            throw new Error('SSReflectionPlugin: GBuffer target not created. GBufferPlugin is required.')
        this._createTarget(true)
        const pass = new SSReflectionPluginPass(this.passId, ()=>this.target, this.inlineShaderRayTrace, this.sizeMultiplier)
        pass.rawTarget = ()=>this.rawTarget
        pass.rawFullTarget = ()=>this.rawFullTarget
        pass.normalDepthTexture = ()=>this._viewer?.renderManager.gbufferTarget?.texture
        return pass
    }

    /**
     * Trace pass mode: writes the roughness of every surface (material roughness times the roughness map) into the
     * G-buffer flags channel x, which is otherwise unused, so the trace pass and the denoiser know the reflection lobe.
     */
    private _roughnessUniform = {value: 1}
    private _roughnessMapUniform = {value: null as Texture|null}
    private _roughnessMapTransformUniform = {value: new Matrix3()}
    readonly gbufferRoughnessExtension: MaterialExtension = {
        extraUniforms: {
            ssrGBufferRoughness: this._roughnessUniform,
            roughnessMap: this._roughnessMapUniform,
            roughnessMapTransform: this._roughnessMapTransformUniform,
        },
        parsFragmentSnippet: `
uniform float ssrGBufferRoughness;
#include <roughnessmap_pars_fragment>
`,
        shaderExtender: (shader) => {
            // the threepipe build minifies its shaders (`gFlags=flags;`), so match any whitespace
            const write = /gFlags\s*=\s*flags\s*;/
            if (!write.test(shader.fragmentShader)) return
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, write, `
    float ssrRoughness = ssrGBufferRoughness;
    #ifdef USE_ROUGHNESSMAP
    ssrRoughness *= texture2D(roughnessMap, vRoughnessMapUv).g;
    #endif
    // geometric roughness floor, after the map as in the three.js physical material
    gFlags = vec4(max(ssrRoughness, 0.0525), flags.yzw);`)
        },
        onObjectRender: (object, material, renderer) => {
            let source = (object as any).material as (IMaterial & Partial<PhysicalMaterial>) | (IMaterial & Partial<PhysicalMaterial>)[] | undefined
            if (Array.isArray(source)) source = source[0]
            if (source === material) source = (object as any).currentMaterial
            if (Array.isArray(source)) source = source[0]
            const physical = !!source && typeof source.roughness === 'number'
            // A mirror-like material traces inline (SSReflectionPluginPass.mirrorRoughness): roughness 1 makes the
            // trace pass skip its pixels. Not on a multi-material mesh: the G-buffer writes its first material for all
            // of its groups, and the other groups still read the trace pass.
            const multiMaterial = Array.isArray((object as any).material)
            const mirror = physical && !multiMaterial && source!.roughness! < (this._pass?.mirrorRoughness ?? 0)
            this._roughnessUniform.value = physical && !mirror ? source!.roughness! : 1
            const map = physical && !mirror ? source!.roughnessMap ?? null : null
            this._roughnessMapUniform.value = map
            if (map) renderer.materials.refreshTransformUniform(map, this._roughnessMapTransformUniform)
            const channel = map?.channel ?? 0
            updateMaterialDefines({
                ['USE_ROUGHNESSMAP']: map ? 1 : undefined,
                ['ROUGHNESSMAP_UV']: map ? 'uv' + (channel ? channel : '') : undefined,
                // three declares the uv1-3 attributes only with these defines, which it sets from a material's own maps
                ['USE_UV1']: map && channel === 1 ? 1 : undefined,
                ['USE_UV2']: map && channel === 2 ? 1 : undefined,
                ['USE_UV3']: map && channel === 3 ? 1 : undefined,
            }, material)
        },
        computeCacheKey: 'ssrGBufferRoughness',
        uuid: 'SSReflectionGBufferRoughness',
        isCompatible: () => true,
    }


    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo why?
        if (viewer.getPlugin('Ground') || viewer.getPlugin('BaseGroundPlugin')) console.warn('GroundPlugin must be added after SSReflectionPlugin')
        this._gbufferUnpackExtensionChanged()
        viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        viewer.forPlugin(VelocityBufferPlugin, (vbp) => {
            this._pass?.material.registerMaterialExtensions([vbp.unpackExtension])
            this._pass?.denoiser?.setVelocityUnpackExtension(vbp.unpackExtension)
        }, (vbp)=>{
            this._pass?.material?.unregisterMaterialExtensions([vbp.unpackExtension])
            this._pass?.denoiser?.setVelocityUnpackExtension(undefined, vbp.unpackExtension)
        }, this)
        if (!this.inlineShaderRayTrace) viewer.getPlugin(GBufferPlugin)?.material?.registerMaterialExtensions([this.gbufferRoughnessExtension])
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.getPlugin(GBufferPlugin)?.material?.unregisterMaterialExtensions([this.gbufferRoughnessExtension])
        this._pass?.denoiser?.dispose(viewer.renderManager)
        this._pass?.upsamplePass?.dispose()
        this._disposeTarget()
        viewer.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        return super.onRemove(viewer)
    }

    protected _beforeRender(_?: IScene, _1?: ICamera, _2?: IRenderManager): boolean {
        if (!this._viewer) return false
        const e = super._beforeRender(_, _1, _2)
        if(!e) return e
        const progressive = this._viewer.getPlugin(ProgressivePlugin)
        this._pass?.updateShaderProperties([progressive])
        return e
    }

    /**
     * @deprecated use {@link target} instead
     */
    get ssrTarget() {
        console.warn('SSReflectionPlugin: ssrTarget is deprecated, use target instead')
        return this.target
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // legacy
        if (data.passes?.ssr) {
            data = {...data}
            data.pass = data.passes.ssr
            delete data.passes
            if (data.pass.enabled !== undefined) data.enabled = data.pass.enabled
        }
        return super.fromJSON(data, meta)
    }

    _viewerListeners = {
        preRender: ()=>{
            if(!this._viewer || this.isDisabled()) return
            if(!this._pass) return

            const renderCamera = this._viewer.scene.renderCamera
            this._pass.uniforms.currentProjectionViewMatrix.value.multiplyMatrices(renderCamera.projectionMatrix, renderCamera.matrixWorldInverse)
            this._pass.uniforms.inverseViewMatrix.value.copy(renderCamera.matrixWorld)
        },
        postRender: ()=>{
            if(!this._viewer || this.isDisabled()) return
            if(!this._pass) return

            this._pass.uniforms.lastProjectionViewMatrix.value.copy(this._pass.uniforms.currentProjectionViewMatrix.value)
        }
    }

}

// Half-resolution trace: the pixel of each 2x2 block traced in a frame, cycling over 4 frames (diagonal first).
const traceOffsets = [new Vector2(0, 0), new Vector2(1, 1), new Vector2(1, 0), new Vector2(0, 1)]

@uiFolderContainer('SSReflection Pass')
export class SSReflectionPluginPass extends ExtendedShaderPass implements IPipelinePass {
    before = ['render']
    after = ['gbuffer', 'depth', 'velocityBuffer'] // the velocity buffer of this frame is needed by the denoiser
    required = ['render', 'progressive'] // gbuffer required check done in plugin.

    /**
     * Trace pass mode: denoises the raw reflections into {@link target}. Created in both modes so its settings are saved
     * with the scene; it allocates its targets only when it renders (trace pass mode).
     */
    @uiConfig(undefined, {label: 'Denoiser', params: (that: SSReflectionPluginPass)=>({hidden: ()=>that.inlineShaderRayTrace})})
    @serialize() readonly denoiser: SpatioTemporalDenoiser
    /**
     * Trace pass mode only: upsamples a half-resolution trace (see {@link SSReflectionPlugin.halfResolutionTrace}).
     */
    readonly upsamplePass?: ExtendedShaderPass
    rawTarget?: ValOrFunc<WebGLRenderTarget|undefined>
    rawFullTarget?: ValOrFunc<WebGLRenderTarget|undefined>
    normalDepthTexture?: ValOrFunc<Texture|undefined>

    private _camera?: ICamera
    private _lastFrame = -2

    @uiSlider('Intensity', [0, 4])
    @serialize() @uniform() intensity = 1

    @uiVector('Boost')
    @serialize() @uniform() boost = new Vector3(1, 1, 1)

    @uiSlider('Object Radius', [0.01, 2.])
    @serialize() @uniform() objectRadius = 1

    @uiToggle('Auto radius') @serialize() @uniform() autoRadius = true

    @uiSlider('Power', [0, 3])
    @serialize() @uniform() power = 1.1

    @uiSlider('Tolerance', [0.1, 5])
    @serialize() @uniform() tolerance = 0.5

    @uiSlider('Roughness Factor', [0.1, 1.25])
    @serialize() @uniform({propKey: 'ssrRoughnessFactor'}) roughnessFactor = 1

    @uiSlider('Step count', [1, 32], 1, {tags: ['performance']})
    @serialize()
    @matDefine('SSR_STEP_COUNT', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        stepCount = 16

    @uiSlider('Ray count', [1, 8], 1, {tags: ['performance']})
    @serialize()
    @matDefine('SSR_RAY_COUNT', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        rayCount = 1

    @uiToggle('Ray Blend MAX')
    @serialize()
    @matDefineBool('SSR_RAY_BLEND_MAX', undefined, undefined, SSReflectionPluginPass.prototype.setDirty, true)
        rayBlendMax = false

    setDirty() {
        this.materialExtension?.setDirty?.()
        super.setDirty();
    }

    @uiSlider('Low Quality Frames', [0, 4], 1)
    @serialize()
    @matDefine('SSR_LOW_QUALITY_FRAMES', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        lowQualityFrames = 0

    @uiToggle('Ignore front rays')
    @serialize()
    @matDefineBool('SSR_MASK_FRONT_RAYS', undefined, undefined, SSReflectionPluginPass.prototype.setDirty)
        maskFrontRays = true

    @uiSlider('Mask front rays factor', [-1, 1], 0.01, (that: SSReflectionPluginPass)=>({hidden: () => !that.maskFrontRays}))
    @serialize() @uniform() maskFrontFactor = -0.2
    public readonly passId: IPassID

    /**
     * Trace pass mode only: materials with a lower roughness trace inline in their own shader. A mirror needs no
     * denoiser (its rays hardly differ), and the inline trace keeps its full detail (exact normals, no filtering).
     * 0 sends every material that writes the G-buffer through the trace pass.
     */
    @uiSlider('Inline below roughness', [0, 0.5], 0.01, (that: SSReflectionPluginPass)=>({hidden: ()=>that.inlineShaderRayTrace}))
    @onChange(SSReflectionPluginPass.prototype.setDirty)
    @serialize() mirrorRoughness = 0.1

    @uiSlider('Split', [0, 1], 0.01, {tags: ['debug']})
    @serialize() @uniform({propKey: 'ssrSplitX', onChange: SSReflectionPluginPass.prototype.setDirty})
    split = 0

    constructor(pid: IPassID,
                public target?: ValOrFunc<WebGLRenderTarget|undefined>,
                public readonly inlineShaderRayTrace = true,
                sizeMultiplier = 1) {
        super({
            glslVersion: GLSL3, // the trace pass writes two outputs (see ssreflectionMain.glsl)
            defines: {
                ['SSR_STEP_COUNT']: 16,
                ['SSR_RAY_COUNT']: 4,
                ['SSR_RAY_BLEND_MAX']: 0,
                ['SSR_LOW_QUALITY_FRAMES']: 0, // todo: only on mobile
                ['SSR_INLINE']: inlineShaderRayTrace ? '1' : '0',
                // ['SSR_NON_PHYSICAL']: '0', only in inline, so it should not be here
                ['SSR_MASK_FRONT_RAYS']: true,
                ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
                // ['SSREFL_PACKING']: 1, // 1 is (r: ssrefl, gba: depth), 2 is (rgb: ssrefl, a: 1), 3 is (rgba: packed_ssrefl), 4 is (rgb: packed_ssrefl, a: 1)
            },
            uniforms: {
                tLastFrame: {value: null}, // set in progressive plugin
                // TODO required?
                screenSize: {value: new Vector2(0, 0)}, // set in ExtendedRenderMaterial
                currentFrameCount: {value: 0}, // set in RenderManager
                frameCount: {value: 0}, // set in RenderManager
                ssrFrameIndex: {value: 0}, // seeds the ray noise, set in beforeRender
                cameraNearFar: {value: new Vector2(0.1, 1000)}, // set in PerspectiveCamera2
                cameraPositionWorld: {value: new Vector3()}, // set in PerspectiveCamera2
                projection: {value: new Matrix4()}, // set in PerspectiveCamera2
                // saoBiasEpsilon: {value: new Vector3(1, 1, 1)},

                opacity: {value: 1}, // todo?
                intensity: {value: 0.},
                boost: {value: new Vector3(0, 0, 0)},
                objectRadius: {value: 0},
                autoRadius: {value: false},
                power: {value: 0},
                maskFrontFactor: {value: -0.1},
                tolerance: {value: 0},
                ssrRoughnessFactor: {value: 1},
                sceneBoundingRadius: {value: 0}, // todo do same in SSAO

                // reprojection/velocity
                currentProjectionViewMatrix: {value: new Matrix4()},
                lastProjectionViewMatrix: {value: new Matrix4()},
                inverseViewMatrix: {value: new Matrix4()},

                // split mode
                ssrSplitX: {value: 0.5},

                // half-resolution trace (ssreflectionMain.glsl)
                traceOffset: {value: new Vector2()},
                traceFullSize: {value: new Vector2()},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: `
varying vec2 vUv;

// for gbuffer
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>
#include <randomHelpers>
${samplePointHelpers}

${ssrtShader}

${getShaders().ssReflection}

${ssrShaderMain}
            `,

        }, 'tDiffuse', 'tLastFrame')
        this.passId = pid

        this.needsSwap = false
        this.clear = true // todo

        this.denoiser = new SpatioTemporalDenoiser(HalfFloatType, sizeMultiplier, true)
        if (!inlineShaderRayTrace) {
            this.upsamplePass = new ExtendedShaderPass({
                glslVersion: GLSL3,
                vertexShader: shaderUtils.defaultVertex,
                fragmentShader: `
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>
${ssrUpsample}`,
                uniforms: {
                    tHalf: {value: null},
                    tHalfData: {value: null},
                    traceOffset: {value: new Vector2()},
                    fullSize: {value: new Vector2()},
                    cameraNearFar: {value: new Vector2(0.1, 1000)},
                    projection: {value: new Matrix4()},
                },
                defines: {
                    ['PERSPECTIVE_CAMERA']: 1,
                },
            }, 'tHalf')
            this.upsamplePass.clear = false
        }

        {
            // Uniforms of the inline trace. Also needed in trace pass mode: materials that do not write the G-buffer trace inline.
            Object.assign(this.materialExtension.extraUniforms!, {
                tNormalDepth: this.material.uniforms.tNormalDepth,
                tLastFrame: this.material.uniforms.tLastFrame,
                objectRadius: this.material.uniforms.objectRadius,
                autoRadius: this.material.uniforms.autoRadius,
                tolerance: this.material.uniforms.tolerance,
                ssrRoughnessFactor: this.material.uniforms.ssrRoughnessFactor,
                frameCount: this.material.uniforms.frameCount,
                currentFrameCount: this.material.uniforms.currentFrameCount,
                ssrFrameIndex: this.material.uniforms.ssrFrameIndex,
                projection: this.material.uniforms.projection,
                cameraPositionWorld: this.material.uniforms.cameraPositionWorld,
                cameraNearFar: this.material.uniforms.cameraNearFar,

                sceneBoundingRadius: this.material.uniforms.sceneBoundingRadius,

                // reprojection
                currentProjectionViewMatrix: this.material.uniforms.currentProjectionViewMatrix,
                lastProjectionViewMatrix: this.material.uniforms.lastProjectionViewMatrix,
                inverseViewMatrix: this.material.uniforms.inverseViewMatrix,

                ssrSplitX: this.material.uniforms.ssrSplitX,
            })
        }
        // this._getUiConfig = this._getUiConfig.bind(this)
    }

    render(renderer: IWebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        this.needsSwap = false
        if (!this.enabled || this.inlineShaderRayTrace || !this.denoiser) return
        const rm = renderer.renderManager
        const target = getOrCall(this.target)
        const raw = getOrCall(this.rawTarget)
        const normalDepth = getOrCall(this.normalDepthTexture)
        if (!target || !raw || !normalDepth || !this._camera) {
            console.warn('SSReflectionPluginPass: target, G-buffer or camera not available.')
            return
        }
        // After skipped frames the history is from an older view: start over.
        if (rm.totalFrameCount - this._lastFrame > 1) this.denoiser.reset()
        this._lastFrame = rm.totalFrameCount

        // Trace into the raw target: the reflections, and their hit distance and roughness. A half-resolution trace
        // covers one pixel of every 2x2 block, a different one each frame, and is upsampled before the denoiser.
        const rawFull = this.upsamplePass ? getOrCall(this.rawFullTarget) : undefined
        const offset = traceOffsets[rm.totalFrameCount % 4]
        this.uniforms.traceOffset.value.copy(offset)
        if (rawFull) this.uniforms.traceFullSize.value.set(rawFull.width, rawFull.height)
        else this.uniforms.traceFullSize.value.set(0, 0)
        super.render(renderer, raw, readBuffer, deltaTime, maskActive)

        let input = raw
        if (rawFull && this.upsamplePass) {
            const u = this.upsamplePass.uniforms
            u.tHalfData.value = raw.textures[1]
            u.traceOffset.value.copy(offset)
            u.fullSize.value.set(rawFull.width, rawFull.height)
            this._camera.updateShaderProperties(this.upsamplePass.material)
            this.upsamplePass.material.uniformsNeedUpdate = true
            this.upsamplePass.render(renderer, rawFull, raw)
            input = rawFull
        }

        // Denoise into the target that the materials read.
        this.denoiser.reflectionData = input.textures[1]
        this.denoiser.render(renderer, input, target, normalDepth, this._camera, rm.frameCount > 0)
    }

    beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        this._camera = camera
        this.updateShaderProperties([scene, camera, renderManager])
        // The ray noise must change on every frame, moving or still. frameCount is 0 on every moving frame with
        // renderManager.stableNoise, so noise seeded with it repeats in motion and TAA cannot average it out.
        this.uniforms.ssrFrameIndex.value = renderManager.totalFrameCount % 4096
    }

    readonly materialExtension: MaterialExtension = {
        extraUniforms: {
            tSSReflMap: ()=>({value: getOrCall(this.target)?.texture ?? null}),
            ssrPower: this.material.uniforms.power,
            ssrIntensity: this.material.uniforms.intensity,
            ssrMaskFrontFactor: this.material.uniforms.maskFrontFactor,
            ssrBoost: this.material.uniforms.boost,
        },
        extraDefines: {
            ['SSR_STEP_COUNT']: ()=>this.material.defines.SSR_STEP_COUNT,
            ['SSR_RAY_COUNT']: ()=>this.material.defines.SSR_RAY_COUNT,
            ['SSR_RAY_BLEND_MAX']: ()=>this.material.defines.SSR_RAY_BLEND_MAX,
            ['SSR_LOW_QUALITY_FRAMES']: ()=>this.material.defines.SSR_LOW_QUALITY_FRAMES,
            // SSR_INLINE is set per material in onObjectRender
            ['SSR_MASK_FRONT_RAYS']: ()=>this.material.defines.SSR_MASK_FRONT_RAYS,
            ['PERSPECTIVE_CAMERA']: ()=>this.material.defines.PERSPECTIVE_CAMERA,
            // todo gbuffer stuff
        },
        shaderExtender: (shader, _material, _renderer) => {
            if (!shader.defines?.SSREFL_ENABLED) return
            const ls = `

            ${ssreflPatch}

            // reflectedLight.directDiffuse = vec3(0.);
            // reflectedLight.indirectDiffuse = vec3(0.);
            // reflectedLight.directSpecular = vec3(0.);
            // reflectedLight.indirectSpecular = vec3(0.);

            `
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                '#glMarker beforeModulation', ls, {prepend: true})

            this._gbufferUnpackExtension?.shaderExtender?.(shader, _material, _renderer)
        },
        onObjectRender: (_object, material, renderer: IWebGLRenderer) => {
            let x: any = this.enabled &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.pluginsDisabled &&
            !material.userData?.ssreflDisabled ? this.split > 0 ? 2 : 1 : 0

            if (material.defines!.SSREFL_ENABLED !== x) {
                material.defines!.SSREFL_ENABLED = x
                material.needsUpdate = true
            }
            x = material.userData?.ssreflNonPhysical ? 1 : 0
            if (material.defines!.SSR_NON_PHYSICAL !== x) {
                material.defines!.SSR_NON_PHYSICAL = x
                material.needsUpdate = true
            }
            // Trace pass mode: a material reads the denoised reflections where the G-buffer holds its surface, and
            // traces inline where it does not (glass, alpha-blended) and where it is a mirror (below mirrorRoughness).
            x = this.inlineShaderRayTrace || !writesGBuffer(material) ||
                ((material as Partial<PhysicalMaterial>).roughness ?? 1) < this.mirrorRoughness ? 1 : 0
            if (material.defines!.SSR_INLINE !== x) {
                material.defines!.SSR_INLINE = x
                material.needsUpdate = true
            }
        },
        parsFragmentSnippet: ()=>glsl`
            #if defined(SSREFL_ENABLED) && SSREFL_ENABLED > 0
            uniform float ssrPower;
            uniform float ssrIntensity;
            uniform float ssrMaskFrontFactor;
            uniform vec3 ssrBoost;
            uniform sampler2D tSSReflMap;
            uniform sampler2D tLastFrame;
            ${getTexelDecoding('tSSReflMap', getOrCall(this.target)?.texture.colorSpace)}
            ${getTexelDecoding('tLastFrame', this.material.uniforms!.tLastFrame.value?.colorSpace)}
            #if defined(SSREFL_ENABLED) && SSREFL_ENABLED == 2
            #if !defined(SSR_INLINE)
            uniform float ssrSplitX;
            #elif SSR_INLINE == 0
            uniform float ssrSplitX; // the inline trace declares it in ssreflection.glsl
            #endif
            #endif
            #if defined(SSR_INLINE) && SSR_INLINE > 0
#define THREE_PACKING_INCLUDED // by threejs
#include <cameraHelpers>
#include <randomHelpers>
${samplePointHelpers}
${ssrtShader}
${getShaders().ssReflection}
            #endif
            #include <simpleCameraHelpers>
            #endif
        `,
        computeCacheKey: () => {
            return (this.enabled ? '1' : '0') + getOrCall(this.target)?.texture?.colorSpace + Object.values(this.material.defines).map(v=>v + '').join(',')
        },
        uuid: SSReflectionPlugin.PluginType,
        ...uiConfigMaterialExtension(this._getUiConfig.bind(this), SSReflectionPlugin.PluginType),
        isCompatible: material => {
            return (material as PhysicalMaterial).isPhysicalMaterial
        },
    }

    /**
     * Returns a uiConfig to toggle SSReflection on a material.
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    protected _getUiConfig(material: IMaterial) {
        return {
            type: 'folder',
            label: 'SSReflection',
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return !(material.userData.ssreflDisabled ?? false)
                    },
                    set value(v) {
                        if (v === !(material.userData.ssreflDisabled ?? false)) return
                        material.userData.ssreflDisabled = !v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
                {
                    type: 'checkbox',
                    label: 'Non Physical',
                    get value() {
                        return material.userData.ssreflNonPhysical ?? false
                    },
                    set value(v) {
                        if (v === (material.userData.ssreflNonPhysical ?? false)) return
                        material.userData.ssreflNonPhysical = v
                        material.setDirty()
                    },
                    onChange: this.setDirty,
                },
            ],
        }
    }

    set uniformsNeedUpdate(value: true) {
        this.material.uniformsNeedUpdate = value
        this.setDirty()
    }

    protected _gbufferUnpackExtension: MaterialExtension|undefined
    setGBufferUnpackExtension(extension: MaterialExtension|undefined) {
        if (this._gbufferUnpackExtension === extension) return
        const old = this._gbufferUnpackExtension
        if (old) this.material.unregisterMaterialExtensions([old])
        this.denoiser?.setGBufferUnpackExtension(extension, old)
        if (old) this.upsamplePass?.material.unregisterMaterialExtensions([old])
        if (extension) this.upsamplePass?.material.registerMaterialExtensions([extension])
        this._gbufferUnpackExtension = extension
        if (this._gbufferUnpackExtension) this.material.registerMaterialExtensions([this._gbufferUnpackExtension])

        if (!this._gbufferUnpackExtension) return

        // todo not possible to remove it?
        Object.assign(this.materialExtension.extraUniforms!, this._gbufferUnpackExtension.extraUniforms)
        Object.assign(this.materialExtension.extraDefines!, this._gbufferUnpackExtension.extraDefines)
    }
}

declare module 'threepipe' {
    interface IMaterialUserData {
        /**
         * Disable SSReflectionPlugin for this material.
         */
        ssreflDisabled?: boolean // default false
        ssreflNonPhysical?: boolean // default false
        // [SSReflectionPlugin.PluginType]?: {
        //     enable?: boolean
        //     nonPhysical?: boolean
        // }
    }
}
