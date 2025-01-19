import {
    _testFinish,
    BaseGroundPlugin, DirectionalLight2,
    GBufferPlugin,
    IObject3D, LoadingScreenPlugin, PhysicalMaterial,
    PickingPlugin,
    RenderTargetPreviewPlugin, SSAAPlugin,
    ThreeViewer, Object3DWidgetsPlugin, TransformControlsPlugin, AssetExporterPlugin, OrbitControls3,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
// @ts-expect-error todo fix
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
    await viewer.setEnvironmentMap('https://hdrihaven.r2cache.com/hdr/1k/empty_warehouse_01_1k.hdr', {
        setBackground: true,
    })
    await viewer.load<IObject3D>('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Sponza/glTF/Sponza.gltf', {
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
    viewer.scene.envMapIntensity = 0.0

    ui.setupPluginUi(ssgi)
    ui.setupPluginUi(SSReflectionPlugin)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(TemporalAAPlugin)
    ui.setupPluginUi(VelocityBufferPlugin)
    ui.setupPluginUi(AssetExporterPlugin)

    const targetPreview = await viewer.addPlugin(RenderTargetPreviewPlugin)
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
    light.shadow.camera.left = -25
    light.shadow.camera.right = 25
    light.shadow.camera.top = 25
    light.shadow.camera.bottom = -25
    light.shadow.mapSize.set(1024, 1024)

    // todo add to DirectionalLight
    light.uiConfig.children!.push({
        type: 'vec2',
        label: 'Shadow Map Size',
        property: [light?.shadow, 'mapSize'],
        onChange: ()=>{
            light.shadow.map?.dispose()
            light.shadow.mapPass?.dispose()
            light.shadow.map = null as any
            light.shadow.mapPass = null as any
        },
    },
    {
        type: 'slider',
        bounds: [-0.001, 0.001],
        stepSize: 0.00002,
        label: 'Shadow Bias',
        property: [light?.shadow, 'bias'],
        onChange: (e)=>light.setDirty(e),
    },
    {
        type: 'slider',
        bounds: [-0.1, 0.1],
        stepSize: 0.005,
        label: 'Shadow Normal Bias',
        property: [light?.shadow, 'normalBias'],
        onChange: (e)=>light.setDirty(e),
    },
    {
        type: 'slider',
        bounds: [0, 5],
        label: 'Shadow radius',
        property: [light?.shadow, 'radius'],
        onChange: (e)=>light.setDirty(e),
    },
    {
        type: 'slider',
        bounds: [0.1, 50],
        label: 'Shadow frustum',
        // property: [light.shadow, 'radius'],
        getValue: ()=>{
            return light.shadow.camera.right * 2
        },
        setValue: (v: number)=>{
            light.shadow.camera.left = -v / 2
            light.shadow.camera.right = v / 2
            light.shadow.camera.top = v / 2
            light.shadow.camera.bottom = -v / 2
        },
        onChange: (e)=>light.setDirty(e),
    })

    ui.appendChild(light.uiConfig)
}

init().then(_testFinish)
