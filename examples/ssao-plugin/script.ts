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
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
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

    // Show the occlusion itself: a custom pipeline without the render pass, where the SSAO pass writes its result for the
    // screen pass (packing is 2 in the SSAOPlugin constructor, view the target with alpha = 1). Off: the automatic pipeline,
    // the final render with the occlusion applied.
    // To show the SSAO target on the screen instead: viewer.renderManager.screenPass.overrideReadBuffer = ssaoTarget
    const renderManager = viewer.renderManager
    let aoOnly = false
    const showAoOnly = (on: boolean) => {
        aoOnly = on
        ssaoPlugin.pass!.copyToWriteBuffer = on // so that the screen pass gets the SSAO result
        renderManager.autoBuildPipeline = !on
        if (on) renderManager.pipeline = ['gbuffer', 'ssao', 'progressive', 'screen']
    }

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>ssaoTarget, 'ssao', false, true, true, (s)=>`${s} = vec4(${s}.r);`)
    targetPreview.addTarget(()=>viewer.getPlugin(ProgressivePlugin)?.target, 'progressive', false, false, true)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.setupPluginUi(SSAOPlugin, {expanded: true})

    ui.setupPluginUi(ProgressivePlugin)

    createExampleCard(viewer, {
        description: 'SSAOPlugin computes ambient occlusion from the depth and normals of the gbuffer: the soft shadow in corners and creases. Show AO only draws the occlusion itself on the canvas; the previews at the bottom show the SSAO and progressive targets.',
        actions: [
            {type: 'checkbox', label: 'Show AO only', icon: 'contrast', getValue: () => aoOnly, setValue: showAoOnly},
            {type: 'slider', label: 'Intensity', bounds: [0, 4], stepSize: 0.001, property: [ssaoPlugin.pass!, 'intensity']},
            {type: 'slider', label: 'Radius', bounds: [0.1, 8], stepSize: 0.01, property: [ssaoPlugin.pass!, 'occlusionWorldRadius']},
        ],
    })
}

_testStart()
init().finally(_testFinish)
