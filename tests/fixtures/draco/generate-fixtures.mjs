// Regenerates the generated Draco fixtures used by `tests/unit/dracojs-adapter.test.ts` and the
// `draco-js-plugin` interactive test, with three's bundled Draco encoder:
//
//  - `sequential.drc`    — a mesh with SEQUENTIAL connectivity (draco.js decodes it, no fallback)
//  - `vertex-colors.drc` — an EdgeBreaker mesh with a COLOR attribute (sRGB vertex color conversion)
//  - `point-cloud.drc`   — a point cloud, which draco.js does not implement (WASM fallback)
//
// `bunny.drc` is not generated, it is the sample of the same name from https://github.com/mrdoob/draco.js
//
// Run from the repo root:  node tests/fixtures/draco/generate-fixtures.mjs
import {readFileSync, writeFileSync} from 'node:fs'

// minimal polyfills so three core imports in Node
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis
if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
        constructor(w, h, d) { this.width = w; this.height = h; this.data = d || new Uint8ClampedArray(w * h * 4) }
    }
}

const {BoxGeometry, BufferAttribute, Mesh, MeshBasicMaterial, Points, PointsMaterial} = await import('three')
const {DRACOExporter} = await import('three/examples/jsm/exporters/DRACOExporter.js')

// load three's JS draco encoder and expose the global the exporter expects
const encJs = readFileSync('node_modules/three/examples/jsm/libs/draco/draco_encoder.js', 'utf-8')
globalThis.DracoEncoderModule = (0, eval)(encJs + '\nDracoEncoderModule')

const write = (name, object, options) => {
    const data = new DRACOExporter().parse(object, options)
    writeFileSync('tests/fixtures/draco/' + name, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    console.log('wrote tests/fixtures/draco/' + name, data.byteLength, 'bytes')
}

const quantization = [16, 8, 8, 8, 8]

write('sequential.drc', new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()), {
    encoderMethod: DRACOExporter.MESH_SEQUENTIAL_ENCODING,
    exportNormals: true,
    exportUvs: true,
    quantization,
})

// a different color (in the working, linear-srgb, color space) for each vertex. The exporter writes them as sRGB.
const colored = new BoxGeometry(1, 1, 1)
const count = colored.attributes.position.count
const colors = new Float32Array(count * 3)
for (let i = 0; i < count; i++) colors.set([i / (count - 1), 1 - i / (count - 1), (i % 4) / 3], i * 3)
colored.setAttribute('color', new BufferAttribute(colors, 3))

write('vertex-colors.drc', new Mesh(colored, new MeshBasicMaterial()), {
    encoderMethod: DRACOExporter.MESH_EDGEBREAKER_ENCODING,
    exportNormals: true,
    exportUvs: true,
    exportColor: true,
    quantization,
})

write('point-cloud.drc', new Points(new BoxGeometry(1, 1, 1, 2, 2, 2), new PointsMaterial()), {quantization})
