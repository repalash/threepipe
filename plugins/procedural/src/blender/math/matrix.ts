/**
 * Port of the parts of Blender's C++ matrix library (`blenlib/BLI_math_matrix.hh`,
 * `blenlib/intern/math_matrix.cc`, `blenlib/BLI_math_euler.hh`) that geometry nodes use for
 * rotations and instance transforms.
 *
 * Layout matches Blender's `MatBase`: column major, `m[col * rows + row]`, so a `float4x4` is the same
 * 16 numbers three.js's `Matrix4.elements` holds. `float` arithmetic is emulated with {@link f32};
 * where Blender computes in `double` (`from_rotation`, `TypeTraits<T>::DoublePrecision`) so does this.
 */

import {f32} from '../f32'
import {normalizeAndGetLength3, Quat, Float3} from './quaternion'

/** 3x3, column major. */
export type Float3x3 = Float32Array<ArrayBufferLike>
/** 4x4, column major. */
export type Float4x4 = Float32Array<ArrayBufferLike>

export function mat3Identity(): Float3x3 {
    const m = new Float32Array(9)
    m[0] = m[4] = m[8] = 1
    return m
}

export function mat4Identity(): Float4x4 {
    const m = new Float32Array(16)
    m[0] = m[5] = m[10] = m[15] = 1
    return m
}

/** `MatBase<T, 3, 3>(float4x4)`: the upper-left 3x3. */
export function mat3FromMat4(m: ArrayLike<number>): Float3x3 {
    const r = new Float32Array(9)
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) r[c * 3 + k] = m[c * 4 + k]
    return r
}

/**
 * `determinant` (`math_matrix.cc:131`) evaluates with Eigen, whose 3x3 path is
 * `bruteforce_det3_helper(m,0,1,2) - (m,1,0,2) + (m,2,0,1)` with `coeff(row, col) = mat[col][row]`.
 */
export function determinant3(m: ArrayLike<number>): number {
    const c = (row: number, col: number) => m[col * 3 + row]
    const helper = (a: number, b: number, d: number) =>
        f32(c(0, a) * f32(f32(c(1, b) * c(2, d)) - f32(c(1, d) * c(2, b))))
    return f32(f32(helper(0, 1, 2) - helper(1, 0, 2)) + helper(2, 0, 1))
}

/** `is_negative(float3x3)` (`math_matrix.cc:143`). */
export function isNegative3(m: ArrayLike<number>): boolean {
    return determinant3(m) < 0
}

/** `normalize_and_get_size` (`BLI_math_matrix.hh:786`): each column normalised, lengths returned. */
export function normalizeAndGetSize3(m: ArrayLike<number>): {m: Float3x3, size: Float3} {
    const out = new Float32Array(9)
    const size: Float3 = [0, 0, 0]
    for (let c = 0; c < 3; c++) {
        const {v, length} = normalizeAndGetLength3([m[c * 3], m[c * 3 + 1], m[c * 3 + 2]])
        out[c * 3] = v[0]
        out[c * 3 + 1] = v[1]
        out[c * 3 + 2] = v[2]
        size[c] = length
    }
    return {m: out, size}
}

const FLT_EPSILON = 1.1920928955078125e-7

/** `detail::normalized_to_eul2` for XYZ (`BLI_math_matrix.hh:805`). */
export function normalizedToEul2(m: ArrayLike<number>): [Float3, Float3] {
    const at = (c: number, r: number) => m[c * 3 + r]
    const cy = f32(Math.hypot(at(0, 0), at(0, 1)))
    if (cy > f32(16 * FLT_EPSILON)) {
        const e1: Float3 = [
            f32(Math.atan2(at(1, 2), at(2, 2))),
            f32(Math.atan2(-at(0, 2), cy)),
            f32(Math.atan2(at(0, 1), at(0, 0))),
        ]
        const e2: Float3 = [
            f32(Math.atan2(-at(1, 2), -at(2, 2))),
            f32(Math.atan2(-at(0, 2), -cy)),
            f32(Math.atan2(-at(0, 1), -at(0, 0))),
        ]
        return [e1, e2]
    }
    const e1: Float3 = [f32(Math.atan2(-at(2, 1), at(1, 1))), f32(Math.atan2(-at(0, 2), cy)), 0]
    return [e1, [e1[0], e1[1], e1[2]]]
}

