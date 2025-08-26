import {
    _testFinish, _testStart,
    ClearcoatTintPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PhysicalMaterial,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const clearcoatTint = viewer.addPluginSync(ClearcoatTintPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const materials = (model?.materials || []) as PhysicalMaterial[]
    for (const material of materials) {
        material.clearcoat = 1
        // add initial properties
        ClearcoatTintPlugin.AddClearcoatTint(material, {
            tintColor: '#ff0000',
            thickness: 1,
        })
        // set properties like this or from the UI
        // material.userData._clearcoatTint!.tintColor = '#ff0000'


        // Add extra clearcoat tint ui mapped to this material.
        // This is also added inside the material ui by default by the material extension automatically.
        const config = material.uiConfig
        if (!config) continue
        ui.appendChild(clearcoatTint.materialExtension.getUiConfig?.(material), {expanded: true})
        ui.appendChild(config)
    }

}

_testStart()
init().finally(_testFinish)
