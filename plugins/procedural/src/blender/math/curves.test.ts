/** Curve mapping and colour band evaluation (`blenkernel/intern/colortools.cc`, `colorband.cc`). */
import {describe, expect, it} from 'vitest'
import {f32} from '../f32'
import {buildColorBand, colorbandEvaluate} from './colorband'
import {buildCurveMapping, curvemappingEvaluateF} from './curveMapping'

describe('curve mapping', () => {
    it('the default mapping (0,0)-(1,1) is close to identity and clipped to [0, 1]', () => {
        const m = buildCurveMapping(undefined)
        for (const x of [0.1, 0.5, 0.9]) expect(Math.abs(curvemappingEvaluateF(m, 0, x) - x)).toBeLessThan(1e-6)
        expect(curvemappingEvaluateF(m, 0, 3)).toBe(1)
        expect(curvemappingEvaluateF(m, 0, -2)).toBe(0)
    })
    it('horizontal extension keeps the end values outside the table (curvemap_calc_extend :687)', () => {
        const m = buildCurveMapping({useClip: false, extend: 'HORIZONTAL', curves: [{points: [{location: [0.2, 0.4], handleType: 'VECTOR'}, {location: [0.8, 0.6], handleType: 'VECTOR'}]}]})
        // The table's end values (forward-differenced, so within float noise of the key values).
        expect(curvemappingEvaluateF(m, 0, -5)).toBe(curvemappingEvaluateF(m, 0, -50))
        expect(curvemappingEvaluateF(m, 0, 5)).toBe(curvemappingEvaluateF(m, 0, 50))
        expect(Math.abs(curvemappingEvaluateF(m, 0, -5) - f32(0.4))).toBeLessThan(1e-6)
        expect(Math.abs(curvemappingEvaluateF(m, 0, 5) - f32(0.6))).toBeLessThan(1e-6)
    })
    it('rejects unknown handle types', () => {
        expect(() => buildCurveMapping({curves: [{points: [{location: [0, 0], handleType: 'ALIGN'}, {location: [1, 1]}]}]})).toThrow()
    })
})

describe('colour band', () => {
    it('the default band is black to white, constant outside [0, 1]', () => {
        const b = buildColorBand(undefined)
        expect(colorbandEvaluate(b, 0.25)).toEqual([0.25, 0.25, 0.25, 1])
        expect(colorbandEvaluate(b, -1)).toEqual([0, 0, 0, 1])
        expect(colorbandEvaluate(b, 2)).toEqual([1, 1, 1, 1])
    })
    it('CONSTANT takes the element to the left (colorband.cc:486)', () => {
        const b = buildColorBand({interpolation: 'CONSTANT', elements: [{position: 0, color: [1, 0, 0, 1]}, {position: 0.5, color: [0, 1, 0, 1]}]})
        expect(colorbandEvaluate(b, 0.49)).toEqual([1, 0, 0, 1])
        expect(colorbandEvaluate(b, 0.5)).toEqual([0, 1, 0, 1])
    })
})
