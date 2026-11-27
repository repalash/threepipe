import {
    BackSide,
    BufferGeometry,
    Camera,
    generateUiConfig,
    Group,
    ICamera,
    IMaterialEventMap,
    IObject3D,
    IUniform,
    Material,
    Matrix3,
    NormalBlending,
    Object3D,
    onChange,
    Scene,
    iMaterialCommons,
    IMaterial,
    IMaterialParameters,
    IMaterialUserData,
    MaterialExtension,
    serialize,
    SerializationMetaType,
    ShaderMaterial,
    ShaderMaterialParameters,
    threeMaterialInterpolateProps,
    threeMaterialPropList,
    ThreeSerialization,
    WebGLProgramParametersWithUniforms,
    uiDropdown,
    uiNumber,
    uiSlider,
    uiToggle,
    UiObjectConfig,
    uiVector,
    Vector2,
    Vector3,
    WebGLRenderer,
    UniformsLib,
    UniformsUtils,
} from 'threepipe'
import {TransferFunction} from './TransferFunction'
import type {VolumeData} from './VolumeData'
import {defaultVolumePresetName, volumePresets} from './library'
import {MinMaxBlocks} from './derived/MinMaxBlocks'
import {EmptySpaceMap} from './derived/EmptySpaceMap'
import {GradientField, gradientMaxLength} from './derived/GradientField'
import {LightVolume} from './derived/LightVolume'
import {AmbientOcclusionVolume} from './derived/AmbientOcclusionVolume'
import type {VolumeOpacityParams} from './derived/opacityParams'
import {VolumeGBufferMaterial} from './VolumeGBufferMaterial'
import {findShadowLight, lightDirectionInTexture} from './lighting'
import vertexShader from './shaders/volume.vert.glsl'
import fragmentShader from './shaders/volume.frag.glsl'

/**
 * How samples along a ray become a pixel.
 * - `composite`: emission and absorption through the transfer function (direct volume rendering).
 * - `mip` / `minip`: the largest / smallest value on the ray, coloured by the transfer function.
 * - `average`: the mean value on the ray.
 * - `iso`: the first crossing of {@link VolumeMaterial.isoValue}, shaded as a surface.
 * - `xray`: summed absorption, like a radiograph.
 */
export type VolumeRenderMode = 'composite' | 'mip' | 'minip' | 'average' | 'iso' | 'xray'

/**
 * How samples are lit by the lights and the environment of the scene.
 * - `none`: the colour of the transfer function as it is (emission only).
 * - `surface`: shaded as a surface with the gradient as its normal (Lambert and GGX), like a mesh.
 * - `volume`: scattered by the medium with a phase function, no normal: fog, smoke, soft tissue.
 * - `hybrid`: surface where the gradient is strong, volume where it is weak ({@link VolumeMaterial.gradientFactor}).
 */
export type VolumeShading = 'none' | 'surface' | 'volume' | 'hybrid'

const shadingDefine: Record<VolumeShading, number> = {none: 0, surface: 1, volume: 2, hybrid: 3}

/**
 * Context for {@link VolumeMaterial.updateDerived}: the object drawn with the material and its scene, for the
 * lighting fields.
 */
export interface VolumeDerivedContext {
    object?: IObject3D
    scene?: Scene
    camera?: Camera
}

const modeDefine: Record<VolumeRenderMode, number> = {composite: 0, mip: 1, minip: 2, average: 3, iso: 4, xray: 5}

/**
 * The material of a {@link VolumeObject}: a ray march through a 3D texture, drawn on the back faces of the object's box.
 *
 * The march is built from four hook functions (`volSample`, `volClassify`, `volShade`, `volBlend`, see
 * `shaders/volume.frag.glsl`) that a material extension can replace, as with any threepipe material.
 *
 * Values: the texture of the {@link field} is mapped to data units, then {@link range} (in data units) is mapped to
 * 0..1 on the {@link transferFunction}. Setting a preset with an absolute range (the CT presets) sets {@link range}.
 *
 * Clipping: `clippingPlanes` of the material shorten the ray. The ray also stops at opaque scene geometry when a
 * `GBufferPlugin` is in the viewer.
 *
 * @category Materials
 */
export class VolumeMaterial<TE extends IMaterialEventMap = IMaterialEventMap> extends ShaderMaterial<TE & IMaterialEventMap> implements IMaterial<TE> {
    declare ['constructor']: typeof VolumeMaterial

