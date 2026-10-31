import {Group, Object3D, Quaternion, Vector3} from 'three'
import {G1Robot} from './G1Robot'
import {CHARACTER_RIGS, CharacterRig, RetargetedCharacter} from './RetargetedCharacter'
import {G1Bricks, G1Controller, G1ControllerStats, G1Gait} from './G1Controller'
import {G1_BRICKS} from './G1Bricks'
import {SOMA_BRICKS} from './SOMABricks'
import {MotionBricksSOMA, SOMA_SKELETON_INFO} from './MotionBricksSOMA'
import {SOMAMannequin} from './SOMAMannequin'
import {G1_RIG, SOMA_RIG} from './PoseRig'
import {MOTIONBRICKS_CACHE, MotionBricksG1, MotionGenerator, OrtApi, setupOrtWeb, SharedEngine} from './MotionBricksG1'
import {MotionBricksRemote, MotionBricksWorkerError} from './MotionBricksRemote'
import {G1_PRIMITIVE_SOURCES, G1Primitive, G1PrimitiveStep, loadPrimitive} from './G1Primitives'
import {carryHands, carryPoses, kickPoses, reachPoses, Side, standPoses, throwPoses} from './SOMAActions'
import {SOMAPoseEditor, v3} from './SOMAPoseEdit'

const NVIDIA_ASSETS = 'https://media.githubusercontent.com/media/NVlabs/motionbricks/main/motionbricks/assets'

const ASSETS = 'https://cdn.jsdelivr.net/gh/repalash/three-motionbricks@v0.2.0/assets/'

/** Where the model and ONNX Runtime load from when the options do not say, and where the robot model is. */
export const MOTIONBRICKS_DEFAULTS = {
    /** NVIDIA's original fp32 model, 730 MB. A pack from tools/pack_model.py is about 190 MB. */
    model: NVIDIA_ASSETS + '/onnx/unitree_g1/mmm_v6_g1_fp32.onnx',
    /** NVIDIA's original fp32 SOMA (human) model, 758 MB, for `rig: 'soma'`. A pack is about 195 MB. */
    somaModel: NVIDIA_ASSETS + '/onnx/soma/mmm_v6_soma_fp32.onnx',
    /** This package's assets/ folder on jsDelivr: the robot and the other characters (see MOTIONBRICKS_CHARACTERS). */
    assets: ASSETS,
    /** The robot, for your GLTFLoader: assets/unitree_g1.glb in this package (6 MB, BSD-3-Clause, Unitree). */
    robot: ASSETS + 'unitree_g1.glb',
    /** onnxruntime-web's WebAssembly-only build: half the size of the full one, and what the default backend uses. */
    ort: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs',
    /** The build with WebGPU, for `backend: 'webgpu'`. */
    ortWebGpu: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs',
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
    /**
     * The model: 'g1' (default) for the Unitree G1, or 'soma' for NVIDIA's SOMA human model, which drives a
     * mannequin (setMannequin) or a humanoid character.
     */
    rig?: 'g1' | 'soma'
    /** A folder with pack.json from tools/pack_model.py (ending in /), or an original MotionBricks G1 .onnx file. */
    model?: string
    /**
     * A pack from tools/pack_lite.py, whose weights stay 8-bit in memory: about 0.5 GB in the browser against
     * 1.5 GB or more, with slower generation. Used instead of `model` where `lite` says.
     */
    liteModel?: string
    /** Use `liteModel`: always, never, or 'auto' (default) on phones, tablets and devices with 4 GB or less. */
    lite?: boolean | 'auto'
    /** The onnxruntime-web module to import. The default is MOTIONBRICKS_DEFAULTS.ort, or ortWebGpu for WebGPU. */
    ort?: string
    /** Parts of the ORT .wasm file, joined in order, for hosts that limit file size. */
    wasm?: string[]
    /**
     * 'auto' (default): WebGPU where the browser has it and the device is not short of memory, if a warm
     * generation takes no more than `gpuLimitMs`; otherwise WebAssembly. Or 'wasm' or 'webgpu' always. With
     * onnxruntime-web 1.30's WebGPU build, both models compute the same motion as on WebAssembly (to 0.01 mm).
     */
    backend?: 'auto' | 'wasm' | 'webgpu'
    /** With `backend: 'auto'`, a warm WebGPU generation slower than this (ms) falls back to WebAssembly. Default 300. */
    gpuLimitMs?: number
    /** Run the model in a Web Worker (default true). On the page, every generation stalls rendering. */
    worker?: boolean
    /**
     * Keep model packs in the browser's Cache Storage, so they download once rather than on every visit and
     * page (default true). A string names the cache; the default is MOTIONBRICKS_CACHE.
     */
    cache?: boolean | string
    /** Make the robot's meshes cast and receive shadows. Default true. */
    shadows?: boolean
    /** Standing, walk and run target poses. The default ones are baked from the model. */
    bricks?: G1Bricks
    /** Where Smart Primitives and their clips load from (loadPrimitive). The default is NVIDIA's repository. */
    primitives?: typeof G1_PRIMITIVE_SOURCES
}

