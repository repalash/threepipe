// noinspection ES6PreferShortImport
import {uiDropdown, uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {
    ACESFilmicToneMapping,
    AgXToneMapping,
    CineonToneMapping,
    CustomToneMapping,
    LinearToneMapping,
    Object3D,
    ReinhardToneMapping,
    ShaderChunk,
    ToneMapping,
    Vector4,
    WebGLRenderer,
} from 'three'
import {glsl, onChange, serialize} from 'ts-browser-helpers'
import {IMaterial} from '../../core'
import {updateBit} from '../../utils'
import {uniform} from '../../three'
import Uncharted2ToneMappingShader from './shaders/Uncharted2ToneMapping.glsl'
import TonemapShader from './shaders/TonemapPlugin.pars.glsl'
import TonemapShaderPatch from './shaders/TonemapPlugin.patch.glsl'
import {AScreenPassExtensionPlugin} from './AScreenPassExtensionPlugin'
import {GBufferUpdaterContext} from '../pipeline/GBufferMaterial'
import {matDefineBool} from '../../three/utils/decorators'

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Uncharted2Tonemapping: ToneMapping = CustomToneMapping

/**
 * Tonemap Plugin
 *
 * Adds an extension to {@link ScreenPass} material
 * for applying tonemapping on the final buffer before rendering to screen.
 *
 * Also adds support for Uncharted2 tone-mapping.
 * @category Plugins
 */
@uiFolderContainer('Tonemapping')
export class TonemapPlugin extends AScreenPassExtensionPlugin {
    static readonly PluginType = 'Tonemap'

    readonly extraUniforms = {
        toneMappingContrast: {value: 1},
        toneMappingSaturation: {value: 1},
    } as const

    readonly extraDefines = {
        ['TONEMAP_BACKGROUND']: '1',
    } as const

    @serialize()
    @onChange(TonemapPlugin.prototype.setDirty)
    @uiToggle('Enabled')
        enabled = true

    @uiDropdown('Mode', ([
        ['Linear', LinearToneMapping],
        ['Reinhard', ReinhardToneMapping],
        ['Cineon', CineonToneMapping],
        ['ACESFilmic', ACESFilmicToneMapping],
        ['Uncharted2', Uncharted2Tonemapping],
        ['AgX', AgXToneMapping],
    ] as [string, ToneMapping][]).map(value => ({
        label: value[0],
        value: value[1],
    })))
    @onChange(TonemapPlugin.prototype.setDirty)
    @serialize() toneMapping: ToneMapping = ACESFilmicToneMapping

    @uiToggle('Tonemap Background', (t: TonemapPlugin)=>({hidden: ()=>!t._viewer?.renderManager.gbufferTarget}))
    @matDefineBool('TONEMAP_BACKGROUND', undefined, true, TonemapPlugin.prototype.setDirty)
    @serialize() tonemapBackground = true

    // todo handle legacy deserialize
    // @onChange(TonemapPlugin.prototype.setDirty)
    // @uiToggle('Clip Background')
    // @serialize() clipBackground = false

    @onChange(TonemapPlugin.prototype.setDirty)
    @uiSlider('Exposure', [0, 2 * Math.PI], 0.01)
    @serialize() exposure = 1

    @uiSlider('Saturation', [0, 2], 0.01)
    @uniform({propKey: 'toneMappingSaturation'})
    @serialize() saturation: number

    @uiSlider('Contrast', [0, 2], 0.01)
    @uniform({propKey: 'toneMappingContrast'})
    @serialize() contrast: number

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    priority = -100

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''

        return glsl`
            uniform float toneMappingContrast;
            uniform float toneMappingSaturation;
            ${TonemapShader}
        `
    }

    protected _shaderPatch = TonemapShaderPatch

    private _rendererState: any = {}

    onObjectRender(_: Object3D, material: IMaterial, renderer: WebGLRenderer): void {
        if (this.isDisabled()) return
        const {toneMapping, toneMappingExposure} = renderer
        this._rendererState.toneMapping = toneMapping
        this._rendererState.toneMappingExposure = toneMappingExposure

        renderer.toneMapping = this.toneMapping
        renderer.toneMappingExposure = this.exposure
        material.toneMapped = true
        material.needsUpdate = true
    }

    onAfterRender(_: Object3D, _1: IMaterial, renderer: WebGLRenderer): void {
        renderer.toneMapping = this._rendererState.toneMapping
        renderer.toneMappingExposure = this._rendererState.toneMappingExposure
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // legacy
        if (data.extension) {
            if (data.clipBackground !== undefined) {
                if (this._viewer) this._viewer.renderManager.screenPass.clipBackground = data.clipBackground
                else console.warn('TonemapPlugin: no viewer attached, clipBackground ignored')
                delete data.clipBackground
            }
        }
        return super.fromJSON(data, meta)
    }

    // TODO: add gBufferData or just tonemapEnabled to the scene material UI with an extension like bloom
    updateGBufferFlags(data: Vector4, c: GBufferUpdaterContext): void {
        const x = (c.material.userData.gBufferData?.tonemapEnabled ?? c.material?.userData.postTonemap) === false ? 0 : 1
        data.w = updateBit(data.w, 1, x) // 2nd Bit
        super.updateGBufferFlags(data, c)
    }

    static {
        // Add support for Uncharted2 tone mapping
        ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', Uncharted2ToneMappingShader)
    }

}
