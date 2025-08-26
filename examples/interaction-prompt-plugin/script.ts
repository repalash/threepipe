import {_testFinish, _testStart, InteractionPromptPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const interactionPrompt = viewer.addPluginSync(new InteractionPromptPlugin())
    // distance in pixels
    interactionPrompt.animationDistance = 120
    // duration of one loop in ms
    interactionPrompt.animationDuration = 2000
    // set pause duration in between animations
    interactionPrompt.animationPauseDuration = 1000
    // delay before starting the animation again
    interactionPrompt.autoStartDelay = 5000
    // rotation distance in radians
    interactionPrompt.rotationDistance = 1

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(InteractionPromptPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
