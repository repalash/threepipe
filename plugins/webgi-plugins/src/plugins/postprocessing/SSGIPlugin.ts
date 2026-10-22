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
    Matrix4,
    PhysicalMaterial,
    PipelinePassPlugin,
    ProgressivePlugin,
    serialize,
    shaderReplaceString,
    shaderUtils,
    SSAAPlugin,
    SSAOPlugin,
    Texture,
    TextureDataType,
    ThreeViewer,
    uiConfig,
    uiConfigMaterialExtension,
    uiDropdown,
    uiFolderContainer,
    uiImage,
    uiSlider,
    uiToggle,
    uniform,
    ValOrFunc,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
import samplePointHelpers from './shaders/samplePointHelpers.glsl'
import ssgiTrace from './shaders/ssgiTrace.glsl'
import ssgiPatch from './shaders/giPatch.glsl'
import {SpatioTemporalDenoiser} from '../../passes/SpatioTemporalDenoiser'
import {RadianceCascadesGI} from '../../passes/RadianceCascadesGI'
import {SkyVisibilityVolume} from '../../passes/SkyVisibilityVolume'
import {VelocityBufferPlugin} from '../buffer/VelocityBufferPlugin'

export type SSGIPluginTarget = WebGLRenderTarget

const passId = 'ssrtgi'
type SSGIPassId = typeof passId

/**
 * SSGI Plugin
 *
 * Adds screen space global illumination (one bounce per frame, so light bounces accumulate over frames) and
 * ambient occlusion to physical materials. Each frame traces a few rays per pixel, then a spatiotemporal
 * denoiser reprojects the history (with the {@link VelocityBufferPlugin} when present) and filters the result,
 * so the GI stays stable while the camera and objects move.
 * @category Plugins
 */
