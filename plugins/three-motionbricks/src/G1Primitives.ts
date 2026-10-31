// NVIDIA's Smart Primitives for the G1: jumps, vaults, sitting and ducking, as target pose sequences around an
// obstacle. A primitive is read from NVIDIA's MotionBricks repository at runtime: its document, and the frames of
// the sample clips its target poses are taken from. The clips are under NVIDIA's Sample Data Evaluation License,
// so this package ships none of them; like the model, they download from NVIDIA.
// Placement and pivot alignment follow motionbricks/runtime/smart_primitive.py and pivot.py.

import {G1Pose, POSE_SIZE, POSES_PER_TOKEN, SAMPLE_RATE} from './MotionBricksG1'
import {parseSOMABvh, SOMA_SKELETON_INFO} from './MotionBricksSOMA'
import {SOMA_RIG} from './PoseRig'

type Vec3 = [number, number, number]
type Quat = [number, number, number, number]
interface Xform {p: Vec3, q: Quat}

const NVIDIA_REPO = 'https://raw.githubusercontent.com/NVlabs/motionbricks/main/assets/'
const NVIDIA_LFS = 'https://media.githubusercontent.com/media/NVlabs/motionbricks/main/assets/'

/** Where Smart Primitive documents and their clips load from: NVIDIA's MotionBricks repository on GitHub. */
export const G1_PRIMITIVE_SOURCES = {
    documents: NVIDIA_REPO + 'smart_primitives/unitree_g1/',
    /** Clips are in Git LFS, so they come from GitHub's media host; documents name them relative to this folder. */
    clips: NVIDIA_LFS + 'smart_primitives/unitree_g1/',
}

/** The same for the SOMA (human) model's primitives, whose clips are BVH. */
export const SOMA_PRIMITIVE_SOURCES = {
    documents: NVIDIA_REPO + 'smart_primitives/soma/',
    clips: NVIDIA_LFS + 'smart_primitives/soma/',
}

export type PrimitiveRig = 'g1' | 'soma'

export interface G1PrimitiveStep {
    name: string
    /** Four poses in the pivot's space. */
    window: G1Pose[]
    /** Frames before the end of this step's motion where the next step takes over. */
    transitionEarly: number
    /** Allowed token counts for the generation toward this step. */
    tokens: number[]
}

export interface G1PrimitivePivot {
    /** The pivot's authored transform in the primitive's space. */
    transform: Xform
    /** Direction of travel through the primitive, in the pivot's space. */
    motion: Vec3
    translationAxis: Vec3 | null
    lineMin: number
    lineMax: number
    rotationAxis: Vec3 | null
    /** Half angle of the allowed turn in radians, or Infinity when unconstrained. */
    coneHalfAngle: number
    coneCenters: number[]
    rotationFirst: boolean
}

export interface G1PrimitiveSequence {
    name: string
    /** Speed of the first target, m/s: a sequence is picked by how close this is to the robot's speed. */
    startSpeed: number
    steps: G1PrimitiveStep[]
    /** The pivot the steps are placed by: the sequence's own, or the nearest one above its targets. */
    pivot: G1PrimitivePivot
    /** Node id of that pivot, or -1. */
    pivotId: number
    /** Whether the sequence turns its pivot to the approach (its own pivot), or keeps its last placement. */
    aligns: boolean
}

export interface G1Primitive {
    name: string
    /** The model whose poses the targets are: 'g1' or 'soma'. */
    rig: PrimitiveRig
    /**
     * 'pass' for primitives the robot goes through on its way (jumps, vaults, ducking), which start by themselves;
     * 'sit' for one with Sit and Stand sequences, which start on request (G1Controller.sit).
     */
    kind: 'pass' | 'sit'
    /** The interaction box, in the primitive's space: centre and width (x), depth (y), height (z). */
    box: {center: Vec3, size: Vec3}
    sequences: G1PrimitiveSequence[]
}

