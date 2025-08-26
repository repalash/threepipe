import {
    _testFinish, _testStart,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PCFSoftShadowMap,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {AdvancedGroundPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, GBufferPlugin, SSAAPlugin, TemporalAAPlugin, SSReflectionPlugin],
        // rgbm: false,
    })
    viewer.renderManager.stableNoise = true

    const ground = viewer.addPluginSync(AdvancedGroundPlugin)
    ground.groundReflection = true
    ground.material!.roughness = 0.2

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: false,
    })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    ui.setupPluginUi(AdvancedGroundPlugin)

    viewer.renderManager.renderer.shadowMap.type = PCFSoftShadowMap

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    rt.addTarget(()=>ground.shadowBaker?.light.shadow.map, 'shadow', false, false, true, (s)=>s + ' = vec4(' + s + '.r/2.);')
    rt.addTarget(()=>ground.shadowBaker?.target, 'baked shadow', false, false, true)

}

_testStart()
init().then(_testFinish)