    // the same structure as threepipe's ObjectShaderMaterial: a three.js ShaderMaterial with the IMaterial commons
    static readonly TypeSlug = 'volmat'
    static readonly TYPE = 'VolumeMaterial' // not using .type because it is used by three.js
    static readonly TypeAlias = ['volume', VolumeMaterial.TYPE, VolumeMaterial.TypeSlug]
    static {
        ThreeSerialization.SerializableMaterials.add(VolumeMaterial)
    }

    static readonly MaterialProperties = {
        ...threeMaterialPropList,
        // the settings are saved with @serialize; the shaders, uniforms and defines are rebuilt by the class
    }
    static readonly InterpolateProperties = [...threeMaterialInterpolateProps]

    assetType = 'material' as const
    declare userData: IMaterialUserData
    readonly isVolumeMaterial = true

    readonly appliedMeshes: Set<IObject3D> = new Set()
    readonly setDirty = iMaterialCommons.setDirty
    dispose(): this {
        this._field?.events.removeEventListener('update', this._fieldUpdate)
        this._emptySpace?.dispose()
        this._emptySpace = undefined
        this._lightVolume?.dispose()
        this._aoVolume?.dispose()
        this._lightVolume = this._aoVolume = undefined
        this._gbufferMaterial?.dispose()
        this._gbufferMaterial = undefined
        this.transferFunction.removeEventListener('update', this._tfUpdate)
        this.transferFunction.dispose()
        return iMaterialCommons.dispose(super.dispose).call(this)
    }
    /**
     * A copy with the same settings and field ({@link setValues} copies the volume settings).
     */
    clone(track = false): this {
        const m = iMaterialCommons.clone(super.clone).call(this, track) as this
        m.field = this._field
        return m
    }

    materialExtensions: MaterialExtension[] = []
    extraUniformsToUpload: Record<string, IUniform> = {}
    registerMaterialExtensions = iMaterialCommons.registerMaterialExtensions
    unregisterMaterialExtensions = iMaterialCommons.unregisterMaterialExtensions

    customProgramCacheKey(): string {
        return super.customProgramCacheKey() + iMaterialCommons.customProgramCacheKey.call(this)
    }

    onBeforeCompile(shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
        iMaterialCommons.onBeforeCompile.call(this, shader, renderer)
        super.onBeforeCompile(shader, renderer)
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group): void {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        iMaterialCommons.onAfterRender.call(this, renderer, scene, camera, geometry, object, group)
    }

    /**
     * Sets three.js material properties (side, blending, ...) from a material or a parameters object. From another
     * volume material it also copies the volume settings (not the field), as {@link copy}; `clone` goes through here.
     */
    setValues(parameters: Material | (ShaderMaterialParameters & IMaterialParameters), ...args: any[]): this {
        const res = (iMaterialCommons.setValues(super.setValues) as any).call(this, parameters, ...args)
        if ((parameters as any)?.isVolumeMaterial && parameters !== this) this._copySettings(parameters as unknown as VolumeMaterial)
        return res
    }

    /**
     * The field this material shows. Usually set by the {@link VolumeObject}.
     */
    get field(): VolumeData | undefined {
        return this._field
    }
    set field(v: VolumeData | undefined) {
        if (this._field === v) return
        this._field?.events.removeEventListener('update', this._fieldUpdate)
        this._field = v
        v?.events.addEventListener('update', this._fieldUpdate)
        if (v && !this._rangeSet) this.range.set(v.valueRange[0], v.valueRange[1])
        this.setDirty({change: 'field'})
    }
    private _field?: VolumeData
    private _rangeSet = false
    // set at the end of the constructor: the @onChange callbacks also run for the initial values of the fields
    private declare _constructed?: boolean
    private _fieldUpdate = () => this.setDirty({change: 'field'})

    @uiDropdown('Mode', (['composite', 'mip', 'minip', 'average', 'iso', 'xray'] as VolumeRenderMode[]).map(label => ({label})))
    @onChange(VolumeMaterial.prototype._modeChanged)
    @serialize() mode: VolumeRenderMode = 'composite'

    /**
     * The value range shown, in data units: `x` maps to 0 and `y` to 1 on the transfer function (window and level:
     * centre `(x + y) / 2`, width `y - x`). Defaults to the value range of the field.
     */
    @uiVector('Range')
    @onChange(VolumeMaterial.prototype._rangeChanged)
    @serialize() range = new Vector2(0, 1)

    @serialize() transferFunction = new TransferFunction()

    /**
     * Name of the preset in {@link volumePresets} last applied with {@link setPreset}. Changing it in the UI applies it.
     */
    @uiDropdown('Preset', Object.keys(volumePresets).map(label => ({label})))
    @onChange(VolumeMaterial.prototype._presetChanged)
    @serialize() preset = ''

