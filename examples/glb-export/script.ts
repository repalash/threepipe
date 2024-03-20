import {_testFinish, downloadBlob, IMaterial, IObject3D, ThreeViewer} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true})

async function init() {

    // load obj + mtl
    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    const helmet = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
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
        ['Download Helmet Object GLB']: async() => {
            const blob = await viewer.export(mesh, {
                exportExt: 'glb',
                embedUrlImages: true, // embed images in glb even when url is available.
            })
            if (!blob) {
                alert('Unable to export helmet object')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)
        },
        ['Download Helmet Material']: async() => {
            const blob = await viewer.export(<IMaterial>mesh.material)
            if (!blob) {
                alert('Unable to export helmet material')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)
        },
        ['Download Scene GLB (Without Viewer Config)']: async() => {
            const blob = await viewer.exportScene({viewerConfig: false})
            if (!blob || blob.ext !== 'glb') {
                alert('Unable to export scene')
                return
            }
            downloadBlob(blob, 'scene.glb')
        },
        ['Download Scene GLB (With Viewer Config)']: async() => {
            const blob = await viewer.exportScene({viewerConfig: true})
            if (!blob || blob.ext !== 'glb') {
                alert('Unable to export scene')
                return
            }
            downloadBlob(blob, 'scene_with_config.glb')
        },
    })

}

init().finally(_testFinish)
