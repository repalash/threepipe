import {_testFinish, _testStart, downloadBlob, isWebpExportSupported, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

// Note: see also: CanvasSnapshotPlugin

async function init() {

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    async function downloadSnapshot(type = 'png') {
        const blob = await viewer.getScreenshotBlob({mimeType: 'image/' + type, quality: 0.85})
        // or to get data url:
        // const dataUrl = await viewer.getScreenshotDataUrl({mimeType: 'image/' + type, quality: 0.85})

        if (blob) downloadBlob(blob, 'snapshot.' + type)
        else alert('Unable to get screenshot')
    }

    createSimpleButtons({
        ['Download snapshot (PNG)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await downloadSnapshot()
            btn.disabled = false
        },
        ['Download snapshot (JPEG)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await downloadSnapshot('jpeg')
            btn.disabled = false
        },
        ['Download snapshot (WEBP)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            if (!isWebpExportSupported()) {
                alert('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
                btn.disabled = false
                return
            }
            await downloadSnapshot('webp')
            btn.disabled = false
        },
    })

}

_testStart()
init().finally(_testFinish)
