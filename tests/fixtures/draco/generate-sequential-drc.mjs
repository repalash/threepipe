// Regenerates `sequential.drc` — a SEQUENTIAL-encoded Draco mesh that draco.js cannot decode
// (it silently drops positions rather than throwing), used to test the DRACOLoader2Pure WASM
// fallback / eager header detection in `tests/unit/dracojs-adapter.test.ts`.
//
// Run from the repo root:  node tests/fixtures/draco/generate-sequential-drc.mjs
import {readFileSync, writeFileSync} from 'node:fs'

// minimal polyfills so three core imports in Node
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis
if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
        constructor(w, h, d) { this.width = w; this.height = h; this.data = d || new Uint8ClampedArray(w * h * 4) }
    }
}

const {BoxGeometry, Mesh, MeshBasicMaterial} = await import('three')
const {DRACOExporter} = await import('three/examples/jsm/exporters/DRACOExporter.js')

// load three's JS draco encoder and expose the global the exporter expects
const encJs = readFileSync('node_modules/three/examples/jsm/libs/draco/draco_encoder.js', 'utf-8')
globalThis.DracoEncoderModule = (0, eval)(encJs + '\nDracoEncoderModule')

const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
const data = new DRACOExporter().parse(mesh, {
    encoderMethod: DRACOExporter.MESH_SEQUENTIAL_ENCODING, // 0 — draco.js does not implement this path
    exportNormals: true,
    exportUvs: true,
    quantization: [16, 8, 8, 8, 8],
})

writeFileSync('tests/fixtures/draco/sequential.drc', Buffer.from(data.buffer, data.byteOffset, data.byteLength))
console.log('wrote tests/fixtures/draco/sequential.drc', data.byteLength, 'bytes')
