import {
    _testFinish,
    _testStart,
    EditorViewWidgetPlugin,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
    timeout,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    viewer.scene.setBackgroundColor(0x151822)

    const plugin = viewer.addPluginSync(new EditorViewWidgetPlugin('bottom-left', 256))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(EditorViewWidgetPlugin)

    // look at the model from left
    plugin.setOrientation('-z')

    await timeout(1000) // wait for 1 sec

    // look at the model from back
    plugin.setOrientation('-x')

    await timeout(1000) // wait for 1 sec

    // look at the model from front
    plugin.setOrientation('+z')
}

_testStart()
init().finally(_testFinish)
