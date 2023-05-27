import {
    HalfFloatType,
    IUniform,
    NoColorSpace,
    NoToneMapping,
    PCFShadowMap,
    ShaderMaterial,
    Texture,
    Vector2,
    Vector4,
    WebGLRenderer,
    WebGLRenderTarget,
} from 'three'
import {EffectComposer2, IPassID, IPipelinePass, sortPasses} from '../postprocessing'
import {IRenderTarget} from './RenderTarget'
import {RenderTargetManager} from './RenderTargetManager'
import {IShaderPropertiesUpdater} from '../materials'
import {
    IRenderManager,
    IRenderManagerEvent,
    IRenderManagerEventTypes,
    type IRenderManagerOptions,
    IRenderManagerUpdateEvent,
    IScene,
    IWebGLRenderer,
    upgradeWebGLRenderer,
} from '../core'
import {onChange, serializable, serialize} from 'ts-browser-helpers'

@serializable('RenderManager')
export class RenderManager extends RenderTargetManager<IRenderManagerEvent, IRenderManagerEventTypes> implements IShaderPropertiesUpdater, IRenderManager {
    private readonly _isWebGL2: boolean
    private readonly _composer: EffectComposer2
    private readonly _context: WebGLRenderingContext
    private readonly _renderSize = new Vector2(512, 512) // this is updated automatically.
    protected readonly _renderer: IWebGLRenderer<this>
    private _renderScale = 1.
    private _passes: IPipelinePass[] = []
    private _pipeline: IPassID[] = []
    private _passesNeedsUpdate = true
    private _frameCount = 0
    private _lastTime = 0
    private _totalFrameCount = 0

    public static readonly POWER_PREFERENCE: 'high-performance' | 'low-power' | 'default' = 'high-performance'

    get renderer() {return this._renderer}

    /**
     * Use total frame count, if this is set to true, then frameCount won't be reset when the viewer is set to dirty.
     * Which will generate different random numbers for each frame during postprocessing steps. With TAA set properly, this will give a smoother result.
     */
    @serialize() stableNoise = false

    public frameWaitTime = 0 // time to wait before next frame // used by canvas recorder //todo/

    protected _dirty = true

    /**
     * Set autoBuildPipeline = false to be able to set the pipeline manually.
     */
    @onChange(RenderManager.prototype.rebuildPipeline)
    public autoBuildPipeline = true

    rebuildPipeline(setDirty = true): void {
        this._passesNeedsUpdate = true
        if (setDirty) this._updated({change: 'rebuild'})
    }

    /**
     * Regenerates the render pipeline by resolving dependencies and sorting the passes.
     * This is called automatically when the passes are changed.
     */
    private _refreshPipeline(): IPassID[] {
        if (!this.autoBuildPipeline) return this._pipeline
        const ps = this._passes
        return this._pipeline = sortPasses(ps)
    }

    private _animationLoop(time: number, frame?:XRFrame) {
        const deltaTime = time - this._lastTime
        this._lastTime = time
        this.frameWaitTime -= deltaTime
        if (this.frameWaitTime > 0) return
        this.frameWaitTime = 0
        this.dispatchEvent({type: 'animationLoop', deltaTime, time, renderer: this._renderer, xrFrame: frame})
    }

    constructor({canvas, alpha = true, targetOptions}:IRenderManagerOptions) {
        super()
        this._animationLoop = this._animationLoop.bind(this)
        // this._xrPreAnimationLoop = this._xrPreAnimationLoop.bind(this)
        this._renderSize = new Vector2(canvas.clientWidth, canvas.clientHeight)
        this._renderer = this._initWebGLRenderer(canvas, alpha)
        this._context = this._renderer.getContext()
        this._isWebGL2 = this._renderer.capabilities.isWebGL2
        this.resetShadows()

        const composerTarget = this.createTarget<WebGLRenderTarget>(targetOptions, false)
        composerTarget.texture.name = 'EffectComposer.rt1'
        this._composer = new EffectComposer2(this._renderer, composerTarget)

        // if (animationLoop) this.addEventListener('animationLoop', animationLoop) // todo: from viewer
    }

