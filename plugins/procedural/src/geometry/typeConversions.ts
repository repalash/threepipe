/**
 * Implicit conversions between attribute/socket value types - port of
 * `blenkernel/intern/type_conversions.cc:46-700` (`create_implicit_conversions`). Used for links
 * between sockets of different types and for reading an attribute as another type.
 *
 * Colours (`float4` = `ColorGeometry4f`) convert through luminance with the OCIO config's default luma
 * coefficients (`release/datafiles/colormanagement/config.ocio:21`, read by
 * `imbuf/intern/colormanagement.cc:204`). Byte colours (`color::encode` / `decode`, sRGB tables in
 * `blenlib/BLI_color.hh:50-85`) are not ported yet and throw.
 */

import {f32, truncToInt} from '../blender/f32'
import {eulerToQuat, mat3ToEuler, normalizedToQuatSafe, quatToMat3} from '../blender/math/matrix'
import {DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {decodeByteColor, encodeByteColor} from '../blender/color'
import {GVArray} from './varray'

const LUMA = [f32(0.2126), f32(0.7152), f32(0.0722)]

/** `IMB_colormanagement_get_luminance` (`imbuf/intern/colormanagement_inline.h:24`): `dot_v3v3`. */
function luminance(r: number, g: number, b: number): number {
    return f32(f32(f32(LUMA[0] * r) + f32(LUMA[1] * g)) + f32(LUMA[2] * b))
}

/** C++ `int32_t(float)` conversion (truncation). */
const toInt = (x: number) => truncToInt(x)
/** `short2(float)`, `int2(float)` component conversions also truncate. */
const toShort = (x: number) => (Math.trunc(x) << 16) >> 16

/** `float_to_int8` (`type_conversions.cc:78`): clamp to [-128, 127] then the implicit int8 conversion (truncation). */
const floatToInt8 = (a: number) => Math.trunc(Math.min(Math.max(a, -128), 127))
/** `int_to_int8` (`:247`). */
const intToInt8 = (a: number) => Math.min(Math.max(a, -128), 127)
/** `math::midpoint(int, int)` (`BLI_math_base.hh`): `a + (b - a) / 2` with integer division toward zero, without overflow. */
function midpointInt(a: number, b: number): number {
    // std::midpoint for integers rounds toward a.
    const diff = b - a
    return a + Math.trunc(diff / 2)
}

function isZero(v: ArrayLike<number>, s: number, n: number): boolean {
    for (let k = 0; k < n; k++) if (v[s + k] !== 0) return false
    return true
}

type Conv = (src: ArrayLike<number>, s: number, out: number[]) => void

function avg2(a: number, b: number): number {
    return f32(f32(a + b) / 2)
}

function avg3(a: number, b: number, c: number): number {
    return f32(f32(f32(a + b) + c) / 3)
}

/** The table: `CONVERSIONS[from][to]` writes the converted components into `out`. */
const CONVERSIONS: Partial<Record<DataType, Partial<Record<DataType, Conv>>>> = {
    float: {
        float2: (v, s, o) => { o[0] = o[1] = v[s] },
        float3: (v, s, o) => { o[0] = o[1] = o[2] = v[s] },
        float4: (v, s, o) => { o[0] = o[1] = o[2] = v[s]; o[3] = 1 }, // float_to_color (:83)
        int32: (v, s, o) => { o[0] = toInt(v[s]) },
        int16x2: (v, s, o) => { o[0] = o[1] = toShort(v[s]) },
        int32x2: (v, s, o) => { o[0] = o[1] = toInt(v[s]) },
        bool: (v, s, o) => { o[0] = v[s] > 0 ? 1 : 0 },
        int8: (v, s, o) => { o[0] = floatToInt8(v[s]) },
        quaternion: (v, s, o) => { o.splice(0, 4, ...eulerToQuat([v[s], v[s], v[s]])) },
    },
    float2: {
        float3: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1]; o[2] = 0 },
        float4: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1]; o[2] = 0; o[3] = 1 }, // float2_to_color (:132)
        float: (v, s, o) => { o[0] = avg2(v[s], v[s + 1]) },
        int32: (v, s, o) => { o[0] = toInt(avg2(v[s], v[s + 1])) },
        int16x2: (v, s, o) => { o[0] = toShort(v[s]); o[1] = toShort(v[s + 1]) },
        int32x2: (v, s, o) => { o[0] = toInt(v[s]); o[1] = toInt(v[s + 1]) },
        bool: (v, s, o) => { o[0] = isZero(v, s, 2) ? 0 : 1 },
        int8: (v, s, o) => { o[0] = floatToInt8(avg2(v[s], v[s + 1])) },
        quaternion: (v, s, o) => { o.splice(0, 4, ...eulerToQuat([v[s], v[s + 1], 0])) },
    },
    float3: {
        bool: (v, s, o) => { o[0] = isZero(v, s, 3) ? 0 : 1 },
        int8: (v, s, o) => { o[0] = floatToInt8(avg3(v[s], v[s + 1], v[s + 2])) },
        float: (v, s, o) => { o[0] = avg3(v[s], v[s + 1], v[s + 2]) },
        int32: (v, s, o) => { o[0] = toInt(avg3(v[s], v[s + 1], v[s + 2])) },
        int16x2: (v, s, o) => { o[0] = toShort(v[s]); o[1] = toShort(v[s + 1]) },
        int32x2: (v, s, o) => { o[0] = toInt(v[s]); o[1] = toInt(v[s + 1]) },
        float2: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1] },
        float4: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1]; o[2] = v[s + 2]; o[3] = 1 }, // float3_to_color (:181)
        quaternion: (v, s, o) => { o.splice(0, 4, ...eulerToQuat([v[s], v[s + 1], v[s + 2]])) },
    },
    // `float4` here is ColorGeometry4f; the colour conversions (`color_to_*`, :514-556) apply.
    float4: {
        bool: (v, s, o) => { o[0] = luminance(v[s], v[s + 1], v[s + 2]) > 0 ? 1 : 0 },
        float: (v, s, o) => { o[0] = luminance(v[s], v[s + 1], v[s + 2]) },
        int32: (v, s, o) => { o[0] = toInt(luminance(v[s], v[s + 1], v[s + 2])) },
        int16x2: (v, s, o) => { o[0] = toShort(v[s]); o[1] = toShort(v[s + 1]) },
        int32x2: (v, s, o) => { o[0] = toInt(v[s]); o[1] = toInt(v[s + 1]) },
        int8: (v, s, o) => { o[0] = intToInt8(toInt(luminance(v[s], v[s + 1], v[s + 2]))) },
        float2: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1] },
        float3: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1]; o[2] = v[s + 2] },
        // ColorGeometry4f -> Quaternion is not registered (`type_conversions.cc:700-760`).
    },
    int32: {
        bool: (v, s, o) => { o[0] = v[s] > 0 ? 1 : 0 },
        int8: (v, s, o) => { o[0] = intToInt8(v[s]) },
        int16x2: (v, s, o) => { o[0] = o[1] = toShort(v[s]) },
        int32x2: (v, s, o) => { o[0] = o[1] = v[s] },
        float: (v, s, o) => { o[0] = f32(v[s]) },
        float2: (v, s, o) => { o[0] = o[1] = f32(v[s]) },
        float3: (v, s, o) => { o[0] = o[1] = o[2] = f32(v[s]) },
        float4: (v, s, o) => { o[0] = o[1] = o[2] = f32(v[s]); o[3] = 1 }, // int_to_color (:280)
    },
    int16x2: {
        bool: (v, s, o) => { o[0] = isZero(v, s, 2) ? 0 : 1 },
        float2: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1] },
        int32: (v, s, o) => { o[0] = midpointInt(v[s], v[s + 1]) },
        int32x2: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1] },
        int8: (v, s, o) => { o[0] = intToInt8(midpointInt(v[s], v[s + 1])) },
        float: (v, s, o) => { o[0] = avg2(v[s], v[s + 1]) },
        float3: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1]; o[2] = 0 },
        float4: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1]; o[2] = 0; o[3] = 1 },
    },
    int32x2: {
        bool: (v, s, o) => { o[0] = isZero(v, s, 2) ? 0 : 1 },
        float2: (v, s, o) => { o[0] = f32(v[s]); o[1] = f32(v[s + 1]) },
        int32: (v, s, o) => { o[0] = midpointInt(v[s], v[s + 1]) },
        int16x2: (v, s, o) => { o[0] = toShort(v[s]); o[1] = toShort(v[s + 1]) },
        int8: (v, s, o) => { o[0] = intToInt8(midpointInt(v[s], v[s + 1])) },
        float: (v, s, o) => { o[0] = avg2(f32(v[s]), f32(v[s + 1])) },
        float3: (v, s, o) => { o[0] = f32(v[s]); o[1] = f32(v[s + 1]); o[2] = 0 },
        float4: (v, s, o) => { o[0] = f32(v[s]); o[1] = f32(v[s + 1]); o[2] = 0; o[3] = 1 },
    },
    int8: {
        bool: (v, s, o) => { o[0] = v[s] > 0 ? 1 : 0 },
        int32: (v, s, o) => { o[0] = v[s] },
        int16x2: (v, s, o) => { o[0] = o[1] = v[s] },
        int32x2: (v, s, o) => { o[0] = o[1] = v[s] },
        float: (v, s, o) => { o[0] = v[s] },
        float2: (v, s, o) => { o[0] = o[1] = v[s] },
        float3: (v, s, o) => { o[0] = o[1] = o[2] = v[s] },
        float4: (v, s, o) => { o[0] = o[1] = o[2] = v[s]; o[3] = 1 },
    },
    bool: {
        float: (v, s, o) => { o[0] = v[s] ? 1 : 0 },
        int8: (v, s, o) => { o[0] = v[s] ? 1 : 0 },
        int32: (v, s, o) => { o[0] = v[s] ? 1 : 0 },
        int16x2: (v, s, o) => { o[0] = o[1] = v[s] ? 1 : 0 },
        int32x2: (v, s, o) => { o[0] = o[1] = v[s] ? 1 : 0 },
        float2: (v, s, o) => { o[0] = o[1] = v[s] ? 1 : 0 },
        float3: (v, s, o) => { o[0] = o[1] = o[2] = v[s] ? 1 : 0 },
        float4: (v, s, o) => { const x = v[s] ? 1 : 0; o[0] = o[1] = o[2] = x; o[3] = 1 }, // bool_to_color (:505)
    },
    quaternion: {
        float2: (v, s, o) => { const e = quatToEuler(v, s); o[0] = e[0]; o[1] = e[1] },
        float3: (v, s, o) => { const e = quatToEuler(v, s); o[0] = e[0]; o[1] = e[1]; o[2] = e[2] },
        // Quaternion -> float4 is registered for the generic float4, not for ColorGeometry4f, which is
        // what this package's 'float4' is.
        float4x4: (v, s, o) => {
            // quaternion_to_float4x4 (:621): from_rotation<float4x4>
            const m = quatToMat3([v[s], v[s + 1], v[s + 2], v[s + 3]])
            for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = c < 3 && r < 3 ? m[c * 3 + r] : (c === r ? 1 : 0)
        },
    },
    float4x4: {
        // float4x4_to_quaternion (:604): normalized_to_quaternion_safe(normalize(float3x3(a)))
        quaternion: (v, s, o) => {
            const m = new Float32Array(9)
            for (let c = 0; c < 3; c++) {
                const x = v[s + c * 4], y = v[s + c * 4 + 1], z = v[s + c * 4 + 2]
                const sq = f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))
                if (sq > 1.0e-35) {
                    const len = f32(Math.sqrt(sq))
                    m[c * 3] = x / len
                    m[c * 3 + 1] = y / len
                    m[c * 3 + 2] = z / len
                }
            }
            o.splice(0, 4, ...normalizedToQuatSafe(m))
        },
    },
}

