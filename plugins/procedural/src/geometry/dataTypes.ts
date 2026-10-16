/**
 * Value types of attributes and field values - Blender's attribute `CPPType`s
 * (`blenkernel/BKE_attribute_enums.hh:23` `AttrType`, `blenkernel/BKE_attribute_math.hh:35`
 * `to_static_type`), spelled as the mesh kernel spells them.
 *
 * | here | Blender | storage |
 * | --- | --- | --- |
 * | bool | `bool` | Uint8Array 0/1 |
 * | int8 | `int8_t` | Int8Array |
 * | int32 | `int` | Int32Array |
 * | int16x2 | `short2` | Int16Array ×2 |
 * | int32x2 | `int2` | Int32Array ×2 |
 * | float | `float` | Float32Array |
 * | float2 | `float2` | Float32Array ×2 |
 * | float3 | `float3` | Float32Array ×3 |
 * | float4 | `ColorGeometry4f` (the kernel and blend importer store float colours as `float4`) | Float32Array ×4 |
 * | byteColor | `ColorGeometry4b` | Uint8Array ×4 |
 * | quaternion | `math::Quaternion` `[w, x, y, z]` | Float32Array ×4 |
 * | float4x4 | `float4x4`, column major | Float32Array ×16 |
 */

import type {AttrType, TypedArray2} from '@threepipe/mesh-kernel'

export type DataType = AttrType | 'float4x4'

/** The kernel's attribute array type, so layers and values interchange without casts. */
export type TypedArray = TypedArray2

export interface DataTypeInfo {
    readonly components: number
    readonly array: {new(length: number): TypedArray}
    /**
     * The type's default value (`CPPType::default_value`, `blenlib/BLI_cpp_type_make.hh:355-361`):
     * value-initialised (all zeros) for every type except `math::Quaternion`, which is registered with
     * `IdentityDefaultValue` (`blenlib/intern/cpp_types.cc:52`).
     */
    readonly defaultValue: readonly number[]
    /** Floating storage: arithmetic results are rounded to float32 on store. */
    readonly isFloat: boolean
}

const zeros = (n: number) => Object.freeze(new Array<number>(n).fill(0))

export const DATA_TYPES: Readonly<Record<DataType, DataTypeInfo>> = {
    bool: {components: 1, array: Uint8Array, defaultValue: zeros(1), isFloat: false},
    int8: {components: 1, array: Int8Array, defaultValue: zeros(1), isFloat: false},
    int32: {components: 1, array: Int32Array, defaultValue: zeros(1), isFloat: false},
    int16x2: {components: 2, array: Int16Array, defaultValue: zeros(2), isFloat: false},
    int32x2: {components: 2, array: Int32Array, defaultValue: zeros(2), isFloat: false},
    float: {components: 1, array: Float32Array, defaultValue: zeros(1), isFloat: true},
    float2: {components: 2, array: Float32Array, defaultValue: zeros(2), isFloat: true},
    float3: {components: 3, array: Float32Array, defaultValue: zeros(3), isFloat: true},
    float4: {components: 4, array: Float32Array, defaultValue: zeros(4), isFloat: true},
    byteColor: {components: 4, array: Uint8Array, defaultValue: zeros(4), isFloat: false},
    quaternion: {components: 4, array: Float32Array, defaultValue: Object.freeze([1, 0, 0, 0]), isFloat: true},
    float4x4: {components: 16, array: Float32Array, defaultValue: zeros(16), isFloat: true},
}

export function allocate(type: DataType, size: number, fillDefault = true): TypedArray {
    const info = DATA_TYPES[type]
    const arr = new info.array(size * info.components)
    if (fillDefault && info.defaultValue.some(v => v !== 0)) {
        const c = info.components
        for (let i = 0; i < size; i++) for (let k = 0; k < c; k++) arr[i * c + k] = info.defaultValue[k]
    }
    return arr
}
