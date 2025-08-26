import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    downloadBlob,
    HalfFloatType,
    LoadingScreenPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    rgbm: true,
    zPrepass: false,
    plugins: [LoadingScreenPlugin],
    renderScale: 'auto',
})

async function init() {

    const depth = viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType, true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.renderManager.autoBuildPipeline = false
    viewer.renderManager.pipeline = ['depth', 'render', 'screen']

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>depth.target, 'depth', false, true)
    targetPreview.addTarget(()=>viewer.renderManager.composerTarget, 'composer-1', false, false)

    createSimpleButtons({
        ['depth']: () => {
            viewer.renderManager.pipeline = ['depth']
        },
        ['render']: () => {
            viewer.renderManager.pipeline = ['render']
        },
        ['render, screen']: () => {
            viewer.renderManager.pipeline = ['render', 'screen']
        },
        ['depth, render, screen']: () => {
            viewer.renderManager.pipeline = ['depth', 'render', 'screen']
        },
        ['Download snapshot']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            const blob = await viewer.getScreenshotBlob({mimeType: 'image/png'})
            if (blob) downloadBlob(blob, 'file.png')
            else console.error('Unable to get screenshot')
            btn.disabled = false
        },
    })

}

_testStart()
init().finally(_testFinish)
