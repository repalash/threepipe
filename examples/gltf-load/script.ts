import {_testFinish, _testStart, DropzonePlugin, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        // add optional plugins to load gltf with extensions like meshopt_compression, ktx2 etc
        // plugins: [GLTFMeshOptDecodePlugin, KTX2LoadPlugin, GLTFKHRMaterialVariantsPlugin, ...],
    })

    viewer.addPluginSync(LoadingScreenPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const loadStart = performance.now()
    const result = await viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    const loadMs = Math.round(performance.now() - loadStart)
    console.log(result)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'Loads a glTF 2.0 file (.gltf with its .bin and textures, or one .glb), the format threepipe saves too. Drop a glTF/GLB file or an HDR environment on the page, or open one here.',
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
