/**
 * Vector and matrix helpers the transform port needs, ported from Blender's `blenlib`.
 *
 * Conventions follow Blender so the ported code reads one-to-one against the original:
 * - `Vec3` is a `[x, y, z]` tuple (the kernel's type).
 * - `Mat3` is Blender's `float m[3][3]`: `m[i]` is the i-th **column** (basis vector), and
 *   {@link mulM3V3} is `mul_m3_v3`: `r[j] = m[0][j]*v[0] + m[1][j]*v[1] + m[2][j]*v[2]`
 *   (`math_matrix_c.cc:824`).
 * - `Mat4` is a 16-entry column-major array, the layout three.js uses, so `m[12..14]` is the
 *   translation and `m[i*4 + j]` is Blender's `m[i][j]`.
 *
 * Only the functions whose exact behaviour matters for parity are ported here; the citations give
 * the file and line in `.repos/blender/source/blender/blenlib/intern/`.
 */

import type {Vec3} from '@threepipe/mesh-kernel'

export type {Vec3}
export type Vec2 = [number, number]
export type Vec4 = [number, number, number, number]
/** Three column vectors, Blender's `float m[3][3]`. */
export type Mat3 = [Vec3, Vec3, Vec3]
/** 16 numbers, column-major as in three.js `Matrix4.elements`. */
export type Mat4 = number[]

export const FLT_MAX = 3.4028234663852886e38
export const FLT_EPSILON = 1.1920928955078125e-7
export const FLT_MIN = 1.1754943508222875e-38

// region vectors

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z]
export const copyV3 = (a: Vec3): Vec3 => [a[0], a[1], a[2]]
export const addV3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const subV3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mulV3Fl = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const negV3 = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]]
export const dotV3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const crossV3 = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
]
export const lenSquaredV3 = (a: Vec3): number => dotV3(a, a)
export const lenV3 = (a: Vec3): number => Math.sqrt(dotV3(a, a))
export const lenV3V3 = (a: Vec3, b: Vec3): number => lenV3(subV3(a, b))
export const lenSquaredV3V3 = (a: Vec3, b: Vec3): number => lenSquaredV3(subV3(a, b))
export const isZeroV3 = (a: Vec3): boolean => a[0] === 0 && a[1] === 0 && a[2] === 0
export const midV3 = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]
export const interpV3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
]
/** `madd_v3_v3v3fl`: `a + b * f`. */
export const maddV3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f]

/** `normalize_v3_v3`: returns the length before normalising, 0 when the vector was zero. */
export function normalizeV3(a: Vec3): number {
    const d = dotV3(a, a)
    if (d > 1.0e-35) {
        const len = Math.sqrt(d)
        a[0] /= len
        a[1] /= len
        a[2] /= len
        return len
    }
    a[0] = a[1] = a[2] = 0
    return 0
}

export function normalizedV3(a: Vec3): Vec3 {
    const r = copyV3(a)
    normalizeV3(r)
    return r
}

/** `normalize_v3_v3_length`: `out = a / |a| * unit_length`. */
export function normalizeV3Length(a: Vec3, unitLength: number): Vec3 {
    const r = copyV3(a)
    const d = dotV3(r, r)
    if (d > 1.0e-35) {
        const len = Math.sqrt(d)
        return mulV3Fl(r, unitLength / len)
    }
    return [0, 0, 0]
}

export const lenV2 = (a: Vec2): number => Math.hypot(a[0], a[1])
export const lenV2V2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1])
export const dotV2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
export const crossV2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export function normalizeV2(a: Vec2): number {
    const d = a[0] * a[0] + a[1] * a[1]
    if (d > 1.0e-35) {
        const len = Math.sqrt(d)
        a[0] /= len
        a[1] /= len
        return len
    }
    a[0] = a[1] = 0
    return 0
}

/** `project_v3_v3v3`: the component of `p` along `v_proj` (`math_vector.cc:510`). */
export function projectV3V3V3(p: Vec3, vProj: Vec3): Vec3 {
    const d = dotV3(vProj, vProj)
    if (d === 0) return [0, 0, 0]
    const mul = dotV3(p, vProj) / d
    return mulV3Fl(vProj, mul)
}

/** `project_plane_v3_v3v3`: `p` with its component along `v_plane` removed (`math_vector.cc:522`). */
export function projectPlaneV3V3V3(p: Vec3, vPlane: Vec3): Vec3 {
    const mul = dotV3(p, vPlane) / dotV3(vPlane, vPlane)
    return maddV3(p, vPlane, -mul)
}

