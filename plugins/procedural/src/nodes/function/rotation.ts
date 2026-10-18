/**
 * Rotation function nodes (`nodes/function/nodes/node_fn_*.cc`): Euler to Rotation, Rotation to Euler,
 * Axis Angle to Rotation, Rotation to Axis Angle, Quaternion to Rotation, Rotation to Quaternion, Invert
 * Rotation, Rotate Vector, Rotate Rotation, Rotate Euler, Align Euler to Vector, Align Rotation to Vector.
 * Each cites its declaration and function; the math is in `src/blender/math/` (C++ `math::` in
 * `matrix.ts`/`quaternion.ts`/`rotation.ts`, the C API of the older nodes in `matrixC.ts`).
 */

import {f32} from '../../blender/f32'
import {axisAngleToQuat, eulerToQuat, mat3ToEuler, quatToAxisAngle, quatToMat3} from '../../blender/math'
import {
    angleSignedOnAxisV3V3V3, axisAngleToMat3, eulToMat3, mat3ToEul, mulM3M3M3, mulV3M3V3,
} from '../../blender/math/matrixC'
import {quatInvert, quatMultiply, quatNormalize, quatTransformPoint} from '../../blender/math/rotation'
import {angleNormalizedV3V3, crossHighPrecision3, isZero3, normalize3} from '../../blender/math/vec'
import {elementwise, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'

const put = (o: number[], v: ArrayLike<number>) => { for (let k = 0; k < v.length; k++) o[k] = v[k] }

registerNodeType({
    idname: 'FunctionNodeEulerToRotation',
    label: 'Euler to Rotation',
    // node_fn_euler_to_rotation.cc:15.
    declare(b) {
        b.input('VECTOR', 'Euler').subtype('EULER')
        b.output('ROTATION', 'Rotation')
    },
    // :31: `math::to_quaternion(math::EulerXYZ(euler))`.
    multiFunction: () => eulerToRotation,
})
const eulerToRotation = elementwise('Euler XYZ to Quaternion', ['float3'], ['quaternion'], ([e], [o]) => put(o, eulerToQuat(e)))

registerNodeType({
    idname: 'FunctionNodeRotationToEuler',
    label: 'Rotation to Euler',
    // node_fn_rotation_to_euler.cc:15.
    declare(b) {
        b.input('ROTATION', 'Rotation')
        b.output('VECTOR', 'Euler').subtype('EULER')
    },
    // :31: `math::to_euler(quat)` = `to_euler(from_rotation<float3x3>(quat))` (`BLI_math_quaternion.hh:660`).
    multiFunction: () => rotationToEuler,
})
const rotationToEuler = elementwise('Quaternion to Euler XYZ', ['quaternion'], ['float3'], ([q], [o]) => put(o, mat3ToEuler(quatToMat3(q))))

registerNodeType({
    idname: 'FunctionNodeAxisAngleToRotation',
    label: 'Axis Angle to Rotation',
    // node_fn_axis_angle_to_rotation.cc:15.
    declare(b) {
        b.input('VECTOR', 'Axis').default([0, 0, 1])
        b.input('FLOAT', 'Angle').subtype('ANGLE')
        b.output('ROTATION', 'Rotation')
    },
    multiFunction: () => axisAngleToRotation,
})
// :23-35: identity for a zero axis, else `to_quaternion(AxisAngle(normalize(axis), angle))`.
const axisAngleToRotation = elementwise('Axis Angle to Quaternion', ['float3', 'float'], ['quaternion'], ([axis, angle], [o]) => {
    put(o, isZero3(axis) ? [1, 0, 0, 0] : axisAngleToQuat(normalize3(axis), angle[0]))
})

registerNodeType({
    idname: 'FunctionNodeRotationToAxisAngle',
    label: 'Rotation to Axis Angle',
    // node_fn_rotation_to_axis_angle.cc:16.
    declare(b) {
        b.input('ROTATION', 'Rotation')
        b.output('VECTOR', 'Axis')
        b.output('FLOAT', 'Angle').subtype('ANGLE')
    },
    // `QuaterniontoAxisAngleFunction` (:24): `math::to_axis_angle` (`BLI_math_quaternion.hh:630`).
    multiFunction: () => rotationToAxisAngle,
})
const rotationToAxisAngle = elementwise('Quaternion to Axis Angle', ['quaternion'], ['float3', 'float'], ([q], [axis, angle]) => {
    const r = quatToAxisAngle(q)
    put(axis, r.axis)
    angle[0] = r.angle
})

registerNodeType({
    idname: 'FunctionNodeQuaternionToRotation',
    label: 'Quaternion to Rotation',
    // node_fn_quaternion_to_rotation.cc:12.
    declare(b) {
        b.input('FLOAT', 'W').default(1)
        b.input('FLOAT', 'X').default(0)
        b.input('FLOAT', 'Y').default(0)
        b.input('FLOAT', 'Z').default(0)
        b.output('ROTATION', 'Rotation')
    },
    multiFunction: () => quaternionToRotation,
})
// :22-30: `math::normalize(Quaternion(w, x, y, z))`.
const quaternionToRotation = elementwise('Quaternion to Rotation', ['float', 'float', 'float', 'float'], ['quaternion'], ([w, x, y, z], [o]) => {
    put(o, quatNormalize([w[0], x[0], y[0], z[0]]))
})

registerNodeType({
    idname: 'FunctionNodeRotationToQuaternion',
    label: 'Rotation to Quaternion',
    // node_fn_rotation_to_quaternion.cc:12.
    declare(b) {
        b.input('ROTATION', 'Rotation')
        b.output('FLOAT', 'W')
        b.output('FLOAT', 'X')
        b.output('FLOAT', 'Y')
        b.output('FLOAT', 'Z')
    },
    // `SeparateQuaternionFunction` (:22).
    multiFunction: () => rotationToQuaternion,
})
const rotationToQuaternion = elementwise('Rotation to Quaternion', ['quaternion'], ['float', 'float', 'float', 'float'], ([q], o) => {
    for (let k = 0; k < 4; k++) o[k][0] = q[k]
})

registerNodeType({
    idname: 'FunctionNodeInvertRotation',
    label: 'Invert Rotation',
    // node_fn_invert_rotation.cc:12.
    declare(b) {
        b.input('ROTATION', 'Rotation')
        b.output('ROTATION', 'Rotation')
    },
    multiFunction: () => invertRotation,
})
// :30-35: `math::invert(quat)`.
const invertRotation = elementwise('Invert Quaternion', ['quaternion'], ['quaternion'], ([q], [o]) => put(o, quatInvert(q)))

registerNodeType({
    idname: 'FunctionNodeRotateVector',
    label: 'Rotate Vector',
    // node_fn_rotate_vector.cc:12.
    declare(b) {
        b.input('VECTOR', 'Vector')
        b.output('VECTOR', 'Vector')
        b.input('ROTATION', 'Rotation')
    },
    multiFunction: () => rotateVector,
})
// :31-37: `math::transform_point(quat, vector)`.
const rotateVector = elementwise('Rotate Vector', ['float3', 'quaternion'], ['float3'], ([v, q], [o]) => put(o, quatTransformPoint(q, v)))

const ROTATE_ROTATION: Record<string, MultiFunction> = {
    // node_fn_rotate_rotation.cc:58-74.
    GLOBAL: elementwise('Rotate Rotation Global', ['quaternion', 'quaternion'], ['quaternion'], ([a, b], [o]) => put(o, quatMultiply(b, a))),
    LOCAL: elementwise('Rotate Rotation Local', ['quaternion', 'quaternion'], ['quaternion'], ([a, b], [o]) => put(o, quatMultiply(a, b))),
}

registerNodeType({
    idname: 'FunctionNodeRotateRotation',
    label: 'Rotate Rotation',
    // `node_rna` (:76): `rotation_space`, `custom1` zero-initialised = GLOBAL.
    properties: {rotation_space: 'GLOBAL'},
    enums: {rotation_space: ['GLOBAL', 'LOCAL']},
    // :20.
    declare(b) {
        b.input('ROTATION', 'Rotation')
        b.output('ROTATION', 'Rotation')
        b.input('ROTATION', 'Rotate By')
    },
    multiFunction: node => ROTATE_ROTATION[node.prop<string>('rotation_space')],
})

/** `Rotate Euler by ...` (node_fn_rotate_euler.cc:49-114, `get_multi_function`): the C API Euler/matrix functions. */
const rotateEulerFunction = cached((key: string): MultiFunction => {
    const [type, space] = key.split(':')
    const combine = (input: number[], rot: Float32Array) => {
        const inputMat = eulToMat3(input)
        return mat3ToEul(space === 'OBJECT' ? mulM3M3M3(rot, inputMat) : mulM3M3M3(inputMat, rot))
    }
    if (type === 'EULER') {
        return elementwise(`Rotate Euler by Euler/${space}`, ['float3', 'float3'], ['float3'], ([input, rotation], [o]) =>
            put(o, combine(input, eulToMat3(rotation))))
    }
    return elementwise(`Rotate Euler by AxisAngle/${space}`, ['float3', 'float3', 'float'], ['float3'], ([input, axis, angle], [o]) =>
        put(o, combine(input, axisAngleToMat3(axis, angle[0]))))
})

registerNodeType({
    idname: 'FunctionNodeRotateEuler',
    label: 'Rotate Euler',
    // `def_fn_rotate_euler` (`makesrna/intern/rna_nodetree.cc:8809`): custom1/custom2 zero-initialised = EULER (`DNA_node_types.h:1206`), OBJECT.
    properties: {rotation_type: 'EULER', space: 'OBJECT'},
    enums: {rotation_type: ['AXIS_ANGLE', 'EULER'], space: ['OBJECT', 'LOCAL']},
    // :18-40.
    declare(b, node) {
        b.input('VECTOR', 'Rotation').subtype('EULER').hideValue()
        if (node.prop<string>('rotation_type') === 'EULER') {
            b.input('VECTOR', 'Rotate By').subtype('EULER')
        } else {
            b.input('VECTOR', 'Axis').default([0, 0, 1]).subtype('XYZ')
            b.input('FLOAT', 'Angle').subtype('ANGLE')
        }
        b.output('VECTOR', 'Rotation')
    },
    multiFunction: node => rotateEulerFunction(`${node.prop<string>('rotation_type')}:${node.prop<string>('space')}`),
})

const AXES: Record<string, number> = {X: 0, Y: 1, Z: 2}
const unit = (i: number) => {
    const v = [0, 0, 0]
    v[i] = 1
    return v
}

/** `align_rotations_auto_pivot` / `align_rotations_fixed_pivot` of node_fn_align_euler_to_vector.cc:39-131. */
function alignEuler(input: number[], factor: number, vector: number[], mainAxis: number[], pivot: number[] | undefined): ArrayLike<number> {
    if (pivot && mainAxis.every((v, k) => v === pivot[k])) return input
    if (isZero3(vector)) return input
    const oldRotation = eulToMat3(input)
    const oldAxis = mulV3M3V3(oldRotation, mainAxis)
    let rotation: Float32Array
    if (!pivot) {
        const newAxis = normalize3(vector)
        let rotationAxis = crossHighPrecision3(oldAxis, newAxis)
        if (isZero3(rotationAxis)) {
            rotationAxis = crossHighPrecision3(oldAxis, [1, 0, 0])
            if (isZero3(rotationAxis)) rotationAxis = crossHighPrecision3(oldAxis, [0, 1, 0])
        }
        const fullAngle = angleNormalizedV3V3(oldAxis, newAxis)
        rotation = axisAngleToMat3(rotationAxis, f32(factor * fullAngle))
    } else {
        const pivotAxis = mulV3M3V3(oldRotation, pivot)
        let fullAngle = angleSignedOnAxisV3V3V3(vector, oldAxis, pivotAxis)
        // `full_angle -= 2.0f * M_PI` in double.
        if (fullAngle > Math.PI) fullAngle = f32(fullAngle - 2 * Math.PI)
        rotation = axisAngleToMat3(pivotAxis, f32(factor * fullAngle))
    }
    return mat3ToEul(mulM3M3M3(rotation, oldRotation))
}

const alignEulerFunction = cached((key: string): MultiFunction => {
    const [axis, pivotAxis] = key.split(':')
    const main = unit(AXES[axis])
    const pivot = pivotAxis === 'AUTO' ? undefined : unit(AXES[pivotAxis])
    // `MF_AlignEulerToVector` (:133).
    return elementwise('Align Euler to Vector', ['float3', 'float', 'float3'], ['float3'], ([rotation, factor, vector], [o]) =>
        put(o, alignEuler(rotation, factor[0], vector, main, pivot)))
})

registerNodeType({
    idname: 'FunctionNodeAlignEulerToVector',
    label: 'Align Euler to Vector',
    // `node_rna` (:196): `axis` (custom1, 0 = X) and `pivot_axis` (custom2, 0 = AUTO).
    properties: {axis: 'X', pivot_axis: 'AUTO'},
    enums: {axis: ['X', 'Y', 'Z'], pivot_axis: ['AUTO', 'X', 'Y', 'Z']},
    // :18-29.
    declare(b) {
        b.input('VECTOR', 'Rotation').subtype('EULER').hideValue()
        b.input('FLOAT', 'Factor').default(1).min(0).max(1).subtype('FACTOR')
        b.input('VECTOR', 'Vector').default([0, 0, 1])
        b.output('VECTOR', 'Rotation').subtype('EULER')
    },
    multiFunction: node => alignEulerFunction(`${node.prop<string>('axis')}:${node.prop<string>('pivot_axis')}`),
})

/** node_fn_align_rotation_to_vector.cc:49-120, quaternion versions of the above. */
function alignRotation(old: number[], factor: number, vector: number[], mainAxis: number[], pivot: number[] | undefined): ArrayLike<number> {
    if (pivot && mainAxis.every((v, k) => v === pivot[k])) return old
    if (isZero3(vector)) return old
    const oldAxis = quatTransformPoint(old, mainAxis)
    if (!pivot) {
        const newAxis = normalize3(vector)
        let rotationAxis = crossHighPrecision3(oldAxis, newAxis)
        if (isZero3(rotationAxis)) {
            rotationAxis = crossHighPrecision3(oldAxis, [1, 0, 0])
            if (isZero3(rotationAxis)) rotationAxis = crossHighPrecision3(oldAxis, [0, 1, 0])
        }
        const fullAngle = angleNormalizedV3V3(oldAxis, newAxis)
        return quatMultiply(axisAngleToQuat(normalize3(rotationAxis), f32(factor * fullAngle)), old)
    }
    const pivotAxis = quatTransformPoint(old, pivot)
    let fullAngle = angleSignedOnAxisV3V3V3(vector, oldAxis, pivotAxis)
    if (fullAngle > Math.PI) fullAngle = f32(fullAngle - 2 * Math.PI)
    return quatMultiply(axisAngleToQuat(normalize3(pivotAxis), f32(factor * fullAngle)), old)
}

const alignRotationFunction = cached((key: string): MultiFunction => {
    const [axis, pivotAxis] = key.split(':')
    const main = unit(AXES[axis])
    const pivot = pivotAxis === 'AUTO' ? undefined : unit(AXES[pivotAxis])
    // `AlignRotationToVectorFunction` (:122).
    return elementwise('Align Rotation to Vector', ['quaternion', 'float', 'float3'], ['quaternion'], ([rotation, factor, vector], [o]) =>
        put(o, alignRotation(rotation, factor[0], vector, main, pivot)))
})

registerNodeType({
    idname: 'FunctionNodeAlignRotationToVector',
    label: 'Align Rotation to Vector',
    // `node_init` (:44): `custom1 = Axis::Z`; `node_rna` (:224).
    properties: {axis: 'Z', pivot_axis: 'AUTO'},
    enums: {axis: ['X', 'Y', 'Z'], pivot_axis: ['AUTO', 'X', 'Y', 'Z']},
    // :20-33.
    declare(b) {
        b.input('ROTATION', 'Rotation').hideValue()
        b.output('ROTATION', 'Rotation')
        b.input('FLOAT', 'Factor').default(1).min(0).max(1).subtype('FACTOR')
        b.input('VECTOR', 'Vector').default([0, 0, 1]).subtype('XYZ')
    },
    multiFunction: node => alignRotationFunction(`${node.prop<string>('axis')}:${node.prop<string>('pivot_axis')}`),
})
