import {
    _testFinish,
    _testStart,
    AScreenPassExtensionPlugin,
    Color,
    glsl,
    onChange,
    serialize,
    ThreeViewer,
    uiColor,
    uiFolderContainer,
    uiSlider,
    uiToggle,
    uniform,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Add a material extension to the screen shader material to modify the final rendered image.
// Here, AScreenPassExtensionPlugin is used to create a custom screen pass extension plugin with auto generated UI and serialization.
// Checkout the ScreenPass guide for more details: https://threepipe.org/docs/guides/screen-pass

@uiFolderContainer('Custom Tint Extension')
export class CustomScreenPassExtensionPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'CustomScreenPassExtensionPlugin'

    readonly extraUniforms = {
        intensity: {value: 1},
        tintColor: {value: new Color(0xff0000)},
    } as const

    @onChange(CustomScreenPassExtensionPlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled: boolean

    @uiSlider('Intensity', [0.1, 4], 0.01)
    @uniform({propKey: 'tintIntensity'})
    @serialize() intensity = 1

    @uiColor<CustomScreenPassExtensionPlugin>('Color', t=>({onChange:()=>t?.setDirty()}))
    @uniform({propKey: 'tintColor'})
    @serialize('tintColor') color = new Color(0xff0000)

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -50

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            uniform float tintIntensity;
            uniform vec3 tintColor;
            vec4 ApplyTint(vec4 color) {
                return vec4(color.rgb * tintColor * tintIntensity, color.a);
            }
        `
    }

    protected _shaderPatch = 'diffuseColor = ApplyTint(diffuseColor);'

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

}

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    tonemap: true, // also tonemap (this is also added as an extension)
    plugins: [CustomScreenPassExtensionPlugin],
})

async function init() {
    await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
            autoCenter: true,
            autoScale: true,
        })])

    // Add the color to the UI
    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.setupPluginUi(CustomScreenPassExtensionPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
