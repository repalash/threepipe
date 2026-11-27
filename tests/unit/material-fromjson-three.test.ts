/**
 * threepipe's materials' fromJSON(data, meta, _internal) with three.js r185, whose MaterialLoader calls
 * material.fromJSON(json, textures): called that way it is three.js's Material.fromJSON, and called with a
 * SerializationMetaType it deserializes as before.
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {MaterialLoader, Texture} from 'three'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

describe('material fromJSON', () => {
    test('three.js MaterialLoader: json and the textures by uuid', () => {
        const map = new Texture()
        class Loader extends MaterialLoader {
            createMaterialFromType(type: string) {
                return type === 'MeshPhysicalMaterial' ? new tp.PhysicalMaterial() : super.createMaterialFromType(type)
            }
        }
        const loader = new Loader()
        loader.setTextures({[map.uuid]: map})
        const json = new tp.PhysicalMaterial({color: 0xff0000, roughness: 0.25, map}).toJSON()
        json.type = 'MeshPhysicalMaterial'
        const m = loader.parse(json as any) as InstanceType<typeof tp.PhysicalMaterial>
        expect(m).toBeInstanceOf(tp.PhysicalMaterial)
        expect(m.roughness).toBe(0.25)
        expect(m.color.getHex()).toBe(0xff0000)
        expect(m.map).toBe(map)
    })
    test('each material with an empty textures map', () => {
        for (const m of [new tp.PhysicalMaterial(), new tp.UnlitMaterial(), new tp.UnlitLineMaterial(), new tp.LegacyPhongMaterial(), new tp.LineMaterial2()]) {
            expect(m.fromJSON({opacity: 0.5, name: 'a'}, {}), m.type).toBe(m)
            expect(m.opacity, m.type).toBe(0.5)
            expect(m.name, m.type).toBe('a')
        }
    })
    test('threepipe: a SerializationMetaType with _internal', () => {
        const m = new tp.PhysicalMaterial()
        const json = new tp.PhysicalMaterial({color: 0x00ff00, roughness: 0.75}).toJSON()
        expect(m.fromJSON(json, tp.getEmptyMeta(), true)).toBe(m)
        expect(m.roughness).toBe(0.75)
        expect(m.color.getHex()).toBe(0x00ff00)
    })
})
