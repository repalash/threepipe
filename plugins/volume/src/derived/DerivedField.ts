import {
    ClampToEdgeWrapping,
    Data3DTexture,
    EventDispatcher,
    LinearFilter,
    NearestFilter,
    PixelFormat,
    TextureDataType,
    WebGL3DRenderTarget,
    WebGLRenderer,
} from 'threepipe'
import type {VolumeKernel} from './VolumeKernel'

export interface DerivedFieldEventMap {
    /**
     * The field finished building.
     */
    update: object
    dispose: object
}

/**
 * One kernel run over a whole render target, a step of building a {@link DerivedField}.
 */
export interface DerivedFieldPass {
    kernel: VolumeKernel
    target: WebGL3DRenderTarget
    /**
     * Texture reads per output voxel, to spread the work over frames ({@link DerivedField.update}).
     */
    cost: number
    /**
     * Sets the inputs of the kernel before it runs.
     */
    before?: () => void
}

export interface DerivedTargetOptions {
    format: PixelFormat
    type: TextureDataType
    linear?: boolean
    name?: string
}

/**
 * A field computed on the GPU from other fields: a gradient, the per-block value ranges, the empty space distance
 * map, or a field from a user kernel. It is built by one or more {@link VolumeKernel} passes into 3D render targets,
 * a few layers per frame within a budget, and kept until its inputs change ({@link invalidate}).
 *
 * The result is {@link texture}, valid once {@link ready} is true.
 *
 * @category Derived Fields
 */
export abstract class DerivedField {
    readonly isDerivedField = true
    readonly events = new EventDispatcher<DerivedFieldEventMap>()

    name = 'derived'

    /**
     * True when the last build finished and no input changed since.
     */
    get ready(): boolean {
        return this._built
    }

    /**
     * Increments each time a build finishes, so dependent fields know when to rebuild.
     */
    get version() {
        return this._version
    }

    /**
     * The last build finished and nothing called {@link invalidate} since.
     */
    protected _built = false
    private _version = 0
    private _pass = 0
    private _layer = 0
    private _passes?: DerivedFieldPass[]

    /**
     * Voxel counts of the result along x, y, z.
     */
    abstract get size(): [number, number, number]

    /**
     * The texture of the result, or undefined before the first build.
     */
    abstract get texture(): Data3DTexture | undefined

    /**
     * The passes that build the field, in order. Called at the start of each build; targets of the right size are
     * made with {@link _makeTarget}.
     */
    protected abstract _createPasses(renderer: WebGLRenderer): DerivedFieldPass[]

    /**
     * Whether the inputs are there to build. A field whose inputs are not ready waits.
     */
    protected _canBuild(): boolean {
        return true
    }

    /**
     * Mark the field as out of date: it is built again by the next {@link update} calls.
     */
    invalidate() {
        this._built = false
        this._pass = 0
        this._layer = 0
        this._passes = undefined
    }

    /**
     * Builds some more of the field. `budget` is the number of texture reads to spend (the {@link DerivedFieldPass.cost}
     * per voxel times the voxels of each layer); at least one layer is done per call so a build always moves on.
     *
     * Returns the reads spent; check {@link ready} for the end of the build.
     */
    update(renderer: WebGLRenderer, budget = Infinity): number {
        // _canBuild can invalidate a build whose inputs changed
        if (!this._canBuild() || this._built) return 0
        if (!this._passes) {
            this._passes = this._createPasses(renderer)
            this._pass = 0
            this._layer = 0
        }
        let spent = 0
        while (this._pass < this._passes.length) {
            const pass = this._passes[this._pass]
            const t = pass.target
            const layerCost = Math.max(1, pass.cost * t.width * t.height)
            const layers = Math.max(1, Math.min(t.depth - this._layer, Math.floor((budget - spent) / layerCost)))
            if (spent > 0 && spent + layerCost > budget) break
            pass.before?.()
            pass.kernel.run(renderer, t, this._layer, this._layer + layers)
            spent += layers * layerCost
            this._layer += layers
            if (this._layer >= t.depth) {
                this._pass++
                this._layer = 0
            }
            if (spent >= budget) break
        }
        if (this._pass >= this._passes.length) {
            this._built = true
            this._version++
            this._passes = undefined
            this.events.dispatchEvent({type: 'update'})
        }
        return spent
    }

    /**
     * Bytes the textures of the field take on the GPU.
     */
    abstract get gpuBytes(): number

    /**
     * Makes or resizes a 3D render target for the field.
     */
    protected _makeTarget(existing: WebGL3DRenderTarget | undefined, size: [number, number, number], options: DerivedTargetOptions): WebGL3DRenderTarget {
        const [w, h, d] = size
        if (existing && existing.width === w && existing.height === h && existing.depth === d &&
            existing.texture.format === options.format && existing.texture.type === options.type) return existing
        existing?.dispose()
        const target = new WebGL3DRenderTarget(w, h, d, {depthBuffer: false})
        // three.js r168 WebGL3DRenderTarget replaces the texture made from the options, so set them on its texture
        const tex = target.texture
        tex.format = options.format
        tex.type = options.type
        tex.minFilter = tex.magFilter = options.linear ? LinearFilter : NearestFilter
        tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping
        tex.generateMipmaps = false
        tex.name = options.name ?? this.name
        return target
    }

    dispose() {
        this.invalidate()
        this.events.dispatchEvent({type: 'dispose'})
    }
}