/**
 * Something the robot jumps or vaults over: a Smart Primitive placed in the world. `position` is the centre of
 * the primitive's box on the ground, and `rotation` turns it about Y. The box measures `primitive.box.size`:
 * width along the obstacle's X, depth along its Z, height up.
 */
export interface MotionBricksObstacle {
    primitive: G1Primitive
    position: Vector3
    rotation?: number
}

export type LoadStage = 'runtime' | 'model' | 'warmup'

/**
 * Something the human picks up, carries and throws or puts down. `position` is its centre in world space, kept up to
 * date by you while it lies about and by the character while it is carried; `object`, when given, is moved with it.
 */
export interface MotionBricksItem {
    position: Vector3
    /** Its size across, in metres: up to about 0.2 is held in one hand, more in two. Default 0.12. */
    size?: number
    /** 'one' or 'two' hands; by default from the size. */
    hands?: 'one' | 'two'
    object?: Object3D
}

/** What the human is doing: the interaction under way, and its stage. */
export interface MotionBricksInteraction {
    kind: 'kick' | 'pick' | 'throw' | 'put'
    /** 'approach' while walking up to it, then the step playing ('Kick', 'Reach', 'Lift', 'Throw', 'Recover'). */
    stage: string
    /** The item picked up or put down. */
    item?: MotionBricksItem
}

interface Task {
    kind: MotionBricksInteraction['kind']
    stage: string
    /** Where it happens and the way the body faces there, in controller space. */
    at: [number, number]
    angle: number
    /** Distance at which the action starts, and the approach point when the body must line up first. */
    trigger: number
    via?: [number, number]
    item?: MotionBricksItem
    target?: Vector3
    power: number
    foot: Side
    /** For putting down: the height of the item's centre where it goes, in the character's space. */
    height?: number
    done?: boolean
}

const range = (a: number, b: number) => Array.from({length: b - a + 1}, (_, i) => a + i)

const tempA = new Vector3()
const tempB = new Vector3()

