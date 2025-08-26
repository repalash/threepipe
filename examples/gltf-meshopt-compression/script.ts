import {
    _testFinish, _testStart,
    GLTFMeshOptDecodePlugin,
    IObject3D,
    KTX2LoadPlugin,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GLTFMeshOptDecodePlugin, KTX2LoadPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const options = {
        autoCenter: true,
        autoScale: true,
    };
    (await Promise.all([
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/coffeemat.glb', options),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/facecap.glb', options),
    ])).forEach((result, i) => {
        if (!result) return
        result.position.x = i * 2 - 1
    })

}

_testStart()
init().finally(_testFinish)
