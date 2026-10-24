import {
    ExtendedShaderPass,
    GLSL3,
    HalfFloatType,
    ICamera,
    IRenderManager,
    IWebGLRenderer,
    LinearSRGBColorSpace,
    MaterialExtension,
    Matrix4,
    NearestFilter,
    serialize,
    shaderUtils,
    TextureDataType,
    Texture,
    uiFolderContainer,
    uiDropdown,
    uiSlider,
    uiToggle,
    UnsignedByteType,
    Vector2,
    WebGLRenderTarget,
} from 'threepipe'
import temporalAccumulate from './shaders/temporalAccumulate.glsl'
import atrousFilter from './shaders/atrousFilter.glsl'
import reflectionPrefilter from './shaders/reflectionPrefilter.glsl'

const commonPars = `
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>
`

/**
 * Denoises a noisy screen-space signal (rgb + a) over time and space, after SVGF
 * (Schied et al., "Spatiotemporal Variance-Guided Filtering", HPG 2017):
 * 1. temporal accumulation with reprojection (velocity buffer, or camera matrices without one), where the
 *    history survives only on the same surface (tangent plane and normal tests against the last frame's G-buffer);
 * 2. a variance-guided edge-avoiding a-trous filter, strong where the history is short and weak where it is long.
 *
 * Optional: a temporal gradient of the signal (A-SVGF), which moves and shortens the history where the light changed,
 * so the result follows moving lights within a few frames.
 *
 * Needs the G-buffer unpack extension (depth and normal). Owns two ping-pong history targets, a copy of the
 * last frame's G-buffer and a scratch target for the spatial filter.
 */
@uiFolderContainer('Denoiser')
export class SpatioTemporalDenoiser {
    @uiToggle('Temporal')
    @serialize() temporalEnabled = true

    /**
     * History length cap (frames) while the camera or the scene changes. Longer is smoother, shorter reacts faster to lighting changes.
     */
    @uiSlider('History (motion)', [1, 128], 1)
    @serialize() maxHistory = 16

    /**
     * History length cap (frames) while nothing changes, so a still image converges.
     */
    @uiSlider('History (still)', [1, 1024], 1)
    @serialize() maxHistoryStill = 256

    /**
     * History length (frames) that the motion history keeps on the first still frame, so the still image converges
     * to its own samples instead of keeping a part of the motion history (with its lag) for hundreds of frames.
     * 0 keeps the whole history. Default: 4 in reflection mode (reflections lag in motion), 0 otherwise.
     */
    @uiSlider('History kept on stop', [0, 64], 1)
    @serialize() historyOnStop = 0

    /**
     * Shortens the history where new samples clearly disagree with it (moving lights and shadows). 0 turns it off.
     */
    @uiSlider('Anti-lag', [0, 2], 0.01)
    @serialize() antiLag = 1

    /**
     * Uses the temporal gradient (the measured change of the light, when the signal provides one) to move the history
     * to the new light and to shorten it where the light changed a lot. 0 turns it off (SSGI then also skips computing
     * the gradient).
     */
    @uiSlider('Gradient anti-lag', [0, 2], 0.01)
    @serialize() gradientAntiLag = 1

    /**
     * Relative change of the light below which the gradient anti-lag keeps the history (residual flicker, jitter).
     */
    @uiSlider('Gradient threshold', [0, 0.9], 0.01)
    @serialize() gradientThreshold = 0.1

    /**
     * Reflection mode only: clamps the history to the 3x3 mean +- this many standard deviations of the new samples on
     * changing frames, so a reflection that left a pixel does not linger. 0 turns it off.
     */
    @uiSlider('History clamp (reflections)', [0, 4], 0.05)
    @serialize() historyClamp = 1.5

    /**
     * Reflection mode only: shortens the history of glossy reflections in motion, in proportion to the parallax (in
     * pixels per frame) between the surface and the reflected point, divided by the size of the reflection lobe on screen
     * (both in pixels, so it does not depend on the resolution). 0 turns it off. Default: 2 in reflection mode.
     */
    @uiSlider('Parallax history (reflections)', [0, 32], 0.5)
    @serialize() parallaxHistory = 0

