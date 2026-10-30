// A browser port of the MotionBricks Unitree G1 engine (https://github.com/NVlabs/motionbricks).
// It prepares the ONNX inputs, decodes the output into world space, and applies the same
// endpoint correction as the reference runtime (motionbricks/model/unitree_g1/kernels.py).
// It has no threepipe dependency, so it also runs in Node with onnxruntime-node.

/** A G1 pose: root XYZ, root XYZW quaternion, then 29 joint angles. G1 space is Z up and +X forward. */
export type G1Pose = Float32Array

export const G1_JOINT_NAMES = [
    'left_hip_pitch_joint', 'left_hip_roll_joint', 'left_hip_yaw_joint', 'left_knee_joint', 'left_ankle_pitch_joint', 'left_ankle_roll_joint',
    'right_hip_pitch_joint', 'right_hip_roll_joint', 'right_hip_yaw_joint', 'right_knee_joint', 'right_ankle_pitch_joint', 'right_ankle_roll_joint',
    'waist_yaw_joint', 'waist_roll_joint', 'waist_pitch_joint',
    'left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint',
    'left_wrist_roll_joint', 'left_wrist_pitch_joint', 'left_wrist_yaw_joint',
    'right_shoulder_pitch_joint', 'right_shoulder_roll_joint', 'right_shoulder_yaw_joint', 'right_elbow_joint',
    'right_wrist_roll_joint', 'right_wrist_pitch_joint', 'right_wrist_yaw_joint',
] as const

export const ROOT_SIZE = 7
export const POSE_SIZE = ROOT_SIZE + G1_JOINT_NAMES.length
export const SAMPLE_RATE = 30
export const POSES_PER_TOKEN = 4
export const BOUNDARY_FRAMES = POSES_PER_TOKEN - 1
const MIN_TOKENS = 6
const MAX_TOKENS = 16
const MAX_RAW_FRAMES = MAX_TOKENS * POSES_PER_TOKEN
// Root position filter taps at 30 Hz, from the reference runtime.
const ROOT_POSITION_FILTER = [-0.0465, 0.0639, 0.2827, 0.3998, 0.2827, 0.0639, -0.0465]
const JOINT_ANGLE_FADE_SECONDS = 0.3

export const DEFAULT_TOKEN_COUNTS = [8, 9, 10, 11, 12, 13, 14]

// region quaternion math (XYZW, as in the model)

export type Quat = [number, number, number, number]
export type Vec3 = [number, number, number]

