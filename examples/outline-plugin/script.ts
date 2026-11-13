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
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
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
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
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

    // select the helmet, so the outline shows from the start
    if (model) viewer.getPlugin(PickingPlugin)?.setSelectedObject(model)

    createExampleCard(viewer, {
        description: 'OutlinePlugin (webgi-plugins) draws an outline around the selected object, with an optional highlight over it. Click a part to select it, or the empty space to clear the selection. The preview at the bottom is the outline target.',
        actions: [
            {type: 'checkbox', label: 'Outline', icon: 'scan', property: [outline, 'enabled']},
            {type: 'checkbox', label: 'Highlight', icon: 'sparkles', property: [outline, 'enableHighlight']},
            {type: 'slider', label: 'Thickness', bounds: [0, 10], stepSize: 0.01, property: [outline, 'thickness']},
            {type: 'color', label: 'Color', property: [outline, 'color'], onChange: () => outline.setDirty()},
        ],
    })
}

_testStart()
init().finally(_testFinish)
