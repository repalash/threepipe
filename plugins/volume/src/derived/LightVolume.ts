import {
    Data3DTexture,
    HalfFloatType,
    LinearFilter,
    Matrix3,
    RedFormat,
    UnsignedByteType,
    Vector3,
    WebGL3DRenderTarget,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'threepipe'
import {DerivedField, DerivedFieldPass} from './DerivedField'
import {VolumeKernel} from './VolumeKernel'
import {opacityKernelGLSL, opacityParamsKey, opacityUniforms, setOpacityUniforms, VolumeOpacityParams} from './opacityParams'

export interface LightVolumeParams extends VolumeOpacityParams {
    /**
     * Direction toward the light in texture coordinates (0..1 per axis), not normalized.
     */
    lightDirection: Vector3
    /**
     * Voxel counts of the source texture.
     */
    sourceSize: [number, number, number]
    /**
     * Size of the light volume relative to the source, per axis. Default 0.5.
     */
    scale: number
}

// One slice: the light that reaches each voxel is the light at the point one slice closer to the light (bilinear
// in the previous slice; light from outside the box is unshadowed), times what passes through the segment between.
const stepKernel = `
${opacityKernelGLSL}
uniform sampler2D uPrev;      // transmittance of the previous slice, toward the light
uniform int uFirst;           // 1 for the first slice, on the side of the light
uniform int uSlice;           // index of this slice along the sweep axis
uniform vec3 uStep;           // one slice toward the light, in light grid voxels (permuted axes, |z| = 1)
uniform ivec3 uGrid;          // light grid size (permuted axes)
uniform mat3 uToTexture;      // permuted light grid coordinate / grid size -> texture coordinate
uniform vec3 uVoxelScale;     // opacity unit distances per light grid voxel (permuted axes)
vec4 kernel(ivec3 p) {
    if (uFirst == 1) return vec4(1.0);
    vec3 pos = vec3(vec2(p.xy) + 0.5, float(uSlice) + 0.5);
    vec3 q = pos + uStep;
    float prev = 1.0;
    vec2 g = vec2(uGrid.xy);
    if (q.x > 0.0 && q.y > 0.0 && q.x < g.x && q.y < g.y) prev = texture(uPrev, q.xy / g).r;
    // two samples on the segment, each for half of it, in opacity unit distances
    float len = 0.5 * length(uStep * uVoxelScale);
    vec3 gs = vec3(uGrid);
    float t = volTransmittance(volOpacity(uToTexture * ((pos + 0.25 * uStep) / gs)), len) *
              volTransmittance(volOpacity(uToTexture * ((pos + 0.75 * uStep) / gs)), len);
    return vec4(prev * t);
}
`

const copyKernel = `
uniform sampler2D uSlice;
vec4 kernel(ivec3 p) {
    return texelFetch(uSlice, p.xy, 0);
}
`

/**
 * One draw per slice into a 2D target, from the previous slice, then a copy into the layer of the 3D target: a
 * texture cannot be read while it is drawn into.
 */
class LightPropagation {
    flip = false
    private _ping?: WebGLRenderTarget
    private _pong?: WebGLRenderTarget
    constructor(readonly step: VolumeKernel, readonly copy: VolumeKernel, readonly sliceType: typeof HalfFloatType | typeof UnsignedByteType) {}

    run(renderer: WebGLRenderer, target: WebGL3DRenderTarget, from: number, to: number) {
        const w = target.width, h = target.height
        if (!this._ping || this._ping.width !== w || this._ping.height !== h) {
            this._ping?.dispose()
            this._pong?.dispose()
            const opts = {format: RedFormat, type: this.sliceType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false}
            this._ping = new WebGLRenderTarget(w, h, opts)
            this._pong = new WebGLRenderTarget(w, h, opts)
        }
        for (let k = from; k < to; k++) {
            const slice = this.flip ? target.depth - 1 - k : k
            const u = this.step.uniforms
            u.uFirst.value = k === 0 ? 1 : 0
            u.uSlice.value = slice
            u.uPrev.value = this._pong!.texture
            this.step.run(renderer, this._ping!, 0, 1)
            this.copy.uniforms.uSlice.value = this._ping!.texture
            this.copy.run(renderer, target, slice, slice + 1)
            const t = this._ping
            this._ping = this._pong
            this._pong = t
        }
    }

    dispose() {
        this._ping?.dispose()
        this._pong?.dispose()
        this._ping = this._pong = undefined
    }
}

/**
 * The light that reaches each point of a volume from one light, through the volume (transmittance, 0 to 1), for
 * shadows of the volume on itself. Built on the GPU by sweeping slices from the side of the light, each from the
 * previous one (light propagation, as in Ropinski et al., "Interactive Volumetric Lighting Simulating Scattering and
 * Shadowing", 2010), so it costs a few reads per voxel whatever the size. The slices go along the axis closest to
 * the light direction, so the texture is stored with its axes permuted: look it up with {@link permutation}.
 *
 * Kept double buffered: while it builds again (the light moved, the transfer function changed), {@link texture} is
 * the last finished one.
 *
 * @category Derived Fields
 */
export class LightVolume extends DerivedField {
    readonly isLightVolume = true
    name = 'light'

    /**
     * Texture coordinate (x, y, z) to the coordinate of {@link texture}, for the last finished build.
     */
    readonly permutation = new Matrix3()

    private _front?: WebGL3DRenderTarget
    private _back?: WebGL3DRenderTarget
    private _frontPermutation = new Matrix3()
    private _offset = new Vector3()
    private _frontOffset = new Vector3()

    /**
     * Shadow bias, in voxels of the light volume: lookups are moved this far toward the light, so a sample at the edge
     * of a dense part does not read the light inside it.
     */
    bias = 1.5
    private _step?: VolumeKernel
    private _copy?: VolumeKernel
    private _propagation?: LightPropagation
    private _params?: LightVolumeParams
    private _key = ''
    private _size: [number, number, number] = [1, 1, 1]

    get size(): [number, number, number] {
        return this._size
    }

    /**
     * The last finished light volume, or undefined before the first build.
     */
    get texture(): Data3DTexture | undefined {
        return this._front?.texture
    }

    get gpuBytes() {
        const [x, y, z] = this._size
        return ((this._front ? 1 : 0) + (this._back ? 1 : 0)) * x * y * z
    }

    /**
     * Sets the inputs; the volume is built again when they change. A light direction that moved by less than about
     * half a degree keeps the volume.
     */
    setParams(params: LightVolumeParams) {
        const d = params.lightDirection.clone().normalize()
        const q = (v: number) => Math.round(v * 100) / 100
        const key = [opacityParamsKey(params), q(d.x), q(d.y), q(d.z), params.sourceSize.join('x'), params.scale].join(',')
        this._params = params
        if (key !== this._key) {
            this._key = key
            this.invalidate()
        }
    }

    protected _canBuild() {
        return !!this._params
    }

    protected _onBuilt() {
        const t = this._front
        this._front = this._back
        this._back = t
        this._frontPermutation.copy(this.permutation)
        this._frontOffset.copy(this._offset)
    }

    /**
     * Offset toward the light, in texture coordinates, to add before the lookup ({@link bias}), for the texture returned
     * by {@link texture}.
     */
    get textureOffset(): Vector3 {
        return this._frontOffset
    }

    /**
     * The permutation of the texture returned by {@link texture}.
     */
    get texturePermutation(): Matrix3 {
        return this._frontPermutation
    }

    protected _createPasses(renderer: WebGLRenderer): DerivedFieldPass[] {
        const p = this._params!
        const grid = p.sourceSize.map(s => Math.max(2, Math.ceil(s * p.scale))) as [number, number, number]
        // light direction in light grid voxels: the sweep goes along its largest axis
        const dir = [p.lightDirection.x * grid[0], p.lightDirection.y * grid[1], p.lightDirection.z * grid[2]]
        const c = [0, 1, 2].reduce((a, b) => Math.abs(dir[b]) > Math.abs(dir[a]) ? b : a, 0)
        const [a, b] = [0, 1, 2].filter(i => i !== c)
        const axes = [a, b, c]
        this._size = [grid[a], grid[b], grid[c]]
        // texture (x, y, z) -> permuted: row i picks axis axes[i]
        const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
        axes.forEach((axis, row) => m[row * 3 + axis] = 1)
        this.permutation.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8])
        const toTexture = this.permutation.clone().transpose()
        const dirLen = Math.hypot(dir[0], dir[1], dir[2]) || 1
        this._offset.set(dir[0] / dirLen / grid[0], dir[1] / dirLen / grid[1], dir[2] / dirLen / grid[2]).multiplyScalar(this.bias)

        this._back = this._makeTarget(this._back, this._size, {format: RedFormat, type: UnsignedByteType, linear: true, name: 'light-volume'})
        const ext = renderer.extensions
        const sliceType = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float') ? HalfFloatType : UnsignedByteType
        if (!this._step) this._step = new VolumeKernel({
            name: 'VolumeLightStep',
            fragment: stepKernel,
            uniforms: {
                ...opacityUniforms(),
                uPrev: {value: null}, uFirst: {value: 1}, uSlice: {value: 0}, uStep: {value: new Vector3()},
                uGrid: {value: [1, 1, 1]}, uToTexture: {value: new Matrix3()}, uVoxelScale: {value: new Vector3()},
            },
        })
        if (!this._copy) this._copy = new VolumeKernel({name: 'VolumeLightCopy', fragment: copyKernel, uniforms: {uSlice: {value: null}}})
        if (!this._propagation || this._propagation.sliceType !== sliceType) {
            this._propagation?.dispose()
            this._propagation = new LightPropagation(this._step, this._copy, sliceType)
        }
        const prop = this._propagation
        // the first slice is on the side of the light: the sweep goes against the light direction
        prop.flip = dir[c] > 0
        const stepLen = Math.abs(dir[c])
        const step = new Vector3(dir[a] / stepLen, dir[b] / stepLen, dir[c] / stepLen)
        // opacity unit distances per light grid voxel, per (permuted) axis
        const voxelScale = new Vector3(p.sourceSize[a] / grid[a] * p.unitScale[a], p.sourceSize[b] / grid[b] * p.unitScale[b], p.sourceSize[c] / grid[c] * p.unitScale[c])
        return [{
            kernel: prop,
            target: this._back,
            cost: 4,
            before: () => {
                const u = this._step!.uniforms
                setOpacityUniforms(u, p)
                u.uStep.value.copy(step)
                u.uGrid.value = this._size
                u.uToTexture.value.copy(toTexture)
                u.uVoxelScale.value.copy(voxelScale)
            },
        }]
    }

    dispose() {
        this._front?.dispose()
        this._back?.dispose()
        this._front = this._back = undefined
        this._step?.dispose()
        this._copy?.dispose()
        this._propagation?.dispose()
        this._step = this._copy = this._propagation = undefined
        super.dispose()
    }
}
