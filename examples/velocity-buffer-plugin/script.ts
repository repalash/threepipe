import {
    _testFinish, _testStart,
    EasingFunctions,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    PopmotionPlugin,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin, SSReflectionPlugin, TemporalAAPlugin, VelocityBufferPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        renderScale: 1,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, BloomPlugin, SSAAPlugin, SSReflectionPlugin],
        // rgbm: false,
    })

    const taa = viewer.addPluginSync(new TemporalAAPlugin())
    const velocityBuffer = viewer.addPluginSync(new VelocityBufferPlugin())
    console.log(taa)
    console.log(velocityBuffer)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: false,
    })
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    if (model) {
        const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)
        popmotion.animate({
            from: 0,
            to: 1,
            repeat: Infinity,
            duration: 10000,
            ease: EasingFunctions.linear,
            onUpdate: (v) => {
                // Set camera position xz in a circle around the target
                const angle = v * Math.PI * 2 + Math.PI / 2
                const radius = 1.5
                model.position.set(Math.cos(angle) * radius, Math.sin(v * Math.PI * 4), Math.sin(angle) * radius)
                model.setDirty()
                viewer.setDirty() // since camera is not in the scene
            },
        })
    } else {
        alert('Unable to load 3d Model')
    }

    ui.setupPluginUi(taa)
    ui.setupPluginUi(velocityBuffer)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(SSReflectionPlugin)

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>velocityBuffer.target, 'velocityBuffer', true, true, true)

}

_testStart()
init().then(_testFinish)
