import {Group, Object3D, Vector3} from 'three'
import {G1Robot} from './G1Robot'
import {CHARACTER_RIGS, CharacterRig, RetargetedCharacter} from './RetargetedCharacter'
import {G1Bricks, G1Controller, G1ControllerStats, G1Gait, GAIT_SPEEDS} from './G1Controller'
import {G1_BRICKS} from './G1Bricks'
import {heading, MotionBricksG1, MotionGenerator, OrtApi, setupOrtWeb} from './MotionBricksG1'
import {MotionBricksRemote, MotionBricksWorkerError} from './MotionBricksRemote'

const NVIDIA_ASSETS = 'https://media.githubusercontent.com/media/NVlabs/motionbricks/main/motionbricks/assets'

const ASSETS = 'https://cdn.jsdelivr.net/gh/repalash/three-motionbricks@v0.2.0/assets/'

/** Where the model and ONNX Runtime load from when the options do not say, and where the robot model is. */
export const MOTIONBRICKS_DEFAULTS = {
    /** NVIDIA's original fp32 model, 730 MB. A pack from tools/pack_model.py is about 190 MB. */
    model: NVIDIA_ASSETS + '/onnx/unitree_g1/mmm_v6_g1_fp32.onnx',
    /** This package's assets/ folder on jsDelivr: the robot and the other characters (see MOTIONBRICKS_CHARACTERS). */
    assets: ASSETS,
    /** The robot, for your GLTFLoader: assets/unitree_g1.glb in this package (6 MB, BSD-3-Clause, Unitree). */
    robot: ASSETS + 'unitree_g1.glb',
    ort: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.min.mjs',
}

/**
 * The models in assets/: the G1 the motion is made for, and others it is retargeted to with a rig from
 * CHARACTER_RIGS. Each `file` is relative to MOTIONBRICKS_DEFAULTS.assets.
 */
export const MOTIONBRICKS_CHARACTERS = [
    {id: 'g1', label: 'Unitree G1', file: 'unitree_g1.glb'},
    {id: 'h1', label: 'Unitree H1', file: 'robots/unitree_h1.glb', rig: 'unitreeH1'},
    {id: 't1', label: 'Booster T1', file: 'robots/booster_t1.glb', rig: 'boosterT1'},
    {id: 'op3', label: 'Robotis OP3', file: 'robots/robotis_op3.glb', rig: 'robotisOP3'},
    {id: 'robot-expressive', label: 'RobotExpressive', file: 'characters/robot_expressive.glb', rig: 'robotExpressive'},
    {id: 'astronaut', label: 'Astronaut', file: 'characters/astronaut.glb', rig: 'mixamo'},
    {id: 'polybot', label: 'Polybot', file: 'characters/polybot.glb', rig: 'mixamo'},
] as const satisfies readonly {id: string, label: string, file: string, rig?: keyof typeof CHARACTER_RIGS}[]

export interface MotionBricksCharacterOptions {
    /** A folder with pack.json from tools/pack_model.py (ending in /), or an original MotionBricks G1 .onnx file. */
    model?: string
    /**
     * A pack from tools/pack_lite.py, whose weights stay 8-bit in memory: about 0.5 GB in the browser against
     * 1.5 GB or more, with slower generation. Used instead of `model` where `lite` says.
     */
    liteModel?: string
    /** Use `liteModel`: always, never, or 'auto' (default) on phones, tablets and devices with 4 GB or less. */
    lite?: boolean | 'auto'
    /** The onnxruntime-web module to import. */
    ort?: string
    /** Parts of the ORT .wasm file, joined in order, for hosts that limit file size. */
    wasm?: string[]
    /**
     * 'wasm' (default) or 'webgpu'. With onnxruntime-web 1.30, WebGPU computes this model wrongly: the robot
     * sinks, sprints or walks away from its goal. It is here for testing newer releases.
     */
    backend?: 'wasm' | 'webgpu'
    /** Run the model in a Web Worker (default true). On the page, every generation stalls rendering. */
    worker?: boolean
    /** Make the robot's meshes cast and receive shadows. Default true. */
    shadows?: boolean
    /** Standing, walk and run target poses. The default ones are baked from the model. */
    bricks?: G1Bricks
}

export type LoadStage = 'runtime' | 'model' | 'warmup'

const tempA = new Vector3()

/**
 * A Unitree G1 that walks and runs where you send it, with every frame of motion generated in the
 * browser by NVIDIA MotionBricks. Add `object` to a three.js scene and call `update(dt)` every frame.
 *
 * ```ts
 * const gltf = await new GLTFLoader().loadAsync(MOTIONBRICKS_DEFAULTS.robot)
 * const g1 = new MotionBricksCharacter()
 * g1.setRobot(gltf.scene)
 * scene.add(g1.object)
 * await g1.load()
 * g1.moveTo(new Vector3(3, 0, -2))
 * renderer.setAnimationLoop(() => { g1.update(clock.getDelta()); renderer.render(scene, camera) })
 * ```
 *
 * Positions are in the world space of `object`'s parent, on the ground plane y = 0 of `object`.
 */
