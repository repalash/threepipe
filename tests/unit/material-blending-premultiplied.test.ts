/**
 * MultiplyBlending and SubtractiveBlending need premultipliedAlpha since three.js r178 (WebGLState logs an error and
 * keeps the last blend function without it). A threepipe material keeps premultipliedAlpha on while its blending is
 * one of them, in any order of setting (code, the UI, copy, setValues, a loaded material).
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {AdditiveBlending, MeshStandardMaterial, MultiplyBlending, NormalBlending, SubtractiveBlending} from 'three'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

describe('premultipliedAlpha with Multiply and Subtractive blending', () => {
    test('setting the blending turns premultipliedAlpha on and recompiles; it stays on while needed', () => {
        for (const blending of [MultiplyBlending, SubtractiveBlending]) {
            const m = new tp.PhysicalMaterial()
            expect(m.premultipliedAlpha).toBe(false)
            const version = m.version
            m.blending = blending
            expect(m.premultipliedAlpha).toBe(true)
            expect(m.version).toBeGreaterThan(version)
            m.premultipliedAlpha = false
            expect(m.premultipliedAlpha).toBe(true)
            // another mode keeps the value, which can then be turned off
            m.blending = NormalBlending
            expect(m.premultipliedAlpha).toBe(true)
            m.premultipliedAlpha = false
            expect(m.premultipliedAlpha).toBe(false)
        }
    })

    test('the other modes do not change it', () => {
        const m = new tp.UnlitMaterial()
        m.blending = AdditiveBlending
        expect(m.premultipliedAlpha).toBe(false)
    })

    test('constructor parameters, setValues, copy and a loaded material', () => {
        expect(new tp.PhysicalMaterial({blending: MultiplyBlending}).premultipliedAlpha).toBe(true)
        const a = new tp.PhysicalMaterial()
        a.setValues({blending: SubtractiveBlending, premultipliedAlpha: false})
        expect(a.premultipliedAlpha).toBe(true)
        // copy() sets blending before premultipliedAlpha; a three.js material that has Multiply without it
        const source = new MeshStandardMaterial({blending: MultiplyBlending})
        source.premultipliedAlpha = false
        const b = new tp.PhysicalMaterial().copy(source as any)
        expect(b.blending).toBe(MultiplyBlending)
        expect(b.premultipliedAlpha).toBe(true)
        // a material saved before three.js r178, with Multiply and without premultipliedAlpha
        const json = new tp.PhysicalMaterial({blending: MultiplyBlending}).toJSON()
        expect(json.premultipliedAlpha).toBe(true)
        delete json.premultipliedAlpha
        const c = new tp.PhysicalMaterial().fromJSON(json, undefined, true) // as the material manager loads it
        expect(c?.blending).toBe(MultiplyBlending)
        expect(c?.premultipliedAlpha).toBe(true)
    })
})
