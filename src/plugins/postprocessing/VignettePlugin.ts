import {uiColor, uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {Color} from 'three'
import {glsl, onChange, serialize} from 'ts-browser-helpers'
import {uniform} from '../../three'
import vignette from './shaders/VignettePlugin.glsl'
import {AScreenPassExtensionPlugin} from './AScreenPassExtensionPlugin'

/**
 * Vignette Plugin
 *
 * Adds an extension to {@link ScreenPass} material
 * for applying vignette effect on the final buffer before rendering to screen.
 * The power of the vignette can be controlled with the `power` property.
 * The color of the vignette can be controlled with the `color`(previously `bgcolor`) property.
 *
 * @category Plugins
 */
@uiFolderContainer('Vignette')
export class VignettePlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'Vignette'

    readonly extraUniforms = {
        power: {value: 1},
        bgcolor: {value: new Color()},
    } as const

    @onChange(VignettePlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled: boolean

    @uiSlider('Power', [0.1, 4], 0.01)
    @uniform({propKey: 'power'})
    @serialize() power = 0.5

    @uiColor<VignettePlugin>('Color', t=>({onChange:()=>t?.setDirty()}))
    @uniform({propKey: 'bgcolor'})
    @serialize('bgcolor') color = new Color(0x000000)

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -50

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            uniform float power;
            uniform vec3 bgcolor;
            ${vignette}
        `
    }

    protected _shaderPatch = 'diffuseColor = Vignette(diffuseColor);'

    /**
     * @deprecated
     */
    get bgcolor() {
        console.warn('VignettePlugin.bgcolor is deprecated, use VignettePlugin.color instead')
        return this.color
    }
    /**
     * @deprecated
     */
    set bgcolor(v) {
        console.warn('VignettePlugin.bgcolor is deprecated, use VignettePlugin.color instead')
        this.color = v
    }

    constructor(enabled = true) {
        super()
        this.enabled = enabled
    }

}
