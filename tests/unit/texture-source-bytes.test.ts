/**
 * Unit tests for the preserved source bytes of textures (Node) -
 * TextureLoader2 capture, AssetImporter source blob/buffer and the GLTFWriter2 export fast path.
 */
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {LoadingManager, Texture} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('TextureLoader2', () => {
    // `<img>` that loads on the next task once src is set
    function mockImage() {
        const image: any = {}
        Object.defineProperty(image, 'src', {
            set(v: string) {
                this._src = v
                setTimeout(() => this.onload?.(), 0)
            },
        })
        vi.spyOn(document, 'createElement').mockReturnValue(image)
        return image
    }
    const mockFetch = () => {
        const fetch = vi.fn(async() => new Response(bytes.slice().buffer, {status: 200}))
        vi.stubGlobal('fetch', fetch)
        // used by FileLoader to report progress, not available in node
        vi.stubGlobal('ProgressEvent', class {
            constructor(public type: string, init: any) {
                Object.assign(this, init)
            }
        })
        return fetch
    }

    it('keeps the source bytes when enabled', async() => {
        const image = mockImage()
        const fetch = mockFetch()
        const order: string[] = []
        const manager = new LoadingManager(() => order.push('manager'))
        const loader = new tp.TextureLoader2(manager)
        loader.saveSourceBlobs = true

        const texture = await new Promise<Texture>((resolve, reject) => loader.load('https://example.com/a.png', (t) => {
            order.push('texture')
            resolve(t)
        }, undefined, reject))
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(texture.image).toBe(image)
        expect(image._src.startsWith('blob:')).toBe(true)
        expect(new Uint8Array((texture.source as any)._sourceImgBuffer)).toEqual(bytes)
        expect(texture.userData.mimeType).toBe('image/png')
        expect(texture.userData.rootPath).toBe('https://example.com/a.png')
        // the manager must not report the load as complete before the image is decoded
        expect(order).toEqual(['texture', 'manager'])
    })

    it('uses the three.js TextureLoader when disabled or when the url cannot be captured', () => {
        const fetch = mockFetch()
        const loader = new tp.TextureLoader2()
        expect(tp.TextureLoader2.SAVE_SOURCE_BLOBS).toBe(false)
        expect(loader.load('https://example.com/a.png')).toBeInstanceOf(Texture)

        loader.saveSourceBlobs = true
        loader.load('blob:https://example.com/uuid')
        loader.load('data:image/png;base64,AAAA')
        loader.load('https://example.com/image-without-extension')
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('AssetImporter.processRaw', () => {
    it('sets the source blob and buffer on the asset, not in userData', async() => {
        const importer = new tp.AssetImporter()
        const file = new Blob([bytes], {type: 'image/png'})
        const texture: any = new Texture()
        texture.__rootBlob = file
        texture.__needsSourceBuffer = true

        await importer.processRaw(texture, {})

        expect(texture.__sourceBlob).toBe(file)
        expect(new Uint8Array(texture.__sourceBuffer)).toEqual(bytes)
        expect(texture.__needsSourceBuffer).toBeUndefined()
        expect(texture.userData.__sourceBlob).toBeUndefined()
        expect(texture.userData.__sourceBuffer).toBeUndefined()

        const texture2: any = new Texture()
        texture2.__rootBlob = file
        await importer.processRaw(texture2, {})
        expect(texture2.__sourceBlob).toBe(file)
        expect(texture2.__sourceBuffer).toBeUndefined()
    })
})

describe('GLTFWriter2.processTexture source bytes fast path', () => {
    function process(props: {flipY?: boolean, mimeType?: string, buffer?: boolean, size?: number, rootPath?: string}, options: any = {}) {
        const {flipY = false, mimeType = 'image/png', buffer = true, size = 64, rootPath} = props
        const texture = new Texture({width: size, height: size} as any)
        texture.flipY = flipY
        texture.userData.mimeType = mimeType
        if (rootPath) texture.userData.rootPath = rootPath
        if (buffer) (texture.source as any)._sourceImgBuffer = bytes

        const writer = new tp.GLTFWriter2()
        writer.options = {maxTextureSize: Infinity, ...options, exporterOptions: {...options.exporterOptions}} as any
        const blobs: Blob[] = []
        vi.spyOn(writer, 'processImageBlob').mockImplementation((blob: Blob) => {
            blobs.push(blob)
            return (writer as any).json.images.push({}) - 1
        })
        ;(writer as any).json.images = []
        // canvas path of the three.js exporter
        const canvas = vi.spyOn(Object.getPrototypeOf(tp.GLTFWriter2.prototype), 'processTexture').mockImplementation(function(this: any) {
            this.json.textures = this.json.textures || []
            return this.json.textures.push({source: this.json.images.push({}) - 1}) - 1
        })
        canvas.mockClear()
        const index = writer.processTexture(texture)
        return {index, blobs, canvas: canvas.mock.calls.length, json: (writer as any).json, texture}
    }

    it('writes the source bytes as is', () => {
        const {index, blobs, canvas, json, texture} = process({})
        expect(canvas).toBe(0)
        expect(blobs.length).toBe(1)
        expect(blobs[0].type).toBe('image/png')
        expect(blobs[0].size).toBe(bytes.length)
        expect(json.textures[index].source).toBe(0)
        expect(json.images[0].extras).toEqual({uuid: texture.source.uuid, t_uuid: texture.uuid})

        expect(process({mimeType: 'image/jpg'}).blobs[0].type).toBe('image/jpeg')
        // embedded even when the texture has a url
        expect(process({rootPath: 'https://example.com/a.png'}, {exporterOptions: {embedUrlImages: true}}).blobs.length).toBe(1)
    })

    it('uses the canvas when the source bytes cannot be written as is', () => {
        const canvasOnly = {blobs: 0, canvas: 1}
        const run = (...args: Parameters<typeof process>) => {
            const r = process(...args)
            return {blobs: r.blobs.length, canvas: r.canvas}
        }
        expect(run({buffer: false})).toEqual(canvasOnly)
        // flipY textures are flipped on the canvas, glTF images are not flipped
        expect(run({flipY: true})).toEqual(canvasOnly)
        // larger images are resized on the canvas
        expect(run({size: 64}, {maxTextureSize: 32})).toEqual(canvasOnly)
        expect(run({size: 64}, {maxTextureSize: 64})).toEqual({blobs: 1, canvas: 0})
        // only jpeg and png
        expect(run({mimeType: 'image/webp'})).toEqual(canvasOnly)
        // exported as a url reference
        expect(run({rootPath: 'https://example.com/a.png'})).toEqual(canvasOnly)
    })
})
