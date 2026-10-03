/**
 * The `blenlib` float-array vector maths that {@link bevelEdges} needs, in Blender's own calling
 * convention: a destination array first, mutated in place, and Blender's names.
 *
 * `src/math/index.ts` has a value-returning `Vec3` API, and the rest of the kernel uses it. Bevel is
 * different in kind: `bmesh_bevel.cc` is eight and a half thousand lines of dense vector algebra in
 * which the same scratch arrays are written, re-read and overwritten within a few lines of each
 * other. Translating that into an allocating expression style rewrites the control flow of nearly
 * every function and makes the port impossible to check against the original. So this module keeps
 * the C shape - `sub_v3_v3v3(r, a, b)` stays `subV3V3V3(r, a, b)` - and every function below is a
 * literal port with its `blenlib` file and line cited.
 *
 * Where a function already exists in `src/math` with identical semantics it is still restated here
 * rather than adapted, because the adapters would cost more than the six lines they wrap and would
 * hide the correspondence. The one exception is the 4x4 inverse, which is taken from `src/math`.
 *
 * Arrays are plain `number[]`. Blender's `float` is single precision and this is double; the only
 * place the difference is load-bearing is the superellipse chord solver, which Blender itself runs
 * in `double` (see `bevel-profile.ts`).
 */

import {Mat4, mat4Invert} from '../math'

/** A mutable 3-vector. Blender's `float v[3]`. */
export type V3 = number[]
/** A mutable 4-vector, used for planes as `(nx, ny, nz, d)`. Blender's `float plane[4]`. */
export type V4 = number[]
/** A row-major 3x3 matrix stored as nine numbers, `m[row * 3 + col]`. */
export type M3 = number[]

/** `FLT_EPSILON`. Blender compares single-precision floats against this throughout. */
export const FLT_EPSILON = 1.1920929e-7

// region math_vector.cc / math_vector_inline.cc

export function zeroV3(r: V3): void {
    r[0] = 0
    r[1] = 0
    r[2] = 0
}

export function copyV3V3(r: V3, a: readonly number[]): void {
    r[0] = a[0]
    r[1] = a[1]
    r[2] = a[2]
}

export function copyV3Fl(r: V3, f: number): void {
    r[0] = f
    r[1] = f
    r[2] = f
}

export function copyV2V2(r: number[], a: readonly number[]): void {
    r[0] = a[0]
    r[1] = a[1]
}

/** A fresh `[x, y, z]`, the equivalent of declaring `float v[3]` as a local. */
export const nv3 = (x = 0, y = 0, z = 0): V3 => [x, y, z]

export function addV3V3V3(r: V3, a: readonly number[], b: readonly number[]): void {
    r[0] = a[0] + b[0]
    r[1] = a[1] + b[1]
    r[2] = a[2] + b[2]
}

export function addV3V3(r: V3, a: readonly number[]): void {
    r[0] += a[0]
    r[1] += a[1]
    r[2] += a[2]
}

export function addV2V2(r: number[], a: readonly number[]): void {
    r[0] += a[0]
    r[1] += a[1]
}

export function subV3V3V3(r: V3, a: readonly number[], b: readonly number[]): void {
    r[0] = a[0] - b[0]
    r[1] = a[1] - b[1]
    r[2] = a[2] - b[2]
}

export function subV3V3(r: V3, a: readonly number[]): void {
    r[0] -= a[0]
    r[1] -= a[1]
    r[2] -= a[2]
}

export function mulV3Fl(r: V3, f: number): void {
    r[0] *= f
    r[1] *= f
    r[2] *= f
}

export function mulV2Fl(r: number[], f: number): void {
    r[0] *= f
    r[1] *= f
}

export function mulV3V3Fl(r: V3, a: readonly number[], f: number): void {
    r[0] = a[0] * f
    r[1] = a[1] * f
    r[2] = a[2] * f
}

export function negateV3(r: V3): void {
    r[0] = -r[0]
    r[1] = -r[1]
    r[2] = -r[2]
}

export function negateV3V3(r: V3, a: readonly number[]): void {
    r[0] = -a[0]
    r[1] = -a[1]
    r[2] = -a[2]
}

