import {
    bindToValue,
    Color,
    CreateRenderTargetOptions,
    ExtendedShaderMaterial,
    ExtendedShaderPass,
    FrameFadePlugin,
    GBufferPlugin,
    generateUiConfig,
    HalfFloatType,
    ICamera,
    IPassID,
    IPipelinePass,
    IRenderManager,
    IScene,
    IViewerEvent,
    IViewerPlugin,
    IWebGLRenderer,
    LinearSRGBColorSpace,
    NearestFilter,
    now,
    PickingPlugin,
    PipelinePassPlugin,
    RGBAFormat,
    serialize,
    shaderUtils,
    ThreeViewer,
    uiFolderContainer,
    UiObjectConfig,
    uiSlider,
    uiToggle,
    uniform,
    Vector2,
    Vector3,
    WebGLRenderTarget,
} from 'threepipe'
import dofCombine from './shaders/dofCombine.glsl'
// import dofBlurBox from './shaders/dofBlurBox.glsl'
import dofPoissonBox from './shaders/dofPoissonBox.glsl'
import poissonDiskSamples from './shaders/poissonDiskSamples.glsl'
import dofComputeCoC from './shaders/dofComputeCoC.glsl'
import dofExpandCoC from './shaders/dofExpandCoC.glsl'

const passId = 'depthOfField'
type DepthOfFieldPassId = typeof passId

/**
 * Depth Of Field Plugin
 *
 * Adds a depth of field effect with configurable focal point.
 * @category Plugins
 */
