import {Data3DTexture, RGBAFormat, UnsignedByteType, WebGL3DRenderTarget} from 'threepipe'
import type {VolumeData} from '../VolumeData'
import {DerivedField, DerivedFieldPass} from './DerivedField'
import {VolumeKernel} from './VolumeKernel'

/**
 * Largest length of a gradient stored by {@link GradientField}: central differences of texture values in 0..1 are
 * at most 0.5 per axis.
 */
export const gradientMaxLength = Math.sqrt(3) * 0.5

const gradientKernel = `
uniform sampler3D uSource;
float v(ivec3 p, ivec3 size) {
    return texelFetch(uSource, clamp(p, ivec3(0), size - 1), 0).r;
}
vec4 kernel(ivec3 p) {
    ivec3 size = textureSize(uSource, 0);
    // central differences per voxel, half the difference of the neighbours
    vec3 g = 0.5 * vec3(
        v(p + ivec3(1, 0, 0), size) - v(p - ivec3(1, 0, 0), size),
        v(p + ivec3(0, 1, 0), size) - v(p - ivec3(0, 1, 0), size),
        v(p + ivec3(0, 0, 1), size) - v(p - ivec3(0, 0, 1), size));
    float len = length(g);
    vec3 n = len > 0.0 ? g / len : vec3(0.0);
    return vec4(n * 0.5 + 0.5, clamp(len / ${gradientMaxLength.toFixed(7)}, 0.0, 1.0));
}
`

/**
 * The gradient of a field, per voxel, as an RGBA8 3D texture of the same size: the direction in RGB (`n * 0.5 + 0.5`)
 * and the length in A (over {@link gradientMaxLength}), in texture value per voxel.
 *
 * Reading it costs one texture lookup instead of six for central differences, for shading every sample; it takes
 * 4 bytes per voxel. Cached on the field ({@link GradientField.of}), rebuilt when the field changes.
 *
 * @category Derived Fields
 */
export class GradientField extends DerivedField {
    readonly isGradientField = true
    name = 'gradient'

    private _target?: WebGL3DRenderTarget
    private _kernel?: VolumeKernel

    constructor(readonly source: VolumeData) {
        super()
        source.events.addEventListener('update', this._sourceUpdate)
    }

    static of(source: VolumeData): GradientField {
        return source.getDerived('gradient', () => new GradientField(source))
    }

    private _sourceUpdate = () => this.invalidate()

    get size(): [number, number, number] {
        return this.source.textureSize
    }

    get texture(): Data3DTexture | undefined {
        return this._target?.texture
    }

    get gpuBytes() {
        const [x, y, z] = this.size
        return this._target ? x * y * z * 4 : 0
    }

    protected _createPasses(): DerivedFieldPass[] {
        this._target = this._makeTarget(this._target, this.size, {format: RGBAFormat, type: UnsignedByteType, linear: true, name: this.source.name + '-gradient'})
        if (!this._kernel) this._kernel = new VolumeKernel({
            name: 'VolumeGradient',
            fragment: gradientKernel,
            uniforms: {uSource: {value: null}},
        })
        return [{
            kernel: this._kernel,
            target: this._target,
            cost: 6,
            before: () => {
                this._kernel!.uniforms.uSource.value = this.source.texture
            },
        }]
    }

    dispose() {
        this.source.events.removeEventListener('update', this._sourceUpdate)
        this._target?.dispose()
        this._target = undefined
        this._kernel?.dispose()
        this._kernel = undefined
        super.dispose()
    }
}
