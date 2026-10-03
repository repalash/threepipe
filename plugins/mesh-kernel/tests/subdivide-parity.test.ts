/**
 * Ground-truth parity for `subdivideEdges` (`bmesh.ops.subdivide_edges`) and `editMeshSubdivide`
 * (`bpy.ops.mesh.subdivide`) against Blender.
 *
 * The expectations come from `fixtures/bmesh-ops-subdivide.json`, written by
 * `fixtures/gen-bmesh-ops-subdivide-fixtures.py` running inside Blender. Each case carries its input
 * mesh as explicit coordinates and the cut edges as vertex-index pairs; this suite builds the same
 * mesh, runs the port with the same parameters and compares.
 *
 * Subdivide only ever creates elements, so Blender's element order is creation order. The comparison
 * is therefore exact on order: vertex `i` here is vertex `i` there (within float tolerance), face `i`
 * has the same vertex indices starting at the same corner, and the `geom_inner` / `geom_split`
 * outputs and the edit-mode selection are the same index sets.
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
import {
    editMeshSubdivide, SubdFalloff, SubdivideEdgesOptions, subdivideEdges, SubdivideGeom, SubdQuadCornerType,
} from '../src/ops/subdivide'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bmesh-ops-subdivide.json')

interface MeshOut {positions: number[][], faces: number[][], edges: number[][]}
interface IndexSets {verts: number[], edges: number[], faces: number[]}
interface Case {
    name: string
    kind: 'op' | 'edit'
    params: Record<string, any>
    input: {positions: number[][], faces: number[][], edges: number[][], meshEdges?: number[][]}
    output: MeshOut
    inner?: IndexSets
    split?: IndexSets
    selected?: IndexSets
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {blender: string, cases: Case[]}

/** Blender works in float32 and the fixture is rounded to 6 places; 1e-4 is well inside both. */
const TOL = 1e-4

const FALLOFF: Record<string, SubdFalloff> = {
    SMOOTH: 'smooth', SPHERE: 'sphere', ROOT: 'root', SHARP: 'sharp', LINEAR: 'linear', INVERSE_SQUARE: 'inverseSquare',
}
const CORNER: Record<string, SubdQuadCornerType> = {
    INNER_VERT: 'innerVert', INNERVERT: 'innerVert', PATH: 'path', FAN: 'fan', STRAIGHT_CUT: 'straightCut',
}

function build(input: Case['input']) {
    const bm = new BMesh()
    const verts = input.positions.map(c => bm.vertCreate(c[0], c[1], c[2]))
    // Create the edges first, in Blender's order and direction: `faces.new` starts each face's edges at
    // (last, first) (`BM_edges_from_verts_ensure`, `bmesh_construct.cc:57`) and `Mesh.from_pydata` has
    // its own order. The kernel's `faceCreate` starts at (first, second); see
    // issues/open/mesh-kernel-face-create-edge-order.md. `faceCreate` then reuses these edges.
    for (const [a, b] of input.meshEdges ?? []) bm.edgeCreate(verts[a], verts[b])
    for (const f of input.faces) bm.faceCreate(f.map(i => verts[i]))
    meshNormalsUpdate(bm)
    const edgeOf = (a: number, b: number): BMEdge => {
        const e = [...bm.edges].find(x => x.joins(verts[a], verts[b]))
        if (!e) throw new Error(`no edge ${a}-${b}`)
        return e
    }
    return {bm, edges: input.edges.map(([a, b]) => edgeOf(a, b))}
}

/** `bmesh.ops.subdivide_edges` keyword arguments to the port's options. */
function opOptions(p: Record<string, any>, edges: BMEdge[]): SubdivideEdgesOptions {
    return {
        cuts: p.cuts,
        smooth: p.smooth ?? 0,
        // The bmesh.ops slot is an int defaulting to 0, `SUBD_FALLOFF_SMOOTH`.
        smoothFalloff: FALLOFF[p.smooth_falloff ?? 'SMOOTH'],
        useSmoothEven: !!p.use_smooth_even,
        quadCornerType: CORNER[p.quad_corner_type ?? 'INNER_VERT'],
        useGridFill: !!p.use_grid_fill,
        useSingleEdge: !!p.use_single_edge,
        useOnlyQuads: !!p.use_only_quads,
        useSphere: !!p.use_sphere,
        edgePercents: p.edge_percents ? new Map(p.edge_percents.map(([i, f]: [number, number]) => [edges[i], f])) : undefined,
    }
}

function meshOf(bm: BMesh): MeshOut {
    const index = new Map([...bm.verts].map((v, i) => [v, i]))
    return {
        positions: [...bm.verts].map(v => [v.x, v.y, v.z]),
        faces: [...bm.faces].map(f => f.verts().map(v => index.get(v)!)),
        edges: [...bm.edges].map(e => [index.get(e.v1)!, index.get(e.v2)!]),
    }
}

function indexSets(bm: BMesh, g: SubdivideGeom): IndexSets {
    const vi = new Map([...bm.verts].map((v, i) => [v, i]))
    const ei = new Map([...bm.edges].map((e, i) => [e, i]))
    const fi = new Map([...bm.faces].map((f, i) => [f, i]))
    const sort = (a: number[]) => a.sort((x, y) => x - y)
    return {
        verts: sort(g.verts.map(v => vi.get(v)!)),
        edges: sort(g.edges.map(e => ei.get(e)!)),
        faces: sort(g.faces.map(f => fi.get(f)!)),
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

describe(`subdivide matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases.filter(x => x.kind === 'op')) {
        it(c.name, () => {
            const {bm, edges} = build(c.input)
            const res = subdivideEdges(bm, edges, opOptions(c.params, edges))
            expect(bm.validate()).toEqual([])
            expect(compareExact(meshOf(bm), c.output)).toEqual([])
            expect(indexSets(bm, res.inner)).toEqual(c.inner)
            expect(indexSets(bm, res.split)).toEqual(c.split)
        })
    }
})

describe(`edit-mode Subdivide (MESH_OT_subdivide) matches Blender ${fixture.blender}`, () => {
    for (const c of fixture.cases.filter(x => x.kind === 'edit')) {
        it(c.name, () => {
            const {bm, edges} = build(c.input)
            bm.selectMode = SelectMode.Edge
            for (const e of edges) edgeSelectSet(bm, e, true)
            selectFlushMode(bm)

            const p = c.params
            const res = editMeshSubdivide(bm, {
                numberCuts: p.number_cuts,
                smoothness: p.smoothness,
                ngon: p.ngon,
                quadcorner: p.quadcorner ? CORNER[p.quadcorner] : undefined,
            })
            expect(res).not.toBeNull()
            expect(bm.validate()).toEqual([])
            expect(compareExact(meshOf(bm), c.output)).toEqual([])

            const sel = (s: Iterable<{hflag: number}>) => [...s].flatMap((x, i) => x.hflag & ElemFlag.Select ? [i] : [])
            expect({verts: sel(bm.verts), edges: sel(bm.edges), faces: sel(bm.faces)}).toEqual(c.selected)
        })
    }
})
