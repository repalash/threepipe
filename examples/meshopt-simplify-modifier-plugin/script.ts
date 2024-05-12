import {_testFinish, IObject3D, MeshOptSimplifyModifierPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin],
    })

    const simplify = viewer.addPluginSync(MeshOptSimplifyModifierPlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    result?.traverse((obj) => {
        obj.materials?.map(m=>m.wireframe = true)
    })

    createSimpleButtons({
        ['Simplify']: async(_: HTMLButtonElement) => {
            await simplify.simplifyAll(result, {factor: 0.5})
        },
    })

    ui.setupPluginUi(MeshOptSimplifyModifierPlugin)
    ui.setupPluginUi(PickingPlugin)

}

init().finally(_testFinish)
