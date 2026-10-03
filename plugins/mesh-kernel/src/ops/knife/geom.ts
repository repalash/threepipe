/**
 * The BLI maths the knife and the edge-net split need, ported line for line.
 *
 * Sources: `source/blender/blenlib/intern/math_geom.cc`, `math_vector.cc`, `math_vector_inline.cc`
 * (Blender main e4e6c79a). Line numbers are cited per function.
 *
 * Kept inside the knife module rather than in `src/math`: the kernel's public maths is three.js-style
 * (`v3add`, ...), and two other branches are adding their own public `math/geom.ts`; exporting the same
 * Blender names from three places would collide at merge. Consolidating them is
 * `issues/open/modelling-tools/kernel-blender-math-duplicated.md`.
 *
 * Blender works in `float`; these run in doubles. Every epsilon is Blender's.
 */

export type V2 = [number, number]
export type V3 = [number, number, number]
/** A plane `[a, b, c, d]`, `a*x + b*y + c*z + d = 0`. */
export type V4 = [number, number, number, number]
/** A 4x4 matrix, column-major (`m[c * 4 + r]`) - Blender's `float[4][4]` (`M[c][r]`) and three.js' order. */
export type M4 = number[]
/** A 3x3 projection to 2D as rows: `mul_v2_m3v3(r, M, a)` is `[dot(rows[0], a), dot(rows[1], a)]`. */
export type AxisMat = [V3, V3, V3]

export const FLT_EPSILON = 1.1920928955078125e-7
export const FLT_MIN = 1.1754943508222875e-38
export const FLT_MAX = 3.4028234663852886e38

export const sub3 = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add3 = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const mul3 = (a: readonly number[], f: number): V3 => [a[0] * f, a[1] * f, a[2] * f]
export const madd3 = (a: readonly number[], b: readonly number[], f: number): V3 => [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f]
export const dot3 = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross3 = (a: readonly number[], b: readonly number[]): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
]
export const lenSq3 = (a: readonly number[]): number => dot3(a, a)
export const len3 = (a: readonly number[]): number => Math.sqrt(dot3(a, a))
export const lenSqV3V3 = (a: readonly number[], b: readonly number[]): number => lenSq3(sub3(a, b))
export const lenV3V3 = (a: readonly number[], b: readonly number[]): number => Math.sqrt(lenSqV3V3(a, b))
export const interp3 = (a: readonly number[], b: readonly number[], t: number): V3 => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
]
export const mid3 = (a: readonly number[], b: readonly number[]): V3 => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]
export const isZero3 = (a: readonly number[]): boolean => a[0] === 0 && a[1] === 0 && a[2] === 0
export const equals3 = (a: readonly number[], b: readonly number[]): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
/** `compare_v3v3` (`math_vector_inline.cc`): every component within `limit`. */
export const compare3 = (a: readonly number[], b: readonly number[], limit: number): boolean =>
    Math.abs(a[0] - b[0]) <= limit && Math.abs(a[1] - b[1]) <= limit && Math.abs(a[2] - b[2]) <= limit

export const sub2 = (a: readonly number[], b: readonly number[]): V2 => [a[0] - b[0], a[1] - b[1]]
export const dot2 = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1]
export const cross2 = (a: readonly number[], b: readonly number[]): number => a[0] * b[1] - a[1] * b[0]
export const lenSq2 = (a: readonly number[]): number => a[0] * a[0] + a[1] * a[1]
export const lenSqV2V2 = (a: readonly number[], b: readonly number[]): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
export const lenV2V2 = (a: readonly number[], b: readonly number[]): number => Math.sqrt(lenSqV2V2(a, b))
export const mid2 = (a: readonly number[], b: readonly number[]): V2 => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
export const equals2 = (a: readonly number[], b: readonly number[]): boolean => a[0] === b[0] && a[1] === b[1]
export const isZero2 = (a: readonly number[]): boolean => a[0] === 0 && a[1] === 0