@uiFolderContainer('SSGI Plugin')
export class SSGIPlugin
    extends PipelinePassPlugin<SSGIPluginPass, SSGIPassId> {

    readonly passId = passId
    public static readonly PluginType = 'SSGIPlugin'
    public static readonly OldPluginType = 'SSGI'

    dependencies = [GBufferPlugin, SSAAPlugin]

    /**
     * Denoised GI (rgb) and occlusion (a), read by the materials.
     */
    target?: SSGIPluginTarget
    /**
     * Raw trace output of the current frame: the noisy signal and its temporal gradient (always half float).
     */
    rawTarget?: SSGIPluginTarget
    @uiImage('SSGI Buffer', {readOnly: true}) texture?: Texture

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: SSGIPluginPass

    // @onChange2(SSGIPlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    // @onChange2(SSGIPlugin.prototype._createTarget)
    // @uiSlider('Buffer Size Multiplier', [0.25, 2.0], 0.25)
    readonly sizeMultiplier: number // cannot be changed after creation (for now)


    constructor(
        bufferType: TextureDataType = HalfFloatType,
        sizeMultiplier = 1,
        enabled = true,
    ) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
        this.sizeMultiplier = sizeMultiplier
    }

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()
        const options = {
            depthBuffer: false,
            type: this.bufferType,
            sizeMultiplier: this.sizeMultiplier,
            colorSpace: LinearSRGBColorSpace,
            generateMipmaps: false,
        }
        if (!this.target)
            this.target = this._viewer.renderManager.createTarget<SSGIPluginTarget>(options)
        // 2 textures: the traced signal and its temporal gradient (see ssgiTrace.glsl). Half float whatever the GI buffer
        // type: the gradient is signed, and an 8-bit target would drop every decrease of the light.
        if (!this.rawTarget)
            this.rawTarget = this._viewer.renderManager.createTarget<SSGIPluginTarget>({...options, type: HalfFloatType, textureCount: 2})
        this.texture = this.target.texture
        this.texture.name = 'ssgiBuffer'
        this.rawTarget.textures[0].name = 'ssgiRawBuffer'
        this.rawTarget.textures[1].name = 'ssgiRawGradient'
    }

    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        if (this.rawTarget) {
            this._viewer.renderManager.disposeTarget(this.rawTarget)
            this.rawTarget = undefined
        }
        this.texture = undefined
    }

    private _gbufferUnpackExtension = undefined as MaterialExtension|undefined
    private _gbufferUnpackExtensionChanged = ()=>{
        if (!this._pass || !this._viewer) throw new Error('SSGIPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(undefined)
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this._pass.setGBufferUnpackExtension(this._gbufferUnpackExtension)
        else this._viewer.console.warn('SSGIPlugin: GBuffer unpack extension removed')
    }

    protected _createPass() {
        if (!this._viewer) throw new Error('SSGIPlugin: viewer not set')
        if (!this._viewer.renderManager.gbufferTarget || !this._viewer.renderManager.gbufferUnpackExtension)
            throw new Error('SSGIPlugin: GBuffer target not created. GBufferPlugin is required.')
        this._createTarget(true)
        const pass = new SSGIPluginPass(this.passId, ()=>this.target, true, this.sizeMultiplier)
        pass.rawTarget = ()=>this.rawTarget
        pass.normalDepthTexture = ()=>this._viewer?.renderManager.gbufferTarget?.texture
        return pass
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo why?
        if (viewer.getPlugin('Ground') || viewer.getPlugin('BaseGroundPlugin')) console.warn('GroundPlugin must be added after SSGIPlugin')

        // todo updateGBufferFlags like in SSAOPlugin

        this._gbufferUnpackExtensionChanged()
        viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        viewer.forPlugin(VelocityBufferPlugin, (vbp) => {
            this._pass?.material.registerMaterialExtensions([vbp.unpackExtension])
            this._pass?.denoiser.setVelocityUnpackExtension(vbp.unpackExtension)
            this._pass?.cascades.setVelocityUnpackExtension(vbp.unpackExtension)
        }, (vbp)=>{
            this._pass?.material?.unregisterMaterialExtensions([vbp.unpackExtension])
            this._pass?.denoiser.setVelocityUnpackExtension(undefined, vbp.unpackExtension)
            this._pass?.cascades.setVelocityUnpackExtension(undefined, vbp.unpackExtension)
        }, this)
    }

    onRemove(viewer: ThreeViewer): void {
        this._disposeTarget()
        this._pass?.disposeHistory(viewer.renderManager)
        this._pass?.denoiser.dispose(viewer.renderManager)
        this._pass?.cascades.dispose(viewer.renderManager)
        viewer.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        return super.onRemove(viewer)
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // legacy
        if (data.passes?.ssrtgi) {
            data = {...data}
            data.pass = data.passes.ssrtgi
            delete data.passes
            if (data.pass.enabled !== undefined) data.enabled = data.pass.enabled
        }
        // Saved before the spatiotemporal denoiser (they carry the removed bilateralPass): map the old defaults
        // to the new ones. The new estimator is physically scaled, so the old intensity 2 becomes 1, and the
        // old default falloff 0.7 becomes 0 (no falloff).
        if (data.pass?.bilateralPass !== undefined) {
            data = {...data, pass: {...data.pass}}
            delete data.pass.bilateralPass
            if (typeof data.pass.intensity === 'number') data.pass.intensity /= 2
            if (data.pass.falloff === 0.7) data.pass.falloff = 0
        }
        return super.fromJSON(data, meta)
    }

    protected _beforeRender(_?: IScene, _1?: ICamera, _2?: IRenderManager): boolean {
        if (!this._viewer) return false
        const e = super._beforeRender(_, _1, _2)
        // SSGI computes its own occlusion, so SSAO on top would darken twice. SSAO comes back when SSGI is off.
        const ssao = this._viewer.getPlugin<SSAOPlugin>('SSAOPlugin')
        if (ssao) {
            if (e) ssao.disable(SSGIPlugin.PluginType)
            else ssao.enable(SSGIPlugin.PluginType)
        }
        if (!e) return e

        const progressive = this._viewer.getPlugin(ProgressivePlugin)
        this._pass?.updateShaderProperties([progressive])

        return e
    }

    /**
     * @deprecated use {@link target} instead
     */
    get rtgiTarget() {
        console.warn('SSGIPlugin: rtgiTarget is deprecated, use target instead')
        return this.target
    }

}

