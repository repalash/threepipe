/**
 * Geometry helpers from Blender's `blenlib`, as the subdivide, edge-ring and slide ports need them.
 *
 * Ported from `blenlib/intern/math_vector.cc`, `math_vector_inline.cc`, `math_geom.cc`,
 * `math_geom_inline.cc`, `math_base_inline.cc`, `math_matrix_c.cc` and `math_rotation_c.cc`; each
 * function cites its origin. Blender works in `float`; these work in doubles, which the parity tests
 * absorb with a tolerance.
 *
 * Track F (`p3-fill`) adds the same file with its own helpers. Where both need a function, the
 * definition here is a byte-for-byte copy of that one (the edge loop store, `bmesh/edgeloop.ts`, is
 * shared too), so the two merge as a union; this track's own helpers are in their own regions.
 */

import {Vec3, v3cross, v3dot, v3len, v3normalize, v3sub} from './index'

export type Vec2 = [number, number]

/** The rows of a 3x3 matrix, so `mulV3M3V3(m, a)[i] === dot(m[i], a)`. */
export type Mat3Rows = [Vec3, Vec3, Vec3]

/** A plane as `(normal, d)`: Blender's `float plane[4]`, with `dot(normal, p) + d = 0` on the plane. */
export type Vec4 = [number, number, number, number]

const FLT_EPSILON = 1.1920929e-7

/** `SMALL_NUMBER` (`BLI_math_base.h`). */
const SMALL_NUMBER = 1e-8

// region vectors

export const lenSquaredV3V3 = (a: Vec3, b: Vec3): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
export const lenV3V3 = (a: Vec3, b: Vec3): number => Math.sqrt(lenSquaredV3V3(a, b))
export const negateV3 = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]

/**
 * `normalize_v3` in place, returning the length (`normalize_v3_v3_length`,
 * `math_vector_inline.cc:872`). The threshold is on the *squared* length, as Blender's is
 * (`d = dot_v3v3(a, a); if (d > 1.0e-35f)`); anything at or below it becomes the zero vector and
 * reports length 0.
 */
export function normalizeV3Len(v: Vec3): number {
    let d = v3dot(v, v)
    if (d > 1.0e-35) {
        d = Math.sqrt(d)
        v[0] /= d
        v[1] /= d
        v[2] /= d
    } else {
        v[0] = v[1] = v[2] = 0
        d = 0
    }
    return d
}

/** `madd_v3_v3fl`: `r += a * f`, in place. */
export function maddV3V3Fl(r: Vec3, a: Vec3, f: number): void {
    r[0] += a[0] * f
    r[1] += a[1] * f
    r[2] += a[2] * f
}

/** `add_newell_cross_v3_v3v3` (`math_vector_inline.cc:700`). */
export function addNewellCrossV3V3V3(n: Vec3, vPrev: Vec3, vCurr: Vec3): void {
    n[0] += (vPrev[1] - vCurr[1]) * (vPrev[2] + vCurr[2])
    n[1] += (vPrev[2] - vCurr[2]) * (vPrev[0] + vCurr[0])
    n[2] += (vPrev[0] - vCurr[0]) * (vPrev[1] + vCurr[1])
}

/** `interp_v3_v3v3v3`: the weighted sum of three points. */
export const interpV3V3V3V3 = (a: Vec3, b: Vec3, c: Vec3, w: readonly number[]): Vec3 => [
    a[0] * w[0] + b[0] * w[1] + c[0] * w[2],
    a[1] * w[0] + b[1] * w[1] + c[1] * w[2],
    a[2] * w[0] + b[2] * w[1] + c[2] * w[2],
]

// endregion

// region vectors (subdivide, edge-ring)

/**
 * `normalize_v3_length` (`math_vector_inline.cc:922`, via `normalize_v3_v3_length`): `v` scaled to
 * `unitLength`, in place, returning the original length; a (near) zero vector becomes zero.
 */
export function normalizeV3Length(v: Vec3, unitLength: number): number {
    let d = v3dot(v, v)
    if (d > 1.0e-35) {
        d = Math.sqrt(d)
        const mul = unitLength / d
        v[0] *= mul
        v[1] *= mul
        v[2] *= mul
    } else {
        v[0] = v[1] = v[2] = 0
        d = 0
    }
    return d
}

