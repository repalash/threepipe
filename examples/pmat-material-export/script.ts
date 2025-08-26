import {
    _testFinish, _testStart,
    downloadBlob,
    IMaterial,
    IObject3D,
    LoadingScreenPlugin,
    Mesh,
    SphereGeometry,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const helmet = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!helmet) {
        alert('Unable to load model')
        return
    }
    const mesh = helmet.getObjectByName('node_damagedHelmet_-6514')!
    const material = mesh.materials?.[0]

    helmet.position.setX(-3)
    const sphere = new Mesh(new SphereGeometry(0.5, 32, 32), material)
    sphere.position.setX(2)
    await viewer.addSceneObject(sphere)

    const matBlob = await viewer.export(material)
    if (!matBlob) return

    const material2 = await viewer.assetManager.importer.importSingle<IMaterial>({file: matBlob, path: 'mat.' + matBlob.ext})
    if (!material2) {
        return
    }

    console.log(material2)

    const sphere2 = new Mesh(new SphereGeometry(0.5, 32, 32), material2)
    sphere2.position.setX(0)
    await viewer.addSceneObject(sphere2)

    createSimpleButtons({
        ['Download PMAT']: async() => {
            const blob = await viewer.export(material)
            if (!blob) {
                alert('Unable to export material')
                return
            }
            downloadBlob(blob, 'material.' + blob.ext)
        },
    })

}

_testStart()
init().finally(_testFinish)