    protected _initWebGLRenderer(canvas: HTMLCanvasElement, alpha: boolean): IWebGLRenderer<this> {
        const renderer = new WebGLRenderer({
            canvas,
            antialias: false,
            alpha,
            premultipliedAlpha: false, // todo: see this, maybe use this with rgbm mode.
            preserveDrawingBuffer: true,
            powerPreference: RenderManager.POWER_PREFERENCE,
        })
        renderer.useLegacyLights = false
        renderer.setAnimationLoop(this._animationLoop)
        renderer.onContextLost = (event: WebGLContextEvent) => {
            this.dispatchEvent({type: 'contextLost', event})
        }
        renderer.onContextRestore = () => {
            // console.log('restored')
            this.dispatchEvent({type: 'contextRestored'})
        }

        renderer.setSize(this._renderSize.width, this._renderSize.height, false)
        renderer.setPixelRatio(this._renderScale)

        renderer.toneMapping = NoToneMapping
        renderer.toneMappingExposure = 1
        renderer.outputColorSpace = NoColorSpace // or SRGBColorSpace

        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = PCFShadowMap // use?  THREE.PCFShadowMap. dont use VSM if need ground: https://github.com/mrdoob/three.js/issues/17473
        // renderer.shadowMap.type = BasicShadowMap // use?  THREE.PCFShadowMap. dont use VSM if need ground: https://github.com/mrdoob/three.js/issues/17473
        renderer.shadowMap.autoUpdate = false

        return upgradeWebGLRenderer.call(renderer, this)
    }

    setSize(width?: number, height?: number, force = false) {
        if (!force &&
            (width ? Math.abs(width - this._renderSize.width) : 0) +
            (height ? Math.abs(height - this._renderSize.height) : 0) < 0.1
        ) return

        if (width) this._renderSize.width = width
        if (height) this._renderSize.height = height
        if (!this.webglRenderer.xr.enabled) {
            this._renderer.setSize(this._renderSize.width, this._renderSize.height, false)
            this._renderer.setPixelRatio(this._renderScale)
        }
        this._composer.setPixelRatio(this._renderScale, false)
        this._composer.setSize(this._renderSize.width, this._renderSize.height)

        this._resizeTracedTargets()

        // console.log('setSize', {...this._renderSize}, this._trackedTargets.length)

        this.dispatchEvent({type: 'resize'})
        this._updated({change: 'size', data: this._renderSize.toArray()})
        this.reset()

    }

    // render(scene: RenderScene): void {
    //     const camera = scene.activeCamera
    //     const activeScene = scene.activeScene
    //     if(!camera) return
    //     this._renderer.render(scene.threeScene, camera)
    //     // todo gizmos
    // }

    render(scene: IScene): void {
        if (this._passesNeedsUpdate) {
            this._refreshPipeline()
            this.refreshPasses()
        }
        for (const pass of this._passes) {
            if (pass.enabled) pass.beforeRender?.(scene, scene.mainCamera, this)
        }
        this._composer.render()
        this._frameCount += 1
        this._totalFrameCount += 1
        this._dirty = false
    }

    get needsRender(): boolean {
        this._dirty = this._dirty || this._passes.findIndex(value => value.dirty) >= 0 // todo: check for enabled passes only.
        return this._dirty
    }

    setDirty(reset = false): void {
        this._dirty = true
        if (reset) this.reset()
        // do NOT call _updated from here.
    }

    reset(): void {
        this._frameCount = 0
        this._dirty = true
        // do NOT call _updated from here.
    }

    resetShadows(): void {
        this._renderer.shadowMap.needsUpdate = true
    }

    refreshPasses(): void {
        if (!this._passesNeedsUpdate) return
        this._passesNeedsUpdate = false
        const p = []
        for (const passId of this._pipeline) {
            const a = this._passes.find(value => value.passId === passId)
            if (!a) {
                console.warn('Unable to find pass: ', passId)
                continue
            }
            p.push(a)
        }
        [...this._composer.passes].forEach(p1=>this._composer.removePass(p1))
        p.forEach(p1=>this._composer.addPass(p1))
        this._updated({change: 'passRefresh'})
    }