/** `project_v3_plane` (`math_vector.cc:537`): `out` projected onto the plane through `planeCo`. */
export function projectV3Plane(out: Vec3, planeNo: Vec3, planeCo: Vec3): Vec3 {
    const vector: Vec3 = [out[0] - planeCo[0], out[1] - planeCo[1], out[2] - planeCo[2]]
    const mul = v3dot(vector, planeNo) / v3dot(planeNo, planeNo)
    // out[x] = out[x] - (mul * plane_no[x])
    return [out[0] - mul * planeNo[0], out[1] - mul * planeNo[1], out[2] - mul * planeNo[2]]
}

/** `reflect_v3_v3v3` (`math_vector.cc:560`): `v` mirrored in the plane of unit `normal`. */
export function reflectV3V3V3(v: Vec3, normal: Vec3): Vec3 {
    const dot2 = 2 * v3dot(v, normal)
    // out[x] = v[x] - (dot2 * normal[x])
    return [v[0] - dot2 * normal[0], v[1] - dot2 * normal[1], v[2] - dot2 * normal[2]]
}

/** `interp_dot_slerp` (`math_rotation_c.cc:878`): the two slerp weights for `cos(angle) = cosom`. */
export function interpDotSlerp(t: number, cosom: number): [number, number] {
    const eps = 1e-4
    // within [-1..1] range, avoid aligned axis
    if (Math.abs(cosom) < 1 - eps) {
        const omega = Math.acos(cosom)
        const sinom = Math.sin(omega)
        return [Math.sin((1 - t) * omega) / sinom, Math.sin(t * omega) / sinom]
    }
    // fall back to lerp
    return [1 - t, t]
}

/**
 * `interp_v3_v3v3_slerp` (`math_vector.cc:60`): spherical interpolation of two unit vectors, or null
 * (Blender's `false`) for direct opposites.
 */
export function interpV3V3V3Slerp(a: Vec3, b: Vec3, t: number): Vec3 | null {
    const cosom = v3dot(a, b)
    // direct opposites
    if (cosom < -1 + FLT_EPSILON) return null
    const w = interpDotSlerp(t, cosom)
    return [w[0] * a[0] + w[1] * b[0], w[0] * a[1] + w[1] * b[1], w[0] * a[2] + w[1] * b[2]]
}

/** `bisect_v3_v3v3v3` (`math_vector.cc:549`): the unit bisector of the turn at `b`. */
export function bisectV3V3V3V3(a: Vec3, b: Vec3, c: Vec3): Vec3 {
    const d12 = v3sub(b, a)
    const d23 = v3sub(c, b)
    normalizeV3Len(d12)
    normalizeV3Len(d23)
    const r: Vec3 = [d12[0] + d23[0], d12[1] + d23[1], d12[2] + d23[2]]
    normalizeV3Len(r)
    return r
}

/** `closest_to_line_v3` (`math_geom.cc:3291`) through `closest_to_ray_v3` (`:3272`). */
export function closestToLineV3(p: Vec3, l1: Vec3, l2: Vec3): Vec3 {
    const rayDir = v3sub(l2, l1)
    if (rayDir[0] === 0 && rayDir[1] === 0 && rayDir[2] === 0) return [l1[0], l1[1], l1[2]]
    const h = v3sub(p, l1)
    const lambda = v3dot(rayDir, h) / v3dot(rayDir, rayDir)
    return [l1[0] + rayDir[0] * lambda, l1[1] + rayDir[1] * lambda, l1[2] + rayDir[2] * lambda]
}

// endregion

// region angles

/** `safe_asinf`: clamps into the domain first (`math_base_inline.cc`). */
export const safeAsin = (f: number): number => Math.asin(Math.max(-1, Math.min(1, f)))

/** `angle_normalized_v3v3` (`math_vector.cc:336`): more accurate than `acos(dot)` near 0 and pi. */
export function angleNormalizedV3V3(v1: Vec3, v2: Vec3): number {
    if (v3dot(v1, v2) >= 0) return 2 * safeAsin(lenV3V3(v1, v2) / 2)
    return Math.PI - 2 * safeAsin(lenV3V3(v1, negateV3(v2)) / 2)
}

// endregion

// region axes and bases

