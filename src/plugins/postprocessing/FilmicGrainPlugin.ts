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
     * Applied AFTER tonemap and LUT so the grain pattern lives in display-referred space.
     * Sensor noise / film stock grain is a post-display-encoding artifact — running it
     * pre-tonemap would mean the tonemap curve compresses bright-area grain (highlight
     * grain looks weak) and re-saturates dark-area grain. Industry standard places grain
     * after tonemap+LUT and before dither (Unity URP UberPost.shader, PPv2 RenderBuiltins,
     * Unreal post-process material blendable location "After Tonemapping").
     *
     * Priority must be lower than {@link TonemapPlugin.priority} (-100) AND lower than
     * {@link LUTPlugin.priority} (-150) so this extension's snippet ends up at the bottom
     * of the screen-pass shader (= runs last among the four).
     *
     * See `issues/open/post-extension-priority-tonemap-order.md` for the audit and citations.
     */
    priority = -200

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