export class MotionBricksCharacter {
    readonly options: MotionBricksCharacterOptions
    /** Holds the robot. Move or scale it to place the character in your scene. */
    readonly object = new Group()
    /** The model being posed: the G1 itself, or another model the motion is retargeted to. */
    robot?: G1Robot | RetargetedCharacter
    engine?: MotionGenerator
    controller?: G1Controller
    gait: G1Gait = 'walk'
    /** Called when a generation fails. */
    onError?: (e: unknown) => void
    private _pendingGoal: [number, number] | null = null
    private _loading?: Promise<this>
    /** Where the robot stood when the model was disposed, so a new load continues from there. */
    private _lastPose?: ArrayLike<number>
    private _drive = {active: false, angle: 0, gait: 'walk' as G1Gait}

    constructor(options: MotionBricksCharacterOptions = {}) {
        this.options = options
        this.object.name = 'MotionBricks G1'
    }


    /** The model is loaded and the robot responds to moveTo and drive. */
    get ready() {
        return !!this.controller
    }

    /** 'wasm' or 'webgpu', once the model is loaded. */
    get backend() {
        return this.engine?.backend ?? ''
    }

    get stats(): G1ControllerStats | undefined {
        return this.controller?.stats
    }

    /** The segment being played, for a progress display. */
    get playback() {
        return this.controller?.playback ?? null
    }

    /** The robot is walking or running. */
    get moving() {
        return !!this.controller?.moving
    }

    /** Standing still, with no goal and no generation running. */
    get idle() {
        const c = this.controller
        return !!c && !c.moving && !c.generating && !c.goal
    }

    /**
     * Use a loaded G1 model, such as `gltf.scene` of MOTIONBRICKS_DEFAULTS.robot, which then stands in its rest pose.
     * Load it with whatever loader your project uses.
     */
    setRobot(root: Object3D) {
        if (this.robot) this.object.remove(this.robot.object)
        this.robot = G1Robot.FromObject(root, {shadows: this.options.shadows ?? true})
        this.robot.setPose(this.controller?.pose ?? (this.options.bricks ?? G1_BRICKS).rest[0])
        this.object.add(root)
        return this.robot
    }

    /**
     * Use another model, such as a robot from assets/robots or a character with a Mixamo skeleton: the G1's motion
     * is retargeted to it with a rig from CHARACTER_RIGS (or your own). It replaces the current robot.
     */
    setCharacter(root: Object3D, rig: CharacterRig, options: {matchSize?: boolean} = {}) {
        if (this.robot) this.object.remove(this.robot.object)
        const character = new RetargetedCharacter(root, rig, {shadows: this.options.shadows ?? true, ...options})
        this.robot = character
        character.setPose(this.controller?.pose ?? (this.options.bricks ?? G1_BRICKS).rest[0])
        this.object.add(character.object)
        return character
    }

    /**
     * Load ONNX Runtime and the model, in a worker unless `worker: false`, and warm it up. The robot can be set
     * before or after. Calling it again while loading waits for the same load.
     */
    async load(onProgress?: (stage: LoadStage, loaded: number, total: number) => void): Promise<this> {
        if (this.controller) return this
        this._loading ??= this._load(onProgress).finally(() => this._loading = undefined)
        return this._loading
    }

    private async _load(onProgress?: (stage: LoadStage, loaded: number, total: number) => void) {
        const o = this.options
        const ortUrl = o.ort ?? MOTIONBRICKS_DEFAULTS.ort
        const useLite = !!o.liteModel && (o.lite === true || (o.lite ?? 'auto') === 'auto' && isLowMemoryDevice())
        const model = useLite ? o.liteModel! : o.model ?? MOTIONBRICKS_DEFAULTS.model
        const useGpu = o.backend === 'webgpu' && typeof navigator !== 'undefined' && 'gpu' in navigator
        const sessionOptions = {executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'all'}
        const progress = (l: number, t: number) => onProgress?.('model', l, t)
        onProgress?.('runtime', 0, 1)
        let engine: MotionGenerator | null = null
        if (o.worker !== false) {
            // Only a worker that cannot run falls back to the page; a model that fails to load would fail there too.
            engine = await MotionBricksRemote.Load({ort: ortUrl, wasm: o.wasm, model, sessionOptions}, progress).catch(e => {
                if (!(e instanceof MotionBricksWorkerError)) throw e
                console.warn('MotionBricks: the worker could not start, running the model on the page instead', e)
                return null
            })
        }
        if (!engine) engine = await MotionBricksG1.Load(await loadOrt(ortUrl, o.wasm), model, sessionOptions, progress)
        // One generation compiles the kernels before the robot moves.
        onProgress?.('warmup', 0, 1)
        const rest = Float32Array.from((o.bricks ?? G1_BRICKS).rest[0])
        let warmupMs = 0
        try {
            warmupMs = (await engine.generate([rest, rest, rest, rest], [rest])).inferenceMs
        } catch (e) {
            if (engine instanceof MotionBricksRemote) engine.worker.terminate()
            throw e
        }
        this.engine = engine
        const p = this._lastPose
        const c = p ?
            new G1Controller(engine, o.bricks ?? G1_BRICKS, p[0], p[1], heading([p[3], p[4], p[5], p[6]])) :
            new G1Controller(engine, o.bricks ?? G1_BRICKS)
        c.gait = this.gait
        // The warm-up includes compiling the kernels, so it overestimates; the first real generation replaces it.
        c.stats.averageInferenceMs = warmupMs
        c.onError = e => this.onError ? this.onError(e) : console.error('MotionBricks: generation failed', e)
        this.controller = c
        if (this._pendingGoal) c.moveTo(...this._pendingGoal, this.gait)
        this._pendingGoal = null
        return this
    }

