import {
    _testFinish, _testStart,
    DepthBufferPlugin,
    downloadBlob,
    isWebpExportSupported,
    LoadingScreenPlugin,
    ThreeViewer,
    UnsignedByteType,
    WebGLRenderTarget,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    rgbm: false, // this will make the composer target not use RGBM encoding, and use HalfFloat. Otherwise, its UnsignedByteType
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const depthPlugin = viewer.addPluginSync(DepthBufferPlugin, UnsignedByteType)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    const composerBuffer = viewer.renderManager.composerTarget as WebGLRenderTarget
    const depthBuffer = depthPlugin.target!

    async function downloadTarget(target: WebGLRenderTarget, type = '') {
        const blob = await viewer.export(target, {exportExt: type})

        if (blob) downloadBlob(blob, target.texture.name + '.' + blob.ext)
        else alert('Unable to get screenshot')
    }

    createSimpleButtons({
        ['Download composer (EXR)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await downloadTarget(composerBuffer) // default for Float and HalfFloat buffers is EXR.
            btn.disabled = false
        },
        // UnsignedByte targets can only be exported in webp, png, jpeg format.
        ['Download depth (PNG)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await downloadTarget(depthBuffer) // default for UnsignedByte buffers is PNG.
            btn.disabled = false
        },
        ['Download depth (JPEG)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await downloadTarget(depthBuffer, 'jpeg')
            btn.disabled = false
        },
        // HalfFloat targets can also be exported in webp, png, jpeg format, but they will be clamped
        ['Download composer (WEBP)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            if (!isWebpExportSupported()) {
                alert('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
                btn.disabled = false
                return
            }
            await downloadTarget(composerBuffer, 'webp')
            btn.disabled = false
        },
    })

}

_testStart()
init().finally(_testFinish)
