import {BufferGeometry, DRACOLoader2} from 'threepipe'
import type {DRACOLoader as DracoJSDRACOLoader} from './dracojs/DRACOLoader.js'

/**
 * Drop-in import-decode replacement for {@link DRACOLoader2} that decodes Draco meshes with the
 * pure-JS {@link https://github.com/mrdoob/draco.js | draco.js} decoder (no wasm, no worker, no
 * CDN fetch) — and transparently **falls back to the WASM decoder** for anything draco.js can't
 * handle (sequential connectivity, point-cloud, KD-tree, metadata, or any decode error).
 *
 * Why this shape:
 * - It **extends {@link DRACOLoader2}**, so it inherits the encoder ({@link DRACOLoader2.initEncoder}
 *   — draco.js cannot encode), the `.drc` → {@link Mesh} `transform()`, `initDecoder`, the
 *   `isDRACOLoader2` marker, and the WASM `decodeGeometry` used as the fallback. Only the decode
 *   entry point is overridden.
 * - The pure-JS decoder is **lazy-loaded via dynamic `import()`** ({@link loadDecoderModule}), so
 *   the ~110 KB decoder stays out of the initial bundle/parse until Draco decoding actually
 *   happens. The WASM fallback only initialises if/when a buffer needs it, so the common
 *   (EdgeBreaker glTF) path pays zero wasm/worker cost.
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
            this._js = new mod.DRACOLoader()
        }
        return this._js
    }

    /**
     * Override the inherited `preload()` (which `GLTFLoader` calls) so it warms the pure-JS decoder
     * instead of eagerly spawning the WASM worker + fetching `draco_decoder.wasm`. The WASM decoder
     * only initialises lazily if a decode actually falls back to it — so the common path pays no
     * wasm fetch/worker cost.
     */
    override preload(): this {
        DRACOLoader2Pure.loadDecoderModule().catch(() => {/* decode-time fallback handles failures */})
        return this
    }

    /**
     * Returns true only for streams draco.js actually decodes correctly: an **EdgeBreaker
     * triangular mesh with no metadata**. Read straight from the Draco header (see
     * {@link https://github.com/google/draco | Draco} bitstream: `"DRACO"` magic, then version,
     * `encoderType` @ byte 7, `encoderMethod` @ byte 8, `flags` @ bytes 9-10).
     *
     * This is needed because draco.js **fails silently** on unsupported streams — e.g. a
     * sequential-encoded mesh decodes to a geometry with *no position attribute* rather than
     * throwing — so a try/catch alone would let broken geometry through. Eager detection routes
     * point-cloud / sequential / metadata-bearing streams straight to the WASM decoder.
     */
    static isJsDecodable(buffer: ArrayBuffer): boolean {
        const b = new Uint8Array(buffer)
        if (b.length < 11) return false
        if (b[0] !== 0x44 || b[1] !== 0x52 || b[2] !== 0x41 || b[3] !== 0x43 || b[4] !== 0x4F) return false // "DRACO"
        if (b[7] !== 1) return false // encoderType must be TRIANGULAR_MESH (1) — not POINT_CLOUD
        if (b[8] !== 1) return false // encoderMethod must be MESH_EDGEBREAKER (1) — not SEQUENTIAL
        if (((b[9] | (b[10] << 8)) & 0x8000) !== 0) return false // METADATA flag set — draco.js mishandles it
        return true
    }

    // Note: `decodeGeometry` is not declared on @types/three's DRACOLoader (incomplete community
    // types), so this is typed as a fresh method rather than an `override`. At runtime it shadows
    // the inherited three.js DRACOLoader.decodeGeometry.
    decodeGeometry(buffer: ArrayBuffer, taskConfig: any): Promise<BufferGeometry> {
        if (DRACOLoader2Pure.EnableFallback && !DRACOLoader2Pure.isJsDecodable(buffer)) {
            // Unsupported stream draco.js would mis-decode (silently) — go straight to WASM.
            return this._fallback(buffer, taskConfig, 'unsupported Draco stream (not an EdgeBreaker triangle mesh, or has metadata)')
        }
        const decode = this._getJs().then(js => js.decodeGeometry(buffer, taskConfig))
        if (!DRACOLoader2Pure.EnableFallback) return decode
        return decode.catch((e: any) => this._fallback(buffer, taskConfig, e?.message ?? e))
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
