import {
    AmbientLight2,
    BasicDepthPacking,
    Box3B,
    BufferGeometry,
    Camera,
    Color,
    DataTexture,
    DirectionalLight2,
    EquirectangularReflectionMapping,
    EventDispatcher,
    FrontSide,
    Group,
    Group2,
    HemisphereLight2,
    IMaterial,
    ITexture,
    Light,
    Material,
    MeshBasicMaterial,
    MeshDepthMaterialOverride,
    MeshNormalMaterialOverride,
    NoBlending,
    Object3D,
    PhysicalMaterial,
    RGBAFormat,
    Scene,
    shaderReplaceString,
    ThreeViewer,
    UVMapping,
    Vector3,
    WebGLRenderer,
} from 'threepipe'

/*
 * Scene overrides: show the scene with one debug material (unlit, depth, normals, material ID, UV) or with other
 * lights / another environment, without changing the scene. Ported from the blueprint editor
 * (LightMaterialOverrider, OverrideLightingPresets, the override materials and SceneOverrideMaterialMenu) to plain
 * TypeScript.
 *
 * Everything is applied only while the viewer renders (`preRender` → `postRender`): the main render pass override
 * material, the hidden scene lights, the override environment and the depth range. Outside a render the scene, its
 * lights and the render pass are exactly as the user left them, so export, the layers panel and the light visibility
 * toggles see the real scene.
 */

export type SceneOverrideMaterialType = 'basic' | 'depth' | 'normal' | 'normalWorld' | 'materialId' | 'uv'
export type SceneOverrideLightingType =
    'lights-day' | 'lights-night' | 'lights-studio' | 'lights-none' |
    'env-day' | 'env-night' | 'env-studio' | 'env-indoors' | 'env-outdoors'
export type SceneOverrideGroup = 'lights' | 'env' | 'material'

export interface SceneOverrideMaterialItem {
    key: SceneOverrideMaterialType
    label: string
    group: 'material'
    /** blueprint icon name in the original menu */
    icon: string
}

export interface SceneOverrideLightingPreset {
    key: SceneOverrideLightingType
    label: string
    group: 'lights' | 'env'
    /** blueprint icon name in the original menu */
    icon: string
    /** HDR/EXR url for the 'env' group. Change it before the first use to load another file. */
    url?: string
    /** Creates the lights for the 'lights' group */
    lights?: () => Light[]
}

export interface SceneOverridesEventMap {
    /** Material, lighting, loading state or UV channel changed. Re-render the menu. */
    change: object
}

// region override materials (from the blueprint editor src/utils/three/materials)

type SourceMaterial = IMaterial & Partial<PhysicalMaterial>

/** The material of a mesh (the first one of a multi-material mesh) */
function sourceMaterial(object: any): SourceMaterial | undefined {
    const m = object?.material
    return Array.isArray(m) ? m[0] : m
}

/** Copies the side, wireframe and alpha settings of the mesh material, shared by the unlit, ID and UV overrides */
function copyCommon(target: MeshBasicMaterial, material: SourceMaterial) {
    if (material.opacity !== undefined) target.opacity = material.opacity
    if (material.transparent !== undefined) target.transparent = material.transparent
    if (material.alphaMap !== undefined) target.alphaMap = material.alphaMap
    if (material.alphaTest !== undefined) target.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
    if (material.alphaHash !== undefined) target.alphaHash = material.alphaHash
    if (material.side !== undefined) target.side = material.side
    if (material.wireframe !== undefined) target.wireframe = material.wireframe
    if (material.wireframeLinewidth !== undefined) target.wireframeLinewidth = material.wireframeLinewidth
}

/** Resets what {@link copyCommon} sets */
function resetCommon(target: MeshBasicMaterial) {
    target.color.setHex(0xffffff)
    target.opacity = 1
    target.transparent = false
    target.alphaMap = null
    target.alphaTest = 0
    target.side = FrontSide
    target.wireframe = false
    target.wireframeLinewidth = 1
}