/** `ortho_basis_v3v3_v3` (`math_vector.cc:556`): two unit vectors perpendicular to `n` and each other. */
export function orthoBasisV3V3V3(n: Vec3): [Vec3, Vec3] {
    const f = n[0] * n[0] + n[1] * n[1]
    if (f > FLT_EPSILON) {
        const d = 1 / Math.sqrt(f)
        const n1: Vec3 = [n[1] * d, -n[0] * d, 0]
        const n2: Vec3 = [-n[2] * n1[1], n[2] * n1[0], n[0] * n1[1] - n[1] * n1[0]]
        return [n1, n2]
    }
    // degenerate case
    return [[n[2] < 0 ? -1 : 1, 0, 0], [0, 1, 0]]
}

/**
 * `axis_dominant_v3_to_m3` (`math_geom.cc:3646`): a basis whose third row is `normal`, so that
 * {@link mulV3M3V3} maps a point into a frame where the normal is +Z. `normal` must be unit length.
 */
export function axisDominantV3ToM3(normal: Vec3): Mat3Rows {
    const [n1, n2] = orthoBasisV3V3V3(normal)
    return [n1, n2, [normal[0], normal[1], normal[2]]]
}

/** `mul_v3_m3v3` for a {@link Mat3Rows}. */
export const mulV3M3V3 = (m: Mat3Rows, a: Vec3): Vec3 => [v3dot(m[0], a), v3dot(m[1], a), v3dot(m[2], a)]

// endregion

// region triangles and barycentric weights

/** `cross_tri_v2` (`math_geom_inline.cc:24`): twice the signed area. */
export const crossTriV2 = (v1: Vec2, v2: Vec2, v3: Vec2): number =>
    (v1[0] - v2[0]) * (v2[1] - v3[1]) + (v1[1] - v2[1]) * (v3[0] - v2[0])

/** `area_tri_signed_v2` (`math_geom_inline.cc:29`). */
export const areaTriSignedV2 = (v1: Vec2, v2: Vec2, v3: Vec2): number => 0.5 * crossTriV2(v1, v2, v3)

/** `area_tri_v2` (`math_geom_inline.cc:34`). */
export const areaTriV2 = (v1: Vec2, v2: Vec2, v3: Vec2): number => Math.abs(areaTriSignedV2(v1, v2, v3))

/** `cross_tri_v3` (`math_geom.cc:30`): the unnormalised normal. */
export const crossTriV3 = (v1: Vec3, v2: Vec3, v3: Vec3): Vec3 => v3cross(v3sub(v1, v2), v3sub(v2, v3))

/** `area_tri_v3` (`math_geom.cc:104`). */
export const areaTriV3 = (v1: Vec3, v2: Vec3, v3: Vec3): number => v3len(crossTriV3(v1, v2, v3)) * 0.5

/** `normal_tri_v3` (`math_geom.cc:45`) returning the normal; the length is the unnormalised one. */
export function normalTriV3(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
    return v3normalize(crossTriV3(v1, v2, v3))
}

/** `barycentric_weights_v2` (`math_geom.cc:3824`); a zero-area triangle gives thirds. */
export function barycentricWeightsV2(v1: Vec2, v2: Vec2, v3: Vec2, co: Vec2): [number, number, number] {
    const w: [number, number, number] = [crossTriV2(v2, v3, co), crossTriV2(v3, v1, co), crossTriV2(v1, v2, co)]
    const wtot = w[0] + w[1] + w[2]
    if (wtot !== 0) {
        w[0] /= wtot
        w[1] /= wtot
        w[2] /= wtot
        if (isFinite(w[0]) && isFinite(w[1]) && isFinite(w[2])) return w
    }
    return [1 / 3, 1 / 3, 1 / 3]
}

/**
 * `transform_point_by_tri_v3` (`math_geom.cc:4002`): where `ptSrc` sits relative to the source
 * triangle, re-expressed on the target triangle - barycentric weights in the plane plus the
 * off-plane offset scaled by the area ratio.
 */
