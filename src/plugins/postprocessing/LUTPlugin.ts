import {Data3DTexture, Vector4} from 'three'
import {glsl, onChange, serialize, updateBit, clearBit, uuidV4} from 'ts-browser-helpers'
import {uiButton, uiFolderContainer, uiImage, UiObjectConfig, uiSlider, uiToggle} from 'uiconfig.js'
import {AScreenPassExtensionPlugin} from './AScreenPassExtensionPlugin'
import {uniform} from '../../three'
import {IMaterial} from '../../core'
import type {MaterialExtension} from '../../materials'
import {GBufferUpdaterContext} from '../pipeline/GBufferMaterial'
import type {ThreeViewer} from '../../viewer'
import {LUTCubeTextureWrapper} from '../../assetmanager/import/LUTCubeLoader2'
import lutShader from './shaders/LUTPlugin.glsl'

/**
 * LUT Plugin — 3D Color Look-Up Table.
 *
 * Adds a material extension to {@link ScreenPass} that applies a .cube LUT to the final
 * rendered frame before display. Ported from webgi's `LUTPlugin`.
 *
 * Supports up to **three simultaneous LUT slots** (`lutMap`, `lutMap1`, `lutMap2`). Each
 * material can opt into a specific slot via its userData — `material.userData['LUTPlugin1']
 * = { enable: true, index: 0 | 1 | 2 }`. The selection is packed into the GBuffer flags
 * (data.y bits 0-2 for slot index, data.w bit 0 for enable) and read back per-pixel by
 * `LUTPlugin.glsl:colorLookUp`. Default (no per-material data) applies slot 0.
 *
 * Load `.cube` LUT files via `viewer.load()` — they come back as {@link LUTCubeTextureWrapper}
 * and can be assigned directly to `lutMap`/`lutMap1`/`lutMap2`.
 *
 * **Notes**:
 * - Requires {@link GBufferPlugin} for the per-material selection bits. Without it,
 *   `getGBufferFlags()` returns `ivec4(1)` (all flags set) and every pixel uses slot 0
 *   with LUT enabled — usable as a global LUT even without gbuffer.
 * - WebGL2 only (uses `sampler3D`). Threepipe already requires WebGL2.
 * - `lutBackground` toggles whether the LUT is applied to the skybox/background too
 *   (depth > 0.9999) or only to foreground pixels.
 *
 * @category Plugins
 */
@uiFolderContainer('LUT')
export class LUTPlugin extends AScreenPassExtensionPlugin {
    // Keep 'LUTPlugin1' for wire-compat with webgi-saved viewer configs and GLB files.
    static readonly PluginType = 'LUTPlugin1'

    readonly extraUniforms = {
        intensity: {value: 1},
        lutSize: {value: 1},
        lutSize1: {value: 1},
        lutSize2: {value: 1},
        lut3d: {value: null as Data3DTexture | null},
        lut3d1: {value: null as Data3DTexture | null},
        lut3d2: {value: null as Data3DTexture | null},
    }

    readonly extraDefines: any = {
        ['USE_LUT']: 0,
        ['USE_LUT1']: 0,
        ['USE_LUT2']: 0,
        ['LUT_BACKGROUND']: 0,
    }

    @onChange(LUTPlugin.prototype.setDirty)
    @uiToggle('Enable')
    @serialize() enabled = false

    @onChange(LUTPlugin.prototype._onChange)
    @uiToggle('LUT Background')
    @serialize() lutBackground = true

    @uiSlider('Intensity', [0, 1], 0.01)
    @uniform({propKey: 'intensity'})
    @serialize() intensity = 1

    @onChange(LUTPlugin.prototype._onChange)
    @uiImage('LUT', {extensions: ['.cube']} as any)
    @serialize() lutMap: LUTCubeTextureWrapper | undefined = undefined

    @onChange(LUTPlugin.prototype._onChange)
    @uiImage('LUT 1', {extensions: ['.cube']} as any)
    @serialize() lutMap1: LUTCubeTextureWrapper | undefined = undefined

    @onChange(LUTPlugin.prototype._onChange)
    @uiImage('LUT 2', {extensions: ['.cube']} as any)
    @serialize() lutMap2: LUTCubeTextureWrapper | undefined = undefined

    @uiButton('Enable on all materials')
    enableOnAll = () => this._setEnableAll(true)

    @uiButton('Disable on all materials')
    disableOnAll = () => this._setEnableAll(false)