/** Unlit: the base color and color map of each mesh, no lights */
class UnlitOverrideMaterial extends MeshBasicMaterial {
    constructor() {
        super({color: new Color(0xaaaaaa)})
        this.reset()
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)
        const material = sourceMaterial(object)
        if (!material) return
        copyCommon(this, material)
        if (material.color !== undefined) this.color.copy(material.color)
        // the program depends on the presence of these maps, so recompile (from the program cache) when it changes
        const before = !!this.map + ',' + !!this.aoMap + ',' + !!this.lightMap
        if (material.map !== undefined) this.map = material.map
        if (material.aoMap !== undefined) this.aoMap = material.aoMap
        if (material.aoMapIntensity !== undefined) this.aoMapIntensity = material.aoMapIntensity
        if (material.lightMap !== undefined) this.lightMap = material.lightMap
        if (material.lightMapIntensity !== undefined) this.lightMapIntensity = material.lightMapIntensity
        if (before !== !!this.map + ',' + !!this.aoMap + ',' + !!this.lightMap) this.needsUpdate = true
        ;(renderer as WebGLRenderer & {resetCurrentMaterial?: () => void}).resetCurrentMaterial?.()
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    reset() {
        resetCommon(this)
        this.map = null
        this.aoMap = null
        this.aoMapIntensity = 1
        this.lightMap = null
        this.lightMapIntensity = 1
    }
}

/** Material ID: one flat color per material (golden-ratio hues from the material id) */
class MaterialIdOverrideMaterial extends MeshBasicMaterial {
    private _colors = new Map<number, Color>()

    constructor() {
        super()
        this.reset()
    }

    private _colorFor(id: number): Color {
        let c = this._colors.get(id)
        if (!c) {
            c = new Color().setHSL(id * 0.618033988749895 % 1, 1, 0.5)
            this._colors.set(id, c)
        }
        return c
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)
        const material = sourceMaterial(object)
        if (!material) return
        copyCommon(this, material)
        this.color.copy(this._colorFor(material.id ?? 0))
        ;(renderer as WebGLRenderer & {resetCurrentMaterial?: () => void}).resetCurrentMaterial?.()
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    reset() {
        resetCommon(this)
    }
}

/** UV: U in red, V in green for the selected channel (0-3); black where the mesh has no such UV set (a missing attribute reads as 0) */
class UvOverrideMaterial extends MeshBasicMaterial {
    uvChannel: 0 | 1 | 2 | 3 = 0

    constructor() {
        super()
        this.reset()
    }

    customProgramCacheKey() {
        return 'scene-override-uv-' + this.uvChannel
    }

    onBeforeCompile(shader: any) {
        if (!shader.defines) shader.defines = {}
        shader.defines.USE_UV = ''
        shader.vertexUv1s = true
        shader.vertexUv2s = true
        shader.vertexUv3s = true
        const varyings = `
#ifdef USE_UV1
    varying vec2 vUv1;
#endif
#ifdef USE_UV2
    varying vec2 vUv2;
#endif
#ifdef USE_UV3
    varying vec2 vUv3;
#endif
`
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <common>', varyings, {append: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <uv_vertex>', `
#ifdef USE_UV1
    vUv1 = uv1;
#endif
#ifdef USE_UV2
    vUv2 = uv2;
#endif
#ifdef USE_UV3
    vUv3 = uv3;
#endif
`, {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'uniform float opacity;', '\n#define vUv0 vUv\n' + varyings, {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, '#include <opaque_fragment>', `
#ifdef USE_UV
    gl_FragColor = vec4( fract(vUv${this.uvChannel}.x), fract(vUv${this.uvChannel}.y), 0.0, diffuseColor.a );
#else
    gl_FragColor = vec4( 1.0, 0.0, 1.0, diffuseColor.a );
#endif
`)
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)
        const material = sourceMaterial(object)
        if (!material) return
        copyCommon(this, material)
        ;(renderer as WebGLRenderer & {resetCurrentMaterial?: () => void}).resetCurrentMaterial?.()
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    reset() {
        resetCommon(this)
    }
}

/**
 * three's MeshNormalMaterial and MeshDepthMaterial write gl_FragColor without the output encoding. threepipe renders
 * to an RGBM target by default (`rgbm: true`), so their raw values are decoded as very bright colors and the
 * opaque objects show white. Add the encoding at the end of main(), as the other built-in materials do.
 */
function encodeOutput(shader: any) {
    shader.fragmentShader = shaderReplaceString(shader.fragmentShader, /}\s*$/, '\n#include <colorspace_fragment>\n}\n')
}

