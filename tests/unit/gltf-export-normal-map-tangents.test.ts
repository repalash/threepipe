/**
 * GLTFWriter2 passes the geometry of a mesh to three.js's processMaterialAsync (Node). Since three.js r185 (#33837)
 * the exporter inverts the green channel of a normal map when the geometry has no tangents and normalScale.y > 0, so
 * without the geometry every normal map was treated as on a mesh without tangents.
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {BoxGeometry, BufferAttribute, Mesh, MeshStandardMaterial, Texture} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

/**
 * Exports the mesh to glTF json. The normal map has no image: the writer stores a blob for it (as KTX2LoadPlugin
 * does), and a normal map that three.js would invert (through a 2D canvas) fails.
 */
async function exportJson(mesh: Mesh) {
    const writer = new tp.GLTFWriter2()
    writer.plugins.push({writeTexture: (map: Texture, textureDef: any) => {
        textureDef.source = writer.processImageBlob(new Blob([new Uint8Array([1, 2, 3, 4])], {type: 'image/png'}), map)
    }} as any)
    return new Promise<any>((resolve, reject) => {
        writer.writeAsync(mesh, resolve as any, {binary: false, exporterOptions: {}} as any).catch(reject)
    })
}

describe('glTF export of a normal map', () => {
    it('is written as it is on a mesh with tangents and a positive normalScale', async() => {
        const geometry = new BoxGeometry()
        geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 4), 4))
        const material = new MeshStandardMaterial({normalMap: new Texture()})
        const json = await exportJson(new Mesh(geometry, material))
        expect(json.materials.length).toBe(1)
        expect(json.materials[0].normalTexture.index).toBe(0)
        expect(json.materials[0].normalTexture.scale).toBeUndefined()
        expect(json.images.length).toBe(1)
    })
})
