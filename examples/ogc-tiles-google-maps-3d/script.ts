import {_testFinish, LoadingScreenPlugin, MathUtils, OrbitControls3, ThreeViewer} from 'threepipe'
import {TilesRendererPlugin, UnloadTilesPlugin, TileCompressionPlugin} from '@threepipe/plugin-3d-tiles-renderer'
import {CESIUM_ION_API_TOKEN} from '../globals.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        debug: true,
        renderScale: 'auto',
    })

    // viewer.scene.mainCamera.position.set(4800000, 2570000, 14720000 )
    viewer.scene.mainCamera.position.set(500, 500, 500)
    viewer.scene.mainCamera.autoNearFar = false
    viewer.scene.mainCamera.minNearPlane = 1
    viewer.scene.mainCamera.maxFarPlane = 1600000
    viewer.scene.mainCamera.fov = 60
    const controls = viewer.scene.mainCamera.controls as OrbitControls3
    controls.minDistance = 1
    controls.maxDistance = 1e4 * 2
    controls.minPolarAngle = 0
    controls.maxPolarAngle = 3 * Math.PI / 8
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.5
    controls.enablePan = false

    const tiles = viewer.addPluginSync(TilesRendererPlugin)

    viewer.addPluginSync(LoadingScreenPlugin)

    const result = await tiles.loadCesiumIon({
        assetId: '2275207',
        apiToken: CESIUM_ION_API_TOKEN,
        autoRefreshToken: true,
    }, {
        autoCenter: false,
        tiles: {
            TilesFadePlugin: true,
            plugins: [
                ()=>new TileCompressionPlugin(),
                ()=>new UnloadTilesPlugin(),
            ],
        },
    })
    if (result) {
        result.rotateX(-Math.PI / 2)
        // @ts-expect-error deprecated?
        result.tilesRenderer.setLatLonToYUp(35.6586 * MathUtils.DEG2RAD, 139.7454 * MathUtils.DEG2RAD) // Tokyo Tower
        result.tilesRenderer.errorTarget = 1
    }
    console.log(result)

}

init().finally(_testFinish)
