/**
 * Ground-truth parity for the dissolve ports against Blender, from `fixtures/bmesh-ops-dissolve.json`
 * (`fixtures/gen-bmesh-ops-dissolve.py`):
 * - `bmesh.ops.dissolve_verts / dissolve_edges / dissolve_faces / dissolve_limit` against
 *   `dissolveVerts` / `dissolveEdges` / `dissolveFaces` / `dissolveLimit` - geometry, every edge, every
 *   face with its winding, and the operator's `region` output where it has one;
 * - the edit-mode `bpy.ops.mesh.dissolve_verts / _edges / _faces / _mode / _limited` against the
 *   selection-level functions, starting from the selection edit mode held on entering, and comparing
 *   the selection afterwards too.
 *
 * The fixture was written by Blender 3.4.1; the ports follow the current source. Where the two
 * differ the case is listed in {@link VERSION_DIFFERS} with the reason, and the current behaviour is
 * asserted by hand in the second `describe` block.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, FixtureInput, FixtureMesh, loadFixture, meshOf, PARITY_TOL, setRawSelection} from './parity-util'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../src/bmesh/types'
import {ElemFlag, SelectMode} from '../src/constants'
import {getValue, setValue} from '../src/bmesh/customdata'
import {vertHideSet} from '../src/bmesh/marking'
import {normalsUpdate} from '../src/ops/bevel-bmquery'
import {dissolveFaces, dissolveFacesSelection, DissolveSelectionResult} from '../src/ops/dissolve'
import {dissolveEdges, dissolveEdgesSelection, dissolveModeSelection, dissolveVerts, dissolveVertsSelection} from '../src/ops/dissolveEdges'
import {dissolveLimit, DissolveDelimit, dissolveLimitedSelection} from '../src/ops/dissolveLimit'
import {Heap as BLIHeap} from '../src/math/heap'

interface Extras {
    seams?: number[][]
    sharp?: number[][]
    mat?: number[]
    uv?: number[][][]
}

interface OpCase {
    kind: 'op'
    name: string
    op: 'dissolve_verts' | 'dissolve_edges' | 'dissolve_faces' | 'dissolve_limit'
    params: Record<string, any>
    sel: {verts?: number[], edges?: number[][], faces?: number[]}
    input: FixtureInput
    extras: Extras
    region: number[] | null
    output: FixtureMesh & {uvs: number[][][] | null}
}

interface EditCase {
    kind: 'edit'
    name: string
    mode: 'VERT' | 'EDGE' | 'FACE'
    op: 'dissolve_verts' | 'dissolve_edges' | 'dissolve_faces' | 'dissolve_mode' | 'dissolve_limited'
    props: Record<string, any>
    input: FixtureInput & {hide: number[]}
    extras: Extras
    entered: {verts: number[], edges: number[][], faces: number[]}
    result: string[]
    output: FixtureMesh & {uvs: number[][][] | null}
}

type Case = OpCase | EditCase

const fixture = loadFixture<Case>('bmesh-ops-dissolve.json')
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}
const DELIMIT: Record<string, number> = {
    NORMAL: DissolveDelimit.Normal, MATERIAL: DissolveDelimit.Material, SEAM: DissolveDelimit.Seam,
    SHARP: DissolveDelimit.Sharp, UV: DissolveDelimit.UV,
}
const delimitOf = (names: string[] | undefined) => (names ?? []).reduce((m, n) => m | DELIMIT[n], 0)

/**
 * Cases where Blender 3.4.1's operator is not the current source's, so the fixture is not the ground
 * truth for the port. Each is asserted against the current source by hand below.
 */
