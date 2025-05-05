import {_testFinish, LoadingScreenPlugin, OrbitControls3, ThreeViewer} from 'threepipe'
import {TileCompressionPlugin, TilesRendererPlugin, UnloadTilesPlugin} from '@threepipe/plugin-3d-tiles-renderer'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        debug: true,
        renderScale: 'auto',
        zPrepass: false,
        rgbm: false,
        // modelRootScale: 0.01,
    })

    viewer.scene.mainCamera.position.set(4800000, 2570000, 14720000)
    // viewer.scene.mainCamera.position.set(300, 300, 300)
    viewer.scene.mainCamera.autoNearFar = false
    viewer.scene.mainCamera.minNearPlane = 1
    viewer.scene.mainCamera.maxFarPlane = 160000000
    viewer.scene.mainCamera.fov = 60
    const controls = viewer.scene.mainCamera.controls as OrbitControls3
    controls.minDistance = 6.379e6
    controls.maxDistance = 160000000
    controls.clampMax.set(160000000, 160000000, 160000000)
    // controls.minPolarAngle = 0
    // controls.maxPolarAngle = 3 * Math.PI / 8
    controls.enableDamping = true
    // controls.autoRotate = true
    // controls.autoRotateSpeed = 0.5
    // controls.enablePan = false

    const tiles = viewer.addPluginSync(TilesRendererPlugin)

    viewer.addPluginSync(LoadingScreenPlugin)

    const result = await tiles.loadCesiumIon({
        assetId: '2275207',
        apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0M2VkOWIxYy00NGEyLTQ1N2QtOWYxYy01ZDNlYjdkN2U4N2MiLCJpZCI6Mjk5NTY5LCJpYXQiOjE3NDY0MzE1NTl9.iOdIsjY4zSnTfIXBx0Pl-yfsG24OuHTt2CQnIP5JRrQ',
        autoRefreshToken: true,
    }, {
        autoCenter: false,
        autoScale: false,
        // autoScaleRadius: 300,
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
    }
    console.log(result)

}

init().finally(_testFinish)
