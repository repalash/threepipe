import {_testFinish, CanvasSnapshotPlugin, isWebpExportSupported, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin],
})

async function init() {
    const snapshotPlugin = viewer.addPluginSync(new CanvasSnapshotPlugin())

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load('https://threejs.org/examples/models/gltf/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    createSimpleButtons({
        ['Download snapshot (rect png)']: async(btn: HTMLButtonElement) => {
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
        ['Download snapshot (jpeg)']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            await snapshotPlugin.downloadSnapshot('snapshot.jpeg', {
                mimeType: 'image/jpeg', // mime type of the image
                quality: 0.9, // quality of the image (0-1) only for jpeg and webp
                displayPixelRatio: 2, // render scale
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
    })

}

init().finally(_testFinish)
