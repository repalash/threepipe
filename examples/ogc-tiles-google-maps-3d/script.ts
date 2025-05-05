import {_testFinish, LoadingScreenPlugin, MathUtils, OrbitControls3, ThreeViewer} from 'threepipe'
import {TilesRendererPlugin, UnloadTilesPlugin, TileCompressionPlugin} from '@threepipe/plugin-3d-tiles-renderer'

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
        apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0M2VkOWIxYy00NGEyLTQ1N2QtOWYxYy01ZDNlYjdkN2U4N2MiLCJpZCI6Mjk5NTY5LCJpYXQiOjE3NDY0MzE1NTl9.iOdIsjY4zSnTfIXBx0Pl-yfsG24OuHTt2CQnIP5JRrQ',
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
