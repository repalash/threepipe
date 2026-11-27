import {
    _testFinish, _testStart,
    downloadBlob,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    SphereGeometry,
    ThreeViewer,
} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({renderScale: 'auto', canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    // An ambientCG HDRI zip (https://ambientcg.com/view?id=DayEnvironmentHDRI019, CC0): the EXR in it, as the environment and the background.
    // The ambientCG urls are the download urls, not the https://ambientcg.com/get?file=... links (their redirect has no CORS header)
    await viewer.setEnvironmentMap('https://acg-download.struffelproductions.com/file/ambientCG-Web/download/DayEnvironmentHDRI019_iFG6vEcn/DayEnvironmentHDRI019_1K.zip', {
        fileExtension: 'acgzip',
        setBackground: true,
    })

    // A Poly Haven material glTF (https://polyhaven.com/a/worn_planks, CC0). On the Poly Haven CDN, the files of a glTF are
    // not next to it: the API lists their urls (`include`), a url modifier gives them to the glTF loader.
    // (A copy of the glTF folder on another host needs no modifier)
    const files = await fetch('https://api.polyhaven.com/files/worn_planks').then(async r => r.json())
    const gltf = files.gltf['1k'].gltf as {url: string, include: Record<string, {url: string}>}
    const includes = new Map(Object.entries(gltf.include).map(([path, f]) => [new URL(path, gltf.url).href, f.url]))
    const polyhavenUrls = (url: string) => includes.get(url) ?? url
    viewer.assetManager.importer.addURLModifier(polyhavenUrls)

    const [polyhaven, ambientCG] = await Promise.all([
        // the first material in the glTF
        viewer.load<PhysicalMaterial>(gltf.url, {
            fileExtension: 'phmatgltf',
        }),
        // An ambientCG material zip (https://ambientcg.com/view?id=DiamondPlate003, CC0): a material with the maps in the zip
        viewer.load<PhysicalMaterial>('https://acg-download.struffelproductions.com/file/ambientCG-Web/download/DiamondPlate003_GWNMRtS9/DiamondPlate003_1K-JPG.zip', {
            fileExtension: 'acgzip',
        }),
    ])
    viewer.assetManager.importer.removeURLModifier(polyhavenUrls)
    if (!polyhaven || !ambientCG) {
        alert('Unable to load the materials')
        return
    }

    const geometry = new SphereGeometry(1, 64, 32)
    const sphere1 = new Mesh(geometry, polyhaven)
    sphere1.position.setX(-1.2)
    const sphere2 = new Mesh(geometry, ambientCG)
    sphere2.position.setX(1.2)
    viewer.scene.addObject(sphere1)
    viewer.scene.addObject(sphere2)
    viewer.scene.mainCamera.position.set(0, 0, 4.5)

    createExampleCard(viewer, {
        description: 'Loads a Poly Haven material glTF (left, worn_planks) and an ambientCG material zip (right, DiamondPlate003) as PhysicalMaterials with viewer.load, and an ambientCG HDRI zip as the environment.',
        actions: [
            {type: 'button', label: 'Download ambientCG PMAT', icon: 'palette', value: async() => {
                const blob = await viewer.export(ambientCG)
                if (!blob) {
                    alert('Unable to export material')
                    return
                }
                downloadBlob(blob, 'material.' + blob.ext)
            }},
        ],
    })

}

_testStart()
init().finally(_testFinish)
