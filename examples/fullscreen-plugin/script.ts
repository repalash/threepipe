import {_testFinish, _testStart, FullScreenPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const fullScreenPlugin = viewer.addPluginSync(new FullScreenPlugin())

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf')

    createSimpleButtons({
        ['Enter/Exit fullscreen']: () => {
            if (fullScreenPlugin.isFullScreen()) fullScreenPlugin.exit()
            else fullScreenPlugin.enter(viewer.container) // parameter is optional, if not specified, the viewer canvas will be used

            // or just use
            // fullScreenPlugin.toggle(document.body)
        },
    }, viewer.container)


    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(FullScreenPlugin)

}

_testStart()
init().finally(_testFinish)
