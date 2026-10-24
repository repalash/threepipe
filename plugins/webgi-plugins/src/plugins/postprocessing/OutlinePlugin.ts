import {
    animateTarget,
    AScreenPassExtensionPlugin,
    Color,
    DoubleSide,
    GBufferPlugin,
    getOrCall,
    glsl,
    ICamera, IGeometry,
    IMaterial,
    IObject3D,
    IPassID,
    IPipelinePass,
    IRenderManager,
    IScene, ITexture,
    IUniform,
    IWebGLRenderer,
    matDefineBool,
    onChange,
    PickingPlugin,
    RenderPass, SelectionObject, SelectionObjectArr,
    serialize,
    ShaderMaterial,
    Texture,
    TextureDataType,
    ThreeViewer,
    uiColor,
    uiFolderContainer,
    uiImage,
    UiObjectConfig,
    uiSlider,
    uiToggle,
    uniform,
    UnsignedByteType,
    ValOrFunc,
    Vector2,
    WebGLRenderTarget,
} from 'threepipe'
import outlineShader from './shaders/outline.glsl'
import outlineDepthVertex from './shaders/outlineDepthVert.glsl'
import outlineDepthFrag from './shaders/outlineDepthFrag.glsl'

export type OutlinePluginTarget = WebGLRenderTarget
export type OutlinePluginPass = OutlineRenderPass<'outline', OutlinePluginTarget | undefined >

/**
 * Outline Plugin
 * Adds an extension to {@link ScreenPass} material and a RenderPass to render the outlines and highlights of the selected objects.
 * It interfaces with the {@link PickingPlugin} to render the outlines of the selected objects.
 * The intensity, thickness, etc of the effect can be controlled with the `intensity`(previously outlineIntensity), `thickness` etc properties.
 *
 * @category Plugins
 */
@uiFolderContainer('Selection Outline')
export class OutlinePlugin extends AScreenPassExtensionPlugin {
    readonly passId = 'outline'
    static readonly PluginType = 'OutlinePlugin'
    static readonly OldPluginType = 'Outline'

    readonly extraUniforms = {
        outlineIntensity: {value: 1},
        outlineThickness: {value: 2},
        highlightTransparency: {value: 1},
        outlineColor: {value: new Color(0xe98a65)},
        enableHighlight: {value: true},
        dpr: {value: 1} as IUniform<number>,

        outlineBuffer: {value: null},
        tDiffuseSize: {value: new Vector2(1024, 1024)},
    } as const
    extraDefines = {
        ['DEBUG_OUTLINE']: '0',
    } as const

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end.
     */
    priority = -101