/** `madd_v3_v3fl`: `r += a * f`. */
export function maddV3V3Fl(r: V3, a: readonly number[], f: number): void {
    r[0] += a[0] * f
    r[1] += a[1] * f
    r[2] += a[2] * f
}

/** `madd_v3_v3v3fl`: `r = a + b * f`. Safe when `r` aliases `a` or `b`. */
export function maddV3V3V3Fl(r: V3, a: readonly number[], b: readonly number[], f: number): void {
    const x = a[0] + b[0] * f
    const y = a[1] + b[1] * f
    const z = a[2] + b[2] * f
    r[0] = x
    r[1] = y
    r[2] = z
}

export function dotV3V3(a: readonly number[], b: readonly number[]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** `cross_v3_v3v3`. Blender asserts `r` is neither input; the locals here make that moot. */
export function crossV3V3V3(r: V3, a: readonly number[], b: readonly number[]): void {
    const x = a[1] * b[2] - a[2] * b[1]
    const y = a[2] * b[0] - a[0] * b[2]
    const z = a[0] * b[1] - a[1] * b[0]
    r[0] = x
    r[1] = y
    r[2] = z
}

export function lenSquaredV3(a: readonly number[]): number {
    return dotV3V3(a, a)
}

export function lenV3(a: readonly number[]): number {
    return Math.sqrt(dotV3V3(a, a))
}

export function lenSquaredV3V3(a: readonly number[], b: readonly number[]): number {
    const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]
    return x * x + y * y + z * z
}

export function lenV3V3(a: readonly number[], b: readonly number[]): number {
    return Math.sqrt(lenSquaredV3V3(a, b))
}

export function lenSquaredV2(a: readonly number[]): number {
    return a[0] * a[0] + a[1] * a[1]
}

export function isZeroV3(a: readonly number[]): boolean {
    return a[0] === 0 && a[1] === 0 && a[2] === 0
}

/**
 * `normalize_v3_v3` (`math_vector_inline.cc:399`) - normalise into `r` and return the *old* length.
 * Returning the length is the whole point: half of `bmesh_bevel.cc`'s callers use it.
 *
 * Blender zeroes the vector when the length is exactly zero rather than producing NaNs.
 */
export function normalizeV3V3(r: V3, a: readonly number[]): number {
    const d = dotV3V3(a, a)
    if (d > 1.0e-35) {
        const len = Math.sqrt(d)
        mulV3V3Fl(r, a, 1 / len)
        return len
    }
    zeroV3(r)
    return 0
}

/** `normalize_v3` - in place. */
export function normalizeV3(r: V3): number {
    return normalizeV3V3(r, r)
}

/** `interp_v3_v3v3`: `r = a + t * (b - a)`. */
export function interpV3V3V3(r: V3, a: readonly number[], b: readonly number[], t: number): void {
    const s = 1 - t
    const x = s * a[0] + t * b[0]
    const y = s * a[1] + t * b[1]
    const z = s * a[2] + t * b[2]
    r[0] = x
    r[1] = y
    r[2] = z
}

/** `mid_v3_v3v3`. */
export function midV3V3V3(r: V3, a: readonly number[], b: readonly number[]): void {
    const x = 0.5 * (a[0] + b[0])
    const y = 0.5 * (a[1] + b[1])
    const z = 0.5 * (a[2] + b[2])
    r[0] = x
    r[1] = y
    r[2] = z
}

/** `project_v3_v3v3` (`math_vector.cc:495`) - the component of `p` along `vProj`. */
export function projectV3V3V3(out: V3, p: readonly number[], vProj: readonly number[]): void {
    if (isZeroV3(vProj)) {
        zeroV3(out)
        return
    }
    mulV3V3Fl(out, vProj, dotV3V3(p, vProj) / dotV3V3(vProj, vProj))
}

/**
 * `ortho_basis_v3v3_v3` (`math_vector.cc:568`). Two unit vectors completing `n` into a basis,
 * chosen by a branch on whether `n` is close to the z axis.
 */
