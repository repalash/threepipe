import {BufferGeometry, Loader} from 'three'

/**
 * Type declaration for the vendored pure-JS Draco decoder ({@link DRACOLoader.js}).
 * Mirrors the subset of three.js's DRACOLoader API that draco.js implements.
 */
export class DRACOLoader extends Loader {
    decodeGeometry(buffer: ArrayBuffer, taskConfig: any): Promise<BufferGeometry>
    decodeDracoFile(
        buffer: ArrayBuffer,
        callback?: (geometry: BufferGeometry) => void,
        attributeIDs?: Record<string, string> | null,
        attributeTypes?: Record<string, string> | null,
        vertexColorSpace?: any,
        onError?: (err: any) => void,
    ): Promise<BufferGeometry>
    parse(buffer: ArrayBuffer, onLoad: (geometry: BufferGeometry) => void, onError?: (err: any) => void): void
    preload(): this
    dispose(): this
    /** no-op — pure JS, no decoder path to configure. Accepted for drop-in compatibility. */
    setDecoderPath(path?: string): this
    /** no-op — pure JS, no wasm/js config. Accepted for drop-in compatibility. */
    setDecoderConfig(config?: any): this
    /** no-op — pure JS, decode runs on the main thread (no worker pool). */
    setWorkerLimit(limit?: number): this
}
