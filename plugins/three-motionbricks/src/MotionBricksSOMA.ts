// MotionBricks for the SOMA human skeleton: NVIDIA's SOMA model behind the same generate() call as the G1 engine.
// A pose holds, for each of the 77 joints of SOMA_SKELETON, its local position xyz and quaternion xyzw (Hips first,
// in SOMA model space: Y up, metres). Encoding, decoding and the endpoint correction follow NVIDIA's
// motionbricks/model/soma/kernels.py.

import {GenerateOptions, GeneratedMotion, MotionBricksG1, OrtApi, ProgressCallback} from './MotionBricksG1'
import {SOMA_SKELETON} from './SOMASkeleton'

export type SOMAPose = Float32Array

/** The model's 30 joints, in its order. The rest of the skeleton (fingers) keeps its reference pose. */
export const SOMA_MODEL_JOINTS = [
    'Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'Jaw', 'LeftEye', 'RightEye',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandThumbEnd', 'LeftHandMiddleEnd',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandThumbEnd', 'RightHandMiddleEnd',
    'LeftLeg', 'LeftShin', 'LeftFoot', 'LeftToeBase', 'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase',
] as const

const FPS = 30, PPT = 4, BOUNDARY = 3, MIN_TOKENS = 6, MAX_TOKENS = 16
const MODEL_J = SOMA_MODEL_JOINTS.length
const DEFAULT_TOKENS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

type V3 = [number, number, number]
type Q = [number, number, number, number]

// ---- transform math on 7-float transforms [px, py, pz, qx, qy, qz, qw] ----
function qmul(a: ArrayLike<number>, b: ArrayLike<number>, ao = 0, bo = 0): Q {
    const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3], bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3]
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]
}
function qrot(q: ArrayLike<number>, v: ArrayLike<number>, qo = 0): V3 {
    const x = q[qo], y = q[qo + 1], z = q[qo + 2], w = q[qo + 3]
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
function qnorm(q: Q): Q {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
const qinv = (q: ArrayLike<number>, o = 0): Q => [-q[o], -q[o + 1], -q[o + 2], q[o + 3]]
/** a * b for transforms stored at offsets; writes into out at oo. */
function tmulInto(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, out: Float32Array | number[], oo: number) {
    const p = qrot(a, [b[bo], b[bo + 1], b[bo + 2]], ao + 3)
    const q = qnorm(qmul(a, b, ao + 3, bo + 3))
    out[oo] = p[0] + a[ao]
    out[oo + 1] = p[1] + a[ao + 1]
    out[oo + 2] = p[2] + a[ao + 2]
    out[oo + 3] = q[0]
    out[oo + 4] = q[1]
    out[oo + 5] = q[2]
    out[oo + 6] = q[3]
}
function tinv(t: ArrayLike<number>, o = 0): number[] {
    const q = qinv(t, o + 3), p = qrot(q, [t[o], t[o + 1], t[o + 2]])
    return [-p[0], -p[1], -p[2], ...q]
}
/** Identity to q by t, the short way. */
function slerpIdentity(q: ArrayLike<number>, t: number, o = 0): Q {
    let x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3]
    if (w < 0) [x, y, z, w] = [-x, -y, -z, -w]
    const s = Math.hypot(x, y, z)
    if (s < 1e-9) return [0, 0, 0, 1]
    const angle = 2 * Math.atan2(s, w) * t, k = Math.sin(angle / 2) / s
    return [x * k, y * k, z * k, Math.cos(angle / 2)]
}
/** A rotation from its first two matrix columns, as NVIDIA's _rotation_from_6d. */
function rotationFrom6d(f: ArrayLike<number>, o: number): Q {
    let xl = Math.hypot(f[o], f[o + 1], f[o + 2]) || 1
    const x: V3 = [f[o] / xl, f[o + 1] / xl, f[o + 2] / xl], yr: V3 = [f[o + 3], f[o + 4], f[o + 5]]
    let z: V3 = [x[1] * yr[2] - x[2] * yr[1], x[2] * yr[0] - x[0] * yr[2], x[0] * yr[1] - x[1] * yr[0]]
    xl = Math.hypot(...z) || 1
    z = [z[0] / xl, z[1] / xl, z[2] / xl]
    const y: V3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    // Matrix with columns x, y, z to a quaternion.
    const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2]
    const tr = m00 + m11 + m22
    let q: Q
    if (tr > 0) {
        const s = 0.5 / Math.sqrt(tr + 1)
        q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
    } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
        q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
    } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
        q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
    } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
        q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
    }
    return qnorm(q)
}

