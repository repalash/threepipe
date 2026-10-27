import {
    AViewerPluginSync,
    Class,
    createDiv,
    createStyles,
    FullScreenPlugin,
    IViewerPlugin,
    safeSetProperty,
    ThreeViewer,
} from 'threepipe'
import {setupFullscreenButton, setupUtilButtonsBar} from './util-buttons'
import {setupWebGiLogo} from './logo'
import styles from './TweakpaneEditorPlugin.css?inline'
import tippy from 'tippy.js'
import tippyStyles from 'tippy.js/dist/tippy.css?inline'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {EditorFrame, EditorFrameLayout, EditorFrameOptions} from './frame/EditorFrame'

export class TweakpaneEditorPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'TweakpaneEditorPlugin'
    enabled = true

    dependencies = [TweakpaneUiPlugin, FullScreenPlugin]

    constructor() {
        super()
    }
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        createStyles(styles)
        createStyles(tippyStyles)

        tippy.setDefaultProps({
            theme: 'editor',
            duration: 300,
            arrow: true,
            appendTo: () => viewer.container, // for fullscreen
        })

        setupWebGiLogo(viewer)
        setupFullscreenButton(viewer)
    }

    onRemove(viewer: ThreeViewer) {
        this.setFrame(undefined)
        super.onRemove(viewer)
    }

    /**
     * The page frame, with the mode bar on the right instead of the mode tabs at the bottom. Set with {@link setFrame}.
     */
    frame?: EditorFrame
    private _frameOptions?: EditorFrameOptions

    /**
     * Puts the editor in a page frame: a title bar, a status bar or floating panels ({@link EditorFrameLayout}), with
     * the modes as coloured icons on the right ({@link EditorModeBar}) and Shift+T for a light or dark theme.
     * `undefined` removes the frame, and the page has the mode tabs at the bottom again.
     * @param layout - the layout, or `undefined` for no frame
     * @param options - options of the frame, used when the frame is made
     */
    setFrame(layout: EditorFrameLayout | undefined, options?: EditorFrameOptions) {
        if (!layout) {
            this.frame?.dispose()
            this.frame = undefined
            this._frameOptions = undefined
            return
        }
        if (this.frame) {
            this.frame.setLayout(layout)
            return
        }
        if (!this._viewer) throw new Error('Plugin not added to viewer.')
        const ui = this._viewer.getPlugin(TweakpaneUiPlugin)
        this._frameOptions = {
            colorMode: ui ? {get: () => ui.colorMode, set: (m) => ui.colorMode = m as TweakpaneUiPlugin['colorMode']} : undefined,
            ...options,
        }
        this.frame = new EditorFrame(this._viewer, this, {...this._frameOptions, layout})
        this.frame.modeBar.select(this._selectedMode)
    }

    private _selectedMode = 0
    modeKeys: string[] = []
    modePlugins: Class<IViewerPlugin>[][] = []
    modeDivs: (HTMLDivElement | undefined)[] = []
    // picking?: PickingPlugin
    uiPlugin?: TweakpaneUiPlugin

    loadPlugins(plugins: Record<string, Class<IViewerPlugin<any>>[]> = {}) {
        if (!this._viewer) throw new Error('Plugin not added to viewer.')
        setupUtilButtonsBar(this._viewer, Object.values(plugins).flat())

        // this.picking = viewer.getPlugin(PickingPlugin)
        this.uiPlugin = this._viewer.getPlugin(TweakpaneUiPlugin)!

        // Modes UI
        const buttonsContainer = createDiv({
            classList: ['mode-buttons-container', 'button-bar'],
            addToBody: true,
        })

        this.modeKeys = Object.keys(plugins)
        this.modePlugins = this.modeKeys.map(key => plugins[key])
        this.modeDivs = this.modeKeys.map((key, i) => {
            const d = createDiv({
                innerHTML: '', classList: ['mode-button', 'button-bar-button'],
            })
            d.textContent = key
            d.onclick = () => this.setSelectedMode(i)
            buttonsContainer.appendChild(d)
            return d
        })

        // picking?.addEventListener('selectedObjectChanged', () => {
        //     if (picking?.getSelectedObject() && !['Picking', 'Modifiers', 'Configurators'].includes(this.modeKeys[_selectedMode])) {
        //         setSelectedMode(modePlugins.findIndex(o=>o.includes(PickingPlugin)))
        //     }
        // })

        this.setSelectedMode(0)

        // the mode bar shows the modes of the frame: make it again with the new modes
        if (this.frame) {
            const layout = this.frame.layout
            const options = this._frameOptions
            this.setFrame(undefined)
            this.setFrame(layout, options)
        }
    }

    setSelectedMode(mode: number) {
        this._selectedMode = mode

        // if (picking) picking.enabled = true

        for (let i = 0; i < this.modePlugins.length; i++) {
            const plugins = this.modePlugins[i].map(p => this._viewer?.getPlugin(p))
            const visible = i === mode
            for (const plugin of plugins) {
                if (!plugin?.uiConfig) continue
                if (!plugin.uiConfig.uiRef) this.uiPlugin?.setupPluginUi(plugin)
                safeSetProperty(plugin.uiConfig, 'hidden', !visible, true)
            }
        }

        for (let i = 0; i < this.modeKeys.length; i++) {
            this.modeDivs[i]?.classList[this._selectedMode !== i ? 'remove' : 'add']('mode-button-selected', 'button-bar-selected')
        }
        this.frame?.modeBar.select(mode)
        // this._viewer.setDirty()
        this.uiPlugin?.refreshPluginsEnabled()

        // todo: expand the ui if collapsed
    }
}