export function qmul(a: ArrayLike<number>, b: ArrayLike<number>): Quat {
    const [ax, ay, az, aw] = [a[0], a[1], a[2], a[3]]
    const [bx, by, bz, bw] = [b[0], b[1], b[2], b[3]]
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

export function qinv(q: ArrayLike<number>): Quat {
    return [-q[0], -q[1], -q[2], q[3]]
}

export function qnorm(q: ArrayLike<number>): Quat {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

export function qrot(q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
    const [x, y, z, w] = [q[0], q[1], q[2], q[3]]
    const tx = 2 * (y * v[2] - z * v[1])
    const ty = 2 * (z * v[0] - x * v[2])
    const tz = 2 * (x * v[1] - y * v[0])
    return [
        v[0] + w * tx + y * tz - z * ty,
        v[1] + w * ty + z * tx - x * tz,
        v[2] + w * tz + x * ty - y * tx,
    ]
}

/** Rotation about +Z (up) by angle radians. */
export function qz(angle: number): Quat {
    return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]
}

/** Slerp from the identity to q by t, along the shortest arc. */
export function qpow(q: ArrayLike<number>, t: number): Quat {
    let [x, y, z, w] = qnorm(q)
    if (w < 0) [x, y, z, w] = [-x, -y, -z, -w]
    const s = Math.hypot(x, y, z)
    if (s < 1e-9) return [0, 0, 0, 1]
    const angle = 2 * Math.atan2(s, w) * t
    const k = Math.sin(angle / 2) / s
    return [x * k, y * k, z * k, Math.cos(angle / 2)]
}

export function qslerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Quat {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    const bs = d < 0 ? -1 : 1
    d *= bs
    if (d > 0.9995) return qnorm([0, 1, 2, 3].map(i => a[i] + (b[i] * bs - a[i]) * t))
    const th = Math.acos(d), s = Math.sin(th)
    const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s * bs
    return [0, 1, 2, 3].map(i => a[i] * wa + b[i] * wb) as Quat
}

/** Ground heading of a root rotation: the angle of its +X axis around +Z. */
export function heading(q: ArrayLike<number>): number {
    const f = qrot(qnorm(q), [1, 0, 0])
    return Math.atan2(f[1], f[0])
}

// endregion

function fadeWeight(v: number) {
    const t = Math.min(Math.max(v, 0), 1)
    const r = 1 - t
    return t < 0.5 ? 1 - 2 * t * t : 2 * r * r
}

/** The ONNX Runtime API this engine uses, from onnxruntime-web or onnxruntime-node. */
export interface OrtApi {
    InferenceSession: {create(model: any, options?: any): Promise<any>}
    Tensor: new (type: string, data: any, dims: number[]) => any
}

export interface GenerateOptions {
    /** Token counts the model may choose, each 6 to 16. Each token is four frames. */
    tokens?: number[]
    /** Match the motion's ends to the last context pose and the first target pose. Default true. */
    correct?: boolean
}

export interface GeneratedMotion {
    /** World space poses at 30 Hz. The first is near the last context pose, the last near the first target pose. */
    poses: G1Pose[]
    /** Left heel, left toe, right heel, right toe contact for each pose, 0 to 1. */
    footContacts: Float32Array[]
    tokenCount: number
    inferenceMs: number
}

/** What G1Controller needs from an engine: MotionBricksG1 here, or MotionBricksRemote in a worker. */
export interface MotionGenerator {
    readonly backend: string
    generate(context: ArrayLike<number>[], target: ArrayLike<number>[], options?: GenerateOptions): Promise<GeneratedMotion>
}

/**
 * Manifest written by tools/pack_lite.py: a graph whose weights stay 8-bit in memory (MatMulNBits and int8
 * convolutions), with its ONNX external data in shards.
 */
export interface LitePackManifest {
    format: 'motionbricks-external'
    graph: string
    /** The external data file name the graph refers to. */
    weights: string
    bytes: number
    shardBytes: number
    shards: string[]
}

/** Manifest written by tools/pack_model.py. */
export interface PackManifest {
    format: 'motionbricks-q8'
    /** File name of the graph, graph.onnx by default. */
    graph?: string
    block: number
    weights: string
    f32Length: number
    q8Length: number
    /** Size of every shard but the last. */
    shardBytes: number
    shards: string[]
    tensors: {name: string, n: number, blocks: number, q: number, s: number, f: number}[]
}

export type ProgressCallback = (loaded: number, total: number) => void

/**
 * Quiet onnxruntime-web's logs, use up to four threads when the page is cross-origin isolated, and give it
 * its .wasm file joined from `wasm` parts, for hosts that limit file size.
 */
export async function setupOrtWeb(ort: any, wasm?: string[]) {
    ort.env.logLevel = 'error'
    ort.env.wasm.numThreads = (globalThis as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
    if (!wasm?.length) return
    const parts = await Promise.all(wasm.map(async u => fetchBytes(u)))
    const binary = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    parts.reduce((offset, p) => (binary.set(p, offset), offset + p.length), 0)
    ort.env.wasm.wasmBinary = binary.buffer
}

/** Download a file, into `target` at `offset` when given, or read it from `cache` and store it there. */
async function fetchBytes(url: string, onBytes?: (n: number) => void, target?: Uint8Array, offset = 0, cache?: PackCache | null): Promise<Uint8Array> {
    const hit = cache ? await cache.match(url) : undefined
    const res = hit ?? await fetch(url)
    if (!res.ok || !res.body) throw new Error(`Could not download ${url}: HTTP ${res.status}`)
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        if (target) target.set(value, offset + size)
        else parts.push(value)
        size += value.length
        onBytes?.(value.length)
    }
    let out: Uint8Array
    if (target) out = target.subarray(offset, offset + size)
    else {
        out = new Uint8Array(size)
        let o = 0
        for (const p of parts) {
            out.set(p, o)
            o += p.length
        }
    }
    if (cache && !hit) cache.store(url, out)
    return out
}

/**
 * A model pack in Cache Storage, so it downloads once per browser rather than on every visit and page. pack.json
 * always comes from the network when it can; when it differs from the cached one, the cached files of that pack
 * are dropped. It is stored last, once every file is in, so a pack cut off halfway is not taken as complete.
 */
class PackCache {
    private _writes: Promise<unknown> = Promise.resolve()

    private constructor(private _cache: Cache, private _base: string) {}

    static async Open(name: string, base: string, manifestText: string) {
        try {
            if (typeof caches === 'undefined') return null
            const cache = await caches.open(name)
            const stored = await cache.match(base + 'pack.json')
            if (stored && await stored.text() !== manifestText) {
                for (const key of await cache.keys()) if (key.url.startsWith(base)) await cache.delete(key)
            }
            return new PackCache(cache, base)
        } catch {
            // No Cache Storage here (an insecure page, a private window, storage turned off): download as before.
            return null
        }
    }

    async match(url: string) {
        return this._cache.match(url).catch(() => undefined)
    }

    /**
     * Store a downloaded file from the buffer it was read into, one at a time, rather than teeing the download:
     * a tee holds whatever the disk has not taken yet, which on a phone can be the whole pack. A full disk only
     * means it downloads again next time.
     */
    store(url: string, bytes: Uint8Array) {
        this._writes = this._writes.then(async() => this._cache.put(url, new Response(bytes as Uint8Array<ArrayBuffer>)).catch(() => undefined))
    }

    /** Wait for the stores, before the weights are handed to the session and can be collected. */
    async flush() {
        return this._writes
    }

    async complete(manifestText: string) {
        await this._writes
        await this._cache.put(this._base + 'pack.json', new Response(manifestText, {headers: [['content-type', 'application/json']]})).catch(() => undefined)
    }
}

/** pack.json from the network, or from the cache when offline. */
async function fetchManifest(base: string, cacheName: string | false) {
    try {
        const res = await fetch(base + 'pack.json', {cache: 'no-cache'})
        if (res.ok) return await res.text()
        throw new Error(`Could not download ${base}pack.json: HTTP ${res.status}`)
    } catch (e) {
        const stored = cacheName && typeof caches !== 'undefined' ? await caches.open(cacheName).then(async c => c.match(base + 'pack.json')).catch(() => undefined) : undefined
        if (stored) return stored.text()
        throw e
    }
}

/** The Cache Storage name model packs are kept under, unless a load says otherwise. */
export const MOTIONBRICKS_CACHE = 'three-motionbricks'

function halfToFloat(h: number) {
    const s = h & 0x8000 ? -1 : 1
    const e = h >> 10 & 0x1f
    const m = h & 0x3ff
    if (e === 0) return s * m * 2 ** -24
    if (e === 31) return m ? NaN : s * Infinity
    return s * (1 + m / 1024) * 2 ** (e - 15)
}

/** Expand int8 blocks with fp16 scales into the fp32 external data the graph expects. */
export function dequantizePack(manifest: PackManifest, q8: Uint8Array): Float32Array {
    const out = new Float32Array(manifest.f32Length)
    const int8 = new Int8Array(q8.buffer, q8.byteOffset, q8.byteLength)
    const view = new DataView(q8.buffer, q8.byteOffset, q8.byteLength)
    const block = manifest.block
    for (const t of manifest.tensors) {
        for (let b = 0; b < t.blocks; b++) {
            const scale = halfToFloat(view.getUint16(t.s + b * 2, true))
            const start = b * block
            const end = Math.min(start + block, t.n)
            for (let i = start; i < end; i++) out[t.f + i] = int8[t.q + i] * scale
        }
    }
    return out
}

export class MotionBricksG1 implements MotionGenerator {
    readonly ort: OrtApi
    readonly session: any
    /** The execution provider the session was created with, such as webgpu or wasm. */
    readonly backend: string
    private _busy = false

    constructor(ort: OrtApi, session: any, backend = 'default') {
        this.ort = ort
        this.session = session
        this.backend = backend
    }

    /**
     * Load a model packed by tools/pack_model.py: a graph, a manifest, and int8 weight shards.
     * @param baseUrl folder that holds pack.json, ending with a slash
     * @param cacheName Cache Storage to keep the pack in, so it downloads once per browser; false to always download
     */
    static async LoadPacked(ort: OrtApi, baseUrl: string, sessionOptions: any = {}, onProgress?: ProgressCallback, cacheName: string | false = MOTIONBRICKS_CACHE) {
        const manifestText = await fetchManifest(baseUrl, cacheName)
        const manifest: PackManifest | LitePackManifest = JSON.parse(manifestText)
        const cache = cacheName ? await PackCache.Open(cacheName, baseUrl, manifestText) : null
        const engine = manifest.format === 'motionbricks-external' ?
            await MotionBricksG1._loadLite(ort, baseUrl, manifest, sessionOptions, onProgress, cache) :
            await MotionBricksG1._loadQ8(ort, baseUrl, manifest, sessionOptions, onProgress, cache)
        await cache?.complete(manifestText)
        return engine
    }

    private static async _loadQ8(ort: OrtApi, baseUrl: string, manifest: PackManifest, sessionOptions: any, onProgress?: ProgressCallback, cache?: PackCache | null) {
        if (manifest.format !== 'motionbricks-q8') throw new Error('Unknown model pack format')
        let loaded = 0
        const total = manifest.q8Length
        const count = (n: number) => {
            loaded += n
            onProgress?.(loaded, total)
        }
        // Shards stream straight into one buffer, so no second copy of the weights is made.
        const q8 = new Uint8Array(manifest.q8Length)
        const [graph] = await Promise.all([
            fetchBytes(baseUrl + (manifest.graph ?? 'graph.onnx'), undefined, undefined, 0, cache),
            ...manifest.shards.map(async(s, i) => fetchBytes(baseUrl + s, count, q8, i * manifest.shardBytes, cache)),
        ])
        await cache?.flush()
        const weights = dequantizePack(manifest, q8)
        return MotionBricksG1._create(ort, graph, {
            ...sessionOptions,
            externalData: [{path: manifest.weights, data: new Uint8Array(weights.buffer)}],
        })
    }

    /** A pack from tools/pack_lite.py: the weights go to the session as they are, with no fp32 copy. */
    private static async _loadLite(ort: OrtApi, baseUrl: string, manifest: LitePackManifest, sessionOptions: any, onProgress?: ProgressCallback, cache?: PackCache | null) {
        let loaded = 0
        const count = (n: number) => onProgress?.(loaded += n, manifest.bytes)
        const data = new Uint8Array(manifest.bytes)
        const [graph] = await Promise.all([
            fetchBytes(baseUrl + manifest.graph, undefined, undefined, 0, cache),
            ...manifest.shards.map(async(s, i) => fetchBytes(baseUrl + s, count, data, i * manifest.shardBytes, cache)),
        ])
        await cache?.flush()
        // No memory arena or patterns: they keep peak buffers around, and memory is why this pack exists.
        return MotionBricksG1._create(ort, graph, {
            enableCpuMemArena: false,
            enableMemPattern: false,
            ...sessionOptions,
            externalData: [{path: manifest.weights, data}],
        })
    }

    /**
     * Load a pack folder from tools/pack_model.py or tools/pack_lite.py (a URL ending in /), or an original .onnx
     * file. Packs are kept in Cache Storage under `cacheName` (false: always download); .onnx files are not.
     */
    static async Load(ort: OrtApi, model: string, sessionOptions: any = {}, onProgress?: ProgressCallback, cacheName: string | false = MOTIONBRICKS_CACHE) {
        return model.endsWith('/') ?
            MotionBricksG1.LoadPacked(ort, model, sessionOptions, onProgress, cacheName) :
            MotionBricksG1.LoadOnnx(ort, model, sessionOptions, onProgress)
    }

    /** Load an original MotionBricks G1 .onnx file, such as mmm_v6_g1_fp32.onnx. */
    static async LoadOnnx(ort: OrtApi, url: string, sessionOptions: any = {}, onProgress?: ProgressCallback) {
        let loaded = 0
        const res = await fetch(url, {method: 'HEAD'}).catch(() => null)
        const total = Number(res?.headers.get('content-length')) || 0
        const bytes = await fetchBytes(url, n => onProgress?.(loaded += n, total))
        return MotionBricksG1._create(ort, bytes, sessionOptions)
    }

    /**
     * Create the session with one execution provider at a time, in the given order, so the backend
     * that runs is known and a WebGPU failure falls back to WebAssembly.
     */
    private static async _create(ort: OrtApi, model: Uint8Array, sessionOptions: any) {
        const providers: string[] = sessionOptions.executionProviders ?? ['wasm']
        for (let i = 0; ; i++) {
            try {
                const session = await ort.InferenceSession.create(model, {...sessionOptions, executionProviders: [providers[i]]})
                return new MotionBricksG1(ort, session, providers[i])
            } catch (e) {
                if (i >= providers.length - 1) throw e
                console.warn(`MotionBricks: ${providers[i]} failed, trying ${providers[i + 1]}`, e)
            }
        }
    }

    get busy() {
        return this._busy
    }

    /**
     * Generate motion from four recent poses toward one to four target poses, all in world space.
     * The model picks the duration from the allowed token counts.
     */
    async generate(context: ArrayLike<number>[], target: ArrayLike<number>[], options: GenerateOptions = {}): Promise<GeneratedMotion> {
        if (context.length !== POSES_PER_TOKEN) throw new Error('Context needs exactly 4 poses')
        if (target.length < 1 || target.length > POSES_PER_TOKEN) throw new Error('Target needs 1 to 4 poses')
        if (this._busy) throw new Error('A generation is already running')
        const tokens = options.tokens ?? DEFAULT_TOKEN_COUNTS
        const numTargets = target.length
        const targets = [0, 1, 2, 3].map(i => target[Math.min(i, numTargets - 1)])

        // Align the ground position and heading of the last context pose to the origin, facing +X.
        const last = context[POSES_PER_TOKEN - 1]
        const ap: Vec3 = [last[0], last[1], 0]
        const aq = qz(heading([last[3], last[4], last[5], last[6]]))
        const aqi = qinv(aq)
        const encode = (poses: ArrayLike<number>[]) => {
            const out = new Float32Array(POSES_PER_TOKEN * POSE_SIZE)
            poses.forEach((p, i) => {
                const o = i * POSE_SIZE
                for (let k = 0; k < POSE_SIZE; k++) out[o + k] = p[k]
                const pos = qrot(aqi, [p[0] - ap[0], p[1] - ap[1], p[2] - ap[2]])
                out[o] = pos[0]
                out[o + 1] = pos[1]
                out.set(qnorm(qmul(aqi, qnorm([p[3], p[4], p[5], p[6]]))), o + 3)
            })
            return out
        }
        const has = new Int32Array(8)
        const hasLocalRoot = new Int32Array(8)
        for (let i = 0; i < 8; i++) {
            has[i] = i < POSES_PER_TOKEN + numTargets ? 1 : 0
            // Root velocity is unknown at the last context pose and the last target pose.
            hasLocalRoot[i] = i === POSES_PER_TOKEN - 1 || i === POSES_PER_TOKEN + numTargets - 1 ? 0 : has[i]
        }
        const allowed = new Int32Array(MAX_TOKENS - MIN_TOKENS + 1)
        for (const t of tokens) allowed[t - MIN_TOKENS] = 1

        const T = this.ort.Tensor
        const feeds = {
            context_qpos: new T('float32', encode(context), [1, 4, POSE_SIZE]),
            target_qpos: new T('float32', encode(targets), [1, 4, POSE_SIZE]),
            has_global_root_values: new T('int32', has, [1, 8]),
            has_local_root_values: new T('int32', hasLocalRoot, [1, 8]),
            has_local_poses: new T('int32', has.slice(), [1, 8]),
            allowed_pred_num_tokens: new T('int32', allowed, [1, allowed.length]),
        }
        this._busy = true
        const t0 = performance.now()
        let results: any
        try {
            results = await this.session.run(feeds)
        } finally {
            this._busy = false
        }
        const inferenceMs = performance.now() - t0
        const predQpos = results.pred_qpos.data as Float32Array
        const predContacts = results.pred_foot_contacts.data as Float32Array
        const tokenCount = Number(results.pred_num_tokens.data[0])
        const rawCount = Math.min(Math.max(tokenCount * POSES_PER_TOKEN, 0), MAX_RAW_FRAMES)
        const frameCount = Math.max(0, rawCount - 2 * BOUNDARY_FRAMES)

        // Decode: drop the boundary frames, smooth the root position, and restore the world placement.
        const poses: G1Pose[] = []
        const footContacts: Float32Array[] = []
        const radius = ROOT_POSITION_FILTER.length >> 1
        for (let f = 0; f < frameCount; f++) {
            const rf = f + BOUNDARY_FRAMES
            const pos: Vec3 = [0, 0, 0]
            ROOT_POSITION_FILTER.forEach((w, tap) => {
                const src = Math.min(Math.max(rf + tap - radius, 0), rawCount - 1) * POSE_SIZE
                for (let k = 0; k < 3; k++) pos[k] += w * predQpos[src + k]
            })
            const o = rf * POSE_SIZE
            const wpos = qrot(aq, pos)
            const pose = new Float32Array(POSE_SIZE)
            pose[0] = wpos[0] + ap[0]
            pose[1] = wpos[1] + ap[1]
            pose[2] = pos[2]
            pose.set(qnorm(qmul(aq, qnorm([predQpos[o + 3], predQpos[o + 4], predQpos[o + 5], predQpos[o + 6]]))), 3)
            pose.set(predQpos.subarray(o + ROOT_SIZE, o + POSE_SIZE), ROOT_SIZE)
            poses.push(pose)
            footContacts.push(Float32Array.from(predContacts.subarray(rf * 4, rf * 4 + 4), c => Math.min(Math.max(c, 0), 1)))
        }
        if (options.correct !== false && frameCount >= 2) correctEndpoints(poses, last, targets[0])
        return {poses, footContacts, tokenCount, inferenceMs}
    }
}

/**
 * Pull the first frame onto the last context pose and the last frame onto the first target pose.
 * Root corrections span the motion. Joint angle corrections fade in and out over 0.3 s.
 */
export function correctEndpoints(poses: G1Pose[], start: ArrayLike<number>, end: ArrayLike<number>) {
    const n = poses.length
    const delta = (p: G1Pose, guide: ArrayLike<number>) => ({
        p: [guide[0] - p[0], guide[1] - p[1], guide[2] - p[2]],
        q: qnorm(qmul(qinv(qnorm([p[3], p[4], p[5], p[6]])), qnorm([guide[3], guide[4], guide[5], guide[6]]))),
        a: Float32Array.from({length: POSE_SIZE - ROOT_SIZE}, (_, i) => guide[ROOT_SIZE + i] - p[ROOT_SIZE + i]),
    })
    const d0 = delta(poses[0], start)
    const d1 = delta(poses[n - 1], end)
    const fadeFrames = Math.min(JOINT_ANGLE_FADE_SECONDS * SAMPLE_RATE, 0.5 * (n - 1))
    for (let f = 0; f < n; f++) {
        const p = poses[f]
        const w = f / (n - 1)
        const sw = 1 - w
        p.set(qnorm(qmul(qmul([p[3], p[4], p[5], p[6]], qpow(d0.q, sw)), qpow(d1.q, w))), 3)
        for (let k = 0; k < 3; k++) p[k] += d0.p[k] * sw + d1.p[k] * w
        const ws = fadeWeight(f / fadeFrames)
        const we = fadeWeight((n - 1 - f) / fadeFrames)
        for (let i = ROOT_SIZE; i < POSE_SIZE; i++) p[i] += d0.a[i - ROOT_SIZE] * ws + d1.a[i - ROOT_SIZE] * we
    }
}

/** Interpolate two poses: positions and joint angles linearly, the root rotation by slerp. */
export function lerpPose(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: G1Pose = new Float32Array(POSE_SIZE)) {
    for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t
    out.set(qslerp([a[3], a[4], a[5], a[6]], [b[3], b[4], b[5], b[6]], t), 3)
    return out
}

/**
 * Place poses authored at the ground origin facing +X at a ground position, turned to a heading.
 * Only the root moves, as in the reference runtime's place_target_dof.
 */
export function placePoses(poses: ArrayLike<number>[], x: number, y: number, angle: number): G1Pose[] {
    const q = qz(angle)
    return poses.map(src => {
        const p = Float32Array.from(src)
        const pos = qrot(q, [src[0], src[1], 0])
        p[0] = pos[0] + x
        p[1] = pos[1] + y
        p.set(qnorm(qmul(q, [src[3], src[4], src[5], src[6]])), 3)
        return p
    })
}

/** Scale the ground travel of target poses at 30 Hz to a mean speed in m/s. */
export function withSpeed(poses: ArrayLike<number>[], speed: number): G1Pose[] {
    const first = poses[0], last = poses[poses.length - 1]
    const current = Math.hypot(last[0] - first[0], last[1] - first[1]) * SAMPLE_RATE / (poses.length - 1)
    const s = current > 1e-3 ? speed / current : 1
    return poses.map(src => {
        const p = Float32Array.from(src)
        p[0] = first[0] + (src[0] - first[0]) * s
        p[1] = first[1] + (src[1] - first[1]) * s
        return p
    })
}