// ---- small transform math (Z up, quaternions xyzw) ----
function qmul(a: Quat, b: Quat): Quat {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}
function qnorm(q: Quat): Quat {
    const l = Math.hypot(...q) || 1
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
function qrot(q: Quat, v: Vec3): Vec3 {
    const [x, y, z, w] = q
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
const qinv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]
const qaxis = (axis: Vec3, angle: number): Quat => [axis[0] * Math.sin(angle / 2), axis[1] * Math.sin(angle / 2), axis[2] * Math.sin(angle / 2), Math.cos(angle / 2)]
const tmul = (a: Xform, b: Xform): Xform => {
    const r = qrot(a.q, b.p)
    return {p: [r[0] + a.p[0], r[1] + a.p[1], r[2] + a.p[2]], q: qnorm(qmul(a.q, b.q))}
}
const tinv = (a: Xform): Xform => {
    const q = qinv(a.q), p = qrot(q, a.p)
    return {p: [-p[0], -p[1], -p[2]], q}
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const AXES: Record<string, Vec3> = {x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1]}

/** Move a pose's root by a transform; joint angles stay. */
function placePose(t: Xform, pose: ArrayLike<number>): G1Pose {
    const out = Float32Array.from(pose)
    const root = tmul(t, {p: [pose[0], pose[1], pose[2]], q: [pose[3], pose[4], pose[5], pose[6]]})
    out.set(root.p, 0)
    out.set(root.q, 3)
    return out
}

// ---- clips ----
const clipCache = new Map<string, Promise<Float32Array[]>>()

/**
 * A clip at 120 Hz: a G1 CSV (centimetres, XYZ Euler degrees and joint degrees) as G1 poses in metres and radians,
 * or a SOMA BVH as SOMA poses.
 */
async function loadClip(url: string, rig: PrimitiveRig = 'g1') {
    let clip = clipCache.get(url)
    if (!clip) {
        clip = fetch(url).then(async r => {
            if (!r.ok) throw new Error(`Could not download ${url}: HTTP ${r.status}`)
            if (rig === 'soma') return parseSOMABvh(await r.text(), SOMA_SKELETON_INFO, 120)
            const rows = (await r.text()).trim().split('\n').slice(1)
            return rows.map(row => {
                const v = row.split(',').map(Number)
                const p = new Float32Array(POSE_SIZE)
                p[0] = v[1] * 0.01
                p[1] = v[2] * 0.01
                p[2] = v[3] * 0.01
                // Extrinsic XYZ: rotate about X, then Y, then Z.
                const d = Math.PI / 180
                p.set(qnorm(qmul(qaxis([0, 0, 1], v[6] * d), qmul(qaxis([0, 1, 0], v[5] * d), qaxis([1, 0, 0], v[4] * d)))), 3)
                for (let j = 7; j < POSE_SIZE; j++) p[j] = v[j] * d
                return p
            })
        })
        clipCache.set(url, clip)
    }
    return clip
}

function sampleClip(frames: Float32Array[], seconds: number, rig: PrimitiveRig = 'g1'): G1Pose {
    const f = Math.min(Math.max(seconds * 120, 0), frames.length - 1)
    const i = Math.min(Math.floor(f), frames.length - 2), t = f - i
    if (rig === 'soma') return SOMA_RIG.lerp(frames[i], frames[i + 1], t, new Float32Array(frames[i].length))
    const a = frames[i], b = frames[i + 1], out = new Float32Array(POSE_SIZE)
    for (let k = 0; k < POSE_SIZE; k++) out[k] = a[k] * (1 - t) + b[k] * t
    let qa: Quat = [a[3], a[4], a[5], a[6]], qb: Quat = [b[3], b[4], b[5], b[6]]
    if (dot([qa[0], qa[1], qa[2]], [qb[0], qb[1], qb[2]]) + qa[3] * qb[3] < 0) qb = qb.map(v => -v) as Quat
    qa = qnorm([0, 1, 2, 3].map(k => qa[k] * (1 - t) + qb[k] * t) as Quat)
    out.set(qa, 3)
    return out
}

// ---- documents ----
interface DocNode {
    id: number
    name: string
    local_transform: {translation: Vec3, rotation_xyzw: Quat}
    components: any[]
    children?: DocNode[]
}

// SOMA poses are Y up and the primitives' space is Z up: NVIDIA's runtime turns clip roots by +90 degrees about X
// (its MuJoCo convention), which maps SOMA ground (x, z) to (x, -z), the controller's ground too.
const Y_TO_Z: Xform = {p: [0, 0, 0], q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2]}
const Z_TO_Y: Xform = {p: [0, 0, 0], q: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]}

