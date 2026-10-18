/**
 * Parity cases for the converter / math function nodes: Combine/Separate XYZ, Combine/Separate Color,
 * Vector Math, Clamp, Map Range and Mix. Every operation / mode / type runs on 64 points of field inputs
 * (two input sets: digit grids - negatives, zero, halves, every combination - and white noise), and the
 * `-single` cases run the same node on constants (single-value evaluation) including the edge values the
 * C++ special-cases (zero divisors, equal ranges, zero vectors, reversed ranges, ...).
 */

import {GroupBuilder, Socket} from '../../../src/dsl/builder'
import {Inputs, outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

const N = 64

type Args = Record<string, unknown>

/** One node per input set, outputs stored as `<set>_<output>`. */
function nodeCase(id: string, description: string, idname: string, props: Args, sets: Record<string, (v: Inputs) => Args>): ParityCase {
    return pointsCase(id, description, N, (v, g) => {
        let out: Record<string, Socket> = {}
        for (const [set, args] of Object.entries(sets)) out = {...out, ...outputsOf(g.node(idname, {...props, ...args(v)}), `${set}_`)}
        return out
    })
}

/** Constants only: one node per tuple, on one point. */
function singleCase(id: string, description: string, idname: string, props: Args, tuples: Args[]): ParityCase {
    return pointsCase(id, description, 1, (_v, g: GroupBuilder) => {
        let out: Record<string, Socket> = {}
        tuples.forEach((args, i) => { out = {...out, ...outputsOf(g.node(idname, {...props, ...args}), `s${i}_`)} })
        return out
    })
}

const VECTOR_OPS = ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD', 'CROSS_PRODUCT', 'PROJECT', 'REFLECT', 'REFRACT',
    'FACEFORWARD', 'DOT_PRODUCT', 'DISTANCE', 'LENGTH', 'SCALE', 'NORMALIZE', 'ABSOLUTE', 'POWER', 'SIGN', 'MINIMUM',
    'MAXIMUM', 'ROUND', 'FLOOR', 'CEIL', 'FRACTION', 'MODULO', 'WRAP', 'SNAP', 'SINE', 'COSINE', 'TANGENT']
const NO_B = new Set(['SINE', 'COSINE', 'TANGENT', 'CEIL', 'SCALE', 'FLOOR', 'LENGTH', 'ABSOLUTE', 'FRACTION', 'NORMALIZE', 'SIGN', 'ROUND'])
const USES_C = new Set(['WRAP', 'FACEFORWARD', 'MULTIPLY_ADD'])
const USES_SCALE = new Set(['SCALE', 'REFRACT'])

/** Vector Math arguments for the operation's available inputs. */
function vectorArgs(op: string, a: unknown, b: unknown, c: unknown, s: unknown): Args {
    return {
        operation: op, vector: a,
        ...(NO_B.has(op) ? {} : {vector1: b}),
        ...(USES_C.has(op) ? {vector2: c} : {}),
        ...(USES_SCALE.has(op) ? {scale: s} : {}),
    }
}

function vectorMathCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const op of VECTOR_OPS) {
        // POWER: bases with negatives and zero, exponents >= 0 (powf(0, negative) is infinite).
        const exp = op === 'POWER'
        cases.push(pointsCase(`vector-math-${op.toLowerCase()}`, `Vector Math ${op} on fields`, N, (v, g) => ({
            ...outputsOf(g.node('ShaderNodeVectorMath', vectorArgs(op,
                v.digitVector(4, 0, -1, 1),
                exp ? v.noiseVector(3.1, 0, 2.5) : v.noiseVector(3.1, -2, 2),
                v.noiseVector(7.7, -2, 2),
                v.noise(11.3, -2, 2))), 'grid_'),
            ...outputsOf(g.node('ShaderNodeVectorMath', vectorArgs(op,
                v.noiseVector(13.9, -3, 3),
                exp ? v.digitVector(4, 0, 0, 1) : v.digitVector(4, 0, -1, 1),
                v.digitVector(4, 1, -0.75, 0.5),
                v.digit(4, 2, -1.5, 1))), 'noise_'),
        })))
        const singles: Args[] = [
            vectorArgs(op, [1.25, -0.5, 3], [0.75, 2, -1.5], [-2, 0.5, 0.25], 1.33),
            vectorArgs(op, [0, 0, 0], [0, 0, 0], [0, 0, 0], 0),
            vectorArgs(op, [-0.5, 2.5, -3.7], exp ? [2, 0.5, 3] : [0, -1.1, 2], [1, 1, 1], -0.7),
            vectorArgs(op, [0.3, -0.3, 0.001], exp ? [1, 1, 1] : [0.001, 0, 0.6], [-0.3, 0.3, 0], 2.5),
        ]
        cases.push(singleCase(`vector-math-${op.toLowerCase()}-single`, `Vector Math ${op} on single values`, 'ShaderNodeVectorMath', {}, singles))
    }
    return cases
}

function mapRangeCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const dataType of ['FLOAT', 'FLOAT_VECTOR']) {
        const vec = dataType === 'FLOAT_VECTOR'
        for (const interpolation of ['LINEAR', 'STEPPED', 'SMOOTHSTEP', 'SMOOTHERSTEP']) {
            for (const clamp of [true, false]) {
                const id = `map-range-${vec ? 'vector' : 'float'}-${interpolation.toLowerCase()}${clamp ? '' : '-unclamped'}`
                const stepped = interpolation === 'STEPPED'
                const props = {dataType, interpolationType: interpolation, clamp}
                // Inputs: value (noise), from range with equal and reversed bounds, to range with reversed bounds,
                // steps including 0 and -1 (steps + 1 == 0).
                const args = (value: unknown, fromMin: unknown, fromMax: unknown, toMin: unknown, toMax: unknown, steps: unknown): Args => vec
                    ? {vector: value, fromMinFLOAT3: fromMin, fromMaxFLOAT3: fromMax, toMinFLOAT3: toMin, toMaxFLOAT3: toMax, ...(stepped ? {stepsFLOAT3: steps} : {})}
                    : {value, fromMin, fromMax, toMin, toMax, ...(stepped ? {steps} : {})}
                const f = (v: Inputs, base: number, k: number, lo: number, step: number) => vec ? v.digitVector(base, k, lo, step) : v.digit(base, k, lo, step)
                const nz = (v: Inputs, seed: number, lo: number, hi: number) => vec ? v.noiseVector(seed, lo, hi) : v.noise(seed, lo, hi)
                cases.push(nodeCase(id, `Map Range ${dataType} ${interpolation} clamp=${clamp} on fields`, 'ShaderNodeMapRange', props, {
                    a: v => args(nz(v, 1.7, -1.5, 3), f(v, 2, 0, 0, 1), f(v, 2, 1, -1, 2), f(v, 4, 2, -2, 1.5), nz(v, 5.3, -1, 4), nz(v, 9.1, 1, 6)),
                    b: v => args(nz(v, 2.9, -2, 2), nz(v, 4.4, -1, 0), f(v, 2, 3, -0.5, 1), f(v, 2, 4, 1, -2), f(v, 2, 5, 0, 3), f(v, 4, 0, -1, 1.5)),
                }))
                const c = (x: number) => vec ? [x, -x * 0.5, x + 0.25] : x
                cases.push(singleCase(`${id}-single`, `Map Range ${dataType} ${interpolation} clamp=${clamp} on single values`, 'ShaderNodeMapRange', props, [
                    args(c(0.3), c(-1), c(2), c(5), c(-3), c(3)),
                    args(c(1.7), c(1), c(1), c(0), c(1), c(0)),
                    args(c(-0.6), c(0.5), c(-0.5), c(-2), c(2), c(-1)),
                    args(c(2.2), c(0), c(1), c(0.25), c(0.75), c(2.5)),
                ]))
            }
        }
    }
    return cases
}

