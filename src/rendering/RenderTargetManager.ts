import {Class} from 'ts-browser-helpers'
import {createRenderTargetKey, CreateRenderTargetOptions, IRenderTarget} from './RenderTarget'
import {
    BaseEvent,
    ClampToEdgeWrapping,
    DepthTexture,
    EventDispatcher,
    LinearFilter,
    LinearMipMapLinearFilter,
    NoColorSpace,
    RGBAFormat,
    Texture,
    UnsignedByteType,
    Vector2,
    WebGLCubeRenderTarget,
    WebGLMultipleRenderTargets,
    WebGLRenderTarget,
    WebGLRenderTargetOptions,
} from 'three'
import {generateUUID} from '../three'

export abstract class RenderTargetManager<E extends BaseEvent = BaseEvent, ET extends string = string> extends EventDispatcher<E, ET> {
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
        depthBuffer = true,
        depthTexture = false,
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
        const depthTex = depthTexture ? new DepthTexture(size.width, size.height, UnsignedByteType) : undefined
        const target = this.createTargetCustom<T>(textureCount > 1 ? {
            width: size.width,
            height: size.height,
            count: textureCount,
        } : size,
        {samples, colorSpace, type, format, depthBuffer, depthTexture: depthTex},
        textureCount > 1 ? WebGLMultipleRenderTargets as any : WebGLRenderTarget)
        this._processNewTarget(target, sizeMultiplier, trackTarget)
        this._setTargetOptions(target, op)
        return target
    }

    disposeTarget(target: IRenderTarget): void {
        if (!target) return
        if (target.isTemporary) return this.releaseTempTarget(target)
        this.removeTrackedTarget(target)
        target.dispose()
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
            target.dispose()
            this._trackedTempTargets.splice(this._trackedTempTargets.indexOf(target), 1)
        } else this._releasedTempTargets[key].push(target)
    }


    createTargetCustom<T extends IRenderTarget>({
        width,
        height,
        count,
    }: {width: number, height: number, count?: number}, options: WebGLRenderTargetOptions = {}, clazz?: Class<T>): T {
        const processNewTarget = this._processNewTarget
        let size = [width, height]
        if (count && count > 1) size.push(count)

        if (clazz?.prototype === WebGLCubeRenderTarget.prototype) { // todo: check for subclass also of WebGLCubeRenderTarget
            if (width !== height) throw 'Width and height of cube render target must be equal'
            size = [width]
        }
        const params = [...size, {
            format: RGBAFormat,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            generateMipmaps: false,
            type: UnsignedByteType,
            colorSpace: NoColorSpace,
            ...options,
        }]
        return new class RenderTarget extends ((clazz as any as Class<WebGLRenderTarget>) ?? WebGLRenderTarget) implements IRenderTarget {
            isTemporary?: boolean
            sizeMultiplier?: number
            uuid: string

            constructor(...ps: any[]) {
                super(...ps)
                this.uuid = generateUUID()
                const ops = ps[ps.length - 1] as WebGLRenderTargetOptions
                if (Array.isArray(this.texture)) {
                    this.texture.forEach(t => {
                        t.colorSpace = ops.colorSpace
                        t.toJSON = () => {
                            console.warn('Multiple render target texture.toJSON not supported yet.')
                            return {}
                        }
                    })
                } else {
                    this.texture.toJSON = () => ({ // todo use readRenderTargetPixels as data url or data buffer.
                        isRenderTargetTexture: true,
                    }) // so that it doesn't get serialized
                }
            }

            setSize(w: number, h: number, depth?: number) {
                super.setSize(Math.floor(w), Math.floor(h), depth)
                // console.log('setSize', w, h, depth)
                return this
            }

            clone(trackTarget = true): any {
                if (this.isTemporary) throw 'Cloning temporary render targets not supported'
                if (Array.isArray(this.texture)) throw 'Cloning multiple render targets not supported'
                // Note: todo: webgl render target.clone messes up the texture, by not copying isRenderTargetTexture prop and maybe some other stuff. So its better to just create a new one
                const cloned = super.clone() as IRenderTarget
                const tex = cloned.texture
                if (Array.isArray(tex)) tex.forEach(t => t.isRenderTargetTexture = true)
                else tex.isRenderTargetTexture = true
                return processNewTarget(cloned, this.sizeMultiplier || 1, trackTarget)
            }

        }(...params) as any as T
    }

    dispose() {
        this._trackedTargets.forEach(t=>t.dispose())
        Object.values(this._trackedTempTargets).forEach(t=>t.dispose())
        this._trackedTargets = []
        this._releasedTempTargets = {}
        this._trackedTempTargets = []
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

    private _processNewTarget(target: IRenderTarget, sizeMultiplier: number | undefined, trackTarget: boolean): IRenderTarget {
        if (sizeMultiplier !== undefined) target.sizeMultiplier = sizeMultiplier
        if (trackTarget) this.trackTarget(target)
        return target
    }

}
