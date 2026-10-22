import {
    ConstantAlphaFactor,
    CustomBlending,
    ExtendedShaderPass,
    NoBlending,
    OneMinusConstantAlphaFactor,
    GLSL3,
    HalfFloatType,
    IObject3D,
    IWebGLRenderer,
    LinearSRGBColorSpace,
    NearestFilter,
    shaderUtils,
    Texture,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
import {BVHShaderGLSL} from 'three-mesh-bvh'
import svvBake from './shaders/svvBake.glsl'
import svvRadiance from './shaders/svvRadiance.glsl'
import svvSample from './shaders/svvSample.glsl'
import {RadianceCascadesWorld} from './RadianceCascadesWorld'

const bvhChunks = `
#define BVH_STACK_DEPTH 60
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}
`

/**
 * Sky visibility volume (IJ-851, the "environment map shadows" study): a world-space grid of probes over the scene,
 * each with the L1 spherical harmonics of "which directions see the sky" (rays through the scene BVH of
 * {@link RadianceCascadesWorld}). The materials scale their environment light by it: diffuse by the visibility over
 * the normal's cosine lobe, specular by the visibility around the reflection direction. Rooms are then lit by the
 * environment only through their openings, as in a path tracer, and the environment intensity can stay at 1.
 *
 * The visibility does not depend on the environment map, so rotating or swapping it is free; it is baked again only
 * when the geometry (the BVH) or the probe count changes, in bands of rows over a few frames.
 *
 * With {@link farLight}, a second bake stores the light that the surfaces around each probe send to it (one bounce:
 * sun with shadows, sky through this visibility, emission) as L1 spherical harmonics per color channel. The SSGI
 * trace reads it for rays that leave the screen or hit nothing, so bounce light from walls and floors that the
 * screen does not show still arrives. It follows the sun and the environment in bands of rows.
 */
export class SkyVisibilityVolume {
    /** Probes over the scene bounds (cubic cells). */
    probes = 32768
    /** Rays per probe (at most 256). */
    rays = 128
    /** Rows of probes baked per frame, as a fraction of all rows. */
    rowsPerFrame = 0.125
    /** Also bakes the far bounce light for the SSGI trace. */
    farLight = true
    /** Rays per probe of each far light pass that follows a light change (over the whole grid). */
    farRaysPerPass = 8
    /** Weight of each such pass in the stored far light (lower is smoother and slower to follow). */
    farBlend = 0.2
    /**
     * Rows of probes of each such pass per frame, as a fraction of all rows. The whole grid with 8 rays per probe cost
     * ~65 ms per frame on an M4 Pro (1920x1080 classroom), so a pass is spread over 8 frames.
     */
    farRowsPerFrame = 0.125

    readonly bakePass: ExtendedShaderPass
    readonly radiancePass: ExtendedShaderPass
    /** Uniforms for the lookups (svvSample.glsl); the same objects stay valid across re-bakes. */
    readonly uniforms = {
        tSkyVis: {value: null as Texture|null},
        svvMin: {value: new Vector3()},
        svvCell: {value: new Vector3(1, 1, 1)},
        svvDims: {value: new Vector3(1, 1, 1)},
        svvTilesX: {value: 1},
        tFarR: {value: null as Texture|null},
        tFarG: {value: null as Texture|null},
        tFarB: {value: null as Texture|null},
    }
    static readonly SampleShader = svvSample

    private _target?: WebGLRenderTarget
    private _far?: WebGLRenderTarget
    private _key = ''
    private _row = 0
    private _rows = 0
    private _farCursor = 0 // next row of the far light
    private _farDone = false // a complete pass exists
    private _farStale = 0 // passes left after a light change (-1: start over)
    private _farPass = 0
    private _lightsKey = ''

    /** True once every probe's visibility is baked. */
    get ready() {
        return !!this._target && this._row >= this._rows
    }

    /** True once the far light holds a complete pass (it may still be following a light change). */
    get farReady() {
        return !!this._far && this._farDone
    }

    constructor(readonly world: RadianceCascadesWorld) {
        const grid = {
            svvMin: this.uniforms.svvMin,
            svvCell: this.uniforms.svvCell,
            svvDims: this.uniforms.svvDims,
            svvTilesX: this.uniforms.svvTilesX,
        }
        this.bakePass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: bvhChunks + svvBake,
            uniforms: {
                bvh: {value: world.bvh},
                tBvhNormal: {value: world.normals},
                ...grid,
                svvRays: {value: 128},
                svvFill: {value: false},
            },
        })
        this.bakePass.clear = false
        this.radiancePass = new ExtendedShaderPass({
            glslVersion: GLSL3,
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: bvhChunks + svvSample + svvRadiance,
            uniforms: {
                bvh: {value: world.bvh},
                tBvhNormal: {value: world.normals},
                tBvhMaterial: {value: world.materialIndex},
                tMaterials: {value: null},
                sunDirection: {value: world.sunDirection},
                sunRadiance: {value: world.sunRadiance},
                envUp: {value: world.envUp},
                envDown: {value: world.envDown},
                tSkyVis: this.uniforms.tSkyVis,
                ...grid,
                svvRays: {value: 128},
                svvStride: {value: 1},
                svvOffset: {value: 0},
                radianceClamp: {value: 8},
            },
        })
        this.radiancePass.clear = false
    }

    /**
     * Bakes the next band of rows; a new BVH or probe count starts over (unbaked probes count as open sky). Then, with
     * farLight, the far light, again when the sun or the environment changes.
     */
    update(renderer: IWebGLRenderer, scene?: {environment?: Texture|null, environmentIntensity?: number} & IObject3D, radianceClamp = 8) {
        const rm = renderer.renderManager
        const world = this.world
        const key = this.probes + '_' + world.triangles + '_' + world.bounds.min.toArray().join(',') + world.bounds.max.toArray().join(',')
        const u = this.bakePass.uniforms
        if (key !== this._key || !this._target) {
            this._key = key
            // The grid reaches a little beyond the bounds, so the outermost surfaces have probes on both sides.
            const g = world.gridLayout(this.probes)
            this.uniforms.svvMin.value.copy(g.min).sub(g.cell)
            this.uniforms.svvCell.value.copy(g.cell)
            this.uniforms.svvDims.value.copy(g.dims).addScalar(2)
            const total = this.uniforms.svvDims.value.x * this.uniforms.svvDims.value.y * this.uniforms.svvDims.value.z
            const tilesX = Math.ceil(Math.sqrt(total))
            this.uniforms.svvTilesX.value = tilesX
            this._rows = Math.ceil(total / tilesX)
            const opts = {depthBuffer: false, type: HalfFloatType, size: {width: tilesX, height: this._rows},
                minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, colorSpace: LinearSRGBColorSpace} as const
            if (this._target) rm.disposeTarget(this._target)
            this._target = rm.createTarget<WebGLRenderTarget>({...opts})
            this._target.texture.name = 'skyVisibility'
            this.uniforms.tSkyVis.value = this._target.texture
            if (this._far) rm.disposeTarget(this._far)
            this._far = undefined
            this.uniforms.tFarR.value = this.uniforms.tFarG.value = this.uniforms.tFarB.value = null
            u.svvFill.value = true
            this.bakePass.material.uniformsNeedUpdate = true
            this.bakePass.render(renderer, this._target)
            u.svvFill.value = false
            this._row = 0
            this._farCursor = 0
            this._farDone = false
            this._farStale = 0
            this._lightsKey = ''
        }
        const rays = Math.min(256, Math.max(8, Math.round(this.rays)))
        const band = Math.max(1, Math.ceil(this._rows * this.rowsPerFrame))
        if (this._row < this._rows) {
            const n = Math.min(this._rows - this._row, band)
            u.svvRays.value = rays
            this.bakePass.material.uniformsNeedUpdate = true
            this._renderBand(renderer, this.bakePass, this._target!, this._row, n)
            this._row += n
            return
        }
        if (!this.farLight || !scene) return

        // Far light: sun every frame (cheap), environment means only when the environment changes (a read back).
        const env = scene.environment ?? null, envIntensity = scene.environmentIntensity ?? 1
        const lightsKey = (env?.uuid ?? '') + envIntensity
        const sun = world.sunDirection.clone(), rad = world.sunRadiance.clone()
        if (lightsKey !== this._lightsKey) {
            world.updateLights(scene, env, envIntensity, renderer)
            this._lightsKey = lightsKey
            this._farStale = -1
        } else {
            world.updateLights(scene, null, 0, renderer, true)
            if (sun.distanceTo(world.sunDirection) > 1e-4 || rad.distanceTo(world.sunRadiance) > 1e-4 * (1 + rad.length())) this._farStale = -1
        }
        if (!this._far) {
            this._far = rm.createTarget<WebGLRenderTarget>({depthBuffer: false, type: HalfFloatType, size: {width: this._target!.width, height: this._rows},
                minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, colorSpace: LinearSRGBColorSpace, textureCount: 3} as any)
            const t = (this._far as any).textures as Texture[]
            t.forEach((x, i) => x.name = 'skyFarLight' + 'RGB'[i])
            this.uniforms.tFarR.value = t[0]
            this.uniforms.tFarG.value = t[1]
            this.uniforms.tFarB.value = t[2]
            this._farCursor = 0
            this._farDone = false
            this._farStale = 0
        }
        const stride = Math.max(1, Math.round(rays / Math.max(1, this.farRaysPerPass)))
        const farBand = Math.max(1, Math.ceil(this._rows * this.farRowsPerFrame))
        // After a change: enough bands to cover every direction of every probe once.
        if (this._farStale < 0) this._farStale = stride * Math.ceil(this._rows / farBand)
        if (this._farDone && this._farStale <= 0) return
        const ru = this.radiancePass.uniforms
        const m = this.radiancePass.material
        ru.tMaterials.value = world.materials
        ru.svvRays.value = rays
        ru.radianceClamp.value = radianceClamp
        if (!this._farDone) {
            // First bake: all directions, bands of rows, replacing.
            ru.svvStride.value = 1
            ru.svvOffset.value = 0
            m.blending = NoBlending
            m.uniformsNeedUpdate = true
            const n = Math.min(this._rows - this._farCursor, band)
            this._renderBand(renderer, this.radiancePass, this._far, this._farCursor, n)
            this._farCursor += n
            if (this._farCursor >= this._rows) { this._farCursor = 0; this._farDone = true }
            return
        }
        // Following a light change: a band of probes, a strided subset of the directions, blended in; the subset
        // changes each time the bands wrap around.
        ru.svvStride.value = stride
        ru.svvOffset.value = this._farPass % stride
        m.blending = CustomBlending
        m.blendSrc = ConstantAlphaFactor
        m.blendDst = OneMinusConstantAlphaFactor
        m.blendSrcAlpha = ConstantAlphaFactor
        m.blendDstAlpha = OneMinusConstantAlphaFactor
        ;(m as any).blendAlpha = this.farBlend
        m.uniformsNeedUpdate = true
        const n = Math.min(this._rows - this._farCursor, farBand)
        this._renderBand(renderer, this.radiancePass, this._far, this._farCursor, n)
        this._farCursor += n
        if (this._farCursor >= this._rows) { this._farCursor = 0; this._farPass++ }
        this._farStale--
    }

    private _renderBand(renderer: IWebGLRenderer, pass: ExtendedShaderPass, t: WebGLRenderTarget, row: number, n: number) {
        t.scissor.set(0, row, t.width, n)
        t.scissorTest = true
        pass.render(renderer, t)
        t.scissorTest = false
    }

    dispose(renderer?: IWebGLRenderer) {
        if (this._target) renderer?.renderManager.disposeTarget(this._target)
        if (this._far) renderer?.renderManager.disposeTarget(this._far)
        this._target = this._far = undefined
        this.uniforms.tSkyVis.value = this.uniforms.tFarR.value = this.uniforms.tFarG.value = this.uniforms.tFarB.value = null
        this._key = ''
        this.bakePass.dispose()
        this.radiancePass.dispose()
    }
}
