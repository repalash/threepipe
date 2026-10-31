import {Group, Object3D, Quaternion, Vector3} from 'three'
import {G1Robot} from './G1Robot'
import {CHARACTER_RIGS, CharacterRig, RetargetedCharacter} from './RetargetedCharacter'
import {G1Bricks, G1Controller, G1ControllerStats, G1Gait} from './G1Controller'
import {G1_BRICKS} from './G1Bricks'
import {SOMA_BRICKS} from './SOMABricks'
import {MotionBricksSOMA} from './MotionBricksSOMA'
import {SOMAMannequin} from './SOMAMannequin'
import {G1_RIG, SOMA_RIG} from './PoseRig'
import {MOTIONBRICKS_CACHE, MotionBricksG1, MotionGenerator, OrtApi, setupOrtWeb} from './MotionBricksG1'
import {MotionBricksRemote, MotionBricksWorkerError} from './MotionBricksRemote'
import {G1_PRIMITIVE_SOURCES, G1Primitive, loadPrimitive} from './G1Primitives'

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
        this.engine = engine
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
        return this
    }

    /** Advance the motion by dt seconds and pose the robot. Call it every frame. */
    update(dt: number) {
        const c = this.controller
        if (!c) return
        c.update(Math.min(dt, 0.1))
        this.robot?.setPose(c.pose)
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
