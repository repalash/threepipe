import {_testFinish, _testStart, FrameFadePlugin, LoadingScreenPlugin, SSAAPlugin, ThreeViewer} from 'threepipe'
import {EnvironmentControlsPlugin, TilesRendererPlugin} from '@threepipe/plugin-3d-tiles-renderer'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        debug: false,
        renderScale: 'auto',
        dropzone: {
            allowedExtensions: ['gltf', 'glb', 'hdr', 'bin', 'png', 'jpeg', 'webp', 'jpg', 'exr', 'json'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: false,
            },
        },
        plugins: [LoadingScreenPlugin, FrameFadePlugin, SSAAPlugin, EnvironmentControlsPlugin],
    })

    viewer.scene.mainCamera.controlsMode = 'environment'
    viewer.scene.mainCamera.controls!.minDistance = 0.25
    viewer.scene.mainCamera.position.set(30, 30, 40)
    viewer.scene.mainCamera.lookAt(0, 0, 0)
    // viewer.scene.mainCamera.position.set(300, 300, 300)
    // viewer.scene.mainCamera.autoNearFar = false
    // viewer.scene.mainCamera.minNearPlane = 1
    // viewer.scene.mainCamera.maxFarPlane = 1000

    const tiles = viewer.addPluginSync(TilesRendererPlugin)

    tiles.load('https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/master/msl-dingo-gap/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize_tileset.json', {
        autoCenter: false,
        autoScale: true,
        autoScaleRadius: 30,
        tiles: {
            TilesFadePlugin: {
                fadeDuration: 2,
                fadeRootTiles: true,
            },
        },
    }).then(group => {
        if (group) {
            group.rotateX(Math.PI / 2)
            group.tilesRenderer.errorTarget = 12
            group.tilesRenderer.lruCache.minSize = 900
            group.tilesRenderer.lruCache.maxSize = 1300
        }
    })

    tiles.load('https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/master/msl-dingo-gap/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_sky/0528_0260184_to_s64o256_sky_tileset.json', {
        autoCenter: false,
        autoScale: true,
        autoScaleRadius: 30,
    }).then(group => {
        if (group) {
            group.rotateX(Math.PI / 2)
            // result.tilesRenderer.errorTarget = 12
        }
    })

    const ui = viewer.addPluginSync(TweakpaneUiPlugin)
    ui.setupPluginUi(TilesRendererPlugin)
    // ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
