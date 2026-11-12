import {_testFinish, _testStart, downloadBlob, isWebpExportSupported, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleBar} from '../examples-utils/example-bar.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
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

    createExampleBar(viewer, [
        {type: 'button', label: 'Download snapshot (PNG)', icon: 'image', value: async() => {
            await downloadSnapshot()
        }},
        {type: 'button', label: 'Download snapshot (JPEG)', icon: 'image', value: async() => {
            await downloadSnapshot('jpeg')
        }},
        {type: 'button', label: 'Download snapshot (WEBP)', icon: 'image', value: async() => {
            if (!isWebpExportSupported()) {
                alert('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
                return
            }
            await downloadSnapshot('webp')
        }},
    ])

}

_testStart()
init().finally(_testFinish)