// Byte colours (`*_to_byte_color` = `color::encode(*_to_color(a))`, `byte_color_to_*` through
// `color::decode`, `type_conversions.cc:87-600`).
for (const from of Object.keys(CONVERSIONS) as DataType[]) {
    const toColor = from === 'float4' ? (v: ArrayLike<number>, s: number, o: number[]) => {
        for (let k = 0; k < 4; k++) o[k] = v[s + k]
    } : CONVERSIONS[from]!.float4
    if (!toColor) continue
    CONVERSIONS[from]!.byteColor = (v, s, o) => {
        const c: number[] = []
        toColor(v, s, c)
        encodeByteColor(c, o)
    }
}
CONVERSIONS.byteColor = {
    bool: (v, s, o) => { o[0] = v[s] > 0 || v[s + 1] > 0 || v[s + 2] > 0 ? 1 : 0 },
    int16x2: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1] },
    int32x2: (v, s, o) => { o[0] = v[s]; o[1] = v[s + 1] },
    float4: (v, s, o) => { decodeByteColor([v[s], v[s + 1], v[s + 2], v[s + 3]], o) },
}
for (const to of ['float', 'int32', 'int8', 'float2', 'float3'] as DataType[]) {
    const fromColor = CONVERSIONS.float4![to]!
    CONVERSIONS.byteColor[to] = (v, s, o) => fromColor(decodeByteColor([v[s], v[s + 1], v[s + 2], v[s + 3]]), 0, o)
}

