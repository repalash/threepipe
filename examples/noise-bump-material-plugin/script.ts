import {
    _testFinish, _testStart,
    IObject3D,
    LoadingScreenPlugin,
    NoiseBumpMaterialPlugin,
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

    const noiseBump = viewer.addPluginSync(NoiseBumpMaterialPlugin)
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
        NoiseBumpMaterialPlugin.AddNoiseBumpMaterial(material, {
            flakeScale: 300,
        })
        // set properties like this or from the UI
        // material.userData._noiseBumpMat!.bumpNoiseParams = [1, 1]
        // material.setDirty()


        // Add extra noise bump extension ui mapped to this material.
        // This is also added inside the material ui by default by the material extension automatically.
        const config = material.uiConfig
        if (!config) continue
        ui.appendChild(noiseBump.materialExtension.getUiConfig?.(material), {expanded: true})
        ui.appendChild(config)
    }

}

_testStart()
init().finally(_testFinish)
