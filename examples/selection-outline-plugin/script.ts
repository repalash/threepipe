import {
    _testFinish,
    _testStart,
    BoxGeometry,
    IObject3D,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    PickingPlugin,
    ProgressivePlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {SelectionOutlinePlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, ProgressivePlugin],
    })

    // the outline follows the selection and the hover of the PickingPlugin
    const picking = viewer.addPluginSync(PickingPlugin)
    picking.hoverEnabled = true
    picking.widgetEnabled = false // the outline replaces the box widget
    // adds the GBufferPlugin (the depth for the x-ray outline) when it is not there
    viewer.addPluginSync(SelectionOutlinePlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const watch = await viewer.load<IObject3D>('https://samples.threepipe.org/demos/classic-watch.glb', {autoCenter: true, autoScale: true})

    // a box in front of the watch: the part of the selection behind it is dashed (x-ray)
    const box = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new PhysicalMaterial({color: 0xdddddd, roughness: 0.5}))
    box.name = 'Box'
    box.position.set(0.5, 0, 1.2)
    viewer.scene.addObject(box)

    // select the watch: the lines inside are its parts. Click to select another object, hover to see its outline.
    if (watch) picking.setSelectedObject(watch)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(SelectionOutlinePlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)
}

_testStart()
init().finally(_testFinish)
