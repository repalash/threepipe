/**
 * Vector Rotate (`ShaderNodeVectorRotate`) - `nodes/shader/nodes/node_shader_vector_rotate.cc`: declaration
 * :27, `sh_node_vector_rotate_around_axis` :92, `sh_node_vector_rotate_euler` :104, `get_multi_function` :119,
 * availability `node_shader_update_vector_rotate` :212. RNA `def_sh_vector_rotate`
 * (`makesrna/intern/rna_nodetree.cc:5246`). Uses the C rotation API (`axis_angle_to_mat3`, `eul_to_mat3`,
 * `invert_m3`, `mul_m3_v3`).
 */

import {f32} from '../../blender/f32'
import {axisAngleToMat3, eulToMat3, invertM3, mulV3M3V3} from '../../blender/math/matrixC'
import {elementwise, MultiFunction} from '../../fields/field'
import {registerNodeType} from '../../runtime/registry'
import {cached} from '../util'

const sub = (a: ArrayLike<number>, b: ArrayLike<number>) => [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])]

function rotateAroundAxis(vector: ArrayLike<number>, center: ArrayLike<number>, axis: ArrayLike<number>, angle: number, o: number[]): void {
    const r = mulV3M3V3(axisAngleToMat3(axis, angle), sub(vector, center))
    for (let k = 0; k < 3; k++) o[k] = f32(r[k] + center[k])
}

function rotateEuler(vector: ArrayLike<number>, center: ArrayLike<number>, rotation: ArrayLike<number>, invert: boolean, o: number[]): void {
    let mat = eulToMat3(rotation)
    if (invert) mat = invertM3(mat).m
    const r = mulV3M3V3(mat, sub(vector, center))
    for (let k = 0; k < 3; k++) o[k] = f32(r[k] + center[k])
}

const FIXED_AXES: Record<string, number[]> = {X_AXIS: [1, 0, 0], Y_AXIS: [0, 1, 0], Z_AXIS: [0, 0, 1]}

const vectorRotateFunction = cached((key: string): MultiFunction => {
    const [mode, inv] = key.split(':')
    const invert = inv === '1'
    if (mode === 'AXIS_ANGLE') {
        return elementwise('Rotate Axis', ['float3', 'float3', 'float3', 'float'], ['float3'], ([v, c, axis, angle], [o]) =>
            rotateAroundAxis(v, c, axis, invert ? -angle[0] : angle[0], o))
    }
    if (mode === 'EULER_XYZ') {
        return elementwise('Rotate Euler', ['float3', 'float3', 'float3'], ['float3'], ([v, c, rotation], [o]) =>
            rotateEuler(v, c, rotation, invert, o))
    }
    const axis = FIXED_AXES[mode]
    if (!axis) throw new Error(`procedural: Vector Rotate type ${mode} is not supported`)
    return elementwise(`Rotate ${mode}`, ['float3', 'float3', 'float'], ['float3'], ([v, c, angle], [o]) =>
        rotateAroundAxis(v, c, axis, invert ? -angle[0] : angle[0], o))
})

registerNodeType({
    idname: 'ShaderNodeVectorRotate',
    label: 'Vector Rotate',
    // `custom1` zero-initialised = NODE_VECTOR_ROTATE_TYPE_AXIS; `rna_enum_vector_rotate_type_items`.
    properties: {rotation_type: 'AXIS_ANGLE', invert: false},
    enums: {rotation_type: ['AXIS_ANGLE', 'X_AXIS', 'Y_AXIS', 'Z_AXIS', 'EULER_XYZ']},
    declare(b, node) {
        const mode = node.prop<string>('rotation_type')
        b.input('VECTOR', 'Vector').min(0).max(1).hideValue()
        b.output('VECTOR', 'Vector')
        b.input('VECTOR', 'Center')
        b.input('VECTOR', 'Axis').min(-1).max(1).default([0, 0, 1]).available(mode === 'AXIS_ANGLE')
        b.input('FLOAT', 'Angle').subtype('ANGLE').available(mode !== 'EULER_XYZ')
        b.input('VECTOR', 'Rotation').subtype('EULER').available(mode === 'EULER_XYZ')
    },
    multiFunction: node => vectorRotateFunction(`${node.prop<string>('rotation_type')}:${node.prop<boolean>('invert') ? 1 : 0}`),
})
