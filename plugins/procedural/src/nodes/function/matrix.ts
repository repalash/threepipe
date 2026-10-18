/**
 * Matrix function nodes (`nodes/function/nodes/node_fn_*.cc`): Combine Transform, Separate Transform,
 * Transform Point, Transform Direction, Multiply Matrices, Invert Matrix. `float4x4` values are column
 * major (`MatBase`).
 */

import {f32} from '../../blender/f32'
import {mat4Multiply, normalizeAndGetSize3, normalizedToQuatSafe, quatToMat3, transformPoint} from '../../blender/math'
import {invertMat4} from '../../blender/math/eigen'
import {fromLocQuatScale, quatAngleOf} from '../../blender/math/rotation'
import {elementwise, MultiFunction} from '../../fields/field'
import {GVArray} from '../../geometry/varray'
import {registerNodeType} from '../../runtime/registry'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

const read = (v: GVArray, i: number, n: number) => {
    const r = new Array<number>(n)
    for (let k = 0; k < n; k++) r[k] = v.get(i, k)
    return r
}

/**
 * `CombineTransformFunction::call` (`node_fn_combine_transform.cc:40-72`): single inputs that are an
 * identity part select the cheaper constructors (`from_location`, `from_rotation`, `from_scale`); a
 * single rotation with `angle_of < 1e-7` counts as none even when it is not exactly the identity.
 */
const combineTransform: MultiFunction = {
    name: 'Combine Transform', inputs: ['float3', 'quaternion', 'float3'], outputs: ['float4x4'],
    call(size, [translation, rotation, scale], [out]) {
        const noTranslation = translation.isSingle && translation.single[0] === 0 && translation.single[1] === 0 && translation.single[2] === 0
        const noRotation = rotation.isSingle && quatAngleOf(rotation.single) < f32(1e-7)
        // `math::is_equal(scale, float3(1), 1e-7f)`: |a - b| <= epsilon per component.
        const eps = f32(1e-7)
        const noScale = scale.isSingle && [0, 1, 2].every(k => Math.abs(f32(scale.single[k] - 1)) <= eps)
        for (let i = 0; i < size; i++) {
            const m = out.subarray(i * 16, i * 16 + 16) as Float32Array
            if (noRotation && noScale) {
                // `from_location<float4x4>`.
                m.set(IDENTITY)
                m.set(read(translation, i, 3), 12)
            } else if (noTranslation && noScale) {
                // `from_rotation<float4x4>(Quaternion)` (`BLI_math_matrix.hh:1048`).
                const r = quatToMat3(read(rotation, i, 4))
                m.set(IDENTITY)
                for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[c * 4 + k] = r[c * 3 + k]
            } else if (noTranslation && noRotation) {
                // `from_scale<float4x4>`.
                const s = read(scale, i, 3)
                m.set(IDENTITY)
                m[0] = s[0]
                m[5] = s[1]
                m[10] = s[2]
            } else {
                // `from_loc_rot_scale<float4x4>` (`BLI_math_matrix.hh:1447`).
                fromLocQuatScale(read(translation, i, 3), read(rotation, i, 4), read(scale, i, 3), m)
            }
        }
    },
}

registerNodeType({
    idname: 'FunctionNodeCombineTransform',
    label: 'Combine Transform',
    // node_fn_combine_transform.cc:15.
    declare(b) {
        b.input('VECTOR', 'Translation').subtype('TRANSLATION')
        b.input('ROTATION', 'Rotation')
        b.input('VECTOR', 'Scale').default([1, 1, 1]).subtype('XYZ')
        b.output('MATRIX', 'Transform')
    },
    multiFunction: () => combineTransform,
})

/**
 * `SeparateTransformFunction::call` (`node_fn_separate_transform.cc:40-70`) when Rotation and Scale are both
 * used: `normalize_and_get_size`, then `normalized_to_quaternion_safe`. Blender computes Scale alone with
 * `to_scale` and Rotation alone without the sizes; the runtime computes every output, so this is the
 * both-outputs path. The results differ only for a column whose squared length is at most 1e-35
 * (`normalize_and_get_length` returns 0 there, `to_scale` the square root).
 */
