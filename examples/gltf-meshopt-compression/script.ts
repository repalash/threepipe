import {
    _testFinish,
    _testStart,
    DropzonePlugin,
    GLTFMeshOptDecodePlugin,
    IObject3D,
    KTX2LoadPlugin,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GLTFMeshOptDecodePlugin, KTX2LoadPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    const loadStart = performance.now()
    const results = await Promise.all([
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/coffeemat.glb', options),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/facecap.glb', options),
    ])
    const loadMs = Math.round(performance.now() - loadStart)
    // side by side
    results.forEach((result, i) => {
        if (!result) return
        result.position.x = i * 2 - 1
    })

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'GLTFMeshOptDecodePlugin loads glTF files compressed with meshoptimizer (EXT_meshopt_compression), and KTX2LoadPlugin their KTX2 textures: a coffee machine and an animated face from the three.js examples.',
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
