import {DataTexture, EquirectangularReflectionMapping, Light, Material, Object3D, RGBAFormat, UVMapping, Vector3} from 'three'
import type {UiObjectConfig} from 'uiconfig.js'
import {AViewerPluginEventMap, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {AmbientLight2, DirectionalLight2, Group2, HemisphereLight2, ITexture} from '../../core'
import {Box3B} from '../../three'
import {
    LinearDepthOverrideMaterial,
    MaterialIdOverrideMaterial,
    NormalOverrideMaterial,
    NormalWorldOverrideMaterial,
    UnlitOverrideMaterial,
    UvOverrideMaterial,
} from './ViewOverrideMaterials'

/** The material views of {@link ViewOverridesPlugin} */
export type ViewOverrideMaterialType = 'unlit' | 'depth' | 'normal' | 'normalWorld' | 'materialId' | 'uv'

export interface ViewOverrideMaterialItem {
    key: ViewOverrideMaterialType
    label: string
}

/** A lighting preset of {@link ViewOverridesPlugin}: preset lights ('lights') or an environment map ('env') */
export interface ViewOverrideLightingPreset {
    /** Unique key, passed to {@link ViewOverridesPlugin.setLighting} */
    key: string
    label: string
    group: 'lights' | 'env'
    /** HDR/EXR url for the 'env' group. Loaded on the first use, then cached. */
    url?: string
    /** Creates the lights for the 'lights' group. Called on each use; the lights are disposed when the preset is turned off. */
    lights?: () => Light[]
}

export interface ViewOverridesPluginEventMap extends AViewerPluginEventMap {
    /** The material, the lighting, the loading state, the UV set or `enabled` changed */
    change: object
}

const ENV_BASE = 'https://threejs.org/examples/textures/equirectangular/'

/** The default lighting presets: preset lights, then environment maps */
function defaultLightingPresets(): ViewOverrideLightingPreset[] {
    const dir = (color: number, intensity: number, x: number, y: number, z: number) => {
        const l = new DirectionalLight2(color, intensity)
        l.position.set(x, y, z)
        l.castShadow = false
        return l
    }
    return [
        {key: 'lights-day', label: 'Day', group: 'lights', lights: () => {
            const sky = new HemisphereLight2(0x87ceeb, 0x545454, 0.6)
            sky.position.set(0, 10, 0)
            return [dir(0xffffff, 1.5, 5, 10, 7.5), sky]
        }},
        {key: 'lights-night', label: 'Night', group: 'lights', lights: () =>
            [dir(0x6b8cba, 0.3, -5, 10, -7.5), new AmbientLight2(0x1a2332, 0.2)]},
        {key: 'lights-studio', label: 'Studio', group: 'lights', lights: () => [
            dir(0xffffff, 1.0, 5, 10, 5), // key
            dir(0xffffff, 0.4, -5, 5, 5), // fill
            dir(0xffffff, 0.5, 0, 5, -10), // back
            new AmbientLight2(0xffffff, 0.3),
        ]},
        {key: 'lights-none', label: 'None', group: 'lights', lights: () => []},
        {key: 'env-day', label: 'Day', group: 'env', url: ENV_BASE + 'quarry_01_1k.hdr'},
        {key: 'env-night', label: 'Night', group: 'env', url: ENV_BASE + 'moonless_golf_1k.hdr'},
        {key: 'env-studio', label: 'Studio', group: 'env', url: 'https://samples.threepipe.org/minimal/studio_small_03_1k.hdr'},
        {key: 'env-indoors', label: 'Indoors', group: 'env', url: 'https://samples.threepipe.org/minimal/empty_warehouse_01_1k.hdr'},
        {key: 'env-outdoors', label: 'Outdoors', group: 'env', url: 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'},
    ]
}

/**
 * ViewOverridesPlugin shows the scene with one debug material for every mesh, or with other lights or another
 * environment map, without changing the scene. For an editor's view menu: check the normals, the UVs or the material
 * assignment, or see a model in other lighting.
 *
 * Material views ({@link setMaterial}): unlit (base color and maps, no lights), linear depth (fitted to the models),
 * view-space normals, world-space normals, material ID (one color per material) and UV (U red, V green, for the UV set
 * {@link uvChannel}; magenta where a mesh has no such set).
 *
 * Lighting presets ({@link setLighting}, {@link lightingPresets}): 'lights-*' replace the scene lights (and by default
 * the environment, see {@link lightsKeepEnvironment}) with preset lights; 'env-*' replace them with another
 * environment map, loaded once and cached.
 *
 * A material view and a lighting preset are exclusive: choosing one turns the other off (the debug materials are
 * unlit, so lights do not change them).
 *
 * Everything is applied only while the viewer renders (`preRender` to `postRender`): the override material of the
 * main render pass, the hidden scene lights, the override environment, and fat lines kept out of the override. Outside
 * a render the scene and the render pass are as the user left them, so an export, the scene UI and the light toggles
 * see the real scene. Turning an override off, disabling the plugin or removing it shows the scene as before.
 * The state is not saved with the viewer config.
 *
 * @example
 * ```ts
 * const overrides = viewer.addPluginSync(ViewOverridesPlugin)
 * overrides.addEventListener('change', updateMenu)
 * overrides.setMaterial('normal')
 * await overrides.setLighting('env-studio')
 * overrides.clear()
 * ```
 *
 * @category Plugins
 */
export class ViewOverridesPlugin extends AViewerPluginSync<ViewOverridesPluginEventMap> {
    static readonly PluginType = 'ViewOverridesPlugin'
    serializeWithViewer = false

    /** The material views, for a menu */
    readonly materialTypes: readonly ViewOverrideMaterialItem[] = [
        {key: 'unlit', label: 'Unlit'},
        {key: 'depth', label: 'Depth'},
        {key: 'normal', label: 'Normal'},
        {key: 'normalWorld', label: 'Normal World'},
        {key: 'materialId', label: 'Material ID'},
        {key: 'uv', label: 'UV'},
    ]

    /** The lighting presets, for a menu. Change a `url`, or add a preset, before its first use. */
    readonly lightingPresets: ViewOverrideLightingPreset[] = defaultLightingPresets()

    /**
     * False (default): the 'lights' presets also turn off the environment map, so the image shows only the preset
     * lights. True: the scene environment stays on with the preset lights. Applies to the next {@link setLighting}.
     */
    lightsKeepEnvironment = false

    /** Holds the preset lights, in the scene root (not in the model root), so they are not selectable or exported */
    readonly lightsRoot = new Group2()

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'View Overrides',
        children: [
            {type: 'checkbox', label: 'Enabled', property: [this, 'enabled']},
            {
                type: 'dropdown',
                label: 'Material',
                getValue: () => this._material ?? 'none',
                setValue: (v: string) => this.setMaterial(v === 'none' ? null : v as ViewOverrideMaterialType),
                children: [() => [
                    {label: 'Scene materials', value: 'none'},
                    ...this.materialTypes.map(m => ({label: m.label, value: m.key})),
                ]],
            },
            {
                type: 'dropdown',
                label: 'UV Set',
                property: [this, 'uvChannel'],
                hidden: () => this._material !== 'uv',
                children: [0, 1, 2, 3].map(i => ({label: 'uv' + (i || ''), value: i})),
            },
            {
                type: 'dropdown',
                label: 'Lighting',
                getValue: () => this._loading ?? this._lighting ?? 'none',
                setValue: (v: string) => void this.setLighting(v === 'none' ? null : v),
                children: [() => [
                    {label: 'Scene lighting', value: 'none'},
                    ...this.lightingPresets.map(p => ({label: (p.group === 'lights' ? 'Lights: ' : 'Environment: ') + p.label, value: p.key})),
                ]],
            },
            {type: 'checkbox', label: 'Lights Keep Env', property: [this, 'lightsKeepEnvironment']},
            {type: 'button', label: 'Clear', value: () => this.clear()},
        ],
    }

    private _enabled = true
    private _material: ViewOverrideMaterialType | null = null
    private _lighting: string | null = null
    private _loading: string | null = null
    private _request = 0
    private _materials = {
        unlit: new UnlitOverrideMaterial(),
        depth: new LinearDepthOverrideMaterial(),
        normal: new NormalOverrideMaterial(),
        normalWorld: new NormalWorldOverrideMaterial(),
        materialId: new MaterialIdOverrideMaterial(),
        uv: new UvOverrideMaterial(),
    } satisfies Record<ViewOverrideMaterialType, Material>
    /** Environment used while a lighting preset is on. Black for the 'lights' presets, null to keep the scene one. */
    private _environment: ITexture | null = null
    private _black: ITexture
    private _envCache = new Map<string, Promise<ITexture | null>>()
    // state saved in preRender and restored in postRender (undefined: not changed in this render)
    private _rendering = false
    private _savedOverrideMaterial?: Material | null
    private _savedEnvironment?: ITexture | null
    private _hiddenLights: [Object3D, number][] = []
    private _linesKeptOut: Material[] = []

    constructor() {
        super()
        this.lightsRoot.name = 'View Override Lights'
        this.lightsRoot.visible = false
        const ud = this.lightsRoot.userData
        ud.userSelectable = false
        ud.bboxVisible = false
        ud.excludeFromExport = true
        ud.disableWidgets = true

        for (const m of Object.values(this._materials)) m.name = 'View Override'

        const black = new DataTexture(new Uint8Array(4 * 4 * 2), 4, 2, RGBAFormat)
        black.mapping = EquirectangularReflectionMapping
        black.name = 'View Override No Environment'
        black.needsUpdate = true
        this._black = black as ITexture
    }

    get enabled() {
        return this._enabled
    }

    /** False: the scene renders as it is, the overrides stay set and come back when it is true again */
    set enabled(v: boolean) {
        if (v === this._enabled) return
        this._enabled = v
        this._changed()
    }

    /** Current material view, null when off */
    get material(): ViewOverrideMaterialType | null {
        return this._material
    }

    /** Current lighting preset key (applied), null when off */
    get lighting(): string | null {
        return this._lighting
    }

    /** Key of the lighting preset whose environment map is loading, null when none */
    get loading(): string | null {
        return this._loading
    }

    /** True when a material view or a lighting preset is on */
    get active(): boolean {
        return this._material !== null || this._lighting !== null
    }

    /** UV set shown by the 'uv' view: 0 for `uv`, 1-3 for `uv1`-`uv3`. Default 0. */
    get uvChannel(): 0 | 1 | 2 | 3 {
        return this._materials.uv.uvChannel
    }

    set uvChannel(v: 0 | 1 | 2 | 3) {
        const uv = this._materials.uv
        if (v === uv.uvChannel) return
        uv.uvChannel = v
        uv.needsUpdate = true
        this._changed()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addObject(this.lightsRoot, {addToRoot: true, autoScale: false, autoCenter: false})
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
    }

    /** Turns the overrides off, and disposes the loaded environment maps that the scene does not use */
    onRemove(viewer: ThreeViewer) {
        this._postRender() // in case it is removed during a render
        this.clear()
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        this.lightsRoot.removeFromParent()
        const scene = viewer.scene
        for (const p of this._envCache.values()) p.then(t => t && t !== scene.environment && t !== scene.background && t.dispose())
        this._envCache.clear()
        super.onRemove(viewer)
    }

    /** Disposes the override materials */
    dispose() {
        for (const m of Object.values(this._materials)) m.dispose()
        this._black.dispose()
        super.dispose()
    }

    /** Draw every mesh with one debug material, or null for the scene materials. Turns off a lighting preset. */
    setMaterial(type: ViewOverrideMaterialType | null) {
        if (type && !this._materials[type]) return
        if (type && (this._lighting !== null || this._loading !== null)) this._clearLighting()
        this._material = type
        this._changed()
    }

    /**
     * Light the scene with a preset from {@link lightingPresets}: a 'lights' preset replaces the scene lights (and the
     * environment, unless {@link lightsKeepEnvironment}) with its lights, an 'env' preset replaces them with its
     * environment map (loaded on the first use, then cached). Null restores the scene lighting. Turns off a material view.
     *
     * While an environment map loads, {@link loading} is the key and the view does not change. When it does not load,
     * the view stays as it was. Resolves when the preset is applied, when the map does not load, or when another call
     * replaced it.
     */
    async setLighting(key: string | null) {
        const request = ++this._request
        if (!key) {
            this._clearLighting()
            this._changed()
            return
        }
        const preset = this.lightingPresets.find(p => p.key === key)
        if (!preset) return

        let environment: ITexture | null = this.lightsKeepEnvironment ? null : this._black
        if (preset.url) {
            this._loading = key
            this._changed()
            environment = await this._loadEnvironment(preset.url)
            if (request !== this._request) return // another choice was made while loading
            this._loading = null
            if (!environment) {
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
        this._material = null
        this._changed()
    }

    /** Turn off the material view and the lighting preset */
    clear() {
        this._clearLighting()
        this._material = null
        this._changed()
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
                this._viewer?.console.error('ViewOverridesPlugin: cannot load the environment map', url, e)
                this._envCache.delete(url) // try again on the next use
                return null
            })
            this._envCache.set(url, p)
        }
        return p
    }

    private _changed() {
        this._viewer?.setDirty()
        this.uiConfig.uiRefresh?.(true)
        this.dispatchEvent({type: 'change'})
    }

    private _preRender = () => {
        const viewer = this._viewer
        if (!viewer || this._rendering || this.isDisabled() || !this.active) return
        this._rendering = true
        const scene = viewer.scene

        const material = this._material
        if (material) {
            const renderPass = viewer.renderManager.renderPass
            this._savedOverrideMaterial = renderPass.overrideMaterial ?? null
            renderPass.overrideMaterial = this._materials[material]
            if (material === 'depth') this._updateDepthRange()
        }
        const lighting = !!this._lighting
        if (lighting) {
            this._savedEnvironment = scene.overrideRenderEnvironment
            if (this._environment) scene.overrideRenderEnvironment = this._environment
        }

        const walk = (o: Object3D) => {
            if (o === this.lightsRoot) return
            // Fat lines (Line2, MeshLine) are instanced quads that only their own shader turns into lines; drawn with
            // an override material they show as big rectangles. They keep their own material.
            if (material) {
                const mats = (o as Object3D & {material?: Material | Material[]}).material
                for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
                    if ((m as Material & {isLineMaterial?: boolean}).isLineMaterial && m.allowOverride) {
                        m.allowOverride = false
                        this._linesKeptOut.push(m)
                    }
                }
            }
            // Hide the scene lights with the layers mask, not `visible`: threepipe lights call setDirty when `visible`
            // changes, which would restart progressive rendering every frame. three.js skips lights (and their
            // shadows) that fail the camera layers test.
            if (lighting && (o as Light).isLight && o.layers.mask !== 0) {
                this._hiddenLights.push([o, o.layers.mask])
                o.layers.mask = 0
            }
            for (const c of o.children) walk(c)
        }
        walk(scene)
    }

    private _postRender = () => {
        const viewer = this._viewer
        if (!viewer || !this._rendering) return
        this._rendering = false
        if (this._savedOverrideMaterial !== undefined) {
            viewer.renderManager.renderPass.overrideMaterial = this._savedOverrideMaterial
            this._savedOverrideMaterial = undefined
        }
        if (this._savedEnvironment !== undefined) {
            viewer.scene.overrideRenderEnvironment = this._savedEnvironment
            this._savedEnvironment = undefined
        }
        for (const [o, mask] of this._hiddenLights) o.layers.mask = mask
        this._hiddenLights.length = 0
        for (const m of this._linesKeptOut) m.allowOverride = true
        this._linesKeptOut.length = 0
    }

    private _box = new Box3B()
    private _dir = new Vector3()
    private _pos = new Vector3()

    /** Fits the white-to-black range of the depth view to the visible models, along the view direction */
    private _updateDepthRange() {
        const viewer = this._viewer
        if (!viewer) return
        const material = this._materials.depth
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