export function transformPointByTriV3(ptSrc: Vec3, triTar: [Vec3, Vec3, Vec3], triSrc: [Vec3, Vec3, Vec3]): Vec3 {
    const noTar = normalTriV3(triTar[0], triTar[1], triTar[2])
    const noSrc = normalTriV3(triSrc[0], triSrc[1], triSrc[2])
    const matSrc = axisDominantV3ToM3(noSrc)

    // make the source tri xy space
    const ptSrcXy = mulV3M3V3(matSrc, ptSrc)
    const triXySrc = [mulV3M3V3(matSrc, triSrc[0]), mulV3M3V3(matSrc, triSrc[1]), mulV3M3V3(matSrc, triSrc[2])]
    const as2 = (v: Vec3): Vec2 => [v[0], v[1]]

    const wSrc = barycentricWeightsV2(as2(triXySrc[0]), as2(triXySrc[1]), as2(triXySrc[2]), as2(ptSrcXy))
    const ptTar = interpV3V3V3V3(triTar[0], triTar[1], triTar[2], wSrc)

    const areaTar = Math.sqrt(areaTriV3(triTar[0], triTar[1], triTar[2]))
    const areaSrc = Math.sqrt(areaTriV2(as2(triXySrc[0]), as2(triXySrc[1]), as2(triXySrc[2])))

    const zOfsSrc = ptSrcXy[2] - triXySrc[0][2]
    maddV3V3Fl(ptTar, noTar, zOfsSrc / areaSrc * areaTar)
    return ptTar
}

// endregion

// region planes

/** `plane_from_point_normal_v3` (`math_geom.cc:225`). */
export function planeFromPointNormalV3(planeCo: Vec3, planeNo: Vec3): Vec4 {
    return [planeNo[0], planeNo[1], planeNo[2], -v3dot(planeNo, planeCo)]
}

/** `determinant_m3` (`math_matrix_c.cc:1883`), with `determinant_m2` expanded. */
export function determinantM3(
    a1: number, a2: number, a3: number,
    b1: number, b2: number, b3: number,
    c1: number, c2: number, c3: number,
): number {
    return a1 * (b2 * c3 - b3 * c2) - b1 * (a2 * c3 - a3 * c2) + c1 * (a2 * b3 - a3 * b2)
}

/** `isect_plane_plane_plane_v3` (`math_geom.cc:2215`): the point three planes share, or null. */
export function isectPlanePlanePlaneV3(planeA: Vec4, planeB: Vec4, planeC: Vec4): Vec3 | null {
    const det = determinantM3(planeA[0], planeA[1], planeA[2], planeB[0], planeB[1], planeB[2], planeC[0], planeC[1], planeC[2])
    if (det === 0) return null
    const cross = (a: Vec4, b: Vec4): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const r: Vec3 = [0, 0, 0]
    let tmp = cross(planeC, planeB)
    r[0] = tmp[0] * planeA[3]
    r[1] = tmp[1] * planeA[3]
    r[2] = tmp[2] * planeA[3]
    tmp = cross(planeA, planeC)
    r[0] += tmp[0] * planeB[3]
    r[1] += tmp[1] * planeB[3]
    r[2] += tmp[2] * planeB[3]
    tmp = cross(planeB, planeA)
    r[0] += tmp[0] * planeC[3]
    r[1] += tmp[1] * planeC[3]
    r[2] += tmp[2] * planeC[3]
    const inv = 1 / det
    return [r[0] * inv, r[1] * inv, r[2] * inv]
}

/** `shell_v3v3_mid_normalized_to_dist` (`math_geom_inline.cc:148`); `a` and `b` unit length. */
export function shellV3V3MidNormalizedToDist(a: Vec3, b: Vec3): number {
    const ab: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
    const angleCos = normalizeV3Len(ab) !== 0 ? Math.abs(v3dot(a, ab)) : 0
    return angleCos < SMALL_NUMBER ? 1 : 1 / angleCos
}

// endregion

// region integer helpers

/** `divide_floor_i` (`math_base_inline.cc:228`). */
export function divideFloorI(a: number, b: number): number {
    const d = Math.trunc(a / b)
    const r = a % b
    return r ? d - ((a < 0 ? 1 : 0) ^ (b < 0 ? 1 : 0)) : d
}

/**
 * `BLI_FOREACH_SPARSE_RANGE(src, dst, i)` (`BLI_utildefines_iter.h:28`): `dst` indices spread evenly
 * over `[0, src)`, Bresenham style, which is how `BM_edgeloop_expand` picks which vertices to double.
 */
export function* foreachSparseRange(src: number, dst: number): Generator<number> {
    const src2 = src * 2
    const dst2 = dst * 2
    let error = dst2 - src
    let i = 0
    while (true) {
        const delta = divideFloorI(error, dst2)
        i -= delta
        if (!(i < src)) break
        yield i
        error -= delta * dst2 + src2
    }
}

// endregion
