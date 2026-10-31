// Target poses for the human (SOMA) model's interactions: kicking a ball, picking things up, carrying them,
// throwing and putting them down. Each is a few frames authored from the model's own standing pose with IK, at the
// ground origin facing +X (SOMA space: Y up, the body's left is -Z). G1Controller.perform places them in the world
// and the model generates the motion into and out of them. NVIDIA's sample data has no clips for these, so they are
// built here rather than read from a Smart Primitive.

import {SOMA_BRICKS} from './SOMABricks'
import {SOMAPoseEditor, V3, v3} from './SOMAPoseEdit'

export type Side = 'Left' | 'Right'
const other = (s: Side): Side => s === 'Left' ? 'Right' : 'Left'
/** +1 for the right side, -1 for the left: the right of a body facing +X is +Z. */
const sideZ = (s: Side) => s === 'Right' ? 1 : -1

function standing() {
    return new SOMAPoseEditor(SOMA_BRICKS.rest[0])
}

/** Lean the trunk forward (positive) or back, and turn it to the left (positive) or right, in radians. */
function trunk(e: SOMAPoseEditor, lean: number, turn = 0, tilt = 0, pelvis = 0) {
    const left = e.left(), forward = e.forward()
    // Bending at the hips tilts the pelvis, legs and all; the legs are put back on the ground afterwards with IK.
    if (pelvis) e.turnAbout('Hips', left, pelvis)
    for (const [joint, share] of [['Spine1', 0.4], ['Spine2', 0.35], ['Chest', 0.25]] as const) {
        if (lean) e.turnAbout(joint, left, lean * share)
        if (turn) e.turnAbout(joint, [0, 1, 0], turn * share)
        if (tilt) e.turnAbout(joint, forward, tilt * share)
    }
    return e
}

/** Turn the head to look at a point. */
function look(e: SOMAPoseEditor, at: ArrayLike<number>, share = 0.6) {
    const head = e.position('Head')
    const neck = e.position('Neck1')
    const now = v3.sub(head, neck)
    const want = v3.sub(at, neck)
    const q = quatToward(now, want, share)
    e.turn('Neck1', q)
    return e
}

function quatToward(a: V3, b: V3, share: number) {
    const u = v3.norm(a), w = v3.norm(b)
    const axis = v3.cross(u, w)
    const angle = Math.acos(Math.min(1, Math.max(-1, v3.dot(u, w)))) * share
    const s = Math.sin(angle / 2), l = v3.len(axis) || 1
    return [axis[0] / l * s, axis[1] / l * s, axis[2] / l * s, Math.cos(angle / 2)]
}

/**
 * A kick: three frames about the moment the foot meets a ball at the origin (radius `radius`), the leg swinging
 * through it along +X, the other foot planted beside the ball.
 */
export function kickPoses({foot = 'Right' as Side, radius = 0.11, power = 1} = {}): Float32Array[] {
    const z = sideZ(foot), support = other(foot)
    // The ankle's path: back and high, through the ball low, then forward and up. A frame is 1/30 s.
    const swing = 0.22 + 0.1 * power
    const path: V3[] = [
        [-radius - 0.14 - swing, 0.2 + 0.08 * power, 0.04 * z],
        [-radius - 0.14, 0.09, 0.02 * z],
        [-radius - 0.14 + swing, 0.2 + 0.1 * power, 0],
    ]
    return [-1, 0, 1].map(k => {
        const e = standing()
        // Hips over the planted foot, behind the ball and a little to its side, leaning back as the leg swings.
        e.move([-0.24 + 0.03 * k, -0.07, -0.08 * z])
        trunk(e, -0.1 - 0.08 * k, -0.3 * z * (1 - 0.6 * k), 0.1 * z)
        e.leg(support, [-0.1, 0.07, -0.22 * z])
        e.leg(foot, path[k + 1], [0.5, k < 0 ? -0.2 : 0.3, 0])
        // Arms for balance: the kicking side's back, the other out in front.
        const hips = e.position('Hips')
        e.arm(foot, v3.add(hips, [-0.35 + 0.1 * k, 0.05, 0.3 * z]))
        e.arm(support, v3.add(hips, [0.3, 0.3, -0.45 * z]))
        look(e, [0, 0, 0], 0.5)
        return e.pose
    })
}

/** Where a carried load sits relative to the body when standing: before the waist, in one hand or two. */
export function carryHands(hands: 'one' | 'two', width = 0.3, side: Side = 'Right'): {Left?: V3, Right?: V3} {
    if (hands === 'two') return {Left: [0.32, 1.02, -width / 2 - 0.01], Right: [0.32, 1.02, width / 2 + 0.01]}
    return {[side]: [0.28, 0.98, 0.17 * sideZ(side)]}
}

