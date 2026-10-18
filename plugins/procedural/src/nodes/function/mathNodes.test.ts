/**
 * Formula checks for the converter / math function nodes (Blender 5.2.2 sources cited per test). The
 * parity cases (`tests/parity/cases/functionMath.ts`) compare every operation with Blender itself; these
 * pin the branches the audits called out.
 */
import {describe, expect, it} from 'vitest'
import {f32} from '../../blender/f32'
import {hslToRgb, hsvToRgb, rampBlend, rgbToHsl, rgbToHsv} from '../../blender/math/color'
import {DATA_TYPES} from '../../geometry/dataTypes'
import {GVArray} from '../../geometry/varray'
import {getNodeType, NodeInstance} from '../../runtime/registry'
import type {JSONValue} from '../../runtime/types'
import '../index'

/** Run a node's multi-function once on single values (inputs in declaration order of available sockets). */
export function runSingle(idname: string, properties: Record<string, JSONValue>, inputs: number[][]): number[][] {
    const def = getNodeType(idname)!
    const node = new NodeInstance({name: 'n', type: idname, properties}, def)
    const fn = def.multiFunction!(node)
    const ins = fn.inputs.map((t, i) => GVArray.fromSingle(t, 1, inputs[i]))
    const outs = fn.outputs.map(t => new DATA_TYPES[t].array(DATA_TYPES[t].components))
    fn.call(1, ins, outs)
    return outs.map(o => Array.from(o))
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
        expect(runSingle('ShaderNodeMapRange', {...props, clamp: true}, [[2], [0], [1], [0], [1], [4]])[0]).toEqual([1])
        expect(runSingle('ShaderNodeMapRange', {...props, clamp: false}, [[2], [0], [1], [0], [1], [4]])[0]).toEqual([2.5])
    })
    it('clamp_range swaps reversed target bounds (:235)', () => {
        // 1 + 2 * (0 - 1) = -1, clamped to [0, 1] (To Min 1 > To Max 0).
        expect(runSingle('ShaderNodeMapRange', {}, [[2], [0], [1], [1], [0]])[0]).toEqual([0])
    })
    it('SMOOTHSTEP ignores Clamp and clamps the factor instead (:412)', () => {
        expect(runSingle('ShaderNodeMapRange', {interpolation_type: 'SMOOTHSTEP', clamp: true}, [[0.25], [0], [1], [10], [-10]])[0])
            .toEqual([f32(10 + f32(f32(f32(3 - 0.5) * f32(0.0625)) * -20))])
    })
})

describe('Vector Math (functions/intern/multi_function_common.cc)', () => {
    it('REFLECT normalises the normal (:395)', () => {
        expect(runSingle('ShaderNodeVectorMath', {operation: 'REFLECT'}, [[1, -1, 0], [0, 2, 0]])[0]).toEqual([1, 1, 0])
    })
    it('PROJECT onto a zero vector is zero (BLI_math_vector.hh:511)', () => {
        expect(runSingle('ShaderNodeVectorMath', {operation: 'PROJECT'}, [[1, 2, 3], [0, 0, 0]])[0]).toEqual([0, 0, 0])
    })
    it('WRAP takes (value, max, min) (:463)', () => {
        // wrapf(5, 2, 0) = 5 - 2 * floor(5 / 2) = 1.
        expect(runSingle('ShaderNodeVectorMath', {operation: 'WRAP'}, [[5, 5, 5], [2, 2, 2], [0, 0, 0]])[0]).toEqual([1, 1, 1])
    })
})

describe('Clamp (nodes/shader/nodes/node_shader_clamp.cc:53)', () => {
    it('MINMAX applies max then min; RANGE orders the bounds', () => {
        expect(runSingle('ShaderNodeClamp', {clamp_type: 'MINMAX'}, [[0.5], [1], [0]])[0]).toEqual([0])
        expect(runSingle('ShaderNodeClamp', {clamp_type: 'RANGE'}, [[0.5], [1], [0]])[0]).toEqual([0.5])
    })
})
