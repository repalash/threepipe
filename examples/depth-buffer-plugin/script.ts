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
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const depthPlugin = viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    // Disable automatic near/far plane calculation based on scene bounding box
    viewer.scene.mainCamera.userData.autoNearFar = false
    viewer.scene.mainCamera.userData.minNearPlane = 1
    viewer.scene.mainCamera.userData.maxFarPlane = 10
    viewer.scene.refreshScene()

    const depthTarget = depthPlugin.target
    if (!depthTarget) {
        throw new Error('depthPlugin.target returned undefined')
    }

    // to render depth buffer to screen, uncomment this line:
    // viewer.renderManager.screenPass.overrideReadBuffer = depthTarget


    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(()=>depthTarget, 'depth')

    createSimpleButtons({
        ['Toggle Depth rendering']: () => {
            viewer.renderManager.screenPass.overrideReadBuffer =
                viewer.renderManager.screenPass.overrideReadBuffer ? null : depthTarget
            viewer.setDirty()
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
