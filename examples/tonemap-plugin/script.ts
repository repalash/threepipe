import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
    TonemapPlugin,
    UnsignedByteType,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        tonemap: true, // this is true by default
        plugins: [LoadingScreenPlugin],
    })

    // A GBuffer(depth buffer here) is required for the `tonemapBackground` flag in TonemapPlugin to work
    viewer.addPluginSync(new DepthBufferPlugin(UnsignedByteType, true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TonemapPlugin)

}

_testStart()
init().finally(_testFinish)
