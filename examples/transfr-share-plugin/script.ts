import {
    _testFinish,
    AssetExporterPlugin,
    getUrlQueryParam,
    IObject3D,
    LoadingScreenPlugin,
    SceneUiConfigPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {TransfrSharePlugin} from '@threepipe/plugin-network'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [SceneUiConfigPlugin, LoadingScreenPlugin],
    })

    viewer.getPlugin(LoadingScreenPlugin)!.minimizeOnSceneObjectLoad = false

    const sharePlugin = viewer.addPluginSync(new TransfrSharePlugin())
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })

    const modelUrlParam = 'm' // this is the default in TransfrSharePlugin
    sharePlugin.queryParam = modelUrlParam
    sharePlugin.baseUrls.viewer = 'https://threepipe.org/examples/model-viewer/index.html'
    sharePlugin.baseUrls.editor = 'https://threepipe.org/examples/tweakpane-editor/index.html'

    const modelUrl = getUrlQueryParam(modelUrlParam) ??
        'https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf'
    const result = await viewer.load<IObject3D>(modelUrl, {
        autoCenter: true,
        autoScale: true,
    })

    ui.setupPluginUi(AssetExporterPlugin, {expanded: true})
    ui.setupPluginUi(TransfrSharePlugin, {expanded: true})
    ui.setupPluginUi(SceneUiConfigPlugin)

    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const config = model?.uiConfig
    if (config) ui.appendChild(config)

}

init().finally(_testFinish)
