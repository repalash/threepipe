import {describe, expect, it} from 'vitest'
import {primitiveCube} from '@threepipe/mesh-kernel'
import {describeModifier, evaluateModifiers} from '../src/modifiers'

/**
 * A live radial array with a rise: the spiral staircase case. The modifier must hand `step` to the
 * kernel as Blender's constant offset, so changing `count` re-lays every tread.
 */
describe('radial array modifier with step', () => {
    const tread = () => primitiveCube({size: 1, matrix: [0.5, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.2, 0, 0.6, 0, 0, 1]})

    it('lifts each copy by step as it turns', () => {
        const master = tread()
        const out = evaluateModifiers(master, [{type: 'array', mode: 'radial', count: 24, angle: Math.PI * 4,
            axis: [0, 1, 0], step: [0, 0.2, 0]}])
        expect(out.vertsNum).toBe(master.vertsNum * 24)
        let top = -Infinity
        for (let i = 0; i < out.vertsNum; i++) top = Math.max(top, out.positions[i * 3 + 1])
        // 23 steps of 0.2 above the master's top face (0.025).
        expect(top).toBeCloseTo(0.025 + 23 * 0.2, 5)
        expect(out.validate()).toEqual([])
    })

    it('a different count re-lays the whole flight from the same master', () => {
        const master = tread()
        const at = (count: number) => evaluateModifiers(master, [{type: 'array', mode: 'radial', count,
            angle: Math.PI * 4, axis: [0, 1, 0], step: [0, 4.8 / count, 0]}])
        const a = at(24), b = at(32)
        expect(b.vertsNum / a.vertsNum).toBeCloseTo(32 / 24, 9)
        expect(describeModifier({type: 'array', mode: 'radial', count: 24, angle: Math.PI * 4, step: [0, 0.2, 0]}))
            .toBe('array radial ×24, 720° about [0, 1, 0], step [0, 0.2, 0]')
    })
})
