/**
 * `math::interpolate(float3x3 / float4x4)` (`blenlib/intern/math_matrix.cc:336`, :380): the rotation part of each
 * matrix's polar decomposition spherically interpolated, the scaling part linearly, the location linearly.
 * Matrices are column-major.
 */

import {f32} from '../f32'
import {jacobiSvdSquare} from './jacobiSvd'
import {isNegative3, mat3ToQuat, normalizeAndGetSize3, quatToMat3} from './matrix'
import {mat3Multiply} from './matrix3'
import {quatInterpolate} from './rotation'

/** `transpose(float3x3)`. */
function transpose3(m: ArrayLike<number>): Float32Array {
    const out = new Float32Array(9)
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 3 + r] = m[r * 3 + c]
    return out
}

/** `polar_decompose` (`math_matrix.cc:292`): `M = U P` from the SVD `M = W S V*`: `U = W V*`, `P = (V S) V*`. */
export function polarDecompose3(m: ArrayLike<number>): {u: Float32Array, p: Float32Array} {
    const {u: w, s, v} = jacobiSvdSquare(m, 3)
    // `from_scale<float3x3>(S_val)`: the diagonal matrix.
    const scale = new Float32Array(9)
    for (let i = 0; i < 3; i++) scale[i * 3 + i] = s[i]
    const vt = transpose3(v)
    return {u: mat3Multiply(w, vt), p: mat3Multiply(mat3Multiply(v, scale), vt)}
}

/** `interpolate_linear` (`BLI_math_matrix.hh:730`): each column `a * (1 - t) + b * t`. */
function interpolateLinear(a: ArrayLike<number>, b: ArrayLike<number>, t: number, n: number): Float32Array {
    const out = new Float32Array(n)
    const omt = f32(1 - t)
    for (let i = 0; i < n; i++) out[i] = f32(f32(a[i] * omt) + f32(b[i] * t))
    return out
}

const negate = (m: Float32Array) => m.map(x => -x)

/** `interpolate(float3x3, float3x3, float)` (`math_matrix.cc:336`). */
export function interpolateMat3(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Float32Array {
    let {u: uA, p: pA} = polarDecompose3(a)
    let {u: uB, p: pB} = polarDecompose3(b)
    // A single axis flip cannot be a quaternion: use `-U`, `-P` instead (#77154).
    if (isNegative3(uA)) {
        uA = negate(uA)
        pA = negate(pA)
    }
    if (isNegative3(uB)) {
        uB = negate(uB)
        pB = negate(pB)
    }
    const quatA = mat3ToQuat(normalizeAndGetSize3(uA).m)
    const quatB = mat3ToQuat(normalizeAndGetSize3(uB).m)
    const u = quatToMat3(quatInterpolate(quatA, quatB, t))
    const p = interpolateLinear(pA, pB, t, 9)
    return mat3Multiply(u, p)
}

/** `interpolate(float4x4, float4x4, float)` (`math_matrix.cc:380`): the 3x3 part, identity around it, location linearly. */
export function interpolateMat4(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Float32Array {
    const a3 = new Float32Array(9), b3 = new Float32Array(9)
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
        a3[c * 3 + r] = a[c * 4 + r]
        b3[c * 3 + r] = b[c * 4 + r]
    }
    const m3 = interpolateMat3(a3, b3, t)
    const out = new Float32Array(16)
    out[15] = 1
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = m3[c * 3 + r]
    // `interpolate(float3, float3, t)` (`BLI_math_vector.hh:631`): `a * (1 - t) + b * t`.
    const omt = f32(1 - t)
    for (let k = 0; k < 3; k++) out[12 + k] = f32(f32(a[12 + k] * omt) + f32(b[12 + k] * t))
    return out
}
