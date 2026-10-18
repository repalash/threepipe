/**
 * Ground-truth parity for `gridFill` (`bmesh.ops.grid_fill`) and `gridFillSelection` (edit-mode
 * `bpy.ops.mesh.fill_grid`), from `fixtures/bmesh-ops-gridfill.json`
 * (`fixtures/gen-bmesh-ops-gridfill.py`, Blender 3.4.1).
 *
 * Compared: every vertex position, every face with its winding, every edge, and for the edit-mode
 * cases the selection afterwards; plus per face the smooth flag, the material index and the corner
 * UVs, and per vertex the float layer `w` - so the corner (`bm_loop_interp_from_grid_boundary_*`) and
 * vertex interpolation are checked, not just the positions.
 *
 * Version differences, from reading the 3.4.1 sources (`bmo_fill_grid.c`, `editmesh_tools.c`):
 * - `bmo_fill_grid` is the same in 3.4.1 apart from syntax.
 * - 3.4.1's `bmesh.ops` does not raise on a `BMO_ERROR_CANCEL`; the op-level refusals in the fixture
 *   are silent (no faces, mesh unchanged). Their messages are asserted from the current source.
 * - `edbm_fill_grid_prepare`'s span calculation changed: 3.4.1 tags the four sharpest vertices and
 *   takes the first tagged one in the first half of the loop; the current source excludes the start
 *   and its opposite vertex, takes the sharpest remaining one, and when that lies in the second half
 *   counts the span from it backwards (`start`, `editmesh_tools.cc:4914`). They agree when the
 *   sharpest remaining corner is in the first half. For every calculated-span case the generator
 *   works out both versions' rails (`span_choices`, a transliteration of the two span blocks) and,
 *   where they differ, also runs the current source's rails as an explicit span and offset - which
 *   both versions handle identically - recording it as `currentEquivalent`. Those cases are asserted
 *   against that run, and against 3.4.1's own run to differ.
 * - 3.4.1 has no split-join path (Grid Fill over selected faces, `edbm_fill_grid_split_join_*`);
 *   it is checked by hand at the end.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, FixtureInput, FixtureMesh, loadFixture, meshOf, PARITY_TOL, setRawSelection} from './parity-util'
import {gridFill, gridFillSelection, GridFillSelectionOptions} from '../src/ops/gridFill'
import {BMesh} from '../src/bmesh/BMesh'
import {BMFace, BMVert} from '../src/bmesh/types'
import {ElemFlag, SelectMode} from '../src/constants'
import {getValue, setValue} from '../src/bmesh/customdata'
import {faceSelectSet, selectHistoryStore} from '../src/bmesh/marking'
import {diskEdgeExists, radialLoops} from '../src/bmesh/structure'

interface Out extends FixtureMesh {
    smooth: boolean[]
    mat: number[]
    uv?: number[][][]
    w?: number[]
}

type LayerInput = FixtureInput & {uv: number[][][] | null, w: number[] | null, smooth?: number[] | null}

interface OpCase {
    name: string
    kind: 'op'
    params: {mat_nr?: number, use_smooth?: boolean, use_interp_simple?: boolean}
    input: LayerInput
    fillEdges: number[][]
    facesOut: number
    output: Out
}

interface EditCase {
    name: string
    kind: 'edit'
    mode: 'VERT' | 'EDGE' | 'FACE'
    props: {span?: number, offset?: number, use_interp_simple?: boolean}
    input: LayerInput
    active: number | null
    entered: {verts: number[], edges: number[][], faces: number[]}
    output: Out
    /** The fixture case running the current source's calculated rails explicitly (see above). */
    currentEquivalent?: string
}

const fixture = loadFixture<OpCase | EditCase>('bmesh-ops-gridfill.json')
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}
const SELECT_TWO = 'Select two edge loops or a single closed edge loop from which two edge loops can be calculated'

/** Refusals: 3.4.1's `bmesh.ops` is silent about them, so the messages come from the source. */
const OP_ERRORS: Record<string, string> = {
    'strips on the loops, rails run round the strip': 'Connecting edge loops overlap', // bmo_fill_grid.cc:683
    'one loop only': SELECT_TWO, // :611
    'three loops': SELECT_TWO,
    'single edge': SELECT_TWO,
    'closed loops': 'Closed loops unsupported', // :636
    'loops not connected': 'Loops are not connected by wire/boundary edges', // :675
    'rails overlap': 'Connecting edge loops overlap',
}
/** Edit-mode refusals: Blender printed these as `Info:` reports while writing the fixture. */
const EDIT_ERRORS: Record<string, string> = {
    'odd closed loop of 7': SELECT_TWO,
    'one open loop': SELECT_TWO,
    'single edge': SELECT_TWO,
    'closed loop inside faces': 'Loops are not connected by wire/boundary edges',
    'nothing selected': SELECT_TWO,
}
/**
 * Calculated-span cases where the two versions pick different rails that still make the same grid:
 * with the active vertex in the middle of a 3-edge side, the current source makes the two 5-edge
 * runs the rails (span 5 from offset 1) and 3.4.1 makes the two single edges the rails (span 1) -
 * either way a 1 x 5 strip with no inner vertices, and the same quads.
 */
