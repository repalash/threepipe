import {
    _testFinish,
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
// @ts-expect-error todo fix
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

    // await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
    //     setBackground: true,
    // })
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
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
    light.shadow.mapSize.setScalar(1024)
    light.shadow.camera.near = 0.1
    light.shadow.camera.far = 10
    light.shadow.camera.top = 2
    light.shadow.camera.bottom = -2
    light.shadow.camera.left = -2
    light.shadow.camera.right = 2

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

init().then(_testFinish)
