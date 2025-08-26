import {
    _testFinish, _testStart,
    BaseGroundPlugin,
    DirectionalLight2,
    GBufferPlugin,
    IObject3D, LoadingScreenPlugin,
    PCFSoftShadowMap,
    PickingPlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {SSContactShadowsPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: false,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BaseGroundPlugin, SSAAPlugin],
        // rgbm: false,
    })
    viewer.renderManager.stableNoise = true

    const sscs = viewer.addPluginSync(SSContactShadowsPlugin)
    viewer.addPluginSync(PickingPlugin)
    console.log(sscs)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
    //     setBackground: true,
    // })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    // const model = result?.getObjectByName('node_damagedHelmet_-6514')
    // const materials = (model?.materials || []) as PhysicalMaterial[]

    ui.setupPluginUi(sscs)
    ui.setupPluginUi(BaseGroundPlugin)
    ui.setupPluginUi(PickingPlugin)


    const light = viewer.scene.addObject(new DirectionalLight2(0xffffff, 4))
    light.position.set(2, 2, 2)
    light.lookAt(0, 0, 0)
    light.castShadow = true
    light.shadowMapSize.setScalar(1024)
    light.shadowNear = 0.1
    light.shadowFar = 10
    light.shadowFrustum = 4

    viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>light.shadow.map || undefined, 'shadow', true, true, true)

    // const gb = viewer.getPlugin(GBufferPlugin)
    // rt.addTarget(()=>({texture: gb!.normalDepthTexture}), 'shadow2')

    ui.appendChild(light.uiConfig, {expanded: true})

    // for (const material of materials) {
    //     ui.appendChild(material.uiConfig)
    // }

}

_testStart()
init().then(_testFinish)
