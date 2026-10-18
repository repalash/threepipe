/**
 * Function nodes: Float to Integer (`node_fn_float_to_int.cc`), Bit Math (`node_fn_bit_math.cc` with
 * `multi_function_common.cc:629-667`), Axes to Rotation (`node_fn_axes_to_rotation.cc`), Combine / Separate Matrix
 * (`node_fn_combine_matrix.cc`, `node_fn_separate_matrix.cc`), Transpose Matrix, Matrix Determinant and Project Point
 * (`node_fn_transpose_matrix.cc`, `node_fn_matrix_determinant.cc`, `node_fn_project_point.cc`).
 */

import {f32, roundHalfAway} from '../../blender/f32'
import {eigenDeterminant4} from '../../blender/math/eigen'
import {jacobiSvdSquare} from '../../blender/math/jacobiSvd'
import {mat3ToQuat} from '../../blender/math/matrix'
import {cross3, isZero3, normalize3} from '../../blender/math/vec'
import {elementwise, MultiFunction} from '../../fields/field'
import {modPeriodicI} from '../../blender/math/base'
import {registerNodeType} from '../../runtime/registry'
import {fn1, fn2} from '../util'

/**
 * C++ `int(x)` of a floating value as arm64 converts it (`fcvtzs`): toward zero, saturating at the `int` range, NaN
 * to 0. (Out-of-range conversion is undefined in C++; this is what Blender's reference build does.)
 */
export function fcvtzs(x: number): number {
    if (Number.isNaN(x)) return 0
    if (x >= 2147483647) return 2147483647
    if (x <= -2147483648) return -2147483648
    return Math.trunc(x)
}

/** `get_multi_function` (:44): `int(round(a))`, `int(floor(a))`, `int(ceil(a))`, `int(trunc(a))`. */
const FLOAT_TO_INT: Record<string, MultiFunction> = {
    ROUND: fn1('Round', a => fcvtzs(roundHalfAway(a)), 'float', 'int32'),
    FLOOR: fn1('Floor', a => fcvtzs(Math.floor(a)), 'float', 'int32'),
    CEILING: fn1('Ceiling', a => fcvtzs(Math.ceil(a)), 'float', 'int32'),
    TRUNCATE: fn1('Truncate', a => fcvtzs(Math.trunc(a)), 'float', 'int32'),
}

registerNodeType({
    idname: 'FunctionNodeFloatToInt',
    label: 'Float to Integer',
    properties: {rounding_mode: 'ROUND'},
    enums: {rounding_mode: ['ROUND', 'FLOOR', 'CEILING', 'TRUNCATE']},
    declare(b) {
        b.input('FLOAT', 'Float')
        b.output('INT', 'Integer')
    },
    multiFunction(node) {
        const fn = FLOAT_TO_INT[node.prop<string>('rounding_mode')]
        if (!fn) throw new Error(`procedural: Float to Integer mode ${node.prop<string>('rounding_mode')} is not a Blender item`)
        return fn
    },
})

const U32 = (1n << 32n) - 1n
const U64 = (1n << 64n) - 1n
const i2 = (name: string, f: (a: number, b: number) => number) => fn2(name, f, 'int32', 'int32')

/** The registered functions Bit Math looks up (`multi_function_common.cc:629-667`). */
const BIT_MATH: Record<string, MultiFunction> = {
    AND: i2('int & int', (a, b) => a & b),
    OR: i2('int | int', (a, b) => a | b),
    XOR: i2('int ^ int', (a, b) => a ^ b),
    NOT: fn1('~int', a => ~a, 'int32', 'int32'),
    SHIFT: i2('shift(int, int)', (a, b) => {
        const value = BigInt(a >>> 0)
        const shift = Math.min(Math.max(b, -32), 32)
        const wide = value << 16n
        const result = shift > 0 ? (wide << BigInt(shift)) & U64 : wide >> BigInt(-shift)
        return Number((result >> 16n) & U32) | 0
    }),
    ROTATE: i2('rotate(int, int)', (a, b) => {
        const value = BigInt(a >>> 0)
        const shift = BigInt(modPeriodicI(b, 32))
        const wide = value | (value << 32n)
        const doubled = (wide << shift) & U64
        return Number((doubled | (doubled >> 32n)) & ((1n << 33n) - 1n) & U32) | 0
    }),
}

