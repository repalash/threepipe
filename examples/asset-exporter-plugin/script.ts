import {
    _testFinish,
    AssetExporterPlugin,
    IObject3D,
    LoadingScreenPlugin,
    SceneUiConfigPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GLTFDracoExportPlugin} from '@threepipe/plugin-gltf-transform'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, AssetExporterPlugin, SceneUiConfigPlugin, GLTFDracoExportPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    ui.setupPluginUi(AssetExporterPlugin, {expanded: true})
    ui.setupPluginUi(SceneUiConfigPlugin)

    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const config = model?.uiConfig
    if (config) ui.appendChild(config)


}

init().finally(_testFinish)
