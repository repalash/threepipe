import {
    ClampToEdgeWrapping,
    Data3DTexture,
    DataUtils,
    EventDispatcher,
    FloatType,
    HalfFloatType,
    LinearFilter,
    NearestFilter,
    RedFormat,
    TypedArray,
    UnsignedByteType,
    Vector3,
} from 'threepipe'
import {Volume} from 'three/examples/jsm/misc/Volume.js'

/**
 * How the values of a {@link VolumeData} are stored on the GPU.
 * - `auto`: `r8` for 8-bit unsigned data, `r16f` for everything else.
 * - `r8`: 1 byte per voxel. Other types are scaled to 0..255 over their value range.
 * - `r16f`: half float, 2 bytes per voxel, linear filtering on every WebGL2 device. Values are stored normalized to
 *   0..1 over the value range, so precision is about 1/2048 of the range.
 * - `r32f`: float, 4 bytes per voxel, exact. Linear filtering needs `OES_texture_float_linear`, which many phones
 *   do not have; the texture then falls back to nearest filtering.
 */
export type VolumeGpuFormat = 'auto' | 'r8' | 'r16f' | 'r32f'

export interface VolumeDataOptions {
    /**
     * The values, x fastest, then y, then z (the order of NRRD, NIfTI and three.js `Volume`).
     */
    data: TypedArray
    /**
     * Voxel counts along x, y, z.
     */
    size: [number, number, number] | Vector3
    /**
     * Distance between voxel centres along x, y, z, in {@link VolumeData.units}. Default 1, 1, 1.
     */
    spacing?: [number, number, number] | Vector3
    /**
     * Unit of the spacing, as in NRRD `space units`. Default `mm` for scans; any string is kept as it is.
     */
    units?: string
    /**
     * Name of the field, as a USD volume field name (`density`, `temperature`, `intensity`, ...). Default `density`.
     */
    name?: string
    /**
     * The value range to use, in data units. Default: the min and max of the data.
     */
    valueRange?: [number, number]
    gpuFormat?: VolumeGpuFormat
}

export interface VolumeDataEventMap {
    update: object
    dispose: object
}

/**
 * One scalar field on a regular grid: the values, their size, spacing and value range, and the 3D texture that holds
 * them on the GPU.
 *
 * It extends three.js `Volume` (`three/examples/jsm/misc/Volume.js`), so the `NRRDLoader` result, `VolumeSlice` and
 * code written for three.js volumes work with it, and a plain `Volume` can be wrapped with {@link VolumeData.fromVolume}.
 *
 * The field follows the USD volume field model: a name ({@link name}), the file it came from
 * ({@link filePath}, {@link fieldName}, {@link fieldIndex}) and its data type ({@link fieldDataType}).
 */
export class VolumeData extends Volume {
    readonly isVolumeData = true

    readonly events = new EventDispatcher<VolumeDataEventMap>()

    /**
     * Field name in the volume, as a USD `field:<name>` relationship: `density`, `temperature`, `intensity`, ...
     */
    name = 'density'

    /**
     * USD `VolumeFieldAsset.filePath`: the file the field was loaded from, if any. A saved scene keeps only this link,
     * not the voxels.
     */
    filePath = ''

    /**
     * USD `VolumeFieldAsset.fieldName`: the name of the grid in the file, for files with several grids.
     */
    fieldName = ''

    /**
     * USD `VolumeFieldAsset.fieldIndex`: the index of the grid in the file, for files with several grids.
     */
    fieldIndex = 0

    /**
     * Unit of {@link spacing}.
     */
    units = 'mm'

    /**
     * The value range in data units: the default range of the materials that show this field, and the range
     * normalized values are stored over on the GPU.
     */
    valueRange: [number, number] = [0, 1]

    gpuFormat: VolumeGpuFormat = 'auto'

    private _texture?: Data3DTexture
    /**
     * Value range the texture values span: a texture value t in 0..1 is the data value
     * `textureRange[0] + t * (textureRange[1] - textureRange[0])`.
     */
    private _textureRange: [number, number] = [0, 1]

    constructor(options?: VolumeDataOptions) {
        super()
        if (options) this.setData(options)
    }

