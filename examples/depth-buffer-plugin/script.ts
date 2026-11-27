import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    downloadBlob,
    HalfFloatType,
    LoadingScreenPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
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

    createExampleCard(viewer, {
        description: 'Renders the depth of the scene into a target (DepthBufferPlugin), shown in the preview at the bottom. Toggle to draw the depth on the canvas.',
        actions: [
            {type: 'button', label: 'Toggle Depth rendering', icon: 'layers', value: () => {
                viewer.renderManager.screenPass.overrideReadBuffer =
                    viewer.renderManager.screenPass.overrideReadBuffer ? null : depthTarget
                viewer.setDirty()
            }},
            {type: 'button', label: 'Download snapshot', icon: 'camera', value: async() => {
                const blob = await viewer.getScreenshotBlob({mimeType: 'image/png'})
                if (blob) downloadBlob(blob, 'file.png')
                else console.error('Unable to get screenshot')
            }},
        ],
    })

}

_testStart()
init().finally(_testFinish)
