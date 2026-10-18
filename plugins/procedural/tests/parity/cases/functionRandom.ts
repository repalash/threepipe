/**
 * Parity cases for Random Value (every data type; the implicit ID-or-index input with and without an `id`
 * attribute, explicit IDs, negative seeds, reversed and extreme integer ranges) and Hash Value (every
 * field type, strings on single values).
 */

import {GroupBuilder, Socket} from '../../../src/dsl/builder'
import {Inputs, outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

const N = 64

type Args = Record<string, unknown>

/** `index * a + b` as an integer field (Integer Math MULTIPLY_ADD). */
function intLin(v: Inputs, a: number, b: number): Socket {
    return v.g.node('FunctionNodeIntegerMath', {operation: 'MULTIPLY_ADD', value: v.index(), value1: a, value2: b}).outputs.value
}

/** A digit of the index as an integer field: `lo + digit * step`. */
function intDigit(v: Inputs, base: number, k: number, lo: number, step: number): Socket {
    let d: Socket = v.index()
    if (k > 0) d = v.g.node('FunctionNodeIntegerMath', {operation: 'DIVIDE_FLOOR', value: d, value1: base ** k}).outputs.value
    d = v.g.node('FunctionNodeIntegerMath', {operation: 'FLOORED_MODULO', value: d, value1: base}).outputs.value
    return v.g.node('FunctionNodeIntegerMath', {operation: 'MULTIPLY_ADD', value: d, value1: step, value2: lo}).outputs.value
}

function singleCase(id: string, description: string, idname: string, props: Args, tuples: Args[]): ParityCase {
    return pointsCase(id, description, 1, (_v, g: GroupBuilder) => {
        let out: Record<string, Socket> = {}
        tuples.forEach((args, i) => { out = {...out, ...outputsOf(g.node(idname, {...props, ...args}), `s${i}_`)} })
        return out
    })
}

const RANGE_ARGS: Record<string, (v: Inputs) => Args[]> = {
    FLOAT: v => [
        {min: v.digit(4, 0, -1, 1), max: v.digit(4, 1, -2, 1.5)},
        {min: v.noise(1, -5, 5), max: v.noise(2, -5, 5)},
    ],
    FLOAT_VECTOR: v => [
        {min: v.digitVector(2, 0, -1, 1), max: v.digitVector(2, 3, -2, 3)},
        {min: v.noiseVector(1, -5, 5), max: v.noiseVector(2, -5, 5)},
    ],
    INT: v => [
        {min: intDigit(v, 4, 0, -3, 2), max: intDigit(v, 4, 1, -5, 4)},
        {min: intLin(v, -1000003, 7), max: intLin(v, 999983, -11)},
    ],
    BOOLEAN: v => [
        {probability: v.digit(8, 0, -0.25, 0.21)},
        {probability: v.noise(3, 0, 1)},
    ],
}

function randomCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const dataType of ['FLOAT', 'INT', 'BOOLEAN', 'FLOAT_VECTOR']) {
        const t = dataType.toLowerCase().replace('float_', '')
        // Implicit ID (index here: Points creates no `id`), seeds from digits including negatives; explicit IDs.
        cases.push(pointsCase(`random-${t}`, `Random Value ${dataType} on fields`, N, (v, g) => {
            const [a, b] = RANGE_ARGS[dataType](v)
            return {
                ...outputsOf(g.node('FunctionNodeRandomValue', {dataType, ...a, seed: intDigit(v, 4, 2, -2, 3)}), 'a_'),
                ...outputsOf(g.node('FunctionNodeRandomValue', {dataType, ...b, iD: intLin(v, 7919, -250000), seed: -17}), 'b_'),
                ...outputsOf(g.node('FunctionNodeRandomValue', {dataType, ...a, iD: -3, seed: intLin(v, 1, -32)}), 'c_'),
            }
        }))
        cases.push(singleCase(`random-${t}-single`, `Random Value ${dataType} on single values`, 'FunctionNodeRandomValue', {dataType}, ({
            FLOAT: [{min: -2, max: 3.5, iD: 0, seed: 0}, {min: 4, max: -1, iD: 12345, seed: -9}, {min: 0, max: 1, iD: -1, seed: 2147483647}],
            FLOAT_VECTOR: [{min: [-1, 0, 2], max: [1, 5, -2], iD: 7, seed: 3}, {min: [0, 0, 0], max: [1, 1, 1], iD: -2147483648, seed: 1}],
            INT: [{min: -10, max: 10, iD: 5, seed: 1}, {min: 10, max: -10, iD: 5, seed: 1}, {min: -2147483648, max: 2147483647, iD: 99, seed: 4},
                {min: 2147483600, max: 2147483647, iD: 3, seed: -5}, {min: 7, max: 7, iD: 1, seed: 1}],
            BOOLEAN: [{probability: 0.5, iD: 1, seed: 2}, {probability: 0, iD: 3, seed: 4}, {probability: 1, iD: 5, seed: 6}, {probability: 0.37, iD: 7, seed: 8}],
        } as Record<string, Args[]>)[dataType]))
    }
    // The implicit ID input reads the `id` attribute when the geometry has one (ID-or-index field).
    // Outputs are stored in order, so `value` is evaluated on the geometry that already has `id`.
    cases.push(pointsCase('random-id-attribute', 'Random Value with an id attribute', N, (v, g) => ({
        id: intLin(v, 13, -100),
        float: g.node('FunctionNodeRandomValue', {dataType: 'FLOAT', min: -1, max: 2}).outputs.value,
        int: g.node('FunctionNodeRandomValue', {dataType: 'INT', min: -50, max: 50, seed: 3}).outputs.value,
    })))
    return cases
}

function hashCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const values: Record<string, (v: Inputs) => Socket> = {
        FLOAT: v => v.digit(8, 0, -2, 0.5),
        INT: v => intLin(v, 37, -1000),
        VECTOR: v => v.noiseVector(4, -3, 3),
        RGBA: v => v.g.node('FunctionNodeCombineColor', {red: v.noise(5, 0, 1), green: v.digit(4, 0, 0, 0.25), blue: v.noise(6, -1, 1), alpha: v.digit(2, 3, 0.5, 0.5)}).outputs.color,
        ROTATION: v => v.noiseVector(7, -3, 3),
    }
    for (const [dataType, value] of Object.entries(values)) {
        const t = dataType.toLowerCase()
        cases.push(pointsCase(`hash-${t}`, `Hash Value ${dataType} on fields`, N, (v, g) => ({
            ...outputsOf(g.node('FunctionNodeHashValue', {dataType, value: value(v), seed: intDigit(v, 4, 1, -3, 2)}), 'a_'),
            ...outputsOf(g.node('FunctionNodeHashValue', {dataType, value: value(v)}), 'b_'),
        })))
    }
    cases.push(singleCase('hash-single', 'Hash Value on single values', 'FunctionNodeHashValue', {}, [
        {dataType: 'FLOAT', value: -0.75, seed: 3}, {dataType: 'FLOAT', value: 0, seed: 0},
        {dataType: 'INT', value: -2147483648, seed: -1}, {dataType: 'INT', value: 42, seed: 0},
        {dataType: 'VECTOR', value: [1, -2, 0.5], seed: 9}, {dataType: 'RGBA', value: [0.1, 0.2, 0.3, 0.4], seed: -9},
        {dataType: 'ROTATION', value: [0.3, -0.2, 1.1], seed: 5},
        {dataType: 'STRING', value: '', seed: 0}, {dataType: 'STRING', value: 'Blender', seed: 0},
        {dataType: 'STRING', value: 'geometry nodes 5.2', seed: -77}, {dataType: 'STRING', value: 'café ☃', seed: 1},
    ]))
    return cases
}

export function functionRandomCases(): ParityCase[] {
    return [...randomCases(), ...hashCases()]
}
