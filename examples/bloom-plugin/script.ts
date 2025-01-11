import {_testFinish, IObject3D, LoadingScreenPlugin, PhysicalMaterial, SSAAPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
// @ts-expect-error todo fix
import {BloomPlugin, TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: false,
        rgbm: false,
        zPrepass: false,
        renderScale: 1,
        // rgbm: false,
        maxHDRIntensity: 8,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, SSAAPlugin, TemporalAAPlugin],
    })

    const bloom = viewer.addPluginSync(BloomPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    const model = result?.getObjectByName('node_damagedHelmet_-6514')
    const materials = (model?.materials || []) as PhysicalMaterial[]

    ui.setupPluginUi(bloom)

    for (const material of materials) {
        ui.appendChild(material.uiConfig)
    }

    bloom.pass!.intensity = 3
    bloom.pass!.threshold = 1

    // viewer.scene.background = null
    // bloom.pass!.bloomDebug = true

}

init().then(_testFinish)
