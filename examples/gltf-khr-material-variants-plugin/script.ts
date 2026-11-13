import {
    _testFinish, _testStart,
    GLTFKHRMaterialVariantsPlugin,
    IObject3D,
    LoadingScreenPlugin,
    SSAAPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createExampleCard} from '../examples-utils/example-card.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [SSAAPlugin, GLTFKHRMaterialVariantsPlugin, LoadingScreenPlugin],
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const result = await viewer.load<IObject3D>(
        'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/MaterialsVariantsShoe/glTF/MaterialsVariantsShoe.gltf',
        {
            autoCenter: true,
            autoScale: true,
        })

    ui.setupPluginUi(GLTFKHRMaterialVariantsPlugin, {expanded: true})
    ui.appendChild(result?.getObjectByName('Shoe')?.uiConfig)

    // the variants that the file defines (KHR_materials_variants)
    const variants = viewer.getPlugin(GLTFKHRMaterialVariantsPlugin)!
    createExampleCard(viewer, {
        description: 'GLTFKHRMaterialVariantsPlugin reads the material variants of a glTF file (KHR_materials_variants) and switches between them. This shoe has three colourways; it can also export them again.',
        actions: [
            {type: 'dropdown', label: 'Variant', icon: 'palette', property: [variants, 'selectedVariant'], children: Object.keys(variants.variants).map(label => ({label}))},
        ],
    })
}

_testStart()
init().finally(_testFinish)