const SAME_GRID_BOTH_VERSIONS = new Set(['hole in grid, active vertex'])

function addLayers(bm: BMesh, verts: BMVert[], faces: BMFace[], input: LayerInput): void {
    for (const i of input.smooth ?? []) faces[i].hflag |= ElemFlag.Smooth
    if (input.uv) {
        const uv = bm.addLayer('loop', 'UVMap', 'float2')
        faces.forEach((f, i) => f.loops().forEach((l, c) => setValue(l, bm.ldata, uv, input.uv![i][c])))
    }
    if (input.w) {
        const w = bm.addLayer('vert', 'w', 'float')
        verts.forEach((v, i) => setValue(v, bm.vdata, w, [input.w![i]]))
    }
}

/**
 * The per-face and per-vertex data, compared through the same vertex pairing `compareMeshes` uses
 * (geometry has to agree first; this runs after it).
 */
function compareLayers(bm: BMesh, want: Out): string[] {
    const problems: string[] = []
    const verts = [...bm.verts]
    const used = new Array(verts.length).fill(false)
    const map: BMVert[] = want.positions.map(w => {
        const j = verts.findIndex((v, k) => !used[k] && Math.abs(v.x - w[0]) < PARITY_TOL
            && Math.abs(v.y - w[1]) < PARITY_TOL && Math.abs(v.z - w[2]) < PARITY_TOL)
        used[j] = true
        return verts[j]
    })
    const wLayer = bm.vdata.get('w')
    if (want.w && wLayer) {
        want.w.forEach((x, i) => {
            const got = getValue(map[i], wLayer)[0]
            if (Math.abs(got - x) > PARITY_TOL) problems.push(`w of vertex ${i}: got ${got}, Blender ${x}`)
        })
    }
    const uvLayer = bm.ldata.get('UVMap')
    const facesLeft = new Set(bm.faces)
    want.faces.forEach((fv, fi) => {
        const vs = fv.map(i => map[i])
        const f = [...facesLeft].find(g => {
            const gv = g.verts()
            if (gv.length !== vs.length) return false
            const o = gv.indexOf(vs[0])
            return o >= 0 && vs.every((v, k) => gv[(o + k) % gv.length] === v)
        })
        if (!f) {
            problems.push(`face ${fi} not found`)
            return
        }
        facesLeft.delete(f)
        if (((f.hflag & ElemFlag.Smooth) !== 0) !== want.smooth[fi]) problems.push(`face ${fi} smooth: Blender ${want.smooth[fi]}`)
        if (f.matNr !== want.mat[fi]) problems.push(`face ${fi} material: got ${f.matNr}, Blender ${want.mat[fi]}`)
        if (want.uv && uvLayer) {
            const loops = f.loops()
            const o = loops.findIndex(l => l.v === vs[0])
            want.uv[fi].forEach((uv, k) => {
                const got = getValue(loops[(o + k) % loops.length], uvLayer)
                if (Math.abs(got[0] - uv[0]) > PARITY_TOL || Math.abs(got[1] - uv[1]) > PARITY_TOL) {
                    problems.push(`face ${fi} corner ${k} uv: got [${got.map(x => x.toFixed(5))}], Blender [${uv}]`)
                }
            })
        }
    })
    return problems
}

function editOptions(p: EditCase['props']): GridFillSelectionOptions {
    return {span: p.span, offset: p.offset, useInterpSimple: p.use_interp_simple}
}

function runEdit(c: EditCase) {
    const {bm, verts, faces} = buildInput({...c.input, select: undefined})
    addLayers(bm, verts, faces, c.input)
    bm.selectMode = MODE[c.mode]
    setRawSelection(bm, verts, faces, c.entered)
    if (c.active !== null) selectHistoryStore(bm, verts[c.active])
    const r = gridFillSelection(bm, editOptions(c.props))
    return {bm, r}
}

const opCases = fixture.cases.filter((c): c is OpCase => c.kind === 'op')
const editCases = fixture.cases.filter((c): c is EditCase => c.kind === 'edit')

