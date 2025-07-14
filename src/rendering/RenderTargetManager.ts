import {Class} from 'ts-browser-helpers'
import {createRenderTargetKey, CreateRenderTargetOptions, IRenderTarget} from './RenderTarget'
import {
    ClampToEdgeWrapping,
    DepthFormat,
    DepthTexture,
    EventDispatcher,
    LinearFilter,
    LinearMipMapLinearFilter,
    NoColorSpace,
    RGBAFormat,
    Texture,
    UnsignedByteType,
    UnsignedIntType,
    Vector2,
    WebGLCubeRenderTarget,
    WebGLMultipleRenderTargets,
    WebGLRenderTarget,
    WebGLRenderTargetOptions,
} from 'three'

export abstract class RenderTargetManager<TE extends object = object> extends EventDispatcher<TE> {
    abstract isWebGL2: boolean
    abstract readonly renderSize: Vector2
    abstract renderScale: number

    private _trackedTargets: IRenderTarget[] = []
    private _trackedTempTargets: IRenderTarget[] = []
    private _releasedTempTargets: Record<string, IRenderTarget[]> = {}

    readonly maxTempPerKey = 5

    protected constructor() {
        super()
        this._processNewTarget = this._processNewTarget.bind(this)
        this._processNewTempTarget = this._processNewTempTarget.bind(this)
        this.trackTarget = this.trackTarget.bind(this)
        this.disposeTarget = this.disposeTarget.bind(this)
        this.createTarget = this.createTarget.bind(this)
        this.createTargetCustom = this.createTargetCustom.bind(this)

    }

    trackTarget(target: IRenderTarget) {
        this._trackedTargets.push(target)
    }

    removeTrackedTarget(target: IRenderTarget) {
        const ind = this._trackedTargets.indexOf(target)
        if (ind >= 0)
            this._trackedTargets.splice(ind, 1)
    }

    createTarget<T extends IRenderTarget = IRenderTarget>({
        sizeMultiplier = undefined,
        samples = 0,
        colorSpace = NoColorSpace,
        type = UnsignedByteType,
        format = RGBAFormat,
        stencilBuffer = false,
        depthBuffer = true,
        depthTexture = false,
        depthTextureType = UnsignedIntType,
        depthTextureFormat = DepthFormat,
        size = undefined,
        textureCount = 1,
        ...op
    }: CreateRenderTargetOptions = {}, trackTarget = true): T {
        if (!this.isWebGL2) samples = 0
        if (sizeMultiplier !== undefined && size !== undefined)
            console.error('Both sizeMultiplier and size are defined. sizeMultiplier will be ignored.')
        size = size || this.renderSize.clone().multiplyScalar(this.renderScale * (sizeMultiplier = sizeMultiplier || 1))
        size.width = Math.floor(size.width)
        size.height = Math.floor(size.height)
        const depthTex = depthTexture ? new DepthTexture(size.width, size.height, depthTextureType) : null
        if (depthTex) depthTex.format = depthTextureFormat
        const target = this.createTargetCustom<T>(textureCount > 1 ? {
            width: size.width,
            height: size.height,
            count: textureCount,
        } : size,
        {samples, colorSpace, type, format, depthBuffer, depthTexture: depthTex, stencilBuffer},
        textureCount > 1 ? WebGLMultipleRenderTargets as any : WebGLRenderTarget)
        this._processNewTarget(target, sizeMultiplier, trackTarget)
        this._setTargetOptions(target, op)
        return target
    }

    /**
     * Dispose and remove tracked target. Release target in-case of temporary target.
     * To just dispose from the GPU memory and keep reference, call `target.dispose()` or `target.dispose(false)`
     * @param target
     * @param remove
     */
    disposeTarget(target: IRenderTarget, remove = true): void {
        if (!target) return
        if (target.isTemporary) return this.releaseTempTarget(target)
        if (remove) this.removeTrackedTarget(target)
        // @ts-expect-error internal, not in types
        target.dispose(false) // false is not required but still passing so that it doesnt cause infinite loop in future.
    }