const VERSION_DIFFERS = new Map<string, string>([
    // 3.4.1 `bmo_dissolve_edges_exec` marked every vertex that did not start as an edge pair and
    // collapsed it if the joins left it with two edges; the current source skips a vertex where the
    // dissolved edges only touch an unselected face's corner (`bmo_vert_touches_unselected_face` with
    // two tagged edges there, `bmo_dissolve.cc:579`). Here vertex 6 touches quad 2-3-7-6 that way, so
    // 3.4.1 collapses it (15 vertices, that quad a triangle) and the current source keeps it.
    ['edges grid corner-touching pair', 'dissolve_edges vertex marking (3.4.1 collapses the corner vertex)'],
    // 3.4.1 `BM_faces_join` had no double-face check and kept both the joined face and the existing quad
    // on the same four vertices; the current source finds the double and reuses the existing face
    // (`bmesh_core.cc:1379`, `bmo_dissolve.cc:306`).
    ['faces two triangles over an existing quad', 'BM_faces_join double reuse (3.4.1 keeps a duplicate face)'],
])

function applyExtras(bm: BMesh, faces: BMFace[], edge: (a: number, b: number) => BMEdge, extras: Extras): void {
    for (const [a, b] of extras.seams ?? []) edge(a, b).hflag |= ElemFlag.Seam
    for (const [a, b] of extras.sharp ?? []) edge(a, b).hflag &= ~ElemFlag.Smooth
    ;(extras.mat ?? []).forEach((m, i) => faces[i].matNr = m)
    if (extras.uv) {
        const layer = bm.addLayer('loop', 'UVMap', 'float2')
        extras.uv.forEach((uvs, fi) => faces[fi].loops().forEach((l, k) => setValue(l, bm.ldata, layer, uvs[k])))
    }
}

/** Blender's `bmesh.ops` slot defaults, with the case's parameters over them. */
function runOp(bm: BMesh, c: OpCase, verts: BMVert[], faces: BMFace[], edge: (a: number, b: number) => BMEdge): BMFace[] | null {
    const p = c.params
    const selV = (c.sel.verts ?? []).map(i => verts[i])
    const selE = (c.sel.edges ?? []).map(([a, b]) => edge(a, b))
    const selF = (c.sel.faces ?? []).map(i => faces[i])
    switch (c.op) {
    case 'dissolve_verts':
        dissolveVerts(bm, selV, {useFaceSplit: !!p.use_face_split, useBoundaryTear: !!p.use_boundary_tear})
        return null
    case 'dissolve_edges':
        dissolveEdges(bm, selE, {useVerts: !!p.use_verts, useFaceSplit: !!p.use_face_split, angleThreshold: Math.PI, usePreserveQuads: false})
        // `dissolve_edges` declares `region.out` but `bmo_dissolve_edges_exec` never fills it.
        return []
    case 'dissolve_faces':
        return dissolveFaces(bm, selF, {useVerts: !!p.use_verts})
    case 'dissolve_limit':
        return dissolveLimit(bm, selV, selE, {
            angleLimit: p.angle_limit ?? 0, useDissolveBoundaries: !!p.use_dissolve_boundaries, delimit: delimitOf(p.delimit),
        })
    }
}

function runEdit(bm: BMesh, c: EditCase): DissolveSelectionResult {
    const p = c.props
    switch (c.op) {
    case 'dissolve_verts':
        return dissolveVertsSelection(bm, {useFaceSplit: p.use_face_split, useBoundaryTear: p.use_boundary_tear})
    case 'dissolve_edges':
        return dissolveEdgesSelection(bm, {useVerts: p.use_verts, useFaceSplit: p.use_face_split})
    case 'dissolve_faces':
        return dissolveFacesSelection(bm, {useVerts: p.use_verts})
    case 'dissolve_mode':
        return dissolveModeSelection(bm, bm.selectMode, {useVerts: p.use_verts, useFaceSplit: p.use_face_split, useBoundaryTear: p.use_boundary_tear})
    case 'dissolve_limited':
        return dissolveLimitedSelection(bm, {
            angleLimit: p.angle_limit, useDissolveBoundaries: p.use_dissolve_boundaries,
            delimit: p.delimit ? delimitOf(p.delimit) : undefined,
        })
    }
}

