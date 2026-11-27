import {describe, expect, test, vi} from 'vitest'
import {PointLight2} from './PointLight2'
import {RectAreaLight2} from './RectAreaLight2'

describe('light power', () => {
    test('PointLight2 power is three.js\'s: set from and sets the intensity', () => {
        const light = new PointLight2(0xffffff, 2)
        expect(light.power).toBeCloseTo(2 * 4 * Math.PI)
        const setDirty = vi.spyOn(light, 'setDirty')
        light.power = 100
        expect(light.intensity).toBeCloseTo(100 / (4 * Math.PI))
        expect(light.power).toBeCloseTo(100)
        expect(setDirty).toHaveBeenCalled()
    })

    test('RectAreaLight2 power is three.js\'s: set from and sets the intensity', () => {
        const light = new RectAreaLight2(0xffffff, 3, 2, 4)
        expect(light.power).toBeCloseTo(3 * 2 * 4 * Math.PI)
        const setDirty = vi.spyOn(light, 'setDirty')
        light.power = 50
        expect(light.intensity).toBeCloseTo(50 / (2 * 4 * Math.PI))
        expect(setDirty).toHaveBeenCalled()
    })
})
