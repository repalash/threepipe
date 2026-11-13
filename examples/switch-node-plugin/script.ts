import {
    _testFinish, _testStart,
    FrameFadePlugin,
    IObject3D,
    LoadingScreenPlugin,
    PickingPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GridItemListPlugin, SwitchNodePlugin} from '@threepipe/plugin-configurator'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, FrameFadePlugin, SSAAPlugin],
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    const configurator = viewer.addPluginSync(new SwitchNodePlugin())
    configurator.enableEditContextMenus = true

    // await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    // This model is already setup in the editor.
    // You can use the editor to setup the switch-nodes in the UI and then load the model here.
    // Another way to load the switch node variation details is to export a json file of the plugin from the editor and load it in the same way after loading the model.
    await viewer.load<IObject3D>(
        'https://demo-assets.pixotronics.com/pixo/gltf/product_configurator.glb',
        // 'https://demo-assets.pixotronics.com/pixo/gltf/classic-watch.glb',
        {
            autoCenter: true,
            autoScale: true,
        })
    viewer.scene.mainCamera.controls!.enableDamping = true // since its disabled in the file for some reason
    ui.setupPluginUi(SwitchNodePlugin)
    ui.setupPluginUi(PickingPlugin)

    // the options of the switch nodes go in the card (by default they are a column over the top left of the canvas)
    const options = document.createElement('div')
    createExampleCard(viewer, {
        description: 'SwitchNodePlugin: an object with children is a switch node, and only one of its children shows at a time. The product in this file has switch nodes set up in the editor: click an option to show that part. Right-click to edit them.',
        content: options,
    })
    viewer.getPlugin(GridItemListPlugin)!.container = options
}

_testStart()
init().finally(_testFinish)
