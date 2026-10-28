import {
    CanvasTexture,
    Color,
    DirectionalLight2,
    DoubleSide,
    HDRiGroundPlugin,
    ITexture,
    LatheGeometry,
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
    Vector2,
    Vector3,
} from 'threepipe'
import {BloomPlugin, SSContactShadowsPlugin, SSGIPlugin, SSReflectionPlugin} from '@threepipe/webgi-plugins'

// Scene presets for the MotionBricks demo, after the looks robotics teams use for their demos:
// research viewers (MuJoCo, Newton), the Isaac Sim grid, a product studio, a launch stage, and a real space.

export interface StageLight {
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
        | {kind: 'cove', color: string, roughness: number, metalness?: number}
        | {kind: 'hdri', shadowOpacity: number}
    /** HDR file name for lighting and reflections, or '' for a gradient made from the sky colors. */
    environment: string
    environmentIntensity: number
    lights: StageLight[]
    /** Intensity of each screen-space effect; 0 turns it off. */
    effects: {ssgi: number, ssr: number, contact: number, bloom: number}
    /** Height and ground radius of the HDR capture, for the projected ground. */
    hdriGround?: {tripodHeight: number, worldRadius: number}
}

export const STAGE_STYLES = {
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
        floor: {kind: 'cove', color: '#0c0d0f', roughness: 0.2},
        environment: 'studio_small_09_1k.hdr',
        environmentIntensity: 0.3,
        lights: [
            {color: '#ffffff', intensity: 3, offset: [0.5, 7, 2], shadow: true},
            {color: '#9fc4ff', intensity: 2.5, offset: [-4, 2.5, -3]},
            {color: '#ffb27a', intensity: 1.5, offset: [4, 2, -3]},
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
    style: StageStyle = STAGE_STYLES.research
    effectsEnabled = true
    private _objects: Object3D[] = []
    private _lights: {light: DirectionalLight2, offset: Vector3}[] = []
    private _follow: Object3D[] = []
    private _environments = new Map<string, Promise<ITexture | null>>()
    private _applyId = 0

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

        const floor = style.floor
        if (floor.kind === 'checker' || floor.kind === 'grid') {
            const maxAnisotropy = v.renderManager.webglRenderer.capabilities.getMaxAnisotropy()
            const mesh = new Mesh(new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE).rotateX(-Math.PI / 2), new PhysicalMaterial({
                map: floorTexture(floor.kind, floor.base, floor.line, maxAnisotropy),
                roughness: floor.roughness, metalness: floor.metalness ?? 0,
            }))
            mesh.receiveShadow = true
            mesh.name = 'Floor'
            add(mesh)
        } else if (floor.kind === 'cove') {
            const mesh = new Mesh(coveGeometry(), new PhysicalMaterial({
                color: floor.color, roughness: floor.roughness, metalness: floor.metalness ?? 0, side: DoubleSide,
            }))
            mesh.receiveShadow = true
            mesh.name = 'Cove'
            add(mesh, true)
        } else if (floor.kind === 'hdri') {
            // The projected HDR is the floor; this plane only catches the robot's shadow.
            const mesh = new Mesh(new PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new ShadowMaterial({opacity: floor.shadowOpacity}))
            mesh.receiveShadow = true
            mesh.name = 'Shadow catcher'
            add(mesh, true)
        }

        for (const l of style.lights) {
            const light = new DirectionalLight2(l.color, l.intensity)
            if (l.shadow) {
                light.castShadow = true
                light.shadowMapSize.setScalar(2048)
                light.shadowNear = 0.5
                light.shadowFar = 25
                light.shadowFrustum = 6
                light.shadow.radius = 3
            }
            add(light)
            this._lights.push({light, offset: new Vector3(...l.offset)})
        }
        this.setEffects(this.effectsEnabled)
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
        v.setDirty()
    }

    /** Keep the lights, cove and shadow catcher around the robot. */
    update(target: Vector3) {
        for (const {light, offset} of this._lights) {
            light.position.copy(target).add(offset)
            // DirectionalLight2 shines along its own -Z (its target is a child), so aim it with lookAt.
            light.lookAt(target)
        }
        for (const o of this._follow) o.position.set(target.x, 0, target.z)
    }
}
