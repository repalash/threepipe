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

export class TweakpaneEditorPlugin extends AViewerPluginSync<string> {
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
                innerHTML: key, classList: ['mode-button', 'button-bar-button'],
            })
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
        // this._viewer.setDirty()
        this.uiPlugin?.refreshPluginsEnabled()

        // todo: expand the ui if collapsed
    }
}