    private _setEnableAll(enable: boolean) {
        const mats = this._viewer?.assetManager.materials.getAllMaterials() ?? []
        for (const m of mats) {
            const ud = m.userData
            if (!ud) continue
            if (enable) {
                if (!ud[LUTPlugin.PluginType]) ud[LUTPlugin.PluginType] = {index: 0}
                ud[LUTPlugin.PluginType]!.enable = true
            } else if (ud[LUTPlugin.PluginType]) {
                ud[LUTPlugin.PluginType]!.enable = false
            }
            if (m.setDirty) m.setDirty()
            m.uiConfig?.uiRefresh?.(true, 'postFrame')
        }
        this.setDirty()
    }

    /**
     * Applied AFTER tonemap so the LUT operates on display-space (post-tonemap) color,
     * matching webgi's pipeline. Priority must be lower than {@link TonemapPlugin.priority}
     * (-100). With prepend-at-#glMarker semantics, lower priority is applied later → executes
     * later → its input is the previous extension's output (tonemap result).
     *
     * Note: FilmicGrainPlugin / ChromaticAberrationPlugin / VignettePlugin still sit at -50
     * (i.e., they run before tonemap). They have the same kind of webgi-vs-threepipe order
     * mismatch but are out of scope here.
     */
    priority = -150

    parsFragmentSnippet = () => {
        if (this.isDisabled()) return ''
        return glsl`${lutShader}`
    }

    protected _shaderPatch = glsl`
        #if (USE_LUT == 1 || USE_LUT1 == 1 || USE_LUT2 == 1)
            #if LUT_BACKGROUND == 1
                diffuseColor = colorLookUp(diffuseColor);
            #else
                #ifdef HAS_GBUFFER
                    diffuseColor = isBackground ? diffuseColor : colorLookUp(diffuseColor);
                #else
                    diffuseColor = colorLookUp(diffuseColor);
                #endif
            #endif
        #endif
    `

    private _onChange() {
        this._updateParams()
        this.setDirty()
    }

    private _updateParams() {
        this._updateLUT(this.lutMap, this.extraUniforms.lut3d, this.extraUniforms.lutSize)
        this.extraDefines.USE_LUT = this.lutMap ? 1 : 0
        this._updateLUT(this.lutMap1, this.extraUniforms.lut3d1, this.extraUniforms.lutSize1)
        this.extraDefines.USE_LUT1 = this.lutMap1 ? 1 : 0
        this._updateLUT(this.lutMap2, this.extraUniforms.lut3d2, this.extraUniforms.lutSize2)
        this.extraDefines.USE_LUT2 = this.lutMap2 ? 1 : 0
        this.extraDefines.LUT_BACKGROUND = this.lutBackground ? 1 : 0
    }

    private _updateLUT(wrapper: LUTCubeTextureWrapper | undefined, textureUniform: {value: Data3DTexture | null}, sizeUniform: {value: number}) {
        // Defensive: drag-drop / programmatic assignment may pass something that isn't
        // a fully-constructed LUTCubeTextureWrapper (e.g. a plain Texture, or the wrapper
        // before its texture3D is set). Skip instead of crashing.
        const tex3d = wrapper?.texture3D
        if (wrapper && tex3d) {
            textureUniform.value = tex3d
            sizeUniform.value = (tex3d.image as any)?.width ?? wrapper.size ?? 1
            tex3d.needsUpdate = true
        } else {
            if (wrapper && !tex3d) {
                console.warn('LUTPlugin: value has no .texture3D — expected a LUTCubeTextureWrapper from a .cube file, got:', wrapper)
            }
            textureUniform.value = null
        }
    }

    /**
     * Assign a material to a specific LUT slot (or exclude it from grading).
     *
     * Writes `material.userData['LUTPlugin1'] = { enable, index }` which `updateGBufferFlags`
     * packs into the GBuffer so the shader reads the slot per-pixel.
     * Pass `slot` 0, 1, or 2. Omit `enable` to keep the material's existing flag or default
     * to `true` on first write.
     *
     * @example
     * ```ts
     * lut.setMaterialLUT(sphere.material, {slot: 1})       // use lutMap1
     * lut.setMaterialLUT(cube.material, {slot: 2})         // use lutMap2
     * lut.setMaterialLUT(floor.material, {enable: false})  // exclude this material
     * ```
     */
    setMaterialLUT(material: IMaterial, config: {slot?: number; enable?: boolean}): void {
        if (!material?.userData) return
        const existing = material.userData[LUTPlugin.PluginType] ?? {}
        material.userData[LUTPlugin.PluginType] = {
            enable: config.enable ?? existing.enable ?? true,
            index: config.slot ?? existing.index ?? 0,
        }
        if (material.setDirty) material.setDirty()
        this.setDirty()
    }