function manhattan(v: Float3): number {
    return f32(f32(Math.abs(v[0]) + Math.abs(v[1])) + Math.abs(v[2]))
}

/** `to_euler(float3x3)` (`BLI_math_matrix.hh:1199`): the solution with the smaller Manhattan length. */
export function mat3ToEuler(m: ArrayLike<number>): Float3 {
    const [e1, e2] = normalizedToEul2(m)
    return manhattan(e1) > manhattan(e2) ? e2 : e1
}

/** `to_quaternion(EulerXYZ)` (`BLI_math_euler.hh:50`). */
export function eulerToQuat(e: ArrayLike<number>): Quat {
    const hi = f32(e[0] / 2), hj = f32(e[1] / 2), hk = f32(e[2] / 2)
    const ci = f32(Math.cos(hi)), cj = f32(Math.cos(hj)), ck = f32(Math.cos(hk))
    const si = f32(Math.sin(hi)), sj = f32(Math.sin(hj)), sk = f32(Math.sin(hk))
    const cc = f32(ci * ck), cs = f32(ci * sk), sc = f32(si * ck), ss = f32(si * sk)
    return [
        f32(f32(cj * cc) + f32(sj * ss)),
        f32(f32(cj * sc) - f32(sj * cs)),
        f32(f32(cj * ss) + f32(sj * cc)),
        f32(f32(cj * cs) - f32(sj * sc)),
    ]
}

/** `detail::normalized_to_quat_fast` (`BLI_math_matrix.hh:870`). */
export function normalizedToQuatFast(m: ArrayLike<number>): Quat {
    const at = (c: number, r: number) => m[c * 3 + r]
    let w = 0, x = 0, y = 0, z = 0
    if (at(2, 2) < 0) {
        if (at(0, 0) > at(1, 1)) {
            const trace = f32(f32(f32(1 + at(0, 0)) - at(1, 1)) - at(2, 2))
            let s = f32(2 * f32(Math.sqrt(trace)))
            if (at(1, 2) < at(2, 1)) s = -s
            x = f32(0.25 * s)
            s = f32(1 / s)
            w = f32(f32(at(1, 2) - at(2, 1)) * s)
            y = f32(f32(at(0, 1) + at(1, 0)) * s)
            z = f32(f32(at(2, 0) + at(0, 2)) * s)
            if (trace === 1 && w === 0 && y === 0 && z === 0) x = 1
        } else {
            const trace = f32(f32(f32(1 - at(0, 0)) + at(1, 1)) - at(2, 2))
            let s = f32(2 * f32(Math.sqrt(trace)))
            if (at(2, 0) < at(0, 2)) s = -s
            y = f32(0.25 * s)
            s = f32(1 / s)
            w = f32(f32(at(2, 0) - at(0, 2)) * s)
            x = f32(f32(at(0, 1) + at(1, 0)) * s)
            z = f32(f32(at(1, 2) + at(2, 1)) * s)
            if (trace === 1 && w === 0 && x === 0 && z === 0) y = 1
        }
    } else {
        if (at(0, 0) < -at(1, 1)) {
            const trace = f32(f32(f32(1 - at(0, 0)) - at(1, 1)) + at(2, 2))
            let s = f32(2 * f32(Math.sqrt(trace)))
            if (at(0, 1) < at(1, 0)) s = -s
            z = f32(0.25 * s)
            s = f32(1 / s)
            w = f32(f32(at(0, 1) - at(1, 0)) * s)
            x = f32(f32(at(2, 0) + at(0, 2)) * s)
            y = f32(f32(at(1, 2) + at(2, 1)) * s)
            if (trace === 1 && w === 0 && x === 0 && y === 0) z = 1
        } else {
            const trace = f32(f32(f32(1 + at(0, 0)) + at(1, 1)) + at(2, 2))
            let s = f32(2 * f32(Math.sqrt(trace)))
            w = f32(0.25 * s)
            s = f32(1 / s)
            x = f32(f32(at(1, 2) - at(2, 1)) * s)
            y = f32(f32(at(2, 0) - at(0, 2)) * s)
            z = f32(f32(at(0, 1) - at(1, 0)) * s)
            if (trace === 1 && x === 0 && y === 0 && z === 0) w = 1
        }
    }
    const lenSq = f32(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z)) + f32(w * w))
    if (Math.abs(f32(lenSq - 1)) >= f32(0.0002)) {
        // `const T q_len_inv = 1.0 / math::sqrt(q_len_squared);` - double division, stored to float.
        const inv = f32(1.0 / f32(Math.sqrt(lenSq)))
        x = f32(x * inv)
        y = f32(y * inv)
        z = f32(z * inv)
        w = f32(w * inv)
    }
    return [w, x, y, z]
}