    /** Advance the motion by dt seconds and pose the robot. Call it every frame. */
    update(dt: number) {
        const c = this.controller
        if (!c) return
        c.update(Math.min(dt, 0.1))
        this.robot?.setPose(c.pose)
    }

    /** Convert a world point to the character's G1 ground coordinates. */
    private _toG1(point: Vector3): [number, number] {
        this.object.updateWorldMatrix(true, false)
        return G1Robot.ToG1(this.object.worldToLocal(tempA.copy(point)))
    }

    /** Walk or run to a world point and stop there, facing the way it walked. */
    moveTo(point: Vector3, gait: G1Gait = this.gait) {
        this.gait = gait
        this._drive.active = false
        const g = this._toG1(point)
        if (this.controller) this.controller.moveTo(g[0], g[1], gait)
        else this._pendingGoal = g
    }

    /**
     * Steer with a world direction on the ground (WASD, a joystick), or null to stop. Call it every frame
     * while the input is held. The gait applies while driving; `gait` stays the default for moveTo. A new direction or gait generates at once; small changes steer the goal,
     * kept a few metres ahead, from the next segment.
     */
    drive(direction: Vector3 | null, gait: G1Gait = this.gait) {
        const c = this.controller
        if (!c) return
        if (!direction || direction.x === 0 && direction.z === 0) {
            if (this._drive.active) c.stop()
            this._drive.active = false
            return
        }
        this.object.updateWorldMatrix(true, false)
        const origin = this.object.worldToLocal(tempA.set(0, 0, 0))
        const [ox, oy] = G1Robot.ToG1(origin)
        const [dx, dy] = this._toG1(direction)
        const angle = Math.atan2(dy - oy, dx - ox)
        const ahead = GAIT_SPEEDS[gait] * c.lead + 4
        const goal: [number, number] = [c.pose[0] + Math.cos(angle) * ahead, c.pose[1] + Math.sin(angle) * ahead]
        const d = this._drive
        const turn = Math.abs(Math.atan2(Math.sin(angle - d.angle), Math.cos(angle - d.angle)))
        if (!d.active || gait !== d.gait || turn > 0.35) {
            Object.assign(d, {active: true, angle, gait})
            c.moveTo(goal[0], goal[1], gait)
        } else c.goal = goal
    }

    /** Come to a stop a short way ahead. */
    stop() {
        this._drive.active = false
        this._pendingGoal = null
        this.controller?.stop()
    }

    /** The robot's ground position, in world space. */
    getPosition(target = new Vector3()) {
        const pose = this.controller?.pose
        if (pose) G1Robot.FromG1(pose[0], pose[1], 0, target)
        else target.set(0, 0, 0)
        return this.object.localToWorld(target)
    }

    /** The current goal, in world space, or null. */
    getGoal(target = new Vector3()) {
        const goal = this.controller?.goal ?? this._pendingGoal
        if (!goal) return null
        return this.object.localToWorld(G1Robot.FromG1(goal[0], goal[1], 0, target))
    }

    /** The direction the robot faces, as an angle around Y in the character's space (0 faces +X). */
    get heading() {
        const p = this.controller?.pose
        return p ? heading([p[3], p[4], p[5], p[6]]) : 0
    }

    /** Stop the worker. The robot stays in the scene, and load() starts the model again from where it stands. */
    dispose() {
        if (this.controller) this._lastPose = Float32Array.from(this.controller.pose)
        if (this.engine instanceof MotionBricksRemote) this.engine.worker.terminate()
        this.engine = undefined
        this.controller = undefined
    }
}

/** A phone, a tablet, or a device reporting 4 GB of memory or less, where the full model does not fit. */
export function isLowMemoryDevice() {
    if (typeof navigator === 'undefined') return false
    const memory = (navigator as any).deviceMemory as number | undefined
    if (memory && memory <= 4) return true
    // iPadOS reports itself as a Mac, with touch.
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.platform.includes('Mac') && navigator.maxTouchPoints > 1
}

/** Import onnxruntime-web on the page, for when no worker is used. */
export async function loadOrt(url: string, wasm?: string[]): Promise<OrtApi & {env: any}> {
    const ort = await import(/* @vite-ignore */ new URL(url, location.href).href)
    await setupOrtWeb(ort, wasm)
    return ort
}
