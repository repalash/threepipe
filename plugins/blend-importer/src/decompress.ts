import {gunzipSync} from 'threepipe'
import {decompress as zstdDecompress} from 'fzstd'

type BlendCompression = 'none' | 'gzip' | 'zstd' | 'unknown'

/**
 * Detect compression of a .blend file by its first 4-7 bytes.
 * Mirrors Blender's own `BLO_file_reader_uncompressed` logic
 * (`source/blender/blenloader_core/intern/blo_core_file_reader.cc`).
 */
function detectBlendCompression(u8: Uint8Array): BlendCompression {
    // gzip needs 3 bytes, zstd 4, BLENDER literal 7 — check each at its own minimum.
    if (u8.length >= 3 && u8[0] === 0x1f && u8[1] === 0x8b && u8[2] === 0x08) return 'gzip'
    if (u8.length >= 4) {
        // zstd frame magic: 28 b5 2f fd (LE 0xFD2FB528)
        if (u8[0] === 0x28 && u8[1] === 0xb5 && u8[2] === 0x2f && u8[3] === 0xfd) return 'zstd'
        // zstd skippable frame magic: 50..5f 2a 4d 18 ((LE u32 >> 4) === 0x184D2A5)
        if ((u8[0] & 0xf0) === 0x50 && u8[1] === 0x2a && u8[2] === 0x4d && u8[3] === 0x18) return 'zstd'
    }
    if (u8.length >= 7 &&
        u8[0] === 0x42 && u8[1] === 0x4c && u8[2] === 0x45 && u8[3] === 0x4e &&
        u8[4] === 0x44 && u8[5] === 0x45 && u8[6] === 0x52) return 'none'
    return 'unknown'
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    // Short-circuit when the Uint8Array exactly spans its backing buffer
    // (the common case for fresh gunzipSync / fzstd.decompress allocations).
    if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) return u8.buffer as ArrayBuffer
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

/**
 * Decompress a `.blend` payload if needed and return a plain `ArrayBuffer`.
 * Returns the input unchanged for uncompressed files.
 *
 * Throws if the file magic is unrecognised, or if a decompressor produces
 * output too short to be a valid .blend header (which would otherwise hang
 * the downstream parser).
 */
export function decompressBlend(buf: ArrayBuffer): ArrayBuffer {
    const u8 = new Uint8Array(buf)
    const kind = detectBlendCompression(u8)
    if (kind === 'none') return buf
    let out: ArrayBuffer
    if (kind === 'gzip') out = toArrayBuffer(gunzipSync(u8))
    else if (kind === 'zstd') out = toArrayBuffer(zstdDecompress(u8))
    else {
        const hex = [u8[0], u8[1], u8[2], u8[3]].map(b => (b ?? 0).toString(16).padStart(2, '0')).join(' ')
        throw new Error(`BlendLoadPlugin: unrecognised file magic (first 4 bytes: ${hex}). Expected 'BLENDER' literal, gzip, or zstd.`)
    }
    // Parser reads the BLENDER-v### header (12 bytes) unconditionally; reject
    // truncated/malformed decompressor output here so parseBlend doesn't throw
    // a RangeError inside its sync onmessage handler (which would never resolve).
    if (out.byteLength < 12) {
        throw new Error(`BlendLoadPlugin: ${kind} decompression produced ${out.byteLength} bytes, too short to be a valid .blend file.`)
    }
    return out
}
