/**
 * Shared comparison for the operator parity suites: a mesh built here from a fixture's input, run
 * through a port, against what Blender wrote for the same input (`fixtures/bmesh_fixture_util.py`).
 *
 * Element *order* is not compared: Blender's mempools reuse the slots of killed elements, so its
 * iteration order is not creation order. What is compared is the geometry: the multiset of vertex
 * positions (paired within a tolerance), every face as a cyclic vertex sequence (so winding counts),
 * every edge as an unordered vertex pair (so wire edges count), and, when asked, the selection.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../src/bmesh/types'
import {ElemFlag} from '../src/constants'
import {edgeSelectSet, faceSelectSet, selectCountsRecalc, selectFlush, vertSelectSet} from '../src/bmesh/marking'
import {diskEdgeExists} from '../src/bmesh/structure'

export interface FixtureMesh {
    positions: number[][]
    faces: number[][]
    edges?: number[][]
    selected?: {verts: number[], edges: number[][], faces: number[]}
}

export interface FixtureInput {
    positions: number[][]
    faces: number[][]
    /** Extra wire edges, as vertex index pairs. */
    edges?: number[][]
    select?: {verts?: number[], edges?: number[][], faces?: number[]}
}

/** Blender works in float32 and the fixtures are rounded to 6 places; 1e-4 is well inside both. */
export const PARITY_TOL = 1e-4

export function loadFixture<C>(file: string): {blender: string, cases: C[]} {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', file)
    return JSON.parse(readFileSync(path, 'utf8'))
}

/** Build the fixture's input exactly as `bmesh_fixture_util.build` does, in the same order. */
export function buildInput(input: FixtureInput): {bm: BMesh, verts: BMVert[], faces: BMFace[], edge: (a: number, b: number) => BMEdge} {
    const bm = new BMesh()
    const verts = input.positions.map(c => bm.vertCreate(c[0], c[1], c[2]))
    const faces = input.faces.map(f => bm.faceCreate(f.map(i => verts[i])))
    for (const [a, b] of input.edges ?? []) bm.edgeCreate(verts[a], verts[b], undefined, {noDouble: true})
    const edge = (a: number, b: number) => {
        const e = diskEdgeExists(verts[a], verts[b])
        if (!e) throw new Error(`fixture: no edge ${a}-${b}`)
        return e
    }
    if (input.select) {
        // Blender sets the flags directly (`v.select = True`), which is what these do without flushing.
        for (const i of input.select.verts ?? []) vertSelectSet(bm, verts[i], true)
        for (const [a, b] of input.select.edges ?? []) edgeSelectSet(bm, edge(a, b), true)
        for (const i of input.select.faces ?? []) faceSelectSet(bm, faces[i], true)
    }
    return {bm, verts, faces, edge}
}

/**
 * Set the selection flags to exactly `sel` (indices as in the fixture input, edges as vertex pairs),
 * without any propagation, and recount. For fixtures that record the selection edit mode held after
 * entering (`entered`), so the port starts from Blender's own converted and flushed state.
 */
export function setRawSelection(bm: BMesh, verts: BMVert[], faces: BMFace[], sel: {verts: number[], edges: number[][], faces: number[]}): void {
    for (const v of bm.verts) v.hflag &= ~ElemFlag.Select
    for (const e of bm.edges) e.hflag &= ~ElemFlag.Select
    for (const f of bm.faces) f.hflag &= ~ElemFlag.Select
    for (const i of sel.verts) verts[i].hflag |= ElemFlag.Select
    for (const [a, b] of sel.edges) {
        const e = diskEdgeExists(verts[a], verts[b])
        if (!e) throw new Error(`fixture: no edge ${a}-${b}`)
        e.hflag |= ElemFlag.Select
    }
    for (const i of sel.faces) faces[i].hflag |= ElemFlag.Select
    selectCountsRecalc(bm)
}

/** Re-export so suites that need Blender's select flush can call it on the built mesh. */
export {selectFlush}

/** The mesh in fixture form, indices in iteration order. */
export function meshOf(bm: BMesh): Required<FixtureMesh> {
    const all = [...bm.verts]
    const index = new Map(all.map((v, i) => [v, i]))
    const edges = [...bm.edges]
    const faces = [...bm.faces]
    return {
        positions: all.map(v => [v.x, v.y, v.z]),
        faces: faces.map(f => f.verts().map(v => index.get(v)!)),
        edges: edges.map(e => [index.get(e.v1)!, index.get(e.v2)!]),
        selected: {
            verts: all.filter(v => v.hflag & ElemFlag.Select).map(v => index.get(v)!),
            edges: edges.filter(e => e.hflag & ElemFlag.Select).map(e => [index.get(e.v1)!, index.get(e.v2)!]),
            faces: faces.map((f, i) => f.hflag & ElemFlag.Select ? i : -1).filter(i => i >= 0),
        },
    }
}

