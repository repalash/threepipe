import {
    _testFinish, _testStart,
    GLTFKHRMaterialVariantsPlugin,
    IObject3D,
    LoadingScreenPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [SSAAPlugin, GLTFKHRMaterialVariantsPlugin, LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const result = await viewer.load<IObject3D>(
        'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/MaterialsVariantsShoe/glTF/MaterialsVariantsShoe.gltf',
        {
            autoCenter: true,
            autoScale: true,
        })

    ui.setupPluginUi(GLTFKHRMaterialVariantsPlugin, {expanded: true})
    ui.appendChild(result?.getObjectByName('Shoe')?.uiConfig)


}

_testStart()
init().finally(_testFinish)
