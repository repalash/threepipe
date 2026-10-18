import {afterAll, describe, expect, it} from 'vitest'
import {BoxGeometry, PlaneGeometry, SphereGeometry} from 'three'
import {readFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
// @ts-expect-error plain ESM module without types
import {modelQuality, topologyQuality, triangleQuality} from '../../../demos/benchmark/metrics/quality.mjs'
// @ts-expect-error plain ESM module without types
import {readGlb} from '../../../demos/benchmark/metrics/glb.mjs'
// @ts-expect-error plain ESM module without types
import {agentMetrics, transcriptMetrics} from '../../../demos/benchmark/metrics/run.mjs'

const geo = (g: any) => ({
    name: 'g', position: g.attributes.position.array as Float32Array, normal: g.attributes.normal.array as Float32Array,
    index: Uint32Array.from(g.index.array), uv: g.attributes.uv?.array ?? null,
})

describe('benchmark geometry quality', () => {
    it('a box: closed, one component, every corner a shading seam', () => {
        const q = triangleQuality(geo(new BoxGeometry(2, 2, 2)))
        expect(q.triangles).toBe(12)
        expect(q.vertices).toBe(8)
        expect(q.closed).toBe(true)
        expect(q.components).toBe(1)
        expect(q.splitVertexRatio).toBe(1)
        expect(q.hardEdgeRatio).toBeCloseTo(12 / 18, 12)
        expect(q.area).toBeCloseTo(24, 6)
        expect(q.minAngleP5).toBeCloseTo(45, 6)
    })

    it('a smooth sphere has no seams; a plane is open with a 4-edge border', () => {
        const s = triangleQuality(geo(new SphereGeometry(1, 32, 16)))
        expect(s.splitVertexRatio).toBeLessThan(0.05) // the UV seam column and poles carry the same normal
        const p = triangleQuality(geo(new PlaneGeometry(1, 1)))
        expect(p.boundaryEdges).toBe(4)
        expect(p.closed).toBe(false)
    })

    it('n-gon topology: a quad cube has six quads and eight 3-poles', () => {
        const t = topologyQuality({
            positions: new Float32Array(24),
            faceOffsets: Uint32Array.from([0, 4, 8, 12, 16, 20, 24]),
            cornerVerts: Uint32Array.from([0, 1, 2, 3, 7, 6, 5, 4, 0, 4, 5, 1, 1, 5, 6, 2, 2, 6, 7, 3, 3, 7, 4, 0]),
            edgeVerts: new Uint32Array(0), attributes: [],
        })
        expect(t).toMatchObject({faces: 6, quads: 6, tris: 0, ngons: 0, quadRatio: 1, edges: 12, boundaryEdges: 0, poles3: 8, poles5: 0})
    })

    it('model totals weight faceting by area of the large parts', () => {
        const box = {...geo(new BoxGeometry(10, 10, 10)), name: 'box'}
        const ball = {...geo(new SphereGeometry(5, 32, 16)), name: 'ball'}
        const m = modelQuality([box, ball])
        expect(m.total.parts).toBe(2)
        expect(m.total.facetingLarge).toBeGreaterThan(0.5)
        expect(m.total.facetingLarge).toBeLessThan(0.75)
    })
})

// --- GLB reader --------------------------------------------------------------------------------
/** A minimal GLB: `meshes` are {positions, indices} or {draco: bytes, count, indexCount}; nodes as given. */
function glb(json: any, chunks: Uint8Array[]) {
    let off = 0
    const views = chunks.map(c => { const v = {buffer: 0, byteOffset: off, byteLength: c.byteLength}; off += Math.ceil(c.byteLength / 4) * 4; return v })
    const bin = new Uint8Array(off)
    let o = 0
    for (const c of chunks) { bin.set(c, o); o += Math.ceil(c.byteLength / 4) * 4 }
    const j = {asset: {version: '2.0'}, ...json, bufferViews: views, buffers: [{byteLength: off}]}
    let js = Buffer.from(JSON.stringify(j))
    const pad = (4 - js.length % 4) % 4
    js = Buffer.concat([js, Buffer.alloc(pad, 0x20)])
    const out = Buffer.alloc(12 + 8 + js.length + 8 + bin.length)
    out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
    out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20)
    out.writeUInt32LE(bin.length, 20 + js.length); out.writeUInt32LE(0x004e4942, 24 + js.length); Buffer.from(bin).copy(out, 28 + js.length)
    return out
}
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
const dir = mkdtempSync(join(tmpdir(), 'bench-glb-'))
afterAll(() => rmSync(dir, {recursive: true, force: true}))