/** One of NVIDIA's G1 Smart Primitives, such as 'jump_0_5m', 'jump_0_75m', 'sit' or 'avoidance'. */
export async function loadG1Primitive(name: string, sources = G1_PRIMITIVE_SOURCES): Promise<G1Primitive> {
    return loadPrimitive(name, {rig: 'g1', sources})
}

/**
 * Load one of NVIDIA's Smart Primitives for the G1 or SOMA, such as 'jump_0_5m', 'jump_0_75m', 'sit' or
 * 'avoidance', with the clip frames its targets use.
 */
export async function loadPrimitive(name: string, {rig = 'g1', sources}: {rig?: PrimitiveRig, sources?: typeof G1_PRIMITIVE_SOURCES} = {}): Promise<G1Primitive> {
    sources ??= rig === 'soma' ? SOMA_PRIMITIVE_SOURCES : G1_PRIMITIVE_SOURCES
    const res = await fetch(sources.documents + name + '.smart_primitive.json')
    if (!res.ok) throw new Error(`Could not download the ${name} Smart Primitive: HTTP ${res.status}`)
    const doc = await res.json()
    const nodes = new Map<number, {node: DocNode, world: Xform, parent: number}>()
    const walk = (node: DocNode, parentWorld: Xform, parent: number) => {
        const world = tmul(parentWorld, {p: node.local_transform.translation, q: node.local_transform.rotation_xyzw})
        nodes.set(node.id, {node, world, parent})
        for (const child of node.children ?? []) walk(child, world, node.id)
    }
    walk(doc.root, {p: [0, 0, 0], q: [0, 0, 0, 1]}, -1)
    let box: G1Primitive['box'] | null = null
    for (const {node, world} of nodes.values()) {
        const c = node.components.find(x => x.type === 'interaction_box')
        if (c && !box) box = {center: world.p, size: [c.width, c.depth, c.height]}
    }
    if (!box) throw new Error(`The ${name} Smart Primitive has no interaction box`)
    const pivotAbove = (id: number) => {
        for (let n = nodes.get(id); n; n = nodes.get(n.parent)) if (n.node.components.some(x => x.type === 'pivot')) return n.node.id
        return -1
    }
    const sequences = await Promise.all(doc.sequences.map(async(s: any): Promise<G1PrimitiveSequence> => {
        const own = nodes.has(s.pivot_node_id) ? s.pivot_node_id as number : -1
        const pivotId = own >= 0 ? own : pivotAbove(s.node_ids[0])
        const pivotNode = nodes.get(pivotId)
        const pc = pivotNode?.node.components.find(x => x.type === 'pivot')
        const pivot: G1PrimitivePivot = pc && pivotNode ? {
            transform: pivotNode.world,
            motion: pc.motion_direction,
            translationAxis: pc.translation_constraint === 'line_projection' ? AXES[pc.translation_axis] ?? null : null,
            lineMin: pc.line_min_offset,
            lineMax: pc.line_max_offset,
            rotationAxis: AXES[pc.rotation_axis] ?? null,
            coneHalfAngle: pc.rotation_constraint === 'cone' ? pc.cone_half_angle_degrees * Math.PI / 180 : Infinity,
            coneCenters: pc.cone_side === 'both' ? [0, Math.PI] : pc.cone_side === 'mirrored' ? [Math.PI] : [0],
            rotationFirst: pc.operation_order === 'rotation_then_translation',
        } : {
            transform: {p: [0, 0, 0], q: [0, 0, 0, 1]}, motion: [0, 1, 0], translationAxis: null, lineMin: 0, lineMax: 0,
            rotationAxis: null, coneHalfAngle: Infinity, coneCenters: [0], rotationFirst: true,
        }
        const toPivot = tinv(pivot.transform)
        const steps = await Promise.all(s.node_ids.map(async(id: number): Promise<G1PrimitiveStep> => {
            const {node, world} = nodes.get(id)!
            const c = node.components.find(x => x.type === 'target_pose')
            const frames = await loadClip(new URL(c.clip, sources!.clips).href, rig)
            const start = c.playback_mode === 'frames' ? c.frame_index / 120 : c.sample_time_seconds
            const count = Math.min(Math.max(c.num_poses_to_use ?? POSES_PER_TOKEN, 1), POSES_PER_TOKEN)
            const toLocal = tmul(toPivot, world)
            // A SOMA clip's root turns into the primitive's Z up space first; placing turns it back (placeSequence).
            const place = rig === 'soma' ? tmul(toLocal, Y_TO_Z) : toLocal
            const window = Array.from({length: count}, (_, k) => placePose(place, sampleClip(frames, start + k / SAMPLE_RATE, rig)))
            const tokens: number[] = []
            for (let t = c.min_tokens ?? 6; t <= (c.max_tokens ?? 14); t++) tokens.push(t)
            return {name: node.name, window, transitionEarly: c.transition_early_by_frames ?? 8, tokens}
        }))
        const w = steps[0].window
        const startSpeed = w.length > 1 ? Math.hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]) * SAMPLE_RATE : 0
        return {name: s.name, startSpeed, steps, pivot, pivotId, aligns: own >= 0}
    }))
    const names = sequences.map(q => q.name)
    return {name, rig, kind: names.includes('Sit') && names.includes('Stand') ? 'sit' : 'pass', box, sequences}
}

