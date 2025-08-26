import {
    _testFinish, _testStart,
    LoadingScreenPlugin, ProgressivePlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    SSAOPlugin,
    ThreeViewer,
    UnsignedByteType,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [SSAAPlugin, LoadingScreenPlugin],
    tonemap: false,
})

async function init() {

    const ssaoPlugin = viewer.addPluginSync(new SSAOPlugin(UnsignedByteType, 1, true, 2))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.scene.mainCamera.position.set(-4, 0., 0)

    const ssaoTarget = ssaoPlugin.target
    if (!ssaoTarget) {
        throw new Error('ssaoPlugin.target returned undefined')
    }

    // set a custom pipeline to see SSAO. (Note that packing is set to 2 in SSAOPlugin constructor view the target with alpha=1)
    viewer.renderManager.autoBuildPipeline = false
    viewer.renderManager.pipeline = ['gbuffer', 'ssao', 'progressive', 'screen']
    ssaoPlugin.pass!.copyToWriteBuffer = true // so that screen pass can access ssao result

    // or to render ssao buffer to screen, uncomment this line:
    // viewer.renderManager.screenPass.overrideReadBuffer = ssaoTarget

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>ssaoTarget, 'ssao', false, true, true, (s)=>`${s} = vec4(${s}.r);`)
    targetPreview.addTarget(()=>viewer.getPlugin(ProgressivePlugin)?.target, 'progressive', false, false, true)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.setupPluginUi(SSAOPlugin, {expanded: true})
    ui.setupPluginUi(ProgressivePlugin)
}

_testStart()
init().finally(_testFinish)
