/**
 * Ground-truth parity for `subdivideEdgeRing` (`bmesh.ops.subdivide_edgering`) and
 * `editMeshSubdivideEdgeRing` (`bpy.ops.mesh.subdivide_edgering`) against Blender.
 *
 * The expectations come from `fixtures/bmesh-ops-edgering.json`, written by
 * `fixtures/gen-bmesh-ops-edgering-fixtures.py` running inside Blender. The edge-ring subdivide only
 * creates elements, so the comparison is exact on order: vertex `i` here is vertex `i` there (within
 * float tolerance), face `i` has the same vertices from the same corner, and the output faces and the
 * edit-mode selection are the same index sets.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge} from '../src/bmesh/types'
import {meshNormalsUpdate} from '../src/bmesh/normals'
import {edgeSelectSet, selectFlushMode} from '../src/bmesh/marking'
import {ElemFlag, SelectMode} from '../src/constants'
import {SubdFalloff} from '../src/ops/subdivide'
import {curveForwardDiffBezier, EdgeRingInterp, editMeshSubdivideEdgeRing, subdivideEdgeRing} from '../src/ops/subdivideEdgeRing'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bmesh-ops-edgering.json')

interface MeshOut {positions: number[][], faces: number[][], edges: number[][]}
interface Case {
    name: string
    kind: 'op' | 'edit'
    params: Record<string, any>
    input: {positions: number[][], faces: number[][], edges: number[][], meshEdges: number[][]}
    output: MeshOut
    facesOut?: number[]
    selected?: {verts: number[], edges: number[], faces: number[]}
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {blender: string, cases: Case[]}

/** Blender works in float32 and the fixture is rounded to 6 places. */
const TOL = 1e-4

const INTERP: Record<string, EdgeRingInterp> = {LINEAR: 'linear', PATH: 'path', SURFACE: 'surface'}
const FALLOFF: Record<string, SubdFalloff> = {
    SMOOTH: 'smooth', SPHERE: 'sphere', ROOT: 'root', SHARP: 'sharp', LINEAR: 'linear', INVERSE_SQUARE: 'inverseSquare',
}

function build(input: Case['input']) {
    const bm = new BMesh()
    const verts = input.positions.map(c => bm.vertCreate(c[0], c[1], c[2]))
    // Blender's edge order and direction first (issues/open/mesh-kernel-face-create-edge-order.md).
    for (const [a, b] of input.meshEdges) bm.edgeCreate(verts[a], verts[b])
    for (const f of input.faces) bm.faceCreate(f.map(i => verts[i]))
    meshNormalsUpdate(bm)
    const edgeOf = (a: number, b: number): BMEdge => {
        const e = [...bm.edges].find(x => x.joins(verts[a], verts[b]))
        if (!e) throw new Error(`no edge ${a}-${b}`)
        return e
    }
    return {bm, edges: input.edges.map(([a, b]) => edgeOf(a, b))}
}

function meshOf(bm: BMesh): MeshOut {
    const index = new Map([...bm.verts].map((v, i) => [v, i]))
    return {
        positions: [...bm.verts].map(v => [v.x, v.y, v.z]),
        faces: [...bm.faces].map(f => f.verts().map(v => index.get(v)!)),
        edges: [...bm.edges].map(e => [index.get(e.v1)!, index.get(e.v2)!]),
    }
}

/** Every mismatch between two meshes compared index for index; empty when they are the same. */
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

/**
 * The same mesh up to element order: a one-to-one vertex correspondence by position, under which the
 * edges and faces (from any starting corner) are the same sets. For the cases with several ring
 * pairs: Blender 3.4.1 keeps the pairs in a `GSet` and walks it in pointer-hash order
 * (`bm_edgering_pair_calc`, `bmo_subdivide_edgering.c:194` and `:1190` in 3.4.1), so which pair is cut
 * first - and with it the element order - depends on memory addresses there. Current Blender, which
 * this port follows, walks them in the order found (a `VectorSet`, `bmo_subdivide_edgering.cc:218`).
 */
