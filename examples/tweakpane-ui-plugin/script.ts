import {_testFinish, IObject3D, LoadingScreenPlugin, ThreeViewer, TonemapPlugin} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.appendChild(viewer.uiConfig)
    ui.setupPluginUi(TonemapPlugin)
    ui.setupPluginUi(TweakpaneUiPlugin) // to change the color scheme

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    const mesh = result?.getObjectByName('node_damagedHelmet_-6514')
    ui.appendChild(mesh?.uiConfig)

}

init().finally(_testFinish)
