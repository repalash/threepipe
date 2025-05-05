import {_testFinish, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TilesRendererPlugin} from '@threepipe/plugin-3d-tiles-renderer'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        debug: true,
        renderScale: 'auto',
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr', 'json'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
    })

    viewer.scene.mainCamera.position.set(3, 3, 4)
    // viewer.scene.mainCamera.position.set(300, 300, 300)
    // viewer.scene.mainCamera.autoNearFar = false
    // viewer.scene.mainCamera.minNearPlane = 1
    // viewer.scene.mainCamera.maxFarPlane = 1000

    const tiles = viewer.addPluginSync(TilesRendererPlugin)

    viewer.addPluginSync(LoadingScreenPlugin)

    // await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
    //     setBackground: true,
    // })

    const result = await tiles.load('https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/c7a9a7f7607e8759d16c26fb83815ad1cd1fd865/example/data/tileset.json', {
        autoCenter: true,
        autoScale: true,
        // autoScaleRadius: 100,
    })
    console.log(result)

}

init().finally(_testFinish)
