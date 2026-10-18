/**
 * `bke::attribute_math::mix_indices(src, indices)` (`blenkernel/BKE_attribute_math.hh:380-445`,
 * `attribute_math.cc:265`) and `mix_groups` (`attribute_math.cc:287`): the unweighted average of some source
 * elements, each multiplied by `rcp(count)` before it is accumulated (unlike the mixers, which divide at the end).
 */

import {f32, roundHalfAway} from '../blender/f32'
import {mat4ToLocQuatScaleSafe} from '../blender/math/matrix'
import {quatFromExpmap, quatToExpmap} from '../blender/math/quaternion'
import {fromLocQuatScale} from '../blender/math/rotation'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'

/** `mix_indices` for one destination element `o` of `out`. */
export function mixIndices(type: DataType, src: ArrayLike<number>, indices: ArrayLike<number>, out: TypedArray, o: number): void {
    const c = DATA_TYPES[type].components
    const n = indices.length
    // `math::rcp(float(indices.size()))`.
    const w = f32(1 / n)
    switch (type) {
    case 'bool': {
        let any = 0
        for (let i = 0; i < n; i++) if (src[indices[i]]) any = 1
        out[o] = any
        return
    }
    case 'int32': case 'int32x2': {
        // `int_to_double` / `double_to_int`: double accumulation of `double(v) * weight`, `std::round`.
        for (let k = 0; k < c; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc += src[indices[i] * c + k] * w
            out[o * c + k] = roundHalfAway(acc)
        }
        return
    }
    case 'int8': case 'int16x2': {
        // float accumulation, `std::round` / `math::round` back.
        for (let k = 0; k < c; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc = f32(acc + f32(src[indices[i] * c + k] * w))
            out[o * c + k] = roundHalfAway(acc)
        }
        return
    }
    case 'float': case 'float2': case 'float3': case 'float4': {
        for (let k = 0; k < c; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc = f32(acc + f32(src[indices[i] * c + k] * w))
            out[o * c + k] = acc
        }
        return
    }
    case 'byteColor': {
        // `byte_color_to_float4`, `float4_to_byte_color` (`ColorGeometry4b(x, y, z, w)`: truncation).
        for (let k = 0; k < 4; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc = f32(acc + f32(src[indices[i] * 4 + k] * w))
            out[o * 4 + k] = Math.trunc(acc) & 0xff
        }
        return
    }
    case 'quaternion': {
        const acc = [0, 0, 0]
        for (let i = 0; i < n; i++) {
            const s = indices[i] * 4
            const e = quatToExpmap([src[s], src[s + 1], src[s + 2], src[s + 3]])
            for (let k = 0; k < 3; k++) acc[k] = f32(acc[k] + f32(e[k] * w))
        }
        const q = quatFromExpmap(acc)
        for (let k = 0; k < 4; k++) out[o * 4 + k] = q[k]
        return
    }
    case 'float4x4': {
        // `attribute_math.cc:265`: location, rotation expmap and scale summed, then times `safe_rcp(count)`.
        const loc = [0, 0, 0], exp = [0, 0, 0], scl = [0, 0, 0]
        for (let i = 0; i < n; i++) {
            const m = Array.from({length: 16}, (_, k) => src[indices[i] * 16 + k])
            const d = mat4ToLocQuatScaleSafe(m, true)
            const e = quatToExpmap(d.rot)
            for (let k = 0; k < 3; k++) {
                loc[k] = f32(loc[k] + d.loc[k])
                exp[k] = f32(exp[k] + e[k])
                scl[k] = f32(scl[k] + d.scale[k])
            }
        }
        const inv = n === 0 ? 0 : f32(1 / n)
        const m = fromLocQuatScale(loc.map(v => f32(v * inv)), quatFromExpmap(exp.map(v => f32(v * inv))), scl.map(v => f32(v * inv)))
        for (let k = 0; k < 16; k++) out[o * 16 + k] = m[k]
        return
    }
    default:
        throw new Error(`attribute_math::mix_indices for '${type as string}' is not ported`)
    }
}