    /**
     * Multiplies the opacity of every sample (composite and x-ray modes).
     */
    @uiSlider('Density', [0, 10], 0.01)
    @serialize() density = 1

    /**
     * Samples per voxel along the ray when the image is still. Higher is smoother and slower.
     */
    @uiSlider('Sampling Rate', [0.1, 4], 0.05)
    @serialize() samplingRate = 1

    /**
     * Samples per voxel while the camera or a setting changes. The full rate is used once the frame is still.
     */
    @uiSlider('Interactive Rate', [0.1, 4], 0.05)
    @serialize() interactiveSamplingRate = 0.5

    /**
     * The value of the isosurface in `iso` mode, in data units.
     */
    @uiNumber('Iso Value')
    @serialize() isoValue = 0.5

    /**
     * Offsets the start of each ray by a per-pixel noise that changes every frame. `ProgressivePlugin` averages the
     * frames, which removes the banding of the step size.
     */
    @uiToggle('Jitter')
    @serialize() jitter = true

    /**
     * Crop box in texture coordinates (0..1 per axis).
     */
    @uiVector('Crop Min', undefined, 0.01)
    @serialize() cropMin = new Vector3(0, 0, 0)
    @uiVector('Crop Max', undefined, 0.01)
    @serialize() cropMax = new Vector3(1, 1, 1)

    /**
     * Linear interpolation between voxels; off shows the voxels as blocks.
     */
    @uiToggle('Interpolate')
    @onChange(VolumeMaterial.prototype._interpolateChanged)
    @serialize() interpolate = true

    /**
     * Skip the parts of the volume that add nothing to the image: blocks whose values all have zero opacity on the
     * transfer function (composite and x-ray), that do not contain the iso value (iso), or that cannot change the
     * maximum or minimum so far (MIP, MinIP). Rays jump over them using a Chebyshev distance map of the empty blocks
     * ({@link EmptySpaceMap}); the image is the same as without it.
     *
     * The block maps are built on the GPU by {@link VolumePlugin}; without the plugin, or while they build, the rays
     * march every sample. Off with a material extension that replaces `volSample` or `volClassify`.
     */
    @uiToggle('Skip Empty Space')
    @onChange(VolumeMaterial.prototype._definesChanged)
    @serialize() emptySpaceSkipping = true

    /**
     * Size of the blocks for {@link emptySpaceSkipping}, in voxels along each axis. Smaller blocks fit the shape of
     * the data closer; larger ones mean fewer lookups and smaller maps.
     */
    @uiDropdown('Skip Block Size', [4, 8, 16].map(value => ({label: String(value), value})))
    @onChange(VolumeMaterial.prototype._blockSizeChanged)
    @serialize() skipBlockSize = 8

    /**
     * Read the gradient for shading from a precomputed texture ({@link GradientField}, 4 bytes per voxel) instead
     * of six samples of the field. Worth it when every sample is shaded (lighting, in the next phase); in iso mode only
     * one point per ray is.
     */
    @uiToggle('Gradient Texture')
    @onChange(VolumeMaterial.prototype._definesChanged)
    @serialize() gradientTexture = false

    /**
     * Sampling of the field between voxels: `linear` (8 voxels), or `cubic`, a tricubic B-spline (64 voxels in 8
     * lookups) that is smoother, for isosurfaces and shading, and slower.
     */
    @uiDropdown('Sampling', (['linear', 'cubic'] as const).map(label => ({label})))
    @onChange(VolumeMaterial.prototype._definesChanged)
    @serialize() sampling: 'linear' | 'cubic' = 'linear'

    /**
     * Lighting by the lights and the environment of the scene, see {@link VolumeShading}. Iso mode is always shaded as
     * a surface when it is not `none`.
     */
    @uiDropdown('Shading', (['none', 'surface', 'volume', 'hybrid'] as VolumeShading[]).map(label => ({label})))
    @onChange(VolumeMaterial.prototype._definesChanged)
    @serialize() shading: VolumeShading = 'none'

    /**
     * Hybrid shading: how fast a stronger gradient turns a sample into a surface. The surface share is
     * `1 - exp(-gradientFactor * |gradient|)`, with the gradient of the transfer function coordinate per voxel
     * (Exposure Render's gradient factor).
     */
    @uiSlider('Gradient Factor', [0, 100], 0.5)
    @serialize() gradientFactor = 20

    /**
     * Volume shading: the Henyey-Greenstein anisotropy of the scattering, from -1 (back to the light) through 0
     * (the same in all directions) to 1 (forward, bright when looking toward the light).
     */
    @uiSlider('Anisotropy', [-0.95, 0.95], 0.01)
    @serialize() anisotropy = 0

