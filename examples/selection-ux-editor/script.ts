import {_testFinish, _testStart, GBufferPlugin, HemisphereLight, IViewerPlugin, Class, PickingPlugin, TransformControlsPlugin} from 'threepipe'
import {HierarchyUiPlugin, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {OutlinePlugin} from '@threepipe/webgi-plugins'
import {ThreeEditor} from '../tweakpane-editor/ThreeEditor'
import {SelectionUxPlugin} from '../selection-ux-playground/SelectionUxPlugin'
import {SelectionOutlinePlugin} from '../selection-ux-playground/SelectionOutlinePlugin'
import {LayersPanelPlugin} from '../selection-ux-playground/LayersPanelPlugin'
import {NotesPlugin} from '../selection-ux-playground/NotesPlugin'
import {applyModeFromUrl, setupHints, setupModeMenu, setupSidePanel, modeContext} from '../selection-ux-playground/ui'
import {buildExtras, buildScene, demoAnnotations, splashSamples} from '../selection-ux-playground/scene'
import {AnnotationsPlugin} from '../selection-ux-playground/AnnotationsPlugin'
import {EditorToolbarPlugin} from '../selection-ux-playground/EditorToolbarPlugin'
import {showReport, showReportIfNew} from '../selection-ux-playground/report'
import {showSplash} from '../selection-ux-playground/splash'
import {PerfPanelPlugin} from '../selection-ux-playground/PerfPanelPlugin'
import {PenToolPlugin} from '../selection-ux-playground/PenToolPlugin'
import {CameraPathPlugin} from '../selection-ux-playground/CameraPathPlugin'
import {TimelineBarPlugin} from '../selection-ux-playground/TimelineBarPlugin'
import {setupModeBar} from '../selection-ux-playground/ModeBar'

// The tweakpane editor with the new selection UX: SelectionUxPlugin + the pipeline outline instead of OutlinePlugin,
// and LayersPanelPlugin instead of the treejs HierarchyUiPlugin.
async function init() {
    const viewer = new ThreeEditor({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        rgbm: true,
        dropzone: {
            autoImport: true,
            autoAdd: true,
            addOptions: {autoScale: true, autoCenter: true, autoScaleRadius: 2.5},
        },
    })
    const replaced: Class<IViewerPlugin>[] = [HierarchyUiPlugin, OutlinePlugin]
    const isReplaced = (p: IViewerPlugin | Class<IViewerPlugin>) => replaced.some(r => p === r || p instanceof r)
    viewer.editorPlugins = viewer.editorPlugins.filter(p => !isReplaced(p))
    // after PickingPlugin and the GBuffer, which they depend on
    const at = viewer.editorPlugins.findIndex(p => p === PickingPlugin) + 1
    viewer.editorPlugins.splice(at, 0, new SelectionUxPlugin({persistKey: 'selection-ux-settings', selectGeometryInEdit: true}), SelectionOutlinePlugin)
    viewer.editorModes.Interaction = [PickingPlugin, ...viewer.editorModes.Interaction.filter(p => !isReplaced(p) && p !== PickingPlugin)]
    await viewer.init()
    if (!viewer.getPlugin(GBufferPlugin)) console.warn('GBufferPlugin missing, the outline needs it')

    const ux = viewer.getPlugin(SelectionUxPlugin)!
    const tc = viewer.getPlugin(TransformControlsPlugin)
    if (tc) tc.enabled = false // the selection UX moves things; the toolbar turns the gizmo on (W/E/R)

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    viewer.addPluginSync(new AnnotationsPlugin({editable: true}))
    // FPS, frame and render times, draw calls; warns about a capped frame rate (Chrome Energy Saver), battery, software GL
    viewer.addPluginSync(new PerfPanelPlugin({position: 'bottom-right'}))
    // P: draw a path point by point, like Figma's pen
    viewer.addPluginSync(new PenToolPlugin())
    // camera along a path, the timeline bar with Record (adds VideoRecorderPlugin)
    viewer.addPluginSync(new CameraPathPlugin())
    viewer.addPluginSync(new TimelineBarPlugin())
    const layers = viewer.addPluginSync(new LayersPanelPlugin('light'))
    const notes = viewer.addPluginSync(new NotesPlugin({pageKey: 'selection-ux-playground-notes', syncUrl: '/api/notes', contextProvider: modeContext(ux)}))
    setupSidePanel(viewer.container, layers, notes, 'sux-side-pos-editor')
    applyModeFromUrl(ux)
    const toolbar = viewer.addPluginSync(new EditorToolbarPlugin({
        grid: true,
        expandHides: () => [document.querySelector<HTMLElement>('.sux-side')!, document.getElementById('tweakpaneUiContainer')!],
        extra: [[REPORT_ICON, 'Open a file or sample…', () => openSplash()], [REPORT_ICON, 'Report: what changed and what to try', () => showReport()]],
    }))
    viewer.container.appendChild(toolbar.element)
    setupModeMenu(viewer.container, viewer, ux, {buttonHost: toolbar.slot, links: [['Open the playground ↗', '../selection-ux-playground/index.html']]})
    setupHints(viewer.container, ux)
    // the editor's modes (Viewer, Interaction, ...) as coloured icons on the right instead of tabs on top
    const editor = viewer.getPlugin(TweakpaneEditorPlugin)
    if (editor) setupModeBar(editor, document.body, () => document.getElementById('tweakpaneUiContainer'))
    // once: the Figma-like tweakpane theme, light or dark like the theme in use (Color Mode in the Tweakpane UI folder changes it)
    const tp = viewer.getPlugin(TweakpaneUiPlugin)
    try {
        if (tp && !localStorage.getItem('sux-figma-theme')) {
            tp.colorMode = ['dark', 'black', 'blue'].includes(tp.colorMode) ? 'figma-dark' : 'figma'
            localStorage.setItem('sux-figma-theme', '1')
        }
    } catch (e) {
        // private mode: keep the theme
    }
    Object.assign(window, {viewer, ux})

    buildScene(viewer)
    buildExtras(viewer)
    demoAnnotations(viewer)
    viewer.scene.mainCamera.position.set(7, 7, 11)
    viewer.scene.mainCamera.target.set(0, 0.8, 0)
    viewer.scene.mainCamera.setDirty()
    // the welcome screen: drop a file or pick a sample (skip with ?nosplash); the report of this round after it
    const openSplash = () => showSplash(viewer, {title: 'Welcome to the threepipe Editor', samples: splashSamples(viewer), onClose: showReportIfNew})
    if (new URLSearchParams(location.search).has('nosplash')) showReportIfNew()
    else openSplash()
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
}

const REPORT_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 1.5h5.5L12.5 4.5v10H4z"/><path d="M6 7.5h4.5M6 10h4.5M6 12.5h3"/></svg>'

_testStart()
init().finally(_testFinish)
