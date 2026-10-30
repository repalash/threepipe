import {uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {glsl, onChange, serialize} from 'ts-browser-helpers'
import {uniform} from '../../three'
import FilmicGrain from './shaders/FilmicGrainPlugin.glsl'
import {AScreenPassExtensionPlugin} from './AScreenPassExtensionPlugin'

/**
 * Filmic Grain Plugin
 * Adds an extension to {@link ScreenPass} material
 * for applying filmic grain effect on the final buffer before rendering to screen.
 * The intensity of the grain can be controlled with the `intensity` property
 * and the `multiply` property can be used to multiply the grain effect on the image instead of adding.
 *
 * @category Plugins
 */
@uiFolderContainer('FilmicGrain')
export class FilmicGrainPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'FilmicGrain'

    readonly extraUniforms = {
        grainIntensity: {value: 1},
        grainMultiply: {value: false},
    } as const

    @onChange(FilmicGrainPlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled: boolean

    @uiSlider('Intensity', [0., 20], 0.01)
    @uniform({propKey: 'grainIntensity'})
    @serialize('grainIntensity') intensity = 10

    @uiToggle('Multiply')
    @uniform({propKey: 'grainMultiply'})
    @serialize('grainMultiply') multiply = false

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -50

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            uniform float grainIntensity;
            uniform bool grainMultiply;
            ${FilmicGrain}
        `
    }

    protected _shaderPatch = 'diffuseColor = FilmicGrain(diffuseColor);'

    /**
     * @deprecated
     */
    get grainIntensity() {
        console.warn('FilmicGrainPlugin.grainIntensity is deprecated, use FilmicGrainPlugin.intensity instead')
        return this.intensity
    }
    /**
     * @deprecated
     */
    set grainIntensity(v) {
        console.warn('FilmicGrainPlugin.grainIntensity is deprecated, use FilmicGrainPlugin.intensity instead')
        this.intensity = v
    }

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }
}
