import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {MaterialExtension} from '../../materials'
import {uiDropdown, uiFolderContainer, uiSlider, uiToggle} from 'uiconfig.js'
import {
    ACESFilmicToneMapping,
    CineonToneMapping,
    CustomToneMapping,
    LinearToneMapping,
    Object3D,
    ReinhardToneMapping,
    Shader,
    ShaderChunk,
    ToneMapping,
    Vector4,
    WebGLRenderer,
} from 'three'
import {glsl, onChange, serialize} from 'ts-browser-helpers'
import {IMaterial} from '../../core'
import {shaderReplaceString, updateBit} from '../../utils'
import {matDefine, uniform} from '../../three'
import Uncharted2ToneMapping from './shaders/Uncharted2ToneMapping.glsl'
import TonemapShader from './shaders/TonemapPlugin.pars.glsl'
import TonemapShaderPatch from './shaders/TonemapPlugin.patch.glsl'

// todo move
export interface GBufferUpdater {
    updateGBufferFlags: (material: IMaterial, data: Vector4) => void
}

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
export class TonemapPlugin extends AViewerPluginSync<''> implements MaterialExtension, GBufferUpdater {
    static readonly PluginType = 'Tonemap'

    @serialize() @uiToggle('Enabled') enabled = true

    @uiDropdown('Mode', ([
        ['Linear', LinearToneMapping],
        ['Reinhard', ReinhardToneMapping],
        ['Cineon', CineonToneMapping],
        ['ACESFilmic', ACESFilmicToneMapping],
        ['Uncharted2', Uncharted2Tonemapping],
    ] as [string, ToneMapping][]).map(value => ({
        label: value[0],
        value: value[1],
    })))

    @onChange(TonemapPlugin.prototype.setDirty)
    @serialize() toneMapping: ToneMapping = ACESFilmicToneMapping

    @uiToggle('Tonemap Background', (t: TonemapPlugin)=>({hidden: ()=>!t._viewer?.renderManager.gbufferTarget}))
    @matDefine('TONEMAP_BACKGROUND', undefined, true, TonemapPlugin.prototype.setDirty, (v)=>v ? '1' : '0', (v) => v !== '0')
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

    readonly extraUniforms = {
        toneMappingContrast: {value: 1},
        toneMappingSaturation: {value: 1},
    } as const

    set uniformsNeedUpdate(v: boolean) { // for @uniform decorator
        if (v) this.setDirty()
    }

    parsFragmentSnippet: any = (_: WebGLRenderer, _1: IMaterial) => {
        if (!this.enabled) return ''

        return glsl`
            uniform float toneMappingContrast;
            uniform float toneMappingSaturation;
            ${TonemapShader}
        `
    }

    constructor() {
        super()
        this.setDirty = this.setDirty.bind(this)
    }

    /**
     * The priority of the material extension when applied to the material in ScreenPass
     * set to very low priority, so applied at the end
     */
    readonly priority = -100

    shaderExtender(shader: Shader, _: IMaterial, _1: WebGLRenderer): void {
        if (!this.enabled) return

        shader.fragmentShader = shaderReplaceString(
            shader.fragmentShader,
            '#glMarker', '\n' + TonemapShaderPatch + '\n',
            {prepend: true}
        )
    }

    readonly extraDefines = {
        ['TONEMAP_BACKGROUND']: '1',
    } as const

    private _rendererState: any = {}

    onObjectRender(_: Object3D, material: IMaterial, renderer: WebGLRenderer): void {
        if (!this.enabled) return
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

    getUiConfig(): any {
        return this.uiConfig
    }

    computeCacheKey = (_: IMaterial) => this.enabled ? '1' : '0'

    isCompatible(_: IMaterial): boolean {
        return true // (material as MeshStandardMaterial2).isMeshStandardMaterial2
    }

    setDirty() {
        this.__setDirty?.() // this will update version which will set needsUpdate on material
        this._viewer?.renderManager.screenPass.setDirty()
    }

    fromJSON(data: any, meta?: any): this|null|Promise<this|null> {
        // really pld legacy
        if (data.pass) {
            data = {...data}
            data.extension = {...data.pass}
            delete data.extension.enabled
            delete data.pass
        }
        // legacy
        if (data.extension) {
            data = {...data, ...data.extension}
            delete data.extension
            if (data.clipBackground !== undefined) {
                if (this._viewer) this._viewer.renderManager.screenPass.clipBackground = data.clipBackground
                else console.warn('TonemapPlugin: no viewer attached, clipBackground ignored')
                delete data.clipBackground
            }
        }
        return super.fromJSON(data, meta)
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // viewer.getPlugin(GBufferPlugin)?.registerGBufferUpdater(this.updateGBufferFlags) // todo
        viewer.renderManager.screenPass.material.registerMaterialExtensions([this])
    }

    onRemove(viewer: ThreeViewer) {
        // viewer.getPlugin(GBufferPlugin)?.unregisterGBufferUpdater(this.updateGBufferFlags)
        viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this])
        super.onRemove(viewer)
    }

    updateGBufferFlags(material: IMaterial, data: Vector4): void {
        const x = material?.userData.postTonemap === false ? 0 : 1
        data.w = updateBit(data.w, 1, x) // 2nd Bit
    }

    static {
        // Add support for Uncharted2 tone mapping
        ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', Uncharted2ToneMapping)
    }

    // for typescript
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __setDirty?: () => void

}
