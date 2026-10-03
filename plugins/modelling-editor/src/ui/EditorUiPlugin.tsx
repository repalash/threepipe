/**
 * The uiconfig renderer the inspector uses.
 *
 * Adapted from `experiments/threepipe-blueprint-editor/src/UiConfigRendererBlueprint2.tsx`
 * (`UiConfigRendererBlueprint2` + `BlueprintJsUiPlugin2`). It renders nothing on its own: React
 * components render `<ConfigObject config={...}>` wherever they like, and this plugin only provides
 * the `UiConfigRendererContext` (methods, undo manager, refresh queues driven by viewer frames).
 */

import {createStyles} from 'ts-browser-helpers'
import type {THREE} from 'uiconfig-blueprint/lib/esm/lib'
import {BPComponent} from 'uiconfig-blueprint/lib/esm/lib'
import rendererCss from 'uiconfig-blueprint/lib/esm/renderer.css'
import {FocusStyleManager} from '@blueprintjs/core'
import {
    Class,
    Color,
    createDiv,
    getOrCall,
    IEvent,
    IViewerPlugin,
    IViewerPluginSync,
    Texture,
    ThreeViewer,
    UiConfigRenderer,
    UiObjectConfig,
    UndoManagerPlugin,
    Vector2,
    Vector3,
    Vector4,
    WebGLCubeRenderTarget,
    WebGLRenderTarget,
} from 'threepipe'

let stylesInjected = false

export class UiConfigRendererHeadless extends UiConfigRenderer {
    constructor(container: HTMLElement = document.body, {autoPostFrame = true} = {}) {
        super(container, autoPostFrame, undefined, undefined)
    }

    protected _createUiContainer(): HTMLDivElement {
        FocusStyleManager.onlyShowFocusOnTabs()
        if (!stylesInjected) {
            // Blueprint base CSS, icons and the uiconfig-blueprint component styles, exactly what
            // UiConfigRendererBlueprint injects; we skip its React root since the shell has its own.
            createStyles(rendererCss)
            stylesInjected = true
        }
        return createDiv({id: 'modellingEditorUiContainer', addToBody: false})
    }

    protected _refreshUiConfigObject(config: UiObjectConfig): void {
        ;(config.uiRef as BPComponent<any, any>)?.refreshConfigState()
    }

    renderUiConfig(_: UiObjectConfig): void {
        return
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    THREE: THREE | undefined = {Color, Vector4, Vector3, Vector2} as any
}

export class EditorUiPlugin extends UiConfigRendererHeadless implements IViewerPluginSync {
    declare ['constructor']: typeof EditorUiPlugin
    static readonly PluginType = 'BlueprintJsUi'
    enabled = true

    constructor() {
        super(document.body, {autoPostFrame: false})
        this.THREE = {Color, Vector4, Vector3, Vector2, Texture} as any
        // Required for the texture input so that it doesn't clone textures. Same as plugins/blueprintjs.
        ;(Texture.prototype as any)._ui_isPrimitive = true
        ;(WebGLRenderTarget.prototype as any)._ui_isPrimitive = true
        ;(WebGLCubeRenderTarget.prototype as any)._ui_isPrimitive = true
    }

    protected _viewer?: ThreeViewer
    private _lastManager?: EditorUiPlugin['undoManager']

    onAdded(viewer: ThreeViewer): void {
        this._viewer = viewer
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.addEventListener('preFrame', this._preFrame)
        viewer.addEventListener('postFrame', this._postFrame)
        const undo = viewer.getOrAddPluginSync(UndoManagerPlugin)
        const manager = undo?.undoManager
        if (manager) {
            this._lastManager?.dispose()
            this._lastManager = this.undoManager
            this.undoManager = manager
            if (this._lastManager) Object.assign(manager.presets, this._lastManager.presets)
        }
    }

    onRemove(viewer: ThreeViewer): void {
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.removeEventListener('preFrame', this._preFrame)
        viewer.removeEventListener('postFrame', this._postFrame)
        this.undoManager = this._lastManager
        this._lastManager = undefined
        this._viewer = undefined
    }

    dispose(): void {
        this.undoManager?.dispose()
    }

    private _plugins: IViewerPlugin[] = []

    setupPluginUi<T extends IViewerPlugin>(plugin: T | Class<T>): UiObjectConfig | undefined {
        const p = (plugin as Class<IViewerPlugin>).prototype ? this._viewer?.getPlugin<T>(plugin as Class<T>) : plugin as T
        if (!p) return undefined
        this._plugins.push(p)
        if (p.uiConfig && p.uiConfig.hidden === undefined) p.uiConfig.hidden = false
        const ui = p.uiConfig
        this.appendChild(ui)
        return ui
    }

    refreshPluginsEnabled() {
        this._plugins.forEach(p => {
            const config = p.uiConfig
            if (config) {
                if (getOrCall(config.hidden) !== true) config.uiRefresh?.(true, 'postFrame')
                else if (config.uiRef) config.uiRef.hidden = true
            }
        })
    }

    /** Required for loading files in BPFileComponent. */
    get fileLoader() {
        return this._viewer
    }

    get viewer() {
        return this._viewer
    }

    private _preRender = () => this.refreshQueue('preRender')
    private _postRender = () => this.refreshQueue('postRender')
    private _postFrame = (e: IEvent<'postFrame'>) => {
        this.dispatchEvent(e)
        this.refreshQueue('postFrame')
    }
    private _preFrame = () => this.refreshQueue('preFrame')
}
