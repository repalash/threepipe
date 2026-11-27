import {_testFinish, _testStart, ChromaticAberrationPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const aberration = viewer.addPluginSync(ChromaticAberrationPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    createExampleCard(viewer, {
        description: 'ChromaticAberrationPlugin shifts the red and blue channels apart towards the edges of the image, like a cheap lens, in the screen pass. Look at the edges of the helmet near the corners; turn it off to compare.',
        actions: [
            {type: 'checkbox', label: 'Chromatic aberration', icon: 'blend', property: [aberration, 'enabled']},
            {type: 'slider', label: 'Intensity', bounds: [0, 1], stepSize: 0.001, property: [aberration, 'intensity']},
        ],
    })

}

_testStart()
init().finally(_testFinish)
