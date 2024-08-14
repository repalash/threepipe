import {
    _testFinish,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    ThreeViewer,
    TransformControlsPlugin,
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

    const transformControlsPlugin = viewer.addPluginSync(TransformControlsPlugin)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TransformControlsPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    // Get the underlying transform controls (instance of TransformControls2)
    const transformControls = transformControlsPlugin.transformControls
    console.log(transformControls)

    // Transform controls plugin automatically tracks the selected object in the PickingPlugin and shows the transform controls
    picking.setSelectedObject(model)

}

init().finally(_testFinish)
