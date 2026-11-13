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
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        tonemap: true, // this is true by default
        plugins: [LoadingScreenPlugin],
    })

    // A GBuffer(depth buffer here) is required for the `tonemapBackground` flag in TonemapPlugin to work
    viewer.addPluginSync(new DepthBufferPlugin(UnsignedByteType, true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    const tonemap = viewer.getPlugin(TonemapPlugin)!
    createExampleCard(viewer, {
        description: 'TonemapPlugin maps the HDR render to the screen in the screen pass (ACES Filmic by default). Turn it off to compare: the colours are then only clamped, so bright reflections clip and the white background is pure white instead of the ACES grey. Try the modes, saturation and contrast in the Tonemapping panel.',
        actions: [
            {type: 'checkbox', label: 'Tone mapping', icon: 'sun', property: [tonemap, 'enabled']},
            {type: 'slider', label: 'Exposure', bounds: [0, 2 * Math.PI], stepSize: 0.01, property: [tonemap, 'exposure']},
        ],
    })
    ui.setupPluginUi(TonemapPlugin)

}

_testStart()
init().finally(_testFinish)
