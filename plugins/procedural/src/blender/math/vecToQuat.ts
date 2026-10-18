/** `vec_to_quat` (`blenlib/intern/math_rotation_c.cc:722`) and the C helpers it calls. */

import {f32} from '../f32'
import {quatToMat3} from './matrix'
import {acosf, atan2f} from '../libm'

/** C `normalize_v3` (`math_vector_inline.cc:872`): reciprocal times components; zero below 1e-35. */
function normalizeV3C(v: number[]): void {
    const d = f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]))
    if (d > f32(1.0e-35)) {
        const s = f32(1 / f32(Math.sqrt(d)))
        v[0] = f32(v[0] * s)
        v[1] = f32(v[1] * s)
        v[2] = f32(v[2] * s)
    } else {
        v[0] = v[1] = v[2] = 0
    }
}

/** `mul_qt_qtqt` (:64). */
function mulQtQtQt(a: number[], b: number[]): number[] {
    const m = (x: number, y: number) => f32(x * y)
    const t0 = f32(f32(f32(m(a[0], b[0]) - m(a[1], b[1])) - m(a[2], b[2])) - m(a[3], b[3]))
    const t1 = f32(f32(f32(m(a[0], b[1]) + m(a[1], b[0])) + m(a[2], b[3])) - m(a[3], b[2]))
    const t2 = f32(f32(f32(m(a[0], b[2]) + m(a[2], b[0])) + m(a[3], b[1])) - m(a[1], b[3]))
    const t3 = f32(f32(f32(m(a[0], b[3]) + m(a[3], b[0])) + m(a[1], b[2])) - m(a[2], b[1]))
    return [t0, t1, t2, t3]
}

/** Axis enums of `vec_to_quat`: OB_POSX..OB_POSZ = 0..2, OB_NEGX..OB_NEGZ = 3..5. */
export const OB_POSX = 0, OB_POSY = 1, OB_POSZ = 2, OB_NEGX = 3, OB_NEGY = 4, OB_NEGZ = 5

export function vecToQuat(vec: ArrayLike<number>, axisIn: number, upflag: number): [number, number, number, number] {
    const eps = f32(1e-4)
    let q = [1, 0, 0, 0]
    const len = f32(Math.sqrt(f32(f32(f32(vec[0] * vec[0]) + f32(vec[1] * vec[1])) + f32(vec[2] * vec[2]))))
    if (len === 0) return q as [number, number, number, number]
    let axis = axisIn
    let tvec: number[]
    if (axis > 2) {
        tvec = [vec[0], vec[1], vec[2]]
        axis -= 3
    } else {
        tvec = [-vec[0], -vec[1], -vec[2]]
    }
    const nor = [0, 0, 0]
    let co: number
    if (axis === 0) {
        nor[1] = -tvec[2]
        nor[2] = tvec[1]
        if (f32(Math.abs(tvec[1]) + Math.abs(tvec[2])) < eps) nor[1] = 1
        co = tvec[0]
    } else if (axis === 1) {
        nor[0] = tvec[2]
        nor[2] = -tvec[0]
        if (f32(Math.abs(tvec[0]) + Math.abs(tvec[2])) < eps) nor[2] = 1
        co = tvec[1]
    } else {
        nor[0] = -tvec[1]
        nor[1] = tvec[0]
        if (f32(Math.abs(tvec[0]) + Math.abs(tvec[1])) < eps) nor[0] = 1
        co = tvec[2]
    }
    co = f32(co / len)
    normalizeV3C(nor)
    // `axis_angle_normalized_to_quat` (:1065) with C `safe_acosf` = `acosf(clamp(a, -1, 1))` (math_base_safe_inline.cc:55).
    const phi = f32(0.5 * acosf(co < -1 ? -1 : co > 1 ? 1 : co))
    const si = f32(Math.sin(phi)), cs = f32(Math.cos(phi))
    q = [cs, f32(nor[0] * si), f32(nor[1] * si), f32(nor[2] * si)]
    if (axis !== upflag) {
        const mat = quatToMat3(q)
        const fp = [mat[6], mat[7], mat[8]]
        let angle: number
        if (axis === 0) angle = upflag === 1 ? f32(0.5 * atan2f(fp[2], fp[1])) : f32(-0.5 * atan2f(fp[1], fp[2]))
        else if (axis === 1) angle = upflag === 0 ? f32(-0.5 * atan2f(fp[2], fp[0])) : f32(0.5 * atan2f(fp[0], fp[2]))
        else angle = upflag === 0 ? f32(0.5 * atan2f(-fp[1], -fp[0])) : f32(-0.5 * atan2f(-fp[0], -fp[1]))
        const c2 = f32(Math.cos(angle))
        const s2 = f32(f32(Math.sin(angle)) / len)
        const q2 = [c2, f32(tvec[0] * s2), f32(tvec[1] * s2), f32(tvec[2] * s2)]
        q = mulQtQtQt(q2, q)
    }
    return q as [number, number, number, number]
}
