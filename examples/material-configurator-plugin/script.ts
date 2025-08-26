import {
    _testFinish, _testStart, ContactShadowGroundPlugin,
    FrameFadePlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {MaterialConfiguratorPlugin} from '@threepipe/plugin-configurator'
import {WatchHandsPlugin, SSReflectionPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, PickingPlugin, FrameFadePlugin, SSAAPlugin, TemporalAAPlugin, WatchHandsPlugin, SSReflectionPlugin, ContactShadowGroundPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const materialConfigurator = viewer.addPluginSync(new MaterialConfiguratorPlugin())
    materialConfigurator.enableEditContextMenus = true
    materialConfigurator.animateApply = true
    materialConfigurator.animateApplyDuration = 1000
    ui.setupPluginUi(MaterialConfiguratorPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.appendChild(viewer.uiConfig)

    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // This model is already setup in the editor.
    // You can use the editor to setup the materials in the UI and then load the model here.
    // Another way to load the material variations is to export a json file of the plugin from the editor and load it in the same way after loading the model.
    await viewer.load<IObject3D>(
        // 'https://demo-assets.pixotronics.com/pixo/gltf/material_configurator.glb',
        'https://samples.threepipe.org/demos/classic-watch.glb',
        // 'https://demo-assets.pixotronics.com/pixo/gltf/classic-watch.glb',
        {
            autoCenter: true,
            autoScale: true,
        })

    viewer.scene.mainCamera.controls!.enableDamping = true // since its disabled in the file for some reason

    // to get the watch to show the correct hands, we need to set the offsets
    const wh = viewer.getPlugin(WatchHandsPlugin)!
    wh.invertAxis = true
    wh.hourOffset = 10
    wh.minuteOffset = 7
    wh.secondOffset = 38
    wh.analog = false
}

_testStart()
init().finally(_testFinish)