export interface CompareOptions {
    /** Compare the edge sets too (default true; needs `edges` in the fixture). */
    edges?: boolean
    /** Compare the selection too (default false; needs `selected` in the fixture). */
    selection?: boolean
    tol?: number
}

/**
 * Pair every expected vertex with a distinct received vertex within the tolerance, then map faces,
 * edges and selection through that pairing. Greedy pairing: fixtures must not have two vertices
 * closer than the tolerance (coincident vertices are compared by count only, which the pairing
 * handles, but a face then may map to either). Returns the problems, empty when the meshes agree.
 */
export function compareMeshes(got: FixtureMesh, want: FixtureMesh, options: CompareOptions = {}): string[] {
    const tol = options.tol ?? PARITY_TOL
    const problems: string[] = []
    if (got.positions.length !== want.positions.length) problems.push(`vertex count ${got.positions.length}, Blender ${want.positions.length}`)
    if (got.faces.length !== want.faces.length) problems.push(`face count ${got.faces.length}, Blender ${want.faces.length}`)
    const doEdges = (options.edges ?? true) && !!want.edges && !!got.edges
    if (doEdges && got.edges!.length !== want.edges!.length) problems.push(`edge count ${got.edges!.length}, Blender ${want.edges!.length}`)
    if (problems.length) return problems

    const used = new Array(got.positions.length).fill(false)
    const map: number[] = []
    want.positions.forEach((w, i) => {
        const j = got.positions.findIndex((g, k) => !used[k]
            && Math.abs(g[0] - w[0]) < tol && Math.abs(g[1] - w[1]) < tol && Math.abs(g[2] - w[2]) < tol)
        if (j < 0) problems.push(`no vertex at Blender's [${w.join(', ')}] (index ${i})`)
        else {
            used[j] = true
            map[i] = j
        }
    })
    if (problems.length) return problems

    const cyclic = (f: number[]) => {
        let best = 0
        for (let i = 1; i < f.length; i++) if (f[i] < f[best]) best = i
        return [...f.slice(best), ...f.slice(0, best)].join(',')
    }
    const pair = (e: number[]) => e[0] < e[1] ? `${e[0]}-${e[1]}` : `${e[1]}-${e[0]}`
    const multiset = (keys: string[]) => {
        const m = new Map<string, number>()
        for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
        return m
    }
    const take = (m: Map<string, number>, k: string) => {
        const n = m.get(k) ?? 0
        if (n) m.set(k, n - 1)
        return n > 0
    }

    const gotFaces = multiset(got.faces.map(cyclic))
    for (const f of want.faces) {
        if (!take(gotFaces, cyclic(f.map(i => map[i])))) problems.push(`no face matching Blender's [${f.join(', ')}] (with the same winding)`)
    }
    if (doEdges) {
        const gotEdges = multiset(got.edges!.map(pair))
        for (const e of want.edges!) {
            if (!take(gotEdges, pair(e.map(i => map[i])))) problems.push(`no edge matching Blender's ${e[0]}-${e[1]}`)
        }
    }
    if (options.selection && want.selected && got.selected) {
        const sv = new Set(got.selected.verts)
        const wantV = want.selected.verts.map(i => map[i])
        if (wantV.length !== sv.size || wantV.some(i => !sv.has(i))) {
            problems.push(`selected verts differ: got ${sv.size}, Blender ${wantV.length}`)
        }
        const se = multiset(got.selected.edges.map(pair))
        if (want.selected.edges.length !== got.selected.edges.length
            || want.selected.edges.some(e => !take(se, pair(e.map(i => map[i]))))) {
            problems.push(`selected edges differ: got ${got.selected.edges.length}, Blender ${want.selected.edges.length}`)
        }
        const gotSelFaces = multiset(got.selected.faces.map(i => cyclic(got.faces[i])))
        if (want.selected.faces.length !== got.selected.faces.length
            || want.selected.faces.some(i => !take(gotSelFaces, cyclic(want.faces[i].map(j => map[j]))))) {
            problems.push(`selected faces differ: got ${got.selected.faces.length}, Blender ${want.selected.faces.length}`)
        }
    }
    return problems
}
