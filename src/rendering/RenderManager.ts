import {
    AddEquation,
    Color,
    ColorSpace, ConstantAlphaFactor, CustomBlending,
    FloatType,
    HalfFloatType,
    IUniform,
    NoBlending,
    NoColorSpace,
    NormalBlending,
    NoToneMapping, OneMinusConstantAlphaFactor,
    PCFShadowMap, ShaderChunk, ShaderLib,
    ShadowMapType,
    Texture,
    Vector2,
    Vector4,
    WebGLMultipleRenderTargets,
    WebGLRenderer,
    WebGLRenderTarget,
    WebGLRenderTargetOptions,
    WebGLShadowMap,
} from 'three'
import {EffectComposer2, IPassID, IPipelinePass, sortPasses} from '../postprocessing'
import {IRenderTarget} from './RenderTarget'
import {RenderTargetManager} from './RenderTargetManager'
import {IShaderPropertiesUpdater} from '../materials'
import {
    IRenderManager,
    type IRenderManagerOptions,
    IRenderManagerUpdateEvent,
    IScene,
    IWebGLRenderer,
    upgradeWebGLRenderer,
} from '../core'
import {
    base64ToArrayBuffer,
    canvasFlipY,
    Class,
    getOrCall,
    onChange2,
    serializable,
    serialize,
    ValOrArr,
} from 'ts-browser-helpers'
import {uiButton, uiConfig, uiDropdown, uiFolderContainer, uiMonitor, uiSlider, uiToggle} from 'uiconfig.js'
import {bindToValue, generateUUID, textureDataToImageData} from '../three'
import {BlobExt, EXRExporter2} from '../assetmanager'
import {IRenderManagerEventMap, RendererBlitOptions} from '../core/IRenderer'

@serializable('RenderManager')
@uiFolderContainer('Render Manager')
export class RenderManager<TE extends IRenderManagerEventMap = IRenderManagerEventMap> extends RenderTargetManager<IRenderManagerEventMap&TE> implements IShaderPropertiesUpdater, IRenderManager<IRenderManagerEventMap&TE> {
    private readonly _isWebGL2: boolean
    private readonly _composer: EffectComposer2
    private readonly _context: WebGLRenderingContext
    @uiMonitor('Render Size')
    private readonly _renderSize = new Vector2(512, 512) // this is updated automatically.
    protected readonly _renderer: IWebGLRenderer<this>
    private _renderScale = 1.
    @uiSlider('Render Scale', [0.1, 8], 0.05) // keep here in code so its at the top in the UI
    get renderScale(): number {
        return this._renderScale
    }
    set renderScale(value: number) {
        if (value !== this._renderScale) {
            this._renderScale = value
            this.setSize(undefined, undefined, true)
        }
    }

    @serialize()
    @uiDropdown('Shadow Map Type', ['BasicShadowMap', 'PCFShadowMap', 'PCFSoftShadowMap', 'VSMShadowMap'].map((v, i) => ({label: v, value: i})), {tags: ['advanced']})
    @bindToValue({obj: 'shadowMap', key: 'type', onChange: RenderManager.prototype._shadowMapTypeChanged})
        shadowMapType: ShadowMapType

    @bindToValue({obj: 'renderer', key: 'shadowMap'})
        shadowMap: WebGLShadowMap

    private _shadowMapTypeChanged() {
        this.resetShadows()
        this.reset()
    }

    @uiConfig(undefined, {label: 'Passes', tags: ['advanced'], order: 1000})
    private _passes: IPipelinePass[] = []
    private _pipeline: IPassID[] = []
    private _passesNeedsUpdate = true
    private _frameCount = 0
    private _lastTime = 0
    private _totalFrameCount = 0

    public static readonly POWER_PREFERENCE: WebGLPowerPreference = 'high-performance'

    get renderer() {return this._renderer}

    /**
     * Use total frame count, if this is set to true, then frameCount won't be reset when the viewer is set to dirty.
     * Which will generate different random numbers for each frame during postprocessing steps. With TAA set properly, this will give a smoother result.
     */
    @uiToggle() @serialize() stableNoise = false

    public frameWaitTime = 0 // time to wait before next frame // used by canvas recorder //todo/

