import {
    _testFinish,
    _testStart,
    ACESFilmicToneMapping,
    assetFormats,
    Box3,
    createAssetContext,
    EquirectangularReflectionMapping,
    PerspectiveCamera,
    Scene,
    Vector3,
    WebGLRenderer,
} from 'threepipe'

// Load files with threepipe's asset loaders and render them with plain three.js, without a ThreeViewer.
async function init() {
    const canvas = document.getElementById('mcanvas') as HTMLCanvasElement
    const renderer = new WebGLRenderer({canvas, antialias: true})
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.toneMapping = ACESFilmicToneMapping
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 1, 0.01, 100)

    // Only the formats listed here are registered. Without `formats`, it loads everything the viewer loads.
    // The renderer picks the data type for HDR textures.
    const assets = createAssetContext({
        formats: [assetFormats.gltf, assetFormats.images, assetFormats.hdr],
        renderer,
    })
    // For a single file, the one-shot functions loadModel, loadTexture, loadAsset and exportAsset do the same.

    const environment = await assets.loadTexture('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    if (environment) {
        environment.mapping = EquirectangularReflectionMapping
        scene.environment = environment
        scene.background = environment
    }

    const model = await assets.loadModel('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf')
    if (!model) throw new Error('Unable to load the model')
    scene.add(model) // a three.js Object3D, with threepipe materials

    const box = new Box3().setFromObject(model)
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3()).length()
    camera.position.copy(center).add(new Vector3(0, 0, size * 1.1))
    camera.lookAt(center)

    const resize = () => {
        const {clientWidth: width, clientHeight: height} = canvas
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    renderer.setAnimationLoop(() => renderer.render(scene, camera))
}

_testStart()
init().finally(_testFinish)