/** The heading of a pose from its hip joints, as in training: an angle around Y, 0 facing +Z. */
function headingFromHips(right: ArrayLike<number>, left: ArrayLike<number>, ro = 0, lo = 0) {
    let ax = right[ro] - left[lo], az = right[ro + 2] - left[lo + 2]
    const l = Math.hypot(ax, az)
    if (l <= 1e-6) return 0
    ax /= l
    az /= l
    // forward = up x across
    return Math.atan2(az, -ax)
}

/** The runtime skeleton with lookups the engine and its users need. */
export class SOMASkeletonInfo {
    readonly names = SOMA_SKELETON.names
    readonly parents = SOMA_SKELETON.parents
    readonly J = SOMA_SKELETON.names.length
    readonly reference: Float32Array
    readonly modelToPose: number[]
    readonly poseToModel: Int32Array
    readonly rightLeg: number
    readonly leftLeg: number

    constructor() {
        this.reference = Float32Array.from(SOMA_SKELETON.reference.flat())
        this.modelToPose = SOMA_MODEL_JOINTS.map(n => this.names.indexOf(n))
        this.poseToModel = new Int32Array(this.J).fill(-1)
        this.modelToPose.forEach((p, m) => {
            const parent = this.parents[p]
            if (parent === -1 || this.poseToModel[parent] >= 0) this.poseToModel[p] = m
        })
        this.rightLeg = this.names.indexOf('RightLeg')
        this.leftLeg = this.names.indexOf('LeftLeg')
    }

    index(name: string) {
        return this.names.indexOf(name)
    }

    /** A pose in the reference (bind) pose. */
    referencePose(): SOMAPose {
        return Float32Array.from(this.reference)
    }

    /** World transforms of a pose, J * 7. */
    world(pose: ArrayLike<number>, out = new Float32Array(this.J * 7)) {
        for (let j = 0; j < this.J; j++) {
            const p = this.parents[j]
            if (p < 0) for (let k = 0; k < 7; k++) out[j * 7 + k] = pose[j * 7 + k]
            else tmulInto(out, p * 7, pose, j * 7, out, j * 7)
        }
        return out
    }

    /** The pose's heading from its hips: an angle around Y, 0 facing +Z. */
    heading(pose: ArrayLike<number>) {
        const w = this.world(pose)
        return headingFromHips(w, w, this.rightLeg * 7, this.leftLeg * 7)
    }
}

export const SOMA_SKELETON_INFO = new SOMASkeletonInfo()

/**
 * The SOMA model's engine. Load it with MotionBricksSOMA.Load (a pack folder from tools/pack_model.py or
 * pack_lite.py, or the original mmm_v6_soma_fp32.onnx), as MotionBricksG1.Load.
 */
export class MotionBricksSOMA extends MotionBricksG1 {
    readonly skeleton = SOMA_SKELETON_INFO

    static override async Load(ort: OrtApi, model: string, sessionOptions: any = {}, onProgress?: ProgressCallback, cacheName?: string | false) {
        return super.Load(ort, model, sessionOptions, onProgress, cacheName) as Promise<MotionBricksSOMA>
    }

