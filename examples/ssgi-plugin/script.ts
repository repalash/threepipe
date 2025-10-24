import {
    _testFinish,
    BaseGroundPlugin, DirectionalLight2,
    GBufferPlugin,
    IObject3D, LoadingScreenPlugin, PhysicalMaterial,
    PickingPlugin,
    RenderTargetPreviewPlugin, SSAAPlugin,
    ThreeViewer, Object3DWidgetsPlugin, TransformControlsPlugin, AssetExporterPlugin, OrbitControls3, _testStart,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin, SSGIPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        zPrepass: false,
        renderScale: 'auto',
        maxRenderScale: 1.5,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, SSAAPlugin, TemporalAAPlugin, Object3DWidgetsPlugin, TransformControlsPlugin, AssetExporterPlugin, new VelocityBufferPlugin(undefined, false), SSReflectionPlugin],
        // rgbm: false,
    })
    viewer.renderManager.stableNoise = true

    viewer.getPlugin(SSReflectionPlugin)!.enabled = false

    const ssgi = viewer.addPluginSync(new SSGIPlugin())
    viewer.addPluginSync(new BaseGroundPlugin())

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/d7a3cc8e51d7c573771ae77a57f16b0662a905c6/2.0/Sponza/glTF/Sponza.gltf', {
        autoCenter: false,
        autoScale: true,
        autoScaleRadius: 30,
    })

    viewer.scene.modelRoot.traverse((o) => {
        if (o.material) {
            const mat = o.material as PhysicalMaterial
            mat.emissiveIntensity *= 10
        }
    })
    viewer.scene.environmentIntensity = 0.0

    ui.setupPluginUi(ssgi)
    ui.setupPluginUi(SSReflectionPlugin)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(TemporalAAPlugin)
    ui.setupPluginUi(VelocityBufferPlugin)
    ui.setupPluginUi(AssetExporterPlugin)

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(() => ssgi.target, 'ssgi')
    // const gb = viewer.getPlugin(GBufferPlugin)
    // targetPreview.addTarget(() => gb?.target, 'depth')

    const camera = viewer.scene.mainCamera
    camera.position.set(-1, 5, -0.7)
    camera.target.set(-4, 4, -0.7)
    const controls = camera.controls as OrbitControls3
    controls.minDistance = 2
    controls.maxDistance = 3
    controls.autoPushTarget = true
    controls.autoPullTarget = true

    const light = new DirectionalLight2()
    viewer.scene.addObject(light)
    light.position.set(0, 20, 0)
    light.lookAt(-25, 0, 0)
    light.intensity = 30
    light.castShadow = true
    light.shadowFrustum = 50
    light.shadowMapSize.set(1024, 1024)

    ui.appendChild(light.uiConfig)
}

_testStart()
init().then(_testFinish)
