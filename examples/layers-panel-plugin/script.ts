import {
    _testFinish,
    _testStart,
    DirectionalLight2,
    IObject3D,
    LoadingScreenPlugin,
    PerspectiveCamera2,
    PickingPlugin,
    PointLight2,
    ProgressivePlugin,
    ThreeViewer,
    UndoManagerPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {LayersPanelPlugin, SelectionOutlinePlugin} from '@threepipe/plugin-tweakpane-editor'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: true,
        plugins: [LoadingScreenPlugin, ProgressivePlugin, UndoManagerPlugin],
    })

    const picking = viewer.addPluginSync(PickingPlugin)
    picking.hoverEnabled = true // the object under the pointer in the viewport is marked in the list too
    picking.widgetEnabled = false // the outline replaces the box widget
    // the selection outline, and the outline of the hovered row
    viewer.addPluginSync(SelectionOutlinePlugin)

    // without the TweakpaneEditorPlugin, the panel goes in the element given here (it fills it)
    const layers = viewer.addPluginSync(new LayersPanelPlugin(document.getElementById('layers')!))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    // a model with a deep tree of parts
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/demos/kira.glb', {autoCenter: true, autoScale: true})

    // a light and a camera: their rows have the icon and the colour of their kind
    const sun = new DirectionalLight2(0xffffff, 2)
    sun.name = 'Sun'
    sun.position.set(2, 3, 2)
    viewer.scene.addObject(sun)
    const lamp = new PointLight2(0xffaa66, 3)
    lamp.name = 'Lamp'
    lamp.position.set(-1, 1, 1)
    viewer.scene.addObject(lamp)
    const camera = new PerspectiveCamera2('', viewer.canvas, false, 45, 1)
    camera.name = 'Side camera'
    camera.position.set(4, 0, 0)
    viewer.scene.addObject(camera)

    // open the model's row: its parts show below it
    if (model) layers.setExpanded(model, true)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(LayersPanelPlugin, {expanded: true})
    ui.setupPluginUi(SelectionOutlinePlugin)
    ui.setupPluginUi(PickingPlugin)

    createExampleCard(viewer, {
        description: 'LayersPanelPlugin: the objects of the scene in a list. Click a row to select its object, double-click a row to move the camera to it, or double-click its name to rename it. The eye hides an object, the lock stops picking it in the viewport. The tabs list the materials, textures and geometries.',
    })
}

_testStart()
init().finally(_testFinish)
