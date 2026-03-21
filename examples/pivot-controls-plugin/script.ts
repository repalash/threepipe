import {
    _testFinish, _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    PivotControlsPlugin,
    PivotEditPlugin,
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

    const pivotControlsPlugin = viewer.addPluginSync(PivotControlsPlugin)
    const pivotEdit = viewer.addPluginSync(PivotEditPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PivotControlsPlugin, {expanded: true})
    ui.setupPluginUi(PivotEditPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    // Get the underlying pivot controls (instance of PivotControls2)
    const pivotControls = pivotControlsPlugin.pivotControls
    console.log(pivotControls)

    // Pivot controls plugin automatically tracks the selected object in the PickingPlugin and shows the pivot controls
    picking.setSelectedObject(model)

}

_testStart()
init().finally(_testFinish)
