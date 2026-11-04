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
        getContext: () => ({}),
        getRenderTarget: () => null,
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
    })
})