    /**
     * Encodes per-material LUT settings into the GBuffer flags so the shader can pick
     * the right LUT slot per pixel. Mirrors webgi's LUTPlugin.updateGBuffer — bit 0 of
     * `.w` is the per-material enable; bits 0-2 of `.y` are the slot index (0-7,
     * clamped). When a material has no `userData['LUTPlugin1']` entry, LUT defaults to
     * enabled with slot 0 (matching webgi's fallback).
     */
    updateGBufferFlags(data: Vector4, ctx: GBufferUpdaterContext): void {
        const material: any = ctx.material
        const ud = material?.userData
        if (!ud) return
        const lutData = ud[LUTPlugin.PluginType]
        if (lutData) {
            const enabled = lutData.enable !== false
            data.w = updateBit(data.w, 0, enabled ? 1 : 0)
            for (let i = 0; i < 3; i++) data.y = clearBit(data.y, i)
            let lutIndex = enabled ? (lutData.index ?? 0) : 0
            lutIndex = Math.max(0, Math.min(lutIndex | 0, 7))
            data.y = data.y | lutIndex
        } else {
            data.w = updateBit(data.w, 0, 1)
        }
    }

    /**
     * Per-material UI extension — exposes the enable checkbox + slot-index dropdown in
     * the tweakpane material UI. Registered on the MaterialManager in {@link onAdded}.
     * Shader logic lives on `this` (the screen-pass extension); this UI extension is
     * UI-only — no `shaderExtender` / `parsFragmentSnippet`.
     */
    readonly materialExtension: MaterialExtension = {
        uuid: uuidV4(),
        getUiConfig: (material: IMaterial) => this._makeMaterialUi(material),
        computeCacheKey: (material: IMaterial) =>
            (this.enabled ? '1' : '0') + (material.userData[LUTPlugin.PluginType]?.enable ? '1' : '0'),
        isCompatible: () => true,
    }

    private _materialUiCache = new WeakMap<IMaterial, UiObjectConfig>()

    private _makeMaterialUi(material: IMaterial): UiObjectConfig {
        const cached = this._materialUiCache.get(material)
        if (cached) return cached
        const pluginType = LUTPlugin.PluginType
        const ensureData = () => {
            const ud = material.userData
            if (!ud[pluginType]) {
                ud[pluginType] = {enable: true, index: 0}
                if (material.setDirty) material.setDirty()
            }
            return ud[pluginType]
        }
        const self = this
        const config: UiObjectConfig = {
            type: 'folder',
            label: 'LUT',
            onChange: () => self.setDirty(),
            children: [
                {
                    type: 'checkbox',
                    label: 'Enabled',
                    get value() {
                        return material.userData[pluginType]?.enable ?? true
                    },
                    set value(v: boolean) {
                        const d = ensureData()
                        if (v === d.enable) return
                        d.enable = v
                        if (material.setDirty) material.setDirty()
                        self.setDirty()
                        config.uiRefresh?.(true, 'postFrame')
                    },
                },
                {
                    type: 'dropdown',
                    label: 'Index',
                    children: [
                        {label: 'LUT 0', value: 0},
                        {label: 'LUT 1', value: 1},
                        {label: 'LUT 2', value: 2},
                    ],
                    hidden: () => {
                        const d = material.userData[pluginType]
                        return d ? !d.enable : false
                    },
                    get value() {
                        return material.userData[pluginType]?.index ?? 0
                    },
                    set value(v: number) {
                        const d = ensureData()
                        if (v === d.index) return
                        d.index = v
                        self.setDirty()
                    },
                },
            ],
        }
        this._materialUiCache.set(material, config)
        return config
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.assetManager.materials.registerMaterialExtension(this.materialExtension)
        this._updateParams()
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.materials.unregisterMaterialExtension(this.materialExtension)
        super.onRemove(viewer)
    }

    constructor(enabled = false) {
        super()
        this.enabled = enabled
    }
}

declare module '../../core/IMaterial' {
    interface IMaterialUserData {
        /** Per-material LUT settings. Written by UI / consumed by `updateGBufferFlags`. */
        ['LUTPlugin1']?: {
            enable?: boolean
            index?: number
        }
    }
}
