import {BufferGeometry, DRACOLoader2} from 'threepipe'
import type {DRACOLoader as DracoJSDRACOLoader} from './dracojs/DRACOLoader.js'

/**
 * Drop-in import-decode replacement for {@link DRACOLoader2} that decodes Draco meshes with the
 * pure-JS {@link https://github.com/mrdoob/draco.js | draco.js} decoder (no wasm, no worker, no
 * CDN fetch) — and transparently **falls back to the WASM decoder** for anything draco.js can't
 * handle (point clouds, bitstreams older than Draco 2.2, or any decode error).
 *
 * Why this shape:
 * - It **extends {@link DRACOLoader2}**, so it inherits the encoder ({@link DRACOLoader2.initEncoder}
 *   — draco.js cannot encode), the `.drc` → {@link Mesh} `transform()`, `initDecoder`, the
 *   `isDRACOLoader2` marker, and the WASM `decodeGeometry` used as the fallback. Only the decode
 *   entry point is overridden.
 * - The pure-JS decoder is **lazy-loaded via dynamic `import()`** ({@link loadDecoderModule}), so
 *   the decoder (~24 KB minified + gzip) stays out of the initial bundle/parse until Draco decoding
 *   actually happens. The WASM fallback only initialises if/when a buffer needs it, so the common
 *   (glTF mesh) path pays zero wasm/worker cost.
 *
 * This is the engine behind {@link DracoJSDecodePlugin}, which is the opt-in way to enable it.
 * The WASM {@link DRACOLoader2} remains the default decoder and the export encoder.
 */
export class DRACOLoader2Pure extends DRACOLoader2 {
    readonly isDRACOLoader2Pure = true

    /**
     * When draco.js fails to decode a buffer (unsupported stream or error), fall back to the WASM
     * decoder so nothing breaks. Disable only to measure/inspect the pure-JS path in isolation.
     * @default true
     */
    static EnableFallback = true
    /** Log a warning when a fallback to WASM happens. @default true */
    static LogFallback = true
    /** Number of times any instance has fallen back to the WASM decoder. Diagnostics/tests. */
    static fallbackCount = 0

    /** Cached dynamic import of the pure-JS decoder module, shared across all instances. */
    private static _modPending?: Promise<typeof import('./dracojs/DRACOLoader.js')>

    /**
     * Lazily load the draco.js decoder module via dynamic `import()`. The decoder is only
     * fetched/parsed the first time this is called, keeping it out of the initial bundle. Safe to
     * call repeatedly (cached). Call it ahead of a load (e.g. when the plugin is added) to warm it
     * so the first decode doesn't stall on the import.
     */
    static loadDecoderModule(): Promise<typeof import('./dracojs/DRACOLoader.js')> {
        if (!this._modPending) this._modPending = import('./dracojs/DRACOLoader.js')
        return this._modPending
    }

    /** The pure-JS decoder instance (constructed on first decode). Decodes on the main thread. */
    protected _js?: DracoJSDRACOLoader

    /** Set to true once a fallback to the WASM decoder has occurred on this instance (diagnostics). */
    public didFallback = false

    protected async _getJs(): Promise<DracoJSDRACOLoader> {
        if (!this._js) {
            const mod = await DRACOLoader2Pure.loadDecoderModule()
            const js = new mod.DRACOLoader()
            // draco.js is written against a newer three.js than the one threepipe uses, its sRGB vertex color
            // conversion (used for standalone .drc files) calls `ColorManagement.colorSpaceToWorking` which is
            // not available here. Use the conversion of the three.js DRACOLoader this class extends, which is
            // also what the WASM path does. (Not declared in @types/three's DRACOLoader, hence the cast)
            js._assignVertexColorSpace = (attribute, inputColorSpace) => (this as any)._assignVertexColorSpace(attribute, inputColorSpace)
            this._js = js
        }
        return this._js
    }

