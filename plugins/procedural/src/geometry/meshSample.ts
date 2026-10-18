/**
 * `bke::attribute_math::mix3` for every attribute type (`BKE_attribute_math.hh:131-206`,
 * `blenkernel/intern/attribute_math.cc:25-61`) and `bke::mesh_surface_sample` (`blenkernel/intern/mesh_sample.cc`):
 * attribute values at barycentric positions on a mesh's corner triangles.
 */

import {f32, roundHalfAway} from '../blender/f32'
import {mat3FromMat4, mat4FromLocQuatScale, mat4ToScale, normalizeAndGetSize3, normalizedToQuatSafe} from '../blender/math/matrix'
import {quatFromExpmap, quatToExpmap} from '../blender/math/quaternion'
import {normalize3} from '../blender/math/vec'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {GVArray} from './varray'

/** `w0 * v0 + w1 * v1 + w2 * v2` in float, left to right. */
const sum3 = (w: ArrayLike<number>, a: number, b: number, c: number) =>
    f32(f32(f32(w[0] * a) + f32(w[1] * b)) + f32(w[2] * c))

/**
 * `mix3(weights, v0, v1, v2)` for one element of `type`. `get(i, k)` reads component `k` of source element `i`.
 * Writes into `out` at element `o`.
 */
export function mix3(type: DataType, w: ArrayLike<number>, get: (i: number, k: number) => number,
    i0: number, i1: number, i2: number, out: TypedArray, o: number): void {
    const c = DATA_TYPES[type].components
    switch (type) {
    case 'bool':
        out[o] = sum3(w, get(i0, 0), get(i1, 0), get(i2, 0)) >= 0.5 ? 1 : 0
        return
    case 'int8': case 'int32':
        out[o] = roundHalfAway(sum3(w, f32(get(i0, 0)), f32(get(i1, 0)), f32(get(i2, 0))))
        return
    case 'int16x2': case 'int32x2':
        // `T(weights.x * float2(v0) + ...)`: converted back with truncation.
        for (let k = 0; k < c; k++) out[o * c + k] = Math.trunc(sum3(w, f32(get(i0, k)), f32(get(i1, k)), f32(get(i2, k))))
        return
    case 'float': case 'float2': case 'float3': case 'float4':
        for (let k = 0; k < c; k++) out[o * c + k] = sum3(w, get(i0, k), get(i1, k), get(i2, k))
        return
    case 'byteColor':
        // ColorGeometry4b (:196): mixed as floats, `uint8_t(mixed)` truncates.
        for (let k = 0; k < 4; k++) out[o * 4 + k] = Math.trunc(sum3(w, get(i0, k), get(i1, k), get(i2, k))) & 0xff
        return
    case 'quaternion': {
        // `attribute_math.cc:25`: mix the exponential maps.
        const e = [i0, i1, i2].map(i => quatToExpmap([get(i, 0), get(i, 1), get(i, 2), get(i, 3)]))
        const q = quatFromExpmap([0, 1, 2].map(k => sum3(w, e[0][k], e[1][k], e[2][k])))
        for (let k = 0; k < 4; k++) out[o * 4 + k] = q[k]
        return
    }
    case 'float4x4': {
        // `attribute_math.cc:51`: location, rotation (normalized_to_quaternion_safe of the normalised 3x3), scale.
        const m = [i0, i1, i2].map(i => Array.from({length: 16}, (_, k) => get(i, k)))
        const loc = [0, 1, 2].map(k => sum3(w, m[0][12 + k], m[1][12 + k], m[2][12 + k]))
        const quats = m.map(x => normalizedToQuatSafe(normalizeAndGetSize3(mat3FromMat4(x)).m))
        const e = quats.map(q => quatToExpmap(q))
        const rot = quatFromExpmap([0, 1, 2].map(k => sum3(w, e[0][k], e[1][k], e[2][k])))
        const s = m.map(x => mat4ToScale(x, false))
        const scale = [0, 1, 2].map(k => sum3(w, s[0][k], s[1][k], s[2][k]))
        out.set(mat4FromLocQuatScale(loc, rot, scale), o * 16)
        return
    }
    }
}

/** `sample_point_attribute` (`mesh_sample.cc:17`): vertex values at the corner triangles' vertices. */
export function samplePointAttribute(cornerVerts: ArrayLike<number>, cornerTris: ArrayLike<number>, triIndices: ArrayLike<number>,
    bary: ArrayLike<number>, src: GVArray, out: TypedArray): void {
    const get = (i: number, k: number) => src.get(i, k)
    for (let i = 0; i < triIndices.length; i++) {
        const t = triIndices[i] * 3
        mix3(src.type, [bary[i * 3], bary[i * 3 + 1], bary[i * 3 + 2]], get,
            cornerVerts[cornerTris[t]], cornerVerts[cornerTris[t + 1]], cornerVerts[cornerTris[t + 2]], out, i)
    }
}

/** `sample_corner_attribute` (:81): corner values of the triangle's corners. */
export function sampleCornerAttribute(cornerTris: ArrayLike<number>, triIndices: ArrayLike<number>,
    bary: ArrayLike<number>, src: GVArray, out: TypedArray): void {
    const get = (i: number, k: number) => src.get(i, k)
    for (let i = 0; i < triIndices.length; i++) {
        const t = triIndices[i] * 3
        mix3(src.type, [bary[i * 3], bary[i * 3 + 1], bary[i * 3 + 2]], get, cornerTris[t], cornerTris[t + 1], cornerTris[t + 2], out, i)
    }
}

/** `sample_face_attribute` (:129): the value of the triangle's face. */
export function sampleFaceAttribute(triFaces: ArrayLike<number>, triIndices: ArrayLike<number>, src: GVArray, out: TypedArray): void {
    const c = DATA_TYPES[src.type].components
    for (let i = 0; i < triIndices.length; i++) {
        const f = triFaces[triIndices[i]]
        for (let k = 0; k < c; k++) out[i * c + k] = src.get(f, k)
    }
}

/** `sample_point_normals` (:36) / `sample_corner_normals` (:96): mixed, then `math::normalize`. */
export function sampleNormals(indices: (tri: number) => [number, number, number], triIndices: ArrayLike<number>,
    bary: ArrayLike<number>, normals: ArrayLike<number>, out: Float32Array): void {
    for (let i = 0; i < triIndices.length; i++) {
        const [a, b, c] = indices(triIndices[i])
        const w = [bary[i * 3], bary[i * 3 + 1], bary[i * 3 + 2]]
        const v = [0, 1, 2].map(k => sum3(w, normals[a * 3 + k], normals[b * 3 + k], normals[c * 3 + k]))
        out.set(normalize3(v), i * 3)
    }
}
