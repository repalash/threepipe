import {
    _testFinish, _testStart,
    CameraViewPlugin,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [CameraViewPlugin, Object3DGeneratorPlugin, LoadingScreenPlugin],
    })
    const widgets = viewer.addPluginSync(Object3DWidgetsPlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(Object3DWidgetsPlugin)

    viewer.scene.setBackgroundColor('#444466')

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    console.log(widgets.helpers)

    const generator = viewer.getPlugin(Object3DGeneratorPlugin)!
    let object

    object = generator.generate('camera-perspective', {
        position: new Vector3(5, 5, 0),
    })
    ui.appendChild(object?.uiConfig)
    object = generator.generate('light-directional', {
        position: new Vector3(5, 0, 5),
    })
    ui.appendChild(object?.uiConfig)
    object = generator.generate('light-spot', {
        position: new Vector3(-5, 0, 5),
    })
    ui.appendChild(object?.uiConfig)
    object = generator.generate('light-point', {
        position: new Vector3(-5, 5, -5),
    })
    ui.appendChild(object?.uiConfig)

    viewer.scene.mainCamera.position.z += 10
    viewer.scene.mainCamera.setDirty()

}

_testStart()
init().finally(_testFinish)

