import {_testFinish, DepthBufferPlugin, HalfFloatType, RenderTargetPreviewPlugin, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    rgbm: true,
    zPrepass: false,
})

async function init() {

    const depth = viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType, true))
    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.renderManager.autoBuildPipeline = false
    viewer.renderManager.pipeline = ['depth', 'render', 'screen']

    targetPreview.addTarget(()=>depth.getTarget(), 'depth', false, true)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget, 'composer-1', false, false)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget2, 'composer-2', false, false)

}

init().then(_testFinish)
