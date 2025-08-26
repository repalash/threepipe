import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, ThreeViewer, TonemapPlugin} from 'threepipe'
import {BlueprintJsUiPlugin} from '@threepipe/plugin-blueprintjs'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new BlueprintJsUiPlugin())
    ui.appendChild(viewer.uiConfig)
    ui.setupPluginUi(TonemapPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    const mesh = result?.getObjectByName('node_damagedHelmet_-6514')
    ui.appendChild(mesh?.uiConfig)

}

_testStart()
init().finally(_testFinish)
