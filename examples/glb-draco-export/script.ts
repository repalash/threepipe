import {
    _testFinish,
    _testStart,
    AssetExporterPlugin,
    downloadBlob,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'
import {GLTFDracoExportPlugin} from '@threepipe/plugin-gltf-transform'

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

    // Note: see asset-exporter-plugin example as well

    // load obj + mtl
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const helmet = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!helmet) {
        console.error('Unable to load model')
        return
    }
    const mesh = helmet.getObjectByName('node_damagedHelmet_-6514')!

    // const blob = await viewer.export(helmetObject, {exportExt: 'glb'})
    // const blob = await viewer.exportScene({viewerConfig: false}) // export scene without viewer config
    // const blob = await viewer.exportScene() // export scene with viewer config and default settings.

    createSimpleButtons({
        ['Download Helmet Object GLB + DRACO']: async() => {
            const blob = await viewer.export(mesh, {
                exportExt: 'glb',
                embedUrlImages: true, // embed images in glb even when url is available.
                compress: true,
            })
            if (!blob) {
                alert('Unable to export helmet object')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)
        },
        ['Download Scene GLB (Without Viewer Config) + DRACO']: async() => {
            const blob = await viewer.exportScene({viewerConfig: false, compress: true})
            if (!blob || blob.ext !== 'glb') {
                alert('Unable to export scene')
                return
            }
            downloadBlob(blob, 'scene.glb')
        },
        ['Download Scene GLB (With Viewer Config) + DRACO']: async() => {
            const blob = await viewer.exportScene({viewerConfig: true, compress: true})
            if (!blob || blob.ext !== 'glb') {
                alert('Unable to export scene')
                return
            }
            downloadBlob(blob, 'scene_with_config.glb')
        },
    })

}

_testStart()
init().finally(_testFinish)
