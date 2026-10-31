// Editing SOMA poses in world space: turning joints, two-bone IK for arms and legs. Used to author target poses for
// interactions (kicking, reaching, carrying, throwing) from the model's own standing pose, and to keep a carrying
// hand on its load while the model's motion plays.
// SOMA space is Y up, metres. Poses are local transforms (position, quaternion xyzw) of SOMA_SKELETON.

import {SOMA_SKELETON_INFO} from './MotionBricksSOMA'

export type V3 = [number, number, number]
export type Q = [number, number, number, number]

const K = SOMA_SKELETON_INFO

export const v3 = {
    sub: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a: ArrayLike<number>, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2]),
    norm: (a: ArrayLike<number>): V3 => {
        const l = Math.hypot(a[0], a[1], a[2]) || 1
        return [a[0] / l, a[1] / l, a[2] / l]
    },
    lerp: (a: ArrayLike<number>, b: ArrayLike<number>, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
}

export const quat = {
    mul(a: ArrayLike<number>, b: ArrayLike<number>): Q {
        return [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ]
    },
    inv: (q: ArrayLike<number>): Q => [-q[0], -q[1], -q[2], q[3]],
    norm(q: ArrayLike<number>): Q {
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
        return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
    },
    axisAngle(axis: ArrayLike<number>, angle: number): Q {
        const a = v3.norm(axis), s = Math.sin(angle / 2)
        return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)]
    },
    /** The shortest turn taking direction a onto direction b. */
    between(a: ArrayLike<number>, b: ArrayLike<number>): Q {
        const u = v3.norm(a), w = v3.norm(b)
        const c = v3.cross(u, w), d = v3.dot(u, w)
        if (d < -0.999999) {
            const axis = Math.abs(u[0]) < 0.9 ? v3.cross(u, [1, 0, 0]) : v3.cross(u, [0, 1, 0])
            return quat.axisAngle(axis, Math.PI)
        }
        return quat.norm([c[0], c[1], c[2], 1 + d])
    },
    rotate(q: ArrayLike<number>, v: ArrayLike<number>): V3 {
        const [x, y, z, w] = [q[0], q[1], q[2], q[3]]
        const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
        return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
    },
    slerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Q {
        let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
        const s = d < 0 ? -1 : 1
        d = Math.abs(d)
        if (d > 0.9995) return quat.norm([0, 1, 2, 3].map(k => a[k] + (b[k] * s - a[k]) * t) as Q)
        const th = Math.acos(d), sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th) * s
        return [0, 1, 2, 3].map(k => a[k] * sa + b[k] * sb) as Q
    },
}

/** A SOMA pose being edited. Joints are named as in SOMA_SKELETON ('RightLeg' is the thigh, 'RightShin' the knee). */
export class SOMAPoseEditor {
    readonly pose: Float32Array
    private _world: Float32Array<ArrayBuffer>
    private _dirty = false

    constructor(pose: ArrayLike<number>) {
        this.pose = Float32Array.from(pose)
        this._world = K.world(this.pose, new Float32Array(K.J * 7))
    }

    get world() {
        if (this._dirty) {
            K.world(this.pose, this._world)
            this._dirty = false
        }
        return this._world
    }

    private _j(joint: string | number) {
        const j = typeof joint === 'number' ? joint : K.index(joint)
        if (j < 0) throw new Error('No SOMA joint ' + joint)
        return j
    }

    position(joint: string | number): V3 {
        const w = this.world, o = this._j(joint) * 7
        return [w[o], w[o + 1], w[o + 2]]
    }

    rotation(joint: string | number): Q {
        const w = this.world, o = this._j(joint) * 7 + 3
        return [w[o], w[o + 1], w[o + 2], w[o + 3]]
    }

    /** Turn a joint, and all below it, by a world-space rotation about the joint. */
    turn(joint: string | number, q: ArrayLike<number>) {
        const j = this._j(joint), p = K.parents[j]
        const world = quat.mul(q, this.rotation(j))
        const local = p < 0 ? world : quat.mul(quat.inv(this.rotation(p)), world)
        this.pose.set(quat.norm(local), j * 7 + 3)
        this._dirty = true
        return this
    }

