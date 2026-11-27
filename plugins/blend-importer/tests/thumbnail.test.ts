/**
 * `readBlendThumbnail` reads the preview from the start of a file, before the full parse. It must give the
 * same image the full parse gives (`blend.thumbnail`), from the whole file or from its first
 * BLEND_THUMBNAIL_BYTES, uncompressed, gzip or zstd, and null when the preview isn't in the bytes it got.
 */
import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {fixturePath, loadBlend} from './fixtures'
import {BLEND_THUMBNAIL_BYTES, readBlendThumbnail} from '../src/thumbnail'

const FILES = [
    ['default-cube.blend', 'uncompressed'],
    ['hexgrid_blender_geometry_nodes_demo.blend', 'gzip'],
    ['jiggly_pudding.blend', 'zstd'],
    // the default cube re-saved by Blender 5.3 (17-byte header, 32-byte block headers)
    ['default-cube-blender-5.3.blend', 'Blender 5.x, uncompressed'],
    ['default-cube-blender-5.3-zstd.blend', 'Blender 5.x, zstd'],
] as const

for (const [name, kind] of FILES) {
    const path = fixturePath(name)
    describe.skipIf(!path)(`${name} (${kind})`, () => {
        it('gives the preview the full parse gives, from the whole file and from its start', async() => {
            const bytes = new Uint8Array(readFileSync(path!))
            const full = (await loadBlend(path!)).thumbnail
            expect(full).toBeTruthy()
            for (const input of [bytes, bytes.slice(0, BLEND_THUMBNAIL_BYTES), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + BLEND_THUMBNAIL_BYTES)]) {
                const thumb = readBlendThumbnail(input)!
                expect(thumb).toBeTruthy()
                expect([thumb.width, thumb.height]).toEqual([full.width, full.height])
                expect(Array.from(thumb.data)).toEqual(Array.from(full.data))
            }
        })

        it('is null when the preview is not in the bytes it got', () => {
            const bytes = new Uint8Array(readFileSync(path!))
            expect(readBlendThumbnail(bytes.slice(0, 16))).toBeNull()
            expect(readBlendThumbnail(bytes.slice(0, 256))).toBeNull()
        })
    })
}

describe('not a .blend', () => {
    it('is null', () => {
        expect(readBlendThumbnail(new TextEncoder().encode('not a blend file at all, just some text'))).toBeNull()
        expect(readBlendThumbnail(new Uint8Array(0))).toBeNull()
    })
})
