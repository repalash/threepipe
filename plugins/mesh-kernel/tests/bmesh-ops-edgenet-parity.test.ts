/**
 * Ground-truth parity for Fill (`src/ops/fill.ts`, `src/ops/edgenet.ts`) against Blender, from
 * `fixtures/bmesh-ops-edgenet.json` (`fixtures/gen-bmesh-ops-edgenet.py`):
 * - `edit` cases run `edgeFaceAddSelection` against `bpy.ops.mesh.edge_face_add` in edit mode,
 *   starting from the selection Blender held right after entering edit mode;
 * - `bmo` cases run `contextualCreate` / `edgenetFill` / `edgenetPrepare` / `edgeloopFill` against
 *   `bmesh.ops.*` (with `bmesh_edit_end` where Blender's `BMO_op_exec` applies it).
 * Compared: geometry, every edge, every face with its winding, the selection, and per face the
 * smooth flag, material index and hidden flag, hidden verts/edges, and the select history.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, FixtureInput, FixtureMesh, loadFixture, meshOf, setRawSelection} from './parity-util'
import {contextualCreate, edgeFaceAddSelection, edgeloopFill} from '../src/ops/fill'
import {edgenetFill, edgenetPrepare} from '../src/ops/edgenet'
import {bmeshEditEnd} from '../src/ops/bmo'
import {ElemFlag, SelectMode} from '../src/constants'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../src/bmesh/types'
import {diskEdgeExists} from '../src/bmesh/structure'
import {getValue, setValue} from '../src/bmesh/customdata'

type HistEntry = {vert: number} | {edge: number[]} | {face: number}

interface Extra {
    smooth: number[]
    mat: number[]
    hidden: {verts: number[], edges: number[][], faces: number[]}
    history: HistEntry[]
    uv: number[][][] | null
}

interface CaseInput extends FixtureInput {
    smooth: number[]
    mat: number[] | null
    hideFaces?: number[]
    uv?: boolean
}

interface EditCase {
    kind: 'edit'
    name: string
    mode: 'VERT' | 'EDGE' | 'FACE'
    activeMat: number
    input: CaseInput
    entered: {verts: number[], edges: number[][], faces: number[]}
    /** Hidden flags right after entering edit mode. */
    enteredHidden: {verts: number[], edges: number[][], faces: number[]}
    result: string[]
    output: FixtureMesh
    extra: Extra
}

interface BmoCase {
    kind: 'bmo'
    name: string
    op: 'contextual_create' | 'edgenet_fill' | 'edgenet_prepare' | 'edgeloop_fill'
    slots: {geom?: {verts?: number[], edges?: number[][], faces?: number[]}, edges?: number[][], mat_nr?: number, use_smooth?: boolean}
    selectMode: 'VERT' | 'EDGE' | 'FACE'
    input: CaseInput
    outLens: Record<string, number>
    output: FixtureMesh
    extra: Extra
}

type Case = EditCase | BmoCase

const fixture = loadFixture<Case>('bmesh-ops-edgenet.json')
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}

/**
 * Cases whose Blender 3.4.1 result is not the current source's because the code differs between the
 * versions (documented in each entry); they are asserted against the current source below instead.
 */
const VERSION_DIFFERS = new Map<string, string>([
    // `bmo_edgenet_prepare_exec`: 3.4.1 swapped v3/v4 when (v1-v2)x(v1-v4) . (v1-v4)x(v1-v3) < 0;
    // the current source (#143905, `bmo_edgenet.cc:207`) compares the two triangle pairs' normal dots
    // and swaps when dot_24 < dot_13. For v1..v4 = (0,0,0) (2,0,0) (1,1,-1) (2,1,1), by hand:
    // n(v1,v2,v4) = (0,-1,1)/sqrt2, n(v1,v4,v3) = (-2,3,1)/sqrt14, dot_24 = -2/sqrt28 = -0.378;
    // n(v1,v2,v3) = (0,1,1)/sqrt2, n(v1,v3,v4) = (2,-3,-1)/sqrt14, dot_13 = -4/sqrt28 = -0.756.
    // 3.4.1 swaps (dot_24 < 0) and joins 0-3 and 1-2; the current source keeps v1-v3, v2-v4: 0-2, 1-3.
    ['two edges where the bow-tie test changed', 'bowtie'],
    ['edgenet_prepare where the bow-tie test changed', 'bowtie'],
    // `BM_verts_calc_normal_from_cloud_ex`: the current source refines the normal over all vertices
    // in radial order (`bmesh_polygon.cc:975`), 3.4.1 stops at the quad normal. For this non-planar
    // cloud 3.4.1 orders the face 0,4,1,2,3 (the fixture); the current source orders it 0,1,2,3,4
    // (cross-checked with an independent double-precision evaluation of both formulas, which also
    // reproduces 3.4.1's order).
    ['vertex cloud where the normal refine changed the order', 'refine'],
])

