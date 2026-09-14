import {Matrix3, NoColorSpace} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {IMaterial, IObject3D, ITexture, PhysicalMaterial} from '../../core'
import {MaterialExtension, updateMaterialDefines} from '../../materials'
import {shaderReplaceString} from '../../utils'
import {makeSamplerUi} from '../../ui/image-ui'
import RoughnessMaskPluginPars from './shaders/RoughnessMaskPlugin.pars.glsl'
import RoughnessMaskPluginPatch from './shaders/RoughnessMaskPlugin.patch.glsl'

export type RoughnessMaskChannel = 'r' | 'g' | 'b' | 'a'

/**
 * Roughness Mask Plugin
 *
 * Adds a material extension to {@link PhysicalMaterial} that drives roughness from a mask texture,
 * remapping a single channel of the mask between a min and a max roughness value:
 *
 * `roughnessFactor = mix(roughnessMaskMin, roughnessMaskMax, mask[channel])`
 *
 * This replaces the built-in roughness map (which multiplies `roughness` by the green channel) with an
 * explicit two-point remap. It is the equivalent of the MaterialX pattern
 * `<mix>` (fg = max, bg = min) fed by `<extract>` from an `<image>` node, as emitted by
 * standard_surface exports.
 *
 * The mask has its own UV transform (from `map.repeat`/`map.offset`), independent of the other maps,
 * so it does not need to share a UV scale with base color / normal.
 *
 * @category Plugins
 */
@uiFolderContainer('Roughness Mask (MatExt)')
export class RoughnessMaskPlugin extends AViewerPluginSync {
    static readonly PluginType = 'RoughnessMaskPlugin'

    @uiToggle('Enabled', (that: RoughnessMaskPlugin)=>({onChange: that.setDirty}))
    @serialize() enabled = true

    private _uniforms = {
        roughnessMaskMap: {value: null as ITexture | null},
        roughnessMaskMin: {value: 0},
        roughnessMaskMax: {value: 1},
        roughnessMaskUvTransform: {value: new Matrix3()},
    }

    /**
     * Enable the mask-driven roughness remap on a material.
     * @param material
     * @param map - the mask texture. Sampled as data (colorSpace is forced to NoColorSpace).
     * @param min - roughness where the mask channel is 0
     * @param max - roughness where the mask channel is 1
     * @param channel - which channel of the mask to read, defaults to `r`
     */
    public enableRoughnessMask(material: IMaterial, map?: ITexture, min?: number, max?: number, channel?: RoughnessMaskChannel): boolean {
        const ud = material?.userData
        if (!ud) return false
        if (map) {
            // the mask is data, not color. sampling it through sRGB decode would skew the remap.
            map.colorSpace = NoColorSpace
            map.needsUpdate = true
        }
        ud._hasRoughnessMask = true
        ud._roughnessMaskMap = map ?? ud._roughnessMaskMap ?? null
        ud._roughnessMaskMin = min ?? ud._roughnessMaskMin ?? 0
        ud._roughnessMaskMax = max ?? ud._roughnessMaskMax ?? 1
        ud._roughnessMaskChannel = channel ?? ud._roughnessMaskChannel ?? 'r'
        if (material.setDirty) material.setDirty()
        return true
    }

