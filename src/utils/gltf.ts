import type {BlobExt} from '../assetmanager'

/**
 * Returns a buffer aligned to 4-byte boundary.
 * https://github.com/mrdoob/three.js/blob/4dbd0065f2ec29b89c250d8582f61e9f4792e077/examples/jsm/exporters/GLTFExporter.js#L381
 * @param arrayBuffer Buffer to pad
 * @param paddingByte (Optional)
 * @returns The same buffer if it's already aligned to 4-byte boundary or a new buffer
 */
function getPaddedArrayBuffer(arrayBuffer: Uint8Array<ArrayBuffer>, paddingByte = 0): ArrayBuffer {
    const paddedLength = getPaddedBufferSize(arrayBuffer.byteLength)
    if (paddedLength !== arrayBuffer.byteLength) {
        const array = new Uint8Array(paddedLength)
        array.set(new Uint8Array(arrayBuffer))
        if (paddingByte !== 0) {
            for (let i = arrayBuffer.byteLength; i < paddedLength; i++) {
                array[ i ] = paddingByte
            }
        }
        return array.buffer
    }
    return arrayBuffer.buffer
}


/**
 * Get the required size + padding for a buffer, rounded to the next 4-byte boundary.
 * https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment
 *
 * @param bufferSize The size the original buffer.
 * @returns new buffer size with required padding.
 *
 */
function getPaddedBufferSize(bufferSize: number) {

    return Math.ceil(bufferSize / 4) * 4

}



// GLB constants
// https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

const GLB_HEADER_BYTES = 12
const GLB_HEADER_MAGIC = 0x46546C67
const GLB_VERSION = 2

const GLB_CHUNK_PREFIX_BYTES = 8
const GLB_CHUNK_TYPE_JSON = 0x4E4F534A
const GLB_CHUNK_TYPE_BIN = 0x004E4942

// https://github.com/mrdoob/three.js/blob/4dbd0065f2ec29b89c250d8582f61e9f4792e077/examples/jsm/exporters/GLTFExporter.js#L558
export function makeGLBFile(buffers: Uint8Array<ArrayBuffer>, json: any): BlobExt {
    // Binary chunk.
    const binaryChunk = getPaddedArrayBuffer(buffers)
    const binaryChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES))
    binaryChunkPrefix.setUint32(0, binaryChunk.byteLength, true)
    binaryChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_BIN, true)

    // JSON chunk.
    const buffer1 = new TextEncoder().encode(JSON.stringify(json || {})) as Uint8Array<ArrayBuffer>
    const jsonChunk = getPaddedArrayBuffer(buffer1, 0x20)
    const jsonChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES))
    jsonChunkPrefix.setUint32(0, jsonChunk.byteLength, true)
    jsonChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_JSON, true)

    // GLB header.
    const header = new ArrayBuffer(GLB_HEADER_BYTES)
    const headerView = new DataView(header)
    headerView.setUint32(0, GLB_HEADER_MAGIC, true)
    headerView.setUint32(4, GLB_VERSION, true)
    const totalByteLength = GLB_HEADER_BYTES
        + jsonChunkPrefix.byteLength + jsonChunk.byteLength
        + binaryChunkPrefix.byteLength + binaryChunk.byteLength
    headerView.setUint32(8, totalByteLength, true)

    const glbBlob: BlobExt = new Blob([
        header,
        jsonChunkPrefix,
        jsonChunk,
        binaryChunkPrefix,
        binaryChunk,
    ], {type: 'model/gltf+binary'}) as any
    glbBlob.ext = 'glb'
    return glbBlob
}