    override async generate(context: ArrayLike<number>[], target: ArrayLike<number>[], options: GenerateOptions = {}): Promise<GeneratedMotion> {
        if (context.length !== PPT) throw new Error('Context needs exactly 4 poses')
        if (target.length < 1 || target.length > PPT) throw new Error('Target needs 1 to 4 poses')
        if ((this as any)._busy) throw new Error('A generation is already running')
        const k = this.skeleton, J = k.J
        const nt = target.length
        const guide = [...context, ...[0, 1, 2, 3].map(i => target[Math.min(i, nt - 1)])]
        const W = guide.map(p => k.world(p))

        // Turn the last context pose to face +X about its hips, keeping its height.
        const last = W[PPT - 1]
        const current = headingFromHips(last, last, k.rightLeg * 7, k.leftLeg * 7)
        const desired = Math.atan2(1, 0)
        const half = (current - desired) / 2
        const align = [last[0], 0, last[2], 0, Math.sin(half), 0, Math.cos(half)]
        const alignInv = tinv(align)
        const A = W.map(w => {
            const out = new Float32Array(J * 7)
            for (let j = 0; j < J; j++) tmulInto(alignInv, 0, w, j * 7, out, j * 7)
            return out
        })

        const T = this.ort.Tensor
        const g = new Float32Array(8 * 5), l = new Float32Array(8 * 4), lp = new Float32Array(8 * 267)
        for (let f = 0; f < 8; f++) {
            const nf = f === PPT - 1 ? f : Math.min(f + 1, 7)
            const a = A[f], b = A[nf]
            const hc = headingFromHips(a, a, k.rightLeg * 7, k.leftLeg * 7), hn = headingFromHips(b, b, k.rightLeg * 7, k.leftLeg * 7)
            const dh = Math.atan2(Math.sin(hn - hc), Math.cos(hn - hc))
            g.set([a[0], a[1], a[2], Math.cos(hc), Math.sin(hc)], f * 5)
            l.set([dh * FPS, (b[0] - a[0]) * FPS, (b[2] - a[2]) * FPS, a[1]], f * 4)
            const o = f * 267
            for (let m = 0; m < MODEL_J; m++) {
                const p = k.modelToPose[m] * 7
                if (m > 0) lp.set([a[p] - a[0], a[p + 1], a[p + 2] - a[2]], o + (m - 1) * 3)
                const x = qrot(a, [1, 0, 0], p + 3), y = qrot(a, [0, 1, 0], p + 3)
                lp.set([...x, ...y], o + (MODEL_J - 1) * 3 + m * 6)
            }
        }
        const has = new Int32Array(8), hasLocalRoot = new Int32Array(8)
        for (let i = 0; i < 8; i++) {
            has[i] = i < PPT + nt ? 1 : 0
            hasLocalRoot[i] = i === PPT - 1 || i === PPT + nt - 1 ? 0 : has[i]
        }
        const allowed = new Int32Array(MAX_TOKENS - MIN_TOKENS + 1)
        for (const t of options.tokens ?? DEFAULT_TOKENS) allowed[t - MIN_TOKENS] = 1
        const feeds = {
            global_root_values: new T('float32', g, [1, 8, 5]),
            has_global_root_values: new T('int32', has, [1, 8]),
            local_root_values: new T('float32', l, [1, 8, 4]),
            has_local_root_values: new T('int32', hasLocalRoot, [1, 8]),
            local_poses: new T('float32', lp, [1, 8, 267]),
            has_local_poses: new T('int32', has.slice(), [1, 8]),
            allowed_pred_num_tokens: new T('int32', allowed, [1, allowed.length]),
        }
        ;(this as any)._busy = true
        const t0 = performance.now()
        let results: any
        try {
            results = await this.session.run(feeds)
        } finally {
            (this as any)._busy = false
        }
        const inferenceMs = performance.now() - t0

        // Decode: drop the boundary frames; joints take their rotation relative to their parent's, and their
        // reference offset; joints outside the model keep their reference transform.
        const pred = results.pred_global_motions.data as Float32Array
        const F = results.pred_global_motions.dims[2] as number
        const tokenCount = Number(results.pred_num_tokens.data[0])
        const raw = Math.min(Math.max(tokenCount * PPT, 0), results.pred_global_motions.dims[1])
        const n = Math.max(0, raw - 2 * BOUNDARY)
        const ro = 5 + (MODEL_J - 1) * 3
        const poses: SOMAPose[] = [], footContacts: Float32Array[] = []
        const G: Q[] = new Array(MODEL_J)
        for (let f = 0; f < n; f++) {
            const base = (BOUNDARY + f) * F
            footContacts.push(Float32Array.from(pred.subarray(base + F - 4, base + F), c => Math.min(Math.max(c, 0), 1)))
            for (let m = 0; m < MODEL_J; m++) G[m] = rotationFrom6d(pred, base + ro + m * 6)
            const pose = new Float32Array(J * 7)
            tmulInto(align, 0, [pred[base], pred[base + 1], pred[base + 2], ...G[0]], 0, pose, 0)
            for (let j = 1; j < J; j++) {
                const m = k.poseToModel[j]
                if (m < 0) {
                    pose.set(k.reference.subarray(j * 7, j * 7 + 7), j * 7)
                    continue
                }
                const pm = k.poseToModel[k.parents[j]]
                pose.set(k.reference.subarray(j * 7, j * 7 + 3), j * 7)
                pose.set(qnorm(qmul(qinv(G[pm]), G[m])), j * 7 + 3)
            }
            poses.push(pose)
        }
        if (options.correct !== false && n >= 2) correctEndpoints(poses, context[PPT - 1], target[0], J)
        return {poses, footContacts, tokenCount, inferenceMs}
    }
}

