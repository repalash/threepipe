import {
    _testFinish, _testStart,
    CanvasSnapshotPlugin,
    isWebpExportSupported,
    LoadingScreenPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, SSAAPlugin],
})

async function init() {
    const snapshotPlugin = viewer.addPluginSync(new CanvasSnapshotPlugin())

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    createSimpleButtons({
        ['Download snapshot (jpeg)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await snapshotPlugin.downloadSnapshot('snapshot.jpeg', {
                mimeType: 'image/jpeg', // mime type of the image
                quality: 0.9, // quality of the image (0-1) only for jpeg and webp
                displayPixelRatio: 2, // render scale
                waitForProgressive: true,
                progressiveFrames: 64, // wait for 64 frames of ProgressivePlugin/SSAA before exporting
            })
            btn.disabled = false
        },
        ['Download snapshot (1024x1024 size, png)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            // save scale
            const scale = viewer.renderManager.renderScale
            // set fixed render size
            viewer.setRenderSize({width: 1024, height: 1024})
            // (optional) hide the canvas. (not needed if you have an overlay)
            await snapshotPlugin.downloadSnapshot('snapshot.png', {
                mimeType: 'image/png', // mime type of the image
            })
            // revert scale
            viewer.renderManager.renderScale = scale
            // revert render size to fill container
            viewer.setSize()
            btn.disabled = false
        },
        ['Download snapshot (crop rect, png)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await snapshotPlugin.downloadSnapshot('snapshot.png', {
                scale: 1, // scale the final image
                displayPixelRatio: 2, // render scale
                mimeType: 'image/png', // mime type of the image
                rect: { // region to take snapshot. Crop center of the canvas
                    height: viewer.canvas.clientHeight / 2,
                    width: viewer.canvas.clientWidth / 2,
                    x: viewer.canvas.clientWidth / 4,
                    y: viewer.canvas.clientHeight / 4,
                },
            })
            btn.disabled = false
        },
        ['Download snapshot (webp)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            if (!isWebpExportSupported()) {
                alert('WebP export is not supported in this browser, try the latest version of chrome, firefox or edge.')
                btn.disabled = false
                return
            }
            await snapshotPlugin.downloadSnapshot('snapshot.webp', {
                mimeType: 'image/webp', // mime type of the image
                scale: 1, // scale the final image
                quality: 0.9, // quality of the image (0-1) only for jpeg and webp
                displayPixelRatio: 2, // render scale
            })
            btn.disabled = false
        },
        ['Download 3x3 Tiles (png zip)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await snapshotPlugin.downloadSnapshot('snapshot', {
                mimeType: 'image/png', // mime type of the image
                // scale: 1, // scale the final image
                // quality: 0.9, // quality of the image (0-1) only for jpeg and webp
                displayPixelRatio: 4, // render scale
                tileRows: 3,
                tileColumns: 3,
            })
            btn.disabled = false
        },
    })

}

_testStart()
init().finally(_testFinish)
