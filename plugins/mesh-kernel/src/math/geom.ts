/**
 * Geometry helpers from Blender's `blenlib`, as the bridge, edge-net, grid-fill, connect, dissolve,
 * subdivide, edge-ring and slide ports need them.
 *
 * Ported from `blenlib/intern/math_vector.cc`, `math_vector_inline.cc`, `math_geom.cc`,
 * `math_geom_inline.cc`, `math_base_inline.cc`, `math_matrix_c.cc` and `math_rotation_c.cc`; each
 * function cites its origin. Blender works in `float`; these work in doubles, which the parity tests
 * absorb with a tolerance.
 *
 * Blender's `float m[3][3]` matrices are column-major (`m[col][row]`), and `axis_dominant_v3_to_m3`
 * transposes before returning, so `mul_v3_m3v3(r, m, a)` ends up as `r[i] = dot(basis_i, a)`. That
 * is what {@link Mat3Rows} stores: the three basis vectors as rows, so {@link mulV3M3V3} is three
 * dot products and nothing is transposed twice.
 */

import {Vec3, v3cross, v3dot, v3len, v3normalize, v3sub} from './index'

export type Vec2 = [number, number]

/** The rows of a 3x3 matrix, so `mulV3M3V3(m, a)[i] === dot(m[i], a)`. */
export type Mat3Rows = [Vec3, Vec3, Vec3]

/** A plane as `(normal, d)`: Blender's `float plane[4]`, with `dot(normal, p) + d = 0` on the plane. */
export type Vec4 = [number, number, number, number]

/** `isect_seg_seg_v2` return values (`BLI_math_geom.h`). */
export const ISECT_LINE_LINE_COLINEAR = -1
export const ISECT_LINE_LINE_NONE = 0
export const ISECT_LINE_LINE_EXACT = 1
export const ISECT_LINE_LINE_CROSS = 2

const FLT_EPSILON = 1.1920929e-7

/** `SMALL_NUMBER` (`BLI_math_base.h`). */
const SMALL_NUMBER = 1e-8

// region vectors

export const lenV2 = (v: Vec2): number => Math.sqrt(v[0] * v[0] + v[1] * v[1])
export const dotV2V2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
/** `cross_v2v2` (`math_vector_inline.cc:674`). */
export const crossV2V2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export const subV2V2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const equalsV2V2 = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1]
export const isZeroV3 = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0
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

// region angles

/** `safe_asinf`: clamps into the domain first (`math_base_inline.cc`). */
export const safeAsin = (f: number): number => Math.asin(Math.max(-1, Math.min(1, f)))

/** `angle_normalized_v3v3` (`math_vector.cc:336`): more accurate than `acos(dot)` near 0 and pi. */
export function angleNormalizedV3V3(v1: Vec3, v2: Vec3): number {
    if (v3dot(v1, v2) >= 0) return 2 * safeAsin(lenV3V3(v1, v2) / 2)
    return Math.PI - 2 * safeAsin(lenV3V3(v1, negateV3(v2)) / 2)
}

/** `angle_v3v3v3` (`math_vector.cc:252`): the angle at `b`. */
export function angleV3V3V3(a: Vec3, b: Vec3, c: Vec3): number {
    return angleNormalizedV3V3(v3normalize(v3sub(b, a)), v3normalize(v3sub(b, c)))
}

/** `angle_v3v3` (`math_vector.cc:275`). */
export function angleV3V3(a: Vec3, b: Vec3): number {
    return angleNormalizedV3V3(v3normalize(a), v3normalize(b))
}

/** `project_plane_normalized_v3_v3v3` (`math_vector.cc:529`); `vPlane` must be unit length. */
export function projectPlaneNormalizedV3V3V3(p: Vec3, vPlane: Vec3): Vec3 {
    const mul = v3dot(p, vPlane)
    return [p[0] - mul * vPlane[0], p[1] - mul * vPlane[1], p[2] - mul * vPlane[2]]
}

/** `angle_on_axis_v3v3_v3` (`math_vector.cc:383`): the angle between two vectors seen down `axis`. */
export function angleOnAxisV3V3V3(v1: Vec3, v2: Vec3, axis: Vec3): number {
    return angleV3V3(projectPlaneNormalizedV3V3V3(v1, axis), projectPlaneNormalizedV3V3V3(v2, axis))
}

/** `angle_signed_on_axis_v3v3_v3` (`math_vector.cc:392`), in `[0, 2pi)`. */
export function angleSignedOnAxisV3V3V3(v1: Vec3, v2: Vec3, axis: Vec3): number {
    const v1Proj = projectPlaneNormalizedV3V3V3(v1, axis)
    const v2Proj = projectPlaneNormalizedV3V3V3(v2, axis)
    let angle = angleV3V3(v1Proj, v2Proj)
    if (v3dot(v3cross(v2Proj, v1Proj), axis) < 0) angle = Math.PI * 2 - angle
    return angle
}

