import {
    _testFinish, _testStart,
    BaseGroundPlugin,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin, RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {
    BloomPlugin,
    OutlinePlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'

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
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, SSAAPlugin, TemporalAAPlugin, new VelocityBufferPlugin(undefined, false)],
    })
    viewer.renderManager.stableNoise = true

    const inline = true
    const ssrefl = viewer.addPluginSync(new SSReflectionPlugin(inline))
    const ground = viewer.addPluginSync(new BaseGroundPlugin())
    ground.material!.roughness = 0.2
    viewer.addPluginSync(PickingPlugin)
    console.log(ssrefl)

    const outline = viewer.addPluginSync(OutlinePlugin)
    outline.enableHighlight = true

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    ui.setupPluginUi(outline)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(TemporalAAPlugin)
    ui.setupPluginUi(VelocityBufferPlugin)

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>outline.target, 'outline', false, true, true, (s)=>`${s} = 1.-${s};`)

}

_testStart()
init().then(_testFinish)