/**
 * Whether the G-buffer holds the surface of this material (the rules of GBufferRenderPass.preprocessMaterial). The
 * SSGI buffer at a pixel belongs to the surface in the G-buffer; applied to a surface in front of it, such as glass
 * (transmission) or alpha-blended materials, it would show the occlusion of what is behind that surface.
 */
function writesGBuffer(material: IMaterial) {
    const ud = material.userData
    if (ud.pluginsDisabled) return false
    const render = ud.renderToDepth ?? ud.renderToGBuffer
    if (material.transparent) return !!render || material.opacity > 0.99 && !material.map && !material.alphaMap
    if (Math.abs((material as PhysicalMaterial).transmission || 0) > 0) return !!render
    return render !== false
}

@uiFolderContainer('SSGI Pass')
export class SSGIPluginPass extends ExtendedShaderPass implements IPipelinePass {
    before = ['render']
    after = ['gbuffer', 'depth', 'velocityBuffer'] // the velocity buffer of this frame is needed for reprojection
    required = ['render', 'progressive'] // gbuffer required check done in plugin.

    /**
     * How the GI buffer is computed: 0 = SSGI (noisy rays + spatiotemporal denoiser), 1 = screen-space radiance
     * cascades (proof of concept, IJ-851: no noise, no history).
     */
    @uiDropdown('Method', [{label: 'SSGI', value: 0}, {label: 'Radiance cascades (PoC)', value: 1}])
    @serialize() method = 0

    /**
     * Temporal accumulation and spatial filter of the raw trace.
     */
    @uiConfig(undefined, {label: 'Denoiser', params: (that: SSGIPluginPass)=>({hidden: ()=>that.method === 1})})
    @serialize() readonly denoiser: SpatioTemporalDenoiser

    /**
     * Settings of the radiance cascades method.
     */
    @uiConfig(undefined, {label: 'Radiance cascades', params: (that: SSGIPluginPass)=>({hidden: ()=>that.method !== 1})})
    @serialize() readonly cascades: RadianceCascadesGI

    /**
     * Darkens the environment light where the scene hides the sky, from a world-space probe grid baked once through a
     * BVH of the scene (IJ-851, {@link SkyVisibilityVolume}). Screen-space occlusion only sees what is on screen and
     * close, so rooms get the full environment through their walls; with this on, the environment intensity can stay
     * at 1 indoors. Works with both methods.
     */
    @uiToggle('Environment occlusion (world)')
    @serialize() envOcclusion = false

    /**
     * Also scales the environment reflection by the sky visibility around the reflection direction.
     */
    @uiToggle('Env occlusion on reflections')
    @serialize() envOcclusionSpecular = true

    /**
     * With environment occlusion, SSGI rays that leave the screen or hit nothing read the bounce light of the
     * surfaces around them from the same probe grid (one bounce, baked; follows the sun in bands of rows).
     */
    @uiToggle('Far bounce light (world)')
    @serialize() envFarLight = true

    readonly skyVisibility: SkyVisibilityVolume

    @uiToggle('GI Enabled')
    @serialize()
    @matDefineBool('SSGI_ENABLED', undefined, undefined, SSGIPluginPass.prototype.setDirty, false)
    giEnabled = true // todo make getter/setter for legacy ssgiEnabled

    /**
     * Multiplier of the bounced light. 1 is physically based; above 1 can make the bounces grow from frame to frame.
     */
    @uiSlider('Intensity', [0, 4])
    @serialize() @uniform() intensity = 1

    /**
     * Exponent applied to the visibility (1 - occlusion) that darkens the environment light.
     */
    @uiSlider('Power', [0, 3])
    @serialize() @uniform() power = 1.1

