import {_testFinish, _testStart, DirectionalLight2, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BasicSVGRendererPlugin} from '@threepipe/plugin-svg-renderer'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        tonemap: false,
        plugins: [LoadingScreenPlugin],
    })

    viewer.scene.mainCamera.controls!.enableDamping = false

    viewer.addPluginSync(new BasicSVGRendererPlugin(true))

    viewer.scene.addObject(new DirectionalLight2(0x0000ff, 1))
    const l = new DirectionalLight2(0xff0000, 1)
    l.target.position.set(-1, -1, -1)
    viewer.scene.addObject(l)

    await viewer.load('https://threejs.org/examples/models/gltf/ShadowmappableMesh.glb', {
        autoCenter: true,
        autoScale: true,
    })

    await viewer.doOnce('postFrame') // wait for one frame

    // disable rendering so canvas is transparent
    viewer.renderManager.autoBuildPipeline = false
    viewer.renderManager.pipeline = [] // this will disable main viewer rendering
    // // make it invisible.
    viewer.canvas.style.opacity = '0'

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPlugins(BasicSVGRendererPlugin)
    ui.appendChild(l.uiConfig)
}

_testStart()
init().finally(_testFinish)