function build(input: CaseInput, withSelect = false) {
    // `bmesh_fixture_util.build` selects through BM_elem_select_set (`v.select = True`), as buildInput does.
    const b = buildInput({...input, select: withSelect ? input.select ?? undefined : undefined})
    input.smooth.forEach(i => { b.faces[i].hflag |= ElemFlag.Smooth })
    input.mat?.forEach((m, i) => { b.faces[i].matNr = m })
    if (input.uv) {
        // As the generator: each input face its own UV island, (x/10 + face index, y/10).
        const layer = b.bm.addLayer('loop', 'uv', 'float2')
        b.faces.forEach((f, fi) => {
            for (const l of f.eachLoop()) setValue(l, b.bm.ldata, layer, [Math.fround(l.v.x * 0.1 + fi), Math.fround(l.v.y * 0.1)])
        })
    }
    return b
}

/** Element keys by geometry, so Blender's indices and ours compare without an index map. */
function keyer(bm: BMesh) {
    const verts = [...bm.verts]
    const pos = (v: BMVert) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
    const vKey = (v: BMVert) => pos(v)
    const eKey = (e: BMEdge) => [vKey(e.v1), vKey(e.v2)].sort().join('|')
    const fKey = (f: BMFace) => f.verts().map(vKey).sort().join('|')
    return {verts, vKey, eKey, fKey}
}

/** Blender's extra data, keyed by geometry of Blender's output. */
function wantKeys(out: FixtureMesh, extra: Extra) {
    const vk = (i: number) => out.positions[i].map(x => (Math.round(x * 1e6) / 1e6).toFixed(4)).join(',')
    const ek = (e: number[]) => [vk(e[0]), vk(e[1])].sort().join('|')
    const fk = (i: number) => out.faces[i].map(vk).sort().join('|')
    return {
        smooth: extra.smooth.map(fk).sort(),
        mat: out.faces.map((_, i) => `${fk(i)}=${extra.mat[i]}`).sort(),
        hiddenVerts: extra.hidden.verts.map(vk).sort(),
        hiddenEdges: extra.hidden.edges.map(ek).sort(),
        hiddenFaces: extra.hidden.faces.map(fk).sort(),
        history: extra.history.map(h => 'vert' in h ? `v:${vk(h.vert)}` : 'edge' in h ? `e:${ek(h.edge)}` : `f:${fk(h.face)}`),
        uv: extra.uv ? out.faces.map((f, i) => `${fk(i)}: ${f.map((v, k) => `${vk(v)}=${uvKey(extra.uv![i][k])}`).join(' ')}`).sort() : null,
    }
}

const uvKey = (uv: ArrayLike<number>) => `${uv[0].toFixed(4)},${uv[1].toFixed(4)}`

function gotKeys(bm: BMesh) {
    const {vKey, eKey, fKey} = keyer(bm)
    const faces = [...bm.faces]
    const uv = bm.ldata.get('uv')
    return {
        smooth: faces.filter(f => f.hflag & ElemFlag.Smooth).map(fKey).sort(),
        mat: faces.map(f => `${fKey(f)}=${f.matNr}`).sort(),
        hiddenVerts: [...bm.verts].filter(v => v.hflag & ElemFlag.Hidden).map(vKey).sort(),
        hiddenEdges: [...bm.edges].filter(e => e.hflag & ElemFlag.Hidden).map(eKey).sort(),
        hiddenFaces: faces.filter(f => f.hflag & ElemFlag.Hidden).map(fKey).sort(),
        history: bm.selectHistory.map(h => h.elem instanceof BMVert ? `v:${vKey(h.elem)}`
            : h.elem instanceof BMEdge ? `e:${eKey(h.elem)}` : `f:${fKey(h.elem as BMFace)}`),
        uv: uv ? faces.map(f => `${fKey(f)}: ${f.loops().map(l => `${vKey(l.v)}=${uvKey(getValue(l, uv))}`).join(' ')}`).sort() : null,
    }
}

function runEdit(c: EditCase) {
    const {bm, verts, faces} = build(c.input)
    bm.selectMode = MODE[c.mode]
    // Hidden flags exactly as Blender's edit mode held them (raw, as BM_mesh_bm_from_me sets them).
    for (const i of c.enteredHidden.verts) verts[i].hflag |= ElemFlag.Hidden
    for (const [a, b] of c.enteredHidden.edges) diskEdgeExists(verts[a], verts[b])!.hflag |= ElemFlag.Hidden
    for (const i of c.enteredHidden.faces) faces[i].hflag |= ElemFlag.Hidden
    setRawSelection(bm, verts, faces, c.entered)
    const r = edgeFaceAddSelection(bm, {matNr: c.activeMat})
    return {bm, r}
}

