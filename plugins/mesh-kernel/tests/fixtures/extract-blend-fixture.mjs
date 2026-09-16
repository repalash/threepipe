#!/usr/bin/env node
/**
 * Extract a ground-truth mesh fixture from a `.blend` file.
 *
 * The mesh kernel's own tests are self-consistency tests: they prove `bmFromMesh` and `bmToMesh`
 * agree with each other, which a bug shared by both would also satisfy. This script produces the
 * other half - the arrays *Blender itself wrote into the file* - so `blender-parity.test.ts` can
 * check the kernel against them rather than against itself.
 *
 * Everything below is read straight out of Blender's DNA blocks. Nothing is derived, defaulted or
 * guessed: if a layer is missing, has the wrong `CD_` type, or its data block is not exactly the
 * length the element counts imply, the script throws instead of emitting a plausible-looking zero.
 *
 * Usage:
 *   node extract-blend-fixture.mjs <input.blend> [output.json] [--mesh <name|index>]
 *
 * The output is deterministic: no timestamps, no absolute paths, and float values are written at
 * full precision (they are float32 values widened to double, so they print exactly).
 *
 * References:
 * - `source/blender/makesdna/DNA_mesh_types.h`     - `Mesh` (`totvert`, `poly_offset_indices`, ...)
 * - `source/blender/makesdna/DNA_customdata_types.h` - the `CD_PROP_*` type numbers used below
 * - `plugins/blend-importer/src/loader/geometry.ts` - the same decoding approach, for rendering
 */