const BLEND_MODES = ['MIX', 'DARKEN', 'MULTIPLY', 'BURN', 'LIGHTEN', 'SCREEN', 'DODGE', 'ADD', 'OVERLAY', 'SOFT_LIGHT', 'LINEAR_LIGHT',
    'DIFFERENCE', 'EXCLUSION', 'SUBTRACT', 'DIVIDE', 'HUE', 'SATURATION', 'COLOR', 'VALUE']

function color(v: Inputs, r: Socket, g: Socket, b: Socket, a: Socket | number): Socket {
    return v.g.node('FunctionNodeCombineColor', {red: r, green: g, blue: b, alpha: a}).outputs.color
}

function mixCases(): ParityCase[] {
    const cases: ParityCase[] = []
    for (const clampFactor of [true, false]) {
        const sfx = clampFactor ? '' : '-unclamped'
        cases.push(nodeCase(`mix-float${sfx}`, `Mix FLOAT clamp factor=${clampFactor}`, 'ShaderNodeMix', {dataType: 'FLOAT', clampFactor}, {
            a: v => ({factorFloat: v.noise(1.1, -0.5, 1.5), aFloat: v.digit(8, 0, -2, 0.75), bFloat: v.digit(8, 1, -1.5, 0.5)}),
            b: v => ({factorFloat: v.digit(4, 0, -0.5, 0.5), aFloat: v.noise(2.2, -3, 3), bFloat: v.noise(3.3, -3, 3)}),
        }))
        cases.push(singleCase(`mix-float${sfx}-single`, `Mix FLOAT clamp factor=${clampFactor} on single values`, 'ShaderNodeMix', {dataType: 'FLOAT', clampFactor}, [
            {factorFloat: 0.37, aFloat: -2.5, bFloat: 7.25}, {factorFloat: -0.4, aFloat: 1, bFloat: 3}, {factorFloat: 1.6, aFloat: 0.1, bFloat: 0.2},
        ]))
        for (const factorMode of ['UNIFORM', 'NON_UNIFORM']) {
            const uni = factorMode === 'UNIFORM'
            const id = `mix-vector-${factorMode.toLowerCase().replace('_', '-')}${sfx}`
            const props = {dataType: 'VECTOR', factorMode, clampFactor}
            cases.push(nodeCase(id, `Mix VECTOR ${factorMode} clamp factor=${clampFactor}`, 'ShaderNodeMix', props, {
                a: v => ({...(uni ? {factorFloat: v.noise(1.1, -0.5, 1.5)} : {factorVector: v.noiseVector(1.1, -0.5, 1.5)}),
                    aVector: v.digitVector(4, 0, -1, 1), bVector: v.noiseVector(5.5, -2, 2)}),
                b: v => ({...(uni ? {factorFloat: v.digit(4, 0, -0.5, 0.5)} : {factorVector: v.digitVector(4, 0, -0.5, 0.5)}),
                    aVector: v.noiseVector(6.6, -3, 3), bVector: v.noiseVector(7.7, -3, 3)}),
            }))
            cases.push(singleCase(`${id}-single`, `Mix VECTOR ${factorMode} clamp factor=${clampFactor} on single values`, 'ShaderNodeMix', props, [
                {...(uni ? {factorFloat: 0.37} : {factorVector: [0.37, -0.2, 1.4]}), aVector: [1, -2, 3.5], bVector: [-0.25, 4, 0]},
                {...(uni ? {factorFloat: -0.3} : {factorVector: [1.3, 0.5, 0]}), aVector: [0.1, 0.2, 0.3], bVector: [3, 2, 1]},
            ]))
        }
        cases.push(nodeCase(`mix-rotation${sfx}`, `Mix ROTATION clamp factor=${clampFactor}`, 'ShaderNodeMix', {dataType: 'ROTATION', clampFactor}, {
            a: v => ({factorFloat: v.noise(1.1, -0.5, 1.5), aRotation: v.noiseVector(2.5, -3.2, 3.2), bRotation: v.noiseVector(3.5, -3.2, 3.2)}),
            b: v => ({factorFloat: v.digit(4, 0, -0.5, 0.5), aRotation: v.digitVector(4, 1, -1.5, 1), bRotation: v.noiseVector(4.5, -3.2, 3.2)}),
        }))
        cases.push(singleCase(`mix-rotation${sfx}-single`, `Mix ROTATION clamp factor=${clampFactor} on single values`, 'ShaderNodeMix', {dataType: 'ROTATION', clampFactor}, [
            {factorFloat: 0.37, aRotation: [0.3, -1.2, 2.5], bRotation: [-2, 0.4, 1]},
            {factorFloat: 1.3, aRotation: [0, 0, 0], bRotation: [3.1, 0, 0]},
            {factorFloat: 0.5, aRotation: [0.5, 0.5, 0.5], bRotation: [0.5, 0.5, 0.5]},
        ]))
    }
    const colorSets: Record<string, (v: Inputs) => Args> = {
        a: v => ({factorFloat: v.noise(1.1, -0.3, 1.3),
            aColor: color(v, v.digit(4, 0, -0.5, 0.5), v.digit(4, 1, -0.5, 0.5), v.digit(4, 2, -0.5, 0.5), v.noise(1.9, 0, 1)),
            bColor: color(v, v.noise(2.1, -0.2, 1.2), v.noise(2.2, -0.2, 1.2), v.noise(2.3, -0.2, 1.2), v.noise(2.4, 0, 1))}),
        b: v => ({factorFloat: v.digit(4, 0, -0.25, 0.5),
            aColor: color(v, v.noise(3.1, -0.2, 1.2), v.noise(3.2, -0.2, 1.2), v.noise(3.3, -0.2, 1.2), v.noise(3.4, 0, 1)),
            bColor: color(v, v.digit(4, 1, -0.5, 0.5), v.digit(4, 2, -0.5, 0.5), v.digit(2, 0, 0, 0.5), 0.5)}),
    }
    for (const blend of BLEND_MODES) {
        for (const [clampFactor, clampResult] of [[true, false], [false, true]]) {
            const id = `mix-color-${blend.toLowerCase().replace('_', '-')}${clampFactor ? '' : '-unclamped'}${clampResult ? '-clamp-result' : ''}`
            const props = {dataType: 'RGBA', blendType: blend, clampFactor, clampResult}
            cases.push(nodeCase(id, `Mix RGBA ${blend} clamp factor=${clampFactor} clamp result=${clampResult}`, 'ShaderNodeMix', props, colorSets))
        }
        cases.push(singleCase(`mix-color-${blend.toLowerCase().replace('_', '-')}-single`, `Mix RGBA ${blend} on single values`, 'ShaderNodeMix',
            {dataType: 'RGBA', blendType: blend}, [
                {factorFloat: 0.6, aColor: [0.2, 0.7, 0.4, 0.9], bColor: [0.9, 0.1, 0.5, 0.3]},
                {factorFloat: 1, aColor: [0, 0.5, 1, 1], bColor: [0.5, 0, 0.25, 0]},
                {factorFloat: 0.3, aColor: [0.4, 0.4, 0.4, 1], bColor: [0.8, 0.8, 0.8, 1]},
            ]))
    }
    return cases
}