    /** Turn a joint by an angle about a world axis. */
    turnAbout(joint: string | number, axis: ArrayLike<number>, angle: number) {
        return this.turn(joint, quat.axisAngle(axis, angle))
    }

    /** Set a joint's world rotation. */
    setRotation(joint: string | number, q: ArrayLike<number>) {
        return this.turn(joint, quat.mul(q, quat.inv(this.rotation(joint))))
    }

    /** Move the whole body (the root) in world space. */
    move(d: ArrayLike<number>) {
        this.pose[0] += d[0]
        this.pose[1] += d[1]
        this.pose[2] += d[2]
        this._dirty = true
        return this
    }

    /**
     * Two-bone IK: turn `upper` and `mid` so that `end` reaches `target`, with `mid` (the knee or elbow) bending
     * toward `pole`, a world direction. The end joint keeps its world rotation unless `keepEnd` is false.
     */
    reach(upper: string, mid: string, end: string, target: ArrayLike<number>, pole: ArrayLike<number>, keepEnd = true) {
        const endRotation = this.rotation(end)
        let a = this.position(upper), b = this.position(mid), c = this.position(end)
        const lab = v3.len(v3.sub(b, a)), lcb = v3.len(v3.sub(c, b))
        const lat = Math.min(Math.max(v3.len(v3.sub(target, a)), Math.abs(lab - lcb) + 1e-4), lab + lcb - 1e-4)
        const clamp = (x: number) => Math.min(1, Math.max(-1, x))
        const angle = (u: V3, w: V3) => Math.acos(clamp(v3.dot(v3.norm(u), v3.norm(w))))
        // Bend: the angles at upper and mid for a reach of `lat`, in the plane of the limb and the pole.
        let axis = v3.cross(v3.sub(c, a), v3.sub(b, a))
        if (v3.len(axis) < 1e-5) axis = v3.cross(v3.sub(c, a), pole)
        const acab0 = angle(v3.sub(c, a), v3.sub(b, a)), babc0 = angle(v3.sub(a, b), v3.sub(c, b))
        const acab1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)))
        const babc1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)))
        this.turnAbout(upper, axis, acab1 - acab0)
        this.turnAbout(mid, axis, babc1 - babc0)
        // Swing: point the limb at the target.
        a = this.position(upper)
        c = this.position(end)
        this.turn(upper, quat.between(v3.sub(c, a), v3.sub(target, a)))
        // Twist about the limb so the mid joint bends toward the pole.
        a = this.position(upper)
        b = this.position(mid)
        const along = v3.norm(v3.sub(target, a))
        const flat = (v: V3) => v3.sub(v, v3.scale(along, v3.dot(v, along)))
        const now = flat(v3.sub(b, a)), want = flat([pole[0], pole[1], pole[2]])
        if (v3.len(now) > 1e-5 && v3.len(want) > 1e-5) {
            const twist = Math.atan2(v3.dot(along, v3.cross(now, want)), v3.dot(now, want))
            this.turnAbout(upper, along, twist)
        }
        if (keepEnd) this.setRotation(end, endRotation)
        return this
    }

    /** Reach with a leg, the knee toward `pole` (by default the way the hips face). */
    leg(side: 'Left' | 'Right', target: ArrayLike<number>, pole?: ArrayLike<number>) {
        return this.reach(side + 'Leg', side + 'Shin', side + 'Foot', target, pole ?? this.forward())
    }

    /** Reach with an arm, the elbow toward `pole` (by default down and back). */
    arm(side: 'Left' | 'Right', target: ArrayLike<number>, pole?: ArrayLike<number>, keepHand = false) {
        const f = this.forward()
        return this.reach(side + 'Arm', side + 'ForeArm', side + 'Hand', target, pole ?? [-f[0], -1, -f[2]], keepHand)
    }

    /** The way the hips face, on the ground. */
    forward(): V3 {
        const r = this.position('RightLeg'), l = this.position('LeftLeg')
        const across = v3.norm([r[0] - l[0], 0, r[2] - l[2]])
        return v3.norm(v3.cross([0, 1, 0], across))
    }

    /** The body's left, on the ground. */
    left(): V3 {
        const f = this.forward()
        return [f[2], 0, -f[0]]
    }
}
