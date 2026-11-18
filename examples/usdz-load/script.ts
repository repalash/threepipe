import {_testFinish, _testStart, DropzonePlugin, IObject3D, LoadingScreenPlugin, ThreeViewer, USDZLoadPlugin} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['usdz', 'usda', 'hdr', 'exr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.addPluginSync(USDZLoadPlugin)

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    const loadStart = performance.now()
    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/usdz/saeukkang.usdz', options),
    ])
    const loadMs = Math.round(performance.now() - loadStart)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'USDZLoadPlugin loads USDZ and USDA files (the format of Apple\'s AR Quick Look) with the USDZ loader of three.js. Drop or open another .usdz.',
        actions: [
            {type: 'button', label: 'Open file…', icon: 'file-code', value: () => viewer.getPlugin(DropzonePlugin)?.promptForFile()},
            {type: 'monitor', label: 'Meshes', getValue: () => stats.meshes.toLocaleString()},
            {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
            {type: 'monitor', label: 'Load time', getValue: () => `${loadMs} ms`},
        ],
    })

}

_testStart()
init().finally(_testFinish)
