import {
    _testFinish, _testStart,
    BaseGroundPlugin,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        renderScale: 1,
        rgbm: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, SSAAPlugin, SSReflectionPlugin],
    })

    const ground = viewer.addPluginSync(BaseGroundPlugin)
    const taa = viewer.addPluginSync(new TemporalAAPlugin())
    taa.stableNoise = true
    console.log(taa)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    // const model = result?.getObjectByName('node_damagedHelmet_-6514')
    // const materials = (model?.materials || []) as PhysicalMaterial[]

    ui.setupPluginUi(taa)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(SSReflectionPlugin)

    ground.material!.roughness = 0.2

}

_testStart()
init().then(_testFinish)
