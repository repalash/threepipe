import {_testFinish, RenderTargetPreviewPlugin, SSAAPlugin, SSAOPlugin, ThreeViewer, UnsignedByteType} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [SSAAPlugin],
    tonemap: false,
})

async function init() {

    const ssaoPlugin = viewer.addPluginSync(new SSAOPlugin(UnsignedByteType, 1))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    const ssaoTarget = ssaoPlugin.target
    if (!ssaoTarget) {
        throw new Error('ssaoPlugin.target returned undefined')
    }

    // to render ssao buffer to screen, uncomment this line:
    // viewer.renderManager.screenPass.overrideReadBuffer = ssaoTarget
    // or set a custom pipeline
    // viewer.renderManager.autoBuildPipeline = false
    // viewer.renderManager.pipeline = ['gbuffer', 'ssao', 'screen']

    const targetPreview = await viewer.addPlugin(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>ssaoTarget, 'ssao', false, true, true, (s)=>`${s} = vec4(${s}.r);`)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.setupPluginUi(SSAOPlugin)
}

init().finally(_testFinish)
