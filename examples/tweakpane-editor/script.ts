import {
    _testFinish,
    _testStart,
    BufferGeometry2,
    DropzonePlugin,
    getUrlQueryParam,
    HemisphereLight, ITexture, Mesh2,
    PhysicalMaterial,
} from 'threepipe'
import {TransfrSharePlugin} from '@threepipe/plugin-network'
import {ThreeEditor} from './ThreeEditor'
import {PlaneGeometryGenerator, SphereGeometryGenerator} from '@threepipe/plugin-geometry-generator'
import {initTimeline} from './timeline'

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

    const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
    hemiLight.name = 'Hemisphere Light'

    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    const transfr = viewer.getPlugin(TransfrSharePlugin)
    transfr && (transfr.queryParam = 'm')

    const model = getUrlQueryParam('m') || getUrlQueryParam('model')
    if (model) {
        const ext = getUrlQueryParam('ext') || getUrlQueryParam('model-extension') || undefined
        const loader = viewer.getPlugin(DropzonePlugin) ?? viewer
        const obj = await loader.load(model, {fileExtension: ext})
        console.log(obj)
    }

    const l = async()=>{
        // window.removeEventListener('mouseup', l)
        const plane = new Mesh2(
            new PlaneGeometryGenerator().generate(),
            new PhysicalMaterial(),
        )
        plane.name = 'Plane'
        plane.material.map = await viewer.load<ITexture>('https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/sintel.mp4') ?? null
        // plane.material.map = await viewer.load<ITexture>('https://cors-proxy.r2cache.com/https://www.sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4') ?? null
        await viewer.addSceneObject(plane)
    }
    // window.addEventListener('mouseup', l)
    l()

    initTimeline(viewer)
}

_testStart()
init().finally(_testFinish)

function checkQuery(key: string, def = true) {
    return !['false', 'no', 'f', '0'].includes(getUrlQueryParam(key, def ? 'yes' : 'no')!.toLowerCase())
}
