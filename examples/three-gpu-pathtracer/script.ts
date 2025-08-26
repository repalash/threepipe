import {
    _testFinish,
    _testStart,
    BaseGroundPlugin,
    CanvasSnapshotPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    ProgressivePlugin,
    ThreeViewer,
    TonemapPlugin,
} from 'threepipe'
import {ThreeGpuPathTracerPlugin} from '@threepipe/plugin-path-tracing'
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
        plugins: [LoadingScreenPlugin, PickingPlugin, ProgressivePlugin, BaseGroundPlugin, CanvasSnapshotPlugin, ThreeGpuPathTracerPlugin],
    })

    viewer.getPlugin(ProgressivePlugin)!.maxFrameCount = 500

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: true})
    const modelUrl = 'https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf'
    const result = await viewer.load<IObject3D>(modelUrl, {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

    const ground = viewer.getPlugin(BaseGroundPlugin)?.material
    if (ground) {
        // make reflective
        ground.roughness = 0.1
        ground.metalness = 0.9
        ground.color?.set(0xffffff)
        ground.setDirty()
    }

    // optional
    // const controls = viewer.scene.mainCamera.controls as EnvironmentControls2
    // result && controls.setTilesRenderer(result.tilesRenderer)

    const ui = viewer.addPluginSync(TweakpaneUiPlugin)
    // ui.appendChild(controls.uiConfig)
    ui.setupPluginUi(ThreeGpuPathTracerPlugin)
    ui.setupPluginUi(ProgressivePlugin)
    ui.setupPluginUi(CanvasSnapshotPlugin)
    ui.setupPluginUi(TonemapPlugin)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