/** The launch velocity that carries a thrown item from `from` to `to` in a flight time that grows with distance. */
export function ballistic(from: Vector3, to: Vector3, gravity = 9.81) {
    const d = to.clone().sub(from)
    const flat = Math.hypot(d.x, d.z)
    const t = 0.35 + flat * 0.07
    return new Vector3(d.x / t, (d.y + 0.5 * gravity * t * t) / t, d.z / t)
}

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
    robot?: G1Robot | RetargetedCharacter | SOMAMannequin
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
    /** The interaction under way (kick, pick up, throw, put down). */
    private _task: Task | null = null
    /** What the human holds, and how far the carrying arms are blended in (0 to 1). */
    private _carry: {item: MotionBricksItem, hands: 'one' | 'two', side: Side, blend: number} | null = null
    /** The pose shown: the controller's, with the carrying arms on top. */
    private _shown?: Float32Array
    private _shownWorld = new Float32Array(SOMA_SKELETON_INFO.J * 7)
    private _lastWorld = new Float32Array(SOMA_SKELETON_INFO.J * 7)
    private _lastDt = 1 / 60
    /** Called when the human picks an item up. */
    onPickUp?: (item: MotionBricksItem) => void
    /** Called when the human lets go of an item: thrown (with the velocity to give it, m/s in world space) or put down. */
    onRelease?: (item: MotionBricksItem, velocity: Vector3) => void

    constructor(options: MotionBricksCharacterOptions = {}) {
        this.options = options
        this.object.name = 'MotionBricks G1'
    }


    private get _rig() {
        return this.options.rig === 'soma' ? SOMA_RIG : G1_RIG
    }

    private get _bricks() {
        return this.options.bricks ?? (this.options.rig === 'soma' ? SOMA_BRICKS : G1_BRICKS)
    }

    /** For `rig: 'soma'`: show the motion on a mannequin built on the SOMA skeleton. It replaces the current model. */
    setMannequin(options: {color?: string, accent?: string} = {}) {
        if (this.robot) this.object.remove(this.robot.object)
        const mannequin = new SOMAMannequin({shadows: this.options.shadows ?? true, ...options})
        this.robot = mannequin
        mannequin.setPose(this.controller?.pose ?? this._bricks.rest[0])
        this.object.add(mannequin.object)
        return mannequin
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
        this.robot.setPose(this.controller?.pose ?? this._bricks.rest[0])
        this.object.add(root)
        return this.robot
    }

    /**
     * Use another model, such as a robot from assets/robots or a character with a Mixamo skeleton: the G1's motion
     * is retargeted to it with a rig from CHARACTER_RIGS (or your own). It replaces the current robot.
     */
    setCharacter(root: Object3D, rig: CharacterRig, options: {matchSize?: boolean} = {}) {
        if (this.robot) this.object.remove(this.robot.object)
        const character = new RetargetedCharacter(root, rig, {shadows: this.options.shadows ?? true, source: this.options.rig === 'soma' ? 'soma' : 'g1', ...options})
        this.robot = character
        character.setPose(this.controller?.pose ?? this._bricks.rest[0])
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
        const useLite = !!o.liteModel && (o.lite === true || (o.lite ?? 'auto') === 'auto' && isLowMemoryDevice())
        const soma = o.rig === 'soma'
        const model = useLite ? o.liteModel! : o.model ?? (soma ? MOTIONBRICKS_DEFAULTS.somaModel : MOTIONBRICKS_DEFAULTS.model)
        const backend = o.backend ?? 'auto'
        const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
        const cache = o.cache === false ? false : typeof o.cache === 'string' ? o.cache : MOTIONBRICKS_CACHE
        const progress = (l: number, t: number) => onProgress?.('model', l, t)
        const create = async(gpu: boolean) => {
            const ortUrl = o.ort ?? (gpu ? MOTIONBRICKS_DEFAULTS.ortWebGpu : MOTIONBRICKS_DEFAULTS.ort)
            const providers = backend === 'webgpu' ? ['webgpu', 'wasm'] : ['webgpu']
            const sessionOptions = {executionProviders: gpu ? providers : ['wasm'], graphOptimizationLevel: 'all'}
            let engine: MotionGenerator | null = null
            if (o.worker !== false) {
                // Only a worker that cannot run falls back to the page; a model that fails to load would fail there too.
                engine = await MotionBricksRemote.Load({ort: ortUrl, wasm: o.wasm, model, sessionOptions, cache, rig: soma ? 'soma' : 'g1'}, progress).catch(e => {
                    if (!(e instanceof MotionBricksWorkerError)) throw e
                    console.warn('MotionBricks: the worker could not start, running the model on the page instead', e)
                    return null
                })
            }
            return engine ?? await (soma ? MotionBricksSOMA : MotionBricksG1).Load(await loadOrt(ortUrl, o.wasm), model, sessionOptions, progress, cache)
        }
        const stop = (engine: MotionGenerator) => {
            if (engine instanceof MotionBricksRemote) engine.worker.terminate()
        }
        const rest = Float32Array.from(this._bricks.rest[0])
        const time = async(engine: MotionGenerator) => {
            try {
                return (await engine.generate([rest, rest, rest, rest], [rest])).inferenceMs
            } catch (e) {
                stop(engine)
                throw e
            }
        }
        onProgress?.('runtime', 0, 1)
        // 'auto' tries WebGPU on devices with memory to spare; a GPU that fails to load or runs slow falls back.
        const auto = backend === 'auto' && hasGpu && !useLite
        let engine: MotionGenerator
        if (auto) {
            engine = await create(true).catch(async e => {
                console.warn('MotionBricks: WebGPU did not load, using WebAssembly', e)
                return create(false)
            })
        } else engine = await create(backend === 'webgpu' && hasGpu)
        // One generation compiles the kernels before the robot moves. Where memory is short, wait for the
        // downloaded weights to be collected first: the first generation's buffers on top of them lift the peak
        // by about 150 MB, which is enough for a phone to close the tab.
        onProgress?.('warmup', 0, 1)
        if (useLite) await new Promise(resolve => setTimeout(resolve, 2000))
        let warmupMs = await time(engine)
        if (auto && engine.backend === 'webgpu') {
            // The first run compiles shaders; the second shows the GPU's speed, unless the first was already far too slow.
            const limit = o.gpuLimitMs ?? 300
            if (warmupMs < limit * 10) warmupMs = await time(engine)
            if (warmupMs > limit) {
                console.info(`MotionBricks: WebGPU took ${Math.round(warmupMs)} ms a generation, using WebAssembly`)
                stop(engine)
                engine = await create(false)
                warmupMs = await time(engine)
            }
        }
        this.engine = new SharedEngine(engine)
        this._startController(warmupMs)
        return this
    }

    /**
     * Share another character's model instead of loading one: several characters, one download and one worker. Their
     * generations take turns, so each waits a little longer as more share it. Both must use the same rig.
     */
    async loadFrom(other: MotionBricksCharacter): Promise<this> {
        if (this.controller) return this
        if ((other.options.rig ?? 'g1') !== (this.options.rig ?? 'g1')) throw new Error('MotionBricks: loadFrom needs a character with the same rig')
        await other.load()
        this.engine = other.engine
        this._startController(other.controller?.stats.averageInferenceMs ?? 400)
        return this
    }

    private _startController(warmupMs: number) {
        const engine = this.engine!
        const p = this._lastPose
        const c = p ?
            new G1Controller(engine, this._bricks, ...this._rig.ground(p), this._rig.heading(p), this._rig) :
            new G1Controller(engine, this._bricks, 0, 0, 0, this._rig)
        c.gait = this.gait
        // The warm-up includes compiling the kernels, so it overestimates; the first real generation replaces it.
        c.stats.averageInferenceMs = warmupMs
        c.onError = e => this.onError ? this.onError(e) : console.error('MotionBricks: generation failed', e)
        this.controller = c
        this._syncObstacles()
        if (this._pendingGoal) c.moveTo(...this._pendingGoal, this.gait)
        this._pendingGoal = null
    }

    /** Advance the motion by dt seconds and pose the robot. Call it every frame. */
    update(dt: number) {
        const c = this.controller
        if (!c) return
        dt = Math.min(dt, 0.1)
        if (this._task) this._updateTask()
        c.update(dt)
        let pose = c.pose
        if (this.options.rig === 'soma') {
            pose = this._carryPose(pose, dt)
            this._lastWorld.set(this._shownWorld)
            SOMA_SKELETON_INFO.world(pose, this._shownWorld)
            this._lastDt = dt
            if (this._carry) this._placeCarried()
        }
        this.robot?.setPose(pose)
    }

    // ---- interactions (the human, rig: 'soma') ----

    /** The interaction under way, or null. */
    get interaction(): MotionBricksInteraction | null {
        return this._task ? {kind: this._task.kind, stage: this._task.stage, item: this._task.item} : null
    }

    /** The item being carried, or null. */
    get carrying() {
        return this._carry?.item ?? null
    }

    /**
     * While a kick is under way, the way the ball should go (a world direction on the ground) and how hard (1 is a
     * firm pass): for your ball physics, which detects the foot meeting the ball with jointPosition.
     */
    get kicking(): {direction: Vector3, power: number, foot: Side} | null {
        const t = this._task
        if (!t || t.kind !== 'kick' || t.stage === 'approach') return null
        const direction = this._fromG1Direction(t.angle)
        return {direction, power: t.power, foot: t.foot}
    }

    /** A SOMA joint's position in world space as shown, such as 'RightToeBase', 'LeftFoot' or 'RightHand'. */
    jointPosition(name: string, target = new Vector3()) {
        const j = SOMA_SKELETON_INFO.index(name)
        if (this.options.rig !== 'soma' || j < 0) return null
        const w = this._shownWorld
        return this.object.localToWorld(target.set(w[j * 7], w[j * 7 + 1], w[j * 7 + 2]))
    }

    /** A SOMA joint's velocity in world space, m/s, over the last frame. */
    jointVelocity(name: string, target = new Vector3()) {
        const j = SOMA_SKELETON_INFO.index(name)
        if (this.options.rig !== 'soma' || j < 0) return null
        const a = this._shownWorld, b = this._lastWorld, o = j * 7
        const now = this.object.localToWorld(target.set(a[o], a[o + 1], a[o + 2]))
        const before = this.object.localToWorld(tempB.set(b[o], b[o + 1], b[o + 2]))
        return now.sub(before).divideScalar(this._lastDt)
    }

    /**
     * Kick a ball at a world point: walk up to it (lining up first when it is to the side) and swing through it.
     * `direction` is where it should go (by default straight on from the human); `power` 0.5 to 2.
     */
    kick(ball: Vector3, {direction, power = 1, foot = 'Right'}: {direction?: Vector3, power?: number, foot?: Side} = {}) {
        if (!this._canInteract()) return false
        const at = this._toG1(ball)
        const [x, y] = this._rig.ground(this.controller!.pose)
        const angle = direction ? this._toG1Direction(direction) : Math.atan2(at[1] - y, at[0] - x)
        const speed = this.controller!.speedOf(this._drive.active ? this._drive.gait : this.gait)
        this._startTask({kind: 'kick', stage: 'approach', at, angle, trigger: Math.min(4, speed * 0.9 + 1.0), power, foot}, 1.6)
        return true
    }

    /** Walk to an item, crouch and pick it up; it is then carried until thrown or put down. */
    pickUp(item: MotionBricksItem) {
        if (!this._canInteract() || this._carry) return false
        const at = this._toG1(item.position)
        const [x, y] = this._rig.ground(this.controller!.pose)
        const angle = Math.atan2(at[1] - y, at[0] - x)
        this._startTask({kind: 'pick', stage: 'approach', at, angle, trigger: 2.0, item, power: 1, foot: 'Right'}, 0)
        return true
    }

    /** Throw the carried item at a world point, turning to face it. onRelease gives the velocity that lands it there. */
    throwAt(target: Vector3, {power = 1}: {power?: number} = {}) {
        if (!this._canInteract() || !this._carry) return false
        const [x, y] = this._rig.ground(this.controller!.pose)
        const g = this._toG1(target)
        const angle = Math.atan2(g[1] - y, g[0] - x)
        this._task = {kind: 'throw', stage: 'Throw', at: [x, y], angle, trigger: 0, target: target.clone(), power, foot: 'Right'}
        this._drive.active = false
        const th = throwPoses({power})
        const ahead = 0.1
        this.controller!.perform([
            {name: 'Throw', window: this._rig.place(th.poses, x + Math.cos(angle) * ahead, y + Math.sin(angle) * ahead, angle), transitionEarly: 2, tokens: range(6, 9)},
            {name: 'Recover', window: this._rig.place(standPoses(), x + Math.cos(angle) * 0.35, y + Math.sin(angle) * 0.35, angle), transitionEarly: 0, tokens: range(6, 9)},
        ], {name: 'throw'})
        return true
    }

    /**
     * Put the carried item down at a world point (by default on the ground just ahead), crouching to it. A point above
     * the ground, such as the top of a stack, puts the item's centre there.
     */
    putDown(at?: Vector3) {
        if (!this._canInteract() || !this._carry) return false
        const [x, y] = this._rig.ground(this.controller!.pose)
        const h = this.heading
        const g = at ? this._toG1(at) : [x + Math.cos(h) * 0.7, y + Math.sin(h) * 0.7] as [number, number]
        const angle = Math.hypot(g[0] - x, g[1] - y) > 0.3 ? Math.atan2(g[1] - y, g[0] - x) : h
        const size = this._carry.item.size ?? 0.12
        const height = at ? Math.max(size / 2 + 0.02, this.object.worldToLocal(tempA.copy(at)).y) : size / 2 + 0.02
        this._startTask({kind: 'put', stage: 'approach', at: g, angle, trigger: 2.0, item: this._carry.item, power: 1, foot: 'Right', height}, 0)
        return true
    }

    /** Stop the interaction under way, if it has not started its motion. */
    cancelInteraction() {
        if (this._task?.stage === 'approach') this._task = null
    }

    private _canInteract() {
        if (this.options.rig !== 'soma') {
            console.warn('MotionBricks: interactions are for the human model (rig: \'soma\')')
            return false
        }
        const c = this.controller
        return !!c && !c.busy && !this.seated
    }

    private _startTask(task: Task, lineUp: number) {
        const c = this.controller!
        const [x, y] = this._rig.ground(c.pose)
        // Off to the side of the line it should go along: walk round to behind it first.
        const dx = task.at[0] - x, dy = task.at[1] - y
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - task.angle), Math.cos(Math.atan2(dy, dx) - task.angle)))
        if (lineUp && off > 0.6 && Math.hypot(dx, dy) > 0.5) task.via = [task.at[0] - Math.cos(task.angle) * lineUp, task.at[1] - Math.sin(task.angle) * lineUp]
        this._task = task
        this._drive.active = false
        if (task.via) c.moveTo(task.via[0], task.via[1], this.gait)
        else this._approach(task)
        this._updateTask()
    }

    /** Walk toward the task's spot, aiming a little short of it so that a late generation never steps onto it. */
    private _approach(task: Task) {
        const c = this.controller!
        const [x, y] = this._rig.ground(c.pose)
        const dx = task.at[0] - x, dy = task.at[1] - y, d = Math.hypot(dx, dy)
        if (d <= task.trigger) return
        const short = Math.min(0.6, d)
        c.moveTo(task.at[0] - dx / d * short, task.at[1] - dy / d * short, this.gait)
    }

    private _updateTask() {
        const t = this._task!, c = this.controller!
        if (t.stage === 'approach') {
            const [x, y] = this._rig.ground(c.pose)
            if (t.via) {
                if (Math.hypot(t.via[0] - x, t.via[1] - y) > 0.6) return
                t.via = undefined
                this._approach(t)
            }
            if (Math.hypot(t.at[0] - x, t.at[1] - y) > t.trigger || c.busy) return
            this._act(t)
            return
        }
        const a = c.action
        if (a?.name === t.kind) t.stage = a.step
        const p = c.playback
        if (t.kind === 'pick' && !this._carry && t.item) {
            // Take hold when the hand gets there, or at the end of the reach.
            const hand = this._handHold(t.item)
            if (hand.distanceTo(t.item.position) < (t.item.size ?? 0.12) * 0.5 + 0.08 || t.stage === 'Lift' || a?.step === 'Reach' && p && p.frame >= p.transition) {
                this._carry = {item: t.item, hands: this._hands(t.item), side: 'Right', blend: 0}
                this.onPickUp?.(t.item)
            }
        }
        if ((t.kind === 'throw' || t.kind === 'put') && this._carry && !t.done) {
            const release = t.kind === 'throw' ? t.stage === 'Recover' || a?.step === 'Throw' && p && p.frame >= p.transition :
                t.stage === 'Lift' || a?.step === 'Reach' && p && p.frame >= p.transition
            if (release) {
                t.done = true
                const item = this._carry.item
                this._carry = null
                this.onRelease?.(item, t.kind === 'throw' && t.target ? ballistic(item.position, t.target) : new Vector3())
            }
        }
        if (!c.busy && !a) this._task = null
    }

    private _act(t: Task) {
        const c = this.controller!, rig = this._rig
        const [x, y] = rig.ground(c.pose)
        const back = (d: number): [number, number] => [t.at[0] - Math.cos(t.angle) * d, t.at[1] - Math.sin(t.angle) * d]
        let steps: G1PrimitiveStep[]
        if (t.kind === 'kick') {
            const [fx, fy] = [t.at[0] + Math.cos(t.angle) * 0.45, t.at[1] + Math.sin(t.angle) * 0.45]
            steps = [
                {name: 'Kick', window: rig.place(kickPoses({foot: t.foot, power: t.power}), t.at[0], t.at[1], t.angle), transitionEarly: 4, tokens: range(6, 12)},
                {name: 'Recover', window: rig.place(standPoses(), fx, fy, t.angle), transitionEarly: 0, tokens: range(6, 10)},
            ]
        } else {
            // Face the item from where the body is now.
            if (Math.hypot(t.at[0] - x, t.at[1] - y) > 0.3) t.angle = Math.atan2(t.at[1] - y, t.at[0] - x)
            const item = t.item!
            const hands = this._hands(item), size = item.size ?? 0.12
            const height = t.kind === 'pick' ? Math.max(0.03, this.object.worldToLocal(tempA.copy(item.position)).y - (hands === 'two' ? 0 : size * 0.3)) :
                (t.height ?? size / 2 + 0.02) - (hands === 'two' ? 0 : size * 0.3)
            const [sx, sy] = back(0.3)
            steps = [
                {name: 'Reach', window: rig.place(reachPoses({height, hands, width: size}), t.at[0], t.at[1], t.angle), transitionEarly: 2, tokens: range(6, 12)},
                {name: 'Lift', window: rig.place(t.kind === 'pick' ? carryPoses({hands, width: size}) : standPoses(), sx, sy, t.angle), transitionEarly: 0, tokens: range(6, 9)},
            ]
        }
        t.stage = steps[0].name
        c.perform(steps, {name: t.kind})
    }

    private _hands(item: MotionBricksItem) {
        return item.hands ?? ((item.size ?? 0.12) > 0.22 ? 'two' : 'one')
    }

    /** Where the hand (or hands) hold an item, in world space. */
    private _handHold(item: MotionBricksItem, target = new Vector3()) {
        const w = this._shownWorld, k = SOMA_SKELETON_INFO
        const at = (name: string) => tempB.set(w[k.index(name) * 7], w[k.index(name) * 7 + 1], w[k.index(name) * 7 + 2])
        if (this._hands(item) === 'two') target.copy(at('RightHand')).add(at('LeftHand')).multiplyScalar(0.5)
        else {
            // Against the palm: a little past the knuckles, and below the hand by the item's half size.
            const hand = at('RightHand').clone(), knuckle = at('RightHandMiddle1').clone()
            target.copy(hand).lerp(knuckle, 1.1)
            target.y -= (item.size ?? 0.12) * 0.35
        }
        return this.object.localToWorld(target)
    }

    private _placeCarried() {
        const item = this._carry!.item
        this._handHold(item, item.position)
        if (item.object) {
            const parent = item.object.parent
            if (parent) parent.worldToLocal(item.object.position.copy(item.position))
            else item.object.position.copy(item.position)
        }
    }

    /** The controller's pose with the arms holding the carried item, blended in over a third of a second. */
    private _carryPose(pose: Float32Array, dt: number) {
        const carry = this._carry
        if (!carry) return pose
        carry.blend = Math.min(1, carry.blend + dt * 3)
        // Not while an action of its own moves the arms (the lift, throw or put down plays as generated).
        const a = this.controller?.action
        if (a && (a.name === 'throw' || a.name === 'put' || a.name === 'pick' && a.step === 'Reach')) return pose
        const e = new SOMAPoseEditor(pose)
        const hips = e.position('Hips'), f = e.forward(), l = e.left()
        const at = carryHands(carry.hands, carry.item.size ?? 0.3, carry.side)
        const w = carry.blend * carry.blend * (3 - 2 * carry.blend)
        for (const side of ['Left', 'Right'] as Side[]) {
            const p = at[side]
            if (!p) continue
            // carryHands is at the origin facing +X with the hips at standing height; follow the hips and heading.
            const target = v3.add([hips[0], hips[1] - 0.993, hips[2]], v3.add(v3.scale(f, p[0]), v3.add([0, p[1], 0], v3.scale(l, -p[2]))))
            const now = e.position(side + 'Hand')
            e.arm(side, v3.lerp(now, target, w), v3.add(v3.scale(f, -0.3), [0, -1, 0]))
        }
        this._shown ??= new Float32Array(pose.length)
        this._shown.set(e.pose)
        return this._shown
    }

    private _toG1Direction(direction: Vector3) {
        this.object.updateWorldMatrix(true, false)
        const o = this.object.worldToLocal(tempA.set(0, 0, 0)).clone()
        const d = this.object.worldToLocal(tempB.copy(direction)).sub(o)
        return Math.atan2(-d.z, d.x)
    }

    private _fromG1Direction(angle: number) {
        this.object.updateWorldMatrix(true, false)
        const d = new Vector3(Math.cos(angle), 0, -Math.sin(angle))
        return d.transformDirection(this.object.matrixWorld)
    }

    /**
     * Load one of NVIDIA's Smart Primitives for this model: 'jump_0_5m' (a box), 'jump_0_75m' (a wall), 'avoidance'
     * (a bar to duck under) or 'sit' (a stool); primitive.box.size gives its size. Its clips download from NVIDIA's
     * repository.
     */
    async loadPrimitive(name: string) {
        return loadPrimitive(name, {rig: this.options.rig === 'soma' ? 'soma' : 'g1', sources: this.options.primitives})
    }

    /** The obstacles the robot jumps or vaults over on its way, replacing any set before. */
    setObstacles(obstacles: MotionBricksObstacle[]) {
        this._obstacles = obstacles
        this._syncObstacles()
    }

    private _obstacles: MotionBricksObstacle[] = []

    /** Sit on an obstacle whose primitive is 'sit' (one of setObstacles'), from within about two metres. */
    sit(obstacle: MotionBricksObstacle) {
        const i = this._obstacles.indexOf(obstacle)
        const o = this.controller?.obstacles[i]
        if (i < 0 || !o) return
        this._drive.active = false
        this.controller!.sit(o)
    }

    /** Stand up from the seat. Moving with moveTo or drive also stands up first. */
    standUp() {
        this.controller?.standUp()
    }

    /** The robot is sitting, or sitting down. */
    get seated() {
        return !!this.controller?.seat
    }

    private _syncObstacles() {
        const c = this.controller
        if (!c) return
        this.object.updateWorldMatrix(true, false)
        const turn = this.object.getWorldQuaternion(new Quaternion())
        const objectYaw = Math.atan2(2 * (turn.w * turn.y + turn.x * turn.z), 1 - 2 * (turn.y * turn.y + turn.z * turn.z))
        c.obstacles = this._obstacles.map(o => {
            const [x, y] = this._toG1(o.position)
            // A turn about Y in three.js is the same angle about Z in G1 space.
            return {primitive: o.primitive, x, y, yaw: (o.rotation ?? 0) - objectYaw}
        })
    }

    /** Convert a world point to the character's G1 ground coordinates. */
    private _toG1(point: Vector3): [number, number] {
        this.object.updateWorldMatrix(true, false)
        return G1Robot.ToG1(this.object.worldToLocal(tempA.copy(point)))
    }

    /** Walk or run to a world point and stop there, facing the way it walked. */
    moveTo(point: Vector3, gait: G1Gait = this.gait) {
        this.cancelInteraction()
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
        if (direction && (direction.x !== 0 || direction.z !== 0)) this.cancelInteraction()
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
        // Far enough that the goal stays beyond stopping distance from where the next motion starts (a second or
        // more ahead of the robot), even at a sprint.
        const ahead = c.speedOf(gait) * (2 * c.lead + 0.5) + 3
        const goal: [number, number] = [c.pose[0] + Math.cos(angle) * ahead, c.pose[1] + Math.sin(angle) * ahead]
        const d = this._drive
        const turn = Math.abs(Math.atan2(Math.sin(angle - d.angle), Math.cos(angle - d.angle)))
        // Steering by more than 15 degrees generates at once, as a keyboard needs; smaller changes steer the goal.
        if (!d.active || gait !== d.gait || turn > 0.26) {
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
        if (pose) G1Robot.FromG1(...this._rig.ground(pose), 0, target)
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
        return p ? this._rig.heading(p) : 0
    }

    /** Stop the worker. The robot stays in the scene, and load() starts the model again from where it stands. */
    dispose() {
        if (this.controller) this._lastPose = Float32Array.from(this.controller.pose)
        const raw = this.engine instanceof SharedEngine ? this.engine.engine : this.engine
        if (raw instanceof MotionBricksRemote) raw.worker.terminate()
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
