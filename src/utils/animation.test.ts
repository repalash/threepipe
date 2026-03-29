import {describe, test, expect} from 'vitest'
import {lerpAngle} from './animation'

describe('lerpAngle', () => {
    test('interpolates between two angles linearly when difference < PI', () => {
        expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5)
        expect(lerpAngle(0, 1, 0)).toBeCloseTo(0)
        expect(lerpAngle(0, 1, 1)).toBeCloseTo(1)
    })

    test('wraps around when difference >= PI (shortest path)', () => {
        // From ~0 to ~2PI should go backwards through 0
        const result = lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5)
        // Should interpolate through 0/2PI, not through PI
        expect(Math.abs(result)).toBeLessThan(Math.PI / 2)
    })

    test('wraps around when difference <= -PI', () => {
        // From ~2PI to ~0 should go forward through 2PI (shortest path wrapping around 0/2PI)
        const result = lerpAngle(Math.PI * 2 - 0.1, 0.1, 0.5)
        // midpoint between (2PI-0.1) and 0.1 going through 2PI/0 is near 2PI (or equivalently 0)
        expect(result).toBeCloseTo(Math.PI * 2, 1)
    })

    test('t=0 returns start angle', () => {
        expect(lerpAngle(1.0, 2.0, 0)).toBeCloseTo(1.0)
    })

    test('t=1 returns end angle', () => {
        expect(lerpAngle(1.0, 2.0, 1)).toBeCloseTo(2.0)
    })

    test('handles negative angles', () => {
        expect(lerpAngle(-1, 1, 0.5)).toBeCloseTo(0)
    })

    test('handles same angle', () => {
        expect(lerpAngle(1.5, 1.5, 0.5)).toBeCloseTo(1.5)
    })

    test('exact Math.PI boundary (d === PI, goes to >= branch)', () => {
        // a=0, b=PI => d=PI => d >= PI => return a + (d - 2*PI) * t
        // At t=0.5: 0 + (PI - 2*PI) * 0.5 = -PI/2
        const result = lerpAngle(0, Math.PI, 0.5)
        expect(result).toBeCloseTo(-Math.PI / 2)
    })

    test('exact -Math.PI boundary (d === -PI, goes to <= branch)', () => {
        // a=PI, b=0 => d=-PI => d <= -PI => return a + (d + 2*PI) * t
        // At t=0.5: PI + (-PI + 2*PI) * 0.5 = PI + PI/2
        const result = lerpAngle(Math.PI, 0, 0.5)
        expect(result).toBeCloseTo(Math.PI + Math.PI / 2)
    })

    test('t outside [0,1] — t=2 extrapolates beyond target', () => {
        // a=0, b=1, d=1 (< PI, linear branch) => 0 + 1*2 = 2
        const result = lerpAngle(0, 1, 2)
        expect(result).toBeCloseTo(2)
    })

    test('t outside [0,1] — t=-1 extrapolates before start', () => {
        // a=0, b=1, d=1 (< PI, linear branch) => 0 + 1*(-1) = -1
        const result = lerpAngle(0, 1, -1)
        expect(result).toBeCloseTo(-1)
    })

    test('very large angles (10*PI)', () => {
        // a=0, b=10*PI => d=10*PI => d >= PI => return a + (d - 2*PI) * t
        // At t=0.5: 0 + (10*PI - 2*PI) * 0.5 = 4*PI
        const result = lerpAngle(0, 10 * Math.PI, 0.5)
        expect(result).toBeCloseTo(4 * Math.PI)
    })

    test('very large negative angle difference', () => {
        // a=10*PI, b=0 => d=-10*PI => d <= -PI => return a + (d + 2*PI) * t
        // At t=0.5: 10*PI + (-10*PI + 2*PI) * 0.5 = 10*PI - 4*PI = 6*PI
        const result = lerpAngle(10 * Math.PI, 0, 0.5)
        expect(result).toBeCloseTo(6 * Math.PI)
    })
})
