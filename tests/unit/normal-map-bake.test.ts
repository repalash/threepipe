/**
 * bakeNormalScaleSign and the bakeNormalScale export option (Node). Node has no 2D canvas, so a stub canvas holds the
 * pixels of a 2x1 normal map.
 */
import {afterEach, beforeAll, describe, expect, it} from 'vitest'
import {BoxGeometry, CompressedTexture, Mesh, MeshStandardMaterial, Texture, Vector2} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

const pixels = () => new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
let written: Uint8ClampedArray | undefined
const g = globalThis as any
class StubCanvas {
    width = 0
    height = 0
    getContext() {
        return {
            drawImage: () => {}, translate: () => {}, scale: () => {},
            getImageData: () => ({data: pixels()}),
            putImageData: (d: {data: Uint8ClampedArray}) => {written = d.data},
        }
    }
    toDataURL() {return 'data:image/png;base64,AA'}
    toBlob(cb: (b: Blob) => void) {cb(new Blob([new Uint8Array([1, 2, 3, 4])], {type: 'image/png'}))}
}
function stubCanvas() {
    written = undefined
    g.document = {createElement: () => new StubCanvas()}
    g.HTMLCanvasElement = StubCanvas
}
afterEach(() => {
    delete g.document
    delete g.HTMLCanvasElement
})

function material(scale: [number, number]) {
    const map = new Texture({width: 2, height: 1} as any)
    map.userData.rootPath = 'https://example.com/normal.png'
    return new MeshStandardMaterial({normalMap: map, normalScale: new Vector2(...scale)})
}

describe('bakeNormalScaleSign', () => {
    it('inverts the green channel and makes normalScale.y negative on meshes without tangents', () => {
        stubCanvas()
        const m = material([2, 2])
        const map = m.normalMap!
        expect(tp.bakeNormalScaleSign(m)).toBe(true)
        expect(m.normalMap).not.toBe(map)
        expect(m.normalMap!.userData.rootPath).toBeUndefined()
        expect([...written!]).toEqual([10, 235, 30, 255, 40, 205, 60, 255])
        expect(m.normalScale.toArray()).toEqual([2, -2])
        expect(tp.bakeNormalScaleSign(m)).toBe(false) // already baked
    })

    it('inverts the red channel for a negative normalScale.x, and green for a negative y with tangents', () => {
        stubCanvas()
        const m = material([-1, -1])
        expect(tp.bakeNormalScaleSign(m, true)).toBe(true)
        expect([...written!]).toEqual([245, 235, 30, 255, 215, 205, 60, 255])
        expect(m.normalScale.toArray()).toEqual([1, 1])
    })

    it('changes nothing for a glTF map, or a compressed one', () => {
        stubCanvas()
        const m = material([1, -1])
        const map = m.normalMap
        expect(tp.bakeNormalScaleSign(m)).toBe(false)
        expect(m.normalMap).toBe(map)
        const c = new MeshStandardMaterial({normalMap: new CompressedTexture([], 2, 1), normalScale: new Vector2(1, 1)})
        expect(tp.bakeNormalScaleSign(c)).toBe(false)
        expect(c.normalScale.toArray()).toEqual([1, 1])
        expect(written).toBeUndefined()
    })
})

async function exportJson(mesh: Mesh, bakeNormalScale?: boolean, binary = false) {
    const writer = new tp.GLTFWriter2()
    writer.plugins.push(tp.GLTFMaterialExtrasExtension.Export(writer))
    writer.plugins.push({writeTexture: (map: Texture, textureDef: any) => {
        textureDef.source = writer.processImageBlob(new Blob([new Uint8Array([1, 2, 3, 4])], {type: 'image/png'}), map)
    }} as any)
    return new Promise<any>((resolve, reject) => {
        writer.writeAsync(mesh, resolve as any, {binary, exporterOptions: {bakeNormalScale}} as any).catch(reject)
    }).then(res => binary ? JSON.parse(new TextDecoder().decode(new Uint8Array(res, 20, new DataView(res).getUint32(12, true)))) : res)
}
const extrasOf = (json: any) => json.materials[0].extensions[tp.GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension]

describe('bakeNormalScale export option', () => {
    it('is off by default: the map is written as it is', async() => {
        stubCanvas()
        const json = await exportJson(new Mesh(new BoxGeometry(), material([1, 1])))
        expect(written).toBeUndefined()
        expect(extrasOf(json).normalScale).toEqual([1, 1])
    })

    it('bakes the map as three.js does, and writes the matching normalScale in the extras', async() => {
        stubCanvas()
        const json = await exportJson(new Mesh(new BoxGeometry(), material([1, 1])), true)
        expect([...written!]).toEqual([10, 235, 30, 255, 40, 205, 60, 255])
        expect(extrasOf(json).normalScale).toEqual([1, -1])
    })

    it('embeds the baked copy of a map that has a url, not the url of the original', async() => {
        stubCanvas()
        const json = await exportJson(new Mesh(new BoxGeometry(), material([1, 1])), true, true)
        expect(json.images[0].bufferView).toBeDefined()
        expect(json.images[0].uri).toBeUndefined()
    })

    it('writes a map baked with bakeNormalScaleSign as it is', async() => {
        stubCanvas()
        const m = material([1, 1])
        tp.bakeNormalScaleSign(m)
        written = undefined
        const json = await exportJson(new Mesh(new BoxGeometry(), m), true)
        expect(written).toBeUndefined()
        expect(extrasOf(json).normalScale).toEqual([1, -1])
    })
})
