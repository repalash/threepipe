import {_testFinish, _testStart, DropzonePlugin, IObject3D, LoadingScreenPlugin, PLYLoadPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['ply', 'hdr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.addPluginSync(PLYLoadPlugin)

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    const loadStart = performance.now()
    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/ply/ascii/dolphins_colored.ply', options),
        viewer.load<IObject3D>('https://threejs.org/examples/models/ply/binary/Lucy100k.ply', options),
    ])
    const loadMs = Math.round(performance.now() - loadStart)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'PLYLoadPlugin loads PLY files, ASCII and binary, with vertex colours: the coloured dolphins (ASCII) and the Lucy statue (binary). Drop or open another .ply.',
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