    dispose(): void {
        super.dispose()
        this._renderer.dispose()
    }

    updateShaderProperties(material: {defines: Record<string, string|number|undefined>, uniforms: {[name: string]: IUniform}}): this {
        // if (material.uniforms.currentFrameCount) material.uniforms.currentFrameCount.value = this.frameCount
        if (!this.stableNoise) {
            if (material.uniforms.frameCount) material.uniforms.frameCount.value = this._totalFrameCount
            else console.warn('BaseRenderer: no uniform: frameCount')
        } else {
            if (material.uniforms.frameCount) material.uniforms.frameCount.value = this.frameCount
            else console.warn('BaseRenderer: no uniform: frameCount')
        }
        return this
    }

    // region Passes

    registerPass(pass: IPipelinePass, replaceId = true): void {
        if (replaceId) {
            for (const pass1 of [...this._passes]) {
                if (pass.passId === pass1.passId) this.unregisterPass(pass1)
            }
        }
        this._passes.push(pass)
        pass.onRegister?.(this)
        this.rebuildPipeline(false)
        this._updated({change: 'registerPass', pass})
    }

    unregisterPass(pass: IPipelinePass): void {
        const i = this._passes.indexOf(pass)
        if (i >= 0) {
            pass.onUnregister?.(this)
            this._passes.splice(i, 1)
            this.rebuildPipeline(false)
            this._updated({change: 'unregisterPass', pass})
        }
    }

