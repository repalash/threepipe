/**
 * Unit tests for DRACOLoader2Pure — the opt-in pure-JS Draco import decoder with WASM fallback.
 *
 * Covers (Node):
 *  - the draco.js decode path produces geometry identical to the reference WASM decoder, for
 *    EdgeBreaker and sequential connectivity;
 *  - sRGB vertex colors of standalone `.drc` files are converted like the WASM path does;
 *  - eager header detection (`isJsDecodable`) routes unsupported streams (point clouds, bitstreams
 *    older than 2.2) to WASM;
 *  - a REAL point cloud stream — which draco.js rejects — is decoded via the WASM fallback;
 *  - the try/catch fallback wiring (draco.js throws → WASM; flag off → it rejects).
 *
 * three's real decode worker is browser-only, so the WASM side is exercised via the overridable
 * `_wasmDecode` seam (pointed at the Node WASM module); the in-browser path is covered by e2e.
 */
import {afterEach, beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import {BufferAttribute, BufferGeometry, Color} from 'three'
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

// Fixtures, see generate-fixtures.mjs
const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/draco')
const fixture = (name: string) => {
    const bytes = new Uint8Array(readFileSync(resolve(FIX, name)))
    return () => bytes.slice().buffer
}
const fresh = fixture('bunny.drc')                  // EdgeBreaker triangle mesh
const freshSeq = fixture('sequential.drc')          // triangle mesh with SEQUENTIAL connectivity
const freshColors = fixture('vertex-colors.drc')    // EdgeBreaker triangle mesh with (sRGB) vertex colors
const freshPoints = fixture('point-cloud.drc')      // point cloud — draco.js does not implement these

const ATTRIBUTES = ['position', 'normal', 'color', 'uv'] as const

// Build a three BufferGeometry from the Node WASM decoder output (stands in for three's
// browser-only decode worker, which isn't available in Node).
const wasmGeom = (g: DecodedGeometry): BufferGeometry => {
    const geom = new BufferGeometry()
    for (const name of ATTRIBUTES) {
        const array = g[name]
        if (array) geom.setAttribute(name, new BufferAttribute(array, array.length / g.numPoints))
    }
    if (g.index.length) geom.setIndex(new BufferAttribute(g.index, 1))
    return geom
}

// The draco.js output must be identical to the WASM reference — same attributes, same values, same indices.
const expectIdentical = (geom: BufferGeometry, ref: DecodedGeometry, skip: string[] = []) => {
    for (const name of ATTRIBUTES) {
        const expected = ref[name]
        if (!expected) {
            expect(geom.getAttribute(name), name + ' should not exist').toBeUndefined()
            continue
        }
        const attribute = geom.getAttribute(name)
        expect(attribute, name + ' should exist').toBeDefined()
        expect(attribute.count, name + ' count').toBe(ref.numPoints)
        if (skip.includes(name)) continue
        expect(Array.from(attribute.array), name + ' values').toEqual(Array.from(expected))
    }
    expect(Array.from(geom.index!.array), 'indices').toEqual(Array.from(ref.index))
}

afterEach(() => { DRACOLoader2Pure.EnableFallback = true })

describe('DracoJSDecodePlugin', () => {
    it('swaps the .drc loader when added and restores it when removed, also when a loader was already created', async() => {
        const tp = await import('threepipe')
        const {DracoJSDecodePlugin} = await import('../../plugins/draco-js/src/DracoJSDecodePlugin')
        const importer = new tp.AssetImporter()
        importer.addImporter(new tp.Importer(tp.DRACOLoader2, ['drc'], ['model/mesh+draco', 'model/drc'], true))
        const viewer: any = {assetManager: {importer}}

        // a wasm loader is created before the plugin is added
        const wasm = importer.registerFile('a.drc')
        expect(wasm).toBeInstanceOf(tp.DRACOLoader2)
        expect(wasm).not.toBeInstanceOf(DRACOLoader2Pure)

        const plugin = new DracoJSDecodePlugin()
        plugin.onAdded(viewer)
        const pure = importer.registerFile('b.drc')
        expect(pure).toBeInstanceOf(DRACOLoader2Pure)

        plugin.onRemove(viewer)
        const restored = importer.registerFile('c.drc')
        expect(restored).toBeInstanceOf(tp.DRACOLoader2)
        expect(restored).not.toBeInstanceOf(DRACOLoader2Pure)
    })
})

describe('DRACOLoader2Pure', () => {
    it('decodes via draco.js identically to the WASM reference decoder', async() => {
        const ref = decodeWithWasm(await getDracoModule(), fresh())

        const loader = new DRACOLoader2Pure()
        const geom = await loader.decodeDracoFile(fresh()) as BufferGeometry

        expect(loader.didFallback, 'should NOT fall back for an EdgeBreaker mesh').toBe(false)
        expect(ref.numPoints).toBeGreaterThan(0)
        expect(geom.index!.count / 3).toBe(ref.numFaces)
        expectIdentical(geom, ref)
        loader.dispose()
    })

    it('decodes a SEQUENTIAL mesh via draco.js identically to the WASM reference decoder', async() => {
        const ref = decodeWithWasm(await getDracoModule(), freshSeq())

        const loader = new DRACOLoader2Pure()
        const geom = await loader.decodeDracoFile(freshSeq()) as BufferGeometry

        expect(loader.didFallback, 'should NOT fall back for a sequential mesh').toBe(false)
        expect(ref.numPoints).toBeGreaterThan(0)
        expect(ref.normal, 'fixture has normals').toBeDefined()
        expect(ref.uv, 'fixture has uvs').toBeDefined()
        expectIdentical(geom, ref)
        loader.dispose()
    })

    it('converts sRGB vertex colors of a standalone .drc file like the WASM path', async() => {
        const ref = decodeWithWasm(await getDracoModule(), freshColors())
        expect(ref.color, 'fixture has colors').toBeDefined()

        // `parse` is what loading a .drc file uses, the colors in the file are sRGB and get converted to linear.
        const loader = new DRACOLoader2Pure()
        const geom = await new Promise<BufferGeometry>((res, rej) => loader.parse(freshColors(), res, rej))

        expect(loader.didFallback, 'should NOT fall back for a mesh with vertex colors').toBe(false)
        expectIdentical(geom, ref, ['color'])
        // what the three.js DRACOLoader (WASM path) does with the decoded sRGB colors
        const expected = new BufferAttribute(ref.color!.slice(), 3)
        const color = new Color()
        for (let i = 0; i < expected.count; i++) {
            color.fromBufferAttribute(expected, i).convertSRGBToLinear()
            expected.setXYZ(i, color.r, color.g, color.b)
        }
        expect(Array.from(geom.attributes.color.array)).toEqual(Array.from(expected.array))
        expect(Array.from(geom.attributes.color.array), 'colors are converted').not.toEqual(Array.from(ref.color!))

        // The glTF path passes linear colors, those are not converted.
        const linear = await loader.decodeDracoFile(freshColors()) as BufferGeometry
        expect(loader.didFallback).toBe(false)
        expectIdentical(linear, ref)
        loader.dispose()
    })

    it('falls back to the WASM decoder when draco.js cannot decode a stream', async() => {
        const loader = new DRACOLoader2Pure()
        const sentinel = new BufferGeometry()
        // simulate a stream draco.js fails on
        ;(loader as any)._js = {decodeGeometry: () => Promise.reject(new Error('Failed to decode point attributes.'))}
        ;(loader as any)._wasmDecode = () => Promise.resolve(sentinel)

        const result = await loader.decodeGeometry(fresh(), {})
        expect(result).toBe(sentinel)
        expect(loader.didFallback).toBe(true)
    })

    it('falls back to the WASM decoder when draco.js returns a geometry without positions', async() => {
        const loader = new DRACOLoader2Pure()
        const sentinel = new BufferGeometry()
        ;(loader as any)._js = {decodeGeometry: () => Promise.resolve(new BufferGeometry())}
        ;(loader as any)._wasmDecode = () => Promise.resolve(sentinel)

        const result = await loader.decodeGeometry(fresh(), {})
        expect(result).toBe(sentinel)
        expect(loader.didFallback).toBe(true)
    })

    it('preload warms the js decoder, and the encoder only when asked', () => {
        const loader = new DRACOLoader2Pure()
        let encoderInits = 0
        loader.initEncoder = (() => { encoderInits++ }) as any
        expect(loader.preload()).toBe(loader)
        expect(encoderInits).toBe(0)
        loader.preload(false, true)
        expect(encoderInits).toBe(1)
    })

    it('detects unsupported streams from the Draco header (eager fallback)', () => {
        expect(DRACOLoader2Pure.isJsDecodable(fresh()), 'EdgeBreaker mesh → draco.js').toBe(true)
        expect(DRACOLoader2Pure.isJsDecodable(freshSeq()), 'sequential mesh → draco.js').toBe(true)
        expect(DRACOLoader2Pure.isJsDecodable(freshColors()), 'mesh with colors → draco.js').toBe(true)
        expect(DRACOLoader2Pure.isJsDecodable(freshPoints()), 'point cloud → WASM').toBe(false)

        // header bytes: "DRACO", version major, version minor, encoder type, encoder method, flags (2 bytes)
        const header = (patch: Record<number, number>) => {
            const bytes = new Uint8Array(fresh())
            for (const [i, v] of Object.entries(patch)) bytes[Number(i)] = v
            return bytes.buffer
        }
        expect(DRACOLoader2Pure.isJsDecodable(header({10: 0x80})), 'mesh with metadata → draco.js').toBe(true)
        expect(DRACOLoader2Pure.isJsDecodable(header({6: 1})), 'bitstream 2.1 mesh → WASM').toBe(false)
        expect(DRACOLoader2Pure.isJsDecodable(header({5: 1, 6: 1})), 'bitstream 1.1 mesh → WASM').toBe(false)
        expect(DRACOLoader2Pure.isJsDecodable(header({0: 0})), 'not a Draco stream').toBe(false)
        expect(DRACOLoader2Pure.isJsDecodable(new ArrayBuffer(4)), 'too short').toBe(false)
    })

    it('routes a real point cloud stream to WASM — draco.js rejects it', async() => {
        const draco = await getDracoModule()

        // draco.js does not implement point clouds, it rejects them (so the try/catch fallback would
        // also handle a point cloud, the header check just skips the attempt).
        const config = {attributeIDs: {position: 'POSITION'}, attributeTypes: {position: 'Float32Array'}, useUniqueIDs: false}
        await expect(new RawDracoJs().decodeGeometry(freshPoints(), config)).rejects.toThrow('Unexpected geometry type')

        // DRACOLoader2Pure detects the unsupported header and falls back to WASM, which decodes it.
        const loader = new DRACOLoader2Pure()
        ;(loader as any)._wasmDecode = (buf: ArrayBuffer) => Promise.resolve(wasmGeom(decodeWithWasm(draco, buf)))
        const geom = await loader.decodeDracoFile(freshPoints()) as BufferGeometry

        expect(loader.didFallback, 'should fall back for a point cloud').toBe(true)
        const ref = decodeWithWasm(draco, freshPoints())
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

        // a real unsupported stream, the error of draco.js is passed on
        const real = new DRACOLoader2Pure()
        ;(real as any)._wasmDecode = () => Promise.resolve(new BufferGeometry())
        await expect(real.decodeGeometry(freshPoints(), {})).rejects.toThrow('Unexpected geometry type')
        expect(real.didFallback).toBe(false)
    })
})