    /**
     * Ray length relative to the scene diameter when on (1 crosses the whole scene), in world units when off.
     */
    @uiToggle('Auto radius') @serialize() @uniform() autoRadius = true

    /**
     * Ray length: a fraction of the scene diameter with autoRadius, world units without. A small model inside a large
     * scene (a car in front of a mountain) needs a small value with autoRadius, or autoRadius off.
     */
    @uiSlider('Ray length', [0.001, 10.0], 0.001)
    @serialize() @uniform() objectRadius = 1

    /**
     * Upper bound of the ray length, in screen heights at the depth of each pixel. A ray longer than the screen
     * finds nothing past it, and in a large scene its few samples would all land past the nearby geometry; so a
     * small model in front of a large backdrop keeps its contact occlusion without tuning the ray length.
     */
    @uiSlider('Max screen radius', [0.05, 2], 0.01)
    @serialize() @uniform() maxScreenRadius = 1

    /**
     * Thickness assumed behind each visible surface, relative to the ray step and the depth.
     */
    @uiSlider('Tolerance', [0.1, 5])
    @serialize() @uniform() tolerance = 1

    /**
     * Extra offset of the ray origin along the normal, against self-occlusion.
     */
    @uiSlider('Bias', [-0.3, 0.3])
    @serialize() @uniform() bias = 0.001

    /**
     * Distance falloff exponent of hits along the ray, for both the occlusion and the bounced light. 0 means no
     * falloff (physically based); higher values keep the occlusion close to contact.
     */
    @uiSlider('Falloff', [0, 4])
    @serialize() @uniform() falloff = 0

    /**
     * Luminance cap of the light read at a hit, against fireflies from highlights.
     */
    @uiSlider('Radiance clamp', [0.5, 64], 0.5)
    @serialize() @uniform() radianceClamp = 8

    @uiSlider('Ray Count', [1, 8], 1, {tags: ['performance']})
    @serialize() @uniform() rayCount = 4

    @uiSlider('Step count', [1, 32], 1, {tags: ['performance']})
    @serialize()
    @matDefine('RTAO_STEP_COUNT', undefined, undefined, SSGIPluginPass.prototype.setDirty)
    stepCount = 8

    /**
     * Spatial filter of the denoiser. Off shows the temporally accumulated result only.
     */
    @uiToggle('Smooth Enabled')
    @serialize() smoothEnabled = true

    /**
     * Render GI while the camera moves. Off skips it until the camera stops.
     */
    @uiToggle('Render with Camera')
    renderWithCamera = true

    @uiSlider('Split', [0, 1], 0.01, {tags: ['debug']})
    @serialize() @uniform({propKey: 'ssrtaoSplitX', onChange: SSGIPluginPass.prototype.setDirty})
    split = 0

    public readonly passId: IPassID

    rawTarget?: ValOrFunc<WebGLRenderTarget|undefined>
    normalDepthTexture?: ValOrFunc<Texture|undefined>

    private _camera?: ICamera
    private _scene?: IScene
    private _lastFrame = -2
    private _lastMethod = 0
    // Copy of the final frame before tLastFrame, for the temporal gradient (see ssgiTrace.glsl).
    private _prevLastFrame?: WebGLRenderTarget
    private _prevLastFrameValid = false
    private _gradientCamera = ''