    /**
     * Surface shading: roughness of the GGX highlight.
     */
    @uiSlider('Roughness', [0, 1], 0.01)
    @serialize() roughness = 0.5

    /**
     * Surface shading: strength of the highlight (reflectance 0.04 at 1).
     */
    @uiSlider('Specular', [0, 2], 0.01)
    @serialize() specular = 1

    /**
     * The volume shadows itself from one light of the scene: the first directional, spot or point light that casts
     * shadows, else the first directional light. A {@link LightVolume} built on the GPU by {@link VolumePlugin}. Point
     * and spot lights are taken as coming from one direction (from the centre of the volume).
     */
    @uiToggle('Shadows')
    @onChange(VolumeMaterial.prototype._definesChanged)
    @serialize() shadows = false

    /**
     * Local ambient occlusion: darkens the environment and ambient light in creases and inside dense parts. An
     * {@link AmbientOcclusionVolume} built on the GPU by {@link VolumePlugin}.
     */
    @uiToggle('Ambient Occlusion')
    @onChange(VolumeMaterial.prototype._definesChanged)
    @serialize() ambientOcclusion = false

    /**
     * Reach of the ambient occlusion, in voxels.
     */
    @uiSlider('AO Radius', [1, 32], 1)
    @serialize() aoRadius = 8

    /**
     * Resolution of the shadow and ambient occlusion volumes relative to the field, per axis.
     */
    @uiDropdown('Lighting Resolution', [0.25, 0.5, 1].map(value => ({label: String(value), value})))
    @serialize() lightingResolution = 0.5

    /**
     * Show the work per pixel instead of the image: red is the samples read, green the loop iterations and blue the
     * samples a ray would read without {@link emptySpaceSkipping}, each over 512. Not saved.
     */
    @uiToggle('Debug: Show Steps')
    @onChange(VolumeMaterial.prototype._definesChanged)
    debugSteps = false

    /**
     * Set by {@link VolumePlugin} while the frame is not still, to use {@link interactiveSamplingRate}.
     */
    interactive = false

    private _emptySpace?: EmptySpaceMap
    private _lightVolume?: LightVolume
    private _aoVolume?: AmbientOcclusionVolume
    private _shadowLightType = 0
    private _shadowLightIndex = 0
    private _lightingVersion = 0

    constructor(parameters?: {field?: VolumeData, mode?: VolumeRenderMode, preset?: string}) {
        super()
        iMaterialCommons.upgradeMaterial.call(this)
        super.setValues({
            vertexShader,
            fragmentShader,
            // the three.js light uniforms, used when shading is on (material.lights)
            uniforms: UniformsUtils.merge([UniformsLib.lights, {
                volumeMap: {value: null},
                transferMap: {value: null},
                uBoxSize: {value: new Vector3(1, 1, 1)},
                uVolumeSize: {value: new Vector3(1, 1, 1)},
                uDataSize: {value: new Vector3(1, 1, 1)},
                uValueMap: {value: new Vector2(1, 0)},
                uSamplingRate: {value: 1},
                uOpacityExponent: {value: 1},
                uIsoValue: {value: 0.5},
                uCropMin: {value: new Vector3(0, 0, 0)},
                uCropMax: {value: new Vector3(1, 1, 1)},
                uResolution: {value: new Vector2(1, 1)},
                uNormalMatrix: {value: new Matrix3()},
                cameraNearFar: {value: new Vector2(0.1, 1000)},
                frameCount: {value: 0},
                uJitter: {value: 1},
                uSkipMap: {value: null},
                uMinMaxMap: {value: null},
                uSkipReady: {value: 0},
                uMinMaxReady: {value: 0},
                uBlockGrid: {value: new Vector3(1, 1, 1)},
                uBlockSize: {value: 8},
                uOpenEnds: {value: 0},
                uGradientMap: {value: null},
                uGradientReady: {value: 0},
                uEnvSH: {value: Array.from({length: 9}, () => new Vector3())},
                uEnvRotation: {value: new Matrix3()},
                uGradientFactor: {value: 20},
                uAnisotropy: {value: 0},
                uRoughness: {value: 0.5},
                uSpecular: {value: 1},
                uLightMap: {value: null},
                uLightReady: {value: 0},
                uLightPerm: {value: new Matrix3()},
                uLightOffset: {value: new Vector3()},
                uShadowLightType: {value: 0},
                uShadowLightIndex: {value: 0},
                uAOMap: {value: null},
                uAOReady: {value: 0},
                uAOBias: {value: 3},
            }]),
            defines: {
                VOLUME_MODE: 0,
                VOL_GRADIENT_MAX: gradientMaxLength.toFixed(7),
            },
            side: BackSide,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            premultipliedAlpha: true,
            blending: NormalBlending,
            clipping: true,
        })
        this.userData.renderToGBuffer = false
        this.userData.renderToDepth = false
        this.transferFunction.addEventListener('update', this._tfUpdate)
        if (parameters?.mode) this.mode = parameters.mode
        if (parameters?.field) this.field = parameters.field
        // an explicit preset also sets its range (the CT presets are in HU); the default one stretches over the field
        this.setPreset(parameters?.preset ?? defaultVolumePresetName, !!parameters?.preset)
        this._constructed = true
        this._definesChanged()
    }