function negate3(m: ArrayLike<number>): Float3x3 {
    const r = new Float32Array(9)
    for (let i = 0; i < 9; i++) r[i] = -m[i]
    return r
}

/** `detail::normalized_to_quat_with_checks` (`BLI_math_matrix.hh:974`) - `to_quaternion(float3x3)`. */
export function mat3ToQuat(m: ArrayLike<number>): Quat {
    const det = determinant3(m)
    if (!Number.isFinite(det)) return [1, 0, 0, 0]
    if (det < 0) return normalizedToQuatFast(negate3(m))
    return normalizedToQuatFast(m)
}

/** `normalized_to_quaternion_safe` (`BLI_math_matrix.hh:1285`): via Euler, tolerant of shear. */
export function normalizedToQuatSafe(m: ArrayLike<number>): Quat {
    return eulerToQuat(mat3ToEuler(m))
}

/** `from_rotation(EulerXYZ)` (`BLI_math_matrix.hh:991`), computed in double like Blender. */
export function eulerToMat3(e: ArrayLike<number>): Float3x3 {
    const ci = Math.cos(e[0]), cj = Math.cos(e[1]), ck = Math.cos(e[2])
    const si = Math.sin(e[0]), sj = Math.sin(e[1]), sk = Math.sin(e[2])
    const cc = ci * ck, cs = ci * sk, sc = si * ck, ss = si * sk
    const m = new Float32Array(9)
    m[0] = cj * ck
    m[3] = sj * sc - cs
    m[6] = sj * cc + ss
    m[1] = cj * sk
    m[4] = sj * ss + cc
    m[7] = sj * cs - sc
    m[2] = -sj
    m[5] = cj * si
    m[8] = cj * ci
    return m
}

/** `from_rotation(Quaternion)` (`BLI_math_matrix.hh:1048`), computed in double like Blender. */
export function quatToMat3(q: ArrayLike<number>): Float3x3 {
    const q0 = Math.SQRT2 * q[0], q1 = Math.SQRT2 * q[1], q2 = Math.SQRT2 * q[2], q3 = Math.SQRT2 * q[3]
    const qda = q0 * q1, qdb = q0 * q2, qdc = q0 * q3
    const qaa = q1 * q1, qab = q1 * q2, qac = q1 * q3
    const qbb = q2 * q2, qbc = q2 * q3, qcc = q3 * q3
    const m = new Float32Array(9)
    m[0] = 1.0 - qbb - qcc
    m[1] = qdc + qab
    m[2] = -qdb + qac
    m[3] = -qdc + qab
    m[4] = 1.0 - qaa - qcc
    m[5] = qda + qbc
    m[6] = qdb + qac
    m[7] = -qda + qbc
    m[8] = 1.0 - qaa - qbb
    return m
}

/** Length of column `c` of a 4x4 (`length(mat.x_axis())`). */
function columnLength4(m: ArrayLike<number>, c: number): number {
    const x = m[c * 4], y = m[c * 4 + 1], z = m[c * 4 + 2]
    return f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))))
}

/** `to_scale<AllowNegativeScale>(float4x4)` (`BLI_math_matrix.hh:1295`). */
export function mat4ToScale(m: ArrayLike<number>, allowNegativeScale: boolean): Float3 {
    const s: Float3 = [columnLength4(m, 0), columnLength4(m, 1), columnLength4(m, 2)]
    if (allowNegativeScale && isNegative3(mat3FromMat4(m))) return [-s[0], -s[1], -s[2]]
    return s
}

/**
 * `to_loc_rot_scale<AllowNegativeScale>(float4x4, float3, EulerXYZ, float3)` (`BLI_math_matrix.hh:1387`,
 * via `to_rot_scale` `:1362`).
 */
export function mat4ToLocEulerScale(m: ArrayLike<number>, allowNegativeScale: boolean): {loc: Float3, euler: Float3, scale: Float3} {
    const loc: Float3 = [m[12], m[13], m[14]]
    let {m: n, size} = normalizeAndGetSize3(mat3FromMat4(m))
    if (allowNegativeScale && isNegative3(n)) {
        n = negate3(n)
        size = [-size[0], -size[1], -size[2]]
    }
    return {loc, euler: mat3ToEuler(n), scale: size}
}

