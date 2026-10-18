/**
 * Parity cases for the rotation and matrix function nodes. Rotations come from Euler angles (white noise in a
 * wide range, and digit grids on multiples of pi/2 that hit gimbal lock and the exact-identity paths);
 * matrices from Combine Transform, multiplied for shear, with negative and zero scales for the singular and
 * negative-determinant branches.
 */

import {GroupBuilder, Socket} from '../../../src/dsl/builder'
import {Inputs, outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

const N = 64
const HALF_PI = 1.5707963267948966

type Args = Record<string, unknown>

function rotation(v: Inputs, euler: Socket): Socket {
    return v.g.node('FunctionNodeEulerToRotation', {euler}).outputs.rotation
}

const noiseRotation = (v: Inputs, seed: number) => rotation(v, v.noiseVector(seed, -7, 7))
/** Euler angles on multiples of pi/2 (identity, quarter turns, gimbal lock). */
const gridRotation = (v: Inputs, k0: number) => rotation(v, v.digitVector(4, k0, -HALF_PI, HALF_PI))

function transform(v: Inputs, translation: Socket | number[], rot: Socket | number[], scale: Socket | number[]): Socket {
    return v.g.node('FunctionNodeCombineTransform', {translation, rotation: rot, scale}).outputs.transform
}

/** A sheared matrix: two transforms with non-uniform scales multiplied. */
function shearMatrix(v: Inputs, seed: number): Socket {
    const a = transform(v, v.noiseVector(seed, -3, 3), noiseRotation(v, seed + 1), v.noiseVector(seed + 2, -2, 2))
    const b = transform(v, v.noiseVector(seed + 3, -3, 3), noiseRotation(v, seed + 4), v.noiseVector(seed + 5, 0.2, 3))
    return v.g.node('FunctionNodeMatrixMultiply', {matrix: a, matrix1: b}).outputs.matrix
}

/** Scales from digits: zeros, negatives, ones (singular, mirrored and identity-scale matrices). */
const gridScale = (v: Inputs, k0: number) => v.digitVector(4, k0, -1, 1)

function nodeCase(id: string, description: string, idname: string, props: Args, sets: Record<string, (v: Inputs) => Args>): ParityCase {
    return pointsCase(id, description, N, (v, g) => {
        let out: Record<string, Socket> = {}
        for (const [set, args] of Object.entries(sets)) out = {...out, ...outputsOf(g.node(idname, {...props, ...args(v)}), `${set}_`)}
        return out
    })
}

function singleCase(id: string, description: string, idname: string, props: Args, tuples: Args[]): ParityCase {
    return pointsCase(id, description, 1, (_v, g: GroupBuilder) => {
        let out: Record<string, Socket> = {}
        tuples.forEach((args, i) => { out = {...out, ...outputsOf(g.node(idname, {...props, ...args}), `s${i}_`)} })
        return out
    })
}

function rotationCases(): ParityCase[] {
    const cases: ParityCase[] = []
    cases.push(nodeCase('euler-to-rotation', 'Euler to Rotation', 'FunctionNodeEulerToRotation', {}, {
        a: v => ({euler: v.noiseVector(1, -7, 7)}),
        b: v => ({euler: v.digitVector(4, 0, -HALF_PI, HALF_PI)}),
    }))
    cases.push(nodeCase('rotation-to-euler', 'Rotation to Euler (gimbal lock included)', 'FunctionNodeRotationToEuler', {}, {
        a: v => ({rotation: noiseRotation(v, 2)}),
        b: v => ({rotation: gridRotation(v, 0)}),
    }))
    cases.push(singleCase('rotation-single', 'rotation nodes on single values', 'FunctionNodeRotationToEuler', {}, [
        {rotation: [0, 0, 0]}, {rotation: [0, HALF_PI, 0.3]}, {rotation: [1, -2, 3]}, {rotation: [3.1, 0.2, -3.1]},
    ]))
    cases.push(nodeCase('axis-angle-to-rotation', 'Axis Angle to Rotation (zero axis included)', 'FunctionNodeAxisAngleToRotation', {}, {
        a: v => ({axis: v.digitVector(4, 0, -1, 1), angle: v.noise(3, -10, 10)}),
        b: v => ({axis: v.noiseVector(4, -2, 2), angle: v.digit(4, 0, -HALF_PI * 2, HALF_PI)}),
    }))
    cases.push(nodeCase('rotation-to-axis-angle', 'Rotation to Axis Angle (identity included)', 'FunctionNodeRotationToAxisAngle', {}, {
        a: v => ({rotation: noiseRotation(v, 5)}),
        b: v => ({rotation: gridRotation(v, 0)}),
    }))
    cases.push(nodeCase('quaternion-to-rotation', 'Quaternion to Rotation (normalize, zero)', 'FunctionNodeQuaternionToRotation', {}, {
        a: v => ({w: v.digit(2, 0, 0, 1), x: v.digit(2, 1, 0, -0.5), y: v.digit(2, 2, 0, 2), z: v.digit(2, 3, 0, 0.25)}),
        b: v => ({w: v.noise(6, -2, 2), x: v.noise(7, -2, 2), y: v.noise(8, -2, 2), z: v.noise(9, -2, 2)}),
    }))
    cases.push(nodeCase('rotation-to-quaternion', 'Rotation to Quaternion', 'FunctionNodeRotationToQuaternion', {}, {
        a: v => ({rotation: noiseRotation(v, 10)}),
    }))
    cases.push(nodeCase('invert-rotation', 'Invert Rotation', 'FunctionNodeInvertRotation', {}, {
        a: v => ({rotation: noiseRotation(v, 11)}),
        b: v => ({rotation: gridRotation(v, 1)}),
    }))
    cases.push(nodeCase('rotate-vector', 'Rotate Vector', 'FunctionNodeRotateVector', {}, {
        a: v => ({vector: v.noiseVector(12, -5, 5), rotation: noiseRotation(v, 13)}),
        b: v => ({vector: v.digitVector(4, 0, -1, 1), rotation: gridRotation(v, 1)}),
    }))
    for (const space of ['GLOBAL', 'LOCAL']) {
        cases.push(nodeCase(`rotate-rotation-${space.toLowerCase()}`, `Rotate Rotation ${space}`, 'FunctionNodeRotateRotation', {rotationSpace: space}, {
            a: v => ({rotation: noiseRotation(v, 14), rotateBy: noiseRotation(v, 15)}),
            b: v => ({rotation: gridRotation(v, 0), rotateBy: gridRotation(v, 1)}),
        }))
    }
    for (const rotationType of ['EULER', 'AXIS_ANGLE']) {
        for (const space of ['OBJECT', 'LOCAL']) {
            const by = (v: Inputs, seed: number): Args => rotationType === 'EULER'
                ? {rotateBy: v.noiseVector(seed, -4, 4)}
                : {axis: v.digitVector(4, 1, -1, 1), angle: v.noise(seed, -7, 7)}
            cases.push(nodeCase(`rotate-euler-${rotationType.toLowerCase().replace('_', '-')}-${space.toLowerCase()}`, `Rotate Euler ${rotationType} ${space}`,
                'FunctionNodeRotateEuler', {rotationType, space}, {
                    a: v => ({rotation: v.noiseVector(16, -4, 4), ...by(v, 17)}),
                    b: v => ({rotation: v.digitVector(4, 0, -HALF_PI, HALF_PI), ...by(v, 18)}),
                }))
        }
    }
    for (const node of ['FunctionNodeAlignEulerToVector', 'FunctionNodeAlignRotationToVector']) {
        const euler = node === 'FunctionNodeAlignEulerToVector'
        for (const axis of ['X', 'Y', 'Z']) {
            for (const pivotAxis of ['AUTO', 'X', 'Y', 'Z']) {
                const id = `align-${euler ? 'euler' : 'rotation'}-${axis.toLowerCase()}-${pivotAxis.toLowerCase()}`
                cases.push(nodeCase(id, `${euler ? 'Align Euler' : 'Align Rotation'} to Vector axis ${axis} pivot ${pivotAxis}`, node, {axis, pivotAxis}, {
                    // Axis-aligned and zero vectors (digits) exercise the parallel fallbacks; Factor beyond [0, 1].
                    a: v => ({rotation: euler ? v.noiseVector(19, -4, 4) : noiseRotation(v, 19), factor: v.noise(20, -0.5, 1.5), vector: v.digitVector(4, 0, -1, 1)}),
                    b: v => ({rotation: euler ? v.digitVector(4, 0, -HALF_PI, HALF_PI) : gridRotation(v, 0), factor: v.digit(4, 1, 0, 0.5), vector: v.noiseVector(21, -3, 3)}),
                }))
            }
        }
    }
    for (const rotationType of ['AXIS_ANGLE', 'X_AXIS', 'Y_AXIS', 'Z_AXIS', 'EULER_XYZ']) {
        for (const invert of [false, true]) {
            const args = (v: Inputs, seed: number, axis: Socket): Args => ({
                vector: v.noiseVector(seed, -5, 5), center: v.noiseVector(seed + 1, -2, 2),
                ...(rotationType === 'AXIS_ANGLE' ? {axis} : {}),
                ...(rotationType === 'EULER_XYZ' ? {rotation: v.noiseVector(seed + 2, -4, 4)} : {angle: v.noise(seed + 3, -7, 7)}),
            })
            cases.push(nodeCase(`vector-rotate-${rotationType.toLowerCase().replace('_', '-')}${invert ? '-invert' : ''}`, `Vector Rotate ${rotationType} invert=${invert}`,
                'ShaderNodeVectorRotate', {rotationType, invert}, {
                    a: v => args(v, 22, v.digitVector(4, 0, -1, 1)),
                    b: v => args(v, 27, v.noiseVector(26, -2, 2)),
                }))
        }
    }
    return cases
}

function matrixCases(): ParityCase[] {
    const cases: ParityCase[] = []
    cases.push(nodeCase('combine-transform', 'Combine Transform on fields', 'FunctionNodeCombineTransform', {}, {
        a: v => ({translation: v.noiseVector(30, -5, 5), rotation: noiseRotation(v, 31), scale: v.noiseVector(32, -3, 3)}),
        b: v => ({translation: v.digitVector(4, 0, -1, 1), rotation: gridRotation(v, 1), scale: gridScale(v, 0)}),
        // Single translation zero / rotation identity / scale one with the others fields: the special constructors.
        c: v => ({translation: [0, 0, 0], rotation: noiseRotation(v, 33), scale: [1, 1, 1]}),
        d: v => ({translation: [0, 0, 0], rotation: [0, 0, 0], scale: v.noiseVector(34, -3, 3)}),
        e: v => ({translation: v.noiseVector(35, -3, 3), rotation: [0, 0, 0], scale: [1, 1, 1]}),
        // A rotation of 1e-8 rad: angle_of < 1e-7 counts as no rotation.
        f: v => ({translation: v.noiseVector(36, -3, 3), rotation: [1e-8, 0, 0], scale: [1, 1, 1]}),
        g: v => ({translation: [0, 0, 0], rotation: [0, 0, 2e-8], scale: v.noiseVector(37, -3, 3)}),
    }))
    cases.push(singleCase('combine-transform-single', 'Combine Transform on single values', 'FunctionNodeCombineTransform', {}, [
        {translation: [1, -2, 3], rotation: [0.3, -1.1, 2.9], scale: [2, -0.5, 1.5]}, {translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1]},
        {translation: [0, 0, 0], rotation: [0.1, 0.2, 0.3], scale: [1, 1, 1]}, {translation: [0, 0, 0], rotation: [1e-8, 0, 0], scale: [3, 1, 1]},
    ]))
    cases.push(pointsCase('separate-transform', 'Separate Transform (shear, negative and zero scale)', N, (v, g) => ({
        ...outputsOf(g.node('FunctionNodeSeparateTransform', {transform: shearMatrix(v, 40)}), 'a_'),
        ...outputsOf(g.node('FunctionNodeSeparateTransform', {transform: transform(v, v.noiseVector(46, -3, 3), gridRotation(v, 0), gridScale(v, 1))}), 'b_'),
    })))
    cases.push(pointsCase('transform-point-direction', 'Transform Point and Transform Direction', N, (v, g) => {
        const m = shearMatrix(v, 50)
        const p = v.noiseVector(56, -5, 5)
        return {
            ...outputsOf(g.node('FunctionNodeTransformPoint', {vector: p, transform: m}), 'point_'),
            ...outputsOf(g.node('FunctionNodeTransformDirection', {direction: p, transform: m}), 'direction_'),
        }
    }))
    cases.push(pointsCase('matrix-multiply', 'Multiply Matrices', N, (v, g) => ({
        ...outputsOf(g.node('FunctionNodeMatrixMultiply', {matrix: shearMatrix(v, 60), matrix1: shearMatrix(v, 66)}), 'a_'),
        ...outputsOf(g.node('FunctionNodeMatrixMultiply', {matrix: transform(v, v.digitVector(4, 0, -1, 1), gridRotation(v, 1), gridScale(v, 0)), matrix1: shearMatrix(v, 72)}), 'b_'),
    })))
    cases.push(pointsCase('invert-matrix', 'Invert Matrix (singular included)', N, (v, g) => ({
        ...outputsOf(g.node('FunctionNodeInvertMatrix', {matrix: shearMatrix(v, 80)}), 'a_'),
        ...outputsOf(g.node('FunctionNodeInvertMatrix', {matrix: transform(v, v.noiseVector(86, -3, 3), noiseRotation(v, 87), gridScale(v, 0))}), 'b_'),
        ...outputsOf(g.node('FunctionNodeInvertMatrix', {matrix: transform(v, v.noiseVector(88, -300, 300), noiseRotation(v, 89), v.noiseVector(90, 0.001, 0.01))}), 'c_'),
    })))
    cases.push(pointsCase('hash-matrix', 'Hash Value MATRIX', N, (v, g) => ({
        ...outputsOf(g.node('FunctionNodeHashValue', {dataType: 'MATRIX', value: shearMatrix(v, 92), seed: 7}), 'a_'),
    })))
    // Unlinked matrix inputs are the identity (`nodes/intern/node_socket.cc:1423`).
    cases.push(pointsCase('matrix-unlinked-inputs', 'Matrix nodes with unlinked Matrix inputs', 1, (v, g) => ({
        ...outputsOf(g.node('FunctionNodeTransformPoint', {vector: [1, 2, 3]}), 'point_'),
        ...outputsOf(g.node('FunctionNodeInvertMatrix', {}), 'invert_'),
        ...outputsOf(g.node('FunctionNodeSeparateTransform', {}), 'separate_'),
        ...outputsOf(g.node('FunctionNodeMatrixMultiply', {matrix1: transform(v, [1, 2, 3], [0.1, 0.2, 0.3], [2, 2, 2])}), 'multiply_'),
    })))
    return cases
}

export function functionRotationCases(): ParityCase[] {
    return [...rotationCases(), ...matrixCases()]
}