    private _tfUpdate = () => this.setDirty({change: 'transferFunction'})

    /**
     * Apply a preset from {@link volumePresets}. A preset with an absolute range also sets {@link range}, unless
     * `setRange` is false.
     */
    setPreset(name: string, setRange = true) {
        const preset = volumePresets[name]
        if (!preset) {
            console.warn('VolumeMaterial: unknown preset', name)
            return
        }
        const range = this.transferFunction.setPreset(preset)
        if (range && setRange) {
            this.range.set(range[0], range[1])
            this._rangeSet = true
        }
        if (this.preset !== name) {
            this._skipPresetChange = true
            this.preset = name
            this._skipPresetChange = false
        }
        this.setDirty({change: 'preset'})
    }

    private _skipPresetChange = false
    private _presetChanged() {
        if (this._skipPresetChange || !this.preset) return
        this.setPreset(this.preset)
    }

    private _modeChanged() {
        this.defines.VOLUME_MODE = modeDefine[this.mode] ?? 0
        // an isosurface is opaque: it writes its depth and goes into the G-buffer (VolumeGBufferMaterial)
        const iso = this.mode === 'iso'
        if (iso) this.defines.VOL_WRITE_DEPTH = 1
        else delete this.defines.VOL_WRITE_DEPTH
        this.transparent = !iso
        this.depthWrite = iso
        if (this.userData) {
            this.userData.renderToGBuffer = iso
            this.userData.renderToDepth = iso
        }
        this.needsUpdate = true
        this.setDirty({change: 'mode'})
    }

    private _gbufferMaterial?: VolumeGBufferMaterial

    /**
     * The material that draws the isosurface into the G-buffer (iso mode), see {@link VolumeGBufferMaterial}.
     */
    get gbufferMaterial(): VolumeGBufferMaterial {
        if (!this._gbufferMaterial) this._gbufferMaterial = new VolumeGBufferMaterial(this)
        return this._gbufferMaterial
    }

    private _definesChanged() {
        if (!this._constructed) return
        const d = this.defines
        const set = (name: string, on: boolean) => {
            if (!!d[name] === on) return
            if (on) d[name] = 1
            else delete d[name]
            this.needsUpdate = true
        }
        set('VOL_SKIP', this.emptySpaceSkipping)
        set('VOL_CUBIC', this.sampling === 'cubic')
        const shading = shadingDefine[this.shading] ?? 0
        if ((d.VOL_LIGHTING ?? 0) !== shading) {
            if (shading) d.VOL_LIGHTING = shading
            else delete d.VOL_LIGHTING
            this.needsUpdate = true
        }
        if (this.lights !== shading > 0) {
            this.lights = shading > 0
            this.needsUpdate = true
        }
        set('VOL_SHADOWS', shading > 0 && this.shadows)
        set('VOL_AO', shading > 0 && this.ambientOcclusion)
        set('VOL_GRADIENT_MAP', this.gradientTexture)
        set('VOL_DEBUG_STEPS', this.debugSteps)
        this.setDirty({change: 'defines'})
    }

    private _blockSizeChanged() {
        this._emptySpace?.dispose()
        this._emptySpace = undefined
        this.setDirty({change: 'skipBlockSize'})
    }

    /**
     * Texture value to transfer function coordinate (`t * x + y`) for the field and {@link range}.
     */
    private _valueMap(field: VolumeData): [number, number] {
        const [t0, t1] = field.textureRange
        const span = this.range.y - this.range.x || 1
        return [(t1 - t0) / span, (t0 - this.range.x) / span]
    }

    private _usesEmptySpaceMap() {
        return this.mode === 'composite' || this.mode === 'xray' || this.mode === 'iso'
    }

    private _usesMinMax() {
        return this.emptySpaceSkipping && this.mode !== 'average'
    }