describe('benchmark GLB reader', () => {
    const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const idx = new Uint16Array([0, 1, 2, 0])

    it('reads accessors and composes node transforms into world space', async() => {
        const file = join(dir, 'plain.glb')
        writeFileSync(file, glb({
            scene: 0, scenes: [{nodes: [0]}],
            nodes: [{name: 'root', translation: [10, 0, 0], scale: [2, 2, 2], children: [1]}, {name: 'child', mesh: 0, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2]}],
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, material: 0}]}],
            materials: [{name: 'm'}],
            accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}, {bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR'}],
        }, [bytes(tri), bytes(idx)]))
        const {parts} = await readGlb(file)
        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({name: 'child', path: ['root', 'child'], materialName: 'm'})
        expect(Array.from(parts[0].index)).toEqual([0, 1, 2])
        // child: +90 deg about z, then root: scale 2, +10 x
        const p = Array.from(parts[0].position as Float32Array).map(v => Math.round(v * 1e6) / 1e6 + 0)
        expect(p).toEqual([10, 0, 0, 10, 2, 0, 8, 0, 0])
    })

    it('decodes KHR_draco_mesh_compression with three\'s decoder', async() => {
        const require = createRequire(import.meta.url)
        const p = require.resolve('three/examples/jsm/libs/draco/draco_encoder.js')
        const mod = {exports: {} as any}
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', 'require', '__filename', '__dirname', readFileSync(p, 'utf8'))(mod, mod.exports, require, p, dirname(p))
        let enc = mod.exports()
        if (enc.ready) enc = await enc.ready
        const g = new SphereGeometry(1, 12, 8)
        const builder = new enc.MeshBuilder(), mesh = new enc.Mesh(), encoder = new enc.Encoder()
        const pos = g.attributes.position.array as Float32Array, index = Uint32Array.from(g.index!.array)
        builder.AddFacesToMesh(mesh, index.length / 3, index)
        const id = builder.AddFloatAttributeToMesh(mesh, enc.POSITION, pos.length / 3, 3, pos)
        encoder.SetAttributeQuantization(enc.POSITION, 16)
        const data = new enc.DracoInt8Array()
        const len = encoder.EncodeMeshToDracoBuffer(mesh, data)
        const draco = new Uint8Array(len)
        for (let i = 0; i < len; i++) draco[i] = data.GetValue(i) & 0xff
        const file = join(dir, 'draco.glb')
        writeFileSync(file, glb({
            scene: 0, scenes: [{nodes: [0]}], nodes: [{name: 'ball', mesh: 0}], extensionsUsed: ['KHR_draco_mesh_compression'],
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, extensions: {KHR_draco_mesh_compression: {bufferView: 0, attributes: {POSITION: id}}}}]}],
            accessors: [{componentType: 5126, count: pos.length / 3, type: 'VEC3'}, {componentType: 5125, count: index.length, type: 'SCALAR'}],
        }, [draco]))
        const {parts} = await readGlb(file)
        expect(parts[0].index.length).toBe(index.length)
        const q = triangleQuality(parts[0])
        const q0 = triangleQuality({...geo(g)})
        expect(q.area).toBeCloseTo(q0.area, 3)
        let maxR = 0
        for (let i = 0; i < parts[0].position.length; i += 3) maxR = Math.max(maxR, Math.hypot(parts[0].position[i], parts[0].position[i + 1], parts[0].position[i + 2]))
        expect(maxR).toBeCloseTo(1, 3)
    })

    it('reads THREEPIPE_mesh_topology', async() => {
        const file = join(dir, 'topo.glb')
        const quad = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
        writeFileSync(file, glb({
            scene: 0, scenes: [{nodes: [0]}], nodes: [{name: 'q', mesh: 0}],
            meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}], extensions: {THREEPIPE_mesh_topology: {positions: 0, edgeVerts: 2, cornerVerts: 3, faceOffsets: 4, attributes: {sharp_face: {accessor: 5, domain: 2, type: 'bool'}}}}}],
            accessors: [
                {bufferView: 0, componentType: 5126, count: 4, type: 'VEC3'}, {bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR'},
                {bufferView: 2, componentType: 5125, count: 4, type: 'VEC2'}, {bufferView: 3, componentType: 5125, count: 4, type: 'SCALAR'},
                {bufferView: 4, componentType: 5125, count: 2, type: 'SCALAR'}, {bufferView: 5, componentType: 5121, count: 1, type: 'SCALAR'},
            ],
        }, [bytes(quad), bytes(new Uint16Array([0, 1, 2, 0, 2, 3])), bytes(new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0])),
            bytes(new Uint32Array([0, 1, 2, 3])), bytes(new Uint32Array([0, 4])), new Uint8Array([1])]))
        const {parts} = await readGlb(file)
        const t = topologyQuality(parts[0].topology)
        expect(t).toMatchObject({faces: 1, quads: 1, boundaryEdges: 4})
        expect(parts[0].topology.attributes).toEqual(['sharp_face'])
    })
})

describe('benchmark run metrics', () => {
    it('counts commands, failures, renders and time from a transcript', () => {
        const m = transcriptMetrics({summary: {url: 'http://x', wallMs: 900}, operations: [
            {command: {op: 'primitive'}, result: {ok: true, ms: 2}, wallMs: 5},
            {command: {op: 'capture'}, result: {ok: true, ms: 300}, wallMs: 320},
            {command: {op: 'bevel'}, result: {ok: false, ms: 1}, wallMs: 3},
        ]})
        expect(m).toMatchObject({commands: 3, failed: 1, renders: 1, commandMs: 303, operationWallMs: 328, renderWallMs: 320, buildWallMs: 900, session: 'browser'})
        expect(m.byOp.capture).toEqual({count: 1, ms: 300, wallMs: 320})
    })

    it('reads an agent transcript with the status page rules', () => {
        const f = join(dir, 'agent.jsonl')
        const t = (min: number) => new Date(Date.UTC(2026, 9, 18, 0, min)).toISOString()
        writeFileSync(f, [
            {type: 'user', timestamp: t(0)},
            {type: 'assistant', timestamp: t(1), message: {model: 'm1', usage: {output_tokens: 10, input_tokens: 5, cache_read_input_tokens: 100}, content: [{type: 'tool_use'}, {type: 'text'}]}},
            {type: 'assistant', timestamp: t(40), message: {model: 'm1', usage: {output_tokens: 1}, content: [{type: 'tool_use'}]}},
        ].map(l => JSON.stringify(l)).join('\n') + '\nnot json\n')
        // 0 -> 1 min counts, 1 -> 40 is a gap over 10 min and counts as 10
        expect(agentMetrics(f)).toEqual({models: ['m1'], activeMin: 11, toolCalls: 2, outputTokens: 11, inputTokens: 105, cacheReadTokens: 100})
    })
})
