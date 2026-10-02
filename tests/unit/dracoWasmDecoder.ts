/**
 * Node-side WASM Draco decoder used ONLY by the draco-decode benchmark.
 *
 * Loads three.js's bundled WASM Draco decoder (the exact decoder threepipe ships
 * via the CDN at runtime) and decodes a `.drc` buffer on the main thread, porting
 * three.js's DRACOLoader worker decode logic (decodeGeometry/decodeIndex/decodeAttribute).
 *
 * This lets us compare the official WASM decoder against mrdoob/draco.js (pure JS)
 * head-to-head in Node, with no worker/CDN involved, so the timing isolates
 * module-init + decode cost.
 */
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
import {createRequire} from 'node:module'

const __dirname2 = dirname(fileURLToPath(import.meta.url))
// The emscripten wrapper is UMD and probes the Node env (require('fs')/'path', __dirname).
// Indirect eval runs in global scope where an ESM module has neither — expose them.
const g: any = globalThis
if (typeof g.require === 'undefined') g.require = createRequire(import.meta.url)
if (typeof g.__dirname === 'undefined') g.__dirname = __dirname2
if (typeof g.__filename === 'undefined') g.__filename = fileURLToPath(import.meta.url)
// three's bundled decoder — the full build (matches DRACOLoader2's default CDN path,
// google/draco javascript folder), not the smaller gltf-only build.
const DRACO_DIR = resolve(__dirname2, '../../node_modules/three/examples/jsm/libs/draco')

export interface DecodedGeometry {
    numPoints: number
    numFaces: number
    index: Uint32Array
    position?: Float32Array
    normal?: Float32Array
    color?: Float32Array
    uv?: Float32Array
}

let _modulePromise: Promise<any> | null = null
/** Wall-clock ms to instantiate the WASM module (eval wrapper + compile/instantiate wasm). */
export let wasmInitMs = 0

/**
 * Instantiate three's WASM Draco decoder module in Node. Cached after first call.
 * Mirrors DRACOLoader2.initDecoder's eval pattern.
 */
export async function getDracoModule(): Promise<any> {
    if (_modulePromise) return _modulePromise
    const t0 = performance.now()
    const wrapperJs = readFileSync(resolve(DRACO_DIR, 'draco_wasm_wrapper.js'), 'utf-8')
    const wasmBinary = new Uint8Array(readFileSync(resolve(DRACO_DIR, 'draco_decoder.wasm')))
    // Indirect eval → global scope, returns the DracoDecoderModule factory (same trick DRACOLoader2 uses).
    const eval2 = eval
    const factory = eval2(wrapperJs + '\nDracoDecoderModule;')
    if (typeof factory !== 'function') throw new Error('dracoWasmDecoder: DracoDecoderModule factory not found')
    _modulePromise = new Promise<any>((res) => {
        factory({wasmBinary, onModuleLoaded: (m: any) => res(m)})
    }).then((m) => {
        wasmInitMs = performance.now() - t0
        return m
    })
    return _modulePromise
}

const ATTR = (draco: any) => ({
    position: {id: draco.POSITION, Type: Float32Array, dt: draco.DT_FLOAT32},
    normal: {id: draco.NORMAL, Type: Float32Array, dt: draco.DT_FLOAT32},
    color: {id: draco.COLOR, Type: Float32Array, dt: draco.DT_FLOAT32},
    uv: {id: draco.TEX_COORD, Type: Float32Array, dt: draco.DT_FLOAT32},
} as const)

/**
 * Decode a Draco buffer to plain typed arrays using the WASM module.
 * Ported from three.js examples/jsm/loaders/DRACOLoader.js (worker body).
 */
export function decodeWithWasm(draco: any, buffer: ArrayBuffer): DecodedGeometry {
    const array = new Int8Array(buffer)
    const decoder = new draco.Decoder()

    const geometryType = decoder.GetEncodedGeometryType(array)
    if (geometryType !== draco.TRIANGULAR_MESH) {
        draco.destroy(decoder)
        throw new Error('dracoWasmDecoder: only triangular mesh supported in benchmark')
    }

    const dracoGeometry = new draco.Mesh()
    const status = decoder.DecodeArrayToMesh(array, array.byteLength, dracoGeometry)
    if (!status.ok() || dracoGeometry.ptr === 0) {
        draco.destroy(dracoGeometry); draco.destroy(decoder)
        throw new Error('dracoWasmDecoder: decode failed: ' + status.error_msg())
    }

    const numPoints = dracoGeometry.num_points()
    const out: DecodedGeometry = {numPoints, numFaces: dracoGeometry.num_faces(), index: new Uint32Array(0)}

    const attrs = ATTR(draco)
    for (const name of Object.keys(attrs) as (keyof typeof attrs)[]) {
        const {id, Type, dt} = attrs[name]
        const attributeId = decoder.GetAttributeId(dracoGeometry, id)
        if (attributeId === -1) continue
        const attribute = decoder.GetAttribute(dracoGeometry, attributeId)
        const numComponents = attribute.num_components()
        const numValues = numPoints * numComponents
        const byteLength = numValues * Type.BYTES_PER_ELEMENT
        const ptr = draco._malloc(byteLength)
        decoder.GetAttributeDataArrayForAllPoints(dracoGeometry, attribute, dt, byteLength, ptr)
        out[name] = new Type(draco.HEAPF32.buffer, ptr, numValues).slice()
        draco._free(ptr)
    }

    // index
    const numIndices = out.numFaces * 3
    const byteLength = numIndices * 4
    const ptr = draco._malloc(byteLength)
    decoder.GetTrianglesUInt32Array(dracoGeometry, byteLength, ptr)
    out.index = new Uint32Array(draco.HEAPF32.buffer, ptr, numIndices).slice()
    draco._free(ptr)

    draco.destroy(dracoGeometry)
    draco.destroy(decoder)
    return out
}