/** `angle_on_axis_v3v3v3_v3` (`math_vector.cc:399`): the angle at `v2` seen down `axis`. */
export function angleOnAxisV3V3V3V3(v1: Vec3, v2: Vec3, v3: Vec3, axis: Vec3): number {
    return angleOnAxisV3V3V3(v3sub(v1, v2), v3sub(v3, v2), axis)
}

/** `angle_signed_on_axis_v3v3v3_v3` (`math_vector.cc:411`). */
export function angleSignedOnAxisV3V3V3V3(v1: Vec3, v2: Vec3, v3: Vec3, axis: Vec3): number {
    return angleSignedOnAxisV3V3V3(v3sub(v1, v2), v3sub(v3, v2), axis)
}

// endregion

// region axes and bases

/** `axis_dominant_v3_single` (`math_geom_inline.cc:86`): the index of the largest component. */
export function axisDominantV3Single(v: Vec3): 0 | 1 | 2 {
    const x = Math.abs(v[0])
    const y = Math.abs(v[1])
    const z = Math.abs(v[2])
    return x > y ? x > z ? 0 : 2 : y > z ? 1 : 2
}

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

/** `ortho_v3_v3` (`math_vector.cc:593`): any vector perpendicular to `v`. */
export function orthoV3V3(v: Vec3): Vec3 {
    switch (axisDominantV3Single(v)) {
    case 0: return [-v[1] - v[2], v[0], v[0]]
    case 1: return [v[1], -v[0] - v[2], v[1]]
    default: return [v[2], v[2], -v[0] - v[1]]
    }
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

/** `mul_v2_m3v3`: the first two rows only. */
export const mulV2M3V3 = (m: Mat3Rows, a: Vec3): Vec2 => [v3dot(m[0], a), v3dot(m[1], a)]

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
 * `barycentric_weights_v2_quad` (`math_geom.cc:3893`): mean-value coordinates of `co` in a quad, the
 * weights grid fill blends its boundary with.
 */
export function barycentricWeightsV2Quad(v1: Vec2, v2: Vec2, v3: Vec2, v4: Vec2, co: Vec2): [number, number, number, number] {
    const dirs: Vec2[] = [
        [v1[0] - co[0], v1[1] - co[1]],
        [v2[0] - co[0], v2[1] - co[1]],
        [v3[0] - co[0], v3[1] - co[1]],
        [v4[0] - co[0], v4[1] - co[1]],
    ]
    const lens = [lenV2(dirs[0]), lenV2(dirs[1]), lenV2(dirs[2]), lenV2(dirs[3])]

    // avoid divide by zero
    for (let i = 0; i < 4; i++) {
        if (lens[i] < FLT_EPSILON) {
            const w: [number, number, number, number] = [0, 0, 0, 0]
            w[i] = 1
            return w
        }
    }

    const areas = [
        crossV2V2(dirs[0], dirs[1]), crossV2V2(dirs[1], dirs[2]),
        crossV2V2(dirs[2], dirs[3]), crossV2V2(dirs[3], dirs[0]),
    ]
    const dots = [
        dotV2V2(dirs[0], dirs[1]), dotV2V2(dirs[1], dirs[2]),
        dotV2V2(dirs[2], dirs[3]), dotV2V2(dirs[3], dirs[0]),
    ]
    const lensProd = [lens[0] * lens[1], lens[1] * lens[2], lens[2] * lens[3], lens[3] * lens[0]]

    // Handle cases where the point lies exactly on an edge.
    for (let i = 0; i < 4; i++) {
        // Collinear with edge i-j and between the endpoints.
        if (Math.abs(areas[i]) < 1.0e-12 * lensProd[i] && dots[i] <= 0) {
            const j = (i + 1) & 3
            const sum = lens[i] + lens[j]
            const w: [number, number, number, number] = [0, 0, 0, 0]
            w[i] = lens[j] / sum
            w[j] = lens[i] / sum
            return w
        }
    }

    // `MEAN_VALUE_HALF_TAN_V2`, with the `fabsf` Blender keeps for concave / bow-tie quads.
    const t = [0, 1, 2, 3].map(i => areas[i] !== 0 ? Math.abs((lensProd[i] - dots[i]) / areas[i]) : 0)
    const w: [number, number, number, number] = [
        (t[3] + t[0]) / lens[0],
        (t[0] + t[1]) / lens[1],
        (t[1] + t[2]) / lens[2],
        (t[2] + t[3]) / lens[3],
    ]
    const wtot = w[0] + w[1] + w[2] + w[3]
    if (wtot !== 0) {
        for (let i = 0; i < 4; i++) w[i] /= wtot
        if (w.every(isFinite)) return w
    }
    // Dummy values for a zero area face.
    return [0.25, 0.25, 0.25, 0.25]
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

// region quads and polygons

/**
 * `is_quad_flip_v3` (`math_geom.cc:5587`): bit 0 set when the quad is concave across the 1-3
 * diagonal, bit 1 across the 2-4 diagonal.
 */
export function isQuadFlipV3(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3): number {
    const d12 = v3sub(v1, v2)
    const d23 = v3sub(v2, v3)
    const d34 = v3sub(v3, v4)
    const d41 = v3sub(v4, v1)
    let ret = 0
    if (v3dot(v3cross(d12, d23), v3cross(d34, d41)) < 0) ret |= 1 << 0
    if (v3dot(v3cross(d23, d34), v3cross(d41, d12)) < 0) ret |= 1 << 1
    return ret
}

/** `is_poly_convex_v2` (`math_geom.cc:5551`): every turn has the same sign. */
export function isPolyConvexV2(verts: readonly Vec2[]): boolean {
    const nr = verts.length
    let signFlag = 0
    let coPrev = verts[nr - 1]
    let dirPrev = subV2V2(verts[nr - 2], coPrev)
    for (let a = 0; a < nr; a++) {
        const coCurr = verts[a]
        const dirCurr = subV2V2(coPrev, coCurr)
        const cross = crossV2V2(dirPrev, dirCurr)
        if (cross < 0) signFlag |= 1
        else if (cross > 0) signFlag |= 2
        if (signFlag === (1 | 2)) return false
        dirPrev = dirCurr
        coPrev = coCurr
    }
    return true
}

/** `isect_seg_seg_v2` (`math_geom.cc:1184`): one of the `ISECT_LINE_LINE_*` values. */
export function isectSegSegV2(v1: Vec2, v2: Vec2, v3: Vec2, v4: Vec2): number {
    const div = (v2[0] - v1[0]) * (v4[1] - v3[1]) - (v2[1] - v1[1]) * (v4[0] - v3[0])
    if (div === 0) return ISECT_LINE_LINE_COLINEAR

    const lambda = ((v1[1] - v3[1]) * (v4[0] - v3[0]) - (v1[0] - v3[0]) * (v4[1] - v3[1])) / div
    const mu = ((v1[1] - v3[1]) * (v2[0] - v1[0]) - (v1[0] - v3[0]) * (v2[1] - v1[1])) / div

    if (lambda >= 0 && lambda <= 1 && mu >= 0 && mu <= 1) {
        if (lambda === 0 || lambda === 1 || mu === 0 || mu === 1) return ISECT_LINE_LINE_EXACT
        return ISECT_LINE_LINE_CROSS
    }
    return ISECT_LINE_LINE_NONE
}

// endregion

// region integer helpers

/** `mod_i` (`math_base_inline.cc:255`): a modulo that is never negative. */
export const modI = (i: number, n: number): number => (i % n + n) % n

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

// region rotations, curves and lines (subdivide edge-ring's path interpolation)

/** A quaternion `[w, x, y, z]`, Blender's `float q[4]` order. */
export type Quat = [number, number, number, number]

/** `safe_acosf` (`math_base_inline.cc`): `acos` clamped into its domain. */
export const safeAcos = (a: number): number => a <= -1 ? Math.PI : a >= 1 ? 0 : Math.acos(a)

/** `unit_qt`. */
export const unitQt = (): Quat => [1, 0, 0, 0]

/** `mul_qt_qtqt` (`math_rotation_c.cc:64`): `a * b`. */
export function mulQtQtqt(a: Quat, b: Quat): Quat {
    const t0 = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3]
    const t1 = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2]
    const t2 = a[0] * b[2] + a[2] * b[0] + a[3] * b[1] - a[1] * b[3]
    const q3 = a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1]
    return [t0, t1, t2, q3]
}