export function orthoBasisV3V3V3(rN1: V3, rN2: V3, n: readonly number[]): void {
    const f = lenSquaredV2(n)
    if (f > FLT_EPSILON) {
        const d = 1 / Math.sqrt(f)
        rN1[0] = n[1] * d
        rN1[1] = -n[0] * d
        rN1[2] = 0
        rN2[0] = -n[2] * rN1[1]
        rN2[1] = n[2] * rN1[0]
        rN2[2] = n[0] * rN1[1] - n[1] * rN1[0]
    } else {
        // Degenerate case: `n` is along z.
        rN1[0] = n[2] < 0 ? -1 : 1
        rN1[1] = 0
        rN1[2] = 0
        rN2[0] = 0
        rN2[1] = 1
        rN2[2] = 0
    }
}

/** `safe_asinf` (`math_base_safe_inline.cc`) - `asin` with the domain clamped. */
export function safeAsin(a: number): number {
    if (a <= -1) return -Math.PI / 2
    if (a >= 1) return Math.PI / 2
    return Math.asin(a)
}

/**
 * `angle_normalized_v3v3` (`math_vector.cc:336`). Not `acos(dot)`: Blender uses the chord-length
 * form, which keeps its precision for angles near zero where `acos` loses most of it. Reproduced
 * because the bevel code compares angles against `BEVEL_EPSILON_ANG` (two degrees).
 */
export function angleNormalizedV3V3(v1: readonly number[], v2: readonly number[]): number {
    if (dotV3V3(v1, v2) >= 0) {
        return 2 * safeAsin(lenV3V3(v1, v2) / 2)
    }
    const v2n = nv3()
    negateV3V3(v2n, v2)
    return Math.PI - 2 * safeAsin(lenV3V3(v1, v2n) / 2)
}

/** `angle_v3v3` (`math_vector.cc:276`). */
export function angleV3V3(a: readonly number[], b: readonly number[]): number {
    const vec1 = nv3()
    const vec2 = nv3()
    normalizeV3V3(vec1, a)
    normalizeV3V3(vec2, b)
    return angleNormalizedV3V3(vec1, vec2)
}

/** `angle_v3v3v3` (`math_vector.cc:252`) - the angle at `b` in the corner `a-b-c`. */
export function angleV3V3V3(a: readonly number[], b: readonly number[], c: readonly number[]): number {
    const vec1 = nv3()
    const vec2 = nv3()
    subV3V3V3(vec1, b, a)
    subV3V3V3(vec2, b, c)
    normalizeV3(vec1)
    normalizeV3(vec2)
    return angleNormalizedV3V3(vec1, vec2)
}

/** `compare_ff` (`math_base_inline.cc:416`). */
export function compareFf(a: number, b: number, maxDiff: number): boolean {
    return Math.abs(a - b) <= maxDiff
}

/** `compare_v3v3` (`math_vector_inline.cc:1020`) - per component, not by distance. */
export function compareV3V3(v1: readonly number[], v2: readonly number[], limit: number): boolean {
    return compareFf(v1[0], v2[0], limit) && compareFf(v1[1], v2[1], limit) &&
        compareFf(v1[2], v2[2], limit)
}

/** `compare_v2v2` (`math_vector_inline.cc:1015`). */
export function compareV2V2(v1: readonly number[], v2: readonly number[], limit: number): boolean {
    return compareFf(v1[0], v2[0], limit) && compareFf(v1[1], v2[1], limit)
}

/** `safe_divide` (`math_base_safe_inline.cc:16`) - zero rather than infinity. */
export function safeDivide(a: number, b: number): number {
    return b !== 0 ? a / b : 0
}

// endregion

// region math_geom.cc - lines, planes, projection

/**
 * `closest_to_ray_v3` (`math_geom.cc:3272`) - the point on the ray nearest `p`, and the ray
 * parameter as the return value.
 */
export function closestToRayV3(
    rClose: V3, p: readonly number[], rayOrig: readonly number[], rayDir: readonly number[],
): number {
    if (isZeroV3(rayDir)) {
        copyV3V3(rClose, rayOrig)
        return 0
    }
    const h = nv3()
    subV3V3V3(h, p, rayOrig)
    const lambda = dotV3V3(rayDir, h) / dotV3V3(rayDir, rayDir)
    maddV3V3V3Fl(rClose, rayOrig, rayDir, lambda)
    return lambda
}