/** `math::safe_rcp(float)` (`BLI_math_base.hh:168`). */
const safeRcp = (a: number) => (a !== 0 ? f32(1 / a) : 0)

/**
 * `mix_indices(src, indices, weights)` (`BKE_attribute_math.hh:451-533`, `attribute_math.cc:298`) for one destination
 * element `o` of `out`: the weighted sum times `safe_rcp` of the summed weights.
 */
export function mixIndicesWeighted(type: DataType, src: ArrayLike<number>, indices: ArrayLike<number>, weights: ArrayLike<number>, out: TypedArray, o: number): void {
    const c = DATA_TYPES[type].components
    const n = indices.length
    let weightAccum = 0
    for (let i = 0; i < n; i++) weightAccum = f32(weightAccum + weights[i])
    const inv = safeRcp(weightAccum)
    switch (type) {
    case 'bool': {
        let any = 0
        for (let i = 0; i < n; i++) if (src[indices[i]] && weights[i] > 0) any = 1
        out[o] = any
        return
    }
    case 'int32': case 'int32x2': {
        // `int_to_double` / `int2_to_double2`: `double(v) * float` accumulated in double, `std::round(accum * rcp)`.
        for (let k = 0; k < c; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc += src[indices[i] * c + k] * weights[i]
            out[o * c + k] = roundHalfAway(acc * inv)
        }
        return
    }
    case 'int8': case 'int16x2': {
        for (let k = 0; k < c; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc = f32(acc + f32(src[indices[i] * c + k] * weights[i]))
            out[o * c + k] = roundHalfAway(f32(acc * inv))
        }
        return
    }
    case 'float': case 'float2': case 'float3': case 'float4': {
        for (let k = 0; k < c; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc = f32(acc + f32(src[indices[i] * c + k] * weights[i]))
            out[o * c + k] = f32(acc * inv)
        }
        return
    }
    case 'byteColor': {
        for (let k = 0; k < 4; k++) {
            let acc = 0
            for (let i = 0; i < n; i++) acc = f32(acc + f32(src[indices[i] * 4 + k] * weights[i]))
            out[o * 4 + k] = Math.trunc(f32(acc * inv)) & 0xff
        }
        return
    }
    case 'quaternion': {
        const acc = [0, 0, 0]
        for (let i = 0; i < n; i++) {
            const s = indices[i] * 4
            const e = quatToExpmap([src[s], src[s + 1], src[s + 2], src[s + 3]])
            for (let k = 0; k < 3; k++) acc[k] = f32(acc[k] + f32(e[k] * weights[i]))
        }
        const q = quatFromExpmap(acc.map(v => f32(v * inv)))
        for (let k = 0; k < 4; k++) out[o * 4 + k] = q[k]
        return
    }
    case 'float4x4': {
        // `attribute_math.cc:298`.
        const loc = [0, 0, 0], exp = [0, 0, 0], scl = [0, 0, 0]
        for (let i = 0; i < n; i++) {
            const w = weights[i]
            const m = Array.from({length: 16}, (_, k) => src[indices[i] * 16 + k])
            const d = mat4ToLocQuatScaleSafe(m, true)
            const e = quatToExpmap(d.rot)
            for (let k = 0; k < 3; k++) {
                loc[k] = f32(loc[k] + f32(d.loc[k] * w))
                exp[k] = f32(exp[k] + f32(e[k] * w))
                scl[k] = f32(scl[k] + f32(d.scale[k] * w))
            }
        }
        const m = fromLocQuatScale(loc.map(v => f32(v * inv)), quatFromExpmap(exp.map(v => f32(v * inv))), scl.map(v => f32(v * inv)))
        for (let k = 0; k < 16; k++) out[o * 16 + k] = m[k]
        return
    }
    default:
        throw new Error(`attribute_math::mix_indices (weighted) for '${type as string}' is not ported`)
    }
}
