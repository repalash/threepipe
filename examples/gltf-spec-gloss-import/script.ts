import {_testFinish, _testStart, AssetExporterPlugin, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin} from '@threepipe/plugin-gltf-transform'

const viewer = new ThreeViewer({
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
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/tests/SpecGlossVsMetalRough.glb', {
        autoCenter: true,
        autoScale: true,
        confirmSpecGlossConversion: false, // prevents the confirmation dialog
    })
    if (!model) {
        console.error('Unable to load model')
        return
    }

}

_testStart()
init().finally(_testFinish)
