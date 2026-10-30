import {
    BoxGeometry,
    BufferGeometry,
    CanvasTexture,
    Color,
    DirectionalLight2,
    DoubleSide,
    Fog,
    HDRiGroundPlugin,
    ITexture,
    LatheGeometry,
    mergeGeometries,
    SpotLight2,
    Mesh,
    MeshBasicMaterial,
    BackSide,
    BufferAttribute,
    Object3D,
    PhysicalMaterial,
    PlaneGeometry,
    PMREMGenerator,
    RepeatWrapping,
    Scene,
    ShadowMaterial,
    SphereGeometry,
    SRGBColorSpace,
    ThreeViewer,
    UiObjectConfig,
    Vector2,
    Vector3,
} from 'threepipe'
import {
    BloomPlugin,
    SSContactShadowsPlugin,
    SSGIPlugin,
    SSReflectionPlugin,
    TemporalAAPlugin,
    VelocityBufferPlugin,
} from '@threepipe/webgi-plugins'

// Scene presets for the MotionBricks demo: a white block city after Mirror's Edge and Sixty Four, and the looks
// robotics teams use for their demos: research viewers (MuJoCo, Newton), the Isaac Sim grid, a product studio,
// a launch stage, and a real space.

export interface StageLight {
    /** A directional light by default; a spot makes a pool of light around the robot. */
    kind?: 'spot'
    color: string
    intensity: number
    /** Position relative to the robot, in threepipe space (Y up). The light aims at the robot. */
    offset: [number, number, number]
    shadow?: boolean
}

export interface StageStyle {
    label: string
    /** Sky gradient from the top to the horizon, or 'hdri' to show the environment with a projected ground. */
    sky: [string, string] | 'hdri'
    floor:
        | {kind: 'checker' | 'grid', base: string, line: string, roughness: number, metalness?: number}
        | {kind: 'cove', color: string, roughness: number, metalness?: number, envIntensity?: number}
        | {kind: 'hdri', shadowOpacity: number}
        | {kind: 'plain', color: string, roughness: number}
    /** HDR file name for lighting and reflections, or '' for a gradient made from the sky colors. */
    environment: string
    environmentIntensity: number
    lights: StageLight[]
    /** Intensity of each screen-space effect; 0 turns it off. */
    effects: {ssgi: number, ssr: number, contact: number, bloom: number}
    /** Height and ground radius of the HDR capture, for the projected ground. */
    hdriGround?: {tripodHeight: number, worldRadius: number}
    /** Fog that fades the floor into the background, so the world has no horizon. */
    fog?: {color: string, near: number, far: number}
    /** Blocks around a clear plaza where the robot wanders. */
    blocks?: BlockCity
    /** Field of view, and the camera's position relative to the robot. */
    camera?: {fov: number, offset: [number, number, number]}
    /** Width of the area the shadow-casting light covers, in metres. */
    shadowFrustum?: number
}

export interface BlockCity {
    seed: number
    /** Radius of the empty plaza in the middle, in metres. */
    plaza: number
    /** How far out the blocks go, in metres. */
    extent: number
    /** The material of most blocks. */
    base: BlockMaterial
    /** Accent materials, with how often each is picked for a cluster. */
    accents: (BlockMaterial & {weight: number})[]
}

export interface BlockMaterial {
    color: string
    roughness: number
    metalness?: number
}

