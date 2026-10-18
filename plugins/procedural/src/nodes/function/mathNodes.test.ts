/**
 * Formula checks for the converter / math function nodes (Blender 5.2.2 sources cited per test). The
 * parity cases (`tests/parity/cases/functionMath.ts`) compare every operation with Blender itself; these
 * pin the branches the audits called out.
 */
import {describe, expect, it} from 'vitest'
import {f32} from '../../blender/f32'
import {hslToRgb, hsvToRgb, rampBlend, rgbToHsl, rgbToHsv} from '../../blender/math/color'
import type {JSONValue} from '../../runtime/types'
import '../index'
import {evalNode} from './testing'

/** Evaluate a node on constant inputs (by socket identifier) through the evaluator; its first output. */
function run(type: string, properties: Record<string, JSONValue>, inputs: Record<string, JSONValue>): number[] {
    return Object.values(evalNode(type, {properties, inputs}))[0]
}

describe('colour models (blenlib/intern/math_color.cc)', () => {
    it('hsv_to_rgb / rgb_to_hsv (:23, :296)', () => {
        expect(hsvToRgb(0, 1, 1)).toEqual([1, 0, 0])
        expect(hsvToRgb(1 / 3, 1, 0.5)).toEqual([0, 0.5, 0])
        const [h, s, v] = rgbToHsv(f32(0.2), f32(0.4), f32(0.8))
        // r < g < b: g/b swapped (k = -1), then r/g swapped (k = -2/6 - k); chroma = 0.8 - 0.2.
        const chroma = f32(f32(0.8) - f32(0.2))
        expect(h).toBe(Math.abs(f32(f32(f32(-2 / 6) + 1) + f32(f32(f32(0.2) - f32(0.4)) / f32(f32(6 * chroma) + f32(1e-20))))))
        expect(s).toBe(f32(chroma / f32(f32(0.8) + f32(1e-20))))
        expect(v).toBe(f32(0.8))
    })
    it('hsl round trip and the achromatic case (:40, :325)', () => {
        expect(rgbToHsl(0.5, 0.5, 0.5)).toEqual([0, 0, 0.5])
        const [h, s, l] = rgbToHsl(f32(0.9), f32(0.2), f32(0.2))
        expect(h).toBe(0)
        hslToRgb(h, s, l).forEach((x, i) => expect(x).toBeCloseTo([0.9, 0.2, 0.2][i], 6))
    })
    it('ramp_blend DIVIDE leaves channels of a zero divisor (blenkernel/intern/material.cc:1941)', () => {
        const c = [0.4, 0.6, 0.8, 1]
        rampBlend('DIVIDE', c, 1, [0.5, 0, 2, 1])
        expect(c).toEqual([f32(f32(0) + f32(f32(1 * 0.4) / 0.5)), 0.6, f32(f32(1 * 0.8) / 2), 1])
    })
})

describe('Map Range (nodes/shader/nodes/node_shader_map_range.cc)', () => {
    it('STEPPED clamps with clamp_range when Clamp is on (:262, audit M13)', () => {
        // factor 2 -> floor(2 * 5) / 4 = 2.5 -> 2.5, clamped to [0, 1].
        const props = {interpolation_type: 'STEPPED', data_type: 'FLOAT'}
        expect(run('ShaderNodeMapRange', {...props, clamp: true}, {Value: 2, 'From Min': 0, 'From Max': 1, 'To Min': 0, 'To Max': 1, Steps: 4})).toEqual([1])
        expect(run('ShaderNodeMapRange', {...props, clamp: false}, {Value: 2, 'From Min': 0, 'From Max': 1, 'To Min': 0, 'To Max': 1, Steps: 4})).toEqual([2.5])
    })
    it('clamp_range swaps reversed target bounds (:235)', () => {
        // 1 + 2 * (0 - 1) = -1, clamped to [0, 1] (To Min 1 > To Max 0).
        expect(run('ShaderNodeMapRange', {}, {Value: 2, 'From Min': 0, 'From Max': 1, 'To Min': 1, 'To Max': 0})).toEqual([0])
    })
    it('SMOOTHSTEP ignores Clamp and clamps the factor instead (:412)', () => {
        expect(run('ShaderNodeMapRange', {interpolation_type: 'SMOOTHSTEP', clamp: true}, {Value: 0.25, 'From Min': 0, 'From Max': 1, 'To Min': 10, 'To Max': -10}))
            .toEqual([f32(10 + f32(f32(f32(3 - 0.5) * f32(0.0625)) * -20))])
    })
})

describe('Vector Math (functions/intern/multi_function_common.cc)', () => {
    it('REFLECT normalises the normal (:395)', () => {
        expect(run('ShaderNodeVectorMath', {operation: 'REFLECT'}, {Vector: [1, -1, 0], Vector_001: [0, 2, 0]})).toEqual([1, 1, 0])
    })
    it('PROJECT onto a zero vector is zero (BLI_math_vector.hh:511)', () => {
        expect(run('ShaderNodeVectorMath', {operation: 'PROJECT'}, {Vector: [1, 2, 3], Vector_001: [0, 0, 0]})).toEqual([0, 0, 0])
    })
    it('WRAP takes (value, max, min) (:463)', () => {
        // wrapf(5, 2, 0) = 5 - 2 * floor(5 / 2) = 1.
        expect(run('ShaderNodeVectorMath', {operation: 'WRAP'}, {Vector: [5, 5, 5], Vector_001: [2, 2, 2], Vector_002: [0, 0, 0]})).toEqual([1, 1, 1])
    })
})

describe('Clamp (nodes/shader/nodes/node_shader_clamp.cc:53)', () => {
    it('MINMAX applies max then min; RANGE orders the bounds', () => {
        expect(run('ShaderNodeClamp', {clamp_type: 'MINMAX'}, {Value: 0.5, Min: 1, Max: 0})).toEqual([0])
        expect(run('ShaderNodeClamp', {clamp_type: 'RANGE'}, {Value: 0.5, Min: 1, Max: 0})).toEqual([0.5])
    })
})