/**
 * Reaching down to something at (0, height, 0): two frames of a squat with the hand (or hands, `width` apart) on it,
 * the body behind it facing +X.
 */
export function reachPoses({height = 0.1, hands = 'one' as 'one' | 'two', width = 0.3, side = 'Right' as Side} = {}): Float32Array[] {
    const z = sideZ(side)
    const two = hands === 'two'
    const targets: Partial<Record<Side, V3>> = two ?
        {Right: [0, height + 0.02, width / 2 + 0.02], Left: [0, height + 0.02, -width / 2 - 0.02]} :
        {[side]: [0.02, height + 0.03, 0.04 * z]}
    // A squat of `depth` (0 standing, 1 deepest): the shallowest one whose hands reach.
    const pose = (depth: number, k: number) => {
        const e = standing()
        const back = two ? 0.4 : 0.36
        e.move([-back - 0.06 * depth, -(two ? 0.4 : 0.3) * depth - 0.01 * k, two ? 0 : -0.08 * z])
        trunk(e, (two ? 0.25 : 0.3) + (two ? 0.5 : 0.6) * depth, two ? 0 : -0.2 * z, 0, (two ? 0.5 : 0.8) * depth)
        // Feet planted a little wider than standing, one ahead of the other for a one-handed reach.
        const f = two ? 0 : 0.1
        e.leg('Right', [-back - 0.02 + f * z, 0.07, 0.19 + (two ? 0.02 : -0.08 * z)])
        e.leg('Left', [-back - 0.02 - f * z, 0.07, -0.19 + (two ? -0.02 : -0.08 * z)])
        let miss = 0
        for (const s of ['Left', 'Right'] as Side[]) {
            const t = targets[s]
            if (!t) continue
            e.arm(s, t, two ? [-0.3, -0.2, sideZ(s)] : [-0.5, 0.2, 0.6 * z])
            miss = Math.max(miss, v3.len(v3.sub(e.position(s + 'Hand'), t)))
        }
        if (!two) {
            const hips = e.position('Chest')
            e.arm(other(side), v3.add(hips, [0.25, 0.05, -0.22 * z]))
        }
        look(e, [0, height, 0], 0.3)
        return {pose: e.pose, miss}
    }
    let depth = 0
    while (depth < 1.6 && pose(depth, 0).miss > 0.015) depth += 0.05
    reachPoses.lastDepth = depth
    return [0, 1].map(k => pose(depth, k).pose)
}

reachPoses.lastDepth = 0

/** Standing with a load, two frames: the hands where carryHands puts them. */
export function carryPoses({hands = 'one' as 'one' | 'two', width = 0.3, side = 'Right' as Side} = {}): Float32Array[] {
    const e = standing()
    const at = carryHands(hands, width, side)
    for (const s of ['Left', 'Right'] as Side[]) {
        const p = at[s]
        if (p) e.arm(s, p, [-0.3, -1, 0.6 * sideZ(s)])
    }
    return [e.pose, Float32Array.from(e.pose)]
}

/**
 * An overhand throw along +X: three frames about the release, the throwing hand high and moving forward, the other
 * foot stepped forward. Returns the poses and the hand's position at release (the middle frame).
 */
export function throwPoses({side = 'Right' as Side, power = 1} = {}): {poses: Float32Array[], release: V3} {
    const z = sideZ(side), lead = other(side)
    const speed = 0.14 + 0.1 * power
    let release: V3 = [0, 0, 0]
    const poses = [-1, 0, 1].map(k => {
        const e = standing()
        e.move([0.05 + 0.04 * k, -0.06, 0])
        trunk(e, 0.12 + 0.1 * k, (0.15 + 0.25 * k) * z * -1 + 0.2 * z, -0.05 * z)
        e.leg(lead, [0.38, 0.07, -0.13 * z])
        e.leg(side, [-0.36, 0.1, 0.18 * z], [0.3, 0.1, 0.2 * z])
        const hand: V3 = [0.12 + speed * k, 1.72 - 0.08 * k - 0.06 * k * k, 0.18 * z]
        e.arm(side, hand, [-0.4, -0.3, 0.8 * z])
        const hips = e.position('Hips')
        e.arm(lead, v3.add(hips, [0.1, 0.0, -0.3 * z]))
        if (k === 0) release = e.position(side + 'Hand')
        return e.pose
    })
    return {poses, release}
}

/** Standing still, two frames, for the end of an action. */
export function standPoses(): Float32Array[] {
    const e = standing()
    return [e.pose, Float32Array.from(e.pose)]
}