    /**
     * Reflection mode only: on changing frames, the raw reflections are blurred over the size of their lobe on screen
     * (roughness^2 x hit distance) before the temporal pass, and the history is clamped against that low-noise
     * neighborhood (as the AMD FidelityFX reflection denoiser does). This scales the lobe size; 0 turns it off.
     * Still frames use the raw reflections, so a still image converges without this blur. On the ssrGloss floor at
     * 960x540 in a camera orbit, 0.5 flickered least (frame-to-frame flicker of fine detail 0.71, without the
     * prefilter 1.02) and blurred less than 1.
     */
    @uiSlider('Prefilter radius (reflections)', [0, 4], 0.05)
    @serialize() prefilterRadius = 0.5

    /**
     * Reflection mode only: upper bound of the prefilter radius, as a fraction of the screen height.
     */
    @uiSlider('Prefilter max radius (reflections)', [0, 0.1], 0.001)
    @serialize() prefilterMaxRadius = 0.03

    /**
     * Reflection mode only: the prefilter pass (undefined otherwise).
     */
    readonly prefilterPass?: ExtendedShaderPass

    /**
     * Reflection mode only: r = hit distance of the reflection rays (view units, 0: no hit), g = roughness. Set before
     * each {@link render}.
     */
    reflectionData?: Texture

    @uiSlider('Spatial iterations', [0, 5], 1)
    @serialize() spatialIterations = 4

    /**
     * Kernel radius of each spatial iteration: 1 is 3x3 (cheaper), 2 is 5x5.
     */
    @uiSlider('Spatial kernel radius', [1, 2], 1)
    @serialize() spatialRadius = 1

    @uiSlider('Luminance tolerance', [0.1, 16], 0.1)
    @serialize() phiLuminance = 4

    @uiSlider('Normal sharpness', [1, 256], 1)
    @serialize() phiNormal = 64

    @uiSlider('Depth tolerance', [0.1, 8], 0.1)
    @serialize() phiDepth = 1

    /**
     * Shows an intermediate buffer instead of the denoised result.
     */
    @uiDropdown('Debug view', ['None', 'Raw', 'Temporal', 'History length', 'Variance'].map((label, value) => ({label, value})))
        debugView = 0

    readonly temporalPass: ExtendedShaderPass
    readonly atrousPass: ExtendedShaderPass
    readonly debugPass: ExtendedShaderPass

    private _history: WebGLRenderTarget[] = []
    private _prevNormalDepth?: WebGLRenderTarget
    private _scratch?: WebGLRenderTarget
    private _prefiltered?: WebGLRenderTarget
    private _current = 0
    private _hasHistory = false
    private _lastCameraUuid = ''
    private _lastSize = new Vector2()

    private _prevInverseView = new Matrix4()
    private _prevProjection = new Matrix4()
    private _lastProjectionView = new Matrix4()
    private _prevNearFar = new Vector2()
    private _lastStatic = false