    private _blocks(field: VolumeData) {
        const minMax = MinMaxBlocks.of(field, this.skipBlockSize, this.sampling === 'cubic' ? 2 : 1)
        if (this._emptySpace && this._emptySpace.minMax !== minMax) {
            this._emptySpace.dispose()
            this._emptySpace = undefined
        }
        if (!this._emptySpace) this._emptySpace = new EmptySpaceMap(minMax)
        return {minMax, emptySpace: this._emptySpace}
    }

    // what counts as empty for the current settings; the map is invalidated when it changes
    private _setEmptySpaceParams(field: VolumeData, emptySpace: EmptySpaceMap) {
        emptySpace.setParams({
            mode: this.mode === 'iso' ? 'iso' : 'transfer',
            valueMap: this._valueMap(field),
            iso: (this.isoValue - this.range.x) / (this.range.y - this.range.x || 1),
            transferTexture: this.transferFunction.texture,
        })
    }

    /**
     * Builds the GPU maps the march uses ({@link emptySpaceSkipping}, {@link gradientTexture}), spending at most
     * `budget` texture reads; called by {@link VolumePlugin} before each frame. Returns the reads spent.
     */
    updateDerived(renderer: WebGLRenderer, budget = Infinity, context: VolumeDerivedContext = {}): number {
        const field = this._field
        if (!field) return 0
        let spent = 0
        spent += this._updateLighting(renderer, budget, field, context)
        if (this._usesMinMax()) {
            const {minMax, emptySpace} = this._blocks(field)
            spent += minMax.update(renderer, budget - spent)
            if (this._usesEmptySpaceMap() && minMax.ready) {
                this._setEmptySpaceParams(field, emptySpace)
                if (budget - spent > 0) spent += emptySpace.update(renderer, budget - spent)
            }
        }
        if (this.gradientTexture && budget - spent > 0) spent += GradientField.of(field).update(renderer, budget - spent)
        return spent
    }

    /**
     * Rebuild the maps of {@link updateDerived}, including those cached on the field.
     */
    invalidateDerived() {
        this._emptySpace?.invalidate()
        this._lightVolume?.invalidate()
        this._aoVolume?.invalidate()
        this._field?.invalidateDerived()
    }

    private _opacityParams(field: VolumeData): VolumeOpacityParams {
        return {
            source: field.texture,
            transferTexture: this.transferFunction.texture,
            valueMap: this._valueMap(field),
            mode: this.mode === 'iso' ? 'iso' : 'transfer',
            iso: (this.isoValue - this.range.x) / (this.range.y - this.range.x || 1),
            density: this.density,
        }
    }

    private _usesShadows() {
        return this.shading !== 'none' && this.shadows
    }

    private _usesAO() {
        return this.shading !== 'none' && this.ambientOcclusion
    }

    /**
     * Picks the shadow light and builds the light and ambient occlusion volumes.
     */
    private _updateLighting(renderer: WebGLRenderer, budget: number, field: VolumeData, context: VolumeDerivedContext): number {
        let spent = 0
        this._shadowLightType = 0
        if (this._usesShadows() && context.scene && context.object) {
            const found = findShadowLight(context.scene, context.camera)
            if (found) {
                this._shadowLightType = found.type
                this._shadowLightIndex = found.index
                if (!this._lightVolume) this._lightVolume = new LightVolume()
                const dir = lightDirectionInTexture(found.light, context.object, this._boxSize(context.object))
                this._lightVolume.setParams({
                    ...this._opacityParams(field),
                    lightDirection: dir,
                    sourceSize: field.textureSize,
                    scale: this.lightingResolution,
                })
                const v = this._lightVolume.version
                if (budget - spent > 0) spent += this._lightVolume.update(renderer, budget - spent)
                if (this._lightVolume.version !== v) this._lightingVersion++
            }
        }
        if (this._usesAO()) {
            if (!this._aoVolume) this._aoVolume = new AmbientOcclusionVolume()
            this._aoVolume.setParams({
                ...this._opacityParams(field),
                sourceSize: field.textureSize,
                scale: this.lightingResolution,
                radius: this.aoRadius,
            })
            const v = this._aoVolume.version
            if (budget - spent > 0) spent += this._aoVolume.update(renderer, budget - spent)
            if (this._aoVolume.version !== v) this._lightingVersion++
        }
        return spent
    }

    private _boxSize(object: IObject3D): Vector3 {
        const p = (object as any).geometry?.parameters
        return p && p.width !== undefined ? new Vector3(p.width, p.height, p.depth) : new Vector3(1, 1, 1)
    }

    /**
     * Increments when a lighting field finished building and the image changes ({@link VolumePlugin} then starts
     * the progressive frames again).
     */
    get lightingVersion() {
        return this._lightingVersion
    }

