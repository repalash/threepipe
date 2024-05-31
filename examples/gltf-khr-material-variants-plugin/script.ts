import {_testFinish, GLTFKHRMaterialVariantsPlugin, IObject3D, SSAAPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [SSAAPlugin, GLTFKHRMaterialVariantsPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const result = await viewer.load<IObject3D>(
        'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/MaterialsVariantsShoe/glTF/MaterialsVariantsShoe.gltf',
        {
            autoCenter: true,
            autoScale: true,
        })

    ui.setupPluginUi(GLTFKHRMaterialVariantsPlugin, {expanded: true})
    ui.appendChild(result?.getObjectByName('Shoe')?.uiConfig)


}

init().finally(_testFinish)