/** `normalize_v3_v3_length` (`math_vector_inline.cc:872`): zero for tiny vectors. Returns `[unit, length]`. */
export function normalize3(a: readonly number[]): [V3, number] {
    const d = dot3(a, a)
    if (d > 1.0e-35) {
        const l = Math.sqrt(d)
        return [[a[0] / l, a[1] / l, a[2] / l], l]
    }
    return [[0, 0, 0], 0]
}

/** `normalize_v2_v2_length` (`math_vector_inline.cc:841`). */
export function normalize2(a: readonly number[]): [V2, number] {
    const d = dot2(a, a)
    if (d > 1.0e-35) {
        const l = Math.sqrt(d)
        return [[a[0] / l, a[1] / l], l]
    }
    return [[0, 0], 0]
}

/** `safe_asinf`. */
const safeAsin = (f: number): number => f <= -1 ? -Math.PI / 2 : f >= 1 ? Math.PI / 2 : Math.asin(f)

/** `angle_normalized_v3v3` (`math_vector.cc:336`). */
export function angleNormalizedV3V3(v1: readonly number[], v2: readonly number[]): number {
    if (dot3(v1, v2) >= 0) return 2 * safeAsin(lenV3V3(v1, v2) / 2)
    return Math.PI - 2 * safeAsin(lenV3V3(v1, mul3(v2, -1)) / 2)
}

/** `angle_v3v3` (`math_vector.cc:276`). */
export const angleV3V3 = (a: readonly number[], b: readonly number[]): number => angleNormalizedV3V3(normalize3(a)[0], normalize3(b)[0])

/** `project_plane_normalized_v3_v3v3` (`math_vector.cc:529`). */
export const projectPlaneNormalized = (p: readonly number[], vPlane: readonly number[]): V3 => madd3(p, vPlane, -dot3(p, vPlane))

/** `angle_signed_on_axis_v3v3_v3` (`math_vector.cc:379`): in `[0, 2pi)`. */
export function angleSignedOnAxisV3V3V3(v1: readonly number[], v2: readonly number[], axis: readonly number[]): number {
    const v1p = projectPlaneNormalized(v1, axis)
    const v2p = projectPlaneNormalized(v2, axis)
    let angle = angleV3V3(v1p, v2p)
    if (dot3(cross3(v2p, v1p), axis) < 0) angle = Math.PI * 2 - angle
    return angle
}

/** `angle_signed_on_axis_v3v3v3_v3` (`math_vector.cc:412`): the angle at `v2`. */
export const angleSignedOnAxisV3V3V3V3 = (v1: readonly number[], v2: readonly number[], v3: readonly number[], axis: readonly number[]): number =>
    angleSignedOnAxisV3V3V3(sub3(v1, v2), sub3(v3, v2), axis)

/** `rotate_normalized_v3_v3v3fl` (`math_vector.cc:637`). */
export function rotateNormalizedV3(p: readonly number[], axis: readonly number[], angle: number): V3 {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [
        ((c + (1 - c) * axis[0] * axis[0]) * p[0]) + (((1 - c) * axis[0] * axis[1] - axis[2] * s) * p[1]) + (((1 - c) * axis[0] * axis[2] + axis[1] * s) * p[2]),
        (((1 - c) * axis[0] * axis[1] + axis[2] * s) * p[0]) + ((c + (1 - c) * axis[1] * axis[1]) * p[1]) + (((1 - c) * axis[1] * axis[2] - axis[0] * s) * p[2]),
        (((1 - c) * axis[0] * axis[2] - axis[1] * s) * p[0]) + (((1 - c) * axis[1] * axis[2] + axis[0] * s) * p[1]) + ((c + (1 - c) * axis[2] * axis[2]) * p[2]),
    ]
}

/** `ortho_basis_v3v3_v3` (`math_vector.cc:568`). */
export function orthoBasis(n: readonly number[]): [V3, V3] {
    const f = n[0] * n[0] + n[1] * n[1]
    if (f > FLT_EPSILON) {
        const d = 1 / Math.sqrt(f)
        const r1: V3 = [n[1] * d, -n[0] * d, 0]
        const r2: V3 = [-n[2] * r1[1], n[2] * r1[0], n[0] * r1[1] - n[1] * r1[0]]
        return [r1, r2]
    }
    return [[n[2] < 0 ? -1 : 1, 0, 0], [0, 1, 0]]
}