// ---- placing a primitive at an obstacle ----

/** An obstacle in G1 ground space: where its interaction box sits, and the yaw of the primitive's frame. */
export interface G1Obstacle {
    primitive: G1Primitive
    x: number
    y: number
    yaw: number
    /** Where each pivot was last aligned, so a following sequence (standing up after sitting) keeps it. */
    pivots?: Map<number, Xform>
}

const PROBE = {near: 0.15, minDepth: 0.75, lookahead: 1.0, extraMinSpeed: 2.3, extraTime: 0.25, width: 1.0}

/** The near and far ends of the probe ahead of a robot at `p` moving along unit `d` at `speed`. */
export function probeSegment(p: Vec3, d: Vec3, speed: number): [Vec3, Vec3] {
    const reach = speed * PROBE.lookahead + Math.max(0, speed - PROBE.extraMinSpeed) * PROBE.extraTime
    return [addScaled(p, d, PROBE.near), addScaled(p, d, Math.max(PROBE.near + PROBE.minDepth, reach))]
}

/** The obstacle's primitive frame in G1 space: its box centre on the obstacle, turned by its yaw. */
export function obstacleFrame(o: G1Obstacle): Xform {
    const c = o.primitive.box.center
    return tmul({p: [o.x, o.y, 0], q: qaxis([0, 0, 1], o.yaw)}, {p: [-c[0], -c[1], 0], q: [0, 0, 0, 1]})
}

function closestPointOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
    const s = sub(b, a), t = dot(sub(p, a), s) / (dot(s, s) + 1e-6)
    return addScaled(a, s, Math.min(Math.max(t, 0), 1))
}