describe(`bmesh.ops.grid_fill matches Blender ${fixture.blender}`, () => {
    for (const c of opCases) {
        it(c.name, () => {
            const {bm, verts, faces, edge} = buildInput(c.input)
            addLayers(bm, verts, faces, c.input)
            const r = gridFill(bm, c.fillEdges.map(([a, b]) => edge(a, b)), {
                matNr: c.params.mat_nr,
                useSmooth: c.params.use_smooth,
                useInterpSimple: c.params.use_interp_simple,
            })
            if (c.facesOut === 0) {
                expect(r).toEqual({ok: false, error: OP_ERRORS[c.name]})
            } else {
                expect(r.ok).toBe(true)
                if (r.ok) expect(r.faces.length).toBe(c.facesOut)
            }
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(meshOf(bm), c.output)).toEqual([])
            expect(compareLayers(bm, c.output)).toEqual([])
        })
    }
})

describe(`mesh.fill_grid (edit mode) matches Blender ${fixture.blender}`, () => {
    for (const c of editCases) {
        it(c.name, () => {
            const {bm, r} = runEdit(c)
            expect(bm.validate()).toEqual([])
            if (EDIT_ERRORS[c.name]) {
                expect(r.ok).toBe(false)
                if (!r.ok) expect(r.error).toBe(EDIT_ERRORS[c.name])
            } else {
                expect(r.ok).toBe(true)
            }
            const want = c.currentEquivalent
                ? editCases.find(x => x.name === c.currentEquivalent)!.output
                : c.output
            expect(compareMeshes(meshOf(bm), want, {selection: true})).toEqual([])
            expect(compareLayers(bm, want)).toEqual([])
            if (c.currentEquivalent && !SAME_GRID_BOTH_VERSIONS.has(c.name)) {
                // ...and 3.4.1's own result for this case really is a different grid.
                expect(compareMeshes(meshOf(bm), c.output, {selection: true})).not.toEqual([])
            }
        })
    }
})

describe('mesh.fill_grid: the span the redo panel shows', () => {
    const byName = (n: string) => editCases.find(c => c.name === n)!
    it('is calculated from the corners when not given', () => {
        // The flat 6 x 4 rectangle (16 vertices): the loop is found as 0, 15, 14, ... so after the
        // start (vertex 0, the first of four equal right angles) the corners sit at positions 3, 8
        // and 11. 8 is opposite and excluded; 3 and 11 tie, the stable sort keeps 3: span 3.
        expect(runEdit(byName('closed rect planar, span auto')).r.span).toBe(3)
        // Curved, corner 11 scores higher than corner 3: span 16 - 11 = 5, counted from edge 3.
        expect(runEdit(byName('closed rect curved, span auto')).r.span).toBe(5)
    })
    it('is clamped to half the loop less one, and kept when given', () => {
        expect(runEdit(byName('closed rect curved, span 40 (clamped to 7)')).r.span).toBe(7)
        expect(runEdit(byName('closed rect curved, span 2 offset 1')).r.span).toBe(2)
    })
    it('is clamped to the property range (1) when nothing could be calculated', () => {
        expect(runEdit(byName('odd closed loop of 7')).r.span).toBe(1)
    })
})

// region hand-checked: the split-join path (not in 3.4.1)

/** A flat nx * ny lattice with a UV per corner that differs per face, faces wound +Z. */
function latticeMesh(nx: number, ny: number, lift?: (x: number, y: number) => number) {
    const bm = new BMesh()
    const verts: BMVert[] = []
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) verts.push(bm.vertCreate(x, y, lift ? lift(x, y) : 0))
    const uv = bm.addLayer('loop', 'UVMap', 'float2')
    const faces: BMFace[] = []
    for (let y = 0; y < ny - 1; y++) {
        for (let x = 0; x < nx - 1; x++) {
            const a = y * nx + x
            const f = bm.faceCreate([verts[a], verts[a + 1], verts[a + nx + 1], verts[a + nx]])
            f.loops().forEach((l, c) => setValue(l, bm.ldata, uv, [l.v.x * 0.1 + faces.length, l.v.y * 0.1 + c * 0.01]))
            faces.push(f)
        }
    }
    return {bm, verts, faces, uv}
}

/** Every edge is used by at most two faces, and two faces sharing an edge run it opposite ways. */
function windingConsistent(bm: BMesh): string[] {
    const problems: string[] = []
    for (const e of bm.edges) {
        const ls = [...radialLoops(e)]
        if (ls.length > 2) problems.push(`edge ${e.id} has ${ls.length} faces`)
        if (ls.length === 2 && ls[0].v === ls[1].v) problems.push(`faces ${ls[0].f.id} and ${ls[1].f.id} disagree`)
    }
    return problems
}