/** View-space normals */
class NormalOverrideMaterial extends MeshNormalMaterialOverride {
    customProgramCacheKey() {
        return 'scene-override-normal'
    }

    onBeforeCompile(shader: any) {
        encodeOutput(shader)
    }
}

/** World-space normals */
class NormalWorldOverrideMaterial extends NormalOverrideMaterial {
    customProgramCacheKey() {
        return 'scene-override-normal-world'
    }

    onBeforeCompile(shader: any) {
        super.onBeforeCompile(shader)
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <common>', '\nvarying vec3 vWorldNormal;', {append: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <beginnormal_vertex>',
            '\nvWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);', {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'uniform float opacity;', '\nvarying vec3 vWorldNormal;', {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );',
            'gl_FragColor = vec4( packNormalToRGB( normalize( vWorldNormal ) ), diffuseColor.a );')
    }
}

/**
 * Depth: linear view depth between {@link depthNear} (white) and {@link depthFar} (black).
 * The blueprint editor changed the camera near/far for this view; a linear range in the shader gives the same image
 * without changing the camera (threepipe cameras manage near/far themselves with autoNearFar).
 */
class LinearDepthOverrideMaterial extends MeshDepthMaterialOverride {
    readonly depthNear = {value: 0.1}
    readonly depthFar = {value: 100}

    constructor() {
        super({depthPacking: BasicDepthPacking, blending: NoBlending})
    }

    customProgramCacheKey() {
        return 'scene-override-linear-depth'
    }

    onBeforeCompile(shader: any) {
        shader.uniforms.depthNear = this.depthNear
        shader.uniforms.depthFar = this.depthFar
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <common>', '\nvarying float vSceneOverrideViewZ;', {append: true})
        shader.vertexShader = shaderReplaceString(shader.vertexShader, '#include <project_vertex>', '\nvSceneOverrideViewZ = -mvPosition.z;', {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader, 'varying vec2 vHighPrecisionZW;',
            '\nvarying float vSceneOverrideViewZ;\nuniform float depthNear;\nuniform float depthFar;', {append: true})
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;',
            'float fragCoordZ = clamp((vSceneOverrideViewZ - depthNear) / max(depthFar - depthNear, 1e-6), 0., 1.);')
        encodeOutput(shader)
    }
}

// endregion

const ENV_BASE = 'https://threejs.org/examples/textures/equirectangular/'

