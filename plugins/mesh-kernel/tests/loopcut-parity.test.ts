/**
 * Ground-truth parity for `editMeshLoopCut` (`ringsel_finish`, `editmesh_loopcut.cc:158`) against
 * `bpy.ops.mesh.loopcut` run by Blender (`fixtures/gen-bmesh-ops-loopcut-fixtures.py`): the same mesh,
 * edge, properties and start select mode give the same mesh in the same element order, the same
 * selection and the same select mode afterwards. The ring preview
 * (`EDBM_preselect_edgering_update_from_edge`) is drawing only in Blender, so its tests are worked by
 * hand from the cited source.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BMesh} from '../src/bmesh/BMesh'
import {meshNormalsUpdate} from '../src/bmesh/normals'
import {selectModeSet, selectNone} from '../src/bmesh/marking'
import {ElemFlag, SelectMode} from '../src/constants'
import {SubdFalloff} from '../src/ops/subdivide'
import {edgeringPreviewFromEdge, editMeshLoopCut} from '../src/ops/loopcut'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bmesh-ops-loopcut.json')

interface MeshOut {positions: number[][], faces: number[][], edges: number[][]}
interface Case {
    name: string
    params: {number_cuts: number, smoothness?: number, falloff?: string}
    selectMode: 'VERT' | 'EDGE' | 'FACE'
    input: {positions: number[][], faces: number[][], edge: [number, number], meshEdges: number[][]}
    output: MeshOut
    selected: {verts: number[], edges: number[], faces: number[]}
    selectModeAfter: string[]
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {blender: string, cases: Case[]}
const TOL = 1e-4
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}
const FALLOFF: Record<string, SubdFalloff> = {
    SMOOTH: 'smooth', SPHERE: 'sphere', ROOT: 'root', SHARP: 'sharp', LINEAR: 'linear', INVERSE_SQUARE: 'inverseSquare',
}

function build(input: Case['input']) {
    const bm = new BMesh()
    const verts = input.positions.map(c => bm.vertCreate(c[0], c[1], c[2]))
    // Blender's edge order and direction (issues/open/mesh-kernel-face-create-edge-order.md), loose
    // edges included.
    for (const [a, b] of input.meshEdges) bm.edgeCreate(verts[a], verts[b])
    for (const f of input.faces) bm.faceCreate(f.map(i => verts[i]))
    meshNormalsUpdate(bm)
    const edge = [...bm.edges].find(x => x.joins(verts[input.edge[0]], verts[input.edge[1]]))!
    return {bm, verts, edge}
}

function meshOf(bm: BMesh): MeshOut {
    const index = new Map([...bm.verts].map((v, i) => [v, i]))
    return {
        positions: [...bm.verts].map(v => [v.x, v.y, v.z]),
        faces: [...bm.faces].map(f => f.verts().map(v => index.get(v)!)),
        edges: [...bm.edges].map(e => [index.get(e.v1)!, index.get(e.v2)!]),
    }
}

function compareExact(got: MeshOut, want: MeshOut): string[] {
    const problems: string[] = []
    if (got.positions.length !== want.positions.length) problems.push(`vertex count ${got.positions.length}, Blender ${want.positions.length}`)
    if (got.edges.length !== want.edges.length) problems.push(`edge count ${got.edges.length}, Blender ${want.edges.length}`)
    if (got.faces.length !== want.faces.length) problems.push(`face count ${got.faces.length}, Blender ${want.faces.length}`)
    if (problems.length) return problems
    want.positions.forEach((w, i) => {
        const g = got.positions[i]
        if (Math.abs(g[0] - w[0]) > TOL || Math.abs(g[1] - w[1]) > TOL || Math.abs(g[2] - w[2]) > TOL) {
            problems.push(`vertex ${i} at [${g.map(c => c.toFixed(6)).join(', ')}], Blender [${w.join(', ')}]`)
        }
    })
    want.edges.forEach((w, i) => {
        const g = got.edges[i]
        if (!(g[0] === w[0] && g[1] === w[1]) && !(g[0] === w[1] && g[1] === w[0])) problems.push(`edge ${i} is ${g}, Blender ${w}`)
    })
    want.faces.forEach((w, i) => {
        if (got.faces[i].join(',') !== w.join(',')) problems.push(`face ${i} is [${got.faces[i]}], Blender [${w}]`)
    })
    return problems
}

describe(`Loop Cut (MESH_OT_loopcut) matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const {bm, edge} = build(c.input)
            selectModeSet(bm, MODE[c.selectMode])
            selectNone(bm)
            editMeshLoopCut(bm, edge, {
                numberCuts: c.params.number_cuts,
                smoothness: c.params.smoothness,
                falloff: c.params.falloff ? FALLOFF[c.params.falloff] : undefined,
            })
            expect(bm.validate()).toEqual([])
            expect(compareExact(meshOf(bm), c.output)).toEqual([])
            const sel = (s: Iterable<{hflag: number}>) => [...s].flatMap((x, i) => x.hflag & ElemFlag.Select ? [i] : [])
            expect({verts: sel(bm.verts), edges: sel(bm.edges), faces: sel(bm.faces)}).toEqual(c.selected)
            const mode = (['VERT', 'EDGE', 'FACE'] as const).filter(m => bm.selectMode & MODE[m])
            expect(mode).toEqual(c.selectModeAfter)
        })
    }
})

describe('Loop Cut and Slide: the macro switch to edge mode (editmesh_loopcut.cc:221)', () => {
    it('in vertex mode with several cuts the macro switches to edge select mode', () => {
        const c = fixture.cases.find(x => x.name === 'cube vertical edge cuts 3 VERT')!
        const {bm, edge} = build(c.input)
        selectModeSet(bm, SelectMode.Vertex)
        const res = editMeshLoopCut(bm, edge, {numberCuts: 3, isMacro: true})
        expect(bm.selectMode).toBe(SelectMode.Edge)
        expect(res.selectModeBefore).toBe(SelectMode.Vertex)
        // The new loops' edges and nothing else: 3 loops of 4.
        expect(bm.totedgesel).toBe(12)
        expect(bm.totfacesel).toBe(0)
    })
})

describe('the ring preview (editmesh_preselect_edgering.cc:347)', () => {
    const cube = () => build({
        positions: [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]],
        faces: [[0, 1, 3, 2], [2, 3, 7, 6], [6, 7, 5, 4], [4, 5, 1, 0], [2, 6, 4, 0], [7, 3, 1, 5]],
        edge: [0, 1],
        meshEdges: [],
    })
    const key = (p: number[]) => p.map(x => x.toFixed(6)).join(',')

    it('draws one closed loop per cut across the ring of a vertical cube edge', () => {
        const {edge} = cube()
        for (const n of [1, 3]) {
            const {edges, verts} = edgeringPreviewFromEdge(edge, n)
            expect(verts).toEqual([])
            // Four ring edges, closed: four segments per cut.
            expect(edges.length).toBe(4 * n)
            for (let i = 1; i <= n; i++) {
                const z = -1 + 2 * i / (n + 1)
                const level = edges.filter(([a]) => Math.abs(a[2] - z) < 1e-9)
                expect(level.length).toBe(4)
                // Every segment lies on the cube's side at that height and joins two ring edges' points,
                // never across a face diagonally (`edgering_find_order`): the ends share x or y.
                for (const [a, b] of level) {
                    expect(b[2]).toBeCloseTo(z, 9)
                    expect(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9).toBe(true)
                    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(2, 9)
                }
                // And they chain into one closed loop: each point is the end of exactly two segments.
                const count = new Map<string, number>()
                for (const [a, b] of level) for (const p of [a, b]) count.set(key(p), (count.get(key(p)) ?? 0) + 1)
                expect([...count.values()]).toEqual([2, 2, 2, 2])
            }
        }
    })

    it('marks points along the edge alone when it has no quad (update_verts_from_edge)', () => {
        const {edge} = build({
            positions: [[0, 0, 0], [1, 0, 0], [0.7, 0.8, 0.1], [-0.3, 1, 0], [-1, 0.2, 0]],
            faces: [[0, 1, 2], [0, 2, 3], [0, 3, 4]],
            edge: [0, 2],
            meshEdges: [],
        })
        const {edges, verts} = edgeringPreviewFromEdge(edge, 2)
        expect(edges).toEqual([])
        expect(verts.length).toBe(2)
        const a = [edge.v1.x, edge.v1.y, edge.v1.z], b = [edge.v2.x, edge.v2.y, edge.v2.z]
        verts.forEach((p, i) => p.forEach((c, k) => expect(c).toBeCloseTo(a[k] + (b[k] - a[k]) * (i + 1) / 3, 9)))
    })

    it('an open ring has no closing segment', () => {
        const {edge} = build({
            positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0]],
            faces: [[0, 1, 4, 3], [1, 2, 5, 4]],
            edge: [1, 4],
            meshEdges: [],
        })
        // Three ring edges (x = 0, 1, 2), two quads between them: two segments per cut.
        expect(edgeringPreviewFromEdge(edge, 1).edges.length).toBe(2)
        expect(edgeringPreviewFromEdge(edge, 2).edges.length).toBe(4)
    })
})
