import {
    _testFinish,
    _testStart,
    downloadBlob,
    GLTFLoader2,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true})

async function init() {
    viewer.addPluginSync(LoadingScreenPlugin)

    // Note: see asset-exporter-plugin, glb-export examples as well

    const basePath = 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/'
    const scene = 'DamagedHelmet.gltf'
    GLTFLoader2._EmbedResourcePath = true // this is required if the exported file will be saved somewhere other than the original path

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const helmet = await viewer.load<IObject3D>(basePath + scene, { // this is the standard model but once exported with the viewer with base paths.
        autoCenter: true,
        autoScale: true,
        importAsModelRoot: true,
    })
    if (!helmet) {
        console.error('Unable to load model')
        return
    }
    console.log(helmet)

    createSimpleButtons({
        ['Download Helmet Object GLTF']: async() => {
            const blob = await viewer.export(helmet, {
                exportExt: 'gltf',
                _basePath: basePath,
            })
            if (!blob) {
                alert('Unable to export helmet object')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)

            const gltfJSON = await blob.text()
            const json = JSON.parse(gltfJSON)
            console.log(json)
            console.log('JSON Size', gltfJSON.length) // ~734KB
            for (const image of json.images) {
                console.log(image.uri)
                if (!image.uri || !image.uri.startsWith('Default_')) {
                    console.error('[TEST] - Something went wrong')
                }
            }
            if (json.extras?.resourcePath !== basePath) {
                console.error('[TEST] - Resource path is incorrect', json.extras?.resourcePath)
            }
        },
        ['Download GLTF (RootPath Reference)']: async() => {
            helmet._sChildren = [] // set the serializable children to empty, so only the root object is exported, along with url that can be used to reload the object.
            helmet.userData.rootPathRefresh = true
            const blob = await viewer.export(helmet, { // note that we are using the `helmet` (parent) object here, and not the `mesh`.
                exportExt: 'gltf',
                _basePath: basePath,
            })
            delete helmet._sChildren
            if (!blob) {
                alert('Unable to export helmet object')
                return
            }
            downloadBlob(blob, 'helmet.' + blob.ext)
            const gltfJSON = await blob.text()
            const json = JSON.parse(gltfJSON)
            console.log(json)
            console.log('JSON Size', gltfJSON.length) // ~380 Bytes

            if (json.images) { // there shouldnt be any assets in this
                console.error('[TEST] - Something went wrong')
            }
            if (json.extras?.resourcePath !== basePath) {
                console.error('[TEST] - Resource path is incorrect', json.extras?.resourcePath)
            }
        },

    })

}

_testStart()
init().finally(_testFinish)
