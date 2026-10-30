/**
 * Unit tests for DRACOLoader2Pure — the opt-in pure-JS Draco import decoder with WASM fallback.
 *
 * Covers (Node):
 *  - the draco.js decode path produces geometry identical to the reference WASM decoder;
 *  - eager header detection (`isJsDecodable`) routes unsupported streams to WASM;
 *  - a REAL sequential-encoded stream — which draco.js mis-decodes *silently* (no throw, missing
 *    positions) — is detected and decoded correctly via the WASM fallback;
 *  - the try/catch fallback wiring (draco.js throws → WASM; flag off → it rejects).
 *
 * three's real decode worker is browser-only, so the WASM side is exercised via the overridable
 * `_wasmDecode` seam (pointed at the Node WASM module); the in-browser path is covered by e2e.
 */
import {afterEach, beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import {BufferAttribute, BufferGeometry} from 'three'
import {DRACOLoader as RawDracoJs} from '../../plugins/draco-js/src/dracojs/DRACOLoader.js'
import {decodeWithWasm, getDracoModule, type DecodedGeometry} from './dracoWasmDecoder'

// Deferred import — DRACOLoader2Pure pulls threepipe core, which has circular static-init
// dependencies that only resolve once the graph is fully loaded (same pattern as
// src/plugins/geometry/primitives/geometry-generators.test.ts).
let DRACOLoader2Pure: typeof import('../../plugins/draco-js/src/DRACOLoader2Pure').DRACOLoader2Pure
beforeAll(async() => {
    await import('threepipe') // initialize the core module graph in canonical order first (avoids circular static-init)
    DRACOLoader2Pure = (await import('../../plugins/draco-js/src/DRACOLoader2Pure')).DRACOLoader2Pure
})

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/draco')
const bunny = new Uint8Array(readFileSync(resolve(FIX, 'bunny.drc')))                  // EdgeBreaker triangle mesh
const sequential = new Uint8Array(readFileSync(resolve(FIX, 'sequential.drc')))        // SEQUENTIAL — draco.js can't decode (see generate-sequential-drc.mjs)
const fresh = () => bunny.slice().buffer
const freshSeq = () => sequential.slice().buffer

const maxAbsDiff = (a: Float32Array, b: Float32Array) => {
    let m = 0
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
    return m
}

// Build a three BufferGeometry from the Node WASM decoder output (stands in for three's
// browser-only decode worker, which isn't available in Node).
const wasmGeom = (g: DecodedGeometry): BufferGeometry => {
    const geom = new BufferGeometry()
    if (g.position) geom.setAttribute('position', new BufferAttribute(g.position, 3))
    if (g.index.length) geom.setIndex(new BufferAttribute(g.index, 1))
    return geom
}

afterEach(() => { DRACOLoader2Pure.EnableFallback = true })

describe('DRACOLoader2Pure', () => {
    it('decodes via draco.js identically to the WASM reference decoder', async() => {
        const ref = decodeWithWasm(await getDracoModule(), fresh())

        const loader = new DRACOLoader2Pure()
        const geom = await loader.decodeDracoFile(fresh()) as BufferGeometry

        expect(loader.didFallback, 'should NOT fall back for an EdgeBreaker mesh').toBe(false)
        expect(geom.attributes.position.count).toBe(ref.numPoints)
        expect(geom.index!.count / 3).toBe(ref.numFaces)
        // face indices byte-exact
        const idx = geom.index!.array as Uint32Array
        expect(idx.length).toBe(ref.index.length)
        expect(idx.every((v, i) => v === ref.index[i])).toBe(true)
        // positions within float epsilon
        expect(maxAbsDiff(geom.attributes.position.array as Float32Array, ref.position!)).toBeLessThan(1e-3)
        loader.dispose()
    })

    it('falls back to the WASM decoder when draco.js cannot decode a stream', async() => {
        const loader = new DRACOLoader2Pure()
        const sentinel = new BufferGeometry()
        // simulate an unsupported stream (e.g. sequential connectivity)
        ;(loader as any)._js = {decodeGeometry: () => Promise.reject(new Error('Failed to decode point attributes.'))}
        ;(loader as any)._wasmDecode = () => Promise.resolve(sentinel)

        const result = await loader.decodeGeometry(fresh(), {})
        expect(result).toBe(sentinel)
        expect(loader.didFallback).toBe(true)
    })

    it('detects unsupported streams from the Draco header (eager fallback)', () => {
        expect(DRACOLoader2Pure.isJsDecodable(fresh()), 'EdgeBreaker mesh → draco.js').toBe(true)
        expect(DRACOLoader2Pure.isJsDecodable(freshSeq()), 'sequential mesh → WASM').toBe(false)
    })

    it('routes a real SEQUENTIAL stream to WASM — draco.js would fail SILENTLY (no throw)', async() => {
        const draco = await getDracoModule()

        // Why eager detection is required: draco.js does NOT throw on a sequential stream — it
        // returns a geometry with NO position attribute. A try/catch alone would let it through.
        const broken = await new RawDracoJs().decodeDracoFile(freshSeq()) as BufferGeometry
        expect(broken.attributes.position, 'draco.js silently drops positions on sequential').toBeUndefined()

        // DRACOLoader2Pure detects the unsupported header and falls back to WASM, which decodes it.
        const loader = new DRACOLoader2Pure()
        ;(loader as any)._wasmDecode = (buf: ArrayBuffer) => Promise.resolve(wasmGeom(decodeWithWasm(draco, buf)))
        const geom = await loader.decodeDracoFile(freshSeq()) as BufferGeometry

        expect(loader.didFallback, 'should fall back for a sequential mesh').toBe(true)
        const ref = decodeWithWasm(draco, freshSeq())
        expect(ref.numPoints).toBeGreaterThan(0)
        expect(geom.attributes.position.count).toBe(ref.numPoints)
        loader.dispose()
    })

    it('does not fall back when EnableFallback is off (rejects instead)', async() => {
        DRACOLoader2Pure.EnableFallback = false
        const loader = new DRACOLoader2Pure()
        ;(loader as any)._js = {decodeGeometry: () => Promise.reject(new Error('boom'))}
        ;(loader as any)._wasmDecode = () => Promise.resolve(new BufferGeometry())

        await expect(loader.decodeGeometry(fresh(), {})).rejects.toThrow('boom')
        expect(loader.didFallback).toBe(false)
    })
})
