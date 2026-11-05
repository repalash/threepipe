/**
 * The GBuffer material cuts the pixels that the material of the object cuts: the alpha of its `map` and `alphaMap`
 * under `alphaTest`. three.js compiles the map chunks only for a material with its own `map` or `alphaMap`, and the
 * GBuffer material has only uniforms, so it defines them (`USE_MAP`, `USE_ALPHAMAP` and their UV). No WebGL.
 */
import {beforeAll, describe, expect, test} from 'vitest'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

beforeAll(async() => {
    tp = await import('threepipe')
}, timeout)

describe('GBufferMaterial: the alpha of the material', {timeout}, () => {
    const renderer = {
        getContext: () => ({NONE: 0, COLOR_ATTACHMENT0: 0x8CE0, COLOR_ATTACHMENT1: 0x8CE1, drawBuffers: () => undefined}),
        getRenderTarget: () => ({textures: [{}, {}]}),
        materials: {refreshTransformUniform: () => undefined},
    }
    const camera = {updateShaderProperties: () => undefined}
    /** The defines and uniforms of the GBuffer material during the draw of the object, and after it */
    function draw(mat: any, object: any) {
        mat.onBeforeRender(renderer, null, camera, object.geometry, object, null)
        const d = mat.defines
        const during = {map: d.USE_MAP, mapUv: d.MAP_UV, alphaMap: d.USE_ALPHAMAP, alphaMapUv: d.ALPHAMAP_UV,
            mapValue: mat.uniforms.map.value, alphaMapValue: mat.uniforms.alphaMap.value, alphaTest: mat.uniforms.alphaTest.value}
        mat.onAfterRender(renderer, null, camera, object.geometry, object, null)
        return during
    }

    test('a map and an alpha map are compiled in, with the alpha test of the material', () => {
        const mat = new tp.GBufferMaterial(true)
        const map = new tp.Texture(), alphaMap = new tp.Texture()
        const src = new tp.PhysicalMaterial({map, alphaMap, alphaTest: 0.5})
        expect(draw(mat, new tp.Mesh(new tp.BoxGeometry(), src))).toEqual({
            map: 1, mapUv: 'uv', alphaMap: 1, alphaMapUv: 'uv', mapValue: map, alphaMapValue: alphaMap, alphaTest: 0.5,
        })
        expect([mat.uniforms.map.value, mat.uniforms.alphaMap.value]).toEqual([null, null])
        // the next object without maps: no map chunks
        const s = draw(mat, new tp.Mesh(new tp.BoxGeometry(), new tp.PhysicalMaterial()))
        expect([s.map, s.mapUv, s.alphaMap, s.alphaMapUv]).toEqual([undefined, undefined, undefined, undefined])
    })

    test('also for a GBuffer material set on the object (customGBufferMaterial): the alpha of its own material', () => {
        const mat = new tp.GBufferMaterial(true)
        const map = new tp.Texture()
        const src = new tp.PhysicalMaterial({map, alphaTest: 0.25, transparent: true})
        const mesh = new tp.Mesh(new tp.BoxGeometry(), src)
        tp.iObjectCommons.upgradeObject3D.call(mesh)
        mesh.forcedOverrideMaterial = mat // as GBufferRenderPass.forceObjectMaterial: `material` is then the GBuffer material
        expect(mesh.material).toBe(mat)
        const s = draw(mat, mesh)
        expect([s.map, s.mapValue, s.alphaTest]).toEqual([1, map, 0.25])
        // its source material without the map: the map is gone from the next draw too (this material is not reset)
        src.map = null
        const t = draw(mat, mesh)
        expect([t.map, t.mapValue]).toEqual([undefined, null])
    })

    test('no alpha test with alphaTest 0, as in the render; a flags-only draw leaves out the pixels with alpha about 0', () => {
        const mat = new tp.GBufferMaterial(true)
        const src = new tp.PhysicalMaterial({map: new tp.Texture()}) // opaque: the render ignores the alpha of its map
        expect(draw(mat, new tp.Mesh(new tp.BoxGeometry(), src)).alphaTest).toBe(0)
        const overlay = new tp.MeshBasicMaterial({map: new tp.Texture(), transparent: true})
        mat.flagsOnlyMaterials = new Set([overlay])
        expect(draw(mat, new tp.Mesh(new tp.BoxGeometry(), overlay)).alphaTest).toBe(1e-4)
    })

    test('an inverted alpha map (userData.inverseAlphaMap) is inverted in the GBuffer too', () => {
        const mat = new tp.GBufferMaterial(true)
        const src = new tp.PhysicalMaterial({alphaMap: new tp.Texture(), alphaTest: 0.5})
        src.userData.inverseAlphaMap = true
        const mesh = new tp.Mesh(new tp.BoxGeometry(), src)
        mat.onBeforeRender(renderer, null, camera, undefined, mesh, null)
        expect(mat.defines.INVERSE_ALPHAMAP).toBe(1)
        mat.onAfterRender(renderer, null, camera, undefined, mesh, null)
        // not for the next object, nor without an alpha map
        mat.onBeforeRender(renderer, null, camera, undefined, new tp.Mesh(new tp.BoxGeometry(), new tp.PhysicalMaterial({alphaMap: new tp.Texture()})), null)
        expect(mat.defines.INVERSE_ALPHAMAP).toBe(undefined)
        const noMap = new tp.PhysicalMaterial()
        noMap.userData.inverseAlphaMap = true
        mat.onBeforeRender(renderer, null, camera, undefined, new tp.Mesh(new tp.BoxGeometry(), noMap), null)
        expect(mat.defines.INVERSE_ALPHAMAP).toBe(undefined)
    })

    test('a material array: each geometry group is drawn with the alpha of its own material', () => {
        const mat = new tp.GBufferMaterial(true)
        const map = new tp.Texture()
        const cut = new tp.PhysicalMaterial({map, alphaTest: 0.5})
        const opaque = new tp.PhysicalMaterial()
        const mesh = new tp.Mesh(new tp.BoxGeometry(), [cut, opaque])
        const groupState = (materialIndex: number) => {
            const group = {start: 0, count: 6, materialIndex}
            mat.onBeforeRender(renderer, null, camera, mesh.geometry, mesh, group)
            const s = [mat.defines.USE_MAP, mat.uniforms.map.value, mat.uniforms.alphaTest.value]
            mat.onAfterRender(renderer, null, camera, mesh.geometry, mesh, group)
            return s
        }
        expect(groupState(1)).toEqual([undefined, null, 0]) // the opaque group is not cut by the first material
        expect(groupState(0)).toEqual([1, map, 0.5])
        // a GBuffer material set on the object: the group of its own material array
        tp.iObjectCommons.upgradeObject3D.call(mesh)
        mesh.forcedOverrideMaterial = mat
        expect(groupState(1)).toEqual([undefined, null, 0])
        expect(groupState(0)).toEqual([1, map, 0.5])
    })

    test('each texture is read with its own UV set (Texture.channel)', () => {
        const mat = new tp.GBufferMaterial(true)
        const map = Object.assign(new tp.Texture(), {channel: 1})
        const alphaMap = Object.assign(new tp.Texture(), {channel: 2})
        mat.onBeforeRender(renderer, null, camera, undefined, new tp.Mesh(new tp.BoxGeometry(), new tp.PhysicalMaterial({map, alphaMap})), null)
        const d = mat.defines
        expect([d.MAP_UV, d.ALPHAMAP_UV, d.USE_UV1, d.USE_UV2, d.USE_UV3]).toEqual(['uv1', 'uv2', 1, 1, undefined])
    })
})
