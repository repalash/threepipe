import {BVHPlugin, GPUPickingPlugin, _testFinish, _testStart, EditorViewWidgetPlugin, GBufferPlugin, HemisphereLight, IViewerPlugin, Class, PickingPlugin, ThreeViewer, TransformControlsPlugin} from 'threepipe'
import {EDITOR_PAGE_LAYOUTS, HierarchyUiPlugin, TweakpaneEditorPlugin} from '@threepipe/plugin-tweakpane-editor'
import {OutlinePlugin} from '@threepipe/webgi-plugins'
import {ThreeEditor} from '../tweakpane-editor/ThreeEditor'
import {SelectionUxPlugin} from '../selection-ux-playground/SelectionUxPlugin'
import {SelectionOutlinePlugin} from '../selection-ux-playground/SelectionOutlinePlugin'
import {LayersPanelPlugin} from '../selection-ux-playground/LayersPanelPlugin'
import {applyModeFromUrl, setupHints, setupModeMenu, setupSidePanel} from '../selection-ux-playground/ui'
import {buildExtras, buildScene, demoAnnotations, splashSamples} from '../selection-ux-playground/scene'
import {AnnotationsPlugin} from '../selection-ux-playground/AnnotationsPlugin'
import {EditorToolbarPlugin} from '../selection-ux-playground/EditorToolbarPlugin'
import {showReport, showReportIfNew} from '../selection-ux-playground/report'
import {showSplash, splashAtStartup} from '../selection-ux-playground/splash'
import {PenToolPlugin} from '../selection-ux-playground/PenToolPlugin'
import {CameraPathPlugin} from '../selection-ux-playground/CameraPathPlugin'
import {TimelineBarPlugin} from '../selection-ux-playground/TimelineBarPlugin'
import {VariationsBarPlugin} from '../selection-ux-playground/VariationsBarPlugin'

// The tweakpane editor with the new selection UX: SelectionUxPlugin + the pipeline outline instead of OutlinePlugin,
// and LayersPanelPlugin instead of the treejs HierarchyUiPlugin. What is merged in the packages comes from them (with
// ThreeEditor): the page frame and mode bar, EditorCameraPlugin, PerfPanelPlugin, the notes (NotesPlugin and the
// sticky notes) and GLTFContentsPlugin (Debug mode).
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
    // the page frame (title bar, mode bar, Shift+T, the layout menu) and the mode tabs of the classic layout
    const editor = viewer.getPlugin(TweakpaneEditorPlugin)
    const tc = viewer.getPlugin(TransformControlsPlugin)
    if (tc) tc.enabled = false // the selection UX moves things; the toolbar turns the gizmo on (W/E/R)

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    viewer.addPluginSync(new AnnotationsPlugin({editable: true}))
    // P: draw a path point by point, like Figma's pen
    viewer.addPluginSync(new PenToolPlugin())
    // camera along a path, the timeline bar with Record (adds VideoRecorderPlugin)
    viewer.addPluginSync(new CameraPathPlugin())
    viewer.addPluginSync(new TimelineBarPlugin())
    // fast raycasts (picking, hover) on big meshes; ?bvh=0 to compare without.
    // ?pick=gpu: no BVH, the hover picks object ids on the GPU instead (GPUPickingPlugin)
    const pickParam = new URLSearchParams(location.search)
    if (pickParam.get('pick') === 'gpu') viewer.addPluginSync(new GPUPickingPlugin())
    else if (pickParam.get('bvh') !== '0') viewer.addPluginSync(new BVHPlugin())
    // the material variations and switch node options of the selection, in a bar over it
    viewer.addPluginSync(new VariationsBarPlugin())
    const layers = viewer.addPluginSync(new LayersPanelPlugin('light'))
    setupSidePanel(viewer.container, layers, undefined, 'sux-side-pos-editor')
    applyModeFromUrl(ux)
    const toolbar = viewer.addPluginSync(new EditorToolbarPlugin({
        grid: true,
        expandHides: () => [document.querySelector<HTMLElement>('.sux-side')!, document.getElementById('tweakpaneUiContainer')!],
        viewHides: () => [document.querySelector<HTMLElement>('.sux-side')!],
        extra: [[REPORT_ICON, 'Open a file or sample…', () => openSplash()], [REPORT_ICON, 'Report: what changed and what to try', () => showReport()]],
        // the frames have their own layout button only when they have a bar: the floating one has none
        moreItems: () => ['#Page layout', ...EDITOR_PAGE_LAYOUTS.map(([k, label]) => [label, () => editor && (editor.layout = k), editor?.layout === k] as [string, () => void, boolean])],
    }))
    viewer.container.appendChild(toolbar.element)
    setupModeMenu(viewer.container, viewer, ux, {buttonHost: toolbar.slot, links: [['Open the playground ↗', '../selection-ux-playground/index.html']]})
    setupHints(viewer.container, ux)
    // the editor's modes (Viewer, Interaction, ...) as coloured icons on the right instead of tabs on top
    // the view gizmo sits top-right below the toolbar, out of the way of the layers and the panels at the bottom
    const gizmo = viewer.getPlugin(EditorViewWidgetPlugin)?.widget?.domContainer
    // (the floating layout keeps it out from under the panel: --lay-right-inset)
    if (gizmo) Object.assign(gizmo.style, {top: '56px', left: '', right: 'calc(var(--lay-right-inset, 0px) + 4px)', bottom: '', transform: 'scale(.72)', transformOrigin: '100% 0'})
    // like webgi: a selection opens its properties (object, material, geometry) in the panel: the Interaction mode,
    // whose Picking folder shows the selected object
    ux.addEventListener('uxUpdate', e => {
        if (e.reason !== 'selection' || !ux.selected.length || !editor) return
        const mode = editor.modeKeys.indexOf('Interaction')
        if (editor.frame) editor.frame.modeBar.show(mode)
        else editor.setSelectedMode(mode)
        const picking = viewer.getPlugin(PickingPlugin)
        if (picking?.uiConfig && !picking.uiConfig.expanded) {
            picking.uiConfig.expanded = true
            picking.uiConfig.uiRefresh?.(false, 'postFrame')
        }
    })
    Object.assign(window, {viewer, ux})

    buildScene(viewer)
    buildExtras(viewer)
    demoAnnotations(viewer)
    if (editor) editor.documentName = 'Jewellery demo'
    viewer.scene.mainCamera.position.set(7, 7, 11)
    viewer.scene.mainCamera.target.set(0, 0.8, 0)
    viewer.scene.mainCamera.setDirty()
    // the welcome screen: drop a file or pick a sample (skip with ?nosplash); the report of this round after it
    const openSplash = () => showSplash(viewer, {title: 'threepipe Editor', version: 'v' + ThreeViewer.VERSION, samples: splashSamples(viewer), onClose: showReportIfNew})
    // the start screen with the page, unless "Show at startup" is off (or ?nosplash)
    if (new URLSearchParams(location.search).has('nosplash') || !splashAtStartup()) showReportIfNew()
    else openSplash()
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
}

const REPORT_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 1.5h5.5L12.5 4.5v10H4z"/><path d="M6 7.5h4.5M6 10h4.5M6 12.5h3"/></svg>'

_testStart()
init().finally(_testFinish)
