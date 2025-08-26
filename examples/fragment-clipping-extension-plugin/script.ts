import {
    _testFinish, _testStart,
    FragmentClippingExtensionPlugin,
    IObject3D,
    LoadingScreenPlugin,
    PhysicalMaterial,
    ThreeViewer,
    Vector4,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })

    const fragmentClipping = viewer.addPluginSync(FragmentClippingExtensionPlugin)
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
        FragmentClippingExtensionPlugin.AddFragmentClipping(material, {
            clipPosition: new Vector4(0.5, 0.5, 0, 0),
            clipParams: new Vector4(0.1, 0.05, 0, 1),
        })
        // set properties like this or from the UI
        // material.userData._fragmentClipping!.clipPosition.set(0, 0, 0, 0)
        // material.setDirty()


        // Add extra fragment clipping extension ui mapped to this material.
        // This is also added inside the material ui by default by the material extension automatically.
        const config = material.uiConfig
        if (!config) continue
        ui.appendChild(fragmentClipping.materialExtension.getUiConfig?.(material), {expanded: true})
        ui.appendChild(config)
    }

}

_testStart()
init().finally(_testFinish)