    constructor(pid: IPassID,
                public target?: ValOrFunc<WebGLRenderTarget|undefined>,
                giEnabled = true,
                sizeMultiplier = 1) {
        super({
            glslVersion: GLSL3,
            defines: {
                ['RTAO_STEP_COUNT']: 8,
                ['PERSPECTIVE_CAMERA']: 1, // set in PerspectiveCamera2
                // ['CHECK_GBUFFER_FLAG']: 0, // todo like ssao plugin
            },
            uniforms: {
                tLastFrame: {value: null}, // set in progressive plugin
                tPrevLastFrame: {value: null},
                gradientValid: {value: false},
                screenSize: {value: new Vector2(0, 0)}, // set in ExtendedRenderMaterial
                currentFrameCount: {value: 0}, // set in RenderManager
                frameCount: {value: 0}, // set in RenderManager
                frameIndex: {value: 0},
                staticFrame: {value: false},
                cameraNearFar: {value: new Vector2(0.1, 1000)}, // set in PerspectiveCamera2
                cameraPositionWorld: {value: new Vector3()}, // set in PerspectiveCamera2
                projection: {value: new Matrix4()}, // set in PerspectiveCamera2

                intensity: {value: 1},
                objectRadius: {value: 1},
                autoRadius: {value: true},
                maxScreenRadius: {value: 1},
                rayCount: {value: 4},
                bias: {value: 0.001},
                falloff: {value: 0},
                power: {value: 1.1},
                tolerance: {value: 1},
                radianceClamp: {value: 8},
                sceneBoundingRadius: {value: 0}, // set in RootScene

                // reprojection of the light read at hits
                currentProjectionViewMatrix: {value: new Matrix4()},
                lastProjectionViewMatrix: {value: new Matrix4()},
                lastLastProjectionViewMatrix: {value: new Matrix4()},
                inverseViewMatrix: {value: new Matrix4()},

                // split mode
                ssrtaoSplitX: {value: 0.5},
            },

            vertexShader: shaderUtils.defaultVertex,

            fragmentShader: `
// for gbuffer
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>
#include <randomHelpers>
${samplePointHelpers}
#ifdef SSGI_FAR_LIGHT
#define SVV_FAR
${SkyVisibilityVolume.SampleShader}
#endif

${ssgiTrace}
            `,

        }, 'tDiffuse', 'tLastFrame')
        this.passId = pid
        this.needsSwap = false
        this.clear = false

        this.giEnabled = giEnabled
        // The history stores the frame count and squared luminance, so it is always half float, whatever the GI buffer type.
        this.denoiser = new SpatioTemporalDenoiser(HalfFloatType, sizeMultiplier)
        this.cascades = new RadianceCascadesGI()
        this.skyVisibility = new SkyVisibilityVolume(this.cascades.world)
        Object.assign(this.material.uniforms, this.skyVisibility.uniforms) // the far light lookup of the trace
    }