function compareUnordered(got: MeshOut, want: MeshOut): string[] {
    const problems: string[] = []
    if (got.positions.length !== want.positions.length) return [`vertex count ${got.positions.length}, Blender ${want.positions.length}`]
    const map: number[] = got.positions.map((g, i) => {
        const j = want.positions.findIndex(w => Math.abs(g[0] - w[0]) <= TOL && Math.abs(g[1] - w[1]) <= TOL && Math.abs(g[2] - w[2]) <= TOL)
        if (j < 0) problems.push(`vertex ${i} at [${g}] is not in Blender's mesh`)
        return j
    })
    if (new Set(map).size !== map.length) problems.push('vertex correspondence is not one-to-one')
    if (problems.length) return problems
    const edgeKey = (e: number[]) => [...e].sort((a, b) => a - b).join(',')
    const faceKey = (f: number[]) => {
        const k = f.indexOf(Math.min(...f))
        return [...f.slice(k), ...f.slice(0, k)].join(',')
    }
    const sortedKeys = (xs: string[]) => [...xs].sort()
    if (JSON.stringify(sortedKeys(got.edges.map(e => edgeKey(e.map(i => map[i]))))) !== JSON.stringify(sortedKeys(want.edges.map(edgeKey)))) problems.push('edges differ')
    if (JSON.stringify(sortedKeys(got.faces.map(f => faceKey(f.map(i => map[i]))))) !== JSON.stringify(sortedKeys(want.faces.map(faceKey)))) problems.push('faces differ')
    return problems
}

describe(`subdivide edge-ring matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases.filter(x => x.kind === 'op')) {
        it(c.name, () => {
            const {bm, edges} = build(c.input)
            const p = c.params
            const res = subdivideEdgeRing(bm, edges, {
                cuts: p.cuts,
                interpMode: INTERP[p.interp_mode],
                // The bmesh.ops slots default to 0 (`bmo_opdefines.cc`).
                smooth: p.smooth ?? 0,
                profileShape: FALLOFF[p.profile_shape ?? 'SMOOTH'],
                profileShapeFactor: p.profile_shape_factor ?? 0,
            })
            expect(bm.validate()).toEqual([])
            const severalPairs = c.name.startsWith('barrel two bands')
            if (severalPairs) expect(compareUnordered(meshOf(bm), c.output)).toEqual([])
            else expect(compareExact(meshOf(bm), c.output)).toEqual([])
            if (c.facesOut!.length) {
                expect(res.ok).toBe(true)
                const fi = new Map([...bm.faces].map((f, i) => [f, i]))
                if (severalPairs) expect(res.ok && res.faces.length).toBe(c.facesOut!.length)
                else expect(res.ok && res.faces.map(f => fi.get(f)!).sort((a, b) => a - b)).toEqual(c.facesOut)
            } else {
                // Blender cancels (`BMO_error_raise(..., "No edge rings found")`) and changes nothing.
                expect(res).toEqual({ok: false, error: 'No edge rings found'})
            }
        })
    }
})

describe(`edit-mode Subdivide Edge-Ring (MESH_OT_subdivide_edgering) matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases.filter(x => x.kind === 'edit')) {
        it(c.name, () => {
            const {bm, edges} = build(c.input)
            bm.selectMode = SelectMode.Edge
            for (const e of edges) edgeSelectSet(bm, e, true)
            selectFlushMode(bm)

            const p = c.params
            const res = editMeshSubdivideEdgeRing(bm, {
                numberCuts: p.number_cuts,
                interpolation: p.interpolation ? INTERP[p.interpolation] : undefined,
                smoothness: p.smoothness,
            })
            expect(res && res.ok).toBe(true)
            expect(bm.validate()).toEqual([])
            expect(compareExact(meshOf(bm), c.output)).toEqual([])

            const sel = (s: Iterable<{hflag: number}>) => [...s].flatMap((x, i) => x.hflag & ElemFlag.Select ? [i] : [])
            expect({verts: sel(bm.verts), edges: sel(bm.edges), faces: sel(bm.faces)}).toEqual(c.selected)
        })
    }
})

describe('BKE_curve_forward_diff_bezier (curve.cc:1695)', () => {
    it('steps a cubic bezier by forward differences, ending on the last control point', () => {
        // A straight line with evenly spaced handles is evenly spaced: 0, 1, 2, 3.
        expect(curveForwardDiffBezier(0, 1, 2, 3, 3).map(x => Math.round(x * 1e9) / 1e9)).toEqual([0, 1, 2, 3])
        // The bezier B(t) = (1-t)^3 q0 + 3(1-t)^2 t q1 + 3(1-t) t^2 q2 + t^3 q3 at t = 0, 1/4, ..., 1.
        const [q0, q1, q2, q3] = [0.3, 2, -1, 0.5]
        const b = (t: number) => (1 - t) ** 3 * q0 + 3 * (1 - t) ** 2 * t * q1 + 3 * (1 - t) * t * t * q2 + t ** 3 * q3
        curveForwardDiffBezier(q0, q1, q2, q3, 4).forEach((x, i) => expect(x).toBeCloseTo(b(i / 4), 9))
    })
})