    /**
     * @param bufferType - type of the history targets
     * @param sizeMultiplier - size of the targets relative to the render size
     * @param reflection - reflection mode (for SSR): glossy reflections are reprojected with the reflected point, the
     * history is clamped to the neighborhood, and the spatial filter is limited by the roughness. Needs {@link reflectionData}.
     */
    constructor(public readonly bufferType: TextureDataType = HalfFloatType, public readonly sizeMultiplier = 1, public readonly reflection = false) {
        this.temporalPass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: commonPars + temporalAccumulate,
            uniforms: {
                tRaw: {value: null},
                tHistColor: {value: null},
                tHistMoments: {value: null},
                tPrevNormalDepth: {value: null},
                screenSize: {value: new Vector2()},
                projection: {value: new Matrix4()},
                cameraNearFar: {value: new Vector2(0.1, 1000)},
                cameraPositionWorld: {value: null},
                inverseViewMatrix: {value: new Matrix4()},
                lastProjectionViewMatrix: {value: this._lastProjectionView},
                prevInverseViewMatrix: {value: this._prevInverseView},
                prevProjection: {value: this._prevProjection},
                prevCameraNearFar: {value: this._prevNearFar},
                historyValid: {value: false},
                staticFrame: {value: false},
                maxHistory: {value: 16},
                momentsAlphaMin: {value: 0.2},
                planeTolerance: {value: 0.03},
                normalTolerance: {value: 0.8},
                antiLag: {value: 1},
                tGradient: {value: null},
                hasGradient: {value: false},
                gradientAntiLag: {value: 1},
                gradientThreshold: {value: 0.1},
                tReflectionData: {value: null},
                historyClamp: {value: 1.5},
                parallaxHistory: {value: 0},
                historyCap: {value: 1e9},
            },
            defines: {
                ['PERSPECTIVE_CAMERA']: 1,
                ...reflection ? {['REFLECTION_MODE']: 1} : {},
            },
        }, 'tRaw', 'tHistColor', 'tHistMoments')
        this.temporalPass.clear = false
        if (reflection) {
            // With the prefilter, the history clamp works on a low-noise neighborhood, so a 16-frame history keeps the
            // reflections steady in motion (32 measured no better); the parallax term shortens it where a glossy
            // reflection and its surface move apart.
            this.maxHistory = 16
            this.parallaxHistory = 2
            this.historyOnStop = 4
        }

        this.atrousPass = new ExtendedShaderPass({
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: commonPars + atrousFilter,
            uniforms: {
                tColor: {value: null},
                tMoments: {value: null},
                screenSize: {value: new Vector2()},
                projection: {value: new Matrix4()},
                cameraNearFar: {value: new Vector2(0.1, 1000)},
                cameraPositionWorld: {value: null},
                stepSize: {value: 1},
                phiLuminance: {value: 4},
                phiNormal: {value: 64},
                phiDepth: {value: 1},
                tReflectionData: {value: null},
            },
            defines: {
                ['PERSPECTIVE_CAMERA']: 1,
                ['ATROUS_RADIUS']: 1,
                ...reflection ? {['REFLECTION_MODE']: 1} : {},
            },
        }, 'tColor', 'tMoments')
        this.atrousPass.clear = false

        this.debugPass = new ExtendedShaderPass({
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: `
varying vec2 vUv;
uniform int mode;
uniform float maxHistory;
void main() {
    vec4 c = tColorTexelToLinear(texture2D(tColor, vUv));
    vec4 m = tMomentsTexelToLinear(texture2D(tMoments, vUv));
    if (mode == 3) c = vec4(vec3(m.b / maxHistory), 0.0);
    else if (mode == 4) c = vec4(vec3(sqrt(m.a) * 4.0), 0.0);
    gl_FragColor = c;
}`,
            uniforms: {
                tColor: {value: null},
                tMoments: {value: null},
                mode: {value: 0},
                maxHistory: {value: 16},
            },
        }, 'tColor', 'tMoments')
        this.debugPass.clear = false

        if (reflection) {
            this.prefilterPass = new ExtendedShaderPass({
                glslVersion: GLSL3,
                vertexShader: shaderUtils.defaultVertex,
                fragmentShader: commonPars + reflectionPrefilter,
                uniforms: {
                    tRaw: {value: null},
                    tReflectionData: {value: null},
                    screenSize: {value: new Vector2()},
                    projection: {value: new Matrix4()},
                    cameraNearFar: {value: new Vector2(0.1, 1000)},
                    cameraPositionWorld: {value: null},
                    frameIndex: {value: 0},
                    radiusScale: {value: 1},
                    maxRadius: {value: 16},
                },
                defines: {
                    ['PERSPECTIVE_CAMERA']: 1,
                },
            }, 'tRaw')
            this.prefilterPass.clear = false
        }
    }

    private get _passes() {
        return [this.temporalPass, this.atrousPass, this.debugPass, ...this.prefilterPass ? [this.prefilterPass] : []]
    }

    /**
     * Registers the G-buffer unpack extension (or removes the old one with undefined).
     */
    setGBufferUnpackExtension(extension: MaterialExtension|undefined, old?: MaterialExtension) {
        // Not the debug pass: it reads no G-buffer, and the extension needs the packing include in the shader.
        for (const pass of [this.temporalPass, this.atrousPass, ...this.prefilterPass ? [this.prefilterPass] : []]) {
            if (old) pass.material.unregisterMaterialExtensions([old])
            if (extension) pass.material.registerMaterialExtensions([extension])
        }
    }

    /**
     * Registers the velocity buffer unpack extension on the temporal pass (or removes it with undefined).
     */
    setVelocityUnpackExtension(extension: MaterialExtension|undefined, old?: MaterialExtension) {
        if (old) this.temporalPass.material.unregisterMaterialExtensions([old])
        if (extension) this.temporalPass.material.registerMaterialExtensions([extension])
    }

    private _createTargets(renderManager: IRenderManager) {
        if (this._history.length) return
        for (let i = 0; i < 2; i++) {
            const t = renderManager.createTarget<WebGLRenderTarget>({
                depthBuffer: false,
                type: this.bufferType,
                sizeMultiplier: this.sizeMultiplier,
                textureCount: 2,
                minFilter: NearestFilter,
                magFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
            t.textures[0].name = 'ssgiHistoryColor' + i
            t.textures[1].name = 'ssgiHistoryMoments' + i
            this._history.push(t)
        }
        this._prevNormalDepth = renderManager.createTarget<WebGLRenderTarget>({
            depthBuffer: false,
            type: UnsignedByteType,
            sizeMultiplier: this.sizeMultiplier,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            generateMipmaps: false,
        })
        this._prevNormalDepth.texture.name = 'ssgiPrevNormalDepth'
        // Ping-pong partner of the output in the spatial filter. Not the raw target: it can have more than one texture
        // (the SSGI trace writes its gradient there), and WebGL refuses draws that leave an attached texture unwritten.
        this._scratch = renderManager.createTarget<WebGLRenderTarget>({
            depthBuffer: false,
            type: this.bufferType,
            sizeMultiplier: this.sizeMultiplier,
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            generateMipmaps: false,
            colorSpace: LinearSRGBColorSpace,
        })
        this._scratch.texture.name = 'ssgiDenoiseScratch'
        if (this.prefilterPass) {
            // the prefiltered reflections and their smoothed hit distance and roughness
            this._prefiltered = renderManager.createTarget<WebGLRenderTarget>({
                depthBuffer: false,
                type: HalfFloatType,
                sizeMultiplier: this.sizeMultiplier,
                textureCount: 2,
                minFilter: NearestFilter,
                magFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
            this._prefiltered.textures[0].name = 'reflectionPrefiltered'
            this._prefiltered.textures[1].name = 'reflectionPrefilteredData'
        }
        this._hasHistory = false
    }

    /**
     * Clears the history, so the next frame starts without temporal data.
     */
    reset() {
        this._hasHistory = false
    }

    /**
     * Last accumulated (not spatially filtered) signal.
     */
    get historyTexture(): Texture|undefined {
        return this._history[this._current ^ 1]?.textures[0]
    }

    /**
     * @param renderer
     * @param raw - noisy input (texture 0)
     * @param output - receives the denoised signal
     * @param normalDepth - this frame's G-buffer depth/normal texture, copied for the next frame
     * @param camera - the camera that rendered the G-buffer
     * @param staticFrame - true when nothing changed since the last frame, so no reprojection is needed
     * @param spatial - false skips the spatial filter (the output is the temporal accumulation)
     * @param gradient - temporal gradient of the signal: rgb = change since the last frame in the units of raw, a = level
     */
    render(renderer: IWebGLRenderer, raw: WebGLRenderTarget, output: WebGLRenderTarget, normalDepth: Texture, camera: ICamera, staticFrame: boolean, spatial = true, gradient?: Texture) {
        const rm = renderer.renderManager
        this._createTargets(rm)
        const cur = this._history[this._current]
        const prev = this._history[this._current ^ 1]
        const prevND = this._prevNormalDepth!

        const w = raw.width, h = raw.height
        if (this._lastSize.x !== w || this._lastSize.y !== h || camera.uuid !== this._lastCameraUuid) {
            this._hasHistory = false
            this._lastSize.set(w, h)
            this._lastCameraUuid = camera.uuid
        }

        // Reflection prefilter, on changing frames only: the temporal pass then accumulates and clamps against a
        // low-noise signal. Still frames accumulate the raw reflections, so a still image converges without the blur.
        let temporalInput = raw
        let reflectionData = this.reflectionData
        if (this.prefilterPass && this._prefiltered && this.prefilterRadius > 0 && !staticFrame && reflectionData) {
            const pu = this.prefilterPass.uniforms
            camera.updateShaderProperties(this.prefilterPass.material)
            pu.tReflectionData.value = reflectionData
            pu.frameIndex.value = rm.totalFrameCount % 4096
            pu.radiusScale.value = this.prefilterRadius
            pu.maxRadius.value = Math.max(1, this.prefilterMaxRadius * this._prefiltered.height)
            this.prefilterPass.material.uniformsNeedUpdate = true
            this.prefilterPass.render(renderer, this._prefiltered, raw)
            temporalInput = this._prefiltered
            reflectionData = this._prefiltered.textures[1]
        }

        // Temporal
        const tu = this.temporalPass.uniforms
        camera.updateShaderProperties(this.temporalPass.material)
        tu.inverseViewMatrix.value.copy(camera.matrixWorld)
        tu.tHistColor.value = prev.textures[0]
        tu.tHistMoments.value = prev.textures[1]
        tu.tPrevNormalDepth.value = prevND.texture
        tu.historyValid.value = this._hasHistory && this.temporalEnabled
        tu.staticFrame.value = staticFrame
        tu.maxHistory.value = Math.max(1, staticFrame ? Math.max(this.maxHistory, this.maxHistoryStill) : this.maxHistory)
        tu.historyCap.value = staticFrame && !this._lastStatic && this.historyOnStop > 0 ? this.historyOnStop : 1e9
        this._lastStatic = staticFrame
        tu.antiLag.value = this.antiLag
        tu.tGradient.value = gradient ?? null
        tu.hasGradient.value = !!gradient
        tu.gradientAntiLag.value = this.gradientAntiLag
        tu.gradientThreshold.value = Math.min(0.95, Math.max(0, this.gradientThreshold))
        tu.tReflectionData.value = reflectionData ?? null
        tu.historyClamp.value = this.historyClamp
        tu.parallaxHistory.value = this.parallaxHistory
        this.temporalPass.material.uniformsNeedUpdate = true
        this.temporalPass.render(renderer, cur, temporalInput)

        if (this.debugView > 0) {
            const du = this.debugPass.uniforms
            du.mode.value = this.debugView
            du.maxHistory.value = tu.maxHistory.value
            du.tMoments.value = cur.textures[1]
            this.debugPass.material.uniformsNeedUpdate = true
            this.debugPass.render(renderer, output, this.debugView === 1 ? raw : cur)
        } else if (!spatial || this.spatialIterations < 1 || !this._scratch) {
            rm.blit(output, {source: cur.textures[0], respectColorSpace: false})
        } else {
            // Ping-pong between the scratch target and the output, ending on the output.
            const scratch = this._scratch
            const au = this.atrousPass.uniforms
            camera.updateShaderProperties(this.atrousPass.material)
            au.tMoments.value = cur.textures[1]
            au.phiLuminance.value = this.phiLuminance
            au.phiNormal.value = this.phiNormal
            au.phiDepth.value = this.phiDepth
            au.tReflectionData.value = reflectionData ?? null
            const radius = this.spatialRadius > 1.5 ? 2 : 1
            if (this.atrousPass.material.defines.ATROUS_RADIUS !== radius) {
                this.atrousPass.material.defines.ATROUS_RADIUS = radius
                this.atrousPass.material.needsUpdate = true
            }
            const n = Math.round(this.spatialIterations)
            let input: WebGLRenderTarget = cur
            for (let i = 0; i < n; i++) {
                const out = (n - 1 - i) % 2 === 0 ? output : scratch
                au.stepSize.value = 1 << i
                this.atrousPass.material.uniformsNeedUpdate = true
                this.atrousPass.render(renderer, out, input)
                input = out
            }
        }

        // State for the next frame.
        rm.blit(prevND, {source: normalDepth, respectColorSpace: false})
        this._prevInverseView.copy(camera.matrixWorld)
        this._prevProjection.copy(camera.projectionMatrix)
        this._lastProjectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        this._prevNearFar.copy(tu.cameraNearFar.value)
        this._current ^= 1
        this._hasHistory = true
    }

    dispose(renderManager?: IRenderManager) {
        for (const t of this._history) renderManager?.disposeTarget(t)
        if (this._prevNormalDepth) renderManager?.disposeTarget(this._prevNormalDepth)
        if (this._scratch) renderManager?.disposeTarget(this._scratch)
        if (this._prefiltered) renderManager?.disposeTarget(this._prefiltered)
        this._prefiltered = undefined
        this._history = []
        this._prevNormalDepth = undefined
        this._scratch = undefined
        this._hasHistory = false
        this._passes.forEach(p => p.dispose())
    }
}