registerNodeType({
    idname: 'FunctionNodeBitMath',
    label: 'Bit Math',
    properties: {operation: 'AND'},
    enums: {operation: ['AND', 'OR', 'XOR', 'NOT', 'SHIFT', 'ROTATE']},
    declare(b, node) {
        const op = node.prop<string>('operation')
        const shifting = op === 'SHIFT' || op === 'ROTATE'
        b.input('INT', 'A')
        b.input('INT', 'B').available(op !== 'NOT' && !shifting)
        b.input('INT', 'Shift').min(-31).max(31).available(shifting)
        b.output('INT', 'Value')
    },
    multiFunction(node) {
        const op = node.prop<string>('operation')
        const fn = BIT_MATH[op]
        if (!fn) throw new Error(`procedural: Bit Math operation ${op} is not a Blender item`)
        return fn
    },
})

/** Writes every component of an elementwise output. */
function put(out: number[], v: ArrayLike<number>): void {
    for (let k = 0; k < v.length; k++) out[k] = v[k]
}

/** `get_orthogonal_of_non_zero_vector` (:38). */
function orthogonal(v: ArrayLike<number>): number[] {
    if (v[0] !== -v[1]) return [-v[1], v[0], 0]
    if (v[0] !== -v[2]) return [-v[2], 0, v[0]]
    return [0, -v[2], v[1]]
}

/** `AxesToRotationFunction::call` (:72). */
function axesToRotation(primaryAxis: number, secondaryAxis: number): MultiFunction {
    const tertiaryAxis = 3 - primaryAxis - secondaryAxis
    const tertiaryFactor = (secondaryAxis + 1) % 3 === primaryAxis ? -1 : 1
    return elementwise('Axes to Rotation', ['float3', 'float3'], ['quaternion'], ([p, s], [out]) => {
        let primary: number[] = normalize3(p)
        let secondary: number[] = [s[0], s[1], s[2]]
        let tertiary: number[]
        const primaryNonZero = !isZero3(primary), secondaryNonZero = !isZero3(secondary)
        if (primaryNonZero && secondaryNonZero) {
            tertiary = cross3(primary, secondary)
            if (isZero3(tertiary)) tertiary = orthogonal(primary)
            tertiary = normalize3(tertiary)
            secondary = cross3(tertiary, primary)
        } else if (primaryNonZero) {
            secondary = normalize3(orthogonal(primary))
            tertiary = cross3(primary, secondary)
        } else if (secondaryNonZero) {
            secondary = normalize3(secondary)
            primary = normalize3(orthogonal(secondary))
            tertiary = cross3(primary, secondary)
        } else {
            put(out, [1, 0, 0, 0])
            return
        }
        const mat = new Float32Array(9)
        mat.set(primary, primaryAxis * 3)
        mat.set(secondary, secondaryAxis * 3)
        mat.set(tertiary.map(x => f32(tertiaryFactor * x)), tertiaryAxis * 3)
        put(out, mat3ToQuat(mat))
    })
}

const AXES = ['X', 'Y', 'Z']

registerNodeType({
    idname: 'FunctionNodeAxesToRotation',
    label: 'Axes to Rotation',
    // `node_init` (:28): Z primary, X secondary.
    properties: {primary_axis: 'Z', secondary_axis: 'X'},
    enums: {primary_axis: AXES, secondary_axis: AXES},
    dslPropertyKeys: {primary_axis: 'primaryAxisEnum', secondary_axis: 'secondaryAxisEnum'},
    declare(b) {
        b.input('VECTOR', 'Primary Axis').default([0, 0, 1])
        b.input('VECTOR', 'Secondary Axis').default([1, 0, 0])
        b.output('ROTATION', 'Rotation')
    },
    // `node_build_multi_function` (:153): equal axes give the identity.
    multiFunction(node) {
        const a = AXES.indexOf(node.prop<string>('primary_axis')), c = AXES.indexOf(node.prop<string>('secondary_axis'))
        if (a === c) return elementwise('Axes to Rotation fallback', ['float3', 'float3'], ['quaternion'], (_, [out]) => put(out, [1, 0, 0, 0]))
        return axesToRotation(a, c)
    },
})

const MATRIX_SOCKETS = [1, 2, 3, 4].flatMap(c => [1, 2, 3, 4].map(r => `Column ${c} Row ${r}`))

/** `CombineMatrixFunction` (:52): components in column-major order. */
const combineMatrix = elementwise('Combine Matrix', MATRIX_SOCKETS.map(() => 'float' as const), ['float4x4'], (inputs, [out]) => {
    for (let k = 0; k < 16; k++) out[k] = inputs[k][0]
})

