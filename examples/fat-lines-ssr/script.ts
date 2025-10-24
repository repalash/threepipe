import {
    _testFinish,
    _testStart,
    BaseGroundPlugin,
    Color,
    DirectionalLight2,
    EasingFunctions,
    GBufferPlugin,
    GLTFLoader2,
    IObject3D,
    LineMaterial2,
    LoadingScreenPlugin,
    PickingPlugin, PopmotionPlugin, ProgressivePlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [
            LoadingScreenPlugin,
            ProgressivePlugin,
            GBufferPlugin, BloomPlugin, SSReflectionPlugin, TemporalAAPlugin,
            PickingPlugin, BaseGroundPlugin,
        ],
        dropzone: true,
    })

    GLTFLoader2.UseMeshLines = true

    viewer.scene.backgroundColor = new Color(0x333333)

    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    // viewer.scene.environmentIntensity = 0.1

    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/demos/temple-lines.glb.zip', {
        autoScale: true,
        autoCenter: true,
    })

    const material = viewer.materialManager.findMaterialsByName('Stone')[0] as LineMaterial2
    material.linewidth = 3
    material.color.setHSL(0, 0.5, 0.7).multiplyScalar(5)
    material.setDirty()

    model!.castShadow = true

    const light = new DirectionalLight2()
    light.position.set(1, 1, 1)
    light.color.set(0x8941ff)
    light.intensity = 3
    viewer.scene.addObject(light)
    light.lookAt(0, 0, 0)
    light.shadowFrustum = 7
    light.castShadow = true

    const ground = viewer.getPlugin(BaseGroundPlugin)!
    ground.material!.roughness = 0
    ground.material!.metalness = 0.2

    const ssr = viewer.getPlugin(SSReflectionPlugin)!
    ssr.pass.stepCount = 32

    // animate light position in a circle
    const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)
    popmotion.animate({
        from: 0,
        to: Math.PI * 2,
        duration: 4000,
        repeat: Infinity,
        repeatType: 'loop',
        ease: EasingFunctions.linear,
        onUpdate: (v) => {
            light.position.x = Math.sin(v) * 2
            light.position.z = Math.cos(v) * 2
            light.position.y = 1.5
            light.lookAt(0, 0, 0)
            light.setDirty()
        },
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(SSReflectionPlugin)
    ui.appendChild(light.uiConfig)

    const gbufferPlugin = viewer.getPlugin(GBufferPlugin)!
    const getNormalDepth = ()=>({texture: gbufferPlugin.normalDepthTexture})

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(getNormalDepth, 'normalDepth', false, false, false)
    targetPreview.addTarget(()=>({texture: light.shadow.map?.texture}),
        'shadowMap', true, true,
        false, (s)=>s + ' = vec4(' + s + '.rgb, 1.);')

}

_testStart()
init().finally(_testFinish)
