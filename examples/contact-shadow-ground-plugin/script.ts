import {_testFinish, ContactShadowGroundPlugin, IObject3D, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    })

    viewer.addPluginSync(ContactShadowGroundPlugin)

    await Promise.all([
        viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf'),
    ])

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(ContactShadowGroundPlugin, {expanded: true})

}

init().then(_testFinish)