/** `closest_to_line_v3` (`math_geom.cc:3291`). */
export function closestToLineV3(
    rClose: V3, p: readonly number[], l1: readonly number[], l2: readonly number[],
): number {
    const u = nv3()
    subV3V3V3(u, l2, l1)
    return closestToRayV3(rClose, p, l1, u)
}

/**
 * `closest_to_line_segment_v3` (`math_geom.cc:403`) - the same, clamped to the segment.
 *
 * The comparisons are written `<= 0` and `>= 1` so that a NaN parameter (a zero-length segment)
 * falls through to the unclamped branch, which is what Blender's comment about the `!finite` case
 * means.
 */
export function closestToLineSegmentV3(
    rClose: V3, p: readonly number[], l1: readonly number[], l2: readonly number[],
): number {
    const cp = nv3()
    const lambda = closestToLineV3(cp, p, l1, l2)
    if (lambda <= 0) {
        copyV3V3(rClose, l1)
        return 0
    }
    if (lambda >= 1) {
        copyV3V3(rClose, l2)
        return 1
    }
    copyV3V3(rClose, cp)
    return lambda
}

/** `plane_from_point_normal_v3` (`math_geom.cc:225`). */
export function planeFromPointNormalV3(rPlane: V4, planeCo: readonly number[], planeNo: readonly number[]): void {
    rPlane[0] = planeNo[0]
    rPlane[1] = planeNo[1]
    rPlane[2] = planeNo[2]
    rPlane[3] = -dotV3V3(rPlane, planeCo)
}

/** `plane_point_side_v3` (`math_geom_inline.cc:124`). */
export function planePointSideV3(plane: readonly number[], co: readonly number[]): number {
    return dotV3V3(co, plane) + plane[3]
}

/** `closest_to_plane_v3` (`math_geom.cc:451`) - plane normal need not be unit length. */
export function closestToPlaneV3(rClose: V3, plane: readonly number[], pt: readonly number[]): void {
    const lenSq = lenSquaredV3(plane)
    const side = planePointSideV3(plane, pt)
    maddV3V3V3Fl(rClose, pt, plane, -side / lenSq)
}

/**
 * `dist_squared_to_plane_v3` (`math_geom.cc:474`) - signed, and note it is *not* `fabsf`'d, so the
 * sign says which side of the plane the point is on.
 */
export function distSquaredToPlaneV3(pt: readonly number[], plane: readonly number[]): number {
    const lenSq = lenSquaredV3(plane)
    const side = planePointSideV3(plane, pt)
    const fac = side / lenSq
    return Math.sign(side) * (lenSq * (fac * fac))
}

/** `closest_to_plane_normalized_v3` (`math_geom.cc:458`). */
export function closestToPlaneNormalizedV3(rClose: V3, plane: readonly number[], pt: readonly number[]): void {
    const side = planePointSideV3(plane, pt)
    maddV3V3V3Fl(rClose, pt, plane, -side)
}

/** `isect_line_plane_v3` (`math_geom.cc:2192`). False when the line is parallel to the plane. */
export function isectLinePlaneV3(
    rIsectCo: V3, l1: readonly number[], l2: readonly number[],
    planeCo: readonly number[], planeNo: readonly number[],
): boolean {
    const u = nv3()
    const h = nv3()
    subV3V3V3(u, l2, l1)
    subV3V3V3(h, l1, planeCo)
    const dot = dotV3V3(planeNo, u)
    if (Math.abs(dot) > FLT_EPSILON) {
        const lambda = -dotV3V3(planeNo, h) / dot
        maddV3V3V3Fl(rIsectCo, l1, u, lambda)
        return true
    }
    // The segment is parallel to the plane.
    return false
}

/**
 * `isect_line_line_epsilon_v3` (`math_geom.cc:2993`).
 *
 * Returns 0 when a line is degenerate, 1 when the lines are coplanar and meet at a single point
 * (written to both outputs), and 2 when they are skew, in which case the outputs are the two
 * *nearest* points, one on each line. Bevel branches on all three.
 *
 * Note the comment Blender attaches to the `div == 0.0f` test: it must be an exact comparison, not
 * an epsilon, because #45919 was an epsilon here rejecting legitimate short edges.
 */