/** Move the first frame onto the last context pose and the last onto the first target, fading linearly between. */
function correctEndpoints(poses: SOMAPose[], from: ArrayLike<number>, to: ArrayLike<number>, jointCount: number) {
    const J = jointCount
    const n = poses.length, lastFrame = poses[n - 1]
    const start = new Float32Array(J * 7), end = new Float32Array(J * 7)
    for (const [delta, gen, guide] of [[start, poses[0], from], [end, lastFrame, to]] as const) {
        // The root moves in world space: a position offset, and a rotation after the generated one.
        const r = qnorm(qmul(qinv(qnorm([gen[3], gen[4], gen[5], gen[6]])), qnorm([guide[3], guide[4], guide[5], guide[6]])))
        delta.set([guide[0] - gen[0], guide[1] - gen[1], guide[2] - gen[2], ...r], 0)
        for (let j = 1; j < J; j++) tmulInto(tinv(gen, j * 7), 0, guide, j * 7, delta, j * 7)
    }
    const tmp = new Float32Array(7), w = new Float32Array(7)
    for (let f = 0; f < n; f++) {
        const we = f / (n - 1), ws = 1 - we, pose = poses[f]
        const q = qnorm(qmul(qmul(pose, slerpIdentity(start, ws, 3), 3, 0), slerpIdentity(end, we, 3)))
        pose.set([pose[0] + start[0] * ws + end[0] * we, pose[1] + start[1] * ws + end[1] * we, pose[2] + start[2] * ws + end[2] * we, ...q], 0)
        for (let j = 1; j < J; j++) {
            for (const [delta, weight] of [[start, ws], [end, we]] as const) {
                const o = j * 7
                w.set([delta[o] * weight, delta[o + 1] * weight, delta[o + 2] * weight, ...slerpIdentity(delta, weight, o + 3)])
                tmulInto(pose, o, w, 0, tmp, 0)
                pose.set(tmp, o)
            }
        }
    }
}

/**
 * Read a BVH clip onto the SOMA skeleton at 30 Hz: joints by name, centimetres to metres, Euler angles in each
 * joint's channel order; a joint without position channels keeps the file's offset, and one missing from the file
 * keeps its reference transform. NVIDIA's sample clips are BVH (120 Hz). `rate` is the output rate (default 30).
 */
export function parseSOMABvh(text: string, skeleton = SOMA_SKELETON_INFO, rate = FPS): SOMAPose[] {
    const [head, motion] = text.split(/\bMOTION\b/)
    const names: string[] = [], channels: string[][] = [], offsets: V3[] = [], stack: number[] = []
    let inEnd = false
    for (const line of head.split('\n')) {
        const t = line.trim().split(/\s+/)
        if (t[0] === 'ROOT' || t[0] === 'JOINT') {
            names.push(t[1].split(':').pop()!)
            channels.push([])
            offsets.push([0, 0, 0])
            stack.push(names.length - 1)
        } else if (t[0] === 'End' && t[1] === 'Site') inEnd = true
        else if (t[0] === 'OFFSET' && !inEnd) offsets[stack[stack.length - 1]] = [+t[1] * 0.01, +t[2] * 0.01, +t[3] * 0.01]
        else if (t[0] === 'CHANNELS') channels[stack[stack.length - 1]] = t.slice(2)
        else if (t[0] === '}') {
            if (inEnd) inEnd = false
            else stack.pop()
        }
    }
    const lines = motion.trim().split('\n')
    const frameTime = parseFloat(lines[1].split(':')[1])
    const step = Math.max(1, Math.round(1 / frameTime / rate))
    const rows = lines.slice(2)
    const out: SOMAPose[] = []
    const d = Math.PI / 180
    for (let r = 0; r < rows.length; r += step) {
        const v = rows[r].trim().split(/\s+/).map(Number)
        const pose = skeleton.referencePose()
        let col = 0
        names.forEach((name, j) => {
            const pi = skeleton.index(name)
            let pos: V3 | null = null
            let q: Q = [0, 0, 0, 1]
            for (const c of channels[j]) {
                const lc = c.toLowerCase(), axis = 'xyz'.indexOf(lc[0])
                if (lc.endsWith('position')) {
                    pos ??= [0, 0, 0]
                    pos[axis] = v[col] * 0.01
                } else {
                    const h = v[col] * d / 2, aq: Q = [0, 0, 0, Math.cos(h)]
                    aq[axis] = Math.sin(h)
                    q = qmul(q, aq)
                }
                col++
            }
            if (pi < 0) return
            pose.set(pos ?? offsets[j], pi * 7)
            pose.set(qnorm(q), pi * 7 + 3)
        })
        out.push(pose)
    }
    return out
}