/**
 * Compare every face's corner UVs with Blender's (`output.uvs`, written when the mesh has a UV map):
 * vertices are paired by position as in `compareMeshes`, each Blender face is found among ours as the
 * same cyclic vertex sequence, and the UVs are compared corner by corner.
 */
function compareUvs(bm: BMesh, want: FixtureMesh & {uvs?: number[][][] | null}): string[] {
    if (!want.uvs) return []
    const layer = bm.ldata.get('UVMap')
    if (!layer) return ['no UV layer']
    const got = meshOf(bm)
    const used = new Array(got.positions.length).fill(false)
    const map = want.positions.map(w => {
        const j = got.positions.findIndex((g, k) => !used[k] && g.every((x, a) => Math.abs(x - w[a]) < PARITY_TOL))
        if (j >= 0) used[j] = true
        return j
    })
    const gotFaces = [...bm.faces]
    const problems: string[] = []
    want.faces.forEach((wf, i) => {
        const mapped = wf.map(j => map[j])
        let found = false
        for (let fi = 0; fi < gotFaces.length && !found; fi++) {
            const gv = got.faces[fi]
            if (gv.length !== mapped.length) continue
            for (let k = 0; k < gv.length && !found; k++) {
                if (!mapped.every((m, c) => gv[(k + c) % gv.length] === m)) continue
                found = true
                const loops = gotFaces[fi].loops()
                mapped.forEach((_, c) => {
                    const uv = getValue(loops[(k + c) % loops.length], layer)
                    const w = want.uvs![i][c]
                    if (Math.abs(uv[0] - w[0]) > PARITY_TOL || Math.abs(uv[1] - w[1]) > PARITY_TOL) {
                        problems.push(`face ${i} corner ${c}: uv [${uv.map(x => x.toFixed(4))}], Blender [${w}]`)
                    }
                })
            }
        }
        if (!found) problems.push(`face ${i} not found`)
    })
    return problems
}

/** Compare `region.out` as a face set, through the same vertex pairing as the geometry. */
function compareRegion(got: ReturnType<typeof meshOf>, gotRegion: BMFace[], bm: BMesh, want: FixtureMesh, wantRegion: number[]): string[] {
    const faceIndex = new Map([...bm.faces].map((f, i) => [f, i]))
    const g = {...got, selected: {verts: [], edges: [], faces: gotRegion.map(f => faceIndex.get(f)!)}}
    const w = {...want, selected: {verts: [], edges: [], faces: wantRegion}}
    return compareMeshes(g, w, {selection: true}).map(s => 'region: ' + s)
}