/** `math::to_euler(Quaternion)` through the rotation matrix (`BLI_math_quaternion.hh:660`). */
function quatToEuler(v: ArrayLike<number>, s: number): number[] {
    return mat3ToEuler(quatToMat3([v[s], v[s + 1], v[s + 2], v[s + 3]]))
}

/** Whether Blender converts `from` to `to` implicitly (`DataTypeConversions::is_convertible`). */
export function isConvertible(from: DataType, to: DataType): boolean {
    return from === to || !!CONVERSIONS[from]?.[to]
}

/** Convert one element. */
export function convertElement(from: DataType, to: DataType, src: ArrayLike<number>, si: number, out: TypedArray, oi: number): void {
    const cTo = DATA_TYPES[to].components
    if (from === to) {
        for (let k = 0; k < cTo; k++) out[oi * cTo + k] = src[si * cTo + k]
        return
    }
    const fn = CONVERSIONS[from]?.[to]
    if (!fn) throw new Error(`procedural: no implicit conversion from ${from} to ${to}`)
    const tmp: number[] = new Array(cTo).fill(0)
    fn(src, si * DATA_TYPES[from].components, tmp)
    for (let k = 0; k < cTo; k++) out[oi * cTo + k] = tmp[k]
}

/** Convert a whole varray, keeping single values single (`DataTypeConversions::try_convert`). */
export function convertVArray(varray: GVArray, to: DataType): GVArray {
    if (varray.type === to) return varray
    if (!isConvertible(varray.type, to)) throw new Error(`procedural: no implicit conversion from ${varray.type} to ${to}`)
    if (varray.isSingle) {
        const out = new DATA_TYPES[to].array(DATA_TYPES[to].components)
        convertElement(varray.type, to, varray.single, 0, out, 0)
        return GVArray.fromSingle(to, varray.size, Array.from(out))
    }
    const src = varray.materialize()
    const out = new DATA_TYPES[to].array(varray.size * DATA_TYPES[to].components)
    for (let i = 0; i < varray.size; i++) convertElement(varray.type, to, src, i, out, i)
    return GVArray.fromArray(to, out)
}