export function functionMathCases(): ParityCase[] {
    const cases: ParityCase[] = []
    cases.push(nodeCase('combine-xyz', 'Combine XYZ', 'ShaderNodeCombineXYZ', {}, {
        a: v => ({x: v.digit(4, 0, -1, 1), y: v.noise(1.5, -5, 5), z: v.digit(4, 1, -0.5, 0.25)}),
    }))
    cases.push(singleCase('combine-xyz-single', 'Combine XYZ on single values', 'ShaderNodeCombineXYZ', {}, [{x: 1.5, y: -2.25, z: 0.1}]))
    cases.push(nodeCase('separate-xyz', 'Separate XYZ', 'ShaderNodeSeparateXYZ', {}, {
        a: v => ({vector: v.noiseVector(4.5, -5, 5)}),
    }))
    cases.push(singleCase('separate-xyz-single', 'Separate XYZ on single values', 'ShaderNodeSeparateXYZ', {}, [{vector: [1.5, -2.25, 0.1]}]))
    for (const mode of ['RGB', 'HSV', 'HSL']) {
        const m = mode.toLowerCase()
        // Hue beyond [0, 1] exercises the CLAMPs of the hue ramp; saturation/value beyond [0, 1] too.
        cases.push(nodeCase(`combine-color-${m}`, `Combine Color ${mode}`, 'FunctionNodeCombineColor', {mode}, {
            a: v => ({red: v.digit(8, 0, -0.25, 0.21), green: v.digit(4, 1, -0.2, 0.45), blue: v.digit(2, 5, 0.3, 0.6), alpha: v.noise(1, -0.5, 1.5)}),
            b: v => ({red: v.noise(2, -0.5, 1.5), green: v.noise(3, 0, 1), blue: v.noise(4, -0.25, 1.25), alpha: 0.5}),
        }))
        cases.push(singleCase(`combine-color-${m}-single`, `Combine Color ${mode} on single values`, 'FunctionNodeCombineColor', {mode}, [
            {red: 0.3, green: 0.6, blue: 0.9, alpha: 0.4}, {red: 1, green: 0, blue: 0.5, alpha: 1}, {red: 0.0, green: 1, blue: 1, alpha: 1},
        ]))
        // Ties between channels (equal digits) exercise rgb_to_hsv/hsl's branch order.
        cases.push(nodeCase(`separate-color-${m}`, `Separate Color ${mode}`, 'FunctionNodeSeparateColor', {mode}, {
            a: v => ({color: color(v, v.digit(4, 0, -0.1, 0.4), v.digit(4, 1, -0.1, 0.4), v.digit(4, 2, -0.1, 0.4), v.noise(1, 0, 1))}),
            b: v => ({color: color(v, v.noise(5, 0, 1), v.noise(6, 0, 1), v.noise(7, 0, 1.5), v.noise(8, 0, 1))}),
        }))
        cases.push(singleCase(`separate-color-${m}-single`, `Separate Color ${mode} on single values`, 'FunctionNodeSeparateColor', {mode}, [
            {color: [0.3, 0.6, 0.9, 0.4]}, {color: [0.5, 0.5, 0.5, 1]}, {color: [0.9, 0.2, 0.2, 0.7]}, {color: [0.1, 0.8, 0.8, 1]},
        ]))
    }
    cases.push(...vectorMathCases())
    for (const clampType of ['MINMAX', 'RANGE']) {
        cases.push(nodeCase(`clamp-${clampType.toLowerCase()}`, `Clamp ${clampType}`, 'ShaderNodeClamp', {clampType}, {
            a: v => ({value: v.noise(1, -2, 2), min: v.digit(4, 1, -1, 1), max: v.digit(4, 2, -1, 1)}),
            b: v => ({value: v.digit(4, 0, -1.5, 1), min: v.noise(2, -1, 1), max: v.noise(3, -1, 1)}),
        }))
        cases.push(singleCase(`clamp-${clampType.toLowerCase()}-single`, `Clamp ${clampType} on single values`, 'ShaderNodeClamp', {clampType}, [
            {value: 0.5, min: 1, max: 0}, {value: -3, min: -1, max: 2}, {value: 7, min: 2, max: 2},
        ]))
    }
    cases.push(...mapRangeCases())
    cases.push(...mixCases())
    return cases
}
