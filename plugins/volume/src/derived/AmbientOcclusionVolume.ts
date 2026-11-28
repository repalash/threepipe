import {Data3DTexture, RedFormat, UnsignedByteType, WebGL3DRenderTarget} from 'threepipe'
import {DerivedField, DerivedFieldPass} from './DerivedField'
import {VolumeKernel} from './VolumeKernel'
import {opacityKernelGLSL, opacityParamsKey, opacityUniforms, setOpacityUniforms, VolumeOpacityParams} from './opacityParams'

export interface AmbientOcclusionParams extends VolumeOpacityParams {
    /**
     * Voxel counts of the source texture.
     */
    sourceSize: [number, number, number]
    /**
     * Size of the volume relative to the source, per axis. Default 0.5.
     */
    scale: number
    /**
     * Length of the occlusion rays, in source voxels. Default 8.
     */
    radius: number
}

// 14 directions: the 6 axes and the 8 diagonals
const directions = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
].map(d => {
    const l = Math.hypot(d[0], d[1], d[2])
    return `vec3(${(d[0] / l).toFixed(6)}, ${(d[1] / l).toFixed(6)}, ${(d[2] / l).toFixed(6)})`
})

const STEPS = 4

const aoKernel = `
${opacityKernelGLSL}
uniform vec3 uSourceSize;
uniform vec3 uUnitScale;     // opacity unit distances per source texel along x, y, z
uniform float uRadius;       // in source voxels
const vec3 aoDirs[14] = vec3[14](${directions.join(', ')});
vec4 kernel(ivec3 p) {
    vec3 uvw = (vec3(p) + 0.5) / vec3(uOutputSize);
    float h = uRadius / float(${STEPS});
    float sum = 0.0;
    for (int d = 0; d < 14; d++) {
        vec3 stepTex = aoDirs[d] * h / uSourceSize;
        float t = 1.0;
        for (int s = 1; s <= ${STEPS}; s++) {
            vec3 q = uvw + stepTex * float(s);
            if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) break;
            t *= volTransmittance(volOpacity(q), length(aoDirs[d] * h * uUnitScale));
        }
        sum += t;
    }
    // over the whole sphere, relative to a flat open surface (half of the rays free): 1 on a flat surface or in open
    // space, darker in creases and inside
    return vec4(clamp(2.0 * sum / 14.0, 0.0, 1.0));
}
`

/**
 * Local ambient occlusion of a volume: for each point, how much of the volume around it (up to {@link
 * AmbientOcclusionParams.radius} voxels) lets light through, from 14 directions. Darkens creases, cavities and the
 * inside of dense parts. Precomputed on the GPU at a lower resolution, so it costs one lookup per sample; the
 * per-sample version (vtk.js) casts the rays for every sample instead.
 *
 * Double buffered like {@link LightVolume}.
 *
 * @category Derived Fields
 */
export class AmbientOcclusionVolume extends DerivedField {
    readonly isAmbientOcclusionVolume = true
    name = 'ao'

    private _front?: WebGL3DRenderTarget
    private _back?: WebGL3DRenderTarget
    private _kernel?: VolumeKernel
    private _params?: AmbientOcclusionParams
    private _key = ''
    private _size: [number, number, number] = [1, 1, 1]

    get size(): [number, number, number] {
        return this._size
    }

    get texture(): Data3DTexture | undefined {
        return this._front?.texture
    }

    get gpuBytes() {
        const [x, y, z] = this._size
        return ((this._front ? 1 : 0) + (this._back ? 1 : 0)) * x * y * z
    }

    setParams(params: AmbientOcclusionParams) {
        const key = [opacityParamsKey(params), params.sourceSize.join('x'), params.scale, params.radius].join(',')
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
    }

    protected _createPasses(): DerivedFieldPass[] {
        const p = this._params!
        this._size = p.sourceSize.map(s => Math.max(2, Math.ceil(s * p.scale))) as [number, number, number]
        this._back = this._makeTarget(this._back, this._size, {format: RedFormat, type: UnsignedByteType, linear: true, name: 'ao-volume'})
        if (!this._kernel) this._kernel = new VolumeKernel({
            name: 'VolumeAmbientOcclusion',
            fragment: aoKernel,
            uniforms: {...opacityUniforms(), uSourceSize: {value: [1, 1, 1]}, uUnitScale: {value: [1, 1, 1]}, uRadius: {value: 8}},
        })
        return [{
            kernel: this._kernel,
            target: this._back,
            cost: 14 * STEPS,
            before: () => {
                const u = this._kernel!.uniforms
                setOpacityUniforms(u, p)
                u.uSourceSize.value = p.sourceSize
                u.uUnitScale.value = p.unitScale
                u.uRadius.value = p.radius
            },
        }]
    }

    dispose() {
        this._front?.dispose()
        this._back?.dispose()
        this._front = this._back = undefined
        this._kernel?.dispose()
        this._kernel = undefined
        super.dispose()
    }
}
