import {
    _testFinish,
    _testStart,
    BaseGroundPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const ground = viewer.addPluginSync(new BaseGroundPlugin())

    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'),
    ])

    // Configure ground properties
    ground.size = 10
    ground.yOffset = 0
    ground.material!.color?.set('#aaaaaa')
    ground.material!.roughness = 0.9
    ground.material!.metalness = 0.1
    ground.material!.setDirty()

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(BaseGroundPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