export function isectLineLineEpsilonV3(
    v1: readonly number[], v2: readonly number[], v3: readonly number[], v4: readonly number[],
    rI1: V3, rI2: V3, epsilon: number,
): number {
    const a = nv3()
    const b = nv3()
    const c = nv3()
    const ab = nv3()
    const cb = nv3()

    subV3V3V3(c, v3, v1)
    subV3V3V3(a, v2, v1)
    subV3V3V3(b, v4, v3)

    crossV3V3V3(ab, a, b)
    const d = dotV3V3(c, ab)
    const div = dotV3V3(ab, ab)

    // Important not to use an epsilon here, see Blender #45919 - test for a zero length line.
    if (div === 0) {
        return 0
    }
    // Test whether the two lines are coplanar.
    if (Math.abs(d) <= epsilon) {
        crossV3V3V3(cb, c, b)
        mulV3Fl(a, dotV3V3(cb, ab) / div)
        addV3V3V3(rI1, v1, a)
        copyV3V3(rI2, rI1)
        return 1
    }

    const n = nv3()
    const t = nv3()
    const v3t = nv3()
    const v4t = nv3()
    subV3V3V3(t, v1, v3)

    // Offset between the two planes the lines lie in.
    crossV3V3V3(n, a, b)
    projectV3V3V3(t, t, n)

    // For the first line, offset the second line until it is coplanar.
    addV3V3V3(v3t, v3, t)
    addV3V3V3(v4t, v4, t)

    subV3V3V3(c, v3t, v1)
    subV3V3V3(a, v2, v1)
    subV3V3V3(b, v4t, v3t)

    crossV3V3V3(ab, a, b)
    crossV3V3V3(cb, c, b)

    mulV3Fl(a, dotV3V3(cb, ab) / dotV3V3(ab, ab))
    addV3V3V3(rI1, v1, a)

    // For the second line, just subtract the offset from the first intersection point.
    subV3V3V3(rI2, rI1, t)

    return 2
}

/** `isect_line_line_v3` (`math_geom.cc:3057`) - the epsilon form with Blender's `1e-6`. */
export function isectLineLineV3(
    v1: readonly number[], v2: readonly number[], v3: readonly number[], v4: readonly number[],
    rI1: V3, rI2: V3,
): number {
    return isectLineLineEpsilonV3(v1, v2, v3, v4, rI1, rI2, 0.000001)
}

/** `cross_poly_v2` (`math_geom.cc:153`) - twice the signed area, by the trapezium rule. */
export function crossPolyV2(verts: readonly (readonly number[])[], nr: number): number {
    let coPrev = verts[nr - 1]
    let cross = 0
    for (let a = 0; a < nr; a++) {
        const coCurr = verts[a]
        cross += (coPrev[0] - coCurr[0]) * (coCurr[1] + coPrev[1])
        coPrev = coCurr
    }
    return cross
}

/** `area_poly_v2` (`math_geom.cc:186`). */
export function areaPolyV2(verts: readonly (readonly number[])[], nr: number): number {
    return Math.abs(0.5 * crossPolyV2(verts, nr))
}

/** `interp_bilinear_quad_v3` (`math_geom.cc:4619`). */
export function interpBilinearQuadV3(data: readonly (readonly number[])[], u: number, v: number, res: V3): void {
    res[0] = data[0][0] * (1 - u) * (1 - v) + data[1][0] * u * (1 - v) +
        data[2][0] * u * v + data[3][0] * (1 - u) * v
    res[1] = data[0][1] * (1 - u) * (1 - v) + data[1][1] * u * (1 - v) +
        data[2][1] * u * v + data[3][1] * (1 - u) * v
    res[2] = data[0][2] * (1 - u) * (1 - v) + data[1][2] * u * (1 - v) +
        data[2][2] * u * v + data[3][2] * (1 - u) * v
}