describe(`dissolve matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        if (VERSION_DIFFERS.has(c.name)) continue
        it(`${c.kind} ${c.name}`, () => {
            if (c.kind === 'op') {
                const {bm, verts, faces, edge} = buildInput(c.input)
                applyExtras(bm, faces, edge, c.extras)
                normalsUpdate(bm) // `bm.normal_update()` in the generator
                const region = runOp(bm, c, verts, faces, edge)
                expect(bm.validate()).toEqual([])
                const got = meshOf(bm)
                expect(compareMeshes(got, c.output)).toEqual([])
                expect(compareUvs(bm, c.output)).toEqual([])
                if (c.region && region) expect(compareRegion(got, region, bm, c.output, c.region)).toEqual([])
                else expect(region === null).toBe(c.region === null)
            } else {
                const {bm, verts, faces, edge} = buildInput({...c.input, select: undefined})
                applyExtras(bm, faces, edge, c.extras)
                bm.selectMode = MODE[c.mode]
                for (const i of c.input.hide) vertHideSet(bm, verts[i], true)
                setRawSelection(bm, verts, faces, c.entered)
                runEdit(bm, c)
                expect(bm.validate()).toEqual([])
                expect(compareMeshes(meshOf(bm), c.output, {selection: true})).toEqual([])
                expect(compareUvs(bm, c.output)).toEqual([])
            }
        })
    }
})

/** The input of a fixture case, by name, to build hand-checked variants on. */
function inputOf(name: string): FixtureInput {
    const c = fixture.cases.find(x => x.name === name)
    if (!c) throw new Error(`no fixture case '${name}'`)
    return c.input
}

const facesAsKeys = (bm: BMesh, verts: BMVert[]) => {
    const idx = new Map(verts.map((v, i) => [v, i]))
    return [...bm.faces].map(f => {
        const ids = f.verts().map(v => idx.get(v)!)
        const k = ids.indexOf(Math.min(...ids))
        return [...ids.slice(k), ...ids.slice(0, k)].join(',')
    }).sort()
}

describe('dissolve, current-source behaviour (hand-checked against bmo_dissolve.cc)', () => {
    it('dissolve_edges keeps a vertex the dissolved edges only touch at an unselected corner', () => {
        // VERSION_DIFFERS 'edges grid corner-touching pair'. Edges 5-6 and 6-10 join faces 1, 4 and 5.
        // Vertex 6 is left on edges 2-6 and 6-7, both of quad 2-3-7-6, so it touches an unselected face
        // and has two tagged edges: not marked. Vertices 5 and 10 are marked (one tagged edge each) but
        // keep three edges, so nothing collapses.
        const {bm, verts, edge} = buildInput(inputOf('edges grid corner-touching pair'))
        normalsUpdate(bm)
        expect(dissolveEdges(bm, [edge(5, 6), edge(6, 10)], {useVerts: true, usePreserveQuads: false})).toBe(2)
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([16, 22, 7])
        expect(bm.verts.has(verts[6])).toBe(true)
        expect(facesAsKeys(bm, verts)).toContain('1,2,6,7,11,10,9,5')
        expect(facesAsKeys(bm, verts)).toContain('2,3,7,6')
    })

    it('dissolve_faces reuses an existing face the join would duplicate', () => {
        // VERSION_DIFFERS 'faces two triangles over an existing quad'.
        const {bm, faces} = buildInput(inputOf('faces two triangles over an existing quad'))
        const quad = faces[2]
        const region = dissolveFaces(bm, [faces[0], faces[1]])
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([4, 4, 1])
        expect(region).toEqual([quad])
        expect(bm.faces.has(quad)).toBe(true)
    })

    /** A flat 2x2 grid whose centre vertex 4 is pushed 0.3 along x: the middle column bends by 2*atan(0.3). */
    function kinkGrid() {
        const co = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1.3, 1, 0], [2, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]]
        const faces = [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]]
        return buildInput({positions: co, faces})
    }
    const KINK = 2 * Math.atan(0.3) // 33.4 degrees

    it('angle_threshold keeps a two-edge vertex whose bend exceeds it, and dissolves straighter ones', () => {
        // Dissolving the middle row 3-4-5: the boundary vertices 3 and 5 are left straight (bend 0) and
        // go; vertex 4 is left between 1-4 and 4-7, bent by KINK. Flat faces, so the blended angle is
        // the plain one (`raw_factor` 0 and the in-plane angle).
        for (const [threshold, kept4] of [[KINK - 0.02, true], [KINK + 0.02, false]] as const) {
            const {bm, verts, edge} = kinkGrid()
            normalsUpdate(bm)
            dissolveEdges(bm, [edge(3, 4), edge(4, 5)], {useVerts: true, angleThreshold: threshold})
            expect(bm.validate()).toEqual([])
            expect(bm.verts.has(verts[3])).toBe(false)
            expect(bm.verts.has(verts[5])).toBe(false)
            expect(bm.verts.has(verts[4])).toBe(kept4)
            expect(bm.totface).toBe(2)
        }
    })

    it('angle_threshold measures a two-edge vertex around its normal on unfolded surfaces', () => {
        // `bmo_vert_calc_edge_angle_blended`: the kink grid with vertex 4 lifted 0.3 instead of
        // pushed sideways. Chain 1-4-7 bends 33.4 degrees, but in the direction of the vertex normal
        // (+z, by symmetry); the two merged faces meet at far less than 90 degrees (`raw_factor` 0), so
        // the angle used is the one seen down the normal - straight - and a 20 degree threshold
        // dissolves it. The raw angle alone would keep it.
        const co = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0.3], [2, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]]
        const {bm, verts, edge} = buildInput({positions: co, faces: [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]]})
        normalsUpdate(bm)
        dissolveEdges(bm, [edge(3, 4), edge(4, 5)], {useVerts: true, angleThreshold: 20 * Math.PI / 180})
        expect(bm.validate()).toEqual([])
        expect(bm.verts.has(verts[4])).toBe(false)
        expect([bm.totvert, bm.totface]).toEqual([6, 2])
    })

    it('angle_threshold 0 turns use_verts off', () => {
        const {bm, edge} = kinkGrid()
        normalsUpdate(bm)
        dissolveEdges(bm, [edge(3, 4), edge(4, 5)], {useVerts: true, angleThreshold: 0})
        expect([bm.totvert, bm.totface]).toEqual([9, 2])
    })

    it('verts of a selected edge chain skip the angle test', () => {
        // Dissolve 3-4 and 4-5 after first making vertex 4 a two-edge vertex of a chain: a wire chain
        // 0-1-2 bent at 1, both edges selected. They have no faces, so nothing joins; vertex 1 is an
        // edge pair but no face pair marks it, and wire edges do not dissolve - unchanged.
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0), b = bm.vertCreate(1, 0, 0), c = bm.vertCreate(1, 1, 0)
        const e1 = bm.edgeCreate(a, b), e2 = bm.edgeCreate(b, c)
        expect(dissolveEdges(bm, [e1, e2], {useVerts: true, angleThreshold: 0.1})).toBe(0)
        expect([bm.totvert, bm.totedge]).toEqual([3, 2])
    })

    it('use_preserve_quads keeps both corners when the diagonal of two triangles is dissolved', () => {
        // The isolated quad split along 0-2: each diagonal end has the diagonal as its only tagged
        // edge and both faces are triangles, so with use_preserve_quads neither is marked and the quad
        // stays a quad. Without it both are marked, both are left on two edges and both collapse: the
        // quad becomes a triangle, then a two-sided face that is killed, leaving one wire edge - the
        // fixture case 'edges quad-tri diagonal' (3.4.1, no preserve) shows exactly that.
        for (const [preserve, counts] of [[true, [4, 4, 1]], [false, [2, 1, 0]]] as const) {
            const {bm, edge} = buildInput(inputOf('edges quad-tri diagonal'))
            normalsUpdate(bm)
            dissolveEdges(bm, [edge(0, 2)], {useVerts: true, usePreserveQuads: preserve})
            expect(bm.validate()).toEqual([])
            expect([bm.totvert, bm.totedge, bm.totface]).toEqual(counts)
        }
    })

    it('Dissolve Edges reports "No edges dissolved" when nothing changed or nothing is selected', () => {
        // The 3.4.1 operator had no such report; the current one does (`editmesh_tools.cc:6155`).
        const {bm, verts, faces} = buildInput({...inputOf('edges grid boundary only (no faces join)'), select: undefined})
        bm.selectMode = SelectMode.Edge
        expect(dissolveEdgesSelection(bm)).toEqual({ok: false, error: 'No edges dissolved'})
        setRawSelection(bm, verts, faces, {verts: [0, 1], edges: [[0, 1]], faces: []})
        expect(dissolveEdgesSelection(bm)).toEqual({ok: false, error: 'No edges dissolved'})
        expect(bm.totface).toBe(9)
        setRawSelection(bm, verts, faces, {verts: [4, 5], edges: [[4, 5]], faces: []})
        expect(dissolveEdgesSelection(bm).ok).toBe(true)
        expect(bm.totface).toBe(8)
    })

    it('collapsing a vertex merges the hidden flag of its edges and never leaves a visible edge on a hidden vertex', () => {
        // `bm_vert_collapse_edge_and_merge` (`bmo_dissolve.cc:143`): the wire chain a-b-c, edge a-b
        // visible and selected, edge b-c and vertex c hidden. The merged edge is visible (only one was
        // hidden) and selected (flags are or-ed), then hidden and deselected because c is hidden.
        const bm = new BMesh()
        const a = bm.vertCreate(0, 0, 0), b = bm.vertCreate(1, 0, 0), c = bm.vertCreate(2, 0, 0)
        const ab = bm.edgeCreate(a, b), bc = bm.edgeCreate(b, c)
        ab.hflag |= ElemFlag.Select
        bc.hflag |= ElemFlag.Hidden
        c.hflag |= ElemFlag.Hidden
        expect(dissolveVerts(bm, [b])).toBe(1)
        expect(bm.validate()).toEqual([])
        const [e] = [...bm.edges]
        expect(e.joins(a, c)).toBe(true)
        expect(e.hflag & ElemFlag.Hidden).toBe(ElemFlag.Hidden)
        expect(e.hflag & ElemFlag.Select).toBe(0)
    })

    it('joining keeps the active face', () => {
        // `BM_faces_join` (`bmesh_core.cc:1469`): an active face joined away is replaced by the result.
        const {bm, faces} = buildInput(inputOf('faces grid all noverts'))
        bm.actFace = faces[4]
        const [f] = dissolveFaces(bm, faces)
        expect(bm.actFace).toBe(f)
    })

    it('Limited Dissolve with nothing selected does nothing', () => {
        const {bm} = buildInput({...inputOf('limit flat grid subset'), select: undefined})
        expect(dissolveLimitedSelection(bm)).toEqual({ok: true, changed: false, regionOut: []})
        expect(bm.totface).toBe(9)
    })

    it('Dissolve Selection turns use_verts on unless face select mode is on', () => {
        // Edge mode: the loop cut's end vertices go (use_verts on); face mode: faces only.
        const strip = inputOf('edges strip loop cut verts')
        for (const [mode, nverts] of [[SelectMode.Edge, 8], [SelectMode.Edge | SelectMode.Face, 12]] as const) {
            const {bm, verts, faces} = buildInput({...strip, select: undefined})
            bm.selectMode = mode
            setRawSelection(bm, verts, faces, {verts: [4, 5, 6, 7], edges: [[4, 5], [5, 6], [6, 7]], faces: []})
            dissolveModeSelection(bm)
            expect(bm.validate()).toEqual([])
            expect(bm.totvert).toBe(nverts)
        }
    })
})

describe('BLIHeap', () => {
    it('breaks ties the way BLI_heap does (an equal parent is swapped past on the way up)', () => {
        // Hand-run of BLI_heap.cc: insert a1 b1 c0 d1 -> tree [c, d, b, a]; pops c, a, b, d.
        const heap = new BLIHeap<string>()
        heap.insert(1, 'a')
        heap.insert(1, 'b')
        heap.insert(0, 'c')
        heap.insert(1, 'd')
        const out: string[] = []
        while (!heap.isEmpty()) out.push(heap.popMin())
        expect(out).toEqual(['c', 'a', 'b', 'd'])
    })

    it('remove() lifts the node to the root unconditionally, then pops it', () => {
        const heap = new BLIHeap<string>()
        const nodes = [3, 1, 2, 5, 4].map((v, i) => heap.insert(v, 'n' + i))
        heap.remove(nodes[3])
        heap.nodeValueUpdate(nodes[0], 0)
        const out: string[] = []
        while (!heap.isEmpty()) out.push(heap.popMin())
        expect(out).toEqual(['n0', 'n1', 'n2', 'n4'])
    })
})
