import {Gunzip} from 'fflate'
import {Decompress as ZstdDecompress} from 'fzstd'

/**
 * The preview image Blender saves at the start of a `.blend` (the `TEST` block): RGBA8, one pixel per
 * `Uint32`, rows bottom-up. The same shape as `blend.thumbnail` from a full load. Usually 128×128.
 */
export interface BlendThumbnail {
    width: number
    height: number
    data: Uint32Array
}

/**
 * How many bytes from the start of a `.blend` to give {@link readBlendThumbnail}: enough for the preview in
 * any file, uncompressed, gzip (Blender 2.x) or zstd (Blender 3.0+). The preview is written right after the
 * header and the scene names (REND blocks), and a 128×128 one is 64 KB of file data, so an uncompressed
 * file needs ~66 KB. Compressed it needs less, but a zstd decoder only gives out whole blocks of up to
 * 128 KB of file data, so a file whose first block barely compresses could need ~130 KB. Measured on 14
 * files (Blender 2.66 to 4.x): 35-64 KB uncompressed, 18-23 KB gzip, 5-29 KB zstd.
 */
export const BLEND_THUMBNAIL_BYTES = 256 * 1024

const CHUNK = 16 * 1024

/**
 * Reads only the preview image from the start of a `.blend`, without parsing the file: to show it while
 * the full load runs. `bytes` can be the whole file or its first {@link BLEND_THUMBNAIL_BYTES} (an HTTP
 * Range request, or `file.slice(0, BLEND_THUMBNAIL_BYTES)`): uncompressed, gzip or zstd. Decompresses only
 * as much as it needs and stops at the preview, so the whole file costs no more than its start.
 *
 * Returns null when the file has no preview (saved without one, or by Blender older than 2.5), when it
 * isn't a `.blend`, or when the preview isn't within `bytes`.
 *
 * ```ts
 * const res = await fetch(url, {headers: {Range: `bytes=0-${BLEND_THUMBNAIL_BYTES - 1}`}})
 * const thumbnail = readBlendThumbnail(await res.arrayBuffer())
 * if (thumbnail) ctx.putImageData(blendThumbnailImageData(thumbnail), 0, 0)
 * ```
 */
export function readBlendThumbnail(bytes: ArrayBuffer | Uint8Array): BlendThumbnail | null {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    if (isGzip(input)) return readStream(input, (onData) => new Gunzip((chunk) => onData(chunk)))
    if (isZstd(input)) return readStream(input, (onData) => new ZstdDecompress((chunk) => onData(chunk)))
    const found = scan(input)
    return found === 'more' ? null : found
}

/**
 * A {@link BlendThumbnail} as `ImageData`, rows top-down, for `putImageData` or `createImageBitmap`.
 */
export function blendThumbnailImageData(thumbnail: BlendThumbnail): ImageData {
    const {width, height, data} = thumbnail
    const bytes = new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4)
    const image = new ImageData(width, height)
    const row = width * 4
    for (let y = 0; y < height; y++) image.data.set(bytes.subarray((height - 1 - y) * row, (height - y) * row), y * row)
    return image
}

function isGzip(b: Uint8Array) {
    return b.length >= 3 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08
}

function isZstd(b: Uint8Array) {
    if (b.length < 4) return false
    if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return true
    // a skippable frame first (50..5f 2a 4d 18)
    return (b[0] & 0xf0) === 0x50 && b[1] === 0x2a && b[2] === 0x4d && b[3] === 0x18
}

// Feed the compressed bytes in chunks, collect what comes out, and stop once the preview is found or known
// to be missing. A truncated stream (the start of a file) just stops producing output.
function readStream(input: Uint8Array, make: (onData: (chunk: Uint8Array) => void) => {push(chunk: Uint8Array, final?: boolean): void}): BlendThumbnail | null {
    let out = new Uint8Array(CHUNK * 8)
    let length = 0
    let found: BlendThumbnail | null | 'more' = 'more'
    const stream = make((chunk) => {
        if (found !== 'more') return
        if (length + chunk.length > out.length) {
            const bigger = new Uint8Array(Math.max(out.length * 2, length + chunk.length))
            bigger.set(out.subarray(0, length))
            out = bigger
        }
        out.set(chunk, length)
        length += chunk.length
        found = scan(out.subarray(0, length))
    })
    try {
        for (let at = 0; at < input.length && found === 'more'; at += CHUNK) stream.push(input.subarray(at, Math.min(at + CHUNK, input.length)), false)
    } catch {
        // corrupt data, or a decoder that minds the stream ending early: whatever came out was scanned
    }
    return found === 'more' ? null : found
}

// The start of an uncompressed `.blend`: its header, then blocks. The preview is the TEST block, after the
// REND blocks (scene names) and before everything else (`BLO_write_file`). 'more': not enough bytes yet.
function scan(b: Uint8Array): BlendThumbnail | null | 'more' {
    if (b.length < 17) return 'more'
    if (String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6]) !== 'BLENDER') return null
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    let offset: number, header: number, lenAt: number, large = false
    const format = String.fromCharCode(b[7])
    if (format === '_' || format === '-') {
        // 'BLENDER' + pointer size ('_' 4, '-' 8) + endianness ('v' little, 'V' big) + version: 12 bytes
        if (String.fromCharCode(b[8]) !== 'v') return null // big-endian: not supported, as in the parser
        const pointer = format === '_' ? 4 : 8
        offset = 12
        header = 16 + pointer // code, len (i32), old pointer, SDNAnr, nr
        lenAt = 4
    } else if (String.fromCharCode(b[7], b[8]) === '17') {
        // Blender 5.0+: 'BLENDER17-01v0500', then LargeBHead8: code, SDNAnr, old (u64), len (i64), nr (i64)
        offset = 17
        header = 32
        lenAt = 16
        large = true
    } else return null
    for (;;) {
        if (offset + header > b.length) return 'more'
        const code = String.fromCharCode(b[offset], b[offset + 1], b[offset + 2], b[offset + 3])
        const len = large ? Number(dv.getBigInt64(offset + lenAt, true)) : dv.getInt32(offset + lenAt, true)
        if (!(len >= 0)) return null
        if (code === 'TEST') {
            const start = offset + header
            if (start + 8 > b.length) return 'more'
            const width = dv.getInt32(start, true), height = dv.getInt32(start + 4, true)
            const pixels = width * height
            if (!(width > 0 && height > 0) || 8 + pixels * 4 > len) return null
            if (start + 8 + pixels * 4 > b.length) return 'more'
            // a copy: a view would keep the caller's whole buffer alive
            const data = new Uint32Array(pixels)
            new Uint8Array(data.buffer).set(b.subarray(start + 8, start + 8 + pixels * 4))
            return {width, height, data}
        }
        if (code !== 'REND') return null // past where Blender writes the preview
        offset += header + len
    }
}
