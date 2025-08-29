import {
    _testFinish, _testStart,
    Color, DepthBufferPlugin, GBufferPlugin,
    GLTFLoader2,
    IObject3D,
    LineMaterial2,
    LoadingScreenPlugin,
    PickingPlugin, PopmotionPlugin, RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Read more about the example - https://threepipe.org/notes/gltf-mesh-lines

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PopmotionPlugin, DepthBufferPlugin, GBufferPlugin, LoadingScreenPlugin, PickingPlugin], // depth and gbuffer plugins are optional
        dropzone: true,
    })

    viewer.scene.autoNearFarEnabled = false

    GLTFLoader2.UseMeshLines = true

    viewer.scene.backgroundColor = new Color(0x333333)

    await viewer.load<IObject3D>('https://samples.threepipe.org/demos/temple-lines.glb.zip', {
        autoScale: true,
        autoCenter: true,
    })

    const popmotion = viewer.getPlugin(PopmotionPlugin)!

    const material = viewer.materialManager.findMaterialsByName('Stone')[0] as LineMaterial2

    popmotion.animate({
        from: 0,
        to: 1,
        duration: 1000,
        repeat: Infinity,
        repeatType: 'mirror',
        onUpdate: (v) => {
            material.linewidth = Math.sin(v * Math.PI) * 3.5 + 1
            material.color.setHSL(v, 0.5, 0.7)
            material.setDirty()
        },
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)

    const gbufferPlugin = viewer.getPlugin(GBufferPlugin)!
    const getNormalDepth = ()=>({texture: gbufferPlugin.normalDepthTexture})
    const getFlags = ()=>({texture: gbufferPlugin.flagsTexture})
    const getDepthTexture = ()=>({texture: viewer.getPlugin(DepthBufferPlugin)?.texture})

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(getNormalDepth, 'normalDepth')
    targetPreview.addTarget(getFlags, 'gBufferFlags')
    targetPreview.addTarget(getDepthTexture, 'depthTexture')
}

_testStart()
init().finally(_testFinish)