    /**
     * The environment light as spherical harmonics (radiance, world space, 9 coefficients) and the rotation from world
     * to environment directions. Set by {@link VolumePlugin} from `scene.environment`.
     */
    setEnvironment(coefficients: Vector3[] | undefined, rotation?: Matrix3) {
        const u = this.uniforms as Record<string, IUniform>
        const sh = u.uEnvSH.value as Vector3[]
        for (let i = 0; i < 9; i++) {
            if (coefficients?.[i]) sh[i].copy(coefficients[i])
            else sh[i].set(0, 0, 0)
        }
        if (rotation) u.uEnvRotation.value.copy(rotation)
        else u.uEnvRotation.value.identity()
    }

    /**
     * Whether a map from {@link updateDerived} is still being built (the march then reads every sample).
     */
    get derivedPending(): boolean {
        const field = this._field
        if (!field) return false
        if (this._usesMinMax()) {
            const {minMax, emptySpace} = this._blocks(field)
            if (!minMax.ready) return true
            if (this._usesEmptySpaceMap() && !emptySpace.ready) return true
        }
        if (this._usesShadows() && this._shadowLightType && this._lightVolume && !this._lightVolume.ready) return true
        if (this._usesAO() && this._aoVolume && !this._aoVolume.ready) return true
        return this.gradientTexture && !GradientField.of(field).ready
    }

    /**
     * Bytes on the GPU of the maps of this material ({@link EmptySpaceMap}); the field and the maps cached on it
     * ({@link MinMaxBlocks}, {@link GradientField}) are counted by the field.
     */
    get derivedGpuBytes(): number {
        return (this._emptySpace?.gpuBytes ?? 0) + (this._lightVolume?.gpuBytes ?? 0) + (this._aoVolume?.gpuBytes ?? 0)
    }

    private _rangeChanged() {
        if (this._constructed) this._rangeSet = true
        this.setDirty({change: 'range'})
    }

    private _interpolateChanged() {
        if (this._field) this._field.interpolate = this.interpolate
        this.setDirty({change: 'interpolate'})
    }

    /**
     * Fit {@link range} to the value range of the field.
     */
    resetRange() {
        if (!this._field) return
        this.range.set(this._field.valueRange[0], this._field.valueRange[1])
        this._rangeSet = false
        this.setDirty({change: 'range'})
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: Object3D, group: Group): void {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)
        iMaterialCommons.onBeforeRender.call(this, renderer, scene, camera, geometry, object, group)
        const u = this.uniforms as Record<string, IUniform>
        const field = this._field
        u.uSkipReady.value = 0
        u.uMinMaxReady.value = 0
        u.uGradientReady.value = 0
        u.uLightReady.value = 0
        u.uAOReady.value = 0
        u.uGradientFactor.value = this.gradientFactor
        u.uAnisotropy.value = this.anisotropy
        u.uRoughness.value = this.roughness
        u.uSpecular.value = this.specular
        if (this._usesShadows() && this._shadowLightType && this._lightVolume?.texture) {
            u.uLightMap.value = this._lightVolume.texture
            u.uLightPerm.value.copy(this._lightVolume.texturePermutation)
            u.uLightOffset.value.copy(this._lightVolume.textureOffset)
            u.uShadowLightType.value = this._shadowLightType
            u.uShadowLightIndex.value = this._shadowLightIndex
            u.uLightReady.value = 1
        }
        if (this._usesAO() && this._aoVolume?.texture) {
            u.uAOMap.value = this._aoVolume.texture
            // about 1.5 voxels of the occlusion volume
            u.uAOBias.value = 1.5 / Math.max(0.05, this.lightingResolution)
            u.uAOReady.value = 1
        }
        if (field) {
            const tex = field.texture
            u.volumeMap.value = tex
            const [sx, sy, sz] = field.textureSize
            u.uVolumeSize.value.set(sx, sy, sz)
            u.uDataSize.value.set(field.xLength, field.yLength, field.zLength)
            // texture value t -> data value d -> transfer function coordinate
            const [vx, vy] = this._valueMap(field)
            u.uValueMap.value.set(vx, vy)
            u.uIsoValue.value = (this.isoValue - this.range.x) / (this.range.y - this.range.x || 1)
            if (this._usesMinMax()) {
                const {minMax, emptySpace} = this._blocks(field)
                const [gx, gy, gz] = minMax.size
                u.uBlockGrid.value.set(gx, gy, gz)
                u.uBlockSize.value = minMax.blockSize
                u.uOpenEnds.value = minMax.openEnds ? 1 : 0
                if (minMax.ready) {
                    u.uMinMaxMap.value = minMax.texture
                    u.uMinMaxReady.value = 1
                }
                // the settings may have changed since the plugin last built the map (its budget may have run out
                // before this material): check them here, so a stale map is never used
                if (this._usesEmptySpaceMap()) this._setEmptySpaceParams(field, emptySpace)
                if (this._usesEmptySpaceMap() && emptySpace.ready) {
                    u.uSkipMap.value = emptySpace.texture
                    u.uSkipReady.value = 1
                }
            }
            if (this.gradientTexture) {
                const g = GradientField.of(field)
                if (g.ready) {
                    u.uGradientMap.value = g.texture
                    u.uGradientReady.value = 1
                }
            }
        }
        u.transferMap.value = this.transferFunction.texture
        const box = (geometry as any)?.parameters
        if (box && box.width !== undefined) u.uBoxSize.value.set(box.width, box.height, box.depth)
        const rate = Math.max(0.01, this.interactive ? this.interactiveSamplingRate : this.samplingRate)
        u.uSamplingRate.value = rate
        u.uOpacityExponent.value = this.density / rate
        u.uCropMin.value.copy(this.cropMin)
        u.uCropMax.value.copy(this.cropMax)
        u.uJitter.value = this.jitter ? 1 : 0
        u.uNormalMatrix.value.copy(object.normalMatrix)