/**
 * `axis_dominant_v3_to_m3` (`math_geom.cc:3646`) - a rotation taking `normal` to +z, so that
 * {@link mulV2M3V3} projects into the plane. `normal` must be unit length.
 *
 * The stored array is Blender's own `float m[3][3]` flattened as `m[row * 3 + col]` *after* its
 * `transpose_m3`, which is the same layout `bmesh/interp.ts` uses for its `Mat3`. Keeping the two
 * identical matters because bevel hands matrices to `faceInterpFromFaceEx`.
 */
export function axisDominantV3ToM3(rMat: M3, normal: readonly number[]): void {
    const n1 = nv3()
    const n2 = nv3()
    orthoBasisV3V3V3(n1, n2, normal)
    // Blender sets rows (n1, n2, normal) then transposes; this is the transposed result written out.
    rMat[0] = n1[0]
    rMat[1] = n2[0]
    rMat[2] = normal[0]
    rMat[3] = n1[1]
    rMat[4] = n2[1]
    rMat[5] = normal[1]
    rMat[6] = n1[2]
    rMat[7] = n2[2]
    rMat[8] = normal[2]
}

/** `mul_v2_m3v3` (`math_matrix_c.cc:844`) - the first two components of `Mᵀ·a`. */
export function mulV2M3V3(r: number[], m: readonly number[], a: readonly number[]): void {
    const x = m[0] * a[0] + m[3] * a[1] + m[6] * a[2]
    const y = m[1] * a[0] + m[4] * a[1] + m[7] * a[2]
    r[0] = x
    r[1] = y
}

// endregion

// region math_matrix - the 4x4 forms the unit square/cube maps use

/**
 * A 4x4 matrix in Blender's `float m[4][4]` layout, flattened as `m[i * 4 + j] = mat[i][j]`.
 *
 * Blender treats `mat[i]` as a *column* of the mathematical matrix, so this array is the transpose
 * of `src/math`'s row-major {@link Mat4}. That does not matter for the two things bevel does with
 * one - transform a point, and invert - as long as both stay in the same convention, which is why
 * the multiplies below are ported verbatim rather than re-derived, and the inverse goes through
 * `mat4Invert`, a layout-agnostic cofactor expansion.
 */
export type M4 = number[]

/** `unit_m4`. */
export const unitM4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** `mul_v3_m4v3` (`math_matrix_c.cc:687`) - transform a point, translation included. */
export function mulV3M4V3(r: V3, m: readonly number[], vec: readonly number[]): void {
    const x = vec[0]
    const y = vec[1]
    const z = vec[2]
    const rx = x * m[0] + y * m[4] + m[8] * z + m[12]
    const ry = x * m[1] + y * m[5] + m[9] * z + m[13]
    const rz = x * m[2] + y * m[6] + m[10] * z + m[14]
    r[0] = rx
    r[1] = ry
    r[2] = rz
}

/** `mul_m4_v4` (`math_matrix_c.cc:810`), through `mul_v4_m4v4` (`:798`). */
export function mulM4V4(m: readonly number[], r: number[]): void {
    const x = r[0]
    const y = r[1]
    const z = r[2]
    const w = r[3]
    const r0 = x * m[0] + y * m[4] + z * m[8] + m[12] * w
    const r1 = x * m[1] + y * m[5] + z * m[9] + m[13] * w
    const r2 = x * m[2] + y * m[6] + z * m[10] + m[14] * w
    const r3 = x * m[3] + y * m[7] + z * m[11] + m[15] * w
    r[0] = r0
    r[1] = r1
    r[2] = r2
    r[3] = r3
}

/**
 * `invert_m4_m4` (`math_matrix_c.cc`, which defers to Eigen). `mat4Invert` is a general cofactor
 * inverse, so it returns the inverse in whatever layout it was given; false when singular, matching
 * Blender's return value.
 */
export function invertM4M4(rInverse: M4, m: readonly number[]): boolean {
    const inv = mat4Invert(m as Mat4)
    for (let i = 0; i < 16; i++) rInverse[i] = inv[i]
    return inv.some(x => x !== 0)
}

export function maxFf(a: number, b: number): number {
    return a > b ? a : b
}

export function minFf(a: number, b: number): number {
    return a < b ? a : b
}

export function maxIi(a: number, b: number): number {
    return a > b ? a : b
}

// endregion
