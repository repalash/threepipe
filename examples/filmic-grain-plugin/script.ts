import {_testFinish, _testStart, FilmicGrainPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin],
    })

    const grain = viewer.addPluginSync(FilmicGrainPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')

    createExampleCard(viewer, {
        description: 'FilmicGrainPlugin adds film grain noise to the final image, in the screen pass. Turn it off to compare. Multiply scales the colour by the grain instead of adding it, so dark areas stay clean.',
        actions: [
            {type: 'checkbox', label: 'Film grain', icon: 'film', property: [grain, 'enabled']},
            {type: 'slider', label: 'Intensity', bounds: [0, 20], stepSize: 0.01, property: [grain, 'intensity']},
            {type: 'checkbox', label: 'Multiply', icon: 'layers', property: [grain, 'multiply']},
        ],
    })

}

_testStart()
init().finally(_testFinish)
