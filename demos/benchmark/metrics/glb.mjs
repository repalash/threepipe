// Minimal GLB reader for the benchmark: JSON + BIN chunks, accessors, KHR_draco_mesh_compression (three's
// emscripten draco_decoder.js, same calls as three's DRACOLoader worker), node TRS -> world matrices.
// Returns flat world-space triangle soups per mesh node; no three.js scene, so it runs in plain Node.

import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {Matrix4, Quaternion, Vector3} from 'three'

const require = createRequire(import.meta.url)

const COMPONENT = {5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array}
const NCOMP = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16}

let dracoPromise = null
function getDraco() {
    if (!dracoPromise) {
        const p = require.resolve('three/examples/jsm/libs/draco/draco_decoder.js')
        // three's package is "type": "module", so Node would load this emscripten UMD file as ESM and drop
        // its `module.exports`; evaluate it as the CommonJS script it is.
        const mod = {exports: {}}
        new Function('module', 'exports', 'require', '__filename', '__dirname', fs.readFileSync(p, 'utf8'))(mod, mod.exports, require, p, path.dirname(p))
        const DracoDecoderModule = mod.exports
        dracoPromise = DracoDecoderModule({locateFile: f => path.join(path.dirname(p), f)})
    }
    return dracoPromise
}

export function parseGlbChunks(bytes) {
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
    let off = 12, json = null, bin = null
    while (off < b.length) {
        const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4)
        const data = b.subarray(off + 8, off + 8 + len)
        if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
        else if (type === 0x004e4942) bin = data
        off += 8 + len
    }
    return {json, bin}
}

function bufferViewBytes(json, bin, i) {
    const bv = json.bufferViews[i]
    if ((bv.buffer ?? 0) !== 0) throw new Error('external buffers are not supported')
    return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
}