/** `mul_qt_v3` (`math_rotation_c.cc:77`): rotate `r` by `q`, in place, Blender's two-step form. */
export function mulQtV3(q: Quat, r: Vec3): void {
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
}

/** `normalize_qt` (`math_rotation_c.cc:472`), in place; a zero quaternion becomes `(0, 1, 0, 0)`. */
export function normalizeQt(q: Quat): number {
    const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    if (len !== 0) {
        const f = 1 / len
        q[0] *= f
        q[1] *= f
        q[2] *= f
        q[3] *= f
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

/** `axis_angle_to_quat` (`math_rotation_c.cc:1075`): the identity for a zero axis. */
export function axisAngleToQuat(axis: Vec3, angle: number): Quat {
    const nor: Vec3 = [axis[0], axis[1], axis[2]]
    if (normalizeV3Len(nor) !== 0) return axisAngleNormalizedToQuat(nor, angle)
    return unitQt()
}

/**
 * `quat_to_mat3` (`math_rotation_c.cc:198`, `quat_to_mat3_no_error`), in Blender's `m[col][row]`
 * layout: `m[2]` is the image of the Z axis.
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
        [1.0 - qbb - qcc, qdc + qab, -qdb + qac],
        [-qdc + qab, 1.0 - qaa - qcc, qda + qbc],
        [qdb + qac, -qda + qbc, 1.0 - qaa - qbb],
    ]
}

/**
 * `vec_to_quat` (`math_rotation_c.cc:722`): the rotation taking `axis` (0..5 for +X, +Y, +Z, -X,
 * -Y, -Z) onto `vec`, rolled so that `upflag` (0..2) points up.
 */
export function vecToQuat(vec: Vec3, axis: number, upflag: number): Quat {
    const eps = 1e-4
    // first set the quat to unit
    let q = unitQt()

    const len = v3len(vec)
    if (len === 0) return q

    // rotate to axis
    let tvec: Vec3
    if (axis > 2) {
        tvec = [vec[0], vec[1], vec[2]]
        axis = axis - 3
    } else {
        tvec = [-vec[0], -vec[1], -vec[2]]
    }

    // "nasty! I need a good routine for this... problem is a rotation of an Y axis to the negative
    // Y-axis for example."
    const nor: Vec3 = [0, 0, 0]
    let co: number
    if (axis === 0) { // x-axis
        nor[0] = 0.0
        nor[1] = -tvec[2]
        nor[2] = tvec[1]
        if (Math.abs(tvec[1]) + Math.abs(tvec[2]) < eps) nor[1] = 1.0
        co = tvec[0]
    } else if (axis === 1) { // y-axis
        nor[0] = tvec[2]
        nor[1] = 0.0
        nor[2] = -tvec[0]
        if (Math.abs(tvec[0]) + Math.abs(tvec[2]) < eps) nor[2] = 1.0
        co = tvec[1]
    } else { // z-axis
        nor[0] = -tvec[1]
        nor[1] = tvec[0]
        nor[2] = 0.0
        if (Math.abs(tvec[0]) + Math.abs(tvec[1]) < eps) nor[0] = 1.0
        co = tvec[2]
    }
    co /= len

    normalizeV3Len(nor)

    q = axisAngleNormalizedToQuat(nor, safeAcos(co))

    if (axis !== upflag) {
        const mat = quatToMat3(q)
        const fp = mat[2]
        let angle: number
        if (axis === 0) {
            if (upflag === 1) angle = 0.5 * Math.atan2(fp[2], fp[1])
            else angle = -0.5 * Math.atan2(fp[1], fp[2])
        } else if (axis === 1) {
            if (upflag === 0) angle = -0.5 * Math.atan2(fp[2], fp[0])
            else angle = 0.5 * Math.atan2(fp[0], fp[2])
        } else {
            if (upflag === 0) angle = 0.5 * Math.atan2(-fp[1], -fp[0])
            else angle = -0.5 * Math.atan2(-fp[0], -fp[1])
        }

        co = Math.cos(angle)
        const si = Math.sin(angle) / len
        const q2: Quat = [co, tvec[0] * si, tvec[1] * si, tvec[2] * si]
        q = mulQtQtqt(q2, q)
    }
    return q
}

/** `bisect_v3_v3v3v3` (`math_vector.cc:549`): the normalised sum of the two segment directions at `b`. */
export function bisectV3V3V3(a: Vec3, b: Vec3, c: Vec3): Vec3 {
    const d12 = v3sub(b, a)
    const d23 = v3sub(c, b)
    normalizeV3Len(d12)
    normalizeV3Len(d23)
    const r: Vec3 = [d12[0] + d23[0], d12[1] + d23[1], d12[2] + d23[2]]
    normalizeV3Len(r)
    return r
}

/**
 * `BKE_curve_forward_diff_bezier` (`blenkernel/intern/curve.cc:1695`): `it + 1` evenly spaced
 * samples of one coordinate of a cubic Bezier, by forward differencing (which is why they differ from
 * direct evaluation in the last bits).
 */
export function curveForwardDiffBezier(q0: number, q1: number, q2: number, q3: number, it: number): number[] {
    let f = it
    const rt0 = q0
    const rt1 = 3.0 * (q1 - q0) / f
    f *= f
    const rt2 = 3.0 * (q0 - 2.0 * q1 + q2) / f
    f *= it
    const rt3 = (q3 - q0 + 3.0 * (q1 - q2)) / f

    q0 = rt0
    q1 = rt1 + rt2 + rt3
    q2 = 2 * rt2 + 6 * rt3
    q3 = 6 * rt3

    const out: number[] = []
    for (let a = 0; a <= it; a++) {
        out.push(q0)
        q0 += q1
        q1 += q2
        q2 += q3
    }
    return out
}

// endregion

// region vectors (subdivide, edge-ring, slide)

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
