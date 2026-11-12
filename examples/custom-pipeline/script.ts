import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    downloadBlob,
    HalfFloatType,
    LoadingScreenPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {createExampleBar} from '../examples-utils/example-bar.js'

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

    createExampleBar(viewer, [
        {type: 'folder', label: 'Pipeline', children: [
            {type: 'button', label: 'depth', value: () => {
                viewer.renderManager.pipeline = ['depth']
            }},
            {type: 'button', label: 'render', value: () => {
                viewer.renderManager.pipeline = ['render']
            }},
            {type: 'button', label: 'render, screen', value: () => {
                viewer.renderManager.pipeline = ['render', 'screen']
            }},
            {type: 'button', label: 'depth, render, screen', value: () => {
                viewer.renderManager.pipeline = ['depth', 'render', 'screen']
            }},
        ]},
        {type: 'button', label: 'Download snapshot', icon: 'camera', value: async() => {
            const blob = await viewer.getScreenshotBlob({mimeType: 'image/png'})
            if (blob) downloadBlob(blob, 'file.png')
            else console.error('Unable to get screenshot')
        }},
    ])

}

_testStart()
init().finally(_testFinish)