/** `project_plane_normalized_v3_v3v3` (`math_vector.cc:529`): `v_plane` must be unit length. */
export function projectPlaneNormalizedV3V3V3(p: Vec3, vPlane: Vec3): Vec3 {
    const mul = dotV3(p, vPlane)
    return maddV3(p, vPlane, -mul)
}

/** `angle_v3v3`: the unsigned angle between two vectors (`math_vector.cc`, via normalised copies). */
export function angleV3V3(a: Vec3, b: Vec3): number {
    const an = normalizedV3(a)
    const bn = normalizedV3(b)
    return angleNormalizedV3V3(an, bn)
}

/** `angle_normalized_v3v3`: `acos(dot)` done through `asin` for accuracy. */
export function angleNormalizedV3V3(a: Vec3, b: Vec3): number {
    if (dotV3(a, b) >= 0) {
        return 2 * safeAsin(lenV3V3(a, b) / 2)
    }
    return Math.PI - 2 * safeAsin(lenV3V3(a, negV3(b)) / 2)
}

/** `angle_normalized_v2v2` (`math_vector.cc:352`). */
export function angleNormalizedV2V2(a: Vec2, b: Vec2): number {
    if (dotV2(a, b) >= 0) {
        return 2 * safeAsin(lenV2V2(a, b) / 2)
    }
    const bn: Vec2 = [-b[0], -b[1]]
    return Math.PI - 2 * safeAsin(lenV2V2(a, bn) / 2)
}

/** `angle_signed_on_axis_v3v3_v3` (`math_vector.cc:379`): angle from `v1` to `v2` about `axis`, in `[0, 2pi)`. */
export function angleSignedOnAxisV3V3V3(v1: Vec3, v2: Vec3, axis: Vec3): number {
    const v1p = projectPlaneNormalizedV3V3V3(v1, axis)
    const v2p = projectPlaneNormalizedV3V3V3(v2, axis)
    let angle = angleV3V3(v1p, v2p)
    const tproj = crossV3(v2p, v1p)
    if (dotV3(tproj, axis) < 0) {
        angle = Math.PI * 2 - angle
    }
    return angle
}

export function safeAsin(f: number): number {
    return Math.asin(Math.max(-1, Math.min(1, f)))
}

/** `axis_dominant_v3_single` (`math_geom_inline.cc:86`). */
export function axisDominantV3Single(v: Vec3): number {
    const x = Math.abs(v[0]), y = Math.abs(v[1]), z = Math.abs(v[2])
    return x > y ? x > z ? 0 : 2 : y > z ? 1 : 2
}

/** `ortho_v3_v3` (`math_vector.cc:593`): any vector orthogonal to `v`. */
export function orthoV3V3(v: Vec3): Vec3 {
    switch (axisDominantV3Single(v)) {
    case 0: return [-v[1] - v[2], v[0], v[0]]
    case 1: return [v[1], -v[0] - v[2], v[1]]
    default: return [v[2], v[2], -v[0] - v[1]]
    }
}

/** `ortho_basis_v3v3_v3` (`math_vector.cc:568`): two vectors completing `n` to a basis. */
export function orthoBasisV3V3V3(n: Vec3): [Vec3, Vec3] {
    const eps = FLT_EPSILON
    const f = n[0] * n[0] + n[1] * n[1]
    const n1: Vec3 = [0, 0, 0]
    const n2: Vec3 = [0, 0, 0]
    if (f > eps) {
        const d = 1 / Math.sqrt(f)
        n1[0] = n[1] * d
        n1[1] = -n[0] * d
        n1[2] = 0
        n2[0] = -n[2] * n1[1]
        n2[1] = n[2] * n1[0]
        n2[2] = n[0] * n1[1] - n[1] * n1[0]
    } else {
        n1[0] = n[2] < 0 ? -1 : 1
        n1[1] = n1[2] = n2[0] = n2[2] = 0
        n2[1] = 1
    }
    return [n1, n2]
}

/** `normal_tri_v3`: the unit normal of a triangle (`math_geom.cc`). */
export function normalTriV3(v1: Vec3, v2: Vec3, v3_: Vec3): Vec3 {
    const n1 = subV3(v1, v2)
    const n2 = subV3(v2, v3_)
    const n = crossV3(n1, n2)
    normalizeV3(n)
    return n
}

// endregion

// region matrices

