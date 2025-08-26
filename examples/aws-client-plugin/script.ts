import {
    _testFinish, _testStart,
    AssetExporterPlugin,
    IObject3D,
    LoadingScreenPlugin,
    SceneUiConfigPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {AWSClientPlugin} from '@threepipe/plugin-network'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [SceneUiConfigPlugin, LoadingScreenPlugin],
    })

    viewer.getPlugin(LoadingScreenPlugin)!.minimizeOnSceneObjectLoad = false

    const awsPlugin = viewer.addPluginSync(new AWSClientPlugin())
    // set parameters and export. This can all be done from the UI also.
    awsPlugin.accessKeyId = '00000000000000000000'
    awsPlugin.accessKeySecret = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    awsPlugin.endpointURL = 'https://s3.amazonaws.com/bucket/'
    awsPlugin.pathPrefix = 'some/path/'
    // or load a json file with the parameters
    // the json file can be creating by entering the data in the UI and clicking the download preset json option.
    // await viewer.load('file.json')

    // export and upload
    // const blob = await viewer.exportScene()
    // this will upload to s3 if the plugin parameters are set up correctly
    // await viewer.exportBlob(blob, 'file.glb')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })

    const modelUrl = 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'
    const result = await viewer.load<IObject3D>(modelUrl, {
        autoCenter: true,
        autoScale: true,
    })

    ui.setupPluginUi(AssetExporterPlugin, {expanded: true})
    ui.setupPluginUi(AWSClientPlugin, {expanded: true})
    ui.setupPluginUi(SceneUiConfigPlugin)

    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const config = model?.uiConfig
    if (config) ui.appendChild(config)

}

_testStart()
init().finally(_testFinish)