export class DepthOfFieldPlugin
    extends PipelinePassPlugin<DepthOfFieldPluginPass<DepthOfFieldPassId>, DepthOfFieldPassId> {
    static readonly PluginType = 'DepthOfField'
    static readonly OldPluginType = 'DepthOfFieldPlugin' // todo swap
    readonly passId = passId

    @serialize()
    @uiToggle()
        enableEdit = false

    @serialize('focalPoint') // todo uiConfig
    protected _focalPointHit: Vector3 = new Vector3(0, 0, 0)

    @serialize()
        crossFadeTime = 200 // ms

    // readonly materialExtension: MaterialExtension = uiConfigMaterialExtension(this._getUiConfig.bind(this), DepthOfFieldPlugin.PluginType)

    private _focalPointHitTime = 0

    protected get _frameFadeTime() { return this.crossFadeTime * 2.5 } // ms

    constructor(enabled = true, enableEdit = false) {
        super()
        this.enabled = enabled
        this.enableEdit = enableEdit
        this._onObjectHit = this._onObjectHit.bind(this)
        this.setDirty = this.setDirty.bind(this)
    }

    // todo make this a property.
    setFocalPoint(p: Vector3, fade = true, showGizmo = false) {
        this._focalPointHit.copy(p)
        if (fade) this._viewer?.getPlugin<FrameFadePlugin>('FrameFadePlugin')?.startTransition(this._frameFadeTime)
        if (showGizmo) this._focalPointHitTime = now()
        this.setDirty()
    }
    getFocalPoint() {
        return this._focalPointHit
    }

    protected _onObjectHit(e: any) {
        if (!this._pass || !e.intersects.intersect || this.isDisabled() || !this.enableEdit) return
        this._focalPointHit.copy(e.intersects.intersect.point)
        this._focalPointHitTime = e.time
        e.intersects.selectedObject = null // this will prevent ObjectPicker to select the object
        this._viewer?.getPlugin(FrameFadePlugin)?.startTransition(this._frameFadeTime)
        this.setDirty()
    }

    protected _createPass() {
        const pass = new DepthOfFieldPluginPass(this.passId)
        return pass
    }

    dependencies = [GBufferPlugin] // todo use gbufferUnpackExtension from render manager to support depth buffer plugin as well.

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.addEventListener('addPlugin', this._onPluginAdd)
        viewer.addEventListener('removePlugin', this._onPluginRemove)
        this._onPluginAdd({plugin: viewer.getPlugin(GBufferPlugin)})
        this._onPluginAdd({plugin: viewer.getPlugin(PickingPlugin)})
        // viewer.materialManager.registerMaterialExtension(this.materialExtension)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('addPlugin', this._onPluginAdd)
        viewer.removeEventListener('removePlugin', this._onPluginRemove)
        this._onPluginRemove({plugin: viewer.getPlugin(GBufferPlugin)})
        this._onPluginRemove({plugin: viewer.getPlugin(PickingPlugin)})
        super.onRemove(viewer)
        // viewer.materialManager.unregisterMaterialExtension(this.materialExtension)
    }
    private _onPluginAdd = (e: {plugin?: IViewerPlugin} & Partial<IViewerEvent>)=>{ // not really required since gbuffer is now a dependency
        const plugin = e.plugin
        if (!plugin) return
        if (plugin.constructor?.PluginType === GBufferPlugin.PluginType) {
            const gbuffer = plugin as GBufferPlugin
            // gbuffer.registerGBufferUpdater(this.constructor.PluginType, this.updateGBufferFlags.bind(this))
            this._pass?.material.registerMaterialExtensions([gbuffer.unpackExtension])
            this._pass?.computeCocMaterial.registerMaterialExtensions([gbuffer.unpackExtension])
            this._pass?.expandCocMaterial.registerMaterialExtensions([gbuffer.unpackExtension])
        }
        if (plugin.constructor?.PluginType === PickingPlugin.PluginType) {
            const picking = plugin as PickingPlugin
            picking.addEventListener('hitObject', this._onObjectHit)
        }
    }
    private _onPluginRemove = (e: {plugin?: IViewerPlugin} & Partial<IViewerEvent>)=>{ // not really required since gbuffer is now a dependency
        const plugin = e.plugin
        if (!plugin) return
        if (plugin.constructor?.PluginType === GBufferPlugin.PluginType) {
            const gbuffer = e.plugin as GBufferPlugin
            // gbuffer.unregisterGBufferUpdater(this.constructor.PluginType)
            this._pass?.material.unregisterMaterialExtensions([gbuffer.unpackExtension])
            this._pass?.computeCocMaterial.unregisterMaterialExtensions([gbuffer.unpackExtension])
            this._pass?.expandCocMaterial.unregisterMaterialExtensions([gbuffer.unpackExtension])
        }
        if (plugin.constructor?.PluginType === PickingPlugin.PluginType) {
            const picking = e.plugin as PickingPlugin
            picking.removeEventListener('hitObject', this._onObjectHit)
        }
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'DepthOfField',
        onChange: this.setDirty.bind(this),
        children: [
            ...generateUiConfig(this) || [],
            ()=>this._pass?.uiConfig,
        ],
    }

    private _tempVec = new Vector3()
    protected _beforeRender(scene: IScene, camera: ICamera, renderManager: IRenderManager): boolean {
        if (!super._beforeRender(scene, camera, renderManager)) return false
        const pass = this.pass
        if (!pass) return false

        if (pass.dofBlurMaterial.uniforms.frameCount) // blur mat could change.
            renderManager?.updateShaderProperties(pass.dofBlurMaterial)

        const cam = camera
        if (!cam) return false

        cam.updateMatrixWorld(true)

        cam.updateShaderProperties(pass.material) // for cameraNearFar

        cam.getWorldPosition(this._tempVec)
        this._tempVec.subVectors(this._focalPointHit, this._tempVec)

        pass.focalDepthRange.x = this._tempVec.length()
        pass.focalDepthRange.x *= cam.getWorldDirection(new Vector3()).dot(this._tempVec.normalize())

        let crossAlpha = (now() - this._focalPointHitTime) / this.crossFadeTime
        crossAlpha = 1. - Math.min(1, Math.max(0, crossAlpha))
        if (Math.abs(crossAlpha - pass.crossAlpha) > 0.01) {
            pass.crossAlpha = crossAlpha
            this.setDirty()
        }
        if (crossAlpha > 0) {
            const projectedPoint = this._tempVec.copy(this._focalPointHit).project(cam).addScalar(1).divideScalar(2)
            pass.crossCenter.set(projectedPoint.x, projectedPoint.y)

            pass.computeCocMaterial.uniformsNeedUpdate = true // for cameraNearFar
            pass.expandCocMaterial.uniformsNeedUpdate = true
        }
        return true
    }

    // region to be done or removed

    // static AddDepthOfFieldData(material: IMaterial, params?: IMaterialUserData['DepthOfField'], setDirty = true): IMaterialUserData['DepthOfField']|null {
    //     const ud = material?.userData
    //     if (!ud) return null
    //     if (!ud[DepthOfFieldPlugin.PluginType]) {
    //         ud[DepthOfFieldPlugin.PluginType] = {}
    //     }
    //     const data = ud[DepthOfFieldPlugin.PluginType]!
    //     data.enable = true
    //     params && Object.assign(data, params)
    //     if (setDirty && material.setDirty) material.setDirty()
    //     return data
    // }

    // updateGBufferFlags(data: Vector4, c: GBufferUpdaterContext): void {
    //     if (!c.material || !c.material.userData) return
    //     const disabled = c.material.userData[DepthOfFieldPlugin.PluginType]?.enable === false ||
    //         c.material.userData.pluginsDisabled
    //     const x = disabled ? 0 : 1
    //     data.w = updateBit(data.w, 4, x)
    // }

    /*
        get depthRange() {
            return this.pass?.focalDepthRange.y ?? 0
        }

        set depthRange(v: number) {
            if (this.pass) this.pass.focalDepthRange.y = v
            this.setDirty()
        }

        get nearBlurScale() {
            return this.pass?.nearFarBlurScale.x ?? 0
        }
        set nearBlurScale(v: number) {
            if (this.pass) this.pass.nearFarBlurScale.x = v
            this.setDirty()
        }

        get farBlurScale() {
            return this.pass?.nearFarBlurScale.y ?? 0
        }
        set farBlurScale(v: number) {
            if (this.pass) this.pass.nearFarBlurScale.y = v
            this.setDirty()
        }
    */

    /**
     * This uiConfig is added to each material by extension
     * @param material
     * @private
     */
    // private _getUiConfig(material: IMaterial) {
    //     const config: UiObjectConfig = {
    //         type: 'folder',
    //         label: 'DepthOfField',
    //         children: [
    //             {
    //                 type: 'checkbox',
    //                 label: 'Enabled',
    //                 get value() {
    //                     return material.userData[DepthOfFieldPlugin.PluginType]?.enable ?? true
    //                 },
    //                 set value(v) {
    //                     let data = material.userData[DepthOfFieldPlugin.PluginType]
    //                     if (v === data?.enable) return
    //                     if (!data) data = DepthOfFieldPlugin.AddDepthOfFieldData(material, undefined, false)!
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