    protected _dirty = true

    /**
     * Set autoBuildPipeline = false to be able to set the pipeline manually.
     */
    @onChange2(RenderManager.prototype.rebuildPipeline)
    public autoBuildPipeline = true

    @uiButton('Rebuild Pipeline', {sendArgs: false, tags: ['advanced']})
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
        try {
            this._pipeline = sortPasses(ps)
        } catch (e) {
            console.error('RenderManager: Unable to sort rendering passes', e)
        }
        return this._pipeline
    }

    animationLoop(time: number, frame?:XRFrame) {
        const deltaTime = time - this._lastTime
        this._lastTime = time
        this.frameWaitTime -= deltaTime
        if (this.frameWaitTime > 0) return
        this.frameWaitTime = 0
        this.dispatchEvent({type: 'animationLoop', deltaTime, time, renderer: this._renderer, xrFrame: frame})
    }

    constructor({canvas, alpha = true, renderScale = 1, powerPreference, targetOptions}:IRenderManagerOptions) {
        super()
        this.animationLoop = this.animationLoop.bind(this)
        // this._xrPreAnimationLoop = this._xrPreAnimationLoop.bind(this)
        this._renderSize = new Vector2(canvas.clientWidth, canvas.clientHeight)
        this._renderScale = renderScale
        this._renderer = this._initWebGLRenderer(canvas, alpha, targetOptions?.stencilBuffer ?? false, powerPreference)
        this._context = this._renderer.getContext()
        this._isWebGL2 = this._renderer.capabilities.isWebGL2
        if (!this._isWebGL2) console.error('RenderManager: WebGL 1 is not officially supported anymore. Some features may not work.')
        this.resetShadows()

        const composerTarget = this.createTarget<WebGLRenderTarget>(targetOptions, false)
        composerTarget.texture.name = 'EffectComposer.rt1'
        this._composer = new EffectComposer2(this._renderer, composerTarget)

        // if (animationLoop) this.addEventListener('animationLoop', animationLoop) // todo: from viewer
    }

    protected _initWebGLRenderer(canvas: HTMLCanvasElement, alpha: boolean, stencil: boolean, powerPreference?: WebGLPowerPreference): IWebGLRenderer<this> {
        const renderer = new WebGLRenderer({
            canvas,
            antialias: false,
            alpha,
            premultipliedAlpha: false, // todo: see this, maybe use this with rgbm mode.
            preserveDrawingBuffer: true,
            powerPreference: powerPreference ?? RenderManager.POWER_PREFERENCE,
            stencil,
        })
        // renderer.info.autoReset = false // Not supported by ExtendedRenderPass

        // renderer.useLegacyLights = false
        renderer.setAnimationLoop(this.animationLoop)
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
        renderer.shadowMap.type = PCFShadowMap // dont use VSM if need ground: https://github.com/mrdoob/three.js/issues/17473
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
        if (!(this.webglRenderer.xr.enabled && this.webglRenderer.xr.isPresenting)) {
            this._renderer.setSize(this._renderSize.width, this._renderSize.height, false)
            this._renderer.setPixelRatio(this._renderScale)
        }
        this._composer.setPixelRatio(this._renderScale, false)
        this._composer.setSize(this._renderSize.width, this._renderSize.height)

        this.resizeTrackedTargets()

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

    /**
     * Default value for renderToScreen in {@link render}
     */
    defaultRenderToScreen = true

    render(scene: IScene, renderToScreen?: boolean): void {
        if (this._passesNeedsUpdate) {
            this._refreshPipeline()
            this.refreshPasses()
        }
        for (const pass of this._passes) {
            if (pass.enabled && pass.beforeRender) pass.beforeRender(scene, scene.renderCamera, this)
        }
        this._composer.renderToScreen = renderToScreen ?? this.defaultRenderToScreen
        this.dispatchEvent({type: 'preRender', scene, renderToScreen: this._composer.renderToScreen})
        this._composer.render()
        this.dispatchEvent({type: 'postRender', scene, renderToScreen: this._composer.renderToScreen})
        this._composer.renderToScreen = true
        if (renderToScreen) {
            this.incRenderToScreen()
        }
        this._dirty = false
    }

    // todo better name
    incRenderToScreen() {
        this._frameCount += 1
        this._totalFrameCount += 1
    }

    onPostFrame = () => {
        for (const pass of this._passes) {
            if (pass.enabled && pass.onPostFrame) pass.onPostFrame?.(this)
        }
    }

    get needsRender(): boolean {
        if (this.renderSize.x < 1 || this.renderSize.y < 1) return false
        this._dirty = this._dirty || this._passes.findIndex(value => getOrCall(value.dirty)) >= 0 // todo: check for enabled passes only.
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

    dispose(clear = true): void {
        super.dispose(clear)
        this._renderer.dispose()
    }

    updateShaderProperties(material: {defines: Record<string, string|number|undefined>, uniforms: {[name: string]: IUniform}}): this {
        if (material.uniforms.currentFrameCount) material.uniforms.currentFrameCount.value = this.frameCount
        if (!this.stableNoise) {
            if (material.uniforms.frameCount) material.uniforms.frameCount.value = this._totalFrameCount
            else console.warn('RenderManager: no uniform: frameCount')
        } else {
            if (material.uniforms.frameCount) material.uniforms.frameCount.value = this.frameCount
            else console.warn('RenderManager: no uniform: frameCount')
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

    // endregion

    // region Getters and Setters

    get frameCount(): number {
        return this._frameCount
    }
    get totalFrameCount(): number {
        return this._totalFrameCount
    }
    resetTotalFrameCount(): void {
        this._totalFrameCount = 0
    }
    set pipeline(value: IPassID[]) {
        this._pipeline = value
        if (this.autoBuildPipeline) {
            console.warn('RenderManager: pipeline changed, but autoBuildPipeline is true. This will not have any effect.')
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

    /**
     * The size set in the three.js renderer.
     * Final size is renderSize * renderScale
     */
    get renderSize(): Vector2 {
        return this._renderSize
    }

    get context(): WebGLRenderingContext {
        return this._context
    }

    /**
     * Same as {@link renderer}
     */
    get webglRenderer(): WebGLRenderer {
        return this._renderer
    }

    /**
     * @deprecated will be removed in the future
     */
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

    // region Utils

    /**
     * blit - blits a texture to the screen or another render target.
     * @param destination - destination target, or screen if undefined or null
     * @param source - source Texture
     * @param viewport - viewport and scissor
     * @param material - override material
     * @param clear - clear before blit
     * @param respectColorSpace - does color space conversion when reading and writing to the target
     * @param blending - Note - Set to NormalBlending if transparent is set to false
     * @param transparent
     * @param opacity - opacity of the material, if not set, uses the material's opacity
     * @param blendAlpha - custom blending factor, if set, overrides blending. The material will use CustomBlending with ConstantAlphaFactor and OneMinusConstantAlphaFactor, useful to blend between textures.
     */
    blit(destination: IRenderTarget|undefined|null, {source, viewport, material, clear = true, respectColorSpace = false, blending = NoBlending, transparent = true, opacity, blendAlpha}: RendererBlitOptions = {}): void {
        const copyPass = !respectColorSpace ? this._composer.copyPass : this._composer.copyPass2
        const {renderToScreen, material: oldMaterial, uniforms: oldUniforms, clear: oldClear} = copyPass
        if (material) {
            copyPass.material = material
        }
        const oldTransparent = copyPass.material.transparent
        const oldViewport = !destination ? this._renderer.getViewport(new Vector4()) : destination.viewport.clone()
        const oldScissor = !destination ? this._renderer.getScissor(new Vector4()) : destination.scissor.clone()
        const oldScissorTest = !destination ? this._renderer.getScissorTest() : destination.scissorTest
        const oldAutoClear = this._renderer.autoClear
        const oldTarget = this._renderer.getRenderTarget()
        const oldBlending = copyPass.material.blending
        const oldOpacity = copyPass.material.uniforms.opacity?.value ?? 1
        const oldBlendAlpha = copyPass.material.blendAlpha
        const oldBlendSrc = copyPass.material.blendSrc
        const oldBlendDst = copyPass.material.blendDst
        const oldBlendEquation = copyPass.material.blendEquation

        if (viewport) {
            if (!destination) {
                this._renderer.setViewport(viewport)
                this._renderer.setScissor(viewport)
                this._renderer.setScissorTest(true)
            } else {
                destination.viewport.copy(viewport)
                destination.scissor.copy(viewport)
                destination.scissorTest = true
            }
        }
        this._renderer.autoClear = false
        copyPass.material.blending = !transparent ? NormalBlending : blending
        copyPass.uniforms = copyPass.material.uniforms
        copyPass.renderToScreen = false
        copyPass.clear = clear
        copyPass.material.transparent = transparent
        copyPass.material.needsUpdate = true
        if (copyPass.material.uniforms.opacity && opacity !== undefined) {
            copyPass.material.uniforms.opacity.value = opacity
        }

        if (blendAlpha !== undefined) {
            // blendAlpha is custom blending factor
            copyPass.material.blending = CustomBlending
            copyPass.material.blendSrc = ConstantAlphaFactor
            copyPass.material.blendDst = OneMinusConstantAlphaFactor
            copyPass.material.blendEquation = AddEquation
            copyPass.material.blendAlpha = blendAlpha
        }

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
        if (copyPass.material.uniforms.opacity && opacity !== undefined) {
            copyPass.material.uniforms.opacity.value = oldOpacity
        }
        copyPass.renderToScreen = renderToScreen
        copyPass.clear = oldClear
        copyPass.material.blending = oldBlending
        copyPass.material.blendSrc = oldBlendSrc
        copyPass.material.blendDst = oldBlendDst
        copyPass.material.blendEquation = oldBlendEquation
        copyPass.material.blendAlpha = oldBlendAlpha
        copyPass.material.transparent = oldTransparent
        copyPass.material = oldMaterial
        copyPass.uniforms = oldUniforms
        this._renderer.autoClear = oldAutoClear
        if (viewport) {
            if (!destination) {
                this._renderer.setViewport(oldViewport)
                this._renderer.setScissor(oldScissor)
                this._renderer.setScissorTest(oldScissorTest)
            } else {
                destination.viewport.copy(oldViewport)
                destination.scissor.copy(oldScissor)
                destination.scissorTest = oldScissorTest
            }
        }
        this._renderer.setRenderTarget(oldTarget) // todo: active cubeface etc
    }

    clearColor({r, g, b, a, target, depth = true, stencil = true, viewport}:
                   {r?: number, g?: number, b?: number, a?: number, target?: IRenderTarget, depth?: boolean, stencil?: boolean, viewport?: Vector4}): void {
        const color = this._renderer.getClearColor(new Color())
        const alpha = this._renderer.getClearAlpha()
        this._renderer.setClearColor(new Color(r ?? color.r, g ?? color.g, b ?? color.b), a ?? alpha)
        const lastTarget = this._renderer.getRenderTarget()
        const activeCubeFace = this._renderer.getActiveCubeFace()
        const activeMipLevel = this._renderer.getActiveMipmapLevel()

        const oldViewport = !target ? this._renderer.getViewport(new Vector4()) : target.viewport.clone()
        const oldScissor = !target ? this._renderer.getScissor(new Vector4()) : target.scissor.clone()
        const oldScissorTest = !target ? this._renderer.getScissorTest() : target.scissorTest
        if (viewport) {
            if (!target) {
                this._renderer.setViewport(viewport)
                this._renderer.setScissor(viewport)
                this._renderer.setScissorTest(true)
            } else {
                target.viewport.copy(viewport)
                target.scissor.copy(viewport)
                target.scissorTest = true
            }
        }

        this._renderer.setRenderTarget((target as WebGLRenderTarget) ?? null)
        this._renderer.clear(true, depth, stencil)
        if (target && typeof target.clear === 'function') {
            // WebGLCubeRenderTarget
            target.clear(this._renderer, true, depth, stencil)
        } else {
            this._renderer.setRenderTarget((target as any as WebGLRenderTarget) ?? null)
            this._renderer.clear(true, depth, stencil)
        }

        if (viewport) {
            if (!target) {
                this._renderer.setViewport(oldViewport)
                this._renderer.setScissor(oldScissor)
                this._renderer.setScissorTest(oldScissorTest)
            } else {
                target.viewport.copy(oldViewport)
                target.scissor.copy(oldScissor)
                target.scissorTest = oldScissorTest
            }
        }

        this._renderer.setRenderTarget(lastTarget, activeCubeFace, activeMipLevel)
        this._renderer.setClearColor(color, alpha)
    }


    /**
     * Copies a render target to a new/existing canvas element.
     * Note: this will clamp the values to [0, 1] and converts to srgb for float and half-float render targets.
     * @param target
     * @param textureIndex - index of the texture to use in the render target (only in case of multiple render target)
     * @param canvas - optional canvas to render to, if not provided a new canvas will be created.
     */
    renderTargetToCanvas(target: WebGLMultipleRenderTargets|WebGLRenderTarget|IRenderTarget, textureIndex = 0, canvas?: HTMLCanvasElement): HTMLCanvasElement {
        canvas = canvas ?? document.createElement('canvas')
        canvas.width = target.width
        canvas.height = target.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Unable to get 2d context')
        const texture = Array.isArray(target.texture) ? target.texture[textureIndex] : target.texture
        const imageData = ctx.createImageData(target.width, target.height, {colorSpace: ['display-p3', 'srgb'].includes(texture.colorSpace) ? <PredefinedColorSpace>texture.colorSpace : undefined})
        if (texture.type === HalfFloatType || texture.type === FloatType) {
            const buffer = this.renderTargetToBuffer(target as any, textureIndex)
            textureDataToImageData({data: buffer, width: target.width, height: target.height}, texture.colorSpace, imageData) // this handles converting to srgb
        } else {
            // todo: handle rgbm to srgb conversion?
            this._renderer.readRenderTargetPixels(target as any, 0, 0, target.width, target.height, imageData.data, undefined, textureIndex)
        }

        ctx.putImageData(imageData, 0, 0)

        return canvas
    }

    /**
     * Converts a render target to a png/jpeg data url string.
     * Note: this will clamp the values to [0, 1] and converts to srgb for float and half-float render targets.
     * @param target
     * @param mimeType
     * @param quality
     * @param textureIndex - index of the texture to use in the render target (only in case of multiple render target)
     */
    renderTargetToDataUrl(target: WebGLMultipleRenderTargets|WebGLRenderTarget|IRenderTarget, mimeType = 'image/png', quality = 90, textureIndex = 0): string {
        const texture = Array.isArray(target.texture) ? target.texture[textureIndex] : target.texture
        const canvas = this.renderTargetToCanvas(target, textureIndex)

        const string = (texture.flipY ? canvas : canvasFlipY(canvas)).toDataURL(mimeType, quality) // intentionally inverted ternary
        canvas.remove()
        return string
    }

    /**
     * Rend pixels from a render target into a new Uint8Array|Uint16Array|Float32Array buffer
     * @param target - render target to read from
     * @param textureIndex - index of the texture to use in the render target (only in case of multiple render target)
     */
    renderTargetToBuffer(target: WebGLMultipleRenderTargets|WebGLRenderTarget, textureIndex = 0): Uint8Array|Uint16Array|Float32Array {
        const texture = Array.isArray(target.texture) ? target.texture[textureIndex] : target.texture
        const buffer =
            texture.type === HalfFloatType ?
                new Uint16Array(target.width * target.height * 4) :
                texture.type === FloatType ?
                    new Float32Array(target.width * target.height * 4) :
                    new Uint8Array(target.width * target.height * 4)
        this._renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, buffer, undefined, textureIndex)
        return buffer
    }

    /**
     * Exports a render target to a blob. The type is automatically picked from exr to png based on the render target.
     * @param target - render target to export
     * @param mimeType - mime type to use.
     * If auto (default), then it will be picked based on the render target type.
     * @param textureIndex - index of the texture to use in the render target (only in case of multiple render target)
     */
    exportRenderTarget(target: WebGLRenderTarget<Texture|Texture[]>, mimeType = 'auto', textureIndex = 0): BlobExt {
        const hdrFormats = ['image/x-exr']
        const texture = Array.isArray(target.texture) ? target.texture[textureIndex] : target.texture
        let hdr = texture.type === HalfFloatType || texture.type === FloatType
        if (mimeType === 'auto') {
            mimeType = hdr ? 'image/x-exr' : 'image/png'
        }
        if (!hdrFormats.includes(mimeType)) hdr = false
        let buffer: ArrayBuffer
        if (!hdr) {
            const url = this.renderTargetToDataUrl(target, mimeType === 'auto' ? undefined : mimeType, 90, textureIndex)
            buffer = base64ToArrayBuffer(url.split(',')[1]) as ArrayBuffer
            mimeType = url.split(';')[0].split(':')[1]
        } else {
            if (mimeType !== 'image/x-exr') {
                console.warn('RenderManager: mimeType ', mimeType, ' is not supported for HDR. Using EXR instead')
                mimeType = 'image/x-exr'
            }
            const exporter = new EXRExporter2()
            buffer = exporter.parse(this._renderer, target, {textureIndex}).buffer as ArrayBuffer
        }
        const b = new Blob([buffer], {type: mimeType}) as BlobExt
        b.ext = mimeType === 'image/x-exr' ? 'exr' : mimeType.split('/')[1]
        return b
    }

    // endregion


    // region Events Dispatch

    private _updated(data?: IRenderManagerUpdateEvent) {
        this.dispatchEvent({...data, type: 'update'})
    }

    // endregion

    protected _createTargetClass(clazz: Class<WebGLRenderTarget>, size: number[], options: WebGLRenderTargetOptions): IRenderTarget {
        const processNewTarget = this._processNewTarget
        const disposeTarget = this.disposeTarget.bind(this)
        return new class RenderTarget extends clazz implements IRenderTarget {
            isTemporary?: boolean
            sizeMultiplier?: number
            uuid: string
            readonly assetType = 'renderTarget'
            name = 'RenderTarget'
            // @ts-expect-error because WebGLRenderTarget does not have texture as array
            texture: ValOrArr<Texture&{_target: IRenderTarget}>

            constructor(public readonly renderManager: IRenderManager, ...ps: any[]) {
                super(...ps)
                this.uuid = generateUUID()
                const ops = ps[ps.length - 1] as WebGLRenderTargetOptions
                const colorSpace = ops?.colorSpace
                this._initTexture(colorSpace)
            }

            private _initTexture(colorSpace?: ColorSpace) {
                if (Array.isArray(this.texture)) {
                    this.texture.forEach(t => {
                        if (colorSpace !== undefined) t.colorSpace = colorSpace
                        t._target = this
                        t.toJSON = () => {
                            console.warn('Multiple render target texture.toJSON not supported yet.')
                            return {}
                        }
                    })
                } else {
                    this.texture._target = this
                    // if (colorSpace !== undefined) this.texture.colorSpace = colorSpace
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
                if (this.isTemporary) throw 'Cloning temporary render targets not supported' // todo why?
                if (Array.isArray(this.texture)) throw 'Cloning multiple render targets not supported'
                // Note: todo: webgl render target.clone messes up the texture, by not copying isRenderTargetTexture prop and maybe some other stuff. So its better to just create a new one
                // const cloned = super.clone() as IRenderTarget
                const cloned = new (this.constructor as Class<typeof this>)(this.renderManager)
                cloned.copy(this as any)
                cloned._initTexture((Array.isArray(this.texture) ? this.texture[0] : this.texture)?.colorSpace)
                const tex = cloned.texture
                if (Array.isArray(tex)) tex.forEach(t => t.isRenderTargetTexture = true)
                else tex.isRenderTargetTexture = true
                return processNewTarget(cloned, this.sizeMultiplier || 1, trackTarget)
            }

            // copy(source: IRenderTarget|RenderTarget): this {
            //     super.copy(source as any)
            //     return this
            // }

            // Note - by default unregister need to be false.
            dispose(unregister = false) {
                if (unregister === true) disposeTarget(this, true)
                else super.dispose()
            }

            // required for uiconfig.js. see UiConfigMethods.getValue
            // eslint-disable-next-line @typescript-eslint/naming-convention
            _ui_isPrimitive = true

        }(this, ...size, options)
    }

    static ShaderChunk = ShaderChunk
    static ShaderLib = ShaderLib

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
