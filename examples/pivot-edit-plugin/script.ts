import {
    _testFinish, _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    PivotEditPlugin,
    TransformControlsPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    viewer.scene.setBackgroundColor(0x151822)

    const picking = viewer.addPluginSync(PickingPlugin)
    const transformControls = viewer.addPluginSync(TransformControlsPlugin)
    const pivotEdit = viewer.addPluginSync(PivotEditPlugin)

    console.log(transformControls, pivotEdit)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TransformControlsPlugin, {expanded: true})
    ui.setupPluginUi(PivotEditPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    // Select the model to show controls
    picking.setSelectedObject(model)

}

_testStart()
init().finally(_testFinish)