    /**
     * Only to be used for testing. To do it properly, render the target to the main canvas(with proper encoding and type conversion) and call canvas.toDataURL()
     * @param target
     * @param mimeType
     * @param quality
     */
    renderTargetToDataUrl(target: WebGLRenderTarget, mimeType = 'image/png', quality = 90): string {
        const canvas = document.createElement('canvas')
        canvas.width = target.width
        canvas.height = target.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Unable to get 2d context')
        const imageData = ctx.createImageData(target.width, target.height, {colorSpace: ['display-p3', 'srgb'].includes(target.texture.colorSpace) ? <PredefinedColorSpace>target.texture.colorSpace : undefined})
        if (target.texture.type === HalfFloatType) {
            const buffer = new Uint16Array(target.width * target.height * 4)
            this._renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, buffer)
            for (let i = 0; i < buffer.length; i++) {
                imageData.data[i] = buffer[i] / 15360 * 255 // todo check packing
            }
        } else {
            // todo: handle rgbm to srgb conversion?
            this._renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, imageData.data)
        }
        ctx.putImageData(imageData, 0, 0)
        const string = canvas.toDataURL(mimeType, quality)
        canvas.remove()
        return string
    }


    // endregion

    // region Getters and Setters

    get frameCount(): number {
        return this._frameCount
    }
    get totalFrameCount(): number {
        return this._totalFrameCount
    }
    set pipeline(value: IPassID[]) {
        this._pipeline = value
        if (this.autoBuildPipeline) {
            console.warn('BaseRenderer: pipeline changed, but autoBuildPipeline is true. This will not have any effect.')
        }
        this.rebuildPipeline()
    }
    get pipeline(): IPassID[] {
        return this._pipeline
    }
    get composer(): EffectComposer2 {
        return this._composer
    }
    get passes(): IPipelinePass[] {
        return this._passes
    }
    get isWebGL2(): boolean {
        return this._isWebGL2
    }
    get composerTarget(): IRenderTarget {
        return this._composer.renderTarget1
    }
    get composerTarget2(): IRenderTarget {
        return this._composer.renderTarget2
    }
    get renderSize(): Vector2 {
        return this._renderSize
    }
    get renderScale(): number {
        return this._renderScale
    }
    set renderScale(value: number) {
        if (value !== this._renderScale) {
            this._renderScale = value
            this.setSize(undefined, undefined, true)
        }
    }

    get context(): WebGLRenderingContext {
        return this._context
    }

    get webglRenderer(): WebGLRenderer {
        return this._renderer
    }

    @serialize()
    get useLegacyLights(): boolean {
        return this._renderer.useLegacyLights
    }
    set useLegacyLights(v: boolean) {
        this._renderer.useLegacyLights = v
        this._updated({change: 'useLegacyLights', data: v})
        this.resetShadows()
    }

    get clock() {
        return this._composer.clock
    }

    // endregion

    // region Events Dispatch

    private _updated(data?: Partial<IRenderManagerUpdateEvent>) {
        this.dispatchEvent({...data, type: 'update'})
    }

    // endregion



    // / TODO



    blit(destination: IRenderTarget|undefined|null, {source, viewport, material, clear = true, respectColorSpace = false}: {source?: Texture, viewport?: Vector4, material?: ShaderMaterial, clear?: boolean, respectColorSpace?: boolean} = {}): void {
        const copyPass = !respectColorSpace ? this._composer.copyPass : this._composer.copyPass2
        const {renderToScreen, material: oldMaterial, uniforms: oldUniforms, clear: oldClear} = copyPass
        if (material) {
            copyPass.material = material
        }
        const oldViewport = this._renderer.getViewport(new Vector4())
        const oldScissor = this._renderer.getScissor(new Vector4())
        const oldScissorTest = this._renderer.getScissorTest()
        const oldAutoClear = this._renderer.autoClear
        const oldTarget = this._renderer.getRenderTarget()
        if (viewport) this._renderer.setViewport(viewport)
        if (viewport) this._renderer.setScissor(viewport)
        if (viewport) this._renderer.setScissorTest(true)
        this._renderer.autoClear = false
        copyPass.uniforms = copyPass.material.uniforms
        copyPass.renderToScreen = false
        copyPass.clear = clear
        this._renderer.renderWithModes({
            sceneRender: true,
            opaqueRender: true,
            shadowMapRender: false,
            backgroundRender: false,
            transparentRender: true,
            transmissionRender: false,
        }, ()=>{
            copyPass.render(this._renderer, <WebGLRenderTarget>destination || null, {texture: source} as any, 0, false)
        })
        copyPass.renderToScreen = renderToScreen
        copyPass.clear = oldClear
        copyPass.material = oldMaterial
        copyPass.uniforms = oldUniforms
        this._renderer.autoClear = oldAutoClear
        if (viewport) this._renderer.setViewport(oldViewport)
        if (viewport) this._renderer.setScissor(oldScissor)
        if (viewport) this._renderer.setScissorTest(oldScissorTest)
        this._renderer.setRenderTarget(oldTarget) // todo: active cubeface etc
    }

    // clearColor({r, g, b, a, target, depth = true, stencil = true}:
    //                {r?: number, g?: number, b?: number, a?: number, target?: IRenderTarget, depth?: boolean, stencil?: boolean}): void {
    //     const color = this._renderer.getClearColor(new Color())
    //     const alpha = this._renderer.getClearAlpha()
    //     this._renderer.setClearAlpha(a ?? alpha)
    //     this._renderer.setClearColor(new Color(r ?? color.r, g ?? color.g, b ?? color.b))
    //     const lastTarget = this._renderer.getRenderTarget()
    //     const activeCubeFace = this._renderer.getActiveCubeFace()
    //     const activeMipLevel = this._renderer.getActiveMipmapLevel()
    //     this._renderer.setRenderTarget((target as WebGLRenderTarget) ?? null)
    //     this._renderer.clear(true, depth, stencil)
    //     this._renderer.setRenderTarget(lastTarget, activeCubeFace, activeMipLevel)
    //     this._renderer.setClearColor(color)
    //     this._renderer.setClearAlpha(alpha)
    // }


    /**
     * @deprecated use renderScale instead
     */
    get displayCanvasScaling() {
        console.error('displayCanvasScaling is deprecated, use renderScale instead')
        return this.renderScale
    }
    /**
     * @deprecated use renderScale instead
     */
    set displayCanvasScaling(value) {
        console.error('displayCanvasScaling is deprecated, use renderScale instead')
        this.renderScale = value
    }

}
