import {_testFinish, DepthBufferPlugin, downloadBlob, HalfFloatType, ThreeViewer} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    rgbm: true,
    zPrepass: false,
})

async function init() {

    viewer.addPluginSync(new DepthBufferPlugin(HalfFloatType, true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.renderManager.autoBuildPipeline = false
    viewer.renderManager.pipeline = ['render', 'screen']

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

init().then(_testFinish)