export const STAGE_STYLES = {
    city: {
        label: 'White city',
        // Mirror's Edge: an off-white world, red for what matters, a strong sun and colour bouncing off the walls.
        // Sixty Four: a horizonless white plane, cubes in a few saturated colours, seen from high up.
        sky: ['#f4f5f6', '#f4f5f6'],
        floor: {kind: 'plain', color: '#efeeeb', roughness: 0.92},
        environment: '',
        environmentIntensity: 0.8,
        fog: {color: '#f4f5f6', near: 16, far: 46},
        lights: [
            // A low warm sun for long, crisp shadows, and a faint cool sky from the other side.
            {color: '#fff1d9', intensity: 4.2, offset: [7, 8, 2.5], shadow: true},
            {color: '#c9d8ff', intensity: 0.45, offset: [-4, 5, -6]},
        ],
        // Strong GI also darkens the floor just behind the legs (a screen-space limit), so it stays moderate.
        effects: {ssgi: 1.0, ssr: 0, contact: 0.9, bloom: 0.18},
        blocks: {
            seed: 64,
            plaza: 8,
            extent: 34,
            base: {color: '#f2f1ee', roughness: 0.7},
            accents: [
                {color: '#ef3b36', roughness: 0.55, weight: 5},
                {color: '#16171a', roughness: 0.4, weight: 3},
                {color: '#6a3cf2', roughness: 0.45, weight: 1.2},
                {color: '#9de02c', roughness: 0.5, weight: 0.8},
                {color: '#f2a531', roughness: 0.5, weight: 0.8},
            ],
        },
        camera: {fov: 30, offset: [4.4, 3.4, 6]},
        shadowFrustum: 32,
    },
    research: {
        label: 'Research viewer',
        sky: ['#3d5a7c', '#0e1218'],
        floor: {kind: 'checker', base: '#272a33', line: '#1c1e25', roughness: 0.85},
        environment: '',
        environmentIntensity: 0.7,
        lights: [
            {color: '#ffffff', intensity: 2.4, offset: [2, 6, 3], shadow: true},
            {color: '#9db7d9', intensity: 0.5, offset: [-3, 3, -3]},
        ],
        effects: {ssgi: 0.6, ssr: 0, contact: 0.5, bloom: 0},
    },
    grid: {
        label: 'Sim grid',
        sky: ['#62666e', '#2b2d31'],
        floor: {kind: 'grid', base: '#2d2f33', line: '#d9dde4', roughness: 0.7},
        environment: 'studio_small_09_1k.hdr',
        environmentIntensity: 0.5,
        lights: [
            {color: '#ffffff', intensity: 2.2, offset: [2.5, 6, 3], shadow: true},
            {color: '#dfe6f0', intensity: 0.6, offset: [-3, 3, -4]},
        ],
        effects: {ssgi: 0.6, ssr: 0.25, contact: 0.5, bloom: 0},
    },
    studio: {
        label: 'Product studio',
        sky: ['#e9eaec', '#e9eaec'],
        floor: {kind: 'cove', color: '#e9eaec', roughness: 0.95},
        environment: 'studio_small_09_1k.hdr',
        environmentIntensity: 0.9,
        lights: [
            {color: '#fff6ec', intensity: 1.8, offset: [-2.5, 5, 3], shadow: true},
            {color: '#e4eeff', intensity: 1.5, offset: [-3, 3, -4]},
        ],
        effects: {ssgi: 1.2, ssr: 0, contact: 0.8, bloom: 0},
    },
    stage: {
        label: 'Launch stage',
        sky: ['#0c0d0f', '#0c0d0f'],
        floor: {kind: 'cove', color: '#17191c', roughness: 0.36, envIntensity: 0.08},
        environment: 'studio_small_09_1k.hdr',
        environmentIntensity: 0.3,
        lights: [
            {kind: 'spot', color: '#ffffff', intensity: 220, offset: [0.4, 7, 1.2], shadow: true},
            {color: '#9fc4ff', intensity: 1.6, offset: [-4.5, 2.2, 1]},
            {color: '#ffb27a', intensity: 1.0, offset: [4.5, 2, -1]},
        ],
        effects: {ssgi: 0.5, ssr: 1, contact: 0.6, bloom: 0.35},
    },
    hangar: {
        label: 'Real space',
        sky: 'hdri',
        floor: {kind: 'hdri', shadowOpacity: 0.45},
        environment: 'hangar_interior_2k.hdr',
        environmentIntensity: 1,
        lights: [
            {color: '#fff4e6', intensity: 1.4, offset: [1.5, 7, 2.5], shadow: true},
        ],
        effects: {ssgi: 0.8, ssr: 0, contact: 0.8, bloom: 0},
        hdriGround: {tripodHeight: 1.7, worldRadius: 40},
    },
} satisfies Record<string, StageStyle>

export type StageStyleName = keyof typeof STAGE_STYLES

const DEFAULT_CAMERA = {fov: 45, offset: [3.2, 1.15, 4.2] as [number, number, number]}

