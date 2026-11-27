/**
 * PointLight2.power and RectAreaLight2.power are three.js's accessors (luminous power from and to the intensity), with
 * the Power slider in the UI. A decorated property in their place stored the value apart and left the intensity as is.
 */
import {beforeAll, describe, expect, test} from 'vitest'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

describe('light power', () => {
    test('PointLight2: power sets the intensity and is computed from it', () => {
        const l = new tp.PointLight2(0xffffff, 2)
        expect(l.power).toBeCloseTo(2 * 4 * Math.PI)
        let dirty = 0
        l.addEventListener('objectUpdate', () => dirty++)
        l.power = 100
        expect(l.intensity).toBeCloseTo(100 / (4 * Math.PI))
        expect(l.power).toBeCloseTo(100)
        expect(dirty).toBeGreaterThan(0)
    })
    test('RectAreaLight2: power sets the intensity and is computed from it', () => {
        const l = new tp.RectAreaLight2(0xffffff, 1, 2, 3)
        expect(l.power).toBeCloseTo(1 * 2 * 3 * Math.PI)
        l.power = 60
        expect(l.intensity).toBeCloseTo(60 / (2 * 3 * Math.PI))
        l.width = 4
        expect(l.power).toBeCloseTo(l.intensity * 4 * 3 * Math.PI)
    })
})