export const unitM3 = (): Mat3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
export const copyM3 = (m: Mat3): Mat3 => [copyV3(m[0]), copyV3(m[1]), copyV3(m[2])]
export const zeroM3 = (): Mat3 => [[0, 0, 0], [0, 0, 0], [0, 0, 0]]

/** `mul_v3_m3v3` (`math_matrix_c.cc:824`). */
export function mulM3V3(m: Mat3, a: Vec3): Vec3 {
    return [
        m[0][0] * a[0] + m[1][0] * a[1] + m[2][0] * a[2],
        m[0][1] * a[0] + m[1][1] * a[1] + m[2][1] * a[2],
        m[0][2] * a[0] + m[1][2] * a[1] + m[2][2] * a[2],
    ]
}

/** `mul_m3_m3m3(r, a, b)`: `r = a * b`, so `r` applies `b` first. */
export function mulM3M3(a: Mat3, b: Mat3): Mat3 {
    return [mulM3V3(a, b[0]), mulM3V3(a, b[1]), mulM3V3(a, b[2])]
}

export function transposeM3(m: Mat3): Mat3 {
    return [
        [m[0][0], m[1][0], m[2][0]],
        [m[0][1], m[1][1], m[2][1]],
        [m[0][2], m[1][2], m[2][2]],
    ]
}

export function determinantM3(m: Mat3): number {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[1][0] * (m[0][1] * m[2][2] - m[0][2] * m[2][1])
        + m[2][0] * (m[0][1] * m[1][2] - m[0][2] * m[1][1])
}

