/**
 * Quaternions as Blender's `blenlib` keeps them, `[w, x, y, z]`, ported from
 * `blenlib/intern/math_rotation_c.cc`, for the edge-ring subdivide's minimum-twist frames
 * (`bm_edgering_pair_interpolate`'s path mode). Each function cites its origin. Blender works in
 * `float`; these work in doubles.
 */

import {Vec3, v3dot} from './index'

/** `[w, x, y, z]`. */
export type Quat = [number, number, number, number]

/** `unit_qt`. */
export const unitQt = (): Quat => [1, 0, 0, 0]

/** `mul_qt_qtqt` (`math_rotation_c.cc:64`): `a * b`. */
export function mulQtQtQt(a: Quat, b: Quat): Quat {
    const t0 = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3]
    const t1 = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2]
    const t2 = a[0] * b[2] + a[2] * b[0] + a[3] * b[1] - a[1] * b[3]
    const t3 = a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1]
    return [t0, t1, t2, t3]
}

/** `mul_qt_v3` (`math_rotation_c.cc:77`): `r` rotated by `q`, which must be unit length. */
export function mulQtV3(q: Quat, v: Vec3): Vec3 {
    const r: Vec3 = [v[0], v[1], v[2]]
    const t0 = -q[1] * r[0] - q[2] * r[1] - q[3] * r[2]
    let t1 = q[0] * r[0] + q[2] * r[2] - q[3] * r[1]
    let t2 = q[0] * r[1] + q[3] * r[0] - q[1] * r[2]
    r[2] = q[0] * r[2] + q[1] * r[1] - q[2] * r[0]
    r[0] = t1
    r[1] = t2

    t1 = t0 * -q[1] + r[0] * q[0] - r[1] * q[3] + r[2] * q[2]
    t2 = t0 * -q[2] + r[1] * q[0] - r[2] * q[1] + r[0] * q[3]
    r[2] = t0 * -q[3] + r[2] * q[0] - r[0] * q[2] + r[1] * q[1]
    r[0] = t1
    r[1] = t2
    return r
}

/** `normalize_qt` (`math_rotation_c.cc:472`), in place, returning the length. */
export function normalizeQt(q: Quat): number {
    const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    if (len !== 0) {
        q[0] /= len
        q[1] /= len
        q[2] /= len
        q[3] /= len
    } else {
        q[1] = 1
        q[0] = q[2] = q[3] = 0
    }
    return len
}

/** `axis_angle_normalized_to_quat` (`math_rotation_c.cc:1065`); `axis` must be unit length. */
export function axisAngleNormalizedToQuat(axis: Vec3, angle: number): Quat {
    const phi = 0.5 * angle
    const si = Math.sin(phi)
    const co = Math.cos(phi)
    return [co, axis[0] * si, axis[1] * si, axis[2] * si]
}

/** `axis_angle_to_quat` (`math_rotation_c.cc:1075`): the unit quaternion, for a zero axis. */
export function axisAngleToQuat(axis: Vec3, angle: number): Quat {
    const len = Math.sqrt(v3dot(axis, axis))
    if (len !== 0) return axisAngleNormalizedToQuat([axis[0] / len, axis[1] / len, axis[2] / len], angle)
    return unitQt()
}

/**
 * `quat_to_mat3_no_error` (`math_rotation_c.cc:198`), in Blender's `m[col][row]` layout: `m[2]` is
 * the rotated Z axis.
 */
export function quatToMat3(q: Quat): [Vec3, Vec3, Vec3] {
    const q0 = Math.SQRT2 * q[0]
    const q1 = Math.SQRT2 * q[1]
    const q2 = Math.SQRT2 * q[2]
    const q3 = Math.SQRT2 * q[3]
    const qda = q0 * q1
    const qdb = q0 * q2
    const qdc = q0 * q3
    const qaa = q1 * q1
    const qab = q1 * q2
    const qac = q1 * q3
    const qbb = q2 * q2
    const qbc = q2 * q3
    const qcc = q3 * q3
    return [
        [1 - qbb - qcc, qdc + qab, -qdb + qac],
        [-qdc + qab, 1 - qaa - qcc, qda + qbc],
        [qdb + qac, -qda + qbc, 1 - qaa - qbb],
    ]
}

/** `safe_acosf` (`math_base_inline.cc`): clamped into the domain first. */
const safeAcos = (a: number): number => Math.acos(Math.max(-1, Math.min(1, a)))

/**
 * `vec_to_quat` (`math_rotation_c.cc:722`): the rotation that points `axis` (0..2 for -X..-Z, 3..5 for
 * X..Z) along `vec`, with `upflag` (0..2) as the up axis.
 */
export function vecToQuat(vec: Vec3, axis: number, upflag: number): Quat {
    const eps = 1e-4
    // first set the quat to unit
    let q = unitQt()
    const len = Math.sqrt(v3dot(vec, vec))
    if (len === 0) return q

    // rotate to axis
    let tvec: Vec3
    if (axis > 2) {
        tvec = [vec[0], vec[1], vec[2]]
        axis -= 3
    } else {
        tvec = [-vec[0], -vec[1], -vec[2]]
    }

    // nasty! I need a good routine for this...
    // problem is a rotation of an Y axis to the negative Y-axis for example.
    const nor: Vec3 = [0, 0, 0]
    let co: number
    if (axis === 0) { // x-axis
        nor[0] = 0
        nor[1] = -tvec[2]
        nor[2] = tvec[1]
        if (Math.abs(tvec[1]) + Math.abs(tvec[2]) < eps) nor[1] = 1
        co = tvec[0]
    } else if (axis === 1) { // y-axis
        nor[0] = tvec[2]
        nor[1] = 0
        nor[2] = -tvec[0]
        if (Math.abs(tvec[0]) + Math.abs(tvec[2]) < eps) nor[2] = 1
        co = tvec[1]
    } else { // z-axis
        nor[0] = -tvec[1]
        nor[1] = tvec[0]
        nor[2] = 0
        if (Math.abs(tvec[0]) + Math.abs(tvec[1]) < eps) nor[0] = 1
        co = tvec[2]
    }
    co /= len

    // `normalize_v3`
    const nlen = Math.sqrt(v3dot(nor, nor))
    if (nlen > 1.0e-35) {
        nor[0] /= nlen
        nor[1] /= nlen
        nor[2] /= nlen
    } else {
        nor[0] = nor[1] = nor[2] = 0
    }

    q = axisAngleNormalizedToQuat(nor, safeAcos(co))

    if (axis !== upflag) {
        const mat = quatToMat3(q)
        const fp = mat[2]
        let angle: number
        if (axis === 0) {
            angle = upflag === 1 ? 0.5 * Math.atan2(fp[2], fp[1]) : -0.5 * Math.atan2(fp[1], fp[2])
        } else if (axis === 1) {
            angle = upflag === 0 ? -0.5 * Math.atan2(fp[2], fp[0]) : 0.5 * Math.atan2(fp[0], fp[2])
        } else {
            angle = upflag === 0 ? 0.5 * Math.atan2(-fp[1], -fp[0]) : -0.5 * Math.atan2(-fp[0], -fp[1])
        }
        const c = Math.cos(angle)
        const si = Math.sin(angle) / len
        const q2: Quat = [c, tvec[0] * si, tvec[1] * si, tvec[2] * si]
        q = mulQtQtQt(q2, q)
    }
    return q
}