    @onChange(OutlinePlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled: boolean

    @uiToggle('Highlight')
    @uniform({propKey: 'enableHighlight'})
    @serialize() enableHighlight = false

    @onChange(OutlinePlugin.prototype.setDirty)
    @uiToggle('DynamicSelection')
    @serialize() enableDynamicSelection = true

    @uiSlider('Intensity', [0., 4], 0.001)
    @uniform({propKey: 'outlineIntensity'})
    @serialize('outlineIntensity') intensity = 2

    @onChange(OutlinePlugin.prototype.setDirty)
    @uiSlider('Transparency', [0., 1], 0.01)
    @serialize() highlightTransparency = 0.84

    @uiColor('Color')
    @uniform({propKey: 'outlineColor'})
    @serialize('outlineColor') color = new Color(0xe98a65)

    @uiSlider('Thickness', [0, 10], 0.01)
    @uniform({propKey: 'outlineThickness'})
    @serialize('outlineThickness') thickness = 2

    @uiToggle('Debug')
    // todo onchange
    @matDefineBool('DEBUG_OUTLINE', undefined, true)
        debugOutline = false

    @onChange(OutlinePlugin.prototype.setDirty)
    @uiToggle('Highlight Selected Materials')
        highlightSelectedMaterials = false

    @onChange(OutlinePlugin.prototype.setDirty)
    @uiToggle('Highlight Materials (same name)')
        highlightMaterialSameNames = false

    /**
     * Highlight Transparency.
     *
     * For internal use, don't change. use {@link highlightTransparency} instead.
     */
    @uniform({propKey: 'highlightTransparency'})
        transparency = 0

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            ${outlineShader}
        `
    }

    protected _shaderPatch = 'diffuseColor = outline(diffuseColor);'

    constructor(enabled = true, bufferType: TextureDataType = UnsignedByteType) {
        super()
        this.enabled = enabled
        this.bufferType = bufferType
    }
    dependencies = [PickingPlugin, GBufferPlugin]

    private _pickingPlugin?: PickingPlugin

    private _onSelectedObjectChanged = () => {
        if (this._animationCallBack) return
        if (this._pickingPlugin?.getSelectedObject()) {
            if (this.enableDynamicSelection) {
                this.transparency = 1
                this._animationCallBack = this._startTransparencyAnimation(1, this.highlightTransparency, 400)
            } else {
                this.transparency = this.highlightTransparency
            }
        } else {
            this.transparency = 1
        }
    }

    private _onMouseMove = (e: MouseEvent) => {
        if (!this.mouseInOutAnimationEnabled) return
        if (!this.enableHighlight) return
        const selectedObject = this._pickingPlugin?.getSelectedObject()
        if (selectedObject && this.enableDynamicSelection) {
            if (e.target !== this._viewer?.canvas) {
                if (!this._animationCallBack && this._state === 'in') {
                    this._animationCallBack = this._startTransparencyAnimation(this.highlightTransparency, 1, 600)
                    this._state = 'out'
                }
            } else {
                if (!this._animationCallBack && this._state === 'out') {
                    this._animationCallBack = this._startTransparencyAnimation(1, this.highlightTransparency, 600)
                    this._state = 'in'
                }
            }
        } else {
            this.transparency = selectedObject ? this.highlightTransparency : 1
        }
    }

    private _pickingWidgetDisabled = false
    setDirty() {
        super.setDirty()
        if (!this._viewer) return
        const picking = this._viewer.getPlugin(PickingPlugin)
        let enabled = !this.isDisabled()
        if (enabled) {
            // special check for lines, as they look bad with the outline
            const selected = picking?.getSelectedObject<IObject3D>() // primary object for line check
            if (typeof selected?.type === 'string' && selected?.type?.includes('Line')) {
                enabled = false
            }
        }
        if (picking) {
            if (enabled && picking.widgetEnabled) {
                picking.widgetEnabled = false
                this._pickingWidgetDisabled = true
            } else if (!enabled && this._pickingWidgetDisabled) {
                picking.widgetEnabled = true
                this._pickingWidgetDisabled = false
            }
        }
        this._viewer.setDirty()
    }

    // @serialize('pass')
    protected _pass?: OutlinePluginPass

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.setDirty() // for picking widget

        this._pass = this._createPass()
        this._pass.onDirty?.push(viewer.setDirty)
        // this._pass.beforeRender = wrapThisFunction2(this._beforeRender, this._pass.beforeRender) // not needed at the moment
        viewer.renderManager.registerPass(this._pass)

        viewer.forPlugin(PickingPlugin, (p) => {
            this._pickingPlugin = p
            p.addEventListener('selectedObjectChanged', this._onSelectedObjectChanged)
        }, (p) => {
            p.removeEventListener('selectedObjectChanged', this._onSelectedObjectChanged)
            this._pickingPlugin = undefined
        }, this)

        document.addEventListener('mousemove', this._onMouseMove, {passive: true})
    }
    onRemove(viewer: ThreeViewer): void {
        document.removeEventListener('mousemove', this._onMouseMove)
        this._pickingPlugin?.removeEventListener('selectedObjectChanged', this._onSelectedObjectChanged)
        this._pickingPlugin = undefined
        this._animationCallBack = undefined

        this._disposeTarget()
        if (this._pass) {
            viewer.renderManager.unregisterPass(this._pass)
            if (this._pass.dispose) this._pass.dispose()
        }
        this._pass = undefined
        return super.onRemove(viewer)
    }

    target?: OutlinePluginTarget

    @uniform({propKey: 'outlineBuffer'})
    @uiImage('Outline Buffer', {readOnly: true}) texture?: Texture

    readonly material: ShaderMaterial = new ShaderMaterial({
        uniforms: {
            'cameraNearFar': {value: new Vector2(0.1, 100)},
        },
        vertexShader: outlineDepthVertex,
        fragmentShader: outlineDepthFrag,
        side: DoubleSide,
    })

    // @onChange2(OutlinePlugin.prototype._createTarget)
    // @uiDropdown('Buffer Type', threeConstMappings.TextureDataType.uiConfig)
    readonly bufferType: TextureDataType // cannot be changed after creation (for now)

    protected _createTarget(recreate = true) {
        if (!this._viewer) return
        if (recreate) this._disposeTarget()

        if (!this.target) this.target = this._viewer.renderManager.createTarget<OutlinePluginTarget>(
            {
                // depthBuffer: true,
                sizeMultiplier: 1,
                type: this.bufferType,
                // magFilter: NearestFilter,
                // minFilter: NearestFilter,
                // generateMipmaps: false,
                // colorSpace: LinearSRGBColorSpace,
            })
        this.texture = this.target.texture
        this.texture.name = 'normalBuffer'
    }
    protected _disposeTarget() {
        if (!this._viewer) return
        if (this.target) {
            this._viewer.renderManager.disposeTarget(this.target)
            this.target = undefined
        }
        this.texture = undefined
    }

    private _getSelectedObject = () => {
        if (!this._viewer) return null
        // getSelectedObjects exists since threepipe 0.5.0, older versions only have getSelectedObject
        const picking: (PickingPlugin & {getSelectedObjects?: () => SelectionObject[]}) | undefined = this._viewer.getPlugin(PickingPlugin)
        if (this.highlightSelectedMaterials) {
            const mat = picking?.getSelectedObject<IObject3D>()?.material || null
            if (this.highlightMaterialSameNames && mat) {
                const names = Array.isArray(mat) ? mat.map(m => m.name) : [mat.name]
                const mats = new Set<IMaterial>()
                for (const name of names) {
                    const mats1 = this._viewer?.assetManager?.materials?.findMaterialsByName(name)
                    mats1?.forEach(m => mats.add(m))
                }
                return [...mats]
            }
            return mat
        }
        const objects = picking ? picking.getSelectedObjects ? picking.getSelectedObjects() : [picking.getSelectedObject() || null] : null
        return objects && objects.length > 0 ? objects.length === 1 ? objects[0] : objects as SelectionObjectArr : null
    }

    protected _createPass() {
        this._createTarget(true)
        if (!this.target) throw new Error('OutlinePlugin: target not created')

        this.material.userData.isOutlinePluginMaterial = true
        const pass = new OutlineRenderPass<'outline', OutlinePluginTarget|undefined>(this.passId, this._getSelectedObject, ()=>this.target, this.material)
        return pass
    }

    protected _viewerListeners = {
        preRender: ()=>{
            if (this.isDisabled() || !this._viewer) return
            // todo directly bind to value
            this.extraUniforms.dpr.value = this._viewer.renderManager.renderScale * 2
        },
    }

    // region animation

    mouseInOutAnimationEnabled = true

    private _state = 'in'

    private _animationCallBack?: Promise<void>

    private async _startTransparencyAnimation(from: number, to: number, duration: number) {
        return animateTarget(this, 'transparency', {
            from: from,
            to: to,
            duration: duration,
            onComplete: () => {
                this._animationCallBack = undefined
            },
        })
    }

    // endregion animation

    // region deprecated

    get outlineIntensity() {
        console.warn('OutlinePlugin.outlineIntensity is deprecated, use OutlinePlugin.intensity instead')
        return this.intensity
    }
    set outlineIntensity(v) {
        console.warn('OutlinePlugin.outlineIntensity is deprecated, use OutlinePlugin.intensity instead')
        this.intensity = v
    }

    get outlineColor() {
        console.warn('OutlinePlugin.outlineColor is deprecated, use OutlinePlugin.intensity instead')
        return this.intensity
    }
    set outlineColor(v) {
        console.warn('OutlinePlugin.outlineColor is deprecated, use OutlinePlugin.intensity instead')
        this.intensity = v
    }

    // endregion deprecated
}

@uiFolderContainer<OutlineRenderPass>((c: OutlineRenderPass)=>c.passId + ' Render Pass')
export class OutlineRenderPass<TP extends IPassID=IPassID, T extends WebGLRenderTarget | undefined = WebGLRenderTarget | undefined > extends RenderPass implements IPipelinePass<TP> { // todo: extend from jittered?
    readonly isOutlineRenderPass = true
    declare uiConfig: UiObjectConfig

    @uiToggle('Enabled') enabled = true

    declare scene?: IScene
    before = ['render']
    after = ['gbuffer']
    required = ['render', 'gbuffer']

    declare overrideMaterial: ShaderMaterial

    constructor(public readonly passId: TP, private _getSelectedObjectOrMaterial: ()=>SelectionObject|SelectionObjectArr, public target: ValOrFunc<T>, overrideMaterial: ShaderMaterial) {
        super(undefined, undefined, overrideMaterial, new Color(1, 1, 1), 1)
    }

    // constructor(private _getSelectedObjectOrMaterial: ()=>SelType, public target: WebGLRenderTarget, material: Material, clearColor: Color = new Color(1, 1, 1), clearAlpha = 1) {
    //     super(undefined as any, undefined as any, material, clearColor, clearAlpha)
    // }

    /**
     * Renders to {@link target}
     * @param renderer
     * @param writeBuffer - this is ignored? or used as transmissionRenderTarget?
     * @param _1 - this is ignored
     * @param deltaTime
     * @param maskActive
     */
    render(renderer: IWebGLRenderer, writeBuffer?: WebGLRenderTarget|null, _1?: WebGLRenderTarget, deltaTime?: number, maskActive?: boolean) {
        if (!this.scene || !this.camera || !this.enabled) return

        const t = renderer.getRenderTarget()
        const activeCubeFace = renderer.getActiveCubeFace()
        const activeMipLevel = renderer.getActiveMipmapLevel()

        const selectedObject = this._getSelectedObjectOrMaterial()
        if (selectedObject) {
            this._renderSelectedObject(renderer, selectedObject, writeBuffer || null, deltaTime, maskActive)
        } else {
            renderer.setRenderTarget(getOrCall(this.target) || null)
            const color = new Color()
            renderer.getClearColor(color)
            renderer.setClearColor(new Color(0xffffff))
            renderer.clear(true, true)
            renderer.setClearColor(color)
        }

        renderer.setRenderTarget(t, activeCubeFace, activeMipLevel)
    }

    private _renderSelectedObject(renderer: IWebGLRenderer, selectedObject: SelectionObject|SelectionObjectArr, writeBuffer: WebGLRenderTarget | null, deltaTime: any, maskActive: any) {
        if (!this.camera || !selectedObject) return
        const selectionLayer = 6

        // flatten array and get applied meshes from materials
        const objs = (Array.isArray(selectedObject) ? selectedObject : [selectedObject])
            .flatMap(o =>
                (o as ITexture)?.isTexture ? [...(o as ITexture).appliedObjects?.values() || []] : o)
            .flatMap(o =>
                (o as IMaterial)?.isMaterial ? [...(o as IMaterial).appliedMeshes?.values() || []] :
                    (o as IGeometry)?.isBufferGeometry ? [...(o as IGeometry).appliedMeshes?.values() || []] :
                    o as IObject3D)

        for (const o1 of objs) {
            o1 && o1.traverse((o) => {
                o.layers.enable(selectionLayer)
            })
        }

        const mask = this.camera.layers.mask
        this.camera.layers.set(selectionLayer)

        const ud = (renderer as any).userData
        if (!ud) console.error('threejs is not patched?')

        ud.transmissionRenderTarget = writeBuffer

        renderer.renderWithModes({
            shadowMapRender: false,
            backgroundRender: false,
            opaqueRender: true,
            transparentRender: true,
            transmissionRender: true,
            mainRenderPass: false,
        }, ()=> super.render(renderer, writeBuffer as any, getOrCall(this.target), deltaTime as any, maskActive as any)) // here this.target is the write-buffer, variable writeBuffer is ignored

        ud.transmissionRenderTarget = undefined

        objs.forEach(o1=>o1.traverse(o => {
            o.layers.disable(selectionLayer)
        }))

        this.camera.layers.mask = mask
    }

    public onDirty: (()=>void)[] = []

    dispose() {
        this.onDirty = []
        this.scene = undefined
        this.camera = undefined
        super.dispose?.()
    }

    setDirty() {
        this.onDirty.forEach(v=>v())
    }

    beforeRender(scene: IScene, camera: ICamera, _: IRenderManager): void {
        this.scene = scene
        this.camera = camera
        camera.updateShaderProperties(this.overrideMaterial)
    }

}
