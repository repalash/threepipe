import {
    AdditiveBlending,
    CopyShader,
    ExtendedShaderPass,
    GBufferPlugin,
    GBufferUpdater,
    GBufferUpdaterContext,
    generateUiConfig,
    HalfFloatType,
    IMaterial,
    IMaterialUserData,
    IPassID,
    IPipelinePass,
    IViewerEvent,
    IWebGLRenderer,
    matDefineBool,
    MaterialExtension,
    NoBlending,
    onChange,
    onChange2,
    PipelinePassPlugin,
    serialize,
    ThreeViewer,
    uiConfig,
    uiConfigMaterialExtension,
    uiFolderContainer,
    UiObjectConfig,
    uiSlider,
    uiToggle,
    uniform,
    updateBit,
    Vector2,
    Vector4,
    WebGLRenderTarget,
} from 'threepipe'
import hdrBloom from './shaders/hdrBloom.glsl'

const passId = 'bloom'
type BloomPassId = typeof passId

/**
 * Bloom Plugin
 *
 * Adds HDR Bloom post-processing effect to the scene
 * @category Plugins
 */
export class BloomPlugin
    extends PipelinePassPlugin<BloomPluginPass<BloomPassId>, BloomPassId>
    implements GBufferUpdater {
    static readonly PluginType = 'Bloom'
    static readonly OldPluginType = 'BloomPlugin' // todo swap
    readonly passId = passId

    readonly materialExtension: MaterialExtension = uiConfigMaterialExtension(this._getUiConfig.bind(this), BloomPlugin.PluginType)

    protected _createPass() {
        const pass = new BloomPluginPass(this.passId, Math.min(8, this._viewer?.renderManager.maxHDRIntensity || 8))
        return pass
    }

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: BloomPluginPass<BloomPassId>

    dependencies = [GBufferPlugin]

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        const gbuffer = viewer.getPlugin(GBufferPlugin)
        if (gbuffer) {
            gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
            this._pass!.material.registerMaterialExtensions([gbuffer.unpackExtension])
        } else viewer.addEventListener('addPlugin', this._onPluginAdd) // todo subscribe to remove plugin
        viewer.materialManager.registerMaterialExtension(this.materialExtension)
    }
    private _onPluginAdd = (e: IViewerEvent)=>{ // not really required since gbuffer is now a dependency
        if (e.plugin?.constructor?.PluginType !== GBufferPlugin.PluginType) return
        const gbuffer = e.plugin as GBufferPlugin
        gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
        this._pass?.material.registerMaterialExtensions([gbuffer.unpackExtension])
        this._viewer?.removeEventListener('addPlugin', this._onPluginAdd)
    }
    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('addPlugin', this._onPluginAdd)
        const gbuffer = viewer.getPlugin(GBufferPlugin)
        gbuffer?.unregisterGBufferUpdater(this.constructor.PluginType)
        gbuffer && this._pass?.material.unregisterMaterialExtensions([gbuffer.unpackExtension])
        viewer.materialManager.unregisterMaterialExtension(this.materialExtension)
        super.onRemove(viewer)
    }

    updateGBufferFlags(data: Vector4, c: GBufferUpdaterContext): void {
        if (!c.material || !c.material.userData) return
        const disabled = c.material.userData[BloomPlugin.PluginType]?.enable === false ||
            c.material.userData.pluginsDisabled
        const x = disabled ? 0 : 1
        data.w = updateBit(data.w, 2, x)
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Bloom Plugin',
        onChange: this.setDirty.bind(this),
        children: [
            ...generateUiConfig(this) || [],
        ],
    }

    static AddBloomData(material: IMaterial, params?: IMaterialUserData['Bloom'], setDirty = true): IMaterialUserData['Bloom']|null {
        const ud = material?.userData
        if (!ud) return null
        if (!ud[BloomPlugin.PluginType]) {
            ud[BloomPlugin.PluginType] = {}
        }
        const data = ud[BloomPlugin.PluginType]!
        data.enable = true
        params && Object.assign(data, params)
        if (setDirty && material.setDirty) material.setDirty()
        return data
    }

    /**
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    private _getUiConfig(material: IMaterial) {
        const config: UiObjectConfig = {
            type: 'folder',
            label: 'Bloom',
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return material.userData[BloomPlugin.PluginType]?.enable ?? true
                    },
                    set value(v) {
                        let data = material.userData[BloomPlugin.PluginType]
                        if (v === data?.enable) return
                        if (!data) data = BloomPlugin.AddBloomData(material, undefined, false)!
                        data.enable = v
                        material.setDirty()
                        config.uiRefresh?.(true, 'postFrame')
                    },
                    onChange: this.setDirty,
                },
            ],
        }
        return config
    }
}

@uiFolderContainer('Bloom Pass')
export class BloomPluginPass<Tid extends IPassID> extends ExtendedShaderPass implements IPipelinePass<Tid> {
    uiConfig?: UiObjectConfig = undefined
    before = ['screen']
    after = ['render', 'progressive']
    required = ['render']
    public readonly passId: Tid

    constructor(pid: Tid, maxIntensity = 16) {
        super({
            vertexShader: CopyShader.vertexShader,
            defines: {
                ['PASS_STEP']: 1,
                ['MAX_INTENSITY']: Math.min(maxIntensity, 16),
            },
            uniforms: {
                tSource: {value: null},
                tDiffuse: {value: null},
                // intensity: {value: 0.2},
                opacity: {value: 1.0},
                // prefilter: {value: new Vector4(1, 0.5, 0, 0)},
                tDiffuseSize: {value: new Vector2()},
                weight: {value: 1},
                // tNormalDepth: {value: null},
                // tGBufferFlags: {value: null},
            },
            fragmentShader: hdrBloom,
        }, 'tDiffuse', 'tSource')
        this.passId = pid
        this._updateWeights = this._updateWeights.bind(this)
        this._thresholdsUpdated = this._thresholdsUpdated.bind(this)
        this._updateWeights()
        this._thresholdsUpdated()
        this.clear = true

        // for tweakpane UI. todo: check if required and why
        // ;(this as any).userData = {setDirty: ()=>{
        //         this.setDirty()
        //     }}

    }

    @uniform() prefilter = new Vector4(2, 0.5, 0, 0)

    @uiSlider('Threshold', [0, 2])
    @onChange(BloomPluginPass.prototype._thresholdsUpdated)
    @serialize() threshold = 2

    @uiSlider('Soft Threshold', [0, 1])
    @onChange(BloomPluginPass.prototype._thresholdsUpdated)
    @serialize() softThreshold = 0.5

    @uiSlider('Intensity', [0, 3])
    @serialize() @uniform() intensity = 0.2

    @uiToggle('Background Bloom')
    @serialize()
    @matDefineBool('BACKGROUND_BLOOM')
        backgroundBloom = false

    @uiSlider('Iterations', [2, 7], 1)
    @onChange2(BloomPluginPass.prototype._updateWeights)
    @serialize() bloomIterations = 4

    private _currentIterations = 0 // could be less than bloomIterations based on canvas size

    @uiSlider('Radius', [0, 1], 0.01)
    @onChange2(BloomPluginPass.prototype._updateWeights)
    @serialize() radius = 0.6

    @uiSlider('Power', [0.2, 10], 0.01)
    @onChange2(BloomPluginPass.prototype._updateWeights)
    @serialize() power = 1

    private _thresholdsUpdated() {
        this.prefilter.x = this.threshold
        this.prefilter.y = this.softThreshold
        this.prefilter.z = 2 * this.prefilter.x * this.prefilter.y
        this.prefilter.w = this.uniforms?.prefilter ? .125 / (this.uniforms.prefilter.value.z + 0.00001) : 0
    }

    @uiToggle('Debug')
        bloomDebug = false

    private _weights: any = []

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget | null, readBuffer?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        const renderManager = renderer.renderManager
        // prefilter
        this.material.defines.PASS_STEP = 0

        this.clear = true

        this.needsSwap = false

        const source = readBuffer
        if (!source) {
            console.warn('BloomPluginPass: No source to read from')
            return
        }
        this.needsSwap = true

        let sizeMultiplier = 0.5 // todo are we starting with 0.25? this should be 1 maybe? but more memory...
        let width = source.width * sizeMultiplier
        let height = source.height * sizeMultiplier
        const textures: any[] = []
        let currentDestination = renderManager.getTempTarget({sizeMultiplier: 1, type: HalfFloatType}) as any as WebGLRenderTarget
        textures.push(currentDestination)
        let currentSource = source
        this.material.needsUpdate = true
        this.material.uniforms.weight.value = this._weights[0]


        super.render(renderer, currentDestination, currentSource, deltaTime, maskActive)

        currentSource = currentDestination

        const ci = this._currentIterations

        let i = 1
        const iter = Math.max(2, this.bloomIterations)
        for (; i < iter; i++) {
            width /= 2
            height /= 2
            sizeMultiplier /= 2
            if (height < 2 || width < 2) {
                break
            }
            currentDestination = renderManager.getTempTarget({sizeMultiplier, type: HalfFloatType}) as any as WebGLRenderTarget
            textures.push(currentDestination)

            this.material.defines.PASS_STEP = 1

            let modifiedWeight = this._weights[i]
            // if(i > 1)
            {
                modifiedWeight = this._weights[i - 1] !== 0 ? this._weights[i] / this._weights[i - 1] : this._weights[i]
            }
            this.material.uniforms.weight.value = modifiedWeight
            this.material.needsUpdate = true
            super.render(renderer, currentDestination, currentSource, deltaTime, maskActive)

            currentSource = currentDestination
            this._currentIterations = i + 1
        }

        // console.log(this._currentIterations)

        if (ci !== this._currentIterations)
            this._updateWeights(false)

        this.clear = false

        const oldAutoClear = renderer.autoClear
        renderer.autoClear = false
        for (i -= 2; i >= 0; i--) {
            currentDestination = textures[i]
            textures[i] = undefined

            this.material.defines.PASS_STEP = 2
            this.material.transparent = true
            this.material.blending = AdditiveBlending
            // this.material.blendSrc = OneFactor;
            // this.material.blendDst = OneFactor;
            this.material.needsUpdate = true
            renderer.autoClear = false
            super.render(renderer, currentDestination, currentSource, deltaTime, maskActive)
            this.material.blending = NoBlending

            renderManager.releaseTempTarget(currentSource as any)

            currentSource = currentDestination
        }

        this.clear = true

        renderer.autoClear = oldAutoClear

        renderer.autoClear = true

        if (this.bloomDebug) {
            this.material.defines.PASS_STEP = 4
            this.material.needsUpdate = true
            super.render(renderer, writeBuffer, currentSource, deltaTime, maskActive)
        } else {
            this.uniforms.tSource.value = source.texture
            this.material.defines.PASS_STEP = 3
            this.material.needsUpdate = true
            super.render(renderer, writeBuffer, currentSource, deltaTime, maskActive)
            this.uniforms.tSource.value = null
        }
        renderManager.releaseTempTarget(currentSource as any)
    }

    private _updateWeights(setDirty = true) {
        if (!this._weights) return // for first time onChange.
        const radius = Math.max(Math.min(this.radius, 1), 0)
        const iter = Math.max(2, this._currentIterations || this.bloomIterations)
        const delta = 1 / (iter - 1)
        for (let i = 0; i < iter; i++) {
            let f = i * delta + 0.1
            let oneMinusF = 1.2 - f
            f = Math.pow(f, this.power)
            oneMinusF = Math.pow(oneMinusF, this.power)
            this._weights[i] = oneMinusF * (1 - radius) + f * radius
        }
        if (setDirty !== false) this.setDirty()
    }

}

declare module 'threepipe' {
    interface IMaterialUserData {
        [BloomPlugin.PluginType]?: {
            enable?: boolean
        }
    }
}
