import {
    _testFinish, _testStart,
    IObject3D,
    LoadingScreenPlugin,
    MeshOptSimplifyModifierPlugin,
    PickingPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, LoadingScreenPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })

    const simplify = viewer.addPluginSync(MeshOptSimplifyModifierPlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    result?.traverse((obj) => {
        obj.materials?.map(m=>m.wireframe = true)
    })

    createExampleCard(viewer, {
        description: 'Reduces the triangles of the model with meshoptimizer (MeshOptSimplifyModifierPlugin). Each Simplify halves them; the panel on the right has the settings.',
        actions: [
            {type: 'button', label: 'Simplify', icon: 'triangle', value: async() => {
                await simplify.simplifyAll(result, {factor: 0.5})
            }},
        ],
    })

    ui.setupPluginUi(MeshOptSimplifyModifierPlugin)
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
