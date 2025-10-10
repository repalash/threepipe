import {_testFinish, _testStart, downloadBlob, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true})

async function init() {
    viewer.addPluginSync(LoadingScreenPlugin)

    // Note: see asset-exporter-plugin, glb-export examples as well

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

    createSimpleButtons({
        ['Download Helmet Object GLTF']: async() => {
            const blob = await viewer.export(mesh, {
                exportExt: 'gltf',
                embedUrlImages: true, // embed images in glb even when url is available.
            })
            if (!blob) {
                alert('Unable to export helmet object')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)

            const gltfJSON = await blob.text()
            console.log(JSON.parse(gltfJSON))
            console.log('JSON Size', gltfJSON.length)
        },
        ['Download GLTF (RootPath Reference)']: async() => {
            helmet._sChildren = [] // set the serializable children to empty, so only the root object is exported, along with url that can be used to reload the object.
            helmet.userData.rootPathRefresh = true
            const blob = await viewer.export(helmet, { // note that we are using the `helmet` (parent) object here, and not the `mesh`.
                exportExt: 'gltf',
            })
            delete helmet._sChildren
            if (!blob) {
                alert('Unable to export helmet object')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)
            const gltfJSON = await blob.text()
            console.log(JSON.parse(gltfJSON))
            console.log('JSON Size', gltfJSON.length)
        },
    })

}

_testStart()
init().finally(_testFinish)
