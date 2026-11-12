import {_testFinish, _testStart, FullScreenPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const fullScreenPlugin = viewer.addPluginSync(new FullScreenPlugin())

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    createExampleCard(viewer, {
        description: 'Puts the viewer container (with this card) in full screen (FullScreenPlugin). The Full Screen folder on the right has the same actions.',
        actions: [
            {type: 'button', label: 'Enter/Exit fullscreen', icon: 'maximize', value: () => {
                if (fullScreenPlugin.isFullScreen()) fullScreenPlugin.exit()
                else fullScreenPlugin.enter(viewer.container) // parameter is optional, if not specified, the viewer canvas will be used

                // or just use
                // fullScreenPlugin.toggle(document.body)
            }},
        ],
    })


    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(FullScreenPlugin)

}

_testStart()
init().finally(_testFinish)
