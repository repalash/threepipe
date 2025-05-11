import {
    _testFinish, _testStart,
    AssetExporterPlugin,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
// @ts-expect-error todo fix
import {BloomPlugin, SSGIPlugin, SSReflectionPlugin, TemporalAAPlugin, OutlinePlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        zPrepass: false,
        renderScale: 'auto',
        maxRenderScale: 1.5,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, PickingPlugin, SSAAPlugin, TemporalAAPlugin, OutlinePlugin, Object3DWidgetsPlugin, AssetExporterPlugin, new SSReflectionPlugin(ssrInline), SSGIPlugin],
        // rgbm: false,
    })
    viewer.renderManager.stableNoise = true

    viewer.getPlugin(SSReflectionPlugin)!.enabled = false

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const model = await viewer.load<IObject3D>('https://asset-samples.threepipe.org/demos/sponza-ssgi-ssr.glb')
    viewer.scene.envMapIntensity = 0.0
    viewer.getPlugin(SSGIPlugin)!.pass.stepCount = 8

    ui.setupPluginUi(SSGIPlugin)
    ui.setupPluginUi(SSReflectionPlugin)
    model?.traverse((obj) => {
        if (obj.isLight) {
            ui.appendChild(obj.uiConfig)
        }
    })
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(TemporalAAPlugin)

    const targetPreview = await viewer.addPlugin(RenderTargetPreviewPlugin)
    targetPreview.addTarget(() => viewer.getPlugin(SSGIPlugin)!.target, 'ssgi')
    !ssrInline && targetPreview.addTarget(() => viewer.getPlugin(SSReflectionPlugin)!.target, 'ssr')

}

// todo: inline = false has a bug, not clearing maybe?
const ssrInline = true

_testStart()
init().then(_testFinish)
