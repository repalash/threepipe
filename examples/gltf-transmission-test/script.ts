import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    rgbm: true,
    zPrepass: false,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget, 'composer-1', false, false)
    viewer.renderManager.renderPass.preserveTransparentTarget = true
    targetPreview.addTarget(()=>viewer.renderManager.renderPass.transparentTarget, 'transparent', true, true)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget2, 'composer-2', false, false)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const [model, model2] = await Promise.all([
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/IridescenceLamp.glb', {
            autoCenter: true,
            autoScale: true,
        }),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/IridescentDishWithOlives.glb', {
            autoCenter: true,
            autoScale: true,
        }),
    ])

    if (!model || !model2) {
        console.error('model not loaded')
        return
    }
    model.position.x = -1
    model2.position.x = 1
    model2.position.y = -1.2

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(false))

    const m1 = model?.getObjectByName('lamp_transmission')
    const m2 = model2?.getObjectByName('glassCover')
    const materials = [...m1?.materials || [], ...m2?.materials || []]
    for (const material of materials) {
        const config = material.uiConfig
        if (!config) continue
        ui.appendChild(config)
    }

}

_testStart()
init().finally(_testFinish)
