import {
    _testFinish, _testStart,
    GBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PCFShadowMap,
    RenderTargetPreviewPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {AdvancedGroundPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
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
    ground.shadowBaker.maxFrameNumber = window.TESTING ? 20 : ground.shadowBaker.maxFrameNumber
    ground.material!.roughness = 0.2

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin())

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: false,
    })
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    ui.setupPluginUi(AdvancedGroundPlugin, {expanded: true})

    viewer.renderManager.renderer.shadowMap.type = PCFShadowMap

    const rt = viewer.addPluginSync(RenderTargetPreviewPlugin)
    // the light space depth of the light positions of the last bake frame, one tile for each
    rt.addTarget(()=>{
        const depth = ground.shadowBaker?.depthTarget?.depthTexture
        return depth ? {texture: depth} : undefined
    }, 'shadow depth', false, false, true, (s)=>s + ' = vec4(' + s + '.rrr, 1.);')
    rt.addTarget(()=>ground.shadowBaker?.target, 'baked shadow', false, false, true)

}

_testStart()
init().finally(_testFinish)