/** Lighting and environment presets, in the order of the blueprint menu */
function defaultLightingPresets(): SceneOverrideLightingPreset[] {
    const dir = (color: number, intensity: number, x: number, y: number, z: number) => {
        const l = new DirectionalLight2(color, intensity)
        l.position.set(x, y, z)
        l.castShadow = false
        return l
    }
    return [
        {key: 'lights-day', label: 'Day', group: 'lights', icon: 'flash', lights: () => {
            const sky = new HemisphereLight2(0x87ceeb, 0x545454, 0.6)
            sky.position.set(0, 10, 0)
            return [dir(0xffffff, 1.5, 5, 10, 7.5), sky]
        }},
        {key: 'lights-night', label: 'Night', group: 'lights', icon: 'moon', lights: () =>
            [dir(0x6b8cba, 0.3, -5, 10, -7.5), new AmbientLight2(0x1a2332, 0.2)]},
        {key: 'lights-studio', label: 'Studio', group: 'lights', icon: 'camera', lights: () => [
            dir(0xffffff, 1.0, 5, 10, 5), // key
            dir(0xffffff, 0.4, -5, 5, 5), // fill
            dir(0xffffff, 0.5, 0, 5, -10), // back
            new AmbientLight2(0xffffff, 0.3),
        ]},
        {key: 'lights-none', label: 'None', group: 'lights', icon: 'disable', lights: () => []},
        {key: 'env-day', label: 'Day', group: 'env', icon: 'globe', url: ENV_BASE + 'quarry_01_1k.hdr'},
        {key: 'env-night', label: 'Night', group: 'env', icon: 'moon', url: ENV_BASE + 'moonless_golf_1k.hdr'},
        {key: 'env-studio', label: 'Studio', group: 'env', icon: 'camera', url: 'https://samples.threepipe.org/minimal/studio_small_03_1k.hdr'},
        {key: 'env-indoors', label: 'Indoors', group: 'env', icon: 'home', url: 'https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr'},
        {key: 'env-outdoors', label: 'Outdoors', group: 'env', icon: 'outdated', url: 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'},
    ]
}

/**
 * Scene overrides for an editor menu: draw every mesh with one debug material, or light the scene with preset lights
 * or another environment. Material and lighting overrides are exclusive (choosing one clears the other), as in the
 * blueprint editor: the debug materials are unlit, so lights would not change them.
 *
 * ```ts
 * const overrides = new SceneOverrides(viewer)
 * overrides.addEventListener('change', renderMenu)
 * overrides.setMaterial('normal')
 * await overrides.setLighting('env-studio')
 * overrides.clear()
 * ```
 */
export class SceneOverrides extends EventDispatcher<SceneOverridesEventMap> {
    /** Material overrides for a menu, in the blueprint menu order */
    readonly materialTypes: SceneOverrideMaterialItem[] = [
        {key: 'basic', label: 'Unlit', group: 'material', icon: 'circle'},
        {key: 'depth', label: 'Depth', group: 'material', icon: 'layers'},
        {key: 'normal', label: 'Normal', group: 'material', icon: 'swap-vertical'},
        {key: 'normalWorld', label: 'Normal World', group: 'material', icon: 'globe'},
        {key: 'materialId', label: 'Material ID', group: 'material', icon: 'lightbulb'},
        {key: 'uv', label: 'UV', group: 'material', icon: 'grid-view'},
    ]
    /** Lighting ('lights') and environment ('env') presets for a menu. Change a `url` to use another HDR. */
    readonly lightingPresets: SceneOverrideLightingPreset[] = defaultLightingPresets()

    /**
     * With false (default) the 'lights' presets also turn off the environment map, so the image shows only the preset
     * lights (the blueprint editor kept the scene environment, which made e.g. 'Night' look like the normal scene).
     * Set true to keep the scene environment with the preset lights. Applies to the next {@link setLighting} call.
     */
    lightsKeepEnvironment = false

    /** Holds the preset lights, in the scene root (not in modelRoot), so they are not selectable or exported */
    readonly lightsRoot = new Group2()

    private _viewer?: ThreeViewer
    private _material: SceneOverrideMaterialType | null = null
    private _lighting: SceneOverrideLightingType | null = null
    private _loading: SceneOverrideLightingType | null = null
    private _request = 0
    private _materials: Record<SceneOverrideMaterialType, Material>
    /** Environment used while a lighting override is active. Black for the 'lights' presets, null to keep the scene one. */
    private _environment: ITexture | null = null
    private _black: ITexture
    private _envCache = new Map<string, Promise<ITexture | null>>()
    // state saved in preRender and restored in postRender
    private _hiddenLights: [Object3D, number][] = []
    private _savedEnvironment: ITexture | null = null
    private _savedOverrideMaterial: Material | null = null
    private _rendering = false

    constructor(viewer?: ThreeViewer) {
        super()
        this.lightsRoot.name = 'Scene Override Lights'
        this.lightsRoot.visible = false
        const ud = this.lightsRoot.userData
        ud.userSelectable = false
        ud.bboxVisible = false
        ud.excludeFromExport = true
        ud.disableWidgets = true

        this._materials = {
            basic: new UnlitOverrideMaterial(),
            depth: new LinearDepthOverrideMaterial(),
            normal: new NormalOverrideMaterial({blending: NoBlending}),
            normalWorld: new NormalWorldOverrideMaterial({blending: NoBlending}),
            materialId: new MaterialIdOverrideMaterial(),
            uv: new UvOverrideMaterial(),
        }
        for (const m of Object.values(this._materials)) m.name = 'Scene Override'

        const black = new DataTexture(new Uint8Array(4 * 4 * 2), 4, 2, RGBAFormat)
        black.mapping = EquirectangularReflectionMapping
        black.name = 'Scene Override No Environment'
        black.needsUpdate = true
        this._black = black as ITexture

        if (viewer) this.viewer = viewer
    }

    get viewer(): ThreeViewer | undefined {
        return this._viewer
    }

    /** Attach to a viewer (or detach with undefined). Detaching clears the overrides. */
    set viewer(v: ThreeViewer | undefined) {
        if (v === this._viewer) return
        if (this._viewer) {
            this.clear()
            this._viewer.removeEventListener('preRender', this._preRender)
            this._viewer.removeEventListener('postRender', this._postRender)
            this.lightsRoot.removeFromParent()
        }
        this._viewer = v
        if (v) {
            v.scene.addObject(this.lightsRoot, {addToRoot: true, autoScale: false, autoCenter: false})
            v.addEventListener('preRender', this._preRender)
            v.addEventListener('postRender', this._postRender)
        }
    }

    /** Current material override, null when off */
    get material(): SceneOverrideMaterialType | null {
        return this._material
    }

    /** Current lighting override (applied), null when off */
    get lighting(): SceneOverrideLightingType | null {
        return this._lighting
    }

    /** Lighting preset whose environment map is loading, null when none */
    get loading(): SceneOverrideLightingType | null {
        return this._loading
    }

    /** UV channel shown by the 'uv' override (0-3) */
    get uvChannel(): 0 | 1 | 2 | 3 {
        return (this._materials.uv as UvOverrideMaterial).uvChannel
    }

    /** True when any override is on */
    get active(): boolean {
        return this._material !== null || this._lighting !== null
    }

    /** Menu label of a material item, e.g. 'UV 2' while the UV view shows channel 2 */
    labelOf(item: SceneOverrideMaterialItem | SceneOverrideLightingPreset): string {
        return item.key === 'uv' && this._material === 'uv' ? 'UV ' + this.uvChannel : item.label
    }

    /**
     * Draw every mesh with one debug material, or null for the real materials. Clears a lighting override.
     * Choosing 'uv' again shows the next UV channel (0 → 1 → 2 → 3 → 0).
     */
    setMaterial(type: SceneOverrideMaterialType | null) {
        if (type && (this._lighting !== null || this._loading !== null)) this._clearLighting()
        const uv = this._materials.uv as UvOverrideMaterial
        if (type === 'uv') {
            uv.uvChannel = this._material === 'uv' ? (uv.uvChannel + 1) % 4 as 0 | 1 | 2 | 3 : 0
            uv.needsUpdate = true
        }
        this._material = type
        this._changed()
    }

    /**
     * Light the scene with a preset: 'lights-*' replace the scene lights and environment with the preset lights,
     * 'env-*' replace them with the preset environment map (loaded once, then cached). Null restores the scene lighting.
     * Clears a material override.
     */
    async setLighting(key: SceneOverrideLightingType | null) {
        const request = ++this._request
        if (!key) {
            this._clearLighting()
            this._changed()
            return
        }
        const preset = this.lightingPresets.find(p => p.key === key)
        if (!preset) return
        this._material = null

        let environment: ITexture | null = this.lightsKeepEnvironment ? null : this._black
        if (preset.url) {
            this._loading = key
            this._changed()
            environment = await this._loadEnvironment(preset.url)
            if (request !== this._request) return // another choice was made while loading
            this._loading = null
            if (!environment) { // keep the current state when the file does not load
                this._changed()
                return
            }
        }

        this._disposeLights()
        for (const light of preset.lights?.() ?? []) {
            light.userData.userSelectable = false
            this.lightsRoot.add(light)
        }
        this.lightsRoot.visible = true
        this._environment = environment
        this._lighting = key
        this._changed()
    }

    /** Turn off all overrides */
    clear() {
        this._request++
        this._clearLighting()
        this._material = null
        this._changed()
    }

    /** Detach from the viewer and dispose the materials, lights and loaded environment maps */
    dispose() {
        const viewer = this._viewer
        this.viewer = undefined
        for (const m of Object.values(this._materials)) m.dispose()
        this._black.dispose()
        const inUse = (t: ITexture) => viewer && (viewer.scene.environment === t || viewer.scene.background === t)
        for (const p of this._envCache.values()) p.then(t => t && !inUse(t) && t.dispose())
        this._envCache.clear()
    }

    private _clearLighting() {
        this._request++
        this._loading = null
        this._lighting = null
        this._environment = null
        this._disposeLights()
        this.lightsRoot.visible = false
    }

    private _disposeLights() {
        for (const child of [...this.lightsRoot.children]) {
            child.removeFromParent()
            ;(child as Object3D & {dispose?: () => void}).dispose?.()
        }
    }

    private async _loadEnvironment(url: string): Promise<ITexture | null> {
        let p = this._envCache.get(url)
        if (!p) {
            p = (async() => {
                const tex = await this._viewer?.import<ITexture>(url)
                if (!tex?.isTexture) throw new Error('Not a texture: ' + url)
                if (tex.mapping === UVMapping) { // as RootScene does for scene.environment
                    tex.mapping = EquirectangularReflectionMapping
                    tex.needsUpdate = true
                }
                return tex
            })().catch((e) => {
                console.error('SceneOverrides: cannot load environment', url, e)
                this._envCache.delete(url) // try again next time
                return null
            })
            this._envCache.set(url, p)
        }
        return p
    }

    private _changed() {
        this._viewer?.setDirty()
        this.dispatchEvent({type: 'change'})
    }

    private _preRender = () => {
        const viewer = this._viewer
        if (!viewer || this._rendering) return
        this._rendering = true
        const scene = viewer.scene

        const renderPass = viewer.renderManager.renderPass
        this._savedOverrideMaterial = renderPass.overrideMaterial ?? null
        if (this._material) {
            renderPass.overrideMaterial = this._materials[this._material]
            if (this._material === 'depth') this._updateDepthRange()
        }

        this._savedEnvironment = scene.overrideRenderEnvironment
        if (this._lighting) {
            if (this._environment) scene.overrideRenderEnvironment = this._environment
            const hide = (o: Object3D) => {
                if (o === this.lightsRoot) return
                // Hide with the layers mask, not `visible`: threepipe lights call setDirty when `visible` changes,
                // which would restart progressive rendering every frame. three.js skips lights that fail the
                // camera layers test (lights and their shadows).
                if ((o as Light).isLight && o.layers.mask !== 0) {
                    this._hiddenLights.push([o, o.layers.mask])
                    o.layers.mask = 0
                }
                for (const c of o.children) hide(c)
            }
            hide(scene)
        }
    }

    private _postRender = () => {
        const viewer = this._viewer
        if (!viewer || !this._rendering) return
        this._rendering = false
        viewer.renderManager.renderPass.overrideMaterial = this._savedOverrideMaterial
        this._savedOverrideMaterial = null
        viewer.scene.overrideRenderEnvironment = this._savedEnvironment
        this._savedEnvironment = null
        for (const [o, mask] of this._hiddenLights) o.layers.mask = mask
        this._hiddenLights.length = 0
    }

    private _box = new Box3B()
    private _dir = new Vector3()
    private _pos = new Vector3()

    /** Fit the depth view's white-to-black range to the visible models, along the view direction */
    private _updateDepthRange() {
        const viewer = this._viewer
        const material = this._materials.depth as LinearDepthOverrideMaterial
        if (!viewer) return
        const camera = viewer.scene.mainCamera
        const box = this._box.makeEmpty().expandByObject(viewer.scene.modelRoot, false, true)
        if (box.isEmpty()) return
        camera.getWorldPosition(this._pos)
        camera.getWorldDirection(this._dir)
        let near = Infinity
        let far = -Infinity
        for (const p of box.getPoints()) {
            const d = p.sub(this._pos).dot(this._dir)
            near = Math.min(near, d)
            far = Math.max(far, d)
        }
        near = Math.max(near, 0)
        if (far <= near) far = near + 1
        material.depthNear.value = near
        material.depthFar.value = far
    }
}
