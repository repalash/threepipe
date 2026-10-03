/**
 * Ground-truth parity for Bridge Edge Loops and Subdivide Edge-Ring (`src/ops/bridge.ts`,
 * `src/ops/subdivideEdgering.ts`) against Blender, from `fixtures/bmesh-ops-bridge.json`
 * (`fixtures/gen-bmesh-ops-bridge.py`).
 *
 * `bmo` cases run `bmesh.ops.bridge_loops` / `bmesh.ops.subdivide_edgering` on a mesh built from
 * explicit data (vertex indices left at -1, as a fresh Python BMesh has them); `edit` cases run the
 * edit-mode operators from the selection edit mode held on entering (`entered`), with the vertex
 * indices edit mode assigns (`BM_mesh_bm_from_me`). Geometry, every edge, every face with its winding
 * and the selection afterwards are compared; for `bmo` cases the sizes of the output slots too.
 */

import {describe, expect, it} from 'vitest'
import {buildInput, compareMeshes, FixtureInput, FixtureMesh, loadFixture, meshOf, setRawSelection} from './parity-util'
import {bmoBridgeLoops, bridgeEdgeLoopsSelection, BridgeEdgeLoopsOptions, BridgeLoopsOptions} from '../src/ops/bridge'
import {bmoBeautifyFill, edgeRotate} from '../src/ops/beautify'
import {bmoTriangulate} from '../src/ops/triangulate'
import {
    bmoSubdivideEdgering, SubdivideEdgeringOptions, subdivideEdgeringSelection, SubdivideEdgeringSelectionOptions,
} from '../src/ops/subdivideEdgering'
import {normalsUpdate} from '../src/ops/bevel-bmquery'
import {ElemFlag, SelectMode} from '../src/constants'
import {faceSelectSet} from '../src/bmesh/marking'
import {BMesh} from '../src/bmesh/BMesh'
import {getValue, setValue} from '../src/bmesh/customdata'
import {Quat, mulQtV3, quatToMat3, vecToQuat} from '../src/math/geom'
import {Vec3} from '../src/math'

interface Case {
    name: string
    kind: 'bmo' | 'edit' | 'math' | 'rot' | 'bmof'
    op: 'bridge_loops' | 'subdivide_edgering' | 'bridge_edge_loops' | 'triangulate' | 'beautify_fill'
    params?: Record<string, any>
    props?: Record<string, any>
    mode: 'VERT' | 'EDGE' | 'FACE'
    input: FixtureInput
    inputEdges?: number[][]
    outCounts?: Record<string, number>
    entered?: {verts: number[], edges: number[][], faces: number[]}
    result?: string[]
    output: FixtureMesh
    /** With `uv`, every input corner carries a distinct UV (`inputUvs`, per face in input order). */
    uv?: boolean
    inputUvs?: number[][][] | null
    outputUvs?: number[][][] | null
    quats?: {vec: number[], axis: number, upflag: number, quat: number[]}[]
    /** `rot` cases: `bmesh.utils.edge_rotate`. */
    ccw?: boolean
    smooth?: number[]
    selectFaces?: number[]
    newEdge?: number[] | null
    faceSmooth?: boolean[]
    faceSelect?: boolean[]
    /** `bmof` cases: input faces by index, vertices to tag. */
    inputFaces?: number[]
    vtags?: number[]
}

const fixture = loadFixture<Case>('bmesh-ops-bridge.json')
const MODE = {VERT: SelectMode.Vertex, EDGE: SelectMode.Edge, FACE: SelectMode.Face}

function bridgeOpts(p: Record<string, any>): BridgeLoopsOptions {
    return {
        usePairs: p.use_pairs, useCyclic: p.use_cyclic, useMerge: p.use_merge,
        mergeFactor: p.merge_factor, twistOffset: p.twist_offset,
    }
}

function subdivOpts(p: Record<string, any>): SubdivideEdgeringOptions {
    return {
        interpMode: p.interp_mode, cuts: p.cuts, smooth: p.smooth,
        profileShape: p.profile_shape, profileShapeFactor: p.profile_shape_factor,
    }
}

function bridgeProps(p: Record<string, any>): BridgeEdgeLoopsOptions {
    return {
        type: p.type, useMerge: p.use_merge, mergeFactor: p.merge_factor, twistOffset: p.twist_offset,
        numberCuts: p.number_cuts, interpolation: p.interpolation, smoothness: p.smoothness,
        profileShape: p.profile_shape, profileShapeFactor: p.profile_shape_factor,
    }
}

function subdivProps(p: Record<string, any>): SubdivideEdgeringSelectionOptions {
    return {
        numberCuts: p.number_cuts, interpolation: p.interpolation, smoothness: p.smoothness,
        profileShape: p.profile_shape, profileShapeFactor: p.profile_shape_factor,
    }
}

/**
 * The input UVs and material indices, face by face in creation order (the order Blender's faces have
 * here). Each fixture entry is the corners' UVs followed by `[material_index]`.
 */
