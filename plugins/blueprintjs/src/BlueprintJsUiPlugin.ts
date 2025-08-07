import {UiConfigRendererBlueprint} from 'uiconfig-blueprint/lib/esm'
import {
    Class,
    Color,
    createDiv,
    CustomContextMenu,
    downloadBlob,
    getOrCall,
    IEvent,
    IViewerPlugin,
    IViewerPluginSync,
    Texture,
    ThreeViewer,
    UndoManagerPlugin,
    uploadFile,
    Vector2,
    Vector3,
    Vector4,
    UiObjectConfig,
    WebGLCubeRenderTarget,
    WebGLMultipleRenderTargets,
    WebGLRenderTarget,
    windowDialogWrapper,
    htmlDialogWrapper,
} from 'threepipe'

export class BlueprintJsUiPlugin extends UiConfigRendererBlueprint implements IViewerPluginSync {
    declare ['constructor']: typeof BlueprintJsUiPlugin
    static readonly PluginType = 'BlueprintJsUi'
    enabled = true
    static CONTAINER_SLOT = 'uiconfigMainPanelSlot'

    constructor(container?: HTMLElement) {
        super(container ?? document.getElementById(BlueprintJsUiPlugin.CONTAINER_SLOT) ?? document.body, {
            autoPostFrame: false,
        })
        this.THREE = {Color, Vector4, Vector3, Vector2, Texture} as any

        // @ts-expect-error required for tpTextureInputComponent so that it doesn't clone it. todo check others as well like object3d etc
        Texture.prototype._ui_isPrimitive = true
        // @ts-expect-error same
        WebGLRenderTarget.prototype._ui_isPrimitive = true
        // @ts-expect-error same
        WebGLCubeRenderTarget.prototype._ui_isPrimitive = true
        // @ts-expect-error same
        WebGLMultipleRenderTargets.prototype._ui_isPrimitive = true
    }

    protected _viewer?: ThreeViewer

    private _lastManager?: BlueprintJsUiPlugin['undoManager']

    onAdded(viewer: ThreeViewer): void {
        this._viewer = viewer
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.addEventListener('postFrame', this._postFrame)
        if (ThreeViewer.Dialog === windowDialogWrapper) ThreeViewer.Dialog = htmlDialogWrapper
        const undo = viewer.getOrAddPluginSync(UndoManagerPlugin) // yes, manual dependency
        const manager = undo?.undoManager
        if (manager) {
            this._lastManager?.dispose()
            this._lastManager = this.undoManager
            this.undoManager = manager
            if (this._lastManager) Object.assign(manager.presets, this._lastManager.presets)
        }
    }
    onRemove(viewer: ThreeViewer): void {
        this._viewer = undefined
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.removeEventListener('postFrame', this._postFrame)
        this.undoManager = this._lastManager
        this._lastManager = undefined
        this.dispose()
    }

    dispose() {
        this.undoManager?.dispose()
        this.unmount()
    }

    private _plugins: IViewerPlugin[] = []

    setupPlugins(...plugins: Class<IViewerPlugin>[]): void {
        plugins.forEach(plugin => this.setupPluginUi(plugin))
    }

    setupPluginUi<T extends IViewerPlugin>(plugin: T|Class<T>): UiObjectConfig | undefined {
        const p = (<Class<IViewerPlugin>>plugin).prototype ? this._viewer?.getPlugin<T>(<Class<T>>plugin) : <T>plugin
        if (!p) {
            console.warn('plugin not found:', plugin)
            return undefined
        }
        this._plugins.push(p)
        if (p.uiConfig && p.uiConfig.hidden === undefined) p.uiConfig.hidden = false // todo; this is a hack for now
        const ui = p.uiConfig
        this.appendChild(ui)
        // this._setupPluginSerializationContext(ui, p)
        return ui
    }

    // @ts-expect-error todo: port to blueprint from tweakpane
    private _setupPluginSerializationContext(ui: any, p: IViewerPlugin) {
        // serialization
        if (!(ui?.uiRef && p.toJSON)) return;

        (p as any)._defaultState = typeof p.toJSON === 'function' ? p.toJSON() : null
        ;(p as any).resetDefaults = async() => {
            if (!(p as any)._defaultState) return
            await p.fromJSON?.((p as any)._defaultState)
            ui.uiRefresh?.(true, 'postFrame')
        }
        const topBtn = (ui.uiRef as any).controller_.view.element
        const opBtn = createDiv({
            innerHTML: '&#8942;',
            classList: ['pluginOptionsButton'],
            elementTag: 'button',
        })
        opBtn.onclick = (ev) => {
            const ops = {} as any
            if (typeof p.toJSON === 'function') {
                ops['download preset'] = async() => {
                    if (!this._viewer) return
                    const json = this._viewer.exportPluginConfig(p)
                    await downloadBlob(new Blob([JSON.stringify(json, null, 2)], {type: 'application/json'}), 'preset.' + (p.constructor as any).PluginType + '.json')
                }
            }
            if (typeof p.fromJSON === 'function') {
                ops['upload preset'] = async() => {
                    const files = await uploadFile(false, false)
                    if (files.length === 0) return
                    const file = files[0]
                    const text = await file.text()
                    const json = JSON.parse(text)
                    await this._viewer?.importPluginConfig(json, p)
                    ui.uiRefresh?.(true, 'postFrame')
                }
                if ((p as any)._defaultState) ops['reset defaults'] = () => (p as any).resetDefaults?.()
            }
            const menu = CustomContextMenu.Create(ops, topBtn.clientWidth - 120, 12)
            topBtn.append(menu)
            ev.preventDefault()
        }
        topBtn.appendChild(opBtn)
    }

    refreshPluginsEnabled() {
        this._plugins.forEach(p=>{
            const config = p.uiConfig
            if (config) {
                // const enabled = (p as any).enabled ?? true
                // safeSetProperty(config, 'hidden', !enabled, true)
                // if (config.expanded)
                //     safeSetProperty(config, 'expanded', config.expanded && enabled, true)
                if (getOrCall(config.hidden) !== true)
                    config.uiRefresh?.(true, 'postFrame')
                else if (config.uiRef) {
                    config.uiRef.hidden = true
                }
            }
        })
    }

    /**
     * Required for loading files in BPFileComponent
     */
    get fileLoader() {
        return this._viewer
    }

    private _preRender = () => this.refreshQueue('preRender')
    private _postRender = () => this.refreshQueue('postRender')
    private _postFrame = (e: IEvent<'postFrame'>) => {
        this.dispatchEvent(e)
        this.refreshQueue('postFrame')
    }
    private _preFrame = () => this.refreshQueue('preFrame')

    // alert = async(message?: string): Promise<void> =>this._viewer ? this._viewer.dialog.alert(message) : window?.alert(message)
    // confirm = async(message?: string): Promise<boolean> =>this._viewer ? this._viewer.dialog.confirm(message) : window?.confirm(message)
    // prompt = async(message?: string, _default?: string, cancel = true): Promise<string | null> =>this._viewer ? this._viewer.dialog.prompt(message, _default, cancel) : window?.prompt(message, _default)

}
