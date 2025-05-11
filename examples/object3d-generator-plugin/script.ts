import {
    _testFinish, _testStart,
    CameraViewPlugin,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {HierarchyUiPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, CameraViewPlugin, Object3DWidgetsPlugin, HierarchyUiPlugin, LoadingScreenPlugin],
    })
    const generator = viewer.addPluginSync(Object3DGeneratorPlugin)

    viewer.scene.setBackgroundColor('#444466')

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    console.log(generator.generators)

    const object = generator.generate('light-directional', {color: 0x00ff00})
    console.log(object)

    viewer.getPlugin(PickingPlugin)?.setSelectedObject(object)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(Object3DGeneratorPlugin)!.expanded = true
    ui.setupPluginUi(HierarchyUiPlugin)
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)

