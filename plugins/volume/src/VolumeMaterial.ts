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
} from 'threepipe'
import {TransferFunction} from './TransferFunction'
import type {VolumeData} from './VolumeData'
import {defaultVolumePresetName, volumePresets} from './library'
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
     * Set by {@link VolumePlugin} while the frame is not still, to use {@link interactiveSamplingRate}.
     */
    interactive = false

    constructor(parameters?: {field?: VolumeData, mode?: VolumeRenderMode, preset?: string}) {
        super()
        iMaterialCommons.upgradeMaterial.call(this)
        super.setValues({
            vertexShader,
            fragmentShader,
            uniforms: {
                volumeMap: {value: null},
                transferMap: {value: null},
                uBoxSize: {value: new Vector3(1, 1, 1)},
                uVolumeSize: {value: new Vector3(1, 1, 1)},
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
            },
            defines: {
                VOLUME_MODE: 0,
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
        this.needsUpdate = true
        this.setDirty({change: 'mode'})
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
        if (field) {
            const tex = field.texture
            u.volumeMap.value = tex
            u.uVolumeSize.value.set(field.xLength, field.yLength, field.zLength)
            // texture value t -> data value d -> transfer function coordinate
            const [t0, t1] = field.textureRange
            const span = this.range.y - this.range.x || 1
            u.uValueMap.value.set((t1 - t0) / span, (t0 - this.range.x) / span)
            u.uIsoValue.value = (this.isoValue - this.range.x) / span
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
            const hasDepth = !!rm.gbufferTarget
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