/** `axis_dominant_v3_to_m3` (`math_geom.cc:3646`), as rows (the matrix is transposed there). */
export function axisDominantV3ToM3(normal: readonly number[]): AxisMat {
    const [n1, n2] = orthoBasis(normal)
    return [n1, n2, [normal[0], normal[1], normal[2]]]
}

/** `mul_v2_m3v3` with an {@link AxisMat}. */
export const mulV2M3V3 = (m: AxisMat, a: readonly number[]): V2 => [dot3(m[0], a), dot3(m[1], a)]

/** `mul_project_m4_v3_zfac` (`math_vector_inline.cc:464`). */
export const mulProjectM4V3Zfac = (m: M4, co: readonly number[]): number => m[3] * co[0] + m[7] * co[1] + m[11] * co[2] + m[15]

/** `dot_m4_v3_row_z` (`math_vector_inline.cc:490`). */
export const dotM4V3RowZ = (m: M4, a: readonly number[]): number => m[2] * a[0] + m[6] * a[1] + m[10] * a[2]

/** `mul_m4_v3` / `mul_v3_m4v3`: the point transform, no divide. */
export const mulM4V3 = (m: M4, v: readonly number[]): V3 => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
]

/** `mul_mat3_m4_v3`: the 3x3 part only. */
export const mulMat3M4V3 = (m: M4, v: readonly number[]): V3 => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
]

/** `mul_transposed_mat3_m4_v3`: the transpose of the 3x3 part. */
export const mulTransposedMat3M4V3 = (m: M4, v: readonly number[]): V3 => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
]

/** `mul_project_m4_v3` (`math_matrix.cc`): transform then divide by `w`. */
export function mulProjectM4V3(m: M4, v: readonly number[]): V3 {
    const w = mulProjectM4V3Zfac(m, v)
    const r = mulM4V3(m, v)
    return [r[0] / w, r[1] / w, r[2] / w]
}

/** `m[c]` as a vector: `viewinv[2]`, `viewinv[3]`. */
export const m4Col = (m: M4, c: number): V3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]

export function mulM4M4(a: M4, b: M4): M4 {
    const out = new Array<number>(16)
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
        }
    }
    return out
}

