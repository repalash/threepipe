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
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
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

    createExampleCard(viewer, {
        description: 'Exports render targets as images: the composer target (half float) as EXR or WebP, the depth target (8 bit) as PNG or JPEG.',
        actions: [
            {type: 'button', label: 'Download composer (EXR)', icon: 'image', value: async() => {
                await downloadTarget(composerBuffer) // default for Float and HalfFloat buffers is EXR.
            }},
            // UnsignedByte targets can only be exported in webp, png, jpeg format.
            {type: 'button', label: 'Download depth (PNG)', icon: 'layers', value: async() => {
                await downloadTarget(depthBuffer) // default for UnsignedByte buffers is PNG.
            }},
            {type: 'button', label: 'Download depth (JPEG)', icon: 'layers', value: async() => {
                await downloadTarget(depthBuffer, 'jpeg')
            }},
            // HalfFloat targets can also be exported in webp, png, jpeg format, but they will be clamped
            {type: 'button', label: 'Download composer (WEBP)', icon: 'image', value: async() => {
                if (!isWebpExportSupported()) {
                    alert('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
                    return
                }
                await downloadTarget(composerBuffer, 'webp')
            }},
        ],
    })

}

_testStart()
init().finally(_testFinish)