/** `to_loc_rot_scale_safe<AllowNegativeScale>` with a quaternion result (`BLI_math_matrix.hh:1401`). */
export function mat4ToLocQuatScaleSafe(m: ArrayLike<number>, allowNegativeScale: boolean): {loc: Float3, rot: Quat, scale: Float3} {
    const {loc, euler, scale} = mat4ToLocEulerScale(m, allowNegativeScale)
    return {loc, rot: eulerToQuat(euler), scale}
}

/**
 * `from_loc_rot_scale<float4x4>(location, rotation, scale)` (`BLI_math_matrix.hh:1447`):
 * `from_rotation(rotation) * from_scale(scale)` then the location. `rotation` is a 3x3 already built
 * from a quaternion, Euler or axis angle.
 */
export function mat4FromLocRot3Scale(loc: ArrayLike<number>, rot: ArrayLike<number>, scale: ArrayLike<number>, out: Float4x4 = new Float32Array(16)): Float4x4 {
    // `float3x3 * float3x3` (`math_matrix.cc:74`): `result[c][r] = b[c][0]*a[0][r] + b[c][1]*a[1][r] + b[c][2]*a[2][r]`
    // with `b = from_scale(scale)`. The zero entries of `b` give +-0 products whose sum decides the sign of a
    // zero result, so all three terms are kept (multiplying `rot * scale` alone gives -0 where Blender has +0).
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
            const t0 = f32((c === 0 ? scale[0] : 0) * rot[r])
            const t1 = f32((c === 1 ? scale[1] : 0) * rot[3 + r])
            const t2 = f32((c === 2 ? scale[2] : 0) * rot[6 + r])
            out[c * 4 + r] = f32(f32(t0 + t1) + t2)
        }
        out[c * 4 + 3] = 0
    }
    out[12] = loc[0]
    out[13] = loc[1]
    out[14] = loc[2]
    out[15] = 1
    return out
}

export function mat4FromLocQuatScale(loc: ArrayLike<number>, q: ArrayLike<number>, scale: ArrayLike<number>, out?: Float4x4): Float4x4 {
    return mat4FromLocRot3Scale(loc, quatToMat3(q), scale, out)
}

export function mat4FromLocEulerScale(loc: ArrayLike<number>, e: ArrayLike<number>, scale: ArrayLike<number>, out?: Float4x4): Float4x4 {
    return mat4FromLocRot3Scale(loc, eulerToMat3(e), scale, out)
}

/**
 * `float4x4 * float4x4` (`blenlib/intern/math_matrix.cc:26`). Blender's release builds take the SSE2
 * branch (also on arm64, through sse2neon, `BLI_simd.hh`), which sums the four products pairwise:
 * `(b0*a0 + b1*a1) + (b2*a2 + b3*a3)`.
 */
export function mat4Multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float4x4 = new Float32Array(16)): Float4x4 {
    const r = new Float32Array(16)
    for (let i = 0; i < 4; i++) {
        const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3]
        for (let k = 0; k < 4; k++) {
            const p0 = f32(b0 * a[k]), p1 = f32(b1 * a[4 + k]), p2 = f32(b2 * a[8 + k]), p3 = f32(b3 * a[12 + k])
            r[i * 4 + k] = f32(f32(p0 + p1) + f32(p2 + p3))
        }
    }
    out.set(r)
    return out
}

/**
 * `math::transform_point(float4x4, float3)` (`BLI_math_matrix.hh:1647`): the 3x3 part times the point
 * (`result += b[c] * a[c]`, `BLI_math_matrix_types.hh:402`), then the location.
 */
export function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number, out: number[] | Float32Array, o = 0): void {
    for (let k = 0; k < 3; k++) {
        const v = f32(f32(f32(f32(0 + f32(x * m[k])) + f32(y * m[4 + k])) + f32(z * m[8 + k])))
        out[o + k] = f32(v + m[12 + k])
    }
}

/** `math::is_equal(transform, float4x4::identity(), 1e-6f)` - Blender's `skip_transform`. */
export function isIdentityTransform(m: ArrayLike<number>): boolean {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) if (Math.abs(m[c * 4 + r] - (c === r ? 1 : 0)) > 1e-6) return false
    return true
}