/** Accessor as a tightly packed Float32Array (or Uint32Array for indices), de-normalized. */
export function readAccessor(json, bin, i, asIndex = false) {
    const acc = json.accessors[i]
    const C = COMPONENT[acc.componentType], n = NCOMP[acc.type]
    const out = asIndex ? new Uint32Array(acc.count * n) : new Float32Array(acc.count * n)
    if (acc.bufferView == null) return out
    const bv = json.bufferViews[acc.bufferView]
    const raw = bufferViewBytes(json, bin, acc.bufferView)
    const stride = bv.byteStride || C.BYTES_PER_ELEMENT * n
    const dv = new DataView(raw.buffer, raw.byteOffset + (acc.byteOffset ?? 0))
    const get = {5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32'}[acc.componentType]
    const norm = acc.normalized ? {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[acc.componentType] : 0
    for (let k = 0; k < acc.count; k++) for (let c = 0; c < n; c++) {
        let v = dv[get](k * stride + c * C.BYTES_PER_ELEMENT, true)
        if (norm) v = Math.max(v / norm, -1)
        out[k * n + c] = v
    }
    if (acc.sparse) throw new Error('sparse accessors are not supported')
    return out
}

async function decodeDraco(json, bin, prim) {
    const ext = prim.extensions.KHR_draco_mesh_compression
    const draco = await getDraco()
    const decoder = new draco.Decoder()
    const array = new Int8Array(bufferViewBytes(json, bin, ext.bufferView))
    const mesh = new draco.Mesh()
    const status = decoder.DecodeArrayToMesh(array, array.byteLength, mesh)
    if (!status.ok() || mesh.ptr === 0) throw new Error('draco: ' + status.error_msg())
    const attributes = {}
    for (const [name, id] of Object.entries(ext.attributes)) {
        const attr = decoder.GetAttributeByUniqueId(mesh, id)
        const nc = attr.num_components(), np = mesh.num_points()
        const byteLength = nc * np * 4
        const ptr = draco._malloc(byteLength)
        decoder.GetAttributeDataArrayForAllPoints(mesh, attr, draco.DT_FLOAT32, byteLength, ptr)
        let arr = new Float32Array(draco.HEAPF32.buffer, ptr, nc * np).slice()
        draco._free(ptr)
        // glTF accessors of a draco primitive say whether the data is normalized integers
        const acc = json.accessors[prim.attributes[name]]
        if (acc?.normalized) {
            const norm = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[acc.componentType]
            if (norm) arr = arr.map(v => Math.max(v / norm, -1))
        }
        attributes[name] = arr
    }
    const nf = mesh.num_faces()
    const ptr = draco._malloc(nf * 12)
    decoder.GetTrianglesUInt32Array(mesh, nf * 12, ptr)
    const index = new Uint32Array(draco.HEAPF32.buffer, ptr, nf * 3).slice()
    draco._free(ptr)
    draco.destroy(mesh)
    draco.destroy(decoder)
    return {attributes, index}
}

function nodeLocalMatrix(n) {
    const m = new Matrix4()
    if (n.matrix) return m.fromArray(n.matrix)
    const t = n.translation ? new Vector3(...n.translation) : new Vector3()
    const r = n.rotation ? new Quaternion(...n.rotation) : new Quaternion()
    const s = n.scale ? new Vector3(...n.scale) : new Vector3(1, 1, 1)
    return m.compose(t, r, s)
}

/**
 * Read a GLB into world-space parts.
 * @returns {{json, bin, parts: Array<{node:number, name:string, path:string[], mesh:number, primitive:number,
 *   material:number|null, materialName:string|null, mode:number, position:Float32Array, normal:Float32Array|null,
 *   uv:Float32Array|null, index:Uint32Array, matrix:number[]}>}}
 */
export async function readGlb(file) {
    const bytes = typeof file === 'string' ? fs.readFileSync(file) : file
    const {json, bin} = parseGlbChunks(bytes)
    const parts = []
    const sceneIdx = json.scene ?? 0
    const visit = async (ni, parentM, parentPath) => {
        const n = json.nodes[ni]
        const world = parentM.clone().multiply(nodeLocalMatrix(n))
        const p = [...parentPath, n.name ?? `node${ni}`]
        if (n.mesh != null) {
            const mesh = json.meshes[n.mesh]
            const normalM = new Matrix4().copy(world).invert().transpose()
            for (let pi = 0; pi < mesh.primitives.length; pi++) {
                const prim = mesh.primitives[pi]
                const mode = prim.mode ?? 4
                let attrs, index
                if (prim.extensions?.KHR_draco_mesh_compression) {
                    const d = await decodeDraco(json, bin, prim)
                    attrs = d.attributes
                    index = d.index
                } else {
                    attrs = {}
                    for (const [k, a] of Object.entries(prim.attributes)) if (['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(k)) attrs[k] = readAccessor(json, bin, a)
                    const count = attrs.POSITION.length / 3
                    index = prim.indices != null ? readAccessor(json, bin, prim.indices, true) : Uint32Array.from({length: count}, (_, i) => i)
                }
                const pos = attrs.POSITION, v = new Vector3()
                const position = new Float32Array(pos.length)
                for (let i = 0; i < pos.length; i += 3) {
                    v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(world)
                    position[i] = v.x; position[i + 1] = v.y; position[i + 2] = v.z
                }
                let normal = null
                if (attrs.NORMAL) {
                    normal = new Float32Array(attrs.NORMAL.length)
                    for (let i = 0; i < normal.length; i += 3) {
                        v.set(attrs.NORMAL[i], attrs.NORMAL[i + 1], attrs.NORMAL[i + 2]).transformDirection(normalM)
                        normal[i] = v.x; normal[i + 1] = v.y; normal[i + 2] = v.z
                    }
                }
                const topoDef = mesh.extensions?.THREEPIPE_mesh_topology
                parts.push({
                    node: ni, name: n.name ?? `node${ni}`, path: p, mesh: n.mesh, primitive: pi,
                    material: prim.material ?? null, materialName: prim.material != null ? json.materials?.[prim.material]?.name ?? null : null,
                    mode, position, normal, uv: attrs.TEXCOORD_0 ?? null, index, matrix: world.toArray(),
                    topology: topoDef && pi === 0 ? readTopology(json, bin, topoDef) : null,
                })
            }
        }
        for (const c of n.children ?? []) await visit(c, world, p)
    }
    for (const r of json.scenes[sceneIdx].nodes) await visit(r, new Matrix4(), [])
    return {json, bin, parts}
}

/**
 * The n-gon topology `plugin-modelling` writes in `THREEPIPE_mesh_topology` (mesh space): positions, edge
 * vertex pairs, face corner vertices and face offsets, plus the names of its attribute layers.
 */
export function readTopology(json, bin, def) {
    return {
        positions: readAccessor(json, bin, def.positions),
        edgeVerts: readAccessor(json, bin, def.edgeVerts, true),
        cornerVerts: readAccessor(json, bin, def.cornerVerts, true),
        faceOffsets: readAccessor(json, bin, def.faceOffsets, true),
        attributes: Object.keys(def.attributes ?? {}),
    }
}

/** The image bytes of `json.images[i]` (embedded in the BIN chunk). */
export function imageBytes(json, bin, i) {
    const img = json.images[i]
    if (img.bufferView == null) return null
    return Buffer.from(bufferViewBytes(json, bin, img.bufferView))
}
