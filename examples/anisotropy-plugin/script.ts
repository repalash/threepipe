import {
    _testFinish,
    _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {AnisotropyPlugin, BloomPlugin, OutlinePlugin, SSContactShadowsPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: true,
        zPrepass: false,
        renderScale: 'auto',
        // rgbm: false,
        maxHDRIntensity: 8,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, SSAAPlugin, TemporalAAPlugin, BloomPlugin, PickingPlugin, OutlinePlugin, SSContactShadowsPlugin],
    })

    const anisotropy = viewer.addPluginSync(AnisotropyPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://dist.pixotronics.com/webgi/assets/hdr/gem_2.hdr', {
        setBackground: false,
    })
    await viewer.load<IObject3D>('https://demo-assets.pixotronics.com/pixo/gltf/anisotropyScene.glb', {
        autoCenter: true,
        autoScale: true,
    })

    viewer.scene.mainCamera.position.set(5, 0, 0)

    ui.setupPluginUi(anisotropy)
    ui.setupPluginUi(BloomPlugin)
    ui.setupPluginUi(PickingPlugin)

    // // add a light to test shader compile with sscs
    // const light = new DirectionalLight2()
    // viewer.scene.addObject(light)
    // light.castShadow = true


}

_testStart()
init().then(_testFinish)