    /**
     * Wrap a three.js `Volume` (for example the result of `NRRDLoader`), keeping its data, size, spacing, matrix,
     * header and thresholds. The data array is shared, not copied.
     */
    static fromVolume(volume: Volume, options: Partial<Omit<VolumeDataOptions, 'data' | 'size'>> = {}): VolumeData {
        const v = volume as Volume & {header?: any, dimensions?: number[], windowLow?: number, windowHigh?: number, RASDimensions?: number[], inverseMatrix?: any}
        const res = new VolumeData()
        Object.assign(res, {
            header: v.header,
            matrix: v.matrix,
            inverseMatrix: v.inverseMatrix,
            axisOrder: v.axisOrder,
            offset: v.offset,
            RASDimensions: v.RASDimensions,
        })
        const units = options.units ?? parseNrrdUnits(v.header?.['space units'])
        res.setData({
            data: v.data,
            size: [v.xLength, v.yLength, v.zLength],
            spacing: (options.spacing ?? v.spacing) as [number, number, number],
            units,
            name: options.name,
            valueRange: options.valueRange ?? (v.windowLow !== undefined && v.windowHigh !== undefined && isFinite(v.windowLow) && isFinite(v.windowHigh) ? [v.windowLow, v.windowHigh] : undefined),
            gpuFormat: options.gpuFormat,
        })
        return res
    }

    /**
     * Same as `new VolumeData(options)`.
     */
    static from(options: VolumeDataOptions): VolumeData {
        return new VolumeData(options)
    }

    /**
     * Replace the values. The GPU texture is rebuilt on its next use.
     */
    setData(options: VolumeDataOptions) {
        const size = Array.isArray(options.size) ? options.size : options.size.toArray()
        const [nx, ny, nz] = size.map(s => Math.max(1, Math.floor(s)))
        if (options.data.length < nx * ny * nz) throw new Error(`VolumeData: data has ${options.data.length} values, size ${nx}x${ny}x${nz} needs ${nx * ny * nz}`)
        this.data = options.data
        this.xLength = nx
        this.yLength = ny
        this.zLength = nz
        const spacing = options.spacing ? Array.isArray(options.spacing) ? options.spacing : options.spacing.toArray() : this.spacing ?? [1, 1, 1]
        this.spacing = spacing.map(s => isFinite(s) && s > 0 ? s : 1)
        if (options.units) this.units = options.units
        if (options.name) this.name = options.name
        if (options.gpuFormat) this.gpuFormat = options.gpuFormat
        if (!this.axisOrder) this.axisOrder = ['x', 'y', 'z']
        if (!this.offset) this.offset = [0, 0, 0]
        if (options.valueRange) this.valueRange = [options.valueRange[0], options.valueRange[1]]
        else {
            const [min, max] = this.computeMinMax()
            this.valueRange = [min, max]
        }
        this.setDirty()
    }

    get size(): [number, number, number] {
        return [this.xLength, this.yLength, this.zLength]
    }

    /**
     * Size of the whole grid in {@link units}: voxel count times spacing along each axis.
     */
    get physicalSize(): [number, number, number] {
        return [this.xLength * this.spacing[0], this.yLength * this.spacing[1], this.zLength * this.spacing[2]]
    }

    /**
     * USD `fieldDataType` of the values: `uchar`, `short`, `float`, ...
     */
    get fieldDataType(): string {
        const d = this.data as TypedArray
        if (d instanceof Uint8Array || d instanceof Uint8ClampedArray) return 'uchar'
        if (d instanceof Int8Array) return 'char'
        if (d instanceof Int16Array) return 'short'
        if (d instanceof Uint16Array) return 'ushort'
        if (d instanceof Int32Array) return 'int'
        if (d instanceof Uint32Array) return 'uint'
        if (d instanceof Float64Array) return 'double'
        return 'float'
    }

    /**
     * The GPU format used for the texture, after resolving `auto`.
     */
    get resolvedGpuFormat(): Exclude<VolumeGpuFormat, 'auto'> {
        if (this.gpuFormat !== 'auto') return this.gpuFormat
        return this.data instanceof Uint8Array || this.data instanceof Uint8ClampedArray ? 'r8' : 'r16f'
    }

