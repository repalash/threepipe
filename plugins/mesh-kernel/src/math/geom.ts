/**
 * Geometry helpers from Blender's `blenlib`, as the bridge, edge-net, grid-fill, connect and
 * dissolve ports need them.
 *
 * Ported from `blenlib/intern/math_vector.cc`, `math_vector_inline.cc`, `math_geom.cc`,
 * `math_geom_inline.cc` and `math_base_inline.cc`; each function cites its origin. Blender works in
 * `float`; these work in doubles, which the parity tests absorb with a tolerance.
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

/** `isect_seg_seg_v2` return values (`BLI_math_geom.h`). */
export const ISECT_LINE_LINE_COLINEAR = -1
export const ISECT_LINE_LINE_NONE = 0
export const ISECT_LINE_LINE_EXACT = 1
export const ISECT_LINE_LINE_CROSS = 2

const FLT_EPSILON = 1.1920929e-7

// region vectors

export const lenV2 = (v: Vec2): number => Math.sqrt(v[0] * v[0] + v[1] * v[1])
export const dotV2V2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
/** `cross_v2v2` (`math_vector_inline.cc:674`). */
export const crossV2V2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export const subV2V2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const equalsV2V2 = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1]
export const isZeroV3 = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0
export const isFiniteV3 = (v: Vec3): boolean => isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2])
export const lenSquaredV3V3 = (a: Vec3, b: Vec3): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
export const lenV3V3 = (a: Vec3, b: Vec3): number => Math.sqrt(lenSquaredV3V3(a, b))
export const negateV3 = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]

/** `normalize_v2` returning the length, as Blender's does. */
export function normalizeV2(v: Vec2): number {
    const d = lenV2(v)
    if (d > 1.0e-35) {
        v[0] /= d
        v[1] /= d
    } else {
        v[0] = v[1] = 0
    }
    return d
}

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

/** `project_plane_v3_v3v3` (`math_vector.cc:521`): `p` with its component along `vPlane` removed. */
export function projectPlaneV3V3V3(p: Vec3, vPlane: Vec3): Vec3 {
    const mul = v3dot(p, vPlane) / v3dot(vPlane, vPlane)
    return [p[0] - mul * vPlane[0], p[1] - mul * vPlane[1], p[2] - mul * vPlane[2]]
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

/** `axis_dominant_v3_to_m3_negate` (`math_geom.cc:3663`): the same with the normal negated. */
export function axisDominantV3ToM3Negate(normal: Vec3): Mat3Rows {
    const neg = negateV3(normal)
    const [n1, n2] = orthoBasisV3V3V3(neg)
    return [n1, n2, neg]
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

/** `is_quad_convex_v3` (`math_geom.cc:5488`): projected onto the plane of its diagonals. */
export function isQuadConvexV3(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3): boolean {
    // non-unit length normal, used as a projection plane
    const plane = v3cross(v3sub(v1, v3), v3sub(v2, v4))
    const epsSq = 1e-8 * 1e-8
    if (v3dot(plane, plane) < epsSq) return false

    const quadProj = [v1, v2, v3, v4].map(q => projectPlaneV3V3V3(q, plane))
    const quadDirs: Vec3[] = []
    for (let i = 0, j = 3; i < 4; j = i++) quadDirs[i] = v3sub(quadProj[i], quadProj[j])

    const crossSign = (a: Vec3, b: Vec3) => v3dot(plane, v3cross(a, b)) > 0
    return crossSign(quadDirs[0], quadDirs[1]) && crossSign(quadDirs[1], quadDirs[2])
        && crossSign(quadDirs[2], quadDirs[3]) && crossSign(quadDirs[3], quadDirs[0])
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