function addUvs(bm: BMesh, uvs: number[][][]) {
    const layer = bm.addLayer('loop', 'UVMap', 'float2')
    const faces = [...bm.faces]
    uvs.forEach((fuv, fi) => {
        faces[fi].loops().forEach((l, k) => setValue(l, bm.ldata, layer, fuv[k]))
        faces[fi].matNr = fuv[fuv.length - 1][0]
    })
}

/**
 * Every Blender face's corner UVs and material index against the kernel face with the same corners (matched by vertex
 * position, cyclically aligned). Returns the problems.
 */
function compareUvs(bm: BMesh, want: FixtureMesh, wantUvs: number[][][], tol = 1e-4): string[] {
    const layer = bm.ldata.get('UVMap')!
    const problems: string[] = []
    const same = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < tol)
    const faces = [...bm.faces]
    want.faces.forEach((wf, fi) => {
        const wpos = wf.map(i => want.positions[i])
        let found = false
        for (const f of faces) {
            if (f.len !== wf.length) continue
            const loops = f.loops()
            for (let r = 0; r < loops.length && !found; r++) {
                if (!loops.every((_, k) => same([loops[(k + r) % loops.length].v.x, loops[(k + r) % loops.length].v.y, loops[(k + r) % loops.length].v.z], wpos[k]))) continue
                found = true
                const matNr = wantUvs[fi][wantUvs[fi].length - 1][0]
                if (f.matNr !== matNr) problems.push(`face ${fi}: material ${f.matNr}, Blender ${matNr}`)
                loops.forEach((_, k) => {
                    const uv = getValue(loops[(k + r) % loops.length], layer)
                    if (!same(uv, wantUvs[fi][k])) problems.push(`face ${fi} corner ${k}: uv ${uv.map(x => x.toFixed(4))}, Blender ${wantUvs[fi][k]}`)
                })
            }
            if (found) break
        }
        if (!found) problems.push(`face ${fi}: no kernel face with its corners`)
    })
    return problems
}

/** Run one fixture case; returns the mesh afterwards and the op's report. */
export function runCase(c: Case) {
    if (c.kind === 'bmof') {
        const {bm, verts, faces} = buildInput(c.input)
        if (c.inputUvs) addUvs(bm, c.inputUvs)
        normalsUpdate(bm)
        for (const i of c.vtags!) verts[i].hflag |= ElemFlag.Tag
        const input = c.inputFaces!.map(i => faces[i])
        const p = c.params!
        const r = c.op === 'triangulate'
            ? bmoTriangulate(bm, input, p.quad_method, p.ngon_method)
            : bmoBeautifyFill(bm, input, [...bm.edges], p.use_restrict_tag, p.method)
        return {bm, r}
    }
    if (c.kind === 'bmo') {
        const {bm, edge} = buildInput(c.input)
        if (c.inputUvs) addUvs(bm, c.inputUvs)
        bm.selectMode = MODE[c.mode]
        // `bmesh_fixture_util.build` ends with `bm.normal_update()`
        normalsUpdate(bm)
        const edges = c.inputEdges!.map(([a, b]) => edge(a, b))
        const r = c.op === 'bridge_loops'
            ? bmoBridgeLoops(bm, edges, bridgeOpts(c.params!))
            : bmoSubdivideEdgering(bm, edges, subdivOpts(c.params!))
        return {bm, r}
    }
    const {bm, verts, faces} = buildInput({...c.input, select: undefined})
    if (c.inputUvs) addUvs(bm, c.inputUvs)
    bm.selectMode = MODE[c.mode]
    setRawSelection(bm, verts, faces, c.entered!)
    // Edit mode: `BM_mesh_bm_from_me` numbers the elements, and the normals are current.
    bm.elemIndexEnsure()
    normalsUpdate(bm)
    const r = c.op === 'bridge_edge_loops'
        ? bridgeEdgeLoopsSelection(bm, bridgeProps(c.props!))
        : subdivideEdgeringSelection(bm, subdivProps(c.props!))
    return {bm, r}
}

