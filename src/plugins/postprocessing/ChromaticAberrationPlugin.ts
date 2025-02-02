import {uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {glsl, onChange, serialize} from 'ts-browser-helpers'
import {uniform} from '../../three'
import ChromaticAberration from './shaders/ChromaticAberrationPlugin.glsl'
import {AScreenPassExtensionPlugin} from './AScreenPassExtensionPlugin'

/**
 * Chromatic Aberration Plugin
 * Adds an extension to {@link ScreenPass} material
 * for applying chromatic aberration effect on the final buffer before rendering to screen.
 * The intensity of the aberration can be controlled with the `intensity`(previously aberrationIntensity) property.
 *
 * @category Plugins
 */
@uiFolderContainer('ChromaticAberration')
export class ChromaticAberrationPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'ChromaticAberration'

    readonly extraUniforms = {
        aberrationIntensity: {value: 1},
    } as const

    @onChange(ChromaticAberrationPlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled: boolean

    @uiSlider('Intensity', [0., 0.3], 0.001)
    @uniform({propKey: 'aberrationIntensity'})
    @serialize('aberrationIntensity') intensity = 0.5

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -50

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            uniform float aberrationIntensity;
            ${ChromaticAberration}
        `
    }

    protected _shaderPatch = 'diffuseColor = ChromaticAberration(diffuseColor);'

    get aberrationIntensity() {
        console.warn('ChromaticAberrationPlugin.aberrationIntensity is deprecated, use ChromaticAberrationPlugin.intensity instead')
        return this.intensity
    }
    set aberrationIntensity(v) {
        console.warn('ChromaticAberrationPlugin.aberrationIntensity is deprecated, use ChromaticAberrationPlugin.intensity instead')
        this.intensity = v
    }

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }
}
