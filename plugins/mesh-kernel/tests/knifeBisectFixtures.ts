/**
 * Fixture plumbing shared by `knife-bisect-parity.test.ts` and debugging scripts: loading the Blender
 * fixtures in `fixtures/knife-bisect/`, rebuilding their input as Blender's edit mode does, and an
 * order-free mesh comparison. See the parity test for what the fixtures are.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMVert} from '../src/bmesh/types'
import {diskEdgeExists} from '../src/bmesh/structure'
import {KnifeView} from '../src/ops/knife/view'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'knife-bisect')

export interface MeshDump {verts: number[][], faces: number[][], edges: number[][]}
export interface Fixture {
    name: string
    kind: 'knife' | 'bisect'
    blender: string
    input: MeshDump
    output: MeshDump
    // knife
    cut_through?: boolean
    view?: {persp: string, is_persp: boolean, winx: number, winy: number, clip_start: number, clip_end: number,
        persmat: number[][], viewmat: number[][], winmat: number[][]}
    polys?: number[][][]
    // bisect
    plane_co?: number[]
    plane_no?: number[]
    clear_inner?: boolean
    clear_outer?: boolean
    use_fill?: boolean
    threshold?: number
}

export const fixtures: Fixture[] = readdirSync(DIR).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')))

export const TOL = 1e-4

/** `BM_mesh_bm_from_me`: verts, then edges in mesh order, then faces over the existing edges. */
export function buildFromBlender(input: MeshDump): BMesh {
    const bm = new BMesh()
    const verts = input.verts.map(c => bm.vertCreate(c[0], c[1], c[2]))
    for (const [a, b] of input.edges) bm.edgeCreate(verts[a], verts[b])
    for (const f of input.faces) {
        const fv = f.map(i => verts[i])
        const fe = fv.map((v, i) => diskEdgeExists(v, fv[(i + 1) % fv.length])!)
        bm.faceCreateWithEdges(fv, fe)
    }
    return bm
}

/** A mathutils row-major 4x4 (`rows[r][c]`) as a column-major array (`m[c * 4 + r]`). */
export const colMajor = (rows: number[][]): number[] => {
    const m = new Array(16)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[c * 4 + r] = rows[r][c]
    return m
}

export function dumpMesh(bm: BMesh): MeshDump {
    const all = [...bm.verts]
    const index = new Map<BMVert, number>(all.map((v, i) => [v, i]))
    return {
        verts: all.map(v => [v.x, v.y, v.z]),
        faces: [...bm.faces].map(f => f.verts().map(v => index.get(v)!)),
        edges: [...bm.edges].map((e: BMEdge) => [index.get(e.v1)!, index.get(e.v2)!]),
    }
}

/** Pair vertices by position, then compare faces as cyclic sequences and edges as unordered pairs. */
export function compareMeshes(got: MeshDump, want: MeshDump): string[] {
    const problems: string[] = []
    if (got.verts.length !== want.verts.length) problems.push(`vertex count ${got.verts.length}, Blender ${want.verts.length}`)
    if (got.edges.length !== want.edges.length) problems.push(`edge count ${got.edges.length}, Blender ${want.edges.length}`)
    if (got.faces.length !== want.faces.length) problems.push(`face count ${got.faces.length}, Blender ${want.faces.length}`)
    const used = new Array(got.verts.length).fill(false)
    const map: number[] = []
    want.verts.forEach((w, i) => {
        const j = got.verts.findIndex((g, k) => !used[k]
            && Math.abs(g[0] - w[0]) < TOL && Math.abs(g[1] - w[1]) < TOL && Math.abs(g[2] - w[2]) < TOL)
        if (j < 0) problems.push(`no vertex at Blender's [${w.join(', ')}]`)
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
    const gotFaces = new Map<string, number>()
    for (const f of got.faces) gotFaces.set(cyclic(f), (gotFaces.get(cyclic(f)) ?? 0) + 1)
    for (const f of want.faces) {
        const k = cyclic(f.map(i => map[i]))
        const n = gotFaces.get(k) ?? 0
        if (!n) problems.push(`no face matching Blender's [${f.map(i => `(${want.verts[i].join(',')})`).join(' ')}] with its winding`)
        else gotFaces.set(k, n - 1)
    }
    const pair = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`
    const gotEdges = new Set(got.edges.map(([a, b]) => pair(a, b)))
    for (const [a, b] of want.edges) {
        if (!gotEdges.has(pair(map[a], map[b]))) problems.push(`no edge between Blender's [${want.verts[a].join(', ')}] and [${want.verts[b].join(', ')}]`)
    }
    return problems
}

/** The fixture's 3D view as a {@link KnifeView}. */
export function fixtureView(fx: Fixture): KnifeView {
    const v = fx.view!
    return new KnifeView({
        viewmat: colMajor(v.viewmat), winmat: colMajor(v.winmat), winx: v.winx, winy: v.winy,
        clipStart: v.clip_start, clipEnd: v.clip_end,
    })
}
