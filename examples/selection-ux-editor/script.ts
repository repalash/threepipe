import {_testFinish, _testStart, GBufferPlugin, HemisphereLight, IViewerPlugin, Class, PickingPlugin, TransformControlsPlugin} from 'threepipe'
import {HierarchyUiPlugin} from '@threepipe/plugin-tweakpane-editor'
import {OutlinePlugin} from '@threepipe/webgi-plugins'
import {ThreeEditor} from '../tweakpane-editor/ThreeEditor'
import {SelectionUxPlugin} from '../selection-ux-playground/SelectionUxPlugin'
import {SelectionOutlinePlugin} from '../selection-ux-playground/SelectionOutlinePlugin'
import {LayersPanelPlugin} from '../selection-ux-playground/LayersPanelPlugin'
import {applyInitialPreset, setupHints, setupNotes, setupVariantBar} from '../selection-ux-playground/ui'
import {buildScene} from '../selection-ux-playground/scene'

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
    viewer.editorPlugins.splice(at, 0, SelectionUxPlugin, SelectionOutlinePlugin)
    viewer.editorModes.Interaction = [PickingPlugin, ...viewer.editorModes.Interaction.filter(p => !isReplaced(p) && p !== PickingPlugin)]
    await viewer.init()
    if (!viewer.getPlugin(GBufferPlugin)) console.warn('GBufferPlugin missing, the outline needs it')

    const ux = viewer.getPlugin(SelectionUxPlugin)!
    const tc = viewer.getPlugin(TransformControlsPlugin)
    if (tc) tc.enabled = false // the selection UX moves things; the gizmo can be turned on in Settings

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    const side = document.createElement('div')
    side.className = 'sux-side'
    viewer.container.appendChild(side)
    const layers = viewer.addPluginSync(new LayersPanelPlugin('light'))
    side.appendChild(layers.element)
    const notes = document.createElement('div')
    side.appendChild(notes)
    setupNotes(notes, ux)
    notes.querySelector('.sux-notes-head')!.addEventListener('click', () => notes.classList.toggle('collapsed'))

    applyInitialPreset(ux)
    setupVariantBar(viewer.container, viewer, ux, {links: [['Playground ↗', '../selection-ux-playground/index.html']]})
    setupHints(viewer.container, ux)
    Object.assign(window, {viewer, ux})

    buildScene(viewer)
    viewer.scene.mainCamera.position.set(7, 7, 11)
    viewer.scene.mainCamera.target.set(0, 0.8, 0)
    viewer.scene.mainCamera.setDirty()
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
}

_testStart()
init().finally(_testFinish)