const separateTransform = elementwise('Separate Transform', ['float4x4'], ['float3', 'quaternion', 'float3'], ([m], [t, r, s]) => {
    t[0] = m[12]
    t[1] = m[13]
    t[2] = m[14]
    const m3 = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
    const {m: n, size} = normalizeAndGetSize3(m3)
    const q = normalizedToQuatSafe(n)
    for (let k = 0; k < 4; k++) r[k] = q[k]
    s[0] = size[0]
    s[1] = size[1]
    s[2] = size[2]
})

registerNodeType({
    idname: 'FunctionNodeSeparateTransform',
    label: 'Separate Transform',
    // node_fn_separate_transform.cc:15.
    declare(b) {
        b.input('MATRIX', 'Transform')
        b.output('VECTOR', 'Translation').subtype('TRANSLATION')
        b.output('ROTATION', 'Rotation')
        b.output('VECTOR', 'Scale').subtype('XYZ')
    },
    multiFunction: () => separateTransform,
})

// `math::transform_point(float4x4, float3)` (`BLI_math_matrix.hh:1647`).
const transformPointFn = elementwise('Transform Point', ['float3', 'float4x4'], ['float3'], ([p, m], [o]) => transformPoint(m, p[0], p[1], p[2], o))

registerNodeType({
    idname: 'FunctionNodeTransformPoint',
    label: 'Transform Point',
    // node_fn_transform_point.cc:13; function :23.
    declare(b) {
        b.input('VECTOR', 'Vector').subtype('XYZ')
        b.output('VECTOR', 'Vector').subtype('XYZ')
        b.input('MATRIX', 'Transform')
    },
    multiFunction: () => transformPointFn,
})

/**
 * `math::transform_direction(float4x4, float3)` (`BLI_math_matrix.hh:1659`): `float3x3 * direction`
 * (`result += b[c] * a[c]`, like {@link transformPoint} without the location).
 */
const transformDirectionFn = elementwise('Transform Direction', ['float3', 'float4x4'], ['float3'], ([d, m], [o]) => {
    for (let k = 0; k < 3; k++) o[k] = f32(f32(f32(f32(0 + f32(d[0] * m[k])) + f32(d[1] * m[4 + k])) + f32(d[2] * m[8 + k])))
})

registerNodeType({
    idname: 'FunctionNodeTransformDirection',
    label: 'Transform Direction',
    // node_fn_transform_direction.cc:13; function :23.
    declare(b) {
        b.input('VECTOR', 'Direction').subtype('XYZ')
        b.output('VECTOR', 'Direction').subtype('XYZ')
        b.input('MATRIX', 'Transform')
    },
    multiFunction: () => transformDirectionFn,
})

// `a * b` (`blenlib/intern/math_matrix.cc:26`).
const multiplyMatrices = elementwise('Multiply Matrices', ['float4x4', 'float4x4'], ['float4x4'], ([a, b], [o]) => {
    const r = mat4Multiply(a, b)
    for (let k = 0; k < 16; k++) o[k] = r[k]
})

registerNodeType({
    idname: 'FunctionNodeMatrixMultiply',
    label: 'Multiply Matrices',
    // node_fn_matrix_multiply.cc:16; function :24.
    declare(b) {
        b.input('MATRIX', 'Matrix')
        b.input('MATRIX', 'Matrix', 'Matrix_001')
        b.output('MATRIX', 'Matrix')
    },
    multiFunction: () => multiplyMatrices,
})

/** `InvertMatrixFunction::call` (`node_fn_invert_matrix.cc:41`): the inverse, or identity when not invertible. */
const invertMatrix = elementwise('Invert Matrix', ['float4x4'], ['float4x4', 'bool'], ([m], [o, ok]) => {
    const {m: inv, success} = invertMat4(m)
    const r = success ? inv : IDENTITY
    for (let k = 0; k < 16; k++) o[k] = r[k]
    ok[0] = success ? 1 : 0
})

registerNodeType({
    idname: 'FunctionNodeInvertMatrix',
    label: 'Invert Matrix',
    // node_fn_invert_matrix.cc:13.
    declare(b) {
        b.input('MATRIX', 'Matrix')
        b.output('MATRIX', 'Matrix')
        b.output('BOOLEAN', 'Invertible')
    },
    multiFunction: () => invertMatrix,
})

export const MATRIX_IDENTITY: readonly number[] = IDENTITY
