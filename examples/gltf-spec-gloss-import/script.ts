import {_testFinish, _testStart, AssetExporterPlugin, DropzonePlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin} from '@threepipe/plugin-gltf-transform'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    dropzone: {
        addOptions: {
            disposeSceneObjects: true,
        },
    },
    msaa: true,
})

async function init() {

    viewer.addPluginSync(LoadingScreenPlugin)
    viewer.addPluginSync(AssetExporterPlugin)
    viewer.addPluginSync(GLTFDracoExportPlugin)
    viewer.addPluginSync(GLTFSpecGlossinessConverterPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const loadStart = performance.now()
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/tests/SpecGlossVsMetalRough.glb', {
        autoCenter: true,
        autoScale: true,
        confirmSpecGlossConversion: false, // prevents the confirmation dialog
    })
    const loadMs = Math.round(performance.now() - loadStart)
    if (!model) {
        console.error('Unable to load model')
        return
    }

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'GLTFSpecGlossinessConverterPlugin converts the old KHR_materials_pbrSpecularGlossiness materials of a glTF to metalness/roughness when it loads. In this Khronos test file the specular-glossiness and metal-rough versions should look the same.',
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