/** `invert_m3_m3`: returns the identity when the matrix is singular, as `invert_m3_m3_safe_ortho` falls back. */
export function invertM3(m: Mat3): Mat3 {
    const det = determinantM3(m)
    if (Math.abs(det) < 1e-20) return unitM3()
    const inv = 1 / det
    // Cofactor expansion on the column-vector layout: the adjugate transposed.
    const r = zeroM3()
    r[0][0] = (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv
    r[0][1] = (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv
    r[0][2] = (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv
    r[1][0] = (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv
    r[1][1] = (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv
    r[1][2] = (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv
    r[2][0] = (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv
    r[2][1] = (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv
    r[2][2] = (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv
    return r
}

/** `normalize_m3`: unit-length columns. */
export function normalizeM3(m: Mat3): Mat3 {
    const r = copyM3(m)
    normalizeV3(r[0])
    normalizeV3(r[1])
    normalizeV3(r[2])
    return r
}

/** `size_to_mat3`: a diagonal scale matrix. */
export function sizeToM3(size: Vec3): Mat3 {
    return [[size[0], 0, 0], [0, size[1], 0], [0, 0, size[2]]]
}

/** `mat3_to_size`: the length of each column. */
export function m3ToSize(m: Mat3): Vec3 {
    return [lenV3(m[0]), lenV3(m[1]), lenV3(m[2])]
}

/**
 * `axis_angle_normalized_to_mat3_ex` (`math_rotation_c.cc:1138`), the rotation about a unit axis
 * given the sine and cosine of the angle, so quadrant angles can be built from exact values.
 */
export function axisAngleNormalizedToM3Ex(axis: Vec3, angleSin: number, angleCos: number): Mat3 {
    const ico = 1 - angleCos
    const nsi: Vec3 = [axis[0] * angleSin, axis[1] * angleSin, axis[2] * angleSin]
    const n00 = axis[0] * axis[0] * ico
    const n01 = axis[0] * axis[1] * ico
    const n11 = axis[1] * axis[1] * ico
    const n02 = axis[0] * axis[2] * ico
    const n12 = axis[1] * axis[2] * ico
    const n22 = axis[2] * axis[2] * ico
    return [
        [n00 + angleCos, n01 + nsi[2], n02 - nsi[1]],
        [n01 - nsi[2], n11 + angleCos, n12 + nsi[0]],
        [n02 + nsi[1], n12 - nsi[0], n22 + angleCos],
    ]
}

/** `axis_angle_normalized_to_mat3` (`math_rotation_c.cc:1173`). */
export function axisAngleNormalizedToM3(axis: Vec3, angle: number): Mat3 {
    return axisAngleNormalizedToM3Ex(axis, Math.sin(angle), Math.cos(angle))
}

/**
 * `axis_angle_normalized_to_mat3_with_quadrant` (`transform_mode_rotate_quadrants.cc:111`):
 * a quadrant (multiple of 90 degrees) uses an exact sine/cosine table so the result has no
 * floating-point residue, which is what makes `R Z 90` land vertices exactly.
 */
export function axisAngleNormalizedToM3WithQuadrant(axis: Vec3, angle: number, quadrant: number | null): Mat3 {
    if (quadrant !== null) {
        const sinLut = [0, 1, 0, -1]
        const cosLut = [1, 0, -1, 0]
        return axisAngleNormalizedToM3Ex(axis, sinLut[quadrant], cosLut[quadrant])
    }
    return axisAngleNormalizedToM3(axis, angle)
}

/** `axis_dominant_v3_to_m3` (`math_geom.cc:3646`): a matrix that maps `normal` onto +Z. */
export function axisDominantV3ToM3(normal: Vec3): Mat3 {
    const [n1, n2] = orthoBasisV3V3V3(normal)
    const m: Mat3 = [n1, n2, copyV3(normal)]
    return transposeM3(m)
}

/** The upper 3x3 of a column-major 4x4, as Blender's `copy_m3_m4`. */
export function m3FromM4(m: Mat4): Mat3 {
    return [
        [m[0], m[1], m[2]],
        [m[4], m[5], m[6]],
        [m[8], m[9], m[10]],
    ]
}

/** Column `i` of a column-major 4x4 (`m[i]` in Blender), as a 3-vector. */
export function m4Col(m: Mat4, i: number): Vec3 {
    return [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]]
}

/** `mul_m4_v3`: transform a point by a column-major 4x4 (no perspective divide). */
export function mulM4V3(m: Mat4, v: Vec3): Vec3 {
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    ]
}

/** `mul_mat3_m4_v3`: transform a direction by the upper 3x3 of a column-major 4x4. */
export function mulMat3M4V3(m: Mat4, v: Vec3): Vec3 {
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    ]
}

/** `mul_project_m4_v3_zfac`: the clip-space `w` of a point, used as the perspective depth factor. */
export function mulProjectM4V3Zfac(m: Mat4, v: Vec3): number {
    return m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15]
}

/** `mul_project_m4_v3`: transform a point and divide by `w`. */
export function mulProjectM4V3(m: Mat4, v: Vec3): Vec3 {
    const w = mulProjectM4V3Zfac(m, v)
    const p = mulM4V3(m, v)
    return w !== 0 ? [p[0] / w, p[1] / w, p[2] / w] : p
}

export function mulM4M4(a: Mat4, b: Mat4): Mat4 {
    const r = new Array<number>(16)
    for (let c = 0; c < 4; c++) {
        for (let rr = 0; rr < 4; rr++) {
            r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3]
        }
    }
    return r
}

/** General 4x4 inverse (the same cofactor expansion three.js uses). Returns the identity when singular. */
export function invertM4(m: Mat4): Mat4 {
    const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3]
    const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7]
    const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11]
    const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15]
    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
    if (det === 0) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
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

/** A 4x4 from a 3x3 basis and a translation (`copy_m4_m3` + `transform_pivot_set_m4` style). */
export function m4FromM3(m: Mat3, translation: Vec3 = [0, 0, 0]): Mat4 {
    return [
        m[0][0], m[0][1], m[0][2], 0,
        m[1][0], m[1][1], m[1][2], 0,
        m[2][0], m[2][1], m[2][2], 0,
        translation[0], translation[1], translation[2], 1,
    ]
}

/**
 * `transform_pivot_set_m4`: make a linear 4x4 act about `pivot` (`M' = T(p) * M * T(-p)`).
 */
export function transformPivotSetM4(m: Mat4, pivot: Vec3): Mat4 {
    const r = m.slice()
    const p = mulMat3M4V3(m, pivot)
    r[12] = m[12] + pivot[0] - p[0]
    r[13] = m[13] + pivot[1] - p[1]
    r[14] = m[14] + pivot[2] - p[2]
    return r
}

// endregion

// region geometry

/** `isect_ray_line_v3` (`math_geom.cc:2142`): the factor along `v0->v1` closest to the ray. */
export function isectRayLineV3(rayOrigin: Vec3, rayDirection: Vec3, v0: Vec3, v1: Vec3): number | null {
    const a = subV3(v1, v0)
    const t = subV3(v0, rayOrigin)
    const n = crossV3(a, rayDirection)
    const nlen = lenSquaredV3(n)
    if (nlen === 0) return null
    const c = subV3(n, t)
    const cray = crossV3(c, rayDirection)
    return dotV3(cray, n) / nlen
}

/** `closest_ray_to_segment_v3` (`math_geom.cc:425`): the point on the segment nearest to the ray. */
export function closestRayToSegmentV3(rayOrigin: Vec3, rayDirection: Vec3, v0: Vec3, v1: Vec3): {point: Vec3, lambda: number} {
    const lambda = isectRayLineV3(rayOrigin, rayDirection, v0, v1)
    if (lambda === null || lambda <= 0) return {point: copyV3(v0), lambda: 0}
    if (lambda >= 1) return {point: copyV3(v1), lambda: 1}
    return {point: interpV3(v0, v1, lambda), lambda}
}

/** `closest_to_ray_v3` (`math_geom.cc:3272`). */
export function closestToRayV3(p: Vec3, rayOrig: Vec3, rayDir: Vec3): {point: Vec3, lambda: number} {
    if (isZeroV3(rayDir)) return {point: copyV3(rayOrig), lambda: 0}
    const h = subV3(p, rayOrig)
    const lambda = dotV3(rayDir, h) / dotV3(rayDir, rayDir)
    return {point: maddV3(rayOrig, rayDir, lambda), lambda}
}

/** `isect_ray_ray_epsilon_v3` (`math_geom.cc:3118`); `isect_ray_ray_v3` uses `FLT_MIN`. */
export function isectRayRayV3(aOrig: Vec3, aDir: Vec3, bOrig: Vec3, bDir: Vec3, epsilon = FLT_MIN): {lambdaA: number, lambdaB: number} | null {
    const n = crossV3(bDir, aDir)
    const nlen = lenSquaredV3(n)
    if (nlen < epsilon) return null
    const t = subV3(bOrig, aOrig)
    const c = subV3(n, t)
    const crayA = crossV3(c, bDir)
    const crayB = crossV3(c, aDir)
    return {lambdaA: dotV3(crayA, n) / nlen, lambdaB: dotV3(crayB, n) / nlen}
}

/** `isect_ray_plane_v3_factor` (`math_geom.cc:1815`). */
export function isectRayPlaneV3Factor(rayOrigin: Vec3, rayDirection: Vec3, planeCo: Vec3, planeNo: Vec3): number | null {
    const dot = dotV3(planeNo, rayDirection)
    if (dot === 0) return null
    const h = subV3(rayOrigin, planeCo)
    return -dotV3(planeNo, h) / dot
}

/** `plane_from_point_normal_v3` (`math_geom.cc:225`). */
export function planeFromPointNormalV3(co: Vec3, no: Vec3): Vec4 {
    return [no[0], no[1], no[2], -dotV3(no, co)]
}

/** `plane_point_side_v3`. */
export function planePointSideV3(plane: Vec4, p: Vec3): number {
    return plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] + plane[3]
}

