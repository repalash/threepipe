import {_testFinish, _testStart, LoadingScreenPlugin, PickingPlugin, ThreeViewer} from 'threepipe'
import {EnvironmentControls2, EnvironmentControlsPlugin, TilesRendererPlugin} from '@threepipe/plugin-3d-tiles-renderer'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

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
        plugins: [LoadingScreenPlugin, EnvironmentControlsPlugin, PickingPlugin],
    })

    viewer.scene.mainCamera.controlsMode = 'environment'

    viewer.scene.mainCamera.position.set(150, 150, 150)
    viewer.scene.mainCamera.lookAt(0, 0, 0)
    // viewer.scene.mainCamera.autoNearFar = false
    // viewer.scene.mainCamera.minNearPlane = 1
    // viewer.scene.mainCamera.maxFarPlane = 1000

    const tiles = viewer.addPluginSync(TilesRendererPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const result = await tiles.load('https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/c7a9a7f7607e8759d16c26fb83815ad1cd1fd865/example/data/tileset.json', {
        autoCenter: true,
        autoScale: true,
        autoScaleRadius: 100,
        tiles: {
            // TilesFadePlugin: false,
        },
    })
    console.log(result)

    // optional
    const controls = viewer.scene.mainCamera.controls as EnvironmentControls2
    result && controls.setTilesRenderer(result.tilesRenderer)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin)
    ui.appendChild(controls.uiConfig)
    ui.setupPluginUi(TilesRendererPlugin)
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
