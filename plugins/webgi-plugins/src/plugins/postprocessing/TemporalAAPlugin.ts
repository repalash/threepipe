import {
    Camera,
    CopyShader,
    ExtendedShaderPass,
    GBufferPlugin,
    generateUiConfig,
    getOrCall,
    ICamera,
    IPassID,
    IPipelinePass,
    IRenderManager,
    IScene,
    IWebGLRenderer,
    matDefineBool,
    MaterialExtension,
    Matrix4,
    PipelinePassPlugin,
    ProgressivePlugin,
    serialize,
    ThreeViewer,
    uiConfig,
    UiObjectConfig,
    uiToggle,
    uiVector,
    uniform,
    ValOrFunc,
    Vector2,
    WebGLRenderTarget,
} from 'threepipe'
import {getShaders} from "../../utils/shaders";

const passId = 'taa'
type TemporalAAPassId = typeof passId

/**
 * Temporal Anti-Aliasing Plugin
 *
 * This plugin uses a temporal anti-aliasing pass to smooth out the final image when the camera or some mesh is moving
 * @category Plugins
 */
export class TemporalAAPlugin
    extends PipelinePassPlugin<TemporalAAPluginPass<TemporalAAPassId>, TemporalAAPassId> {
    static readonly PluginType = 'TAA'
    static readonly OldPluginType = 'TemporalAAPlugin' // todo swap
    readonly passId = passId

    // readonly materialExtension: MaterialExtension = uiConfigMaterialExtension(this._getUiConfig.bind(this), TemporalAAPlugin.PluginType)

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this.setDirty = this.setDirty.bind(this)
    }


    private _stableNoise = true
    /**
     * Same as BaseRenderer.stableNoise Use total frame count, if this is set to true, then frameCount won't be reset when the viewer is set to dirty.
     * Which will generate different random numbers for each frame during postprocessing steps. With TAA set properly, this will give a smoother result.
     */
    @uiToggle('Stable Noise (Total frame count)')
    get stableNoise(): boolean {
        return this._viewer?.renderManager.stableNoise ?? this._stableNoise
    }
    set stableNoise(v: boolean) {
        if (this._viewer) this._viewer.renderManager.stableNoise = v
        this._stableNoise = v
    }

    @uiConfig(undefined, {unwrapContents: true}) declare protected _pass?: TemporalAAPluginPass<TemporalAAPassId>

    private _gbufferUnpackExtension = undefined as MaterialExtension|undefined
    private _gbufferUnpackExtensionChanged = ()=>{
        if (!this._pass || !this._viewer) throw new Error('TemporalAAPlugin: pass/viewer not created yet')
        const newExtension = this._viewer.renderManager.gbufferUnpackExtension
        if (this._gbufferUnpackExtension === newExtension) return
        if (this._gbufferUnpackExtension) this._pass.material.unregisterMaterialExtensions([this._gbufferUnpackExtension])
        this._gbufferUnpackExtension = newExtension
        if (this._gbufferUnpackExtension) this._pass.material.registerMaterialExtensions([this._gbufferUnpackExtension])
        else this._viewer.console.warn('TemporalAAPlugin: GBuffer unpack extension removed')
    }

    protected _createPass() {
        if (!this._viewer) throw new Error('TemporalAAPlugin: viewer not set')
        if (!this._viewer.renderManager.gbufferTarget || !this._viewer.renderManager.gbufferUnpackExtension)
            throw new Error('TemporalAAPlugin: GBuffer target not created. GBufferPlugin is required.')
        const applyOnBackground = !!this._viewer.renderManager.msaa
        const t = new TemporalAAPluginPass(this.passId, ()=>this._viewer?.getPlugin(ProgressivePlugin)?.target, applyOnBackground)
        return t
    }

    dependencies = [GBufferPlugin, ProgressivePlugin] // todo use gbufferUnpackExtension from render manager to support depth buffer plugin as well.

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this._gbufferUnpackExtensionChanged()
        viewer.renderManager.addEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        viewer.renderManager.addEventListener('resize', this._pass!.onSizeUpdate)
        // viewer.materialManager.registerMaterialExtension(this.materialExtension)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.renderManager.removeEventListener('gbufferUnpackExtensionChanged', this._gbufferUnpackExtensionChanged)
        viewer.renderManager.removeEventListener('resize', this._pass!.onSizeUpdate)
        super.onRemove(viewer)
        // viewer.materialManager.unregisterMaterialExtension(this.materialExtension)
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'TemporalAA Plugin',
        onChange: this.setDirty.bind(this),
        children: [
            ...generateUiConfig(this) || [],
        ],
    }

    protected _beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager): boolean {
        if (!super._beforeRender(scene, camera, renderManager)) return false
        const pass = this.pass
        const v = this._viewer
        if (!pass || !v) return false

        const frame = renderManager.frameCount
        pass.taaEnabled = frame <= 1 && scene.renderCamera === scene.mainCamera
        if (!pass.taaEnabled) return false

        const cam = camera
        if (!cam) return false

        cam.updateMatrixWorld(true)

        cam.updateShaderProperties(pass.material) // for cameraNearFar

        pass.updateCameraProperties(cam)

        pass.target = v.getPlugin(ProgressivePlugin)!.target as any
        return true
    }

    // region to be done or removed

    // static AddTemporalAAData(material: IMaterial, params?: IMaterialUserData['TemporalAA'], setDirty = true): IMaterialUserData['TemporalAA']|null {
    //     const ud = material?.userData
    //     if (!ud) return null
    //     if (!ud[TemporalAAPlugin.PluginType]) {
    //         ud[TemporalAAPlugin.PluginType] = {}
    //     }
    //     const data = ud[TemporalAAPlugin.PluginType]!
    //     data.enable = true
    //     params && Object.assign(data, params)
    //     if (setDirty && material.setDirty) material.setDirty()
    //     return data
    // }

    /**
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    // private _getUiConfig(material: IMaterial) {
    //     const config: UiObjectConfig = {
    //         type: 'folder',
    //         label: 'TemporalAA',
    //         children: [
    //             {
    //                 type: 'checkbox',
    //                 label: 'Enabled',
    //                 get value() {
    //                     return material.userData[TemporalAAPlugin.PluginType]?.enable ?? true
    //                 },
    //                 set value(v) {
    //                     let data = material.userData[TemporalAAPlugin.PluginType]
    //                     if (v === data?.enable) return
    //                     if (!data) data = TemporalAAPlugin.AddTemporalAAData(material, undefined, false)!
    //                     data.enable = v
    //                     material.setDirty()
    //                     config.uiRefresh?.(true, 'postFrame')
    //                 },
    //                 onChange: this.setDirty,
    //             },
    //         ],
    //     }
    //     return config
    // }

    // endregion
}

export class TemporalAAPluginPass<Tid extends IPassID> extends ExtendedShaderPass implements IPipelinePass<Tid> {
    before = ['progressive']
    after = [] // leave empty so that this is placed right before progressive
    required = ['render', 'progressive']

    public target: ValOrFunc<WebGLRenderTarget|undefined>
    public readonly passId: Tid

    constructor(pid: Tid, target: ValOrFunc<WebGLRenderTarget|undefined>, applyOnBackground = false) {
        super({
            vertexShader: CopyShader.vertexShader,
            fragmentShader: getShaders().temporalAA,
            uniforms: {
                currentRT: {value: null},
                previousRT: {value: null},
                previousRTSize: {value: new Vector2()},
                cameraNearFar: {value: new Vector2()},
                lastProjectionViewMatrix: {value: new Matrix4()},
                currentProjectionViewMatrix: {value: new Matrix4()},
                projection: {value: new Matrix4()},
                inverseViewMatrix: {value: new Matrix4()},
                jitterSample: {value: new Vector2()},
                firstFrame: {value: true},
            },
            defines: {
                ['QUALITY']: 1,
                ['UNJITTER']: 0,
                ['BACKGROUND_TAA']: applyOnBackground ? 1 : 0,
            },

        }, 'currentRT', 'previousRT')
        this.passId = pid
        this.onSizeUpdate = this.onSizeUpdate.bind(this)
        this.target = target
        this.clear = false
        this.needsSwap = true

    }

    /**
     * to switch with ssaa, for internal use only, dont set from outside
     */
    taaEnabled = true

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget | null, readBuffer?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        if (!this.taaEnabled || !this.enabled) {
            this.needsSwap = false
            return
        }
        this.needsSwap = true

        this.uniforms.previousRT.value = getOrCall(this.target)?.texture ?? null

        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)

        // ;(renderer as any).baseRenderer.blit(writeBuffer.texture, this.target, {clear: false}) // this is done in the progressive plugin

        this.uniforms.lastProjectionViewMatrix.value.copy(this.uniforms.currentProjectionViewMatrix.value)

        this.uniforms.firstFrame.value = false

    }


    updateCameraProperties(camera?: Camera): void {
        if (!camera) return
        this.uniforms.currentProjectionViewMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        // this.uniforms.lastProjectionViewMatrix.value.copy(this.lastProjectionViewMatrix_)
        // this.uniforms.ProjectionMatrix.value.copy(this.projectionMatrix_)
        this.uniforms.inverseViewMatrix.value.copy(camera.matrixWorld)
    }
    onSizeUpdate() {
        this.uniforms.firstFrame.value = true
        this.setDirty()
    }
    setSize(width: number, height: number) {
        super.setSize(width, height)
        this.onSizeUpdate()
    }

    @serialize() @uniform()
    @uiVector('Feedback', undefined, 0.0001)
        feedBack: Vector2 = new Vector2(0.88, 0.97)

    @uiToggle()
    @matDefineBool('DEBUG_VELOCITY', undefined, false, undefined, true)
        debugVelocity = false

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Temporal AA Pass',
        onChange: this.setDirty,
        children: [
            {
                type: 'checkbox',
                label: 'Enabled',
                property: [this, 'enabled'],
                onChange: ()=>this.onSizeUpdate(),
            },
            ...generateUiConfig(this)?.filter(c=>c && (c as any).label !== 'Enabled') || [],
        ],
    }

}

declare module 'threepipe' {
    // interface IMaterialUserData {
        // [TemporalAAPlugin.PluginType]?: {
        //     enable?: boolean
        // }
    // }
}
