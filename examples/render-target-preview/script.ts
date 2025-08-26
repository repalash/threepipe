import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    HalfFloatType,
    LoadingScreenPlugin,
    NormalBufferPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    rgbm: true,
    zPrepass: false,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const depth = viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType, true))
    const normal = viewer.addPluginSync(new NormalBufferPlugin(HalfFloatType))

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.renderManager.autoBuildPipeline = false
    viewer.renderManager.pipeline = ['depth', 'normal', 'render', 'screen']

    targetPreview.addTarget(()=>depth.target, 'depth', false, true)
    targetPreview.addTarget(()=>normal.target, 'normal', false, false)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget, 'composer-1', false, false)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget2, 'composer-2', false, false)

}

_testStart()
init().finally(_testFinish)
