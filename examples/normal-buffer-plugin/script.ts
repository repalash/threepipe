import {
    _testFinish, _testStart,
    downloadBlob,
    HalfFloatType,
    LoadingScreenPlugin,
    NoColorSpace,
    NormalBufferPlugin,
    RenderTargetPreviewPlugin,
    SRGBColorSpace,
    ThreeViewer,
} from 'threepipe'
import {createExampleBar} from '../examples-utils/example-bar.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const normalPlugin = viewer.addPluginSync(new NormalBufferPlugin(HalfFloatType))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    const normalTarget = normalPlugin.target
    if (!normalTarget) {
        throw new Error('normalPlugin.target returned undefined')
    }

    viewer.renderManager.screenPass.overrideReadBuffer = normalTarget
    viewer.renderManager.screenPass.outputColorSpace = NoColorSpace // default is SRGBColorSpace


    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>normalTarget, 'normal')

    createExampleBar(viewer, [
        {type: 'button', label: 'Toggle Normal rendering', icon: 'layers', value: () => {
            const state = !!viewer.renderManager.screenPass.overrideReadBuffer
            viewer.renderManager.screenPass.overrideReadBuffer = state ? null : normalTarget
            viewer.renderManager.screenPass.outputColorSpace = state ? SRGBColorSpace : NoColorSpace
            viewer.setDirty()
        }},
        {type: 'button', label: 'Download snapshot', icon: 'camera', value: async() => {
            const blob = await viewer.getScreenshotBlob({mimeType: 'image/png'})
            if (blob) downloadBlob(blob, 'file.png')
            else console.error('Unable to get screenshot')
        }},
    ])

}

_testStart()
init().finally(_testFinish)
