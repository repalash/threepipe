import {_testFinish, _testStart, downloadBlob, IAsset, ITexture, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleBar} from '../examples-utils/example-bar.js'

const viewer = new ThreeViewer({renderScale: 'auto', canvas: document.getElementById('mcanvas') as HTMLCanvasElement})

async function init() {
    viewer.addPluginSync(LoadingScreenPlugin)

    // import a hdr file
    const dataTexture = await viewer.import<ITexture>('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    if (!dataTexture) {
        console.error('Unable to import texture')
        return
    }

    // export as exr
    const blob = await viewer.export(dataTexture, {exportExt: 'exr'})
    if (!blob || blob.ext !== 'exr') {
        console.error('Unable to export texture', blob)
        return
    }

    // load the exr as environment map
    const map = await viewer.setEnvironmentMap({
        path: 'file.exr',
        file: blob,
    } as IAsset)
    if (!map) {
        console.error('Unable to load exr')
        return
    }
    viewer.scene.background = map

    createExampleBar(viewer, [
        {type: 'button', label: 'Download .exr', icon: 'download', value: () => downloadBlob(blob, 'file.exr')},
    ])

}

_testStart()
init().finally(_testFinish)
