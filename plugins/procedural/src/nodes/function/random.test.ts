/** Random Value / Hash Value formulas (`nodes/function/nodes/node_fn_random_value.cc`, `node_fn_hash_value.cc`). */
import {describe, expect, it} from 'vitest'
import {f32} from '../../blender/f32'
import {hash1, hash2, hashToFloat2, hashToFloat3} from '../../blender/noise'
import {callSpans, evalNode, nodeFunction} from './testing'
import '../index'
import {hashString} from './random'

/** Random Value's function on one element (the ID input is an implicit field, so it is passed directly). */
const call = (dataType: string, inputs: number[][]) => callSpans(nodeFunction('FunctionNodeRandomValue', {data_type: dataType}), inputs.map(v => [v]))[0][0]

describe('Random Value', () => {
    it('FLOAT hashes (seed, id); BOOLEAN hashes (id, seed) (:152, :185)', () => {
        expect(call('FLOAT', [[-2], [3], [5], [9]]))
            .toEqual([f32(f32(hashToFloat2(9, 5) * 5) - 2)])
        expect(call('BOOLEAN', [[0.5], [5], [9]])).toEqual([hashToFloat2(5, 9) <= 0.5 ? 1 : 0])
    })
    it('FLOAT_VECTOR hashes (seed, id, axis) (:139)', () => {
        const out = call('FLOAT_VECTOR', [[0, 0, 0], [1, 1, 1], [4], [2]])
        expect(out).toEqual([0, 1, 2].map(k => hashToFloat3(2, 4, k)))
    })
    it('INT swaps reversed bounds and covers the whole 32-bit range without a modulo (:163)', () => {
        const h = hash2(5, 1) >>> 0
        expect(call('INT', [[10], [-10], [5], [1]])).toEqual([-10 + (h % 21)])
        expect(call('INT', [[-2147483648], [2147483647], [5], [1]])).toEqual([(0x80000000 + h) | 0])
    })
})

describe('Hash Value', () => {
    it('INT is hash(hash(value), seed) (:62)', () => {
        expect(evalNode('FunctionNodeHashValue', {properties: {data_type: 'INT'}, inputs: {Value: 42, Seed: 7}}).Hash).toEqual([hash2(hash1(42), 7) | 0])
    })
    it('BLI_hash_string uses unsigned chars (-funsigned-char)', () => {
        expect(hashString('ab')).toBe(97 * 37 + 98)
        expect(hashString('é')).toBe((0xc3 * 37 + 0xa9) >>> 0)
    })
})
