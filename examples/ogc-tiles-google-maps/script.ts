import {_testFinish, _testStart, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {
    GlobeControls2,
    GlobeControlsPlugin,
    TileCompressionPlugin,
    TilesRendererPlugin,
    UnloadTilesPlugin,
} from '@threepipe/plugin-3d-tiles-renderer'
import {CESIUM_ION_API_TOKEN} from '../globals.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        debug: true,
        renderScale: 'auto',
        zPrepass: false,
        rgbm: false,
        // modelRootScale: 0.01,
        plugins: [LoadingScreenPlugin, GlobeControlsPlugin],
    })

    viewer.scene.mainCamera.position.set(4800000, 2570000, 14720000)
    // viewer.scene.mainCamera.position.set(300, 300, 300)
    viewer.scene.mainCamera.lookAt(0, 0, 0)
    viewer.scene.mainCamera.autoNearFar = false
    // viewer.scene.mainCamera.minNearPlane = 1
    viewer.scene.mainCamera.maxFarPlane = 160000000
    viewer.scene.mainCamera.fov = 60
    viewer.scene.mainCamera.controlsMode = 'globe'
    const controls = viewer.scene.mainCamera.controls as GlobeControls2
    // controls.minDistance = 6.379e6
    controls.maxDistance = 160000000
    controls.enableDamping = true

    const tiles = viewer.addPluginSync(TilesRendererPlugin)

    const result = await tiles.loadCesiumIon({
        assetId: '2275207',
        apiToken: CESIUM_ION_API_TOKEN,
        autoRefreshToken: true,
    }, {
        autoCenter: false,
        autoScale: false,
        tiles: {
            TilesFadePlugin: true,
            plugins: [
                ()=>new UnloadTilesPlugin(),
                ()=>new TileCompressionPlugin(),
            ],
        },
    })
    if (result) {
        result.rotateX(-Math.PI / 2)
        result.tilesRenderer.errorTarget = 40
        controls.setTilesRenderer(result.tilesRenderer)
    }

}

_testStart()
init().finally(_testFinish)