describe('mesh.fill_grid over selected faces (split-join, current source)', () => {
    it('one selected quad is replaced by a 1 x 1 grid with its own corner data, wound as before', () => {
        const {bm, faces, uv} = latticeMesh(4, 4)
        const mid = faces[4]
        const pos = (v: BMVert) => `${v.x},${v.y},${v.z}`
        // The weld keeps the island's copies of the corners (`targetmap` maps hole side -> island), so
        // corners are compared by position.
        const before = mid.loops().map(l => ({at: pos(l.v), uv: getValue(l, uv).map(x => +x.toFixed(6))}))
        faceSelectSet(bm, mid, true)
        const r = gridFillSelection(bm)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.span).toBe(1)
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([16, 24, 9])
        expect(windingConsistent(bm)).toEqual([])
        expect(bm.faces.has(mid)).toBe(false)
        expect(r.faces.length).toBe(1)
        const f = r.faces[0]
        // Same corners in the same winding (the grid is built inside out on the island, then reversed).
        const fl = f.loops()
        const o = fl.findIndex(l => pos(l.v) === before[0].at)
        expect(o).toBeGreaterThanOrEqual(0)
        expect(before.map((b, k) => pos(fl[(o + k) % 4].v) === b.at)).toEqual([true, true, true, true])
        // The corner UVs are the replaced face's, not its neighbours'.
        expect(before.map((b, k) => getValue(fl[(o + k) % 4], uv).map(x => +x.toFixed(6)))).toEqual(before.map(b => b.uv))
        // Selected: the new face and its corners and edges, nothing else.
        expect(f.hflag & ElemFlag.Select).toBeTruthy()
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([4, 4, 1])
    })

    it('a 2 x 2 region with a lifted middle is refilled flat, welded into the hole', () => {
        const {bm, verts, faces} = latticeMesh(5, 5, (x, y) => (x === 2 && y === 2 ? 1 : 0))
        for (const i of [5, 6, 9, 10]) faceSelectSet(bm, faces[i], true)
        const r = gridFillSelection(bm)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.span).toBe(2)
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([25, 40, 16])
        expect(windingConsistent(bm)).toEqual([])
        // The lifted vertex went with the island; the new middle vertex is interpolated from the ring.
        expect(bm.verts.has(verts[12])).toBe(false)
        const middle = [...bm.verts].find(v => Math.abs(v.x - 2) < 1e-9 && Math.abs(v.y - 2) < 1e-9)!
        expect(Math.abs(middle.z)).toBeLessThan(1e-9)
        // Every face still faces +Z (the boundary ring and the outside were never touched).
        for (const f of bm.faces) {
            const [a, b, c] = f.verts()
            expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0)
        }
        expect(r.faces.length).toBe(4)
        expect(bm.totfacesel).toBe(4)
        // The outside of the grid is untouched: its own vertices and edges survive.
        expect(diskEdgeExists(verts[0], verts[1])).not.toBeNull()
    })

    it('a selected face on the mesh border: its border edges are deleted by the split and kept as the island\'s', () => {
        // The corner face's two outer edges have no unselected face, so `bmo_split_exec` deletes them
        // and keys `boundary_map.out` by the island edge itself (`e == e_dst`, #142633): those edges
        // only get selected, and only the two inner corners are welded.
        const {bm, faces, uv} = latticeMesh(3, 3)
        const corner = faces[0]
        const pos = (v: BMVert) => `${v.x},${v.y},${v.z}`
        const before = corner.loops().map(l => ({at: pos(l.v), uv: getValue(l, uv).map(x => +x.toFixed(6))}))
        faceSelectSet(bm, corner, true)
        const r = gridFillSelection(bm)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([9, 12, 4])
        expect(windingConsistent(bm)).toEqual([])
        const fl = r.faces[0].loops()
        const o = fl.findIndex(l => pos(l.v) === before[0].at)
        expect(before.map((b, k) => pos(fl[(o + k) % 4].v) === b.at)).toEqual([true, true, true, true])
        expect(before.map((b, k) => getValue(fl[(o + k) % 4], uv).map(x => +x.toFixed(6)))).toEqual(before.map(b => b.uv))
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([4, 4, 1])
    })

    it('a refused fill welds the island back: same geometry, the faces selected again', () => {
        const {bm, faces} = latticeMesh(4, 4)
        // Two faces apart: two closed loops, "Closed loops unsupported".
        faceSelectSet(bm, faces[0], true)
        faceSelectSet(bm, faces[8], true)
        const r = gridFillSelection(bm)
        expect(r).toEqual({ok: false, error: 'Closed loops unsupported', span: 1})
        expect(bm.validate()).toEqual([])
        expect([bm.totvert, bm.totedge, bm.totface]).toEqual([16, 24, 9])
        expect(windingConsistent(bm)).toEqual([])
        expect([bm.totvertsel, bm.totedgesel, bm.totfacesel]).toEqual([8, 8, 2])
    })
})

// endregion