    /**
     * See {@link _textureRange}.
     */
    get textureRange(): [number, number] {
        this.texture // makes sure the range is computed
        return this._textureRange
    }

    /**
     * The 3D texture with the values, built on first use. One channel, linear filtering (nearest for `r32f` without
     * float linear filtering is chosen by three.js).
     */
    get texture(): Data3DTexture {
        if (!this._texture) this._texture = this._createTexture()
        return this._texture
    }

    /**
     * Bytes the texture takes on the GPU (without driver overhead).
     */
    get gpuBytes(): number {
        const n = this.xLength * this.yLength * this.zLength
        const f = this.resolvedGpuFormat
        return n * (f === 'r8' ? 1 : f === 'r16f' ? 2 : 4)
    }

    private _createTexture(): Data3DTexture {
        const n = this.xLength * this.yLength * this.zLength
        const src = this.data as TypedArray
        const format = this.resolvedGpuFormat
        const isU8 = src instanceof Uint8Array || src instanceof Uint8ClampedArray
        let data: TypedArray
        let type: typeof UnsignedByteType | typeof HalfFloatType | typeof FloatType
        if (format === 'r8' && isU8) {
            data = src.length === n ? src : src.subarray(0, n)
            type = UnsignedByteType
            this._textureRange = [0, 255]
        } else {
            const [lo, hi] = this.valueRange
            const scale = hi > lo ? 1 / (hi - lo) : 0
            this._textureRange = [lo, hi > lo ? hi : lo + 1]
            if (format === 'r8') {
                const out = new Uint8Array(n)
                for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((src[i] - lo) * scale * 255)))
                data = out
                type = UnsignedByteType
            } else if (format === 'r16f') {
                const out = new Uint16Array(n)
                for (let i = 0; i < n; i++) out[i] = DataUtils.toHalfFloat(Math.max(0, Math.min(1, (src[i] - lo) * scale)))
                data = out
                type = HalfFloatType
            } else {
                const out = new Float32Array(n)
                for (let i = 0; i < n; i++) out[i] = (src[i] - lo) * scale
                data = out
                type = FloatType
            }
        }
        const tex = new Data3DTexture(data as any, this.xLength, this.yLength, this.zLength)
        tex.format = RedFormat
        tex.type = type
        tex.minFilter = LinearFilter
        tex.magFilter = LinearFilter
        tex.wrapS = ClampToEdgeWrapping
        tex.wrapT = ClampToEdgeWrapping
        tex.wrapR = ClampToEdgeWrapping
        tex.unpackAlignment = 1
        tex.generateMipmaps = false
        tex.name = this.name
        tex.needsUpdate = true
        return tex
    }

    /**
     * Nearest or linear sampling of the texture.
     */
    set interpolate(v: boolean) {
        const t = this.texture
        const f = v ? LinearFilter : NearestFilter
        if (t.minFilter !== f) {
            t.minFilter = f
            t.magFilter = f
            t.needsUpdate = true
        }
    }
    get interpolate() {
        return this.texture.magFilter === LinearFilter
    }

    /**
     * Call after changing {@link data} or {@link valueRange} in place: the texture is rebuilt on its next use.
     */
    setDirty() {
        this._texture?.dispose()
        this._texture = undefined
        this.events.dispatchEvent({type: 'update'})
    }

    /**
     * Free the GPU texture. The data stays, and the texture is created again on next use.
     */
    disposeTexture() {
        this._texture?.dispose()
        this._texture = undefined
    }

    dispose() {
        this.disposeTexture()
        this.events.dispatchEvent({type: 'dispose'})
    }
}

/**
 * The first unit of an NRRD `space units` field. three.js `NRRDLoader` keeps the field as the raw string
 * (`"mm" "mm" "mm"`); an array is accepted too.
 */
function parseNrrdUnits(value: unknown): string | undefined {
    if (Array.isArray(value)) value = value[0]
    if (typeof value !== 'string') return undefined
    const quoted = value.match(/"([^"]*)"/)
    const unit = (quoted ? quoted[1] : value.trim().split(/\s+/)[0]) || ''
    return unit || undefined
}
