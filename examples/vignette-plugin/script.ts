import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, ThreeViewer, VignettePlugin} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const vignette = viewer.addPluginSync(VignettePlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    createExampleCard(viewer, {
        description: 'VignettePlugin darkens the corners of the final image towards a colour, in the screen pass (no extra render). Turn it off to compare; Power sets how far it reaches into the image.',
        actions: [
            {type: 'checkbox', label: 'Vignette', icon: 'aperture', property: [vignette, 'enabled']},
            {type: 'slider', label: 'Power', bounds: [0.1, 4], stepSize: 0.01, property: [vignette, 'power']},
            {type: 'color', label: 'Color', property: [vignette, 'color'], onChange: () => vignette.setDirty()},
        ],
    })

}

_testStart()
init().finally(_testFinish)