        const target = renderer.getRenderTarget()
        if (target) u.uResolution.value.set(target.width, target.height)
        else renderer.getDrawingBufferSize(u.uResolution.value)

        ;(camera as ICamera).updateShaderProperties?.(this as any) // cameraNearFar
        const rm = (renderer as any).renderManager
        if (rm) {
            rm.updateShaderProperties?.(this) // frameCount
            // stop the ray at opaque geometry when the viewer has a G-buffer with depth
            const ext = rm.gbufferUnpackExtension
            if (ext && !this.materialExtensions.includes(ext)) this.registerMaterialExtensions([ext])
            // the isosurface writes its own depth and is depth tested
            const hasDepth = !!rm.gbufferTarget && this.mode !== 'iso'
            if (this.depthTest === hasDepth) {
                // with scene depth in the shader, the back faces must not be depth tested: a mesh inside the
                // volume would hide the part of the volume in front of it
                this.depthTest = !hasDepth
            }
        }
    }

    // region serialization

    toJSON(meta?: SerializationMetaType, _internal = false): any {
        if (_internal) return {
            uuid: this.uuid,
            type: this.constructor.TYPE,
            name: this.name,
            ...ThreeSerialization.Serialize(this, meta, true),
        }
        return ThreeSerialization.Serialize(this, meta, false)
    }

    fromJSON(data: any, meta?: SerializationMetaType, _internal = false): this | null {
        if (_internal) {
            const preset = data.preset
            const d = {...data}
            delete d.preset // the transfer function points are saved, do not re-apply the preset over them
            ThreeSerialization.Deserialize(d, this, meta, true)
            if (preset !== undefined) {
                this._skipPresetChange = true
                this.preset = preset
                this._skipPresetChange = false
            }
            this._rangeSet = true
            this.transferFunction.setDirty()
            this._modeChanged()
            this._definesChanged()
            this._blockSizeChanged()
            return this
        }
        this.dispatchEvent({type: 'beforeDeserialize', data, meta, bubbleToObject: true, bubbleToParent: true} as any)
        return this
    }

    /**
     * Copies the settings (not the field) from another volume material.
     */
    copy(source: Material | any): this {
        return this.setValues(source)
    }

    private _copySettings(source: VolumeMaterial) {
        this.mode = source.mode
        this.range.copy(source.range)
        this.transferFunction.copy(source.transferFunction)
        // keep the copied transfer function and range: set the name without applying the preset
        this._skipPresetChange = true
        this.preset = source.preset
        this._skipPresetChange = false
        this.density = source.density
        this.samplingRate = source.samplingRate
        this.interactiveSamplingRate = source.interactiveSamplingRate
        this.isoValue = source.isoValue
        this.jitter = source.jitter
        this.cropMin.copy(source.cropMin)
        this.cropMax.copy(source.cropMax)
        this.interpolate = source.interpolate
        this.emptySpaceSkipping = source.emptySpaceSkipping
        this.skipBlockSize = source.skipBlockSize
        this.gradientTexture = source.gradientTexture
        this._rangeSet = true
        this.setDirty({change: 'copy'})
    }

    // endregion

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Volume Material',
        uuid: 'VolMat_' + this.uuid,
        expanded: true,
        children: [
            ...generateUiConfig(this),
            {
                type: 'button',
                label: 'Fit range to data',
                value: () => this.resetRange(),
            },
        ],
        onChange: () => this.setDirty({change: 'ui'}),
    }

}

