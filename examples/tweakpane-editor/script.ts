import {_testFinish, _testStart, DropzonePlugin, getUrlQueryParam, HemisphereLight} from 'threepipe'
import {TransfrSharePlugin} from '@threepipe/plugin-network'
import {ThreeEditor} from './ThreeEditor'

async function init() {

    const viewer = new ThreeEditor({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        msaa: checkQuery('msaa', true),
        rgbm: checkQuery('rgbm', true),
        debug: checkQuery('debug', false),
        assetManager: {
            storage: checkQuery('cache', true),
        },
        // set it to true if you only have opaque objects in the scene to get better performance.
        zPrepass: checkQuery('depthPrepass', checkQuery('zPrepass', false)),
        modelRootScale: parseFloat(getUrlQueryParam('modelRootScale', '1')!),
        dropzone: {
            autoImport: true,
            autoAdd: true,
            addOptions: {
                autoScale: checkQuery('autoScale', true),
                autoCenter: checkQuery('autoCenter', true),
                autoScaleRadius: parseFloat(getUrlQueryParam('autoScaleRadius', '2')!),
                clearSceneObjects: checkQuery('clearSceneObjectsOnDrop', false), // clear the scene before adding new objects on drop.
                license: getUrlQueryParam('licenseText') ?? undefined, // Any license to set on imported objects
            },
        },
    })
    await viewer.init()

    // for fat lines
    // GLTFLoader2.UseMeshLines = true
    // LineGeometryGenerator.UseMeshLines = true

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const transfr = viewer.getPlugin(TransfrSharePlugin)
    transfr && (transfr.queryParam = 'm')

    const model = getUrlQueryParam('m') || getUrlQueryParam('model')
    if (model) {
        const ext = getUrlQueryParam('ext') || getUrlQueryParam('model-extension') || undefined
        const loader = viewer.getPlugin(DropzonePlugin) ?? viewer
        const obj = await loader.load(model, {fileExtension: ext})
        console.log(obj)
    }

}

_testStart()
init().finally(_testFinish)

function checkQuery(key: string, def = true) {
    return !['false', 'no', 'f', '0'].includes(getUrlQueryParam(key, def ? 'yes' : 'no')!.toLowerCase())
}