    getTempTarget<T extends IRenderTarget = IRenderTarget>(op: CreateRenderTargetOptions = {}): T {
        const key = createRenderTargetKey(op)
        let target: T | undefined
        if (this._releasedTempTargets[key]?.length) target = this._releasedTempTargets[key].pop() as T
        if (!target) {
            target = this.createTarget<T>(op)
            this._processNewTempTarget(target, key)
        } else {
            this._setTargetOptions(target, op)
        }
        return target
    }

    releaseTempTarget(target: IRenderTarget): void {
        const key = target.targetKey
        if (!key || !target.isTemporary) {
            throw 'Not a temp target'
        }
        if (this._releasedTempTargets[key].length > this.maxTempPerKey) {
            this.removeTrackedTarget(target)
            target.dispose()
        } else this._releasedTempTargets[key].push(target)
    }


    createTargetCustom<T extends IRenderTarget>({
        width,
        height,
        count,
    }: {width: number, height: number, count?: number}, options: WebGLRenderTargetOptions = {}, clazz?: Class<T>): T {
        let size = [width, height]
        if (count && count > 1) size.push(count)

        if (clazz?.prototype === WebGLCubeRenderTarget.prototype) { // todo: check for subclass also of WebGLCubeRenderTarget
            if (width !== height) throw 'Width and height of cube render target must be equal'
            size = [width]
        }
        return this._createTargetClass((clazz as any) ?? WebGLRenderTarget, size, {
            format: RGBAFormat,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            generateMipmaps: false,
            type: UnsignedByteType,
            colorSpace: NoColorSpace,
            ...options,
        }) as T
    }

    protected abstract _createTargetClass(clazz: Class<WebGLRenderTarget>, size: number[], options: WebGLRenderTargetOptions): IRenderTarget

    dispose(clear = true) {
        this._trackedTargets.forEach(t=>t.dispose())
        Object.values(this._trackedTempTargets).forEach(t=>t.dispose())
        if (clear) {
            this._trackedTargets = []
            this._releasedTempTargets = {}
            this._trackedTempTargets = []
        }
    }

    /**
     * Resizes all tracked targets with a sizeMultiplier based on the current renderSize and renderScale.
     * This must be automatically called by the renderer on resize, and manually when sizeMultiplier of a target changes.
     */
    resizeTrackedTargets() {
        for (const v of this._trackedTargets) this.resizeTrackedTarget(v)
    }
    resizeTrackedTarget(target: IRenderTarget): void {
        const multiplier = target.sizeMultiplier
        if (multiplier) {
            const s = this.renderSize.clone().multiplyScalar(this.renderScale * multiplier)
            target.setSize(Math.floor(s.width), Math.floor(s.height))
        }
    }

    private _processNewTempTarget(target: IRenderTarget, key: string): IRenderTarget {
        target.isTemporary = true
        target.targetKey = key
        if (this._releasedTempTargets[key] === undefined) this._releasedTempTargets[key] = []
        this._trackedTempTargets.push(target)
        return target
    }

    private _setTargetOptions(target: IRenderTarget, op: CreateRenderTargetOptions) {
        const tex = target.texture
        for (const t of Array.isArray(tex) ? tex : [tex])
            this._setTargetTextureOptions(t, op)
    }

    private _setTargetTextureOptions(texture: Texture, op: CreateRenderTargetOptions) {
        texture.minFilter = op.minFilter ?? LinearFilter
        texture.magFilter = op.magFilter ?? LinearFilter
        texture.wrapS = op.wrapS ?? ClampToEdgeWrapping
        texture.wrapT = op.wrapT ?? ClampToEdgeWrapping
        texture.generateMipmaps = op.generateMipmaps ?? false
        if (texture.generateMipmaps && texture.minFilter === LinearFilter)
            texture.minFilter = LinearMipMapLinearFilter
        if (!texture.generateMipmaps && texture.minFilter === LinearMipMapLinearFilter)
            texture.minFilter = LinearFilter
    }

    protected _processNewTarget(target: IRenderTarget, sizeMultiplier: number | undefined, trackTarget: boolean): IRenderTarget {
        if (sizeMultiplier !== undefined) target.sizeMultiplier = sizeMultiplier
        if (trackTarget) this.trackTarget(target)
        return target
    }

}
