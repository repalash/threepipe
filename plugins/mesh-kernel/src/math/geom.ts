/**
 * Geometry helpers from Blender's `blenlib`, as the subdivide, edge-ring and slide ports need them.
 *
 * Ported from `blenlib/intern/math_vector.cc`, `math_vector_inline.cc`, `math_geom.cc`,
 * `math_geom_inline.cc`, `math_matrix_c.cc` and `math_rotation_c.cc`; each function cites its origin.
 * Blender works in `float`; these work in doubles, which the parity tests absorb with a tolerance.
 *
 * Track F (`p3-fill`) adds the same file with its own helpers. Where both need a function, the
 * definition here is identical to that one, so the two merge as a union.
 */

import {Vec3, v3dot, v3len} from './index'

/** A plane as `(normal, d)`: Blender's `float plane[4]`, with `dot(normal, p) + d = 0` on the plane. */
export type Vec4 = [number, number, number, number]

const FLT_EPSILON = 1.1920929e-7

/** `SMALL_NUMBER` (`BLI_math_base.h`). */
const SMALL_NUMBER = 1e-8

// region vectors

export const lenSquaredV3V3 = (a: Vec3, b: Vec3): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** `normalize_v3` in place, returning the length (`math_vector_inline.cc`). */
export function normalizeV3Len(v: Vec3): number {
    const d = v3len(v)
    if (d > 1.0e-35) {
        v[0] /= d
        v[1] /= d
        v[2] /= d
    } else {
        v[0] = v[1] = v[2] = 0
    }
    return d
}

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
