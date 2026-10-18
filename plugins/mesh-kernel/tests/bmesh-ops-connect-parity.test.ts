/**
 * Ground-truth parity for the connect ports against Blender, from `fixtures/bmesh-ops-connect.json`
 * (`fixtures/gen-bmesh-ops-connect.py`):
 *
 * - `connectVerts` vs `bmesh.ops.connect_verts` and `connectVertPair` vs `bmesh.ops.connect_vert_pair`:
 *   geometry, every edge, every face (with winding), the selection and `edges.out`.
 * - `vertConnectSelection` vs `bpy.ops.mesh.vert_connect` and `vertConnectPathSelection` vs
 *   `bpy.ops.mesh.vert_connect_path`: the same, plus the operator outcome (FINISHED, or CANCELLED with
 *   the reported error) and the select history afterwards. The TS side starts from the selection,
 *   hidden state and history edit mode held after entering (`entered*`).
 *
 * Blender 3.4.1 wrote the fixture; the ported source is current main. Diffing the 3.4.1 sources of
 * these functions against main gives four differences:
 *
 * 1. `BM_face_splits_check_legal` decides whether a cut lies inside the face by a ray-parity test from
 *    the cut's midpoint in 3.4.1, and by the corner angle at both ends of the cut in main. Case
 *    "U cut through the notch" separates them: the cut touches the outline only at two notch corners,
 *    its midpoint is outside, and both ends start inside. 3.4.1 rejects it (the fixture), main keeps it.
 *    Verified by temporarily swapping in the 3.4.1 test: then this case matches Blender and every other
 *    `connect_verts` case still does. Asserted below: the fixture shows the rejection, the port cuts.
 * 2. `bm_vert_connect_select_history` (path of 3+ vertices) restores every path vertex's normal from
 *    before the first cut ahead of each pair (#154197); 3.4.1 recalculates them after the previous
 *    cuts. Case "path cylinder" separates them: the vertex inserted on edge 12-20 by the cut 11-21
 *    moves by 1.9e-4. Verified by temporarily recalculating per pair as 3.4.1 did: then the case
 *    matches exactly. Compared below with a 5e-4 position tolerance (topology, winding, selection and
 *    history still exact); the main position is checked by hand in `src/ops/connect.test.ts` (the vertex
 *    lies on the cutting plane built from the original normals).
 * 3. `connect_vert_pair` refreshes face normals after each edge split in main. It changes no fixture
 *    case (the split faces' normals only move for non-planar faces, and only matter to the legality
 *    projection).
 * 4. `vert_connect_path` refuses mixed and face select histories with their own messages in main;
 *    checked by hand in `src/ops/connect.test.ts`.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, FixtureInput, FixtureMesh, loadFixture, meshOf, PARITY_TOL} from './parity-util'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../src/bmesh/types'
import {ElemFlag, SelectMode} from '../src/constants'
import {selectCountsRecalc} from '../src/bmesh/marking'
import {diskEdgeExists} from '../src/bmesh/structure'
import {normalsUpdate} from '../src/ops/bevel-bmquery'
import {connectVerts, vertConnectPathSelection, vertConnectSelection} from '../src/ops/connect'
import {connectVertPair} from '../src/ops/connectPair'

interface Sel {verts: number[], edges: number[][], faces: number[]}
interface HistoryEntry {type: 'V' | 'E' | 'F', verts: number[]}

interface BmoCase {
    name: string
    kind: 'bmo'
    op: 'connect_verts' | 'connect_vert_pair'
    params: {check_degenerate?: boolean}
    verts: number[]
    facesExclude: number[]
    vertsExclude: number[]
    input: FixtureInput
    output: Required<FixtureMesh>
    edgesOut: number[][]
}

interface EditCase {
    name: string
    kind: 'edit'
    op: 'vert_connect' | 'vert_connect_path'
    mode: 'VERT' | 'EDGE' | 'FACE'
    input: FixtureInput
    entered: Sel
    enteredHidden: Sel
    enteredHistory: HistoryEntry[]
    result: string[]
    error: string | null
    output: Required<FixtureMesh>
    history: HistoryEntry[]
}

const fixture = loadFixture<BmoCase | EditCase>('bmesh-ops-connect.json')

/** Version difference 1 (module comment): 3.4.1 rejected this cut, the current source makes it. */
const CHECK_LEGAL_DIFFERS = 'U cut through the notch, check_degenerate (version difference)'
/** Version difference 2 (module comment): one inserted vertex moves by 1.9e-4. */
const MULTI_CUT_NORMALS_DIFFER = 'path cylinder'
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}

const near = (a: number[], b: number[], tol = PARITY_TOL) => a.every((x, i) => Math.abs(x - b[i]) < tol)

/**
 * Match a list of edges given as index pairs into `wantPositions` against edges of the port, by the
 * positions of their endpoints (either orientation). Returns the problems.
 */
function compareEdgeList(got: BMEdge[], want: number[][], wantPositions: number[][], label: string): string[] {
    const problems: string[] = []
    if (got.length !== want.length) problems.push(`${label}: ${got.length} edges, Blender ${want.length}`)
    const used = new Set<BMEdge>()
    for (const [a, b] of want) {
        const pa = wantPositions[a]
        const pb = wantPositions[b]
        const e = got.find(x => !used.has(x) && (
            (near([x.v1.x, x.v1.y, x.v1.z], pa) && near([x.v2.x, x.v2.y, x.v2.z], pb)) ||
            (near([x.v1.x, x.v1.y, x.v1.z], pb) && near([x.v2.x, x.v2.y, x.v2.z], pa))))
        if (!e) problems.push(`${label}: no edge [${pa.join(', ')}] - [${pb.join(', ')}]`)
        else used.add(e)
    }
    return problems
}

