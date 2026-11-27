import {
    ClampToEdgeWrapping,
    DataTexture,
    EventDispatcher,
    LinearFilter,
    LinearSRGBColorSpace,
    RGBAFormat,
    serializable,
    serialize,
    UnsignedByteType,
} from 'threepipe'

/**
 * A transfer function preset as a list of points. The format follows the VolView and 3D Slicer presets:
 * `colors` are `[x, r, g, b]` and `opacities` are `[x, a]`, with `r, g, b, a` in 0..1.
 *
 * When `absolute` is true, `x` is in data units (Hounsfield units for CT), and applying the preset also sets the
 * value range of the material to the range of the points. When false, `x` is relative: the first and last points
 * stretch over the value range of the material.
 */
export interface TransferFunctionPreset {
    name: string
    absolute: boolean
    colors: number[][]
    opacities: number[][]
    /**
     * The range where the preset changes, in the same units as `x`. Informational, from the VolView presets.
     */
    effectiveRange?: number[]
}

export interface TransferFunctionEventMap {
    update: object
}

/**
 * Maps a normalized value (0..1) to a colour and an opacity, by linear interpolation between control points.
 *
 * The points are in 0..1: 0 is the low end of the value range of the material that uses it, 1 the high end. The
 * function is baked into a 1D lookup texture ({@link texture}) when a point changes. Opacity is per voxel: a sample
 * of opacity `a` over one voxel of distance. The material corrects it for its step length.
 */
@serializable('TransferFunction')
export class TransferFunction extends EventDispatcher<TransferFunctionEventMap> {
    readonly isTransferFunction = true

    /**
     * Colour points `[x, r, g, b]`, x in 0..1, sorted by x.
     */
    @serialize() colorPoints: number[][] = [[0, 0, 0, 0], [1, 1, 1, 1]]

    /**
     * Opacity points `[x, a]`, x in 0..1, sorted by x.
     */
    @serialize() opacityPoints: number[][] = [[0, 0], [1, 1]]

    /**
     * Name of the preset the points came from, if any. Informational.
     */
    @serialize() name = ''

    /**
     * Width of the lookup texture. Absolute CT presets span about 6000 HU, and some have steps of 7 HU, so the
     * default is 2048 texels.
     */
    static TextureWidth = 2048

    private _texture?: DataTexture
    private _needsBake = true

    constructor(colorPoints?: number[][], opacityPoints?: number[][]) {
        super()
        if (colorPoints) this.colorPoints = colorPoints
        if (opacityPoints) this.opacityPoints = opacityPoints
    }

    /**
     * The lookup texture: RGBA, 8 bits per channel, {@link TransferFunction.TextureWidth} texels wide, linear filtering.
     * Colours are stored as given (linear values, no colour space conversion).
     */
    get texture(): DataTexture {
        if (!this._texture) {
            const w = TransferFunction.TextureWidth
            const tex = new DataTexture(new Uint8Array(w * 4), w, 1, RGBAFormat, UnsignedByteType)
            tex.minFilter = LinearFilter
            tex.magFilter = LinearFilter
            tex.wrapS = ClampToEdgeWrapping
            tex.wrapT = ClampToEdgeWrapping
            tex.generateMipmaps = false
            tex.colorSpace = LinearSRGBColorSpace
            tex.name = 'TransferFunction'
            this._texture = tex
            this._needsBake = true
        }
        if (this._needsBake) {
            this.bake(this._texture.image.data as Uint8Array)
            this._texture.needsUpdate = true
            this._needsBake = false
        }
        return this._texture
    }

    /**
     * Writes the function into an RGBA array of `n` texels (`data.length / 4`).
     * Values outside the first and last point take the value of that point.
     */
    bake(data: Uint8Array) {
        const n = data.length / 4
        const colors = sortPoints(this.colorPoints)
        const opacities = sortPoints(this.opacityPoints)
        for (let i = 0; i < n; i++) {
            const x = n > 1 ? i / (n - 1) : 0
            data[i * 4] = toByte(interpolate(colors, x, 1))
            data[i * 4 + 1] = toByte(interpolate(colors, x, 2))
            data[i * 4 + 2] = toByte(interpolate(colors, x, 3))
            data[i * 4 + 3] = toByte(interpolate(opacities, x, 1))
        }
    }

    /**
     * The colour (r, g, b) and opacity at a normalized value, without the texture.
     */
    evaluate(x: number): [number, number, number, number] {
        const colors = sortPoints(this.colorPoints)
        const opacities = sortPoints(this.opacityPoints)
        return [interpolate(colors, x, 1), interpolate(colors, x, 2), interpolate(colors, x, 3), interpolate(opacities, x, 1)]
    }

    /**
     * Set the points from a preset.
     * @returns the value range the preset is defined over, in data units, for an absolute preset; undefined for a
     * relative one.
     */
    setPreset(preset: TransferFunctionPreset): [number, number] | undefined {
        const xs = [...preset.colors.map(c => c[0]), ...preset.opacities.map(o => o[0])]
        const lo = Math.min(...xs)
        const hi = Math.max(...xs)
        const span = hi - lo || 1
        this.colorPoints = preset.colors.map(c => [(c[0] - lo) / span, c[1], c[2], c[3]])
        this.opacityPoints = preset.opacities.map(o => [(o[0] - lo) / span, o[1]])
        this.name = preset.name
        this.setDirty()
        return preset.absolute ? [lo, hi] : undefined
    }

    /**
     * Call after changing {@link colorPoints} or {@link opacityPoints} in place.
     */
    setDirty() {
        this._needsBake = true
        if (this._texture) {
            // re-bake now so the texture is up to date before the next render
            this.bake(this._texture.image.data as Uint8Array)
            this._texture.needsUpdate = true
            this._needsBake = false
        }
        this.dispatchEvent({type: 'update'})
    }

    copy(other: TransferFunction): this {
        this.colorPoints = other.colorPoints.map(p => [...p])
        this.opacityPoints = other.opacityPoints.map(p => [...p])
        this.name = other.name
        this.setDirty()
        return this
    }

    clone(): TransferFunction {
        return new TransferFunction().copy(this)
    }

    dispose() {
        this._texture?.dispose()
        this._texture = undefined
        this._needsBake = true
    }
}

function sortPoints(points: number[][]) {
    return [...points].sort((a, b) => a[0] - b[0])
}

/**
 * Linear interpolation of channel `c` of sorted points at `x`; clamped to the first and last point.
 */
function interpolate(points: number[][], x: number, c: number): number {
    if (points.length === 0) return 0
    if (x <= points[0][0]) return points[0][c]
    const last = points[points.length - 1]
    if (x >= last[0]) return last[c]
    for (let i = 1; i < points.length; i++) {
        const b = points[i]
        if (x <= b[0]) {
            const a = points[i - 1]
            const d = b[0] - a[0]
            const t = d > 0 ? (x - a[0]) / d : 1
            return a[c] + (b[c] - a[c]) * t
        }
    }
    return last[c]
}

function toByte(v: number) {
    return Math.max(0, Math.min(255, Math.round(v * 255)))
}
