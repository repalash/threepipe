import {_testFinish, _testStart, downloadBlob, IMaterial, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({renderScale: 'auto', canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true})

async function init() {
    viewer.addPluginSync(LoadingScreenPlugin)

    // Note: see asset-exporter-plugin, gltf-export examples as well

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

    createExampleCard(viewer, {
        description: 'Exports an object, its material (.pmat), or the whole scene with or without the viewer settings, to a GLB file.',
        actions: [
            {type: 'button', label: 'Download Helmet Object GLB', icon: 'box', value: async() => {
                const blob = await viewer.export(mesh, {
                    exportExt: 'glb',
                    embedUrlImages: true, // embed images in glb even when url is available.
                })
                if (!blob) {
                    alert('Unable to export helmet object')
                    return
                }
                downloadBlob(blob, 'helmet.' + blob.ext)
            }},
            {type: 'button', label: 'Download Helmet Material', icon: 'palette', value: async() => {
                const blob = await viewer.export(<IMaterial>mesh.material)
                if (!blob) {
                    alert('Unable to export helmet material')
                    return
                }
                downloadBlob(blob, 'helmet.' + blob.ext)
            }},
            {type: 'button', label: 'Download Scene GLB (Without Viewer Config)', icon: 'package', value: async() => {
                const blob = await viewer.exportScene({viewerConfig: false})
                if (!blob || blob.ext !== 'glb') {
                    alert('Unable to export scene')
                    return
                }
                downloadBlob(blob, 'scene.glb')
            }},
            {type: 'button', label: 'Download Scene GLB (With Viewer Config)', icon: 'package', value: async() => {
                const blob = await viewer.exportScene({viewerConfig: true})
                if (!blob || blob.ext !== 'glb') {
                    alert('Unable to export scene')
                    return
                }
                downloadBlob(blob, 'scene_with_config.glb')
            }},
        ],
    })

}

_testStart()
init().finally(_testFinish)
