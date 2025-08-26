import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: false,
    rgbm: true,
    zPrepass: false,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const [env, model, model2] = await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/IridescenceLamp.glb', {
            autoCenter: true,
            autoScale: true,
        }),
        viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/IridescentDishWithOlives.glb', {
            autoCenter: true,
            autoScale: true,
        }),
    ])
    console.log(env, model, model2)

    if (!model || !model2) {
        console.error('model not loaded')
        return
    }
    model.position.x = -1
    model2.position.x = 1
    model2.position.y = -1.2

}

_testStart()
init().finally(_testFinish)
