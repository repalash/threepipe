import {
    _testFinish,
    IObject3D,
    IPipelinePass,
    LoadingScreenPlugin, onChange,
    PhysicalMaterial,
    SSAAPlugin,
    ThreeViewer, uiFolderContainer, uiSlider,
    Vector2, UiObjectConfig, _testStart,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import {TemporalAAPlugin} from '@threepipe/webgi-plugins'

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        rgbm: false, // The pass from three.js doesn't support RGBM encoded render targets
        zPrepass: false,
        renderScale: 1,
        maxHDRIntensity: 100,
        dropzone: {
            addOptions: {
                disposeSceneObjects: true,
            },
        },
        plugins: [LoadingScreenPlugin, SSAAPlugin, TemporalAAPlugin],
    })

    // Extend the pass to add UI and pipeline pass options
    @uiFolderContainer('Unreal Bloom')
    class UnrealBloomPass2 extends UnrealBloomPass implements IPipelinePass {
        declare uiConfig: UiObjectConfig
        passId = 'unrealBloom'
        after = ['render', 'progressive']
        before = ['screen']
        required = ['render']

        @uiSlider('Strength', [0, 5], 0.01)
        @onChange(UnrealBloomPass2.prototype.setDirty)
        declare strength
        @uiSlider('Radius', [0, 1], 0.01)
        @onChange(UnrealBloomPass2.prototype.setDirty)
        declare radius
        @uiSlider('Threshold', [0, 8], 0.01)
        @onChange(UnrealBloomPass2.prototype.setDirty)
        declare threshold

        setDirty() {
            viewer.setDirty()
        }
    }

    const bloomPass = new UnrealBloomPass2(new Vector2(window.innerWidth, window.innerHeight), 1., 0.5, 1.5)

    viewer.renderManager.registerPass(bloomPass)

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

    ui.appendChild(bloomPass.uiConfig)
    for (const material of materials) {
        ui.appendChild(material.uiConfig)
    }

}

_testStart()
init().then(_testFinish)
