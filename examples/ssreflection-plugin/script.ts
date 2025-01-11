import {
    _testFinish,
    BaseGroundPlugin,
    GBufferPlugin,
    IObject3D, LoadingScreenPlugin,
    PickingPlugin,
    RenderTargetPreviewPlugin, SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
// @ts-expect-error todo fix
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, SSAAPlugin, TemporalAAPlugin],
        // rgbm: false,
    })
    viewer.renderManager.stableNoise = true

    const inline = true
    const ssrefl = viewer.addPluginSync(new SSReflectionPlugin(inline))
    const ground = viewer.addPluginSync(BaseGroundPlugin)
    viewer.addPluginSync(PickingPlugin)
    console.log(ssrefl)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    // const model = result?.getObjectByName('node_damagedHelmet_-6514')
    // const materials = (model?.materials || []) as PhysicalMaterial[]

    ui.setupPluginUi(ssrefl)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)

    // for (const material of materials) {
    //     ui.appendChild(material.uiConfig)
    // }

    // bloom.pass!.intensity = 3
    // bloom.pass!.threshold = 1

    // viewer.scene.background = null
    // bloom.pass!.bloomDebug = true

    ground.material!.roughness = 0.2
    const targetPreview = await viewer.addPlugin(RenderTargetPreviewPlugin)
    if (!ssrefl.inlineShaderRayTrace) {
        targetPreview.addTarget(() => ssrefl.target, 'ssrefl')
    }
    // const gb = viewer.getPlugin(GBufferPlugin)
    // targetPreview.addTarget(() => gb?.target, 'depth')

}

init().then(_testFinish)
