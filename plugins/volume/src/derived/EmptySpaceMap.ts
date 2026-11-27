import {
    Data3DTexture,
    DataTexture,
    FloatType,
    NearestFilter,
    RedFormat,
    Texture,
    UnsignedByteType,
    WebGL3DRenderTarget,
} from 'threepipe'
import {DerivedField, DerivedFieldPass} from './DerivedField'
import {MinMaxBlocks} from './MinMaxBlocks'
import {VolumeKernel} from './VolumeKernel'

/**
 * What makes a block of the volume worth sampling.
 * - `transfer`: some value in the block has a non-zero opacity on the transfer function (composite and x-ray rays).
 * - `iso`: the value range of the block contains the iso value (isosurface rays).
 */
export type EmptySpaceMode = 'transfer' | 'iso'

export interface EmptySpaceParams {
    mode: EmptySpaceMode
    /**
     * Texture value to transfer function coordinate: `t * valueMap[0] + valueMap[1]`, as in the material.
     */
    valueMap: [number, number]
    /**
     * The iso value on the transfer function coordinate, for `iso`.
     */
    iso: number
    /**
     * The baked transfer function (RGBA bytes); its opacity decides `transfer` occupancy.
     */
    transferTexture: DataTexture
}

const occupancyKernel = `
uniform sampler3D uMinMax;
uniform sampler2D uTfCount;   // number of transfer function texels with opacity > 0, up to and including each texel
uniform vec2 uValueMap;
uniform float uIso;
uniform int uMode;            // 0 transfer, 1 iso
uniform int uOpenEnds;        // 1: 0 and 1 also stand for values below and above (see MinMaxBlocks)
vec4 kernel(ivec3 b) {
    vec2 mm = texelFetch(uMinMax, b, 0).rg;
    float t0 = uOpenEnds == 1 && mm.x <= 0.0 ? -1e6 : mm.x;
    float t1 = uOpenEnds == 1 && mm.y >= 1.0 ? 1e6 : mm.y;
    float v0 = t0 * uValueMap.x + uValueMap.y;
    float v1 = t1 * uValueMap.x + uValueMap.y;
    float lo = min(v0, v1);
    float hi = max(v0, v1);
    bool occupied;
    if (uMode == 1) {
        occupied = lo <= uIso && uIso <= hi;
    } else {
        // the texels a linear lookup between clamp(lo) and clamp(hi) can touch
        int w = textureSize(uTfCount, 0).x;
        float fw = float(w);
        int i0 = clamp(int(floor(clamp(lo, 0.0, 1.0) * fw - 0.5)), 0, w - 1);
        int i1 = clamp(int(floor(clamp(hi, 0.0, 1.0) * fw - 0.5)) + 1, 0, w - 1);
        float c1 = texelFetch(uTfCount, ivec2(i1, 0), 0).r;
        float c0 = i0 > 0 ? texelFetch(uTfCount, ivec2(i0 - 1, 0), 0).r : 0.0;
        occupied = c1 - c0 > 0.5;
    }
    return vec4(occupied ? 0.0 : 1.0); // 1: empty
}
`

// separable Chebyshev (L-infinity) distance transform, after the per-axis passes of Deakin and Knackstedt 2019,
// "Accelerated volume rendering with Chebyshev distance maps". Distances in blocks, up to 255.
const distanceKernel = `
uniform sampler3D uInput;
uniform ivec3 uAxis;
uniform int uFirst;           // 1: the input is the occupancy (1 empty, 0 occupied); else distances / 255
vec4 kernel(ivec3 b) {
    ivec3 size = textureSize(uInput, 0);
    int n = uAxis.x == 1 ? size.x : uAxis.y == 1 ? size.y : size.z;
    int p = uAxis.x == 1 ? b.x : uAxis.y == 1 ? b.y : b.z;
    float d = 255.0;
    for (int i = 0; i < n; i++) {
        ivec3 q = b + uAxis * (i - p);
        float v = texelFetch(uInput, q, 0).r;
        float dq = uFirst == 1 ? (v > 0.5 ? 255.0 : 0.0) : floor(v * 255.0 + 0.5);
        d = min(d, max(float(abs(i - p)), dq));
    }
    return vec4(d / 255.0);
}
`

/**
 * For each block of a field ({@link MinMaxBlocks}), the Chebyshev distance in blocks to the nearest block that can
 * add to the image (R8, 0 for those blocks, up to 255). A ray in a block at distance `d` can jump over the cube of
 * `2d - 1` blocks around it, which has nothing to show.
 *
 * Which blocks are empty depends on the transfer function and the range of the material (or the iso value), so
 * the material rebuilds it when they change ({@link setParams}); it is small (one texel per block) and quick to
 * build.
 *
 * Deakin and Knackstedt, "Accelerated volume rendering with Chebyshev distance maps", SIGGRAPH Asia 2019.
 *
 * @category Derived Fields
 */
export class EmptySpaceMap extends DerivedField {
    readonly isEmptySpaceMap = true
    name = 'emptyspace'

    private _a?: WebGL3DRenderTarget
    private _b?: WebGL3DRenderTarget
    private _occupancy?: VolumeKernel
    private _distance?: VolumeKernel
    private _tfCount?: DataTexture
    private _tfVersion = -1
    private _params?: EmptySpaceParams
    private _key = ''
    private _minMaxVersion = -1