// const dofBlurMaterialBox = new ExtendedShaderMaterial({
//     uniforms: {
//         cocTexture: {value: null},
//         colorTexture: {value: null},
//         colorTextureSize: {value: new Vector2()},
//         direction: {value: new Vector2()},
//     },
//     vertexShader: shaderUtils.defaultVertex,
//     fragmentShader:  dofBlurBox,
// }, ['colorTexture', 'cocTexture'])
const dofBlurMaterialPoisson = new ExtendedShaderMaterial({
    uniforms: {
        colorTexture: {value: null},
        colorTextureSize: {value: new Vector2()},
        direction: {value: new Vector2()},
        frameCount: {value: 0},
        blurRadius: {value: 16},
    },
    vertexShader: shaderUtils.defaultVertex,
    fragmentShader: poissonDiskSamples + '\n' + dofPoissonBox,
    defines: {
        ['DOF_MODE']: 1,
    },
}, ['colorTexture'])

@uiFolderContainer('DepthOfField Pass')
export class DepthOfFieldPluginPass<Tid extends IPassID> extends ExtendedShaderPass implements IPipelinePass<Tid> {
    uiConfig?: UiObjectConfig = undefined
    before = ['progressive', 'screen']
    after = ['render']
    required = ['render']

    public computeCocMaterial: ExtendedShaderMaterial
    public expandCocMaterial: ExtendedShaderMaterial
    public dofBlurMaterial: ExtendedShaderMaterial = dofBlurMaterialPoisson
    // public dofBlurMaterialBox: ShaderMaterialEncodingSupport = dofBlurMaterialBox

    @bindToValue({obj: 'focalDepthRange', key: 'y'})
    @uiSlider('Depth Range', [0.25, 3])
        depthRange: number

    @bindToValue({obj: 'nearFarBlurScale', key: 'x'})
    @uiSlider('Near Blur Scale', [0, 1])
        nearBlurScale: number

    @bindToValue({obj: 'nearFarBlurScale', key: 'y'})
    @uiSlider('Far Blur Scale', [0, 1])
        farBlurScale: number

    @serialize()
    @uniform() nearFarBlurScale = new Vector2(0.25, 0.25)
    @serialize()
    @uniform() focalDepthRange = new Vector2(0.5, 1.5)

    @uniform() crossCenter = new Vector2(0.5, 0.5)

    @uniform() crossRadius = 0.04
    @uniform() crossAlpha = 1
    @uniform() crossColor = new Color(0xff9900)
    public readonly passId: Tid

