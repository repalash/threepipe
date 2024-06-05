import {_testFinish, FrameFadePlugin, IObject3D, PickingPlugin, SSAAPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {MaterialConfiguratorPlugin} from '@threepipe/plugin-configurator'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, FrameFadePlugin, SSAAPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const materialConfigurator = viewer.addPluginSync(new MaterialConfiguratorPlugin())
    materialConfigurator.enableEditContextMenus = true

    // await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')

    // This model is already setup in the editor.
    // You can use the editor to setup the materials in the UI and then load the model here.
    // Another way to load the material variations is to export a json file of the plugin from the editor and load it in the same way after loading the model.
    await viewer.load<IObject3D>(
        'https://demo-assets.pixotronics.com/pixo/gltf/material_configurator.glb',
        // 'https://demo-assets.pixotronics.com/pixo/gltf/classic-watch.glb',
        {
            autoCenter: true,
            autoScale: true,
        })
    viewer.scene.mainCamera.controls!.enableDamping = true // since its disabled in the file for some reason
    ui.setupPluginUi(MaterialConfiguratorPlugin)
    ui.setupPluginUi(PickingPlugin)

}

init().finally(_testFinish)
