/**
 * The same object exported twice gives the same glb file, whatever order its images finish encoding in (Node).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {BoxGeometry, Mesh, MeshStandardMaterial, Texture} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

// The images are given to the writer as blobs (like KTX2LoadPlugin does). The mime types differ so each is its own image.
const images = [
    {type: 'image/png', bytes: [1, 2, 3]}, // not a multiple of 4, gets padded
    {type: 'image/jpeg', bytes: [4, 5, 6, 7, 8, 9, 10, 11]},
    {type: 'image/webp', bytes: [12, 13, 14, 15, 16]},
]

const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({map: new Texture(), normalMap: new Texture(), emissiveMap: new Texture()}))
const textures = [mesh.material.map!, mesh.material.normalMap!, mesh.material.emissiveMap!]

/**
 * Exports the mesh to glb, with the data of image i arriving after delays[i] ms
 */
async function exportGlb(delays: number[]) {
    const writer = new tp.GLTFWriter2()
    const blobs = new Map(textures.map((t, i) => {
        const blob = new Blob([new Uint8Array(images[i].bytes)], {type: images[i].type})
        const arrayBuffer = blob.arrayBuffer.bind(blob)
        blob.arrayBuffer = async() => {
            await new Promise(resolve => setTimeout(resolve, delays[i]))
            return arrayBuffer()
        }
        return [t, blob]
    }))
    writer.plugins.push({writeTexture: (map: Texture, textureDef: any) => {
        textureDef.source = writer.processImageBlob(blobs.get(map)!, map)
    }} as any)
    return new Promise<Uint8Array>((resolve) => {
        writer.write(mesh, (glb) => resolve(new Uint8Array(glb as ArrayBuffer)), {binary: true, exporterOptions: {}} as any)
    })
}

function glbJson(glb: Uint8Array) {
    const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true)
    return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)))
}

describe('glb export', () => {
    it('writes the same file whatever order the images finish in', async() => {
        const first = await exportGlb([30, 15, 0]) // finish in reverse order
        const second = await exportGlb([0, 15, 30])
        const third = await exportGlb([15, 0, 30])
        expect(second).toEqual(first)
        expect(third).toEqual(first)
    })

    it('stores each image in its own 4-byte aligned bufferView, in the order of the images', async() => {
        const glb = await exportGlb([30, 15, 0])
        const json = glbJson(glb)
        const binStart = 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true) + 8
        expect(json.images.length).toBe(images.length)
        let previousOffset = -1
        for (const imageDef of json.images) {
            const bytes = images.find(i => i.type === imageDef.mimeType)!.bytes
            const view = json.bufferViews[imageDef.bufferView]
            expect(view.byteOffset % 4).toBe(0)
            expect(view.byteOffset).toBeGreaterThan(previousOffset)
            expect(view.byteLength).toBe(Math.ceil(bytes.length / 4) * 4)
            expect([...glb.subarray(binStart + view.byteOffset, binStart + view.byteOffset + bytes.length)]).toEqual(bytes)
            previousOffset = view.byteOffset
        }
    })
})
