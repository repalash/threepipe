import {
    AViewerPluginEventMap,
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
import styles from './TweakpaneEditorPlugin.css?inline'
import tippy from 'tippy.js'
import tippyStyles from 'tippy.js/dist/tippy.css?inline'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {UiObjectConfig} from 'uiconfig.js'
import {EDITOR_PAGE_LAYOUTS, EditorFrame, EditorFrameLayout, EditorFrameOptions, EditorPageLayout} from './frame/EditorFrame'

export interface TweakpaneEditorPluginEventMap extends AViewerPluginEventMap {
    /** {@link TweakpaneEditorPlugin.documentName} changed: set by the app, or renamed in the bar of the frame */
    documentNameChange: {name: string}
}

export class TweakpaneEditorPlugin extends AViewerPluginSync<TweakpaneEditorPluginEventMap> {
    public static readonly PluginType: string = 'TweakpaneEditorPlugin'
    enabled = true
    // the page layout is a setting of the person (localStorage), not of the scene: nothing to save, reset or download
    toJSON: any = undefined

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
            // a touch screen: a tap shows a tooltip until the next tap anywhere; show it on a long press only
            touch: ['hold', 500],
        })

        setupFullscreenButton(viewer)
    }

    onRemove(viewer: ThreeViewer) {
        this._removeFrame()
        super.onRemove(viewer)
    }

    /**
     * The `localStorage` key that keeps the page layout the person picked, or `null` to not keep it. Set it before the
     * plugin is made: the plugin reads the stored layout when it is made.
     */
    static LayoutStorageKey: string | null = 'tpEditorLayout'
    /** The page layout when none is stored. Set it before the plugin is made, as {@link LayoutStorageKey}. */
    static DefaultLayout: EditorPageLayout = 'titlebar'

    /**
     * The page frame, with the mode bar on the right instead of the mode tabs at the bottom. It is there when
     * {@link layout} is not `classic`, after {@link loadPlugins}.
     */
    frame?: EditorFrame

    /**
     * Options of the page frame (the app name, the theme pairs), used when the frame is made. The plugin sets the layout,
     * the pick in the layout menu ({@link layout}) and the rename ({@link documentName}).
     */
    frameOptions: Omit<EditorFrameOptions, 'layout' | 'onPickLayout' | 'onRename'> = {}

    private _documentName = ''
    /**
     * The name in the bars of the page frame: the open file or project. The app sets it, for example the name of the
     * first loaded file (as the tweakpane-editor example does), and a click on it in the bar renames it. Empty: no
     * name. Each change sends `documentNameChange`, so the app can use the name elsewhere (the example names the
     * exported file with it). It is kept when the frame is made again.
     */
    get documentName() {
        return this._documentName
    }
    set documentName(name: string) {
        if (name === this._documentName) return
        this._documentName = name
        if (this.frame) this.frame.documentName = name
        this.dispatchEvent({type: 'documentNameChange', name})
    }

    private _layout: EditorPageLayout = readStoredLayout() ?? TweakpaneEditorPlugin.DefaultLayout

    /**
     * The layout of the page:
     * - `titlebar`, `statusbar` or `floating`: the page frame ({@link EditorFrame}), with the modes as coloured icons on
     *   the right ({@link EditorModeBar}) and Shift+T for a light or dark theme;
     * - `classic`: no frame, the mode tabs at the bottom.
     *
     * A change applies at once, or at {@link loadPlugins}. The default is the stored layout, else
     * {@link TweakpaneEditorPlugin.DefaultLayout}. Only the layout that the person picks (in the layout menu of the frame
     * or in the plugin's UI, Page layout) is kept in `localStorage` ({@link TweakpaneEditorPlugin.LayoutStorageKey}); a
     * layout set from code is not, so the person's pick is back at the next visit.
     */
    get layout(): EditorPageLayout {
        return this._layout
    }
    set layout(layout: EditorPageLayout) {
        if (!EDITOR_PAGE_LAYOUTS.some(([k]) => k === layout)) return
        this._layout = layout
        if (this.modeKeys.length) this._applyLayout()
        else this.uiConfig.uiRefresh?.(true)
    }

    /** The layout that the person picked in the layout menu or the UI: it applies, and is kept in `localStorage` */
    private _pickLayout(layout: EditorPageLayout) {
        this.layout = layout
        const key = TweakpaneEditorPlugin.LayoutStorageKey
        if (!key) return
        try {
            localStorage.setItem(key, this._layout)
        } catch (e) {
            // no storage: this page only
        }
    }

    /**
     * The names of the modes are shown next to their icons in the mode bar of the frame. A change from code is not kept
     * in `localStorage`; the person's pick (the toggle of the mode bar, Ctrl+\, the Mode names checkbox) is.
     */
    get modeNames() {
        return this.frame?.modeBar.expanded ?? false
    }
    set modeNames(names: boolean) {
        this.frame?.modeBar.setExpanded(names)
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Editor',
        children: [
            {
                type: 'dropdown',
                label: 'Page layout',
                // the person's pick is kept. Not onChange: it also comes when the UI refreshes after a change from code
                getValue: () => this.layout,
                setValue: (layout: EditorPageLayout) => this._pickLayout(layout),
                children: EDITOR_PAGE_LAYOUTS.map(([value, label]) => ({label, value})),
            },
            {
                type: 'checkbox',
                label: 'Mode names',
                // the person's pick is kept, as for the page layout
                getValue: () => this.modeNames,
                setValue: (names: boolean) => this.frame?.modeBar.setExpanded(names, true),
                hidden: () => !this.frame,
            },
        ],
    }

    /** Makes, changes or removes the frame for {@link layout}, and refreshes the UI (the dropdown, the checkbox) */
    private _applyLayout() {
        const layout = this._layout
        if (layout === 'classic') this._removeFrame()
        else if (this.frame) this.frame.setLayout(layout)
        else if (this._viewer) this._makeFrame(layout)
        this.uiConfig.uiRefresh?.(true)
    }

    private _makeFrame(layout: EditorFrameLayout) {
        const ui = this._viewer?.getPlugin(TweakpaneUiPlugin)
        this.frame = new EditorFrame(this, {
            colorMode: ui ? {
                get: () => ui.colorMode,
                set: (m) => {
                    ui.colorMode = m as TweakpaneUiPlugin['colorMode']
                    // its Color Mode dropdown, which does not follow a change from code (the UI that setupPluginUi made)
                    ;(ui as IViewerPlugin).uiConfig?.uiRefresh?.(true)
                },
            } : undefined,
            // the container of the Tweakpane UI (uiconfig-tweakpane gives it this id; the plugin has no getter for it)
            panel: () => document.getElementById('tweakpaneUiContainer'),
            ...this.frameOptions,
            layout,
            onPickLayout: (l) => this._pickLayout(l),
            onRename: (name) => this.documentName = name,
        })
        this.frame.modeBar.select(this._selectedMode)
        this.frame.documentName = this._documentName
        // the mode bar keeps the names shown or hidden (its toggle button, the stored state): the checkbox follows it
        this.frame.modeBar.onExpandedChange = () => this.uiConfig.uiRefresh?.(true)
    }

    private _removeFrame() {
        this.frame?.dispose()
        this.frame = undefined
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

        // the mode bar shows the modes: make the frame again with the new modes
        this._removeFrame()
        this._applyLayout()
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

/** The page layout kept in `localStorage` ({@link TweakpaneEditorPlugin.LayoutStorageKey}), if it is a known layout */
function readStoredLayout(): EditorPageLayout | undefined {
    const key = TweakpaneEditorPlugin.LayoutStorageKey
    if (!key) return undefined
    try {
        const stored = localStorage.getItem(key)
        return EDITOR_PAGE_LAYOUTS.find(([k]) => k === stored)?.[0]
    } catch (e) {
        return undefined // no storage
    }
}
