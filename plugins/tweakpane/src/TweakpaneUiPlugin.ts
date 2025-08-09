import * as TweakpaneImagePlugin from 'tweakpane-image-plugin'
import {UiConfigRendererTweakpane} from 'uiconfig-tweakpane/lib/esm'
import {
    Class,
    Color,
    createDiv,
    createStyles,
    CustomContextMenu,
    downloadBlob,
    getOrCall,
    htmlDialogWrapper,
    IEvent,
    IViewerPlugin,
    IViewerPluginSync,
    mobileAndTabletCheck,
    onChange,
    Texture,
    ThreeViewer,
    uiDropdown,
    uiFolderContainer,
    UiObjectConfig,
    UndoManagerPlugin,
    uploadFile,
    Vector2,
    Vector3,
    Vector4,
    WebGLCubeRenderTarget,
    WebGLMultipleRenderTargets,
    WebGLRenderTarget,
    windowDialogWrapper,
} from 'threepipe'
import styles from './tpTheme.css?inline'
import {tpImageInputGenerator} from './tpImageInputGenerator'

const themeColors = ['black', 'white', 'blue', 'light', 'dark'] as const
type ThemeColors = typeof themeColors[number]

@uiFolderContainer('Tweakpane UI')
export class TweakpaneUiPlugin extends UiConfigRendererTweakpane implements IViewerPluginSync {
    declare ['constructor']: typeof TweakpaneUiPlugin
    static readonly PluginType = 'TweakpaneUi'
    enabled = true

    static CONTAINER_SLOT = 'uiconfigMainPanelSlot'

    @onChange(TweakpaneUiPlugin.prototype._colorModeChanged)
    @uiDropdown('Color Mode', themeColors.map(label=>({label})))
        colorMode: ThemeColors

    constructor(expanded = !mobileAndTabletCheck(), bigTheme = true, container?: HTMLElement, colorMode?: ThemeColors) {
        super(container ?? document.getElementById(TweakpaneUiPlugin.CONTAINER_SLOT) ?? document.getElementById('tweakpaneMainPanelSlot') ?? document.body, {
            expanded, autoPostFrame: false,
        }, false)
        this.THREE = {Color, Vector4, Vector3, Vector2} as any
        this._root!.registerPlugin(TweakpaneImagePlugin as any)
        if (bigTheme) createStyles(styles, container)
        this.colorMode = colorMode ?? getThemeColor()

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

    private _lastManager?: UndoManagerPlugin['undoManager']

    onAdded(viewer: ThreeViewer): void {
        this._viewer = viewer
        this.typeGenerators.image = tpImageInputGenerator(this._viewer)
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.addEventListener('postFrame', this._postFrame)
        if (ThreeViewer.Dialog === windowDialogWrapper) ThreeViewer.Dialog = htmlDialogWrapper
        const undo = viewer.getOrAddPluginSync(UndoManagerPlugin) // yes, manual dependency
        if (undo?.undoManager) {
            this._lastManager?.dispose()
            this._lastManager = this.undoManager
            this.undoManager = undo.undoManager
            if (this._lastManager) Object.assign(this.undoManager.presets, this._lastManager.presets)
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
    }

    private _plugins: IViewerPlugin[] = []

    setupPlugins(...plugins: Class<IViewerPlugin>[]): void {
        plugins.forEach(plugin => this.setupPluginUi(plugin))
    }

    setupPluginUi<T extends IViewerPlugin>(plugin: T|Class<T>, params?: Partial<UiObjectConfig>): UiObjectConfig | undefined {
        const p = (<Class<IViewerPlugin>>plugin).prototype ? this._viewer?.getPlugin<T>(<Class<T>>plugin) : <T>plugin
        if (!p) {
            console.warn('plugin not found:', plugin)
            return undefined
        }
        this._plugins.push(p)
        if (p.uiConfig && p.uiConfig.hidden === undefined) p.uiConfig.hidden = false // todo; this is a hack for now
        const ui = p.uiConfig
        this.appendChild(ui, params)
        this._setupPluginSerializationContext(ui, p)
        return ui
    }

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

    private _preRender = () => this.refreshQueue('preRender')
    private _postRender = () => this.refreshQueue('postRender')
    private _postFrame = (e: IEvent<'postFrame'>) => {
        this.dispatchEvent(e)
        this.refreshQueue('postFrame')
    }
    private _preFrame = () => this.refreshQueue('preFrame')

    alert = async(message?: string): Promise<void> =>this._viewer ? this._viewer.dialog.alert(message) : window?.alert(message)
    confirm = async(message?: string): Promise<boolean> =>this._viewer ? this._viewer.dialog.confirm(message) : window?.confirm(message)
    prompt = async(message?: string, _default?: string, cancel = true): Promise<string | null> =>this._viewer ? this._viewer.dialog.prompt(message, _default, cancel) : window?.prompt(message, _default)

    protected _colorModeChanged() {
        setThemeColor(this.colorMode)
    }

    dispose() {
        this.undoManager?.dispose()
        this.unmount()
    }

}

function getThemeColor(): ThemeColors {
    const c = localStorage ? localStorage.getItem('tpTheme') as ThemeColors : undefined
    if (c && themeColors.includes(c)) return c
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function setThemeColor(color: ThemeColors) {
    document.body.classList.remove(...themeColors.map(t=>'tpTheme-' + t))
    document.body.classList.add('tpTheme-' + color)
    if (!localStorage) return
    localStorage.setItem('tpTheme', color)
}
