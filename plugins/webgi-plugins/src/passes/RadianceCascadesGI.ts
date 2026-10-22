import {
    ExtendedShaderPass,
    GLSL3,
    HalfFloatType,
    ICamera,
    IRenderManager,
    IWebGLRenderer,
    LinearSRGBColorSpace,
    MaterialExtension,
    IObject3D,
    Matrix4,
    NearestFilter,
    serialize,
    shaderUtils,
    Texture,
    uiButton,
    uiDropdown,
    uiFolderContainer,
    uiSlider,
    uiToggle,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
import rcCommon from './shaders/rcCommon.glsl'
import rcCascade from './shaders/rcCascade.glsl'
import rcGather from './shaders/rcGather.glsl'
import rcHiZ from './shaders/rcHiZ.glsl'
import rcHiZPack from './shaders/rcHiZPack.glsl'
import rcHit from './shaders/rcHit.glsl'
import rcWorldTrace from './shaders/rcWorldTrace.glsl'
import rcGrid from './shaders/rcGrid.glsl'
import rcGridUpdate from './shaders/rcGridUpdate.glsl'
import rcGridValid from './shaders/rcGridValid.glsl'
import rcProbeSH from './shaders/rcProbeSH.glsl'
import {BVHShaderGLSL} from 'three-mesh-bvh'
import {RadianceCascadesWorld} from './RadianceCascadesWorld'

const HIZ_LEVELS = 6

const bvhChunks = `
#define BVH_STACK_DEPTH 60
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}
`

const commonPars = `
#include <packing>
#define THREE_PACKING_INCLUDED
#include <cameraHelpers>
${rcCommon}
`

/**
 * Screen-space radiance cascades (proof of concept for IJ-851): diffuse GI and occlusion without noise and without a
 * history, after Sannikov, "Radiance Cascades: A Novel Approach to Calculating Global Illumination" (2023).
 *
 * Probes sit on the visible surfaces (from the G-buffer), every `probeSpacing` pixels in cascade 0 and twice as far
 * apart in each following cascade; each probe stores `dirSide`^2 directions in cascade 0 and 4 times as many in each
 * following cascade. Cascade n traces only its own distance interval (4 times longer than the last) through the depth
 * buffer, and the cascades are merged from the last to the first. The final gather integrates cascade 0 over each
 * pixel's hemisphere into the same GI buffer that the SSGI trace + denoiser produce (rgb = irradiance / PI, a =
 * occlusion), so the materials read it unchanged.
 *
 * Light at a ray hit is read from the previous final frame, as in SSGI, so bounces accumulate over frames.
 */
@uiFolderContainer('Radiance cascades')
export class RadianceCascadesGI {
    /**
     * Cascade 0 probe spacing in pixels. Smaller is sharper near contacts and costs more.
     */
    @uiDropdown('Probe spacing', [2, 4, 8].map(v => ({label: v + ' px', value: v})))
    @serialize() probeSpacing = 4

    /**
     * Cascade 0 directions per side of the octahedral map (dirSide^2 directions).
     */
    @uiDropdown('Directions (cascade 0)', [2, 4].map(v => ({label: v * v + '', value: v})))
    @serialize() dirSide = 4

    @uiSlider('Cascades', [1, 8], 1)
    @serialize() cascadeCount = 6

    /**
     * Length of the cascade 0 interval in cascade 0 probe spacings. Each following interval is 4 times longer.
     */
    @uiSlider('Interval scale', [0.25, 8], 0.25)
    @serialize() intervalScale = 1

    /**
     * Thickness assumed behind each visible surface, in 3% of its depth.
     */
    @uiSlider('Thickness', [0.1, 8], 0.1)
    @serialize() tolerance = 1

    /**
     * Light from beyond the screen (world space, through a BVH of the scene): 0 off (depth buffer only); 1 the cascades
     * from `worldCascade` up trace the BVH every frame (proof of concept B, exact but slow); 2 a world probe grid traced
     * over several frames, which cascades with long intervals read (proof of concept B2).
     */
    @uiDropdown('World light', ['Off (screen only)', 'BVH every frame', 'Probe grid'].map((label, value) => ({label, value})))
    @serialize() worldMode = 0

    /**
     * First cascade traced through the BVH with "BVH every frame".
     */
    @uiDropdown('World trace from cascade', [0, 1, 2, 3, 4].map(v => ({label: 'Cascade ' + v, value: v})))
    @serialize() worldCascade = 2

    /**
     * Number of probes of the world grid (spread over the scene bounds; more is sharper and slower to update).
     */
    @uiDropdown('Grid probes', [8192, 32768, 131072].map(v => ({label: v + '', value: v})))
    @serialize() gridProbes = 32768

    /**
     * Probe rows of the grid traced per frame, as a fraction of all rows (1 traces the whole grid every frame).
     */
    @uiSlider('Grid update per frame', [0.01, 1], 0.01)
    @serialize() gridUpdateFraction = 0.0625

    /**
     * Keeps tracing bands of the grid every frame (light at visible hits follows the last frame, so bounce light builds
     * up). Off traces the whole grid once, and again only when the scene or its lights change: no grid cost per frame.
     */
    @uiToggle('Grid continuous update')
    @serialize() gridContinuous = false

    /**
     * Gathers each pixel from the probes' spherical harmonics (4 texels per probe) instead of all their directions.
     */
    @uiToggle('SH gather')
    @serialize() shGather = true

    /**
     * An interval that starts this many grid cells from its probe reads the grid instead of tracing.
     */
    @uiSlider('Grid from distance (cells)', [0.25, 4], 0.25)
    @serialize() gridMinCells = 1

    /**
     * Rebuilds the scene BVH (after geometry changes). The world trace builds it once, when first used.
     */
    @uiButton('Rebuild world BVH')
    rebuildWorld() {
        this._worldDirty = true
    }

    /**
     * GPU time of each stage of the last profiled frames, in ms (EXT_disjoint_timer_query_webgl2), when profile is on.
     */
    profile = false
    readonly profileResult: Record<string, number> = {}
    private _queries: {name: string, q: WebGLQuery}[] = []
    private _gl?: WebGL2RenderingContext
    private _timerExt: any

    private _tick(renderer: IWebGLRenderer, name: string) {
        if (!this.profile) return
        const gl = this._gl ?? (this._gl = renderer.getContext() as WebGL2RenderingContext)
        const ext = this._timerExt ?? (this._timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2'))
        if (!ext) return
        if (this._queries.length && !(this._queries[this._queries.length - 1] as any).ended) {
            gl.endQuery(ext.TIME_ELAPSED_EXT)
            ;(this._queries[this._queries.length - 1] as any).ended = true
        }
        if (name === '') return
        const q = gl.createQuery()!
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
        this._queries.push({name, q})
    }

    private _collect() {
        const gl = this._gl, ext = this._timerExt
        if (!gl || !ext) return
        const left: typeof this._queries = []
        for (const e of this._queries) {
            if (!(e as any).ended) { left.push(e); continue }
            if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) { left.push(e); continue }
            const ms = gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6
            gl.deleteQuery(e.q)
            const prev = this.profileResult[e.name]
            this.profileResult[e.name] = prev === undefined ? ms : prev * 0.9 + ms * 0.1
        }
        this._queries = left.length > 200 ? [] : left
    }

    readonly world = new RadianceCascadesWorld()
    private _worldDirty = true
    private _lightsKey = ''

    /**
     * Smooths the result over a few frames with reprojection (the temporal pass of the SSGI denoiser, without its
     * spatial filter). The cascades have no noise, but their probes slide over the surfaces when the camera moves,
     * which shows as shimmer.
     */
    @uiToggle('Temporal smoothing')
    @serialize() temporal = true

    /**
     * Shows the merged cascade 0 atlas (one screen-shaped tile per direction) instead of the GI.
     */
    @uiDropdown('Debug view', ['None', 'Cascade 0 radiance', 'Cascade 0 transmittance', 'Gather fallback (red)'].map((label, value) => ({label, value})))
        debugView = 0

    readonly cascadePass: ExtendedShaderPass
    readonly gatherPass: ExtendedShaderPass
    readonly debugPass: ExtendedShaderPass
    readonly hizPass: ExtendedShaderPass
    readonly hizPackPass: ExtendedShaderPass
    readonly gridUpdatePass: ExtendedShaderPass
    readonly gridValidPass: ExtendedShaderPass
    readonly probeSHPass: ExtendedShaderPass
    private _probeSH?: WebGLRenderTarget
    private _grid?: WebGLRenderTarget
    private _gridValid?: WebGLRenderTarget
    private _gridRow = 0
    private _gridFull = true
    private _gridStaleRows = 0 // rows left to retrace in bands after the sun moved
    private _gridKey = ''
    private readonly _gridU = {
        gridMin: {value: new Vector3()},
        gridCell: {value: new Vector3(1, 1, 1)},
        gridDims: {value: new Vector3(1, 1, 1)},
        gridTilesX: {value: 1},
        gridDirSide: {value: 8},
    }

    private _atlas: WebGLRenderTarget[] = []
    private _hiz: WebGLRenderTarget[] = []
    private _hizSize = new Vector2()
    private _hizAtlas?: WebGLRenderTarget
    private _hizOffset: number[] = new Array(8).fill(0)
    private _atlasSize = new Vector2()
    private _viewMatrix = new Matrix4()
    private _inverseViewMatrix = new Matrix4()
    private _lastProjectionView = new Matrix4()
    private _screenSize = new Vector2()
    private _hitU: any
    private _worldU: any

    constructor() {
        const shared = {
            rcScreenSize: {value: this._screenSize},
            probeSpacing: {value: 4},
            dirSide: {value: 4},
            rcViewMatrix: {value: this._viewMatrix},
            rcInverseViewMatrix: {value: this._inverseViewMatrix},
            projection: {value: new Matrix4()},
            cameraNearFar: {value: new Vector2(0.1, 1000)},
            cameraPositionWorld: {value: null},
        }
        // Light at hits and world-space tracing, shared by the cascade pass and the grid update (same value objects).
        const hitU = {
            tLastFrame: {value: null as Texture|null},
            radianceClamp: {value: 8},
            staticFrame: {value: false},
            lastProjectionViewMatrix: {value: this._lastProjectionView},
        }
        const worldU = {
            bvh: {value: this.world.bvh},
            tBvhNormal: {value: this.world.normals},
            tBvhMaterial: {value: this.world.materialIndex},
            tMaterials: {value: null as Texture|null},
            sunDirection: {value: this.world.sunDirection},
            sunRadiance: {value: this.world.sunRadiance},
            envUp: {value: this.world.envUp},
            envDown: {value: this.world.envDown},
            rcProjectionView: {value: new Matrix4()},
        }
        this._hitU = hitU
        this._worldU = worldU
        this.cascadePass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: commonPars + rcGrid + rcHit + `
#ifdef RC_WORLD
${bvhChunks}
${rcWorldTrace}
#endif
` + rcCascade,
            uniforms: {
                ...shared,
                ...hitU,
                ...worldU,
                ...this._gridU,
                tUpper: {value: null},
                cascadeIndex: {value: 0},
                cascadeCount: {value: 6},
                intervalScale: {value: 1},
                tolerance: {value: 1},
                hizLevels: {value: HIZ_LEVELS},
                worldCascade: {value: -1},
                tHiZ: {value: null},
                hizOffset: {value: this._hizOffset},
                tGrid: {value: null},
                tGridValid: {value: null},
                gridMinT: {value: 1e9},
            },
            defines: {['PERSPECTIVE_CAMERA']: 1},
        }, 'tUpper', 'tLastFrame')
        this.cascadePass.clear = false

        this.gridUpdatePass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: commonPars + rcGrid + rcHit + bvhChunks + rcWorldTrace + rcGridUpdate,
            uniforms: {
                ...shared,
                ...hitU,
                ...worldU,
                ...this._gridU,
                gridStart: {value: 0.5},
                tGridValid: {value: null},
            },
            defines: {['PERSPECTIVE_CAMERA']: 1},
        }, 'tLastFrame')
        this.gridUpdatePass.clear = false

        this.gridValidPass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: rcGrid + bvhChunks + rcGridValid,
            uniforms: {...this._gridU, bvh: worldU.bvh, tBvhNormal: worldU.tBvhNormal},
        })
        this.gridValidPass.clear = false

        this.hizPass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: commonPars + rcHiZ,
            uniforms: {
                tSource: {value: null},
                fromGBuffer: {value: true},
                sourceSize: {value: new Vector2()},
                projection: {value: new Matrix4()},
                cameraNearFar: {value: new Vector2(0.1, 1000)},
                cameraPositionWorld: {value: null},
            },
            defines: {['PERSPECTIVE_CAMERA']: 1},
        }, 'tSource')
        this.hizPass.clear = false

        this.hizPackPass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: rcHiZPack,
            uniforms: {
                ...Object.fromEntries(Array.from({length: HIZ_LEVELS}, (_, i) => ['tHiZ' + (i + 1), {value: null}])),
                hizOffset: {value: this._hizOffset},
            },
        })
        this.hizPackPass.clear = false

        this.probeSHPass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: 'uniform mat4 projection;\n' + rcCommon + rcProbeSH, // rcCommon's helpers use projection
            uniforms: {...shared, tCascade0: {value: null}},
        }, 'tCascade0')
        this.probeSHPass.clear = false

        this.gatherPass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: commonPars + rcGather,
            uniforms: {...shared, tCascade0: {value: null}, tProbeSH: {value: null}},
            defines: {['PERSPECTIVE_CAMERA']: 1},
        }, 'tCascade0')
        this.gatherPass.clear = false

        this.debugPass = new ExtendedShaderPass({
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: `
varying vec2 vUv;
uniform vec2 atlasUv; // part of the atlas that holds data
uniform bool showAlpha;
void main() {
    vec4 c = texture2D(tAtlas, vUv * atlasUv);
    gl_FragColor = showAlpha ? vec4(vec3(c.a), 0.0) : vec4(c.rgb, 0.0);
}`,
            uniforms: {tAtlas: {value: null}, atlasUv: {value: new Vector2(1, 1)}, showAlpha: {value: false}},
        }, 'tAtlas')
        this.debugPass.clear = false
    }

    setGBufferUnpackExtension(extension: MaterialExtension|undefined, old?: MaterialExtension) {
        for (const pass of [this.cascadePass, this.gatherPass, this.hizPass, this.gridUpdatePass]) {
            if (old) pass.material.unregisterMaterialExtensions([old])
            if (extension) pass.material.registerMaterialExtensions([extension])
        }
    }

    setVelocityUnpackExtension(extension: MaterialExtension|undefined, old?: MaterialExtension) {
        for (const pass of [this.cascadePass, this.gridUpdatePass]) {
            if (old) pass.material.unregisterMaterialExtensions([old])
            if (extension) pass.material.registerMaterialExtensions([extension])
        }
    }

    // Size of an atlas that holds every cascade: cascade n needs ceil(size / spacing_n) * side_n texels per axis.
    private _requiredAtlasSize(w: number, h: number, out: Vector2) {
        out.set(0, 0)
        for (let n = 0; n < this.cascadeCount; n++) {
            const spacing = this.probeSpacing * 2 ** n, side = this.dirSide * 2 ** n
            out.x = Math.max(out.x, Math.ceil(w / spacing) * side)
            out.y = Math.max(out.y, Math.ceil(h / spacing) * side)
        }
        return out
    }

    private _ensureAtlas(rm: IRenderManager, w: number, h: number) {
        const size = this._requiredAtlasSize(w, h, new Vector2())
        if (this._atlas.length && size.equals(this._atlasSize)) return
        this._disposeAtlas(rm)
        this._atlasSize.copy(size)
        for (let i = 0; i < 2; i++) {
            const t = rm.createTarget<WebGLRenderTarget>({
                depthBuffer: false,
                type: HalfFloatType,
                size: {width: size.x, height: size.y},
                minFilter: NearestFilter,
                magFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
            t.texture.name = 'rcAtlas' + i
            this._atlas.push(t)
        }
    }

    private _ensureHiZ(rm: IRenderManager, w: number, h: number) {
        if (this._hiz.length && this._hizSize.x === w && this._hizSize.y === h) return
        this._disposeHiZ(rm)
        this._hizSize.set(w, h)
        for (let i = 1; i <= HIZ_LEVELS; i++) {
            const t = rm.createTarget<WebGLRenderTarget>({
                depthBuffer: false,
                type: HalfFloatType,
                size: {width: Math.max(1, Math.ceil(w / 2 ** i)), height: Math.max(1, Math.ceil(h / 2 ** i))},
                minFilter: NearestFilter,
                magFilter: NearestFilter,
                generateMipmaps: false,
                colorSpace: LinearSRGBColorSpace,
            })
            t.texture.name = 'rcHiZ' + i
            this._hiz.push(t)
        }
        // Atlas of levels 1..6 side by side (level 1 is the tallest).
        let x = 0
        for (let i = 1; i <= HIZ_LEVELS; i++) {
            this._hizOffset[i] = x
            x += this._hiz[i - 1].width
        }
        this._hizOffset[7] = x
        this._hizAtlas = rm.createTarget<WebGLRenderTarget>({
            depthBuffer: false,
            type: HalfFloatType,
            size: {width: x, height: this._hiz[0].height},
            minFilter: NearestFilter,
            magFilter: NearestFilter,
            generateMipmaps: false,
            colorSpace: LinearSRGBColorSpace,
        })
        this._hizAtlas.texture.name = 'rcHiZAtlas'
    }

    private _disposeHiZ(rm?: IRenderManager) {
        for (const t of this._hiz) rm?.disposeTarget(t)
        this._hiz = []
        if (this._hizAtlas) rm?.disposeTarget(this._hizAtlas)
        this._hizAtlas = undefined
    }

    private _disposeAtlas(rm?: IRenderManager) {
        for (const t of this._atlas) rm?.disposeTarget(t)
        this._atlas = []
    }

    /**
     * @param output - receives the GI buffer (rgb = irradiance / PI, a = occlusion)
     * @param lastFrame - the previous final frame (light at the ray hits)
     * @param lastProjectionView - projection x view matrix of the previous frame (reprojects the hits into lastFrame)
     */
    render(renderer: IWebGLRenderer, output: WebGLRenderTarget, camera: ICamera, lastFrame: Texture|null,
           lastProjectionView: Matrix4, staticFrame: boolean, radianceClamp: number,
           scene?: {modelRoot?: IObject3D, environment?: Texture|null, environmentIntensity?: number} & IObject3D) {
        const rm = renderer.renderManager
        const w = output.width, h = output.height
        this._screenSize.set(w, h)
        this._ensureAtlas(rm, w, h)
        this._ensureHiZ(rm, w, h)
        this._viewMatrix.copy(camera.matrixWorldInverse)
        this._inverseViewMatrix.copy(camera.matrixWorld)
        this._lastProjectionView.copy(lastProjectionView)

        this._collect()
        this._tick(renderer, 'hiz')
        // Depth pyramid: level 1 from the G-buffer, each further level from the one before.
        const hu = this.hizPass.uniforms
        camera.updateShaderProperties(this.hizPass.material)
        for (let i = 0; i < this._hiz.length; i++) {
            hu.fromGBuffer.value = i === 0
            hu.tSource.value = i === 0 ? null : this._hiz[i - 1].texture
            hu.sourceSize.value.set(i === 0 ? w : this._hiz[i - 1].width, i === 0 ? h : this._hiz[i - 1].height)
            this.hizPass.material.uniformsNeedUpdate = true
            this.hizPass.render(renderer, this._hiz[i], i === 0 ? undefined : this._hiz[i - 1])
        }

        const cu = this.cascadePass.uniforms
        camera.updateShaderProperties(this.cascadePass.material)
        const mode = scene ? this.worldMode : 0
        this._hitU.radianceClamp.value = radianceClamp
        this._hitU.staticFrame.value = staticFrame
        this._hitU.tLastFrame.value = lastFrame
        if (mode > 0 && scene) {
            this.ensureWorld(scene, renderer)
            const env = scene.environment ?? null
            const envIntensity = scene.environmentIntensity ?? 1
            const key = (env?.uuid ?? '') + envIntensity
            if (key !== this._lightsKey) {
                this.world.updateLights(scene, env, envIntensity, renderer)
                this._lightsKey = key
                this._gridFull = true
            } else {
                const sun = this.world.sunDirection.clone(), rad = this.world.sunRadiance.clone()
                this.world.updateLights(scene, null, 0, renderer, true)
                // A moving sun (a time-of-day animation) is not worth a full retrace on every frame: the grid follows it in
                // bands, one pass over all rows after the last change.
                if (sun.distanceTo(this.world.sunDirection) > 1e-4 || rad.distanceTo(this.world.sunRadiance) > 1e-4 * (1 + rad.length())) this._gridStaleRows = -1
            }
            cu.worldCascade.value = this.worldCascade
            this._worldU.rcProjectionView.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            if (mode === 2) {
                this._tick(renderer, 'gridUpdate')
                this._updateGrid(renderer, camera)
            }
        }
        this._setDefine(this.cascadePass, 'RC_WORLD', mode === 1)
        this._setDefine(this.cascadePass, 'RC_GRID', mode === 2)
        cu.probeSpacing.value = this.probeSpacing
        cu.dirSide.value = this.dirSide
        cu.cascadeCount.value = this.cascadeCount
        cu.intervalScale.value = this.intervalScale
        cu.tolerance.value = this.tolerance
        const pu = this.hizPackPass.uniforms
        for (let i = 0; i < this._hiz.length; i++) pu['tHiZ' + (i + 1)].value = this._hiz[i].texture
        this.hizPackPass.material.uniformsNeedUpdate = true
        this.hizPackPass.render(renderer, this._hizAtlas!)
        cu.tHiZ.value = this._hizAtlas!.texture

        // Last cascade first; each pass reads the one above it from the other atlas.
        let src = this._atlas[1], dst = this._atlas[0]
        const n = Math.max(1, Math.round(this.cascadeCount))
        for (let i = n - 1; i >= 0; i--) {
            this._tick(renderer, 'cascade' + i)
            cu.cascadeIndex.value = i
            cu.tUpper.value = src.texture
            this.cascadePass.material.uniformsNeedUpdate = true
            this.cascadePass.render(renderer, dst, src)
            const t = src; src = dst; dst = t
        }
        const c0 = src // the last pass wrote cascade 0

        const fallbackView = this.debugView === 3
        if (!!this.gatherPass.material.defines.RC_DEBUG_FALLBACK !== fallbackView) {
            if (fallbackView) this.gatherPass.material.defines.RC_DEBUG_FALLBACK = 1
            else delete this.gatherPass.material.defines.RC_DEBUG_FALLBACK
            this.gatherPass.material.needsUpdate = true
        }
        if (this.debugView > 0 && !fallbackView) {
            const du = this.debugPass.uniforms
            du.atlasUv.value.set(Math.ceil(w / this.probeSpacing) * this.dirSide / this._atlasSize.x, Math.ceil(h / this.probeSpacing) * this.dirSide / this._atlasSize.y)
            du.showAlpha.value = this.debugView === 2
            this.debugPass.material.uniformsNeedUpdate = true
            this.debugPass.render(renderer, output, c0)
            this._tick(renderer, '')
            return
        }

        this._tick(renderer, 'gather')
        const gu = this.gatherPass.uniforms
        this._setDefine(this.gatherPass, 'RC_GATHER_SH', this.shGather)
        if (this.shGather) {
            const pw = Math.ceil(w / this.probeSpacing) * 4, ph = Math.ceil(h / this.probeSpacing)
            if (!this._probeSH || this._probeSH.width !== pw || this._probeSH.height !== ph) {
                if (this._probeSH) rm.disposeTarget(this._probeSH)
                this._probeSH = rm.createTarget<WebGLRenderTarget>({depthBuffer: false, type: HalfFloatType, size: {width: pw, height: ph},
                    minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, colorSpace: LinearSRGBColorSpace})
                this._probeSH.texture.name = 'rcProbeSH'
            }
            const su = this.probeSHPass.uniforms
            su.probeSpacing.value = this.probeSpacing
            su.dirSide.value = this.dirSide
            this.probeSHPass.material.uniformsNeedUpdate = true
            this.probeSHPass.render(renderer, this._probeSH, c0)
            gu.tProbeSH.value = this._probeSH.texture
        }
        camera.updateShaderProperties(this.gatherPass.material)
        gu.probeSpacing.value = this.probeSpacing
        gu.dirSide.value = this.dirSide
        gu.tCascade0.value = c0.texture
        this.gatherPass.material.uniformsNeedUpdate = true
        this.gatherPass.render(renderer, output, c0)
        this._tick(renderer, '')
    }

    /**
     * Builds the scene BVH and material table on first use and after {@link rebuildWorld} (shared with the sky
     * visibility volume of the SSGI plugin).
     */
    ensureWorld(scene: {modelRoot?: IObject3D} & IObject3D, renderer: IWebGLRenderer) {
        if (!this._worldDirty && this.world.built) return this.world
        this.world.build(scene.modelRoot ?? scene, renderer)
        this._worldDirty = false
        this._lightsKey = ''
        this._gridKey = ''
        this._worldU.tMaterials.value = this.world.materials
        return this.world
    }

    private _setDefine(pass: ExtendedShaderPass, name: string, on: boolean) {
        if (!!pass.material.defines[name] === on) return
        if (on) pass.material.defines[name] = 1
        else delete pass.material.defines[name]
        pass.material.needsUpdate = true
    }

    // World probe grid: (re)built with the BVH or a new probe count; traced in bands of rows, all rows on the first frame.
    private _updateGrid(renderer: IWebGLRenderer, camera: ICamera) {
        const rm = renderer.renderManager
        const side = this._gridU.gridDirSide.value
        const key = this.gridProbes + '_' + this.world.triangles
        if (key !== this._gridKey || !this._grid || !this._gridValid) {
            this._gridKey = key
            const g = this.world.gridLayout(this.gridProbes)
            this._gridU.gridMin.value.copy(g.min)
            this._gridU.gridCell.value.copy(g.cell)
            this._gridU.gridDims.value.copy(g.dims)
            this._gridU.gridTilesX.value = g.tilesX
            if (this._grid) rm.disposeTarget(this._grid)
            if (this._gridValid) rm.disposeTarget(this._gridValid)
            const opts = {depthBuffer: false, type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, colorSpace: LinearSRGBColorSpace}
            this._grid = rm.createTarget<WebGLRenderTarget>({...opts, size: {width: g.tilesX * side, height: g.tilesY * side}})
            this._grid.texture.name = 'rcGrid'
            this._gridValid = rm.createTarget<WebGLRenderTarget>({...opts, size: {width: g.tilesX, height: g.tilesY}})
            this._gridValid.texture.name = 'rcGridValid'
            this.gridValidPass.material.uniformsNeedUpdate = true
            this.gridValidPass.render(renderer, this._gridValid)
            this._gridRow = 0
            this._gridFull = true
        }
        const grid = this._grid!
        const tilesY = grid.height / side
        if (this._gridStaleRows < 0) this._gridStaleRows = tilesY
        if (!this._gridFull && !this.gridContinuous && this._gridStaleRows <= 0) {
            this._bindGrid()
            return
        }
        const rows = this._gridFull ? tilesY : Math.max(1, Math.ceil(tilesY * this.gridUpdateFraction))
        this._gridStaleRows = this._gridFull ? 0 : Math.max(0, this._gridStaleRows - rows)
        const gu = this.gridUpdatePass.uniforms
        camera.updateShaderProperties(this.gridUpdatePass.material)
        gu.gridStart.value = 0.5 * Math.max(this._gridU.gridCell.value.x, this._gridU.gridCell.value.y, this._gridU.gridCell.value.z)
        gu.tGridValid.value = this._gridValid!.texture
        this.gridUpdatePass.material.uniformsNeedUpdate = true
        // A band of rows, wrapping around: one or two scissored draws.
        let start = this._gridRow, left = rows
        while (left > 0) {
            const n = Math.min(left, tilesY - start)
            grid.scissor.set(0, start * side, grid.width, n * side)
            grid.scissorTest = true
            this.gridUpdatePass.render(renderer, grid)
            left -= n
            start = (start + n) % tilesY
        }
        grid.scissorTest = false
        this._gridRow = start
        this._gridFull = false
        this._bindGrid()
    }

    private _bindGrid() {
        const grid = this._grid!
        const cu = this.cascadePass.uniforms
        cu.tGrid.value = grid.texture
        cu.tGridValid.value = this._gridValid!.texture
        const cell = this._gridU.gridCell.value
        cu.gridMinT.value = this.gridMinCells * Math.max(cell.x, cell.y, cell.z)
    }

    dispose(renderManager?: IRenderManager) {
        if (this._grid) renderManager?.disposeTarget(this._grid)
        if (this._gridValid) renderManager?.disposeTarget(this._gridValid)
        if (this._probeSH) renderManager?.disposeTarget(this._probeSH)
        this._grid = this._gridValid = this._probeSH = undefined
        this._disposeAtlas(renderManager)
        this._disposeHiZ(renderManager)
        this.world.dispose()
        for (const p of [this.cascadePass, this.gatherPass, this.debugPass, this.hizPass, this.hizPackPass, this.gridUpdatePass, this.gridValidPass, this.probeSHPass]) p.dispose()
    }
}
