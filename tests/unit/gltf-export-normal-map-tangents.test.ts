/**
 * glTF export of normal maps (Node). three.js r185 (#33837) bakes the sign of normalScale, and the green flip of meshes
 * without tangents, into a copy of the normal map. threepipe writes normalScale in its material extras instead, which
 * stop three-modded's GLTFLoader from negating normalScale.y on import, so GLTFWriter2 writes the map as it is.
 * GLTFWriter2 also passes the geometry of a mesh to three.js's processMaterialAsync.
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {BoxGeometry, BufferAttribute, Mesh, MeshStandardMaterial, Texture, Vector2} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

/**
 * Exports the mesh to glTF json with threepipe's material extras. The normal map has no image: the writer stores a
 * blob for it (as KTX2LoadPlugin does), so a copy of the map drawn through a 2D canvas would fail.
 */
async function exportJson(mesh: Mesh) {
    const writer = new tp.GLTFWriter2()
    writer.plugins.push(tp.GLTFMaterialExtrasExtension.Export(writer))
    writer.plugins.push({writeTexture: (map: Texture, textureDef: any) => {
        textureDef.source = writer.processImageBlob(new Blob([new Uint8Array([1, 2, 3, 4])], {type: 'image/png'}), map)
    }} as any)
    return new Promise<any>((resolve, reject) => {
        writer.writeAsync(mesh, resolve as any, {binary: false, exporterOptions: {}} as any).catch(reject)
    })
}

function withTangents(geometry: BoxGeometry) {
    geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 4), 4))
    return geometry
}

const extrasOf = (json: any) => json.materials[0].extensions?.[tp.GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension]

describe('glTF export of a normal map', () => {
    for (const [name, geometry] of [['with tangents', () => withTangents(new BoxGeometry())], ['without tangents', () => new BoxGeometry()]] as const) {
        for (const scale of [[1, 1], [1, -1], [-2, 2]]) {
            it(`is written as it is, with normalScale in the extras, on a mesh ${name} and normalScale ${scale}`, async() => {
                const normalMap = new Texture()
                const material = new MeshStandardMaterial({normalMap, normalScale: new Vector2(...scale)})
                const json = await exportJson(new Mesh(geometry(), material))
                expect(json.materials.length).toBe(1)
                expect(json.textures.length).toBe(1)
                expect(json.images.length).toBe(1)
                expect(json.materials[0].normalTexture.index).toBe(0)
                expect(extrasOf(json).normalScale).toEqual(scale)
            })
        }
    }

    it('writes no normalScale in the extras for a material without a normal map and the default scale', async() => {
        const json = await exportJson(new Mesh(new BoxGeometry(), new MeshStandardMaterial()))
        expect(extrasOf(json)?.normalScale).toBeUndefined()
    })
})
