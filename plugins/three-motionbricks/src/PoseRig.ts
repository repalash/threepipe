// What G1Controller needs to know about a skeleton's poses, so the same controller drives the G1 and SOMA.
// The controller works on the ground plane of G1 space: x and y, Z up, angles around Z with 0 facing +X.

import {G1Pose, heading as g1Heading, lerpPose as g1Lerp, placePoses as g1Place, POSE_SIZE, withSpeed as g1WithSpeed} from './MotionBricksG1'
import {SOMA_SKELETON_INFO} from './MotionBricksSOMA'

export interface PoseRig {
    readonly name: 'g1' | 'soma'
    readonly poseSize: number
    /** The pose's position on the ground, in controller space. */
    ground(pose: ArrayLike<number>): [number, number]
    /** The way the pose faces, in controller space. */
    heading(pose: ArrayLike<number>): number
    /** Poses authored at the origin facing +X, placed at (x, y) and turned by angle. */
    place(poses: ArrayLike<number>[], x: number, y: number, angle: number): Float32Array[]
    /** Poses with their ground travel scaled to a mean speed in m/s at 30 Hz. */
    withSpeed(poses: ArrayLike<number>[], speed: number): Float32Array[]
    /** Move a pose along the ground, in place. */
    translate(pose: Float32Array, dx: number, dy: number): void
    /** Blend two poses. */
    lerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Float32Array): Float32Array
    /** How unlike two poses' bodies are, ignoring where they stand: for finding the point of a stride. */
    distance(a: ArrayLike<number>, b: ArrayLike<number>): number
}

export const G1_RIG: PoseRig = {
    name: 'g1',
    poseSize: POSE_SIZE,
    ground: p => [p[0], p[1]],
    heading: p => g1Heading([p[3], p[4], p[5], p[6]]),
    place: g1Place,
    withSpeed: g1WithSpeed,
    translate(p, dx, dy) {
        p[0] += dx
        p[1] += dy
    },
    lerp: (a, b, t, out) => g1Lerp(a as G1Pose, b as G1Pose, t, out),
    distance(a, b) {
        let e = 0
        for (let k = POSE_SIZE - 29; k < POSE_SIZE; k++) e += (a[k] - b[k]) ** 2
        return e
    },
}

// SOMA poses are local transforms (position, quaternion xyzw) of SOMA_SKELETON, Y up; the root (Hips) is in world
// space. Controller space is (x, -z) on the ground.
const S = SOMA_SKELETON_INFO
const SOMA_SIZE = S.J * 7

function rotateY(q: ArrayLike<number>, o: number, angle: number, out: Float32Array, oo: number) {
    const s = Math.sin(angle / 2), c = Math.cos(angle / 2)
    const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3]
    // (0, s, 0, c) * q
    out[oo] = c * x + s * z
    out[oo + 1] = c * y + s * w
    out[oo + 2] = c * z - s * x
    out[oo + 3] = c * w - s * y
}

export const SOMA_RIG: PoseRig = {
    name: 'soma',
    poseSize: SOMA_SIZE,
    ground: p => [p[0], -p[2]],
    // The model's hip heading is 0 facing +Z; controller angle 0 faces +X, which is a SOMA heading of 90 degrees.
    heading: p => S.heading(p) - Math.PI / 2,
    place(poses, x, y, angle) {
        const c = Math.cos(angle), s = Math.sin(angle)
        return poses.map(src => {
            const p = Float32Array.from(src)
            // A turn by angle around the controller's up is the same turn around +Y.
            p[0] = src[0] * c + src[2] * s + x
            p[2] = -src[0] * s + src[2] * c - y
            rotateY(src, 3, angle, p, 3)
            return p
        })
    },
    withSpeed(poses, speed) {
        const first = poses[0], last = poses[poses.length - 1]
        const current = Math.hypot(last[0] - first[0], last[2] - first[2]) * 30 / (poses.length - 1)
        const k = current > 1e-3 ? speed / current : 1
        return poses.map(src => {
            const p = Float32Array.from(src)
            p[0] = first[0] + (src[0] - first[0]) * k
            p[2] = first[2] + (src[2] - first[2]) * k
            return p
        })
    },
    translate(p, dx, dy) {
        p[0] += dx
        p[2] -= dy
    },
    lerp(a, b, t, out) {
        for (let j = 0; j < S.J; j++) {
            const o = j * 7
            for (let k = 0; k < 3; k++) out[o + k] = a[o + k] + (b[o + k] - a[o + k]) * t
            const d = a[o + 3] * b[o + 3] + a[o + 4] * b[o + 4] + a[o + 5] * b[o + 5] + a[o + 6] * b[o + 6] < 0 ? -1 : 1
            let l = 0
            for (let k = 3; k < 7; k++) {
                out[o + k] = a[o + k] + (b[o + k] * d - a[o + k]) * t
                l += out[o + k] * out[o + k]
            }
            l = Math.sqrt(l) || 1
            for (let k = 3; k < 7; k++) out[o + k] /= l
        }
        return out
    },
    distance(a, b) {
        // Joint rotations below the root: 1 - cos^2 of the angle between them.
        let e = 0
        for (const j of S.modelToPose) {
            if (j === 0) continue
            const o = j * 7 + 3
            const d = a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3]
            e += 1 - d * d
        }
        return e
    },
}
