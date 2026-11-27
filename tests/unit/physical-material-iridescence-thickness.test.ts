/**
 * PhysicalMaterial with three.js r187, which replaced iridescenceThicknessRange with iridescenceThicknessMinimum and
 * iridescenceThicknessMaximum, and with the diffuseRoughness (r187) and retroreflectivity (r186) properties: setValues
 * (and so the constructor, clone, and the glTF loader's material parameters) keeps them, and a range saved before
 * r187 sets the two values.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {Texture} from 'three'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

describe('PhysicalMaterial r187 properties', () => {
    test('iridescenceThicknessMinimum and Maximum, diffuseRoughness and retroreflectivity are set and cloned', () => {
        const diffuseRoughnessMap = new Texture()
        const m = new tp.PhysicalMaterial({iridescenceThicknessMinimum: 50, iridescenceThicknessMaximum: 800, diffuseRoughness: 0.5, diffuseRoughnessMap, retroreflectivity: 0.25})
        expect(m.iridescenceThicknessMinimum).toBe(50)
        expect(m.iridescenceThicknessMaximum).toBe(800)
        expect(m.diffuseRoughness).toBe(0.5)
        expect(m.diffuseRoughnessMap).toBe(diffuseRoughnessMap)
        expect(m.retroreflectivity).toBe(0.25)
        const c = m.clone()
        expect(c.iridescenceThicknessMinimum).toBe(50)
        expect(c.iridescenceThicknessMaximum).toBe(800)
        expect(c.diffuseRoughness).toBe(0.5)
        expect(c.diffuseRoughnessMap).toBe(diffuseRoughnessMap)
        expect(c.retroreflectivity).toBe(0.25)
    })
    test('a saved iridescenceThicknessRange sets the minimum and maximum', () => {
        const m = new tp.PhysicalMaterial()
        m.setValues({iridescenceThicknessRange: [200, 600]} as any)
        expect(m.iridescenceThicknessMinimum).toBe(200)
        expect(m.iridescenceThicknessMaximum).toBe(600)
    })
    test('toJSON and setValues keep the values', () => {
        const json = new tp.PhysicalMaterial({iridescenceThicknessMinimum: 10, iridescenceThicknessMaximum: 20}).toJSON()
        const m = new tp.PhysicalMaterial()
        m.setValues(json)
        expect(m.iridescenceThicknessMinimum).toBe(10)
        expect(m.iridescenceThicknessMaximum).toBe(20)
    })
})