/** The select history as positions, for comparison with Blender's (indices into its output). */
function historyMatches(bm: BMesh, want: HistoryEntry[], wantPositions: number[][], tol = PARITY_TOL): string[] {
    const problems: string[] = []
    if (bm.selectHistory.length !== want.length) {
        return [`history length ${bm.selectHistory.length}, Blender ${want.length}`]
    }
    want.forEach((h, i) => {
        const got = bm.selectHistory[i].elem
        const pos = h.verts.map(j => wantPositions[j])
        const has = (v: BMVert, p: number[]) => near([v.x, v.y, v.z], p, tol)
        if (h.type === 'V') {
            if (!(got instanceof BMVert) || !has(got, pos[0])) problems.push(`history[${i}] is not Blender's vertex`)
        } else if (h.type === 'E') {
            if (!(got instanceof BMEdge) ||
                !((has(got.v1, pos[0]) && has(got.v2, pos[1])) || (has(got.v1, pos[1]) && has(got.v2, pos[0])))) {
                problems.push(`history[${i}] is not Blender's edge`)
            }
        } else if (!(got instanceof BMFace) || got.len !== pos.length ||
            !got.verts().every(v => pos.some(p => has(v, p)))) {
            problems.push(`history[${i}] is not Blender's face`)
        }
    })
    return problems
}

/** Set selection and hidden flags raw, as edit mode held them on entry, and recount. */
function setRawState(bm: BMesh, verts: BMVert[], faces: BMFace[], sel: Sel, hid: Sel): void {
    const edge = (a: number, b: number) => {
        const e = diskEdgeExists(verts[a], verts[b])
        if (!e) throw new Error(`fixture: no edge ${a}-${b}`)
        return e
    }
    for (const x of [...bm.verts, ...bm.edges, ...bm.faces]) x.hflag &= ~(ElemFlag.Select | ElemFlag.Hidden)
    for (const i of hid.verts) verts[i].hflag |= ElemFlag.Hidden
    for (const [a, b] of hid.edges) edge(a, b).hflag |= ElemFlag.Hidden
    for (const i of hid.faces) faces[i].hflag |= ElemFlag.Hidden
    for (const i of sel.verts) verts[i].hflag |= ElemFlag.Select
    for (const [a, b] of sel.edges) edge(a, b).hflag |= ElemFlag.Select
    for (const i of sel.faces) faces[i].hflag |= ElemFlag.Select
    selectCountsRecalc(bm)
}

describe(`connect_verts / connect_vert_pair match Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        if (c.kind !== 'bmo') continue
        it(`${c.op}: ${c.name}`, () => {
            const {bm, verts, faces} = buildInput(c.input)
            // `build` refreshes normals (`bm.normal_update()`), as edit mode keeps them.
            normalsUpdate(bm)
            const vs = c.verts.map(i => verts[i])
            const r = c.op === 'connect_verts'
                ? connectVerts(bm, vs, {checkDegenerate: !!c.params.check_degenerate, facesExclude: c.facesExclude.map(i => faces[i])})
                : connectVertPair(bm, vs, {facesExclude: c.facesExclude.map(i => faces[i]), vertsExclude: c.vertsExclude.map(i => verts[i])})
            expect(bm.validate()).toEqual([])
            expect(r.error).toBe(null)
            if (c.name === CHECK_LEGAL_DIFFERS) {
                // 3.4.1: no cut. Current source: the one cut between the two input vertices.
                expect(c.output.faces.length).toBe(1)
                expect(c.edgesOut).toEqual([])
                expect(bm.totface).toBe(2)
                expect(r.edges.length).toBe(1)
                expect(r.edges[0].joins(vs[0], vs[1])).toBe(true)
                return
            }
            expect(compareMeshes(meshOf(bm), c.output, {selection: true})).toEqual([])
            expect(compareEdgeList(r.edges, c.edgesOut, c.output.positions, 'edges.out')).toEqual([])
        })
    }
})

describe(`vert_connect / vert_connect_path match Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        if (c.kind !== 'edit') continue
        it(`${c.op}: ${c.name}`, () => {
            const {bm, verts, faces} = buildInput({...c.input, select: undefined})
            bm.selectMode = MODE[c.mode]
            setRawState(bm, verts, faces, c.entered, c.enteredHidden)
            bm.selectHistory = c.enteredHistory.map(h => ({
                elem: h.type === 'V' ? verts[h.verts[0]]
                    : h.type === 'E' ? diskEdgeExists(verts[h.verts[0]], verts[h.verts[1]])!
                        : faces.find(f => f.len === h.verts.length && h.verts.every(i => f.verts().includes(verts[i])))!,
            }))

            const r = c.op === 'vert_connect' ? vertConnectSelection(bm) : vertConnectPathSelection(bm)
            expect(bm.validate()).toEqual([])

            if (c.result[0] === 'FINISHED') {
                expect(r).toMatchObject({ok: true})
            } else {
                expect(r.ok).toBe(false)
                if (c.error) expect(`Error: ${(r as {error: string}).error}`).toBe(c.error)
            }
            const tol = c.name === MULTI_CUT_NORMALS_DIFFER ? 5e-4 : PARITY_TOL
            expect(compareMeshes(meshOf(bm), c.output, {selection: true, tol})).toEqual([])
            expect(historyMatches(bm, c.history, c.output.positions, tol)).toEqual([])
            // The counters agree with the flags.
            const counts = [bm.totvertsel, bm.totedgesel, bm.totfacesel]
            selectCountsRecalc(bm)
            expect(counts).toEqual([bm.totvertsel, bm.totedgesel, bm.totfacesel])
        })
    }
})