    readonly materialExtension: MaterialExtension = {
        parsFragmentSnippet: (_, material: PhysicalMaterial)=>{
            if (this.isDisabled() || !material?.userData._hasRoughnessMask) return ''
            return RoughnessMaskPluginPars
        },
        shaderExtender: (shader, material: PhysicalMaterial) => {
            if (this.isDisabled() || !material?.userData._hasRoughnessMask) return
            if (!material.userData._roughnessMaskMap) return

            // roughnessmap_fragment declares `float roughnessFactor = roughness;` and multiplies in the
            // roughness map, so append (not prepend) to overwrite it.
            // the glsl loader strips newlines, so the leading \n is required: without it the patch lands
            // on the same line as the chunk's trailing `#endif`.
            shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <roughnessmap_fragment>',
                '\n' + RoughnessMaskPluginPatch + '\n', {append: true},
            )

            shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_pars_vertex>',
                `
#if defined(ROUGHNESS_MASK_ENABLED) && ROUGHNESS_MASK_ENABLED > 0
    varying vec2 vRoughnessMaskUv;
    uniform mat3 roughnessMaskUvTransform;
#endif
                `, {prepend: true},
            )
            shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_vertex>',
                `
#if defined(ROUGHNESS_MASK_ENABLED) && ROUGHNESS_MASK_ENABLED > 0
    vRoughnessMaskUv = ( roughnessMaskUvTransform * vec3( uv, 1 ) ).xy;
#endif
                `, {prepend: true},
            )

            shader.defines && (shader.defines.USE_UV = '')
        },
        onObjectRender: (object: IObject3D, material: PhysicalMaterial) => {
            const ud = material.userData
            if (!ud?._hasRoughnessMask) return
            if (!object.isMesh || !object.geometry) return
            const tex = ud._roughnessMaskMap?.isTexture ? ud._roughnessMaskMap : null
            this._uniforms.roughnessMaskMap.value = tex
            this._uniforms.roughnessMaskMin.value = ud._roughnessMaskMin ?? 0
            this._uniforms.roughnessMaskMax.value = ud._roughnessMaskMax ?? 1
            if (tex) {
                tex.updateMatrix()
                this._uniforms.roughnessMaskUvTransform.value.copy(tex.matrix)
            }
            updateMaterialDefines({
                ['ROUGHNESS_MASK_ENABLED']: +(this.enabled && !!tex),
                ['ROUGHNESS_MASK_CHANNEL']: ud._roughnessMaskChannel ?? 'r',
            }, material)
        },
        extraUniforms: {
            // assigned in the constructor
        },
        computeCacheKey: (material: PhysicalMaterial) => {
            return (this.enabled ? '1' : '0') +
                (material.userData._hasRoughnessMask ? '1' : '0') +
                (material.userData._roughnessMaskChannel ?? 'r') +
                material.userData._roughnessMaskMap?.uuid
        },
        isCompatible: (material: PhysicalMaterial) => material.isPhysicalMaterial,
        getUiConfig: material => {
            const state = material.userData
            const config: UiObjectConfig = {
                type: 'folder',
                label: 'RoughnessMask',
                onChange: (ev)=>{
                    if (!ev.config) return
                    this.setDirty()
                },
                children: [
                    {
                        type: 'checkbox',
                        label: 'Enabled',
                        get value() {
                            return state._hasRoughnessMask || false
                        },
                        set value(v) {
                            if (v === state._hasRoughnessMask) return
                            state._hasRoughnessMask = v
                            if (material.setDirty) material.setDirty()
                            config.uiRefresh?.(true, 'postFrame')
                        },
                    },
                    {
                        type: 'image',
                        label: 'Mask',
                        hidden: () => !state._hasRoughnessMask,
                        property: [state, '_roughnessMaskMap'],
                        onChange: ()=>{
                            const map = state._roughnessMaskMap
                            if (map) {
                                map.colorSpace = NoColorSpace
                                map.needsUpdate = true
                            }
                            if (material.setDirty) material.setDirty()
                        },
                    },
                    {
                        type: 'dropdown',
                        label: 'Channel',
                        hidden: () => !state._hasRoughnessMask,
                        property: [state, '_roughnessMaskChannel'],
                        children: (['r', 'g', 'b', 'a'] as RoughnessMaskChannel[]).map(c=>({label: c, value: c})),
                        onChange: ()=>{
                            if (material.setDirty) material.setDirty()
                        },
                    },
                    {
                        type: 'slider',
                        label: 'Roughness Min',
                        bounds: [0, 1],
                        stepSize: 0.001,
                        hidden: () => !state._hasRoughnessMask,
                        property: [state, '_roughnessMaskMin'],
                    },
                    {
                        type: 'slider',
                        label: 'Roughness Max',
                        bounds: [0, 1],
                        stepSize: 0.001,
                        hidden: () => !state._hasRoughnessMask,
                        property: [state, '_roughnessMaskMax'],
                    },
                    makeSamplerUi(state as any, '_roughnessMaskMap', 'Sampler', ()=>!state._hasRoughnessMask, ()=>material.setDirty && material.setDirty()),
                ],
            }
            return config
        },
    }

    setDirty = (): void => {
        this.materialExtension.setDirty?.()
        this._viewer?.setDirty()
    }

    constructor() {
        super()
        Object.assign(this.materialExtension.extraUniforms!, this._uniforms)
    }

    onAdded(v: ThreeViewer) {
        super.onAdded(v)
        v.assetManager.materials.registerMaterialExtension(this.materialExtension)
    }

    onRemove(v: ThreeViewer) {
        v.assetManager.materials?.unregisterMaterialExtension(this.materialExtension)
        return super.onRemove(v)
    }
}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        _hasRoughnessMask?: boolean
        _roughnessMaskMap?: ITexture | null
        _roughnessMaskMin?: number
        _roughnessMaskMax?: number
        _roughnessMaskChannel?: RoughnessMaskChannel
    }
}