import {readFileSync, writeFileSync} from 'node:fs'
import {basename, resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** `plugins/blend-importer` sits next to `plugins/mesh-kernel`; the parser is plain ESM and Node-safe. */
const PARSER = resolve(here, '../../../blend-importer/src/js-blend/main.js')

/** `CD_*` values from `DNA_customdata_types.h`. Read as: what the layer must be, not what we hope. */
const CD_PROP_INT32 = 11
const CD_PROP_INT32_2D = 46
const CD_PROP_FLOAT3 = 48
const CD_PROP_FLOAT2 = 49

function fail(msg) {
    throw new Error(`extract-blend-fixture: ${msg}`)
}

/** `CustomData.layers` is a single object when `totlayer === 1`, an array otherwise. */
function customDataLayers(mesh, domain) {
    const cd = mesh[domain]
    if (!cd) fail(`mesh has no '${domain}' CustomData block`)
    const total = cd.totlayer | 0
    if (total <= 0) fail(`'${domain}' has totlayer ${cd.totlayer}`)
    const raw = cd.layers
    if (!raw) fail(`'${domain}' has totlayer ${total} but no layers pointer`)
    const list = Array.isArray(raw) ? raw : [raw]
    if (list.length < total) fail(`'${domain}' claims ${total} layers, only ${list.length} resolved`)
    return list.slice(0, total)
}

/**
 * Resolve a layer's payload to `{address, byteLength}`.
 *
 * `layer.data` is a pointer to a DATA block. The parser hands it back either as an array of lazily
 * decoded element proxies (when the block's DNA struct is known, e.g. `vec3f`) or as a single
 * `raw_data` block object. Both carry `__data_address__` and the block's `__byte_length__`, which is
 * what we want: the proxies decode one element at a time and must not be read directly (they are
 * circular through `__blender_file__`, so they also cannot be stringified).
 */
function layerBlock(layer, where) {
    const data = layer.data
    if (!data) fail(`${where}: layer has no data pointer`)
    const block = Array.isArray(data) ? data[0] : data
    if (!block || block.__data_address__ === undefined) fail(`${where}: layer data did not resolve to a block`)
    const byteLength = block.__byte_length__
    if (typeof byteLength !== 'number' || byteLength <= 0) fail(`${where}: data block has byte length ${byteLength}`)
    return {address: block.__data_address__, byteLength}
}

function findLayer(mesh, domain, name, cdType) {
    const layers = customDataLayers(mesh, domain)
    const named = layers.filter(l => l && l.name === name)
    if (named.length === 0) fail(`${domain} has no layer named '${name}' (found: ${layers.map(l => l && l.name).join(', ')})`)
    if (named.length > 1) fail(`${domain} has ${named.length} layers named '${name}'`)
    const layer = named[0]
    if (layer.type !== cdType) fail(`${domain} layer '${name}' has CD type ${layer.type}, expected ${cdType}`)
    return layer
}

/**
 * Read a layer as a typed array of exactly `elements * components` scalars, asserting the block is
 * exactly that many bytes. A short block would otherwise read into whatever DATA block follows it.
 */
function readLayer(blend, mesh, domain, name, cdType, Ctor, elements, components) {
    const layer = findLayer(mesh, domain, name, cdType)
    const {address, byteLength} = layerBlock(layer, `${domain}.${name}`)
    const expected = elements * components * Ctor.BYTES_PER_ELEMENT
    if (byteLength !== expected) {
        fail(`${domain}.${name} data block is ${byteLength} bytes, expected ${expected} ` +
            `(${elements} elements x ${components} x ${Ctor.BYTES_PER_ELEMENT})`)
    }
    const arr = blend.readTypedArray(Ctor, address, elements * components)
    if (!arr || arr.length !== elements * components) fail(`${domain}.${name} read back ${arr && arr.length} values`)
    return arr
}

/** The first user UV map: a corner-domain `CD_PROP_FLOAT2` whose name is not dot-prefixed. */
function findUvLayer(mesh) {
    for (const layer of customDataLayers(mesh, 'ldata')) {
        if (!layer || layer.type !== CD_PROP_FLOAT2) continue
        const name = layer.name || ''
        if (name.startsWith('.')) continue // `.uv_select_*` and friends are UI state, not a UV map
        return layer
    }
    return null
}

/**
 * Blender's `version` is `major * 100 + minor` (403 -> "4.3", 293 -> "2.93"). The parser reads it out
 * of the ASCII file header, so it arrives as a string.
 */
function versionString(raw) {
    const v = Number(raw)
    if (!Number.isInteger(v) || v < 100) fail(`file has no usable version (${raw})`)
    return `${Math.floor(v / 100)}.${v % 100}`
}

function pickMesh(blend, selector) {
    const meshes = blend.objects.Mesh
    if (!meshes || !meshes.length) fail('file contains no Mesh datablocks')
    if (selector === undefined) {
        if (meshes.length > 1) {
            fail(`file has ${meshes.length} meshes; pass --mesh <name|index> ` +
                `(names: ${meshes.map(m => meshName(m)).join(', ')})`)
        }
        return meshes[0]
    }
    if (/^\d+$/.test(selector)) {
        const i = Number(selector)
        if (i < 0 || i >= meshes.length) fail(`--mesh ${i} out of range 0..${meshes.length - 1}`)
        return meshes[i]
    }
    const found = meshes.filter(m => meshName(m) === selector)
    if (found.length !== 1) fail(`--mesh '${selector}' matched ${found.length} meshes`)
    return found[0]
}

/** Datablock names carry a two-character type prefix in the DNA ("MECube"). */
function meshName(mesh) {
    const n = mesh.id && mesh.id.name
    return typeof n === 'string' ? n : ''
}

function assertRange(values, limit, what) {
    for (let i = 0; i < values.length; i++) {
        const v = values[i]
        if (!Number.isInteger(v) || v < 0 || v >= limit) fail(`${what}[${i}] is ${v}, out of range 0..${limit - 1}`)
    }
}

export async function extractBlendFixture(blendPath, meshSelector) {
    const {parseBlend} = await import(PARSER)
    const bytes = new Uint8Array(readFileSync(blendPath))
    const blend = await parseBlend(bytes.buffer)
    if (!blend || !blend.objects) fail(`could not parse ${blendPath}`)

    const mesh = pickMesh(blend, meshSelector)

    // The four element counts, straight from `Mesh` in the DNA. Every array read below is checked
    // against these, so a file where they disagree with the stored blocks fails rather than silently
    // producing a truncated fixture. (Blender 5.0 makes `tot*` runtime values; those files have an
    // `attribute_storage` block instead of `vdata`/`ldata` and are rejected above.)
    const vertsNum = mesh.totvert | 0
    const edgesNum = mesh.totedge | 0
    const facesNum = mesh.totpoly | 0
    const cornersNum = mesh.totloop | 0
    if (mesh.attribute_storage) fail('Blender 5.0 attribute_storage layout is not supported by this extractor')
    if (mesh.mpoly) fail('pre-3.6 MPoly layout is not supported by this extractor')
    for (const [name, n] of [['totvert', vertsNum], ['totedge', edgesNum], ['totpoly', facesNum], ['totloop', cornersNum]]) {
        if (!Number.isInteger(n) || n <= 0) fail(`${name} is ${n}; this extractor only handles non-empty meshes`)
    }

    // Face offsets: `Mesh.poly_offset_indices`, a bare int array of `faces_num + 1` entries, not a
    // CustomData layer. Face `i` owns corners [offsets[i], offsets[i + 1]).
    const poi = mesh.poly_offset_indices
    if (!poi || poi.__data_address__ === undefined) fail('mesh has no poly_offset_indices block (pre-3.6 layout?)')
    if (poi.__byte_length__ !== (facesNum + 1) * 4) {
        fail(`poly_offset_indices is ${poi.__byte_length__} bytes, expected ${(facesNum + 1) * 4}`)
    }
    const faceOffsets = blend.readTypedArray(Int32Array, poi.__data_address__, facesNum + 1)

    const positions = readLayer(blend, mesh, 'vdata', 'position', CD_PROP_FLOAT3, Float32Array, vertsNum, 3)
    const edgeVerts = readLayer(blend, mesh, 'edata', '.edge_verts', CD_PROP_INT32_2D, Int32Array, edgesNum, 2)
    const cornerVerts = readLayer(blend, mesh, 'ldata', '.corner_vert', CD_PROP_INT32, Int32Array, cornersNum, 1)
    const cornerEdges = readLayer(blend, mesh, 'ldata', '.corner_edge', CD_PROP_INT32, Int32Array, cornersNum, 1)

    // Decode sanity only - topological agreement is what the parity suite asserts, so it must not be
    // pre-checked here. These catch a misread block (wrong address, wrong stride) immediately.
    if (faceOffsets[0] !== 0) fail(`faceOffsets[0] is ${faceOffsets[0]}, expected 0`)
    if (faceOffsets[facesNum] !== cornersNum) fail(`faceOffsets ends at ${faceOffsets[facesNum]}, expected totloop ${cornersNum}`)
    for (let f = 0; f < facesNum; f++) {
        if (faceOffsets[f + 1] <= faceOffsets[f]) fail(`faceOffsets is not increasing at face ${f}`)
    }
    assertRange(edgeVerts, vertsNum, '.edge_verts')
    assertRange(cornerVerts, vertsNum, '.corner_vert')
    assertRange(cornerEdges, edgesNum, '.corner_edge')
    for (let i = 0; i < positions.length; i++) {
        if (!Number.isFinite(positions[i])) fail(`position component ${i} is ${positions[i]}`)
    }

    const uvLayer = findUvLayer(mesh)
    let uv = null, uvName = null
    if (uvLayer) {
        uvName = uvLayer.name
        uv = readLayer(blend, mesh, 'ldata', uvName, CD_PROP_FLOAT2, Float32Array, cornersNum, 2)
        for (let i = 0; i < uv.length; i++) if (!Number.isFinite(uv[i])) fail(`uv component ${i} is ${uv[i]}`)
    }

    const out = {
        source: basename(blendPath),
        mesh: meshName(mesh),
        blenderVersion: versionString(blend.template && blend.template.version),
        vertsNum, edgesNum, facesNum, cornersNum,
        faceOffsets: Array.from(faceOffsets),
        positions: Array.from(positions),
        edgeVerts: Array.from(edgeVerts),
        cornerVerts: Array.from(cornerVerts),
        cornerEdges: Array.from(cornerEdges),
    }
    if (uv) {
        out.uvName = uvName
        out.uv = Array.from(uv)
    }
    return out
}

/**
 * JSON with the big arrays wrapped one element per row rather than one scalar per line: a 512-face
 * fixture is meant to be diffable and skimmable in review.
 */
function serialise(fixture) {
    const stride = {
        faceOffsets: 8, positions: 3, edgeVerts: 2,
        cornerVerts: 12, cornerEdges: 12, uv: 2,
    }
    const perRow = {positions: 4, edgeVerts: 6, uv: 6, faceOffsets: 1, cornerVerts: 1, cornerEdges: 1}
    const lines = []
    const keys = Object.keys(fixture)
    for (let k = 0; k < keys.length; k++) {
        const key = keys[k]
        const value = fixture[key]
        const comma = k === keys.length - 1 ? '' : ','
        if (!Array.isArray(value)) {
            lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`)
            continue
        }
        const group = stride[key] * perRow[key]
        const rows = []
        for (let i = 0; i < value.length; i += group) {
            rows.push('    ' + value.slice(i, i + group).map(n => JSON.stringify(n)).join(', '))
        }
        lines.push(`  ${JSON.stringify(key)}: [\n${rows.join(',\n')}\n  ]${comma}`)
    }
    return `{\n${lines.join('\n')}\n}\n`
}

async function main(argv) {
    const args = [], flags = {}
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--mesh') flags.mesh = argv[++i]
        else args.push(argv[i])
    }
    if (args.length < 1) {
        process.stderr.write('usage: node extract-blend-fixture.mjs <input.blend> [output.json] [--mesh <name|index>]\n')
        process.exit(2)
    }
    const input = resolve(args[0])
    const output = args[1] ? resolve(args[1]) : resolve(here, basename(input).replace(/\.blend1?$/, '') + '.json')
    const fixture = await extractBlendFixture(input, flags.mesh)
    writeFileSync(output, serialise(fixture))
    process.stdout.write(
        `${basename(output)}: ${fixture.mesh} from ${fixture.source} (Blender ${fixture.blenderVersion}) - ` +
        `V${fixture.vertsNum} E${fixture.edgesNum} F${fixture.facesNum} L${fixture.cornersNum}` +
        `${fixture.uv ? ` uv '${fixture.uvName}'` : ' (no uv)'}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    main(process.argv.slice(2)).catch(err => {
        process.stderr.write(String(err && err.stack || err) + '\n')
        process.exit(1)
    })
}
