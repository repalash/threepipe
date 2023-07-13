import {FolderApi} from 'tweakpane'
import * as TweakpaneImagePlugin from 'tweakpane-image-plugin'
import {UiConfigRendererTweakpane} from 'uiconfig-tweakpane'
import {IViewerPlugin, IViewerPluginSync, ThreeViewer} from '../../../viewer'
import styles from './tpTheme.css'
import {Class, createDiv, createStyles, downloadBlob, getOrCall, IEvent, uploadFile} from 'ts-browser-helpers'
import {UiObjectConfig} from 'uiconfig.js'
import {CustomContextMenu} from '../../../utils'
import {Color, Vector2, Vector3, Vector4} from 'three'
import {tpImageInputGenerator} from './tpImageInputGenerator'

export class TweakpaneUiPlugin extends UiConfigRendererTweakpane implements IViewerPluginSync {
    declare ['constructor']: typeof TweakpaneUiPlugin
    static readonly PluginType = 'TweakpaneUi'
    enabled = true

    constructor(expanded = false, bigTheme = true, container: HTMLElement = document.body) {
        super(container, {
            expanded, autoPostFrame: false,
        })
        this.THREE = {Color, Vector4, Vector3, Vector2} as any
        this._root!.registerPlugin(TweakpaneImagePlugin)
        if (bigTheme) createStyles(styles, container)
    }

    protected _viewer?: ThreeViewer
    onAdded(viewer: ThreeViewer): void {
        this._viewer = viewer
        this.typeGenerators.image = tpImageInputGenerator(this._viewer)
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.addEventListener('postFrame', this._postFrame)
    }
    onRemove(viewer: ThreeViewer): void {
        this._viewer = undefined
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.removeEventListener('postFrame', this._postFrame)
        this.dispose()
    }

    private _plugins: IViewerPlugin[] = []

    setupPlugins<T extends IViewerPlugin>(...plugins: Class<T>[]): void {
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
        const topBtn = (ui.uiRef as FolderApi).controller_.view.element
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

}
