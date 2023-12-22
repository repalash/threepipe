import {_testFinish, CameraViewPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, CameraViewPlugin],
    })
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)

    viewer.scene.setBackgroundColor('#444466')

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    console.log(generator.generators)
    const sphere = generator.generateObject('sphere', {radius: 0.5, widthSegments: 32, heightSegments: 32})
    viewer.scene.addObject(sphere)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(GeometryGeneratorPlugin)
    ui.setupPluginUi(PickingPlugin)

}

init().then(_testFinish)