registerNodeType({
    idname: 'FunctionNodeCombineMatrix',
    label: 'Combine Matrix',
    declare(b) {
        b.output('MATRIX', 'Matrix')
        MATRIX_SOCKETS.forEach((name, k) => b.input('FLOAT', name).default(k % 5 === 0 ? 1 : 0))
    },
    multiFunction: () => combineMatrix,
})

const separateMatrix = elementwise('Separate Matrix', ['float4x4'], MATRIX_SOCKETS.map(() => 'float' as const), ([m], outputs) => {
    for (let k = 0; k < 16; k++) outputs[k][0] = m[k]
})

registerNodeType({
    idname: 'FunctionNodeSeparateMatrix',
    label: 'Separate Matrix',
    declare(b) {
        for (const name of MATRIX_SOCKETS) b.output('FLOAT', name)
        b.input('MATRIX', 'Matrix')
    },
    multiFunction: () => separateMatrix,
})

const transposeMatrix = elementwise('Transpose Matrix', ['float4x4'], ['float4x4'], ([m], [out]) => {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = m[r * 4 + c]
})

registerNodeType({
    idname: 'FunctionNodeTransposeMatrix',
    label: 'Transpose Matrix',
    declare(b) {
        b.input('MATRIX', 'Matrix')
        b.output('MATRIX', 'Matrix')
    },
    multiFunction: () => transposeMatrix,
})

/** `math::determinant(float4x4)` (`math_matrix.cc:131`): Eigen's 4x4 determinant (arm64, fused). */
const matrixDeterminant = elementwise('Matrix Determinant', ['float4x4'], ['float'], ([m], [out]) => {
    out[0] = eigenDeterminant4(m)
})

registerNodeType({
    idname: 'FunctionNodeMatrixDeterminant',
    label: 'Matrix Determinant',
    declare(b) {
        b.input('MATRIX', 'Matrix')
        b.output('FLOAT', 'Determinant')
    },
    multiFunction: () => matrixDeterminant,
})

/**
 * Matrix SVD (`node_fn_matrix_svd.cc:41`): `BLI_svd_m3` of the matrix's 3x3 part; U and V become 4x4 matrices with
 * the identity around them (`float4x4(float3x3)`).
 */
const matrixSvd = elementwise('Matrix SVD', ['float4x4'], ['float4x4', 'float3', 'float4x4'], ([m], [u, s, v]) => {
    const m3 = new Float32Array(9)
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m3[c * 3 + r] = m[c * 4 + r]
    const res = jacobiSvdSquare(m3, 3)
    for (const [out, src] of [[u, res.u], [v, res.v]] as const) {
        for (let k = 0; k < 16; k++) out[k] = k % 5 === 0 ? 1 : 0
        for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = src[c * 3 + r]
    }
    for (let k = 0; k < 3; k++) s[k] = res.s[k]
})

registerNodeType({
    idname: 'FunctionNodeMatrixSVD',
    label: 'Matrix SVD',
    declare(b) {
        b.input('MATRIX', 'Matrix')
        b.output('MATRIX', 'U')
        b.output('VECTOR', 'S')
        b.output('MATRIX', 'V')
    },
    multiFunction: () => matrixSvd,
})

/**
 * `math::project_point(float4x4, float3)` (`BLI_math_matrix.hh:1665`): `mat * float4(point, 1)` (`result += b[c] *
 * a[c]`, `BLI_math_matrix_types.hh:402`), then `xyz / abs(w)`.
 */
const projectPoint = elementwise('Project Point', ['float3', 'float4x4'], ['float3'], ([p, m], [out]) => {
    const v = [p[0], p[1], p[2], 1]
    const r = [0, 0, 0, 0]
    for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) r[k] = f32(r[k] + f32(v[c] * m[c * 4 + k]))
    const w = Math.abs(r[3])
    for (let k = 0; k < 3; k++) out[k] = f32(r[k] / w)
})

registerNodeType({
    idname: 'FunctionNodeProjectPoint',
    label: 'Project Point',
    declare(b) {
        b.input('VECTOR', 'Vector').subtype('XYZ')
        b.output('VECTOR', 'Vector').subtype('XYZ')
        b.input('MATRIX', 'Transform')
    },
    multiFunction: () => projectPoint,
})
