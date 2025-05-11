import {
    _testFinish, _testStart,
    Color,
    GLTFLoader2,
    IObject3D,
    LineMaterial2,
    LoadingScreenPlugin,
    PickingPlugin, PopmotionPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin],
        dropzone: true,
    })

    viewer.scene.autoNearFarEnabled = false

    GLTFLoader2.UseMeshLines = true

    viewer.scene.backgroundColor = new Color(0x333333)

    await viewer.load<IObject3D>('https://asset-samples.threepipe.org/demos/temple-lines.glb.zip', {
        autoScale: true,
        autoCenter: true,
    })

    const popmotion = viewer.addPluginSync(PopmotionPlugin)

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

}

_testStart()
init().finally(_testFinish)