/** `isect_point_planes_v3_negated` (`math_geom.cc:2181`): true when `p` is strictly in front of every plane. */
export function isectPointPlanesV3Negated(planes: Vec4[], p: Vec3): boolean {
    for (const plane of planes) {
        if (planePointSideV3(plane, p) <= 0) return false
    }
    return true
}

/**
 * `geodesic_distance_propagate_across_triangle` (`math_geom.cc:5654`): the distance to `v0`
 * across the triangle, given the distances at `v1` and `v2`, falling back to the Dijkstra sum.
 */
export function geodesicDistancePropagateAcrossTriangle(v0: Vec3, v1: Vec3, v2: Vec3, dist1: number, dist2: number): number {
    const v10 = subV3(v0, v1)
    const v12 = subV3(v2, v1)

    if (dist1 !== 0 && dist2 !== 0) {
        const u = copyV3(v12)
        const d12 = normalizeV3(u)
        if (d12 * d12 > 0) {
            const n = crossV3(v12, v10)
            normalizeV3(n)
            const v = crossV3(n, u)

            const v0_: Vec2 = [dotV3(v10, u), Math.abs(dotV3(v10, v))]

            const a = 0.5 * (1 + (dist1 * dist1 - dist2 * dist2) / (d12 * d12))
            const hh = dist1 * dist1 - a * a * d12 * d12

            if (hh > 0) {
                const h = Math.sqrt(hh)
                const s: Vec2 = [a * d12, -h]
                const xIntercept = s[0] + h * (v0_[0] - s[0]) / (v0_[1] + h)
                if (xIntercept >= 0 && xIntercept <= d12) {
                    return lenV2V2(s, v0_)
                }
            }
        }
    }

    return Math.min(dist1 + lenV3(v10), dist2 + lenV3V3(v0, v2))
}

// endregion
