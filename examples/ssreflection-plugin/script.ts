import {
    _testFinish, _testStart,
    BaseGroundPlugin,
    Color,
    GBufferPlugin,
    LoadingScreenPlugin,
    PickingPlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, SSAAPlugin, TemporalAAPlugin],
        // rgbm: false,
    })
    viewer.renderManager.stableNoise = true

    const inline = true
    const ssrefl = viewer.addPluginSync(new SSReflectionPlugin(inline))
    const ground = viewer.addPluginSync(BaseGroundPlugin)
    viewer.addPluginSync(PickingPlugin)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    ui.setupPluginUi(ssrefl, {expanded: true})
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    if (!ssrefl.inlineShaderRayTrace) {
        targetPreview.addTarget(() => ssrefl.target, 'ssrefl')
    }

    await viewer.load('https://samples.threepipe.org/demos/classic-watch.glb', {
        autoCenter: true,
        autoScale: false,
    })

    viewer.scene.backgroundColor = new Color(0x1B1B1F)
    ground.tonemapGround = false
    ground.material!.color!.set(0x1B1B1F)
    ground.material!.roughness = 0.2
    ground.material!.userData.separateEnvMapIntensity = true
    ground.material!.envMapIntensity = 0

}

_testStart()
init().then(_testFinish)
