/**
 * Fixture plumbing shared by `knife-bisect-parity.test.ts` and debugging scripts: loading the Blender
 * fixtures in `fixtures/knife-bisect/`, rebuilding their input as Blender's edit mode does, and an
 * order-free mesh comparison. See the parity test for what the fixtures are.
 */

import {readdirSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {BMesh} from '../src/bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../src/bmesh/types'
import {ElemFlag} from '../src/constants'
import {tessellatePolygon} from '../src/bake'
import {isectRayTriWatertightPrecalc, isectRayTriWatertightV3} from '../src/ops/knife/geom'
// mesh-edit's port of Blender's square spiral (`_bli_array_iter_spiral_square`); dependency-free.
import {findNearestId} from '../../mesh-edit/src/select/spiral'
import {diskEdgeExists} from '../src/bmesh/structure'
import {KnifeView} from '../src/ops/knife/view'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'knife-bisect')
const DIR_INTERACTIVE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'knife-interactive')

export interface MeshDump {verts: number[][], faces: number[][], edges: number[][]}
/** One input event as Blender's modal knife received it (`gen-knife-interactive-fixtures.py`). */
export interface RecordedEvent {
    type: string
    value: 'PRESS' | 'RELEASE' | 'NOTHING'
    /** Region pixels, bottom-left origin. */
    mval: [number, number]
    shift?: boolean
    ctrl?: boolean
}

export interface Fixture {
    name: string
    kind: 'knife' | 'bisect' | 'knife-interactive' | 'bisect-interactive'
    blender: string
    input: MeshDump
    output: MeshDump
    // knife
    cut_through?: boolean
    view?: {persp: string, is_persp: boolean, winx: number, winy: number, clip_start: number, clip_end: number,
        persmat: number[][], viewmat: number[][], winmat: number[][]}
    polys?: number[][][]
    // knife-interactive
    events?: RecordedEvent[]
    ui_scale_fac?: number
    // bisect-interactive
    view_location?: number[]
    props?: {xstart: number, ystart: number, xend: number, yend: number, flip: boolean, plane_co: number[], plane_no: number[],
        threshold: number, use_fill: boolean, clear_inner: boolean, clear_outer: boolean}
    // bisect
    plane_co?: number[]
    plane_no?: number[]
    clear_inner?: boolean
    clear_outer?: boolean
    use_fill?: boolean
    threshold?: number
}

const load = (dir: string): Fixture[] => readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(readFileSync(resolve(dir, f), 'utf8')))

/** `knife_project` and bisect cases. */
export const fixtures: Fixture[] = load(DIR)
/** Interactive knife cases: Blender's modal knife fed simulated input. */
export const interactiveFixtures: Fixture[] = load(DIR_INTERACTIVE).filter(f => f.kind === 'knife-interactive')
/** Bisect drawn with the line gesture: the plane Blender derived from the drag, and the result. */
export const bisectGestureFixtures: Fixture[] = load(DIR_INTERACTIVE).filter(f => f.kind === 'bisect-interactive')

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

/**
 * A CPU stand-in for Blender's face selection buffer, as the interactive knife reads it through
 * `EDBM_face_find_nearest(vc, &dist)` (`editmesh_select.cc:881`) when the cursor ray misses every face
 * (`knife_find_closest_face`, `editmesh_knife.cc:3097`): a `(2r+1)^2` square of face ids around the
 * cursor (`ED_view3d_backbuf_sample_size_clamp`: `r = ceil(dist)`), each pixel the front-most face
 * whose triangles cover its centre - what the depth-tested ID render holds - searched with Blender's
 * square spiral (`DRW_select_buffer_find_nearest_to_point`), and accepted when the Manhattan distance
 * of the hit is below `dist`. The spiral is mesh-edit's port of `_bli_array_iter_spiral_square`.
 */
export function faceFindNearestCpu(bm: BMesh, view: KnifeView, distPx: number): (mval: [number, number]) => BMFace | null {
    const tris: {f: BMFace, cos: [number, number, number][]}[] = []
    for (const f of bm.faces) {
        if (f.hflag & ElemFlag.Hidden) continue
        const loops = f.loops()
        const pts: number[] = []
        for (const l of loops) pts.push(l.v.x, l.v.y, l.v.z)
        const idx: number[] = []
        tessellatePolygon(pts, idx)
        for (let i = 0; i < idx.length; i += 3) {
            tris.push({f, cos: [0, 1, 2].map(k => [loops[idx[i + k]].v.x, loops[idx[i + k]].v.y, loops[idx[i + k]].v.z]) as [number, number, number][]})
        }
    }
    const faces = [...bm.faces]
    const faceAt = (x: number, y: number): number => {
        const ray = view.winToRayClipped([x + 0.5, y + 0.5])
        const pre = isectRayTriWatertightPrecalc(ray.dir)
        let best = Infinity
        let face: BMFace | null = null
        for (const t of tris) {
            const r = isectRayTriWatertightV3(ray.start, pre, t.cos[0], t.cos[1], t.cos[2])
            if (r && r[0] < best) {
                best = r[0]
                face = t.f
            }
        }
        return face ? faces.indexOf(face) + 1 : 0
    }
    return (mval) => {
        const r = Math.min(Math.ceil(distPx), Math.max(view.winx, view.winy))
        const size = 2 * r + 1
        // GL order, row 0 at the bottom, as Blender reads its buffer.
        const ids = new Array<number>(size * size)
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) ids[row * size + col] = faceAt(mval[0] - r + col, mval[1] - r + row)
        }
        const hit = findNearestId(ids, size)
        if (!hit || !(hit.dist < distPx)) return null
        return faces[hit.id - 1]
    }
}