    constructor(readonly minMax: MinMaxBlocks) {
        super()
    }

    get size(): [number, number, number] {
        return this.minMax.size
    }

    get blockSize() {
        return this.minMax.blockSize
    }

    /**
     * The distance map (valid when {@link ready}).
     */
    get texture(): Data3DTexture | undefined {
        return this._b?.texture
    }

    get gpuBytes() {
        const [x, y, z] = this.size
        return (this._a ? x * y * z : 0) + (this._b ? x * y * z : 0) + (this._tfCount ? this._tfCount.image.width * 4 : 0)
    }

    /**
     * Sets what counts as empty. The map is built again when the parameters, the transfer function or the field
     * change.
     */
    setParams(params: EmptySpaceParams) {
        const tex = params.transferTexture
        const key = [params.mode, this.minMax.openEnds, params.valueMap[0], params.valueMap[1], params.mode === 'iso' ? params.iso : '', tex.uuid, tex.version].join(',')
        this._params = params
        if (key !== this._key) {
            this._key = key
            this.invalidate()
        }
    }

    protected _canBuild(): boolean {
        if (this._built && this.minMax.version !== this._minMaxVersion) this.invalidate()
        return !!this._params && this.minMax.ready
    }

    /**
     * Whether the map is up to date for the current field, transfer function and parameters.
     */
    get ready(): boolean {
        return super.ready && this.minMax.ready && this.minMax.version === this._minMaxVersion
    }

    private _updateTfCount(tex: DataTexture) {
        if (this._tfCount && this._tfVersion === tex.version && this._tfCount.image.width === tex.image.width) return
        const data = tex.image.data as Uint8Array
        const w = tex.image.width
        if (!this._tfCount || this._tfCount.image.width !== w) {
            this._tfCount?.dispose()
            this._tfCount = new DataTexture(new Float32Array(w), w, 1, RedFormat, FloatType)
            this._tfCount.minFilter = this._tfCount.magFilter = NearestFilter
            this._tfCount.generateMipmaps = false
        }
        const out = this._tfCount.image.data as unknown as Float32Array
        let count = 0
        for (let i = 0; i < w; i++) {
            if (data[i * 4 + 3] > 0) count++
            out[i] = count
        }
        this._tfCount.needsUpdate = true
        this._tfVersion = tex.version
    }

    protected _createPasses(): DerivedFieldPass[] {
        const size = this.size
        const opts = {format: RedFormat, type: UnsignedByteType} as const
        this._a = this._makeTarget(this._a, size, {...opts, name: 'emptyspace-a'})
        this._b = this._makeTarget(this._b, size, {...opts, name: 'emptyspace'})
        this._minMaxVersion = this.minMax.version
        if (!this._occupancy) this._occupancy = new VolumeKernel({
            name: 'VolumeOccupancy',
            fragment: occupancyKernel,
            uniforms: {uMinMax: {value: null}, uTfCount: {value: null}, uValueMap: {value: [1, 0]}, uIso: {value: 0.5}, uMode: {value: 0}, uOpenEnds: {value: 0}},
        })
        if (!this._distance) this._distance = new VolumeKernel({
            name: 'VolumeChebyshevDistance',
            fragment: distanceKernel,
            uniforms: {uInput: {value: null}, uAxis: {value: [1, 0, 0]}, uFirst: {value: 1}},
        })
        const occ = this._occupancy
        const dist = this._distance
        const a = this._a
        const b = this._b
        const axis = (input: WebGL3DRenderTarget, ax: number[], first: number) => () => {
            dist.uniforms.uInput.value = input.texture
            dist.uniforms.uAxis.value = ax
            dist.uniforms.uFirst.value = first
        }
        return [{
            kernel: occ, target: a, cost: 3,
            before: () => {
                const p = this._params!
                if (p.mode === 'transfer') this._updateTfCount(p.transferTexture)
                occ.uniforms.uMinMax.value = this.minMax.texture
                occ.uniforms.uTfCount.value = this._tfCount ?? dummyTexture()
                occ.uniforms.uValueMap.value = p.valueMap
                occ.uniforms.uIso.value = p.iso
                occ.uniforms.uMode.value = p.mode === 'iso' ? 1 : 0
                occ.uniforms.uOpenEnds.value = this.minMax.openEnds ? 1 : 0
            },
        },
        {kernel: dist, target: b, cost: size[0], before: axis(a, [1, 0, 0], 1)},
        {kernel: dist, target: a, cost: size[1], before: axis(b, [0, 1, 0], 0)},
        {kernel: dist, target: b, cost: size[2], before: axis(a, [0, 0, 1], 0)},
        ]
    }

    dispose() {
        this._a?.dispose()
        this._b?.dispose()
        this._a = this._b = undefined
        this._occupancy?.dispose()
        this._distance?.dispose()
        this._occupancy = this._distance = undefined
        this._tfCount?.dispose()
        this._tfCount = undefined
        super.dispose()
    }
}

let _dummy: Texture | undefined
function dummyTexture() {
    if (!_dummy) {
        const t = new DataTexture(new Float32Array(1), 1, 1, RedFormat, FloatType)
        t.needsUpdate = true
        _dummy = t
    }
    return _dummy
}
