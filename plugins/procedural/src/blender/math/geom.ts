/**
 * Geometry helpers of `blenlib/intern/math_geom.cc` / `math_geom_inline.cc` used by BVH nearest queries and
 * barycentric sampling, ported with the C API's float32 rounding (`-ffp-contract=off`): every `+ - * /`
 * rounds, and `dot_v3v3` / `madd_v3_v3v3fl` keep their operation order.
 */

import {f32} from '../f32'
import type {V3} from './vec'

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])]
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]))
/** `madd_v3_v3v3fl(r, a, b, f)` (`math_vector_inline.cc:514`): `a + b * f`. */
const madd = (a: ArrayLike<number>, b: ArrayLike<number>, f: number): V3 =>
    [f32(a[0] + f32(b[0] * f)), f32(a[1] + f32(b[1] * f)), f32(a[2] + f32(b[2] * f))]
const copy = (a: ArrayLike<number>): V3 => [a[0], a[1], a[2]]

/** `len_squared_v3v3(a, b)` (`math_vector_inline.cc:788`): `dot(b - a, b - a)`. */
export function lenSquaredV3V3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const d = sub(b, a)
    return dot(d, d)
}

/** `closest_to_ray_v3` (`math_geom.cc:3272`). Returns `[lambda, r_close]`. */
export function closestToRayV3(p: ArrayLike<number>, rayOrig: ArrayLike<number>, rayDir: ArrayLike<number>): [number, V3] {
    if (rayDir[0] === 0 && rayDir[1] === 0 && rayDir[2] === 0) return [0, copy(rayOrig)]
    const h = sub(p, rayOrig)
    const lambda = f32(dot(rayDir, h) / dot(rayDir, rayDir))
    return [lambda, madd(rayOrig, rayDir, lambda)]
}

/** `closest_to_line_segment_v3` (`math_geom.cc:403`) via `closest_to_line_v3` (:3291). */
export function closestToLineSegmentV3(p: ArrayLike<number>, l1: ArrayLike<number>, l2: ArrayLike<number>): V3 {
    const [lambda, cp] = closestToRayV3(p, l1, sub(l2, l1))
    // Flipped checks for the !finite case (when the segment is a point).
    if (lambda <= 0) return copy(l1)
    if (lambda >= 1) return copy(l2)
    return cp
}

/** `closest_on_tri_to_point_v3` (`math_geom.cc:1037`, Ericson's "Real-Time Collision Detection"). */
export function closestOnTriToPointV3(p: ArrayLike<number>, v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>): V3 {
    const ab = sub(v2, v1)
    const ac = sub(v3, v1)
    const ap = sub(p, v1)
    const d1 = dot(ab, ap)
    const d2 = dot(ac, ap)
    if (d1 <= 0 && d2 <= 0) return copy(v1)
    const bp = sub(p, v2)
    const d3 = dot(ab, bp)
    const d4 = dot(ac, bp)
    if (d3 >= 0 && d4 <= d3) return copy(v2)
    const vc = f32(f32(d1 * d4) - f32(d3 * d2))
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const abSquared = f32(d1 - d3)
        if (abSquared === 0) return copy(v1)
        return madd(v1, ab, f32(d1 / abSquared))
    }
    const cp = sub(p, v3)
    const d5 = dot(ab, cp)
    const d6 = dot(ac, cp)
    if (d6 >= 0 && d5 <= d6) return copy(v3)
    const vb = f32(f32(d5 * d2) - f32(d1 * d6))
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const acSquared = f32(d2 - d6)
        if (acSquared === 0) return copy(v1)
        return madd(v1, ac, f32(d2 / acSquared))
    }
    const va = f32(f32(d3 * d6) - f32(d5 * d4))
    if (va <= 0 && f32(d4 - d3) >= 0 && f32(d5 - d6) >= 0) {
        const bcSquared = f32(f32(d4 - d3) + f32(d5 - d6))
        if (bcSquared === 0) return copy(v2)
        const r = sub(v3, v2)
        const s = f32(f32(d4 - d3) / bcSquared)
        return [f32(f32(r[0] * s) + v2[0]), f32(f32(r[1] * s) + v2[1]), f32(f32(r[2] * s) + v2[2])]
    }
    const denom = f32(1 / f32(f32(va + vb) + vc))
    const v = f32(vb * denom)
    const w = f32(vc * denom)
    const acw: V3 = [f32(ac[0] * w), f32(ac[1] * w), f32(ac[2] * w)]
    const r = madd(v1, ab, v)
    return [f32(r[0] + acw[0]), f32(r[1] + acw[1]), f32(r[2] + acw[2])]
}

/** `normal_tri_v3` (`math_geom.cc:45`) with the C `normalize_v3` (reciprocal, `math_vector_inline.cc:872`). */
export function normalTriV3(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>): V3 {
    const n1 = sub(v1, v2)
    const n2 = sub(v2, v3)
    const n: V3 = [
        f32(f32(n1[1] * n2[2]) - f32(n1[2] * n2[1])),
        f32(f32(n1[2] * n2[0]) - f32(n1[0] * n2[2])),
        f32(f32(n1[0] * n2[1]) - f32(n1[1] * n2[0])),
    ]
    let d = dot(n, n)
    if (d > f32(1.0e-35)) {
        d = f32(Math.sqrt(d))
        const m = f32(1 / d)
        return [f32(n[0] * m), f32(n[1] * m), f32(n[2] * m)]
    }
    return [0, 0, 0]
}

/** `axis_dominant_v3` (`math_geom_inline.cc:45`). */
export function axisDominantV3(axis: ArrayLike<number>): [number, number] {
    const xn = Math.abs(axis[0]), yn = Math.abs(axis[1]), zn = Math.abs(axis[2])
    if (zn >= xn && zn >= yn) return [0, 1]
    if (yn >= xn && yn >= zn) return [0, 2]
    return [1, 2]
}

/** `tri_signed_area` (`math_geom.cc:3685`). */
function triSignedArea(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, i: number, j: number): number {
    return f32(0.5 * f32(f32(f32(v1[i] - v2[i]) * f32(v2[j] - v3[j])) + f32(f32(v1[j] - v2[j]) * f32(v3[i] - v2[i]))))
}

/** `interp_weights_tri_v3` (`math_geom.cc:3726`) with `barycentric_weights` (:3694). */
export function interpWeightsTriV3(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, co: ArrayLike<number>): V3 {
    const n = normalTriV3(v1, v2, v3)
    const [i, j] = axisDominantV3(n)
    const w: V3 = [triSignedArea(v2, v3, co, i, j), triSignedArea(v3, v1, co, i, j), triSignedArea(v1, v2, co, i, j)]
    const wtot = f32(f32(w[0] + w[1]) + w[2])
    // `mul_v3_fl(w, 1.0f / wtot)`; a zero `wtot` gives infinities/NaN, caught by `is_finite_v3`.
    const inv = f32(1 / wtot)
    const r: V3 = [f32(w[0] * inv), f32(w[1] * inv), f32(w[2] * inv)]
    if (Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2])) return r
    const third = f32(1 / 3)
    return [third, third, third]
}