/** `invert_m4_m4`, by cofactors (three.js' `Matrix4.invert` order). Returns zeros when singular. */
export function invertM4(m: M4): M4 {
    const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m
    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
    if (det === 0) return new Array(16).fill(0)
    const d = 1 / det
    return [
        t11 * d,
        (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
        (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
        (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
        t12 * d,
        (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
        (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
        (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
        t13 * d,
        (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
        (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
        (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
        t14 * d,
        (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
        (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
        (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
    ]
}

// region planes

/** `plane_from_point_normal_v3`. */
export const planeFromPointNormal = (co: readonly number[], no: readonly number[]): V4 => [no[0], no[1], no[2], -dot3(no, co)]

/** `plane_point_side_v3`. */
export const planePointSide = (plane: readonly number[], co: readonly number[]): number => dot3(plane, co) + plane[3]

/** `dist_squared_to_plane_v3` (`math_geom.cc:486`). */
export function distSquaredToPlane(p: readonly number[], plane: readonly number[]): number {
    const lenSq = lenSq3(plane)
    const fac = planePointSide(plane, p) / lenSq
    return lenSq * (fac * fac)
}

/** `dist_signed_squared_to_plane_v3` (`math_geom.cc:479`). */
export function distSignedSquaredToPlane(p: readonly number[], plane: readonly number[]): number {
    const lenSq = lenSq3(plane)
    const side = planePointSide(plane, p)
    const fac = side / lenSq
    const r = lenSq * (fac * fac)
    // `copysignf`: carries the sign of `side`, including `-0`.
    return side < 0 || Object.is(side, -0) ? -r : r
}

/** `dist_signed_squared_to_plane3_v3` (`math_geom.cc:495`). */
function distSignedSquaredToPlane3(p: readonly number[], plane: readonly number[]): number {
    const lenSq = lenSq3(plane)
    const side = dot3(plane, p)
    const fac = side / lenSq
    const r = lenSq * (fac * fac)
    // `copysignf`: carries the sign of `side`, including `-0`.
    return side < 0 || Object.is(side, -0) ? -r : r
}

/** `dist_signed_squared_to_corner_v3v3v3` (`math_geom.cc:562`). */
export function distSignedSquaredToCorner(p: readonly number[], v1: readonly number[], v2: readonly number[], v3: readonly number[], axisRef: readonly number[]): number {
    const dirA = sub3(v1, v2)
    const dirB = sub3(v3, v2)
    let axis = cross3(dirA, dirB)
    let flip = false
    if (lenSq3(axis) < FLT_EPSILON) {
        axis = [axisRef[0], axisRef[1], axisRef[2]]
    } else if (dot3(axis, axisRef) < 0) {
        // concave
        flip = true
        axis = mul3(axis, -1)
    }
    const planeA = cross3(dirA, axis)
    const planeB = cross3(axis, dirB)
    const sPV2 = sub3(p, v2)
    const distA = distSignedSquaredToPlane3(sPV2, planeA)
    const distB = distSignedSquaredToPlane3(sPV2, planeB)
    return flip ? Math.min(distA, distB) : Math.max(distA, distB)
}

// endregion

// region lines and segments

/** `closest_to_line_v2` (`math_geom.cc:3298`). */
export function closestToLineV2(p: readonly number[], l1: readonly number[], l2: readonly number[]): [V2, number] {
    const u = sub2(l2, l1)
    const h = sub2(p, l1)
    const denom = dot2(u, u)
    if (denom === 0) return [[l1[0], l1[1]], 0]
    const lambda = dot2(u, h) / denom
    return [[l1[0] + u[0] * lambda, l1[1] + u[1] * lambda], lambda]
}

/** `closest_to_line_segment_v2` (`math_geom.cc:381`). */
export function closestToLineSegmentV2(p: readonly number[], l1: readonly number[], l2: readonly number[]): V2 {
    const [cp, lambda] = closestToLineV2(p, l1, l2)
    // flip checks for !finite case (when segment is a point)
    if (lambda <= 0) return [l1[0], l1[1]]
    if (lambda >= 1) return [l2[0], l2[1]]
    return cp
}

/** `dist_squared_to_line_segment_v2` (`math_geom.cc:307`). */
export const distSquaredToLineSegmentV2 = (p: readonly number[], l1: readonly number[], l2: readonly number[]): number =>
    lenSqV2V2(closestToLineSegmentV2(p, l1, l2), p)

/** `line_point_factor_v3_ex` (`math_geom.cc:3354`). */
export function linePointFactorV3(p: readonly number[], l1: readonly number[], l2: readonly number[], epsilon = 0, fallback = 0): number {
    const u = sub3(l2, l1)
    const h = sub3(p, l1)
    const dot = lenSq3(u)
    return dot > epsilon ? dot3(u, h) / dot : fallback
}

/** `line_point_factor_v2_ex` (`math_geom.cc:3374`). */
export function linePointFactorV2(p: readonly number[], l1: readonly number[], l2: readonly number[], epsilon = 0, fallback = 0): number {
    const u = sub2(l2, l1)
    const h = sub2(p, l1)
    const dot = lenSq2(u)
    return dot > epsilon ? dot2(u, h) / dot : fallback
}

/** `transform_point_by_seg_v3` (`math_geom.cc:4046`). */
export const transformPointBySegV3 = (pSrc: readonly number[], lDst1: readonly number[], lDst2: readonly number[], lSrc1: readonly number[], lSrc2: readonly number[]): V3 =>
    interp3(lDst1, lDst2, linePointFactorV3(pSrc, lSrc1, lSrc2))

/**
 * `isect_seg_seg_v2_point_ex` (`math_geom.cc:1271`). Returns `[kind, point]`: 1 for an intersection,
 * -1 for none.
 */
export function isectSegSegV2PointEx(
    v0In: readonly number[], v1In: readonly number[], v2In: readonly number[], v3In: readonly number[], endpointBias: number,
): [number, V2 | null] {
    let v0 = v0In, v1 = v1In, v2 = v2In, v3 = v3In
    const eps = 1e-6
    const endpointMin = -endpointBias
    const endpointMax = endpointBias + 1
    let s10 = sub2(v1, v0)
    const s32 = sub2(v3, v2)
    let s30 = sub2(v3, v0)
    const d = cross2(s10, s32)
    if (d !== 0) {
        const u = cross2(s30, s32) / d
        let v = cross2(s10, s30) / d
        if ((u >= endpointMin && u <= endpointMax) && (v >= endpointMin && v <= endpointMax)) {
            // intersection
            const viTest: V2 = [v0[0] + s10[0] * u, v0[1] + s10[1] * u]
            // Re-calculate 'v' to ensure the point overlaps both (#45123).
            const sViV2 = sub2(viTest, v2)
            v = dot2(s32, sViV2) / dot2(s32, s32)
            if (v >= endpointMin && v <= endpointMax) return [1, viTest]
        }
        // out of segment intersection
        return [-1, null]
    }
    if (cross2(s10, s30) === 0 && cross2(s32, s30) === 0) {
        // equal lines
        if (equals2(v0, v1)) {
            if (lenSqV2V2(v2, v3) > eps * eps) {
                // use non-point segment as basis
                [v0, v2] = [v2, v0]
                ;[v1, v3] = [v3, v1]
                s10 = sub2(v1, v0)
                s30 = sub2(v3, v0)
            } else {
                // both of segments are points
                if (equals2(v0, v2)) return [1, [v0[0], v0[1]]]
                return [-1, null]
            }
        }
        const s20 = sub2(v2, v0)
        let uA = dot2(s20, s10) / dot2(s10, s10)
        let uB = dot2(s30, s10) / dot2(s10, s10)
        if (uA > uB) [uA, uB] = [uB, uA]
        if (uA > endpointMax || uB < endpointMin) return [-1, null]
        if (Math.max(0, uA) === Math.min(1, uB)) {
            const t = Math.max(0, uA)
            return [1, [v0[0] + s10[0] * t, v0[1] + s10[1] * t]]
        }
    }
    // lines are collinear
    return [-1, null]
}

/** `isect_ray_seg_v2` (`math_geom.cc:2096`). Returns the ray factor, or null. */
export function isectRaySegV2(rayOrigin: readonly number[], rayDirection: readonly number[], v0: readonly number[], v1: readonly number[]): number | null {
    const v0Local = sub2(v0, rayOrigin)
    const v1Local = sub2(v1, rayOrigin)
    const s10 = sub2(v1Local, v0Local)
    const det = cross2(rayDirection, s10)
    if (det !== 0) {
        const v = cross2(v0Local, v1Local)
        const p: V2 = [(rayDirection[0] * v) / det, (rayDirection[1] * v) / det]
        const t = dot2(p, rayDirection) / dot2(rayDirection, rayDirection)
        if (!(t >= 0)) return null
        const h = sub2(v1Local, p)
        const u = dot2(s10, h) / dot2(s10, s10)
        if (!(u >= 0 && u <= 1)) return null
        return t
    }
    return null
}

// endregion

// region rays

/** `isect_ray_tri_epsilon_v3` (`math_geom.cc:1848`). Returns `[lambda, u, v]` or null. */
export function isectRayTriEpsilonV3(
    rayOrigin: readonly number[], rayDirection: readonly number[],
    v0: readonly number[], v1: readonly number[], v2: readonly number[], epsilon: number,
): [number, number, number] | null {
    const e1 = sub3(v1, v0)
    const e2 = sub3(v2, v0)
    const p = cross3(rayDirection, e2)
    const a = dot3(e1, p)
    if (a === 0) return null
    const f = 1 / a
    const s = sub3(rayOrigin, v0)
    const u = f * dot3(s, p)
    if (u < -epsilon || u > 1 + epsilon) return null
    const q = cross3(s, e1)
    const v = f * dot3(rayDirection, q)
    if (v < -epsilon || u + v > 1 + epsilon) return null
    const lambda = f * dot3(e2, q)
    if (lambda < 0) return null
    return [lambda, u, v]
}

/** `IsectRayPrecalc` and `isect_ray_tri_watertight_v3_precalc` (`math_geom.cc:1897`). */
export interface IsectRayPrecalc {kx: number, ky: number, kz: number, sx: number, sy: number, sz: number}

export function isectRayTriWatertightPrecalc(dir: readonly number[]): IsectRayPrecalc {
    // `axis_dominant_v3_single`
    const xn = Math.abs(dir[0]), yn = Math.abs(dir[1]), zn = Math.abs(dir[2])
    const kz = (zn >= xn && zn >= yn) ? 2 : (yn >= xn) ? 1 : 0
    let kx = kz !== 2 ? kz + 1 : 0
    let ky = kx !== 2 ? kx + 1 : 0
    // Swap kx and ky dimensions to preserve winding direction of triangles.
    if (dir[kz] < 0) [kx, ky] = [ky, kx]
    const invDirZ = 1 / dir[kz]
    return {kx, ky, kz, sx: dir[kx] * invDirZ, sy: dir[ky] * invDirZ, sz: invDirZ}
}

/** `isect_ray_tri_watertight_v3` (`math_geom.cc:1924`). Returns `[lambda, u, v]` or null. */
export function isectRayTriWatertightV3(
    rayOrigin: readonly number[], pre: IsectRayPrecalc,
    v0: readonly number[], v1: readonly number[], v2: readonly number[],
): [number, number, number] | null {
    const {kx, ky, kz, sx, sy, sz} = pre
    const a = sub3(v0, rayOrigin)
    const b = sub3(v1, rayOrigin)
    const c = sub3(v2, rayOrigin)
    const ax = a[kx] - sx * a[kz]
    const ay = a[ky] - sy * a[kz]
    const bx = b[kx] - sx * b[kz]
    const by = b[ky] - sy * b[kz]
    const cx = c[kx] - sx * c[kz]
    const cy = c[ky] - sy * c[kz]
    const u = cx * by - cy * bx
    const v = ax * cy - ay * cx
    const w = bx * ay - by * ax
    if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) return null
    const det = u + v + w
    if (det === 0 || !isFinite(det)) return null
    const t = (u * a[kz] + v * b[kz] + w * c[kz]) * sz
    // `xor_fl(t, sign_det)`: flip the sign of `t` when `det` is negative.
    const signT = det < 0 || Object.is(det, -0) ? -t : t
    if (signT < 0) return null
    const invDet = 1 / det
    return [t * invDet, u * invDet, v * invDet]
}

/** `interp_v3_v3v3v3_uv` (`math_vector.cc:166`). */
export const interpV3V3V3Uv = (v1: readonly number[], v2: readonly number[], v3: readonly number[], u: number, v: number): V3 => [
    v1[0] + (v2[0] - v1[0]) * u + (v3[0] - v1[0]) * v,
    v1[1] + (v2[1] - v1[1]) * u + (v3[1] - v1[1]) * v,
    v1[2] + (v2[2] - v1[2]) * u + (v3[2] - v1[2]) * v,
]

/** `normal_tri_v3`. */
export const normalTriV3 = (v1: readonly number[], v2: readonly number[], v3: readonly number[]): V3 => normalize3(cross3(sub3(v1, v2), sub3(v2, v3)))[0]

/** `isect_ray_plane_v3_factor` (`math_geom.cc:1815`). */
export function isectRayPlaneV3Factor(rayOrigin: readonly number[], rayDirection: readonly number[], planeCo: readonly number[], planeNo: readonly number[]): number | null {
    const dot = dot3(planeNo, rayDirection)
    if (dot === 0) return null
    return -dot3(planeNo, sub3(rayOrigin, planeCo)) / dot
}

/** `isect_ray_plane_v3` (`math_geom.cc:1831`), via `plane_to_point_vector_v3`. */
export function isectRayPlaneV3(rayOrigin: readonly number[], rayDirection: readonly number[], plane: readonly number[], clip: boolean): number | null {
    // `plane_to_point_vector_v3`: co = -d * n / |n|^2, no = n.
    const lenSq = lenSq3(plane)
    const planeCo = mul3(plane, -plane[3] / lenSq)
    const lambda = isectRayPlaneV3Factor(rayOrigin, rayDirection, planeCo, plane)
    if (lambda === null) return null
    if (clip && lambda < 0) return null
    return lambda
}

/** `isect_ray_line_v3` (`math_geom.cc:2142`). */
export function isectRayLineV3(rayOrigin: readonly number[], rayDirection: readonly number[], v0: readonly number[], v1: readonly number[]): number | null {
    const a = sub3(v1, v0)
    const t = sub3(v0, rayOrigin)
    const n = cross3(a, rayDirection)
    const nlen = lenSq3(n)
    // The lines are parallel.
    if (nlen === 0) return null
    const c = sub3(n, t)
    const cray = cross3(c, rayDirection)
    return dot3(cray, n) / nlen
}

/** `closest_ray_to_segment_v3` (`math_geom.cc:425`). */
export function closestRayToSegmentV3(rayOrigin: readonly number[], rayDirection: readonly number[], v0: readonly number[], v1: readonly number[]): V3 {
    const lambda = isectRayLineV3(rayOrigin, rayDirection, v0, v1)
    if (lambda === null || lambda <= 0) return [v0[0], v0[1], v0[2]]
    if (lambda >= 1) return [v1[0], v1[1], v1[2]]
    return interp3(v0, v1, lambda)
}

/** `isect_line_plane_v3` (`math_geom.cc:2192`). */
export function isectLinePlaneV3(l1: readonly number[], l2: readonly number[], planeCo: readonly number[], planeNo: readonly number[]): V3 | null {
    const u = sub3(l2, l1)
    const h = sub3(l1, planeCo)
    const dot = dot3(planeNo, u)
    if (Math.abs(dot) > FLT_EPSILON) {
        const lambda = -dot3(planeNo, h) / dot
        return madd3(l1, u, lambda)
    }
    // The segment is parallel to plane
    return null
}

/** `isect_ray_ray_epsilon_v3` (`math_geom.cc:3118`) with `FLT_MIN`, as `isect_ray_ray_v3` (`:3154`). Returns `lambda_a`. */
export function isectRayRayV3(originA: readonly number[], dirA: readonly number[], originB: readonly number[], dirB: readonly number[]): number | null {
    const n = cross3(dirB, dirA)
    const nlen = lenSq3(n)
    // The lines are parallel.
    if (nlen < FLT_MIN) return null
    const t = sub3(originB, originA)
    const c = sub3(n, t)
    const cray = cross3(c, dirB)
    return dot3(cray, n) / nlen
}

// endregion

/** `is_quad_flip_v3_first_third_fast` (`math_geom.cc:5609`). */
export function isQuadFlipV3FirstThirdFast(v1: readonly number[], v2: readonly number[], v3: readonly number[], v4: readonly number[]): boolean {
    const d12 = sub3(v2, v1)
    const d13 = sub3(v3, v1)
    const d14 = sub3(v4, v1)
    return dot3(cross3(d12, d13), cross3(d14, d13)) > 0
}

/** `isect_point_poly_v2` (`math_geom.cc:1533`). */
export function isectPointPolyV2(pt: readonly number[], verts: readonly (readonly number[])[], nr: number): boolean {
    let isect = false
    for (let i = 0, j = nr - 1; i < nr; j = i++) {
        if (((verts[i][1] > pt[1]) !== (verts[j][1] > pt[1])) &&
            (pt[0] < (verts[j][0] - verts[i][0]) * (pt[1] - verts[i][1]) / (verts[j][1] - verts[i][1]) + verts[i][0])) {
            isect = !isect
        }
    }
    return isect
}