    render(renderer: IWebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
        if (!this.enabled) return
        this.needsSwap = false
        const rm = renderer.renderManager
        if (!this.renderWithCamera && rm.frameCount < 2) {
            return
        }

        const target = getOrCall(this.target)
        const raw = getOrCall(this.rawTarget)
        const normalDepth = getOrCall(this.normalDepthTexture)
        if (!target || !raw || !normalDepth || !this._camera) {
            console.warn('SSGIPluginPass: target, G-buffer or camera not available.')
            return
        }

        // Sky visibility for the materials' environment light: baked in bands over the first frames after a new BVH.
        if (this.envOcclusion && this._scene) {
            this.cascades.ensureWorld(this._scene as any, renderer)
            this.skyVisibility.farLight = this.envFarLight && this.method === 0
            this.skyVisibility.update(renderer, this._scene as any, this.radianceClamp)
        }
        const far = this.envOcclusion && this.envFarLight && this.method === 0 && this.skyVisibility.farReady
        if (!!this.material.defines.SSGI_FAR_LIGHT !== far) {
            if (far) this.material.defines.SSGI_FAR_LIGHT = 1
            else delete this.material.defines.SSGI_FAR_LIGHT
            this.material.needsUpdate = true
        }

        if (this.method === 1) {
            // Radiance cascades: no trace noise. With temporal smoothing the result goes through the denoiser's
            // temporal pass (no spatial filter); the denoiser starts over when the method changes.
            const staticFrame = rm.frameCount > 0
            const smooth = this.cascades.temporal && this.cascades.debugView === 0
            if (this._lastMethod !== 1 || !smooth) this.denoiser.reset()
            this._lastMethod = 1
            this._lastFrame = -2
            this.cascades.render(renderer, smooth ? raw : target, this._camera, this.uniforms.tLastFrame.value as Texture|null,
                this.uniforms.lastProjectionViewMatrix.value, staticFrame, this.radianceClamp, this._scene as any)
            if (smooth) this.denoiser.render(renderer, raw, target, normalDepth, this._camera, staticFrame, false)
            this.uniforms.lastLastProjectionViewMatrix.value.copy(this.uniforms.lastProjectionViewMatrix.value)
            this.uniforms.lastProjectionViewMatrix.value.copy(this.uniforms.currentProjectionViewMatrix.value)
            return
        }

        // After skipped frames (render with camera off, plugin disabled) the history is from an older view: start over.
        const gap = rm.totalFrameCount - this._lastFrame > 1 || this._lastMethod !== 0
        this._lastMethod = 0
        if (gap) this.denoiser.reset()
        this._lastFrame = rm.totalFrameCount
        const staticFrame = rm.frameCount > 0
        this.uniforms.frameIndex.value = rm.totalFrameCount % 4096
        this.uniforms.staticFrame.value = staticFrame

        // The temporal gradient compares tLastFrame with the final frame before it (a copy made in the last frame).
        // A change shows up in tLastFrame one frame after it happens, so frames 0 and 1 after a change use the
        // gradient; later still frames do not need it (the progressive blend changes the final frame between them).
        // After a gap or a camera switch, tLastFrame and the matrices are from another view: no copy, no gradient.
        const lastFrame = this.uniforms.tLastFrame.value as Texture|null
        const fresh = !gap && this._camera.uuid === this._gradientCamera
        this._gradientCamera = this._camera.uuid
        const useGradient = this.denoiser.gradientAntiLag > 0 && !!lastFrame
        if (useGradient && !this._prevLastFrame) this._prevLastFrame = rm.composerTarget.clone(true) as WebGLRenderTarget
        const prevLast = this._prevLastFrame
        const sameSize = !!prevLast && lastFrame?.image?.width === prevLast.width && lastFrame?.image?.height === prevLast.height
        this.uniforms.tPrevLastFrame.value = prevLast?.texture ?? null
        this.uniforms.gradientValid.value = useGradient && fresh && sameSize && this._prevLastFrameValid && rm.frameCount <= 1

        // Trace into the raw target: the signal and its temporal gradient.
        super.render(renderer, raw, readBuffer, deltaTime, maskActive)

        // Denoise into the target that the materials read.
        this.denoiser.render(renderer, raw, target, normalDepth, this._camera, staticFrame, this.smoothEnabled,
            this.uniforms.gradientValid.value ? raw.textures[1] : undefined)

        // State for the next frame. Only a changing frame needs the copy: the next frame is then frame 0 or 1.
        if (useGradient && fresh && sameSize && !staticFrame && prevLast && lastFrame) {
            rm.blit(prevLast, {source: lastFrame, respectColorSpace: false})
            this._prevLastFrameValid = true
        } else this._prevLastFrameValid = false
        this.uniforms.lastLastProjectionViewMatrix.value.copy(this.uniforms.lastProjectionViewMatrix.value)
        this.uniforms.lastProjectionViewMatrix.value.copy(this.uniforms.currentProjectionViewMatrix.value)
    }

    disposeHistory(renderManager: IRenderManager) {
        if (this._prevLastFrame) renderManager.disposeTarget(this._prevLastFrame)
        this._prevLastFrame = undefined
        this._prevLastFrameValid = false
    }

    beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager) {
        if (!this.enabled) return
        this._camera = camera
        this._scene = scene
        this.updateShaderProperties([scene, camera, renderManager])
        this.uniforms.currentProjectionViewMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        this.uniforms.inverseViewMatrix.value.copy(camera.matrixWorld)
    }

    private _svvDefine() {
        return this.envOcclusion && this.skyVisibility.uniforms.tSkyVis.value ? this.envOcclusionSpecular ? 2 : 1 : undefined
    }

    readonly materialExtension: MaterialExtension = { // todo set priority wrt ssr etc
        extraUniforms: {
            tSSGIMap: ()=>({value: getOrCall(this.target)?.texture ?? null}),
            // functions: this object is created before the constructor sets skyVisibility
            ...Object.fromEntries(['tSkyVis', 'svvMin', 'svvCell', 'svvDims', 'svvTilesX'].map(k=>
                [k, ()=>(this.skyVisibility.uniforms as Record<string, {value: any}>)[k]])),
            ssaoPower: this.material.uniforms.power,
            ssgiIntensity: this.material.uniforms.intensity,
            ssrtaoSplitX: this.material.uniforms.ssrtaoSplitX,
        },
        extraDefines: {
            ['SSGI_ENABLED']: ()=>this.material.defines.SSGI_ENABLED,
            ['SVV_ENABLED']: ()=>this._svvDefine(),
        },
        shaderExtender: (shader, _material, _renderer) => {
            if (!shader.defines?.SSRTAO_ENABLED) return
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
                'vec3 totalDiffuse =', '\n' + ssgiPatch + '\n', {prepend: true})

            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <aomap_fragment>', '')
        },
        onObjectRender: (_object, material, renderer: IWebGLRenderer) => {
            const x: any = this.enabled
            && (this.renderWithCamera || renderer.renderManager.frameCount > 1) &&
            renderer.userData.screenSpaceRendering !== false &&
            !material.userData?.pluginsDisabled &&
            !material.userData?.ssgiDisabled &&
            !material.userData?.ssrtaoDisabled &&
            !material.userData?.ssaoDisabled &&
            writesGBuffer(material) ? this.split > 0 ? 2 : 1 : 0

            if (material.defines!.SSRTAO_ENABLED !== x) {
                material.defines!.SSRTAO_ENABLED = x
                material.needsUpdate = true
            }
        },
        parsFragmentSnippet: (_renderer)=>glsl`
            #if defined(SSRTAO_ENABLED) && SSRTAO_ENABLED > 0
            uniform float ssaoPower;
            uniform float ssgiIntensity;
            uniform sampler2D tSSGIMap;
            #if defined(SSRTAO_ENABLED) && SSRTAO_ENABLED == 2
            uniform float ssrtaoSplitX;
            #endif
            ${getTexelDecoding('tSSGIMap', getOrCall(this.target)?.texture.colorSpace)}
            #ifdef SVV_ENABLED
            ${SkyVisibilityVolume.SampleShader}
            #endif
            #include <simpleCameraHelpers>
            #endif
        `,
        computeCacheKey: () => {
            const tex = getOrCall(this.target)?.texture
            return (this.enabled ? '1' : '0') + tex?.colorSpace + tex?.uuid + Object.values(this.material.defines).map(v=>v + '').join(',') + 'svv' + this._svvDefine()
        },
        uuid: SSGIPlugin.PluginType,
        ...uiConfigMaterialExtension(this._getUiConfig.bind(this), SSGIPlugin.PluginType),
        isCompatible: material => {
            return (material as PhysicalMaterial).isPhysicalMaterial
        },
    }

    /**
     * Returns a uiConfig to toggle SSGI on a material.
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    protected _getUiConfig(material: IMaterial) {
        return {
            type: 'folder',
            label: 'SSGI',
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return !(material.userData.ssgiDisabled ?? false)
                    },
                    set value(v) {
                        if (v === !(material.userData.ssgiDisabled ?? false)) return
                        material.userData.ssgiDisabled = !v
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
        this._gbufferUnpackExtension = extension
        if (extension) this.material.registerMaterialExtensions([extension])
        this.denoiser.setGBufferUnpackExtension(extension, old)
        this.cascades.setGBufferUnpackExtension(extension, old)
    }

    // todo update gbuffer flag like in AO?

    setDirty() {
        this.materialExtension?.setDirty?.()
        super.setDirty();
    }

}

declare module 'threepipe' {
    interface IMaterialUserData {
        /**
         * Disable SSGIPlugin for this material.
         */
        ssgiDisabled?: boolean // default false
        ssreflNonPhysical?: boolean // default false
    }
}
