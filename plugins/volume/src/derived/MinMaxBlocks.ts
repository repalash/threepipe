import {Data3DTexture, HalfFloatType, RGFormat, UnsignedByteType, WebGL3DRenderTarget, WebGLRenderer} from 'threepipe'
import type {VolumeData} from '../VolumeData'
import {DerivedField, DerivedFieldPass} from './DerivedField'
import {VolumeKernel} from './VolumeKernel'

const minMaxKernel = `
uniform sampler3D uSource;
uniform int uBlockSize;
uniform int uFloat;           // 1: half float target, values as they are
vec4 kernel(ivec3 b) {
    ivec3 size = textureSize(uSource, 0);
    // the voxels of the block and one more on each side: a sample in the block interpolates its neighbours too
    ivec3 lo = max(b * uBlockSize - 1, ivec3(0));
    ivec3 hi = min((b + 1) * uBlockSize, size - 1);
    float mn = 1e20;
    float mx = -1e20;
    for (int z = lo.z; z <= hi.z; z++)
    for (int y = lo.y; y <= hi.y; y++)
    for (int x = lo.x; x <= hi.x; x++) {
        float v = texelFetch(uSource, ivec3(x, y, z), 0).r;
        mn = min(mn, v);
        mx = max(mx, v);
    }
    if (uFloat == 1) {
        // half floats have 11 significant bits: widen by more than their rounding
        return vec4(mn - abs(mn) * 0.001 - 1e-4, mx + abs(mx) * 0.001 + 1e-4, 0.0, 1.0);
    }
    // stored in 8 bits, rounded outwards so the range always contains the values. For a texture with values
    // outside 0..1 (openEnds), 0 and 1 also stand for any value below 0 and above 1
    return vec4(floor(clamp(mn, 0.0, 1.0) * 255.0) / 255.0, ceil(clamp(mx, 0.0, 1.0) * 255.0) / 255.0, 0.0, 1.0);
}
`

/**
 * The range of texture values in each block of `blockSize`³ voxels of a field, as an RG8 3D texture (min, max)
 * with one texel per block. The range of a block includes the voxels next to it, so it bounds every interpolated
 * sample inside the block.
 *
 * Built on the GPU from {@link VolumeData.texture}, cached on the field ({@link MinMaxBlocks.of}), and rebuilt
 * when the field changes. Used for empty space skipping ({@link EmptySpaceMap}) and by MIP / MinIP rays.
 *
 * @category Derived Fields
 */
export class MinMaxBlocks extends DerivedField {
    readonly isMinMaxBlocks = true
    name = 'minmax'

    private _target?: WebGL3DRenderTarget
    private _kernel?: VolumeKernel
    private _float = false

    constructor(readonly source: VolumeData, readonly blockSize = 8) {
        super()
        source.events.addEventListener('update', this._sourceUpdate)
    }

    /**
     * The cached block ranges of a field for a block size.
     */
    static of(source: VolumeData, blockSize = 8): MinMaxBlocks {
        return source.getDerived('minmax' + blockSize, () => new MinMaxBlocks(source, blockSize))
    }

    private _sourceUpdate = () => this.invalidate()

    /**
     * Blocks along x, y, z.
     */
    get size(): [number, number, number] {
        const [x, y, z] = this.source.textureSize
        const b = this.blockSize
        return [Math.ceil(x / b), Math.ceil(y / b), Math.ceil(z / b)]
    }

    get texture(): Data3DTexture | undefined {
        return this._target?.texture
    }

    /**
     * Whether a stored 0 or 1 also stands for any value below 0 or above 1: when the texture has values outside
     * 0..1 ({@link VolumeData.textureOutsideUnitRange}) and the ranges are in 8 bits. Such a texture gets half float
     * ranges instead where the GPU can render to them, which skip more.
     */
    get openEnds(): boolean {
        return this.source.textureOutsideUnitRange && !this._float
    }

    get gpuBytes() {
        const [x, y, z] = this.size
        return this._target ? x * y * z * (this._float ? 4 : 2) : 0
    }

    protected _createPasses(renderer: WebGLRenderer): DerivedFieldPass[] {
        const ext = renderer.extensions
        this._float = this.source.textureOutsideUnitRange && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))
        this._target = this._makeTarget(this._target, this.size, {format: RGFormat, type: this._float ? HalfFloatType : UnsignedByteType, name: this.source.name + '-minmax'})
        if (!this._kernel) this._kernel = new VolumeKernel({
            name: 'VolumeMinMaxBlocks',
            fragment: minMaxKernel,
            uniforms: {uSource: {value: null}, uBlockSize: {value: this.blockSize}, uFloat: {value: 0}},
        })
        const b = this.blockSize + 2
        return [{
            kernel: this._kernel,
            target: this._target,
            cost: b * b * b,
            before: () => {
                this._kernel!.uniforms.uSource.value = this.source.texture
                this._kernel!.uniforms.uFloat.value = this._float ? 1 : 0
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