describe(`bridge / subdivide edge-ring match Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases) {
        if (c.kind === 'math' || c.kind === 'rot') continue
        it(`${c.kind} ${c.op}: ${c.name}`, () => {
            const {bm, r} = runCase(c)
            expect(bm.validate()).toEqual([])
            expect(compareMeshes(meshOf(bm), c.output, {selection: true})).toEqual([])
            if (c.uv) expect(compareUvs(bm, c.output, c.outputUvs!)).toEqual([])
            if (c.kind === 'bmo' && 'faces' in r && c.outCounts) {
                expect(r.faces.length).toBe(c.outCounts.faces)
                if (c.op === 'bridge_loops') expect((r as {edges: unknown[]}).edges.length).toBe(c.outCounts.edges)
            }
            if (c.kind === 'bmof' && c.op === 'triangulate') {
                const t = r as {faces: unknown[], edges: unknown[]}
                expect([t.faces.length, t.edges.length]).toEqual([c.outCounts!.faces, c.outCounts!.edges])
            }
            if (c.kind === 'bmof' && c.op === 'beautify_fill') {
                const g = r as {faces: unknown[], edges: unknown[]}
                expect(g.faces.length + g.edges.length).toBe(c.outCounts!.geom)
            }
        })
    }
})

describe(`vec_to_quat matches Blender ${fixture.blender} (Vector.to_track_quat)`, () => {
    const c = fixture.cases.find(x => x.kind === 'math' && x.name === 'vec_to_quat')!
    const unit = (i: number): Vec3 => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0]
    const rotate = (q: number[], v: Vec3): Vec3 => {
        const r: Vec3 = [...v] as Vec3
        mulQtV3(q as Quat, r)
        return r
    }
    for (const q of c.quats!) {
        // The roll is `atan2` of two components of the pre-roll rotation's Z column
        // (`math_rotation_c.cc:792-822`). Where both are zero up to rounding (`cosf(M_PI_2)` is
        // -4.4e-8 in float, 6e-17 in double), float and double pick different rolls; only the tracked
        // direction is defined there, so that is what is compared. The roll never reaches a mesh: the
        // path interpolation uses each frame relative to the first.
        // On the branch cut of that `atan2` (y = +-0, x < 0) the sign of a zero picks a roll of +-90
        // degrees, i.e. q or -q: the same rotation, compared as such.
        const axis3 = q.axis % 3
        const fp = quatToMat3(vecToQuat(q.vec as Vec3, q.axis, axis3))[2]
        const [y, x] = axis3 === 0 ? (q.upflag === 1 ? [fp[2], fp[1]] : [fp[1], fp[2]])
            : axis3 === 1 ? (q.upflag === 0 ? [fp[2], fp[0]] : [fp[0], fp[2]])
                : (q.upflag === 0 ? [-fp[1], -fp[0]] : [-fp[0], -fp[1]])
        const degenerate = axis3 !== q.upflag && Math.hypot(x, y) < 1e-6
        const branchCut = axis3 !== q.upflag && !degenerate && Math.abs(y) < 1e-6 && x < 0
        it(`vec ${q.vec} axis ${q.axis} up ${q.upflag}${degenerate ? ' (degenerate roll: tracked axis only)' : branchCut ? ' (roll on the atan2 branch cut: up to sign)' : ''}`, () => {
            const got: Quat = vecToQuat(q.vec as Vec3, q.axis, q.upflag)
            if (!degenerate) {
                // q and -q are the same rotation, but Blender's sign is deterministic and so is the
                // port's - except on the branch cut.
                const sign = branchCut && got.findIndex((x, i) => Math.abs(x + q.quat[i]) > 1e-5) < 0 ? -1 : 1
                expect(got.every((v, i) => Math.abs(sign * v - q.quat[i]) < 1e-5), `got ${got.map(v => v.toFixed(6))}`).toBe(true)
                return
            }
            const axis = unit(q.axis % 3)
            const a = rotate(got, axis)
            const b = rotate(q.quat, axis)
            expect(a.every((x, i) => Math.abs(x - b[i]) < 1e-5), `got ${a}, Blender ${b}`).toBe(true)
        })
    }
})

describe(`BM_edge_rotate matches Blender ${fixture.blender} (bmesh.utils.edge_rotate, check flag 0)`, () => {
    for (const c of fixture.cases.filter(x => x.kind === 'rot')) {
        it(c.name, () => {
            const {bm, faces, edge} = buildInput(c.input)
            faces.forEach((f, i) => f.setFlag(ElemFlag.Smooth, !!c.smooth![i]))
            for (const i of c.selectFaces!) faceSelectSet(bm, faces[i], true)
            normalsUpdate(bm)
            const [a, b] = c.inputEdges![0]
            const eNew = edgeRotate(bm, edge(a, b), c.ccw!, 0)
            expect(bm.validate()).toEqual([])
            const got = meshOf(bm)
            expect(compareMeshes(got, c.output)).toEqual([])
            const pos = (v: {x: number, y: number, z: number}) => [v.x, v.y, v.z]
            const want = (i: number) => c.output.positions[i]
            if (c.newEdge === null) {
                expect(eNew).toBeNull()
            } else {
                // the new edge's v1, v2 and `e->l->v`, which `ccw` and the flip decide
                expect([pos(eNew!.v1), pos(eNew!.v2), pos(eNew!.l!.v)]).toEqual(c.newEdge!.map(want))
            }
            // the two faces' header flags follow the corners they were made from
            const key = (vs: number[][]) => {
                const s = vs.map(p => p.map(x => x.toFixed(4)).join(','))
                let best = 0
                for (let i = 1; i < s.length; i++) if (s[i] < s[best]) best = i
                return [...s.slice(best), ...s.slice(0, best)].join('|')
            }
            const flags = new Map([...bm.faces].map(f => [key(f.verts().map(pos)), f]))
            c.output.faces.forEach((wf, i) => {
                const f = flags.get(key(wf.map(want)))!
                expect(f.testFlag(ElemFlag.Smooth), `face ${i} smooth`).toBe(c.faceSmooth![i])
                expect(f.testFlag(ElemFlag.Select), `face ${i} select`).toBe(c.faceSelect![i])
            })
        })
    }
})