    /**
     * Override the inherited `preload()` (which `GLTFLoader` calls) so it warms the pure-JS decoder
     * instead of eagerly spawning the WASM worker + fetching `draco_decoder.wasm`. The WASM decoder
     * only initialises lazily if a decode actually falls back to it — so the common path pays no
     * wasm fetch/worker cost. The encoder is not affected, it is preloaded same as {@link DRACOLoader2}.
     */
    override preload(decoder = true, encoder = false): this {
        if (decoder) DRACOLoader2Pure.loadDecoderModule().catch(() => {/* decode-time fallback handles failures */})
        if (encoder) this.initEncoder()
        return this
    }

    /**
     * Returns true only for streams draco.js decodes: a **triangular mesh in Draco bitstream
     * version 2.2** (what current Draco encoders and glTF exporters write) — with EdgeBreaker or
     * sequential connectivity, with or without metadata (draco.js parses and discards metadata, the
     * WASM path does not surface it on the geometry either). Read straight from the Draco header
     * (see {@link https://github.com/google/draco | Draco} bitstream: `"DRACO"` magic, then version
     * major @ byte 5 and minor @ byte 6, `encoderType` @ byte 7).
     *
     * Point clouds (sequential and KD-tree) and meshes in older bitstream versions are not
     * implemented in draco.js. It rejects them with an error (which the fallback in
     * {@link decodeGeometry} would also catch), this check routes them straight to the WASM decoder.
     */
    static isJsDecodable(buffer: ArrayBuffer): boolean {
        const b = new Uint8Array(buffer)
        if (b.length < 11) return false
        if (b[0] !== 0x44 || b[1] !== 0x52 || b[2] !== 0x41 || b[3] !== 0x43 || b[4] !== 0x4F) return false // "DRACO"
        if (b[5] !== 2 || b[6] !== 2) return false // mesh bitstream version must be 2.2 — older ones are rejected by draco.js
        if (b[7] !== 1) return false // encoderType must be TRIANGULAR_MESH (1) — not POINT_CLOUD
        return true
    }

    // Note: `decodeGeometry` is not declared on @types/three's DRACOLoader (incomplete community
    // types), so this is typed as a fresh method rather than an `override`. At runtime it shadows
    // the inherited three.js DRACOLoader.decodeGeometry.
    decodeGeometry(buffer: ArrayBuffer, taskConfig: any): Promise<BufferGeometry> {
        if (DRACOLoader2Pure.EnableFallback && !DRACOLoader2Pure.isJsDecodable(buffer)) {
            // Stream that draco.js does not implement — go straight to WASM.
            return this._fallback(buffer, taskConfig, 'unsupported Draco stream (not a triangle mesh in Draco bitstream version 2.2)')
        }
        const decode = this._getJs().then(js => js.decodeGeometry(buffer, taskConfig))
        if (!DRACOLoader2Pure.EnableFallback) return decode
        return decode.then(geometry => {
            // Safety net, never accept a geometry without positions (early draco.js builds returned one for streams they could not decode).
            if (!geometry?.getAttribute('position')?.count) throw new Error('draco.js decoded a geometry without positions')
            return geometry
        }).catch((e: any) => this._fallback(buffer, taskConfig, e?.message ?? e))
    }

    protected _fallback(buffer: ArrayBuffer, taskConfig: any, reason: string): Promise<BufferGeometry> {
        this.didFallback = true
        DRACOLoader2Pure.fallbackCount++
        if (DRACOLoader2Pure.LogFallback) {
            console.warn('[DRACOLoader2Pure] falling back to the WASM Draco decoder:', reason)
        }
        return this._wasmDecode(buffer, taskConfig)
    }

    /**
     * The WASM fallback decode — the inherited three.js DRACOLoader.decodeGeometry (worker-based).
     * Isolated into its own method so the fallback wiring can be unit-tested in Node (where the
     * three.js decode worker isn't available). Accessed via the prototype because `decodeGeometry`
     * isn't in @types/three's DRACOLoader declaration.
     */
    protected _wasmDecode(buffer: ArrayBuffer, taskConfig: any): Promise<BufferGeometry> {
        return (DRACOLoader2.prototype as any).decodeGeometry.call(this, buffer, taskConfig)
    }

    override dispose(): this {
        this._js?.dispose?.()
        return super.dispose() as this
    }
}