    constructor(pid: Tid) {
        super({
            uniforms: {
                colorTexture: {value: null},
                blurTexture: {value: null},
                cocTexture: {value: null},
                cocTextureSize: {value: new Vector2()},
                cameraNearFar: {value: new Vector2()},
            },
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: dofCombine,
        }, 'colorTexture', 'cocTexture', 'blurTexture')
        this.passId = pid

        this.computeCocMaterial = new ExtendedShaderMaterial({
            uniforms: {
                colorTexture: {value: null},
                cameraNearFar: this.uniforms.cameraNearFar,
                nearFarBlurScale: this.uniforms.nearFarBlurScale,
                focalDepthRange: this.uniforms.focalDepthRange,
            },
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: dofComputeCoC,
        }, ['colorTexture'])
        // this.computeCocMaterial.uniforms.NearFarBlurScale.value.copy(this.nearFarBlurScale_)

        this.expandCocMaterial = new ExtendedShaderMaterial({
            uniforms: {
                colorTexture: {value: null},
                colorTextureSize: {value: new Vector2()},
                direction: {value: new Vector2()},
                nearFarBlurScale: this.uniforms.nearFarBlurScale,
            },
            vertexShader: shaderUtils.defaultVertex,
            fragmentShader: dofExpandCoC,
        }, ['colorTexture'])

        // todo
        // this.clear = true

    }

    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget | null, readBuffer?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        if (!this.enabled) return
        if (!readBuffer) {
            console.error('DepthOfFieldPluginPass: No readBuffer')
            return
        }
        const renderManager = renderer.renderManager

        // const oldClearColor = renderer.getClearColor(new Color())
        // const oldClearAlpha = renderer.getClearAlpha()
        // const oldAutoClear = renderer.autoClear
        // renderer.autoClear = true

        const halfPars: CreateRenderTargetOptions = {
            minFilter: NearestFilter, magFilter: NearestFilter,
            // type: UnsignedByteType,
            // encoding: RGBM16Encoding,
            type: HalfFloatType,
            // encoding: LinearEncoding,
            colorSpace: LinearSRGBColorSpace,
            sizeMultiplier: 0.5,
            // samples: 1,
            format: RGBAFormat,
            depthBuffer: false,
            generateMipmaps: false,
        }

        const cocRt = renderManager.getTempTarget(halfPars)
        const renderTargetBlurTemp = renderManager.getTempTarget(halfPars)

        // 1. Downsample the Original texture, and store coc in the alpha channel
        this.computeCocMaterial.uniforms.colorTexture.value = readBuffer.texture
        renderManager.blit(cocRt, {material: this.computeCocMaterial})

        // 2. Blur Near field coc
        this.expandCocMaterial.uniforms.colorTexture.value = cocRt.texture
        this.expandCocMaterial.uniforms.direction.value.set(1, 0)
        renderManager.blit(renderTargetBlurTemp, {material: this.expandCocMaterial})
        this.expandCocMaterial.uniforms.colorTexture.value = renderTargetBlurTemp.texture
        this.expandCocMaterial.uniforms.direction.value.set(0, 1)
        renderManager.blit(cocRt, {material: this.expandCocMaterial})

        // 3. Blur Dof
        // if (this.dofBlurType_ === 1) {
        if (this.dofBlurMaterial.uniforms.frameCount) {
            this.dofBlurMaterial.uniforms.colorTexture.value = cocRt.texture
            renderManager.blit(renderTargetBlurTemp, {material: this.dofBlurMaterial})
        } else {
            const renderTargetBlurTemp2 = renderManager.getTempTarget(halfPars)
            this.dofBlurMaterial.uniforms.cocTexture.value = cocRt.texture
            this.dofBlurMaterial.uniforms.colorTexture.value = cocRt.texture
            this.dofBlurMaterial.uniforms.direction.value.set(1, 0)
            renderManager.blit(renderTargetBlurTemp2, {material: this.dofBlurMaterial})
            this.dofBlurMaterial.uniforms.colorTexture.value = renderTargetBlurTemp2.texture
            this.dofBlurMaterial.uniforms.direction.value.set(0, 1)
            renderManager.blit(renderTargetBlurTemp, {material: this.dofBlurMaterial})
            renderManager.releaseTempTarget(renderTargetBlurTemp2)
        }

        // 4. Dof Combine
        this.material.uniforms.blurTexture.value = renderTargetBlurTemp.texture
        this.material.uniforms.cocTexture.value = cocRt.texture
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)

        renderManager.releaseTempTarget(cocRt)
        renderManager.releaseTempTarget(renderTargetBlurTemp)

    }

}

// declare module 'threepipe' {
//     interface IMaterialUserData {
// [DepthOfFieldPlugin.PluginType]?: {
//     enable?: boolean
// }
// }
// }