function runBmo(c: BmoCase) {
    const {bm, verts, faces} = build(c.input, true)
    bm.selectMode = MODE[c.selectMode]
    const edge = (p: number[]) => diskEdgeExists(verts[p[0]], verts[p[1]])!
    const lens: Record<string, number> = {}
    if (c.op === 'contextual_create') {
        const g = c.slots.geom!
        const geom = [...(g.verts ?? []).map(i => verts[i]), ...(g.edges ?? []).map(edge), ...(g.faces ?? []).map(i => faces[i])]
        const r = contextualCreate(bm, geom, {matNr: c.slots.mat_nr, useSmooth: c.slots.use_smooth})
        lens.faces = r.facesOut.length
        lens.edges = r.edgesOut.length
    } else if (c.op === 'edgenet_fill') {
        const out = edgenetFill(bm, c.slots.edges!.map(edge), {matNr: c.slots.mat_nr, useSmooth: c.slots.use_smooth})
        bmeshEditEnd(bm, {normalsCalc: true, selectFlush: true}) // bmo_edgenet_fill_def type_flag
        lens.faces = out.length
    } else if (c.op === 'edgenet_prepare') {
        lens.edges = edgenetPrepare(bm, c.slots.edges!.map(edge)).length // type_flag NOP
    } else {
        const out = edgeloopFill(bm, c.slots.edges!.map(edge), {matNr: c.slots.mat_nr, useSmooth: c.slots.use_smooth})
        bmeshEditEnd(bm, {normalsCalc: true, selectFlush: true}) // bmo_edgeloop_fill_def type_flag
        lens.faces = out.length
    }
    return {bm, lens}
}

const cyclicKey = (f: number[]) => {
    let best = 0
    for (let i = 1; i < f.length; i++) if (f[i] < f[best]) best = i
    return [...f.slice(best), ...f.slice(0, best)].join(',')
}
const pairKey = (e: number[]) => [...e].sort((a, b) => a - b).join('-')

describe('Fill: current-source behaviour where Blender 3.4.1 differs', () => {
    const byName = new Map(fixture.cases.map(c => [c.name, c]))
    it('edgenet_prepare keeps the more planar pairing (#143905)', () => {
        for (const name of ['two edges where the bow-tie test changed', 'edgenet_prepare where the bow-tie test changed']) {
            const c = byName.get(name)!
            // The fixture is 3.4.1's pairing.
            expect(c.output.edges!.map(pairKey).sort()).toEqual(['0-1', '0-3', '1-2', '2-3'])
            const bm = c.kind === 'edit' ? runEdit(c).bm : runBmo(c as BmoCase).bm
            expect(bm.validate()).toEqual([])
            const got = meshOf(bm)
            // Vertices are not renumbered by either path, so indices are the input's.
            expect(got.edges.map(pairKey).sort()).toEqual(['0-1', '0-2', '1-3', '2-3'])
            if (c.kind === 'edit') {
                expect(got.faces).toHaveLength(1)
                expect(['0,1,3,2', '0,2,3,1']).toContain(cyclicKey(got.faces[0]))
                expect(got.selected.faces).toEqual([0])
            }
        }
    })
    it('a vertex cloud is ordered around the refined normal', () => {
        const c = byName.get('vertex cloud where the normal refine changed the order') as EditCase
        expect(c.output.faces.map(cyclicKey)).toEqual(['0,4,1,2,3']) // 3.4.1
        const {bm, r} = runEdit(c)
        expect(r.ok).toBe(true)
        expect(bm.validate()).toEqual([])
        expect(meshOf(bm).faces.map(cyclicKey)).toEqual(['0,1,2,3,4'])
    })
})

describe(`Fill matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        if (VERSION_DIFFERS.has(c.name)) continue
        it(`${c.kind}: ${c.name}`, () => {
            let bm: BMesh
            if (c.kind === 'edit') {
                const run = runEdit(c)
                bm = run.bm
                expect(run.r.ok).toBe(c.result.includes('FINISHED'))
            } else {
                const run = runBmo(c)
                bm = run.bm
                expect(run.lens).toEqual(c.outLens)
            }
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(meshOf(bm), c.output, {selection: true})).toEqual([])
            expect(gotKeys(bm)).toEqual(wantKeys(c.output, c.extra))
        })
    }
})
