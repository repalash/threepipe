import {_testFinish, DepthBufferPlugin, IObject3D, ThreeViewer, TonemapPlugin, UnsignedByteType} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    })

    // A GBuffer(depth buffer here) is required for the `tonemapBackground` flag in TonemapPlugin to work
    viewer.addPluginSync(new DepthBufferPlugin(UnsignedByteType, true))
    viewer.addPluginSync(new TonemapPlugin())

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(TonemapPlugin)

}

init().then(_testFinish)