/** A small seeded random generator, so the city is the same on every load. */
function random(seed: number) {
    let a = seed >>> 0
    return () => {
        a = a + 0x6d2b79f5 >>> 0
        let t = a
        t = Math.imul(t ^ t >>> 15, t | 1)
        t ^= t + Math.imul(t ^ t >>> 7, t | 61)
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

/**
 * Clusters of unit cubes, stacks and stepped platforms on a one-metre grid, outside the plaza. Most cubes are the
 * base material; each cluster leans on one accent. Returns one merged geometry per material, base first.
 */
function blockCityGeometries(city: BlockCity) {
    const rand = random(city.seed)
    const parts: BufferGeometry[][] = [[], ...city.accents.map(() => [])]
    const taken = new Set<string>()
    const totalWeight = city.accents.reduce((n, a) => n + a.weight, 0)
    const pickAccent = () => {
        let r = rand() * totalWeight
        for (let i = 0; i < city.accents.length; i++) if ((r -= city.accents[i].weight) <= 0) return i + 1
        return city.accents.length
    }
    const box = (x: number, z: number, w: number, d: number, y: number, h: number, material: number) => {
        // A hair smaller than the grid, so neighbouring cubes show a seam.
        parts[material].push(new BoxGeometry(w - 0.04, h - 0.02, d - 0.04).translate(x + w / 2, y + h / 2, z + d / 2))
    }
    // A Mirror's Edge runner lane across the plaza: two thin strips of the first accent, flush with the floor.
    const laneAngle = rand() * Math.PI, laneOffset = (rand() - 0.5) * 3
    for (const side of [-0.45, 0.45]) {
        parts[1].push(new BoxGeometry(city.extent * 2, 0.012, 0.1).translate(0, 0.006, laneOffset + side).rotateY(laneAngle))
    }
    const clusters = Math.round(city.extent * city.extent * 0.11)
    for (let c = 0; c < clusters; c++) {
        const angle = rand() * Math.PI * 2
        // More clusters near the plaza, thinning out towards the fog.
        const radius = city.plaza + 1.5 + Math.pow(rand(), 0.8) * (city.extent - city.plaza - 1.5)
        const cx = Math.round(Math.cos(angle) * radius), cz = Math.round(Math.sin(angle) * radius)
        const accent = pickAccent()
        const accentShare = 0.25 + rand() * 0.5
        const kind = rand()
        if (kind < 0.18) {
            // A stepped platform, like a stair up to a rooftop.
            const w = 2 + Math.floor(rand() * 3), steps = 2 + Math.floor(rand() * 4)
            const material = rand() < accentShare * 0.6 ? accent : 0
            for (let i = 0; i < steps; i++) box(cx + i, cz, 1, w, 0, 0.3 * (i + 1), material)
            continue
        }
        const footprint = 2 + Math.floor(rand() * (kind < 0.6 ? 6 : 14))
        let x = cx, z = cz
        for (let i = 0; i < footprint; i++) {
            const key = `${x},${z}`
            if (!taken.has(key) && Math.hypot(x + 0.5, z + 0.5) > city.plaza + 1) {
                taken.add(key)
                const height = 1 + Math.floor(Math.pow(rand(), 2.2) * (kind < 0.6 ? 3 : 6))
                for (let y = 0; y < height; y++) box(x, z, 1, 1, y, 1, rand() < accentShare ? accent : rand() < 0.08 ? pickAccent() : 0)
            }
            if (rand() < 0.5) x += rand() < 0.5 ? 1 : -1
            else z += rand() < 0.5 ? 1 : -1
        }
    }
    return parts.map(list => list.length ? mergeGeometries(list) : null)
}

const FLOOR_SIZE = 400

/** Floor tiles of one metre: a checkerboard, or lines on two edges for a grid. */
function floorTexture(kind: 'checker' | 'grid', base: string, line: string, maxAnisotropy: number) {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = line
    if (kind === 'checker') {
        ctx.fillRect(0, 0, size / 2, size / 2)
        ctx.fillRect(size / 2, size / 2, size / 2, size / 2)
    } else {
        ctx.fillRect(0, 0, size, 4)
        ctx.fillRect(0, 0, 4, size)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(kind === 'checker' ? FLOOR_SIZE / 2 : FLOOR_SIZE, kind === 'checker' ? FLOOR_SIZE / 2 : FLOOR_SIZE)
    texture.anisotropy = maxAnisotropy
    return texture
}

function gradientTexture(top: string, horizon: string) {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, top)
    g.addColorStop(0.55, horizon)
    g.addColorStop(1, horizon)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 2, 256)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
}

/** A soft sky-to-floor gradient as the environment, for styles without an HDR. */
function gradientEnvironment(viewer: ThreeViewer, sky: string, floor: string) {
    const scene = new Scene()
    const geometry = new SphereGeometry(10, 32, 16)
    const pos = geometry.getAttribute('position')
    const colors = new Float32Array(pos.count * 3)
    const c = new Color(), top = new Color(sky), bottom = new Color(floor)
    for (let i = 0; i < pos.count; i++) {
        const t = Math.min(Math.max(pos.getY(i) / 10 * 0.5 + 0.5, 0), 1)
        c.copy(bottom).lerp(top, Math.pow(t, 0.7)).multiplyScalar(0.6 + 0.8 * t)
        c.toArray(colors, i * 3)
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    scene.add(new Mesh(geometry, new MeshBasicMaterial({side: BackSide, vertexColors: true})))
    const pmrem = new PMREMGenerator(viewer.renderManager.webglRenderer)
    const texture = pmrem.fromScene(scene, 0.04).texture
    pmrem.dispose()
    return texture
}

/**
 * An infinity cove: a flat floor that curves up into a wall all around, so the backdrop has no horizon.
 * The profile runs from the wall down to the centre, which makes the lathe's normals face inward.
 */
function coveGeometry(radius = 22, fillet = 9, height = 40) {
    const points: Vector2[] = [new Vector2(radius + fillet, height)]
    for (let i = 16; i >= 0; i--) {
        const t = i / 16 * Math.PI / 2
        points.push(new Vector2(radius + fillet * Math.sin(t), fillet - fillet * Math.cos(t)))
    }
    points.push(new Vector2(0.001, 0))
    return new LatheGeometry(points, 128)
}

export class G1Stage {
    readonly viewer: ThreeViewer
    /** Resolves an HDR file name from a style to a URL. */
    resolveAsset: (name: string) => string
    styleName: StageStyleName = 'city'
    style: StageStyle = STAGE_STYLES.city
    effectsEnabled = true
    /** Called after a style is applied or the effects are switched. */
    onChange?: () => void
    private _floorMaterial: PhysicalMaterial | ShadowMaterial | null = null
    private _objects: Object3D[] = []
    private _lights: {light: DirectionalLight2 | SpotLight2, offset: Vector3}[] = []
    private _follow: Object3D[] = []
    private _environments = new Map<string, Promise<ITexture | null>>()
    private _applyId = 0
    private _target = new Vector3(0, 0.75, 0)

    constructor(viewer: ThreeViewer, resolveAsset: (name: string) => string) {
        this.viewer = viewer
        this.resolveAsset = resolveAsset
    }

    private async _environment(name: string) {
        if (!this._environments.has(name)) {
            const url = this.resolveAsset(name)
            const file = url.split(/[?#]/)[0]
            // Hosts that only serve some file types may rename the HDR; name it .hdr for the importer.
            const load = /\.(hdr|exr)$/i.test(file) ? Promise.resolve(url) :
                fetch(url).then(async r => new File([await r.arrayBuffer()], name))
            this._environments.set(name, load.then(async m => this.viewer.assetManager.importer.importSingle<ITexture>(m)).then(t => t ?? null))
        }
        return this._environments.get(name)!
    }

    /** Apply one of the STAGE_STYLES by name. */
    async setStyle(name: StageStyleName) {
        this.styleName = name
        await this.apply(STAGE_STYLES[name])
    }

    async apply(style: StageStyle) {
        const id = ++this._applyId
        const v = this.viewer
        const scene = v.scene
        const environment = style.environment ? await this._environment(style.environment).catch(e => {
            console.warn('MotionBricks: environment map failed, using a gradient', e)
            return null
        }) : null
        if (id !== this._applyId) return
        this.style = style

        for (const o of this._objects) o.removeFromParent()
        this._objects = []
        this._lights = []
        this._follow = []
        const add = <T extends Object3D>(o: T, follow = false) => {
            scene.addObject(o)
            this._objects.push(o)
            if (follow) this._follow.push(o)
            return o
        }

        const [top, horizon] = style.sky === 'hdri' ? ['#808080', '#808080'] : style.sky
        scene.environment = environment ?? gradientEnvironment(v, top, horizon) as any
        scene.environmentIntensity = style.environmentIntensity
        const hdriGround = v.getPlugin(HDRiGroundPlugin)
        if (style.sky === 'hdri') {
            scene.background = 'environment'
            if (hdriGround && style.hdriGround) {
                hdriGround.tripodHeight = style.hdriGround.tripodHeight
                hdriGround.worldRadius = style.hdriGround.worldRadius
                hdriGround.originPosition.set(0, 0, 0)
                hdriGround.enabled = true
            }
        } else {
            if (hdriGround) hdriGround.enabled = false
            scene.setBackgroundColor('#ffffff')
            scene.background = gradientTexture(top, horizon) as any
        }

        scene.fog = style.fog ? new Fog(style.fog.color, style.fog.near, style.fog.far) : null

        const floor = style.floor
        if (floor.kind === 'plain') {
            const mesh = new Mesh(new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE).rotateX(-Math.PI / 2), new PhysicalMaterial({
                color: floor.color, roughness: floor.roughness,
            }))
            mesh.receiveShadow = true
            mesh.name = 'Floor'
            this._floorMaterial = mesh.material
            add(mesh)
        } else if (floor.kind === 'checker' || floor.kind === 'grid') {
            const maxAnisotropy = v.renderManager.webglRenderer.capabilities.getMaxAnisotropy()
            const mesh = new Mesh(new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE).rotateX(-Math.PI / 2), new PhysicalMaterial({
                map: floorTexture(floor.kind, floor.base, floor.line, maxAnisotropy),
                roughness: floor.roughness, metalness: floor.metalness ?? 0,
            }))
            mesh.receiveShadow = true
            mesh.name = 'Floor'
            this._floorMaterial = mesh.material
            add(mesh)
        } else if (floor.kind === 'cove') {
            const mesh = new Mesh(coveGeometry(), new PhysicalMaterial({
                color: floor.color, roughness: floor.roughness, metalness: floor.metalness ?? 0, side: DoubleSide,
                envMapIntensity: floor.envIntensity ?? 1,
            }))
            mesh.receiveShadow = true
            mesh.name = 'Cove'
            this._floorMaterial = mesh.material
            add(mesh, true)
        } else if (floor.kind === 'hdri') {
            // The projected HDR is the floor; this plane only catches the robot's shadow.
            const mesh = new Mesh(new PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new ShadowMaterial({opacity: floor.shadowOpacity}))
            mesh.receiveShadow = true
            mesh.name = 'Shadow catcher'
            this._floorMaterial = mesh.material
            add(mesh, true)
        }

        if (style.blocks) {
            const city = style.blocks
            const materials = [city.base, ...city.accents]
            blockCityGeometries(city).forEach((geometry, i) => {
                if (!geometry) return
                const m = materials[i]
                const mesh = new Mesh(geometry, new PhysicalMaterial({color: m.color, roughness: m.roughness, metalness: m.metalness ?? 0}))
                mesh.castShadow = mesh.receiveShadow = true
                mesh.name = i ? `Blocks ${m.color}` : 'Blocks'
                add(mesh)
            })
        }

        for (const l of style.lights) {
            const light = l.kind === 'spot' ?
                new SpotLight2(l.color, l.intensity, 0, 0.42, 0.65, 2) :
                new DirectionalLight2(l.color, l.intensity)
            if (l.shadow) {
                light.castShadow = true
                light.shadowMapSize.setScalar(2048)
                light.shadowNear = 0.5
                light.shadowFar = 25
                if (light instanceof DirectionalLight2) light.shadowFrustum = style.shadowFrustum ?? 6
                if ((style.shadowFrustum ?? 6) > 8) light.shadowMapSize.setScalar(4096)
                light.shadow.radius = 3
                // Bias the lookup so a large, flat floor shows no acne rings at the shadow map's edge.
                light.shadow.bias = -0.0004
                light.shadow.normalBias = 0.03
            }
            add(light)
            this._lights.push({light, offset: new Vector3(...l.offset)})
        }
        const view = style.camera ?? DEFAULT_CAMERA
        const camera = v.scene.mainCamera
        camera.fov = view.fov
        camera.position.copy(this._target).add(new Vector3(...view.offset))
        camera.target.copy(this._target)
        camera.setDirty()

        this.update(this._target)
        this.setEffects(this.effectsEnabled)
        this._uiConfig?.uiRefresh?.(true, 'postFrame')
        v.setDirty()
    }

    /** Turn the screen-space effects on or off, at the current style's intensities. */
    setEffects(on: boolean) {
        this.effectsEnabled = on
        const e = this.style.effects
        const v = this.viewer
        const ssgi = v.getPlugin(SSGIPlugin), ssr = v.getPlugin(SSReflectionPlugin)
        const contact = v.getPlugin(SSContactShadowsPlugin), bloom = v.getPlugin(BloomPlugin)
        if (ssgi?.pass) {
            ssgi.enabled = on && e.ssgi > 0
            ssgi.pass.intensity = e.ssgi
        }
        if (ssr?.pass) {
            ssr.enabled = on && e.ssr > 0
            ssr.pass.intensity = e.ssr
        }
        if (contact) {
            contact.enabled = on && e.contact > 0
            contact.intensity = e.contact
        }
        if (bloom?.pass) {
            bloom.enabled = on && e.bloom > 0
            bloom.pass.intensity = e.bloom
            bloom.pass.threshold = 1.4
        }
        for (const p of [v.getPlugin(TemporalAAPlugin), v.getPlugin(VelocityBufferPlugin)]) if (p) p.enabled = on
        v.setDirty()
        this.onChange?.()
    }

    private _uiConfig?: UiObjectConfig

    /** Controls for the style, environment, floor and each light, for a uiconfig renderer such as Tweakpane. */
    get uiConfig(): UiObjectConfig {
        if (this._uiConfig) return this._uiConfig
        const dirty = () => this.viewer.setDirty()
        this._uiConfig = {
            type: 'folder',
            label: 'Scene',
            expanded: true,
            children: [
                {
                    type: 'dropdown', label: 'Style', property: [this, 'styleName'],
                    children: Object.entries(STAGE_STYLES).map(([value, st]) => ({label: st.label, value})),
                    onChange: async() => this.setStyle(this.styleName),
                },
                {type: 'checkbox', label: 'Effects', property: [this, 'effectsEnabled'], onChange: () => this.setEffects(this.effectsEnabled)},
                {type: 'slider', label: 'Environment', bounds: [0, 3], stepSize: 0.01, property: [this.viewer.scene, 'environmentIntensity'], onChange: dirty},
                () => this._floorMaterial ? {type: 'folder', label: 'Floor', children: [(this._floorMaterial as any).uiConfig]} : undefined,
                () => this._lights.map((entry, i) => ({
                    type: 'folder',
                    label: `Light ${i + 1} (${entry.light instanceof SpotLight2 ? 'spot' : 'directional'})`,
                    children: [
                        {type: 'color', label: 'Color', property: [entry.light, 'color'], onChange: dirty},
                        {type: 'slider', label: 'Intensity', bounds: [0, entry.light instanceof SpotLight2 ? 600 : 10], property: [entry.light, 'intensity'], onChange: dirty},
                        {type: 'vec3', label: 'From robot', property: [entry, 'offset'], onChange: dirty},
                        {type: 'checkbox', label: 'Shadow', property: [entry.light, 'castShadow'], onChange: dirty},
                        {type: 'slider', label: 'Shadow softness', bounds: [0, 12], property: [entry.light.shadow, 'radius'], onChange: () => {
                            this.viewer.renderManager.resetShadows()
                            dirty()
                        }},
                    ],
                })),
            ],
        }
        return this._uiConfig
    }

    /** Keep the lights, cove and shadow catcher around the robot. */
    update(target: Vector3) {
        this._target.copy(target)
        for (const {light, offset} of this._lights) {
            light.position.copy(target).add(offset)
            // threepipe's lights shine along their own -Z (the target is a child), so aim them with lookAt.
            light.lookAt(target)
        }
        for (const o of this._follow) o.position.set(target.x, 0, target.z)
    }
}