function closestPointToSegment(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 {
    const ab = sub(b, a), cd = sub(d, c)
    const h = Math.hypot(...ab) / 2, oh = Math.hypot(...cd) / 2
    const u: Vec3 = h > 0 ? [ab[0] / (2 * h), ab[1] / (2 * h), ab[2] / (2 * h)] : ab
    const v: Vec3 = oh > 0 ? [cd[0] / (2 * oh), cd[1] / (2 * oh), cd[2] / (2 * oh)] : cd
    const center = addScaled(a, u, h), otherCenter = addScaled(c, v, oh)
    const offset = sub(center, otherCenter), cosine = dot(u, v), along = dot(u, offset), otherAlong = dot(v, offset)
    const t = (cosine * otherAlong - along) / (1 - cosine * cosine + 1e-6)
    const point = addScaled(center, u, Math.min(Math.max(t, -h), h))
    const otherPoint = addScaled(otherCenter, v, Math.min(Math.max(otherAlong + cosine * t, -oh), oh))
    const projected = closestPointOnSegment(a, b, otherPoint), otherProjected = closestPointOnSegment(c, d, point)
    const d1 = sub(otherPoint, projected), d2 = sub(point, otherProjected)
    return dot(d1, d1) < dot(d2, d2) ? projected : point
}

/** The pivot's transform aligned to a robot at `p` moving along unit `d` at `speed`, as pivot.py does it. */
function alignedPivot(pivot: G1PrimitivePivot, authored: Xform, p: Vec3, d: Vec3, speed: number): Xform {
    let limits = authored
    let position = authored.p, rotation = authored.q
    const rotate = () => {
        if (!pivot.rotationAxis) return rotation
        const axis = qrot(limits.q, pivot.rotationAxis)
        let motion = qrot(limits.q, pivot.motion)
        motion = addScaled(motion, axis, -dot(motion, axis))
        const desired = addScaled(d, axis, -dot(d, axis))
        if (Math.hypot(...motion) < 1e-6 || Math.hypot(...desired) < 1e-6) return rotation
        const wanted = Math.atan2(dot(axis, cross(motion, desired)), dot(motion, desired))
        let angle = wanted
        if (Number.isFinite(pivot.coneHalfAngle)) {
            // The nearest allowed heading, checking both cones when the sequence works either way.
            let best = Infinity
            for (const c of pivot.coneCenters) {
                const delta = wrap(wanted - c), clamped = Math.max(-pivot.coneHalfAngle, Math.min(pivot.coneHalfAngle, delta))
                if (Math.abs(delta - clamped) < best) {
                    best = Math.abs(delta - clamped)
                    angle = c + clamped
                }
            }
        }
        return qnorm(qmul(qaxis(axis, angle), limits.q))
    }
    const slide = () => {
        if (!pivot.translationAxis) return position
        const axis = qrot(limits.q, pivot.translationAxis)
        const [near, far] = probeSegment(p, d, speed)
        return closestPointToSegment(addScaled(limits.p, axis, pivot.lineMin), addScaled(limits.p, axis, pivot.lineMax), near, far)
    }
    if (pivot.rotationFirst) {
        rotation = rotate()
        if (pivot.rotationAxis) limits = {p: limits.p, q: rotation}
        position = slide()
    } else {
        position = slide()
        rotation = rotate()
    }
    return {p: position, q: rotation}
}

/**
 * The sequence's steps placed in G1 space for a robot at (x, y) moving along `angle` at `speed`. A sequence with its
 * own pivot turns it to the approach; one without keeps the placement its pivot was last aligned to.
 */
export function placeSequence(o: G1Obstacle, sequence: G1PrimitiveSequence, x: number, y: number, angle: number, speed: number) {
    const authored = tmul(obstacleFrame(o), sequence.pivot.transform)
    let pivot = o.pivots?.get(sequence.pivotId) ?? authored
    if (sequence.aligns) {
        pivot = alignedPivot(sequence.pivot, authored, [x, y, 0], [Math.cos(angle), Math.sin(angle), 0], speed)
        ;(o.pivots ??= new Map()).set(sequence.pivotId, pivot)
    }
    const place = o.primitive.rig === 'soma' ? tmul(Z_TO_Y, pivot) : pivot
    return sequence.steps.map(step => ({...step, window: step.window.map(pose => placePose(place, pose))}))
}

/**
 * Whether the probe of a robot at (x, y) moving along `angle` at `speed` meets the obstacle's interaction box,
 * looking `extra` metres further than the probe itself.
 */
export function probeHits(o: G1Obstacle, x: number, y: number, angle: number, speed: number, extra = 0) {
    const d: Vec3 = [Math.cos(angle), Math.sin(angle), 0]
    const [near, far0] = probeSegment([x, y, 0], d, speed)
    const far = addScaled(far0, d, extra)
    const frame = obstacleFrame(o), box = o.primitive.box
    const centre = tmul(frame, {p: box.center, q: [0, 0, 0, 1]}).p
    const ax = qrot(frame.q, [1, 0, 0]), ay = qrot(frame.q, [0, 1, 0])
    // Separating axes on the ground: the probe's two axes and the box's two.
    const pc: Vec3 = [(near[0] + far[0]) / 2, (near[1] + far[1]) / 2, 0]
    const pu: Vec3 = [-d[1], d[0], 0]
    const ph = [PROBE.width / 2, Math.hypot(far[0] - near[0], far[1] - near[1]) / 2]
    const bh = [box.size[0] / 2, box.size[1] / 2]
    const between = sub(centre, pc)
    for (const axis of [pu, d, ax, ay]) {
        const r1 = ph[0] * Math.abs(dot(pu, axis)) + ph[1] * Math.abs(dot(d, axis))
        const r2 = bh[0] * Math.abs(dot(ax, axis)) + bh[1] * Math.abs(dot(ay, axis))
        if (Math.abs(dot(between, axis)) > r1 + r2) return false
    }
    return true
}
