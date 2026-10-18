/**
 * Snap targets from an edit mesh or a rendered geometry, in world space, for {@link SnapContext}.
 *
 * The edit mesh excludes what is being moved, as Blender's `bm_edge_is_snap_target` /
 * `bm_face_is_snap_target` (`transform_snap.cc:653`) and the vertex `BM_ELEM_SELECT | BM_ELEM_HIDDEN`
 * filter do, so a dragged vertex never snaps to itself or to the faces it belongs to.
 */

import {BMesh, BMVert, ElemFlag, ElemType} from '@threepipe/mesh-kernel'
import {axisDominantV3ToM3, crossV3, Mat4, mulM3V3, mulM4V3, subV3, Vec3} from '../transform/math'
import type {SnapTargetMesh} from './snap'
import {faceNo} from '../transform/bmeshQuery'

/** An edit mesh as a snap target; `excludeSelected` leaves out the moving selection. */
export function snapTargetFromBMesh(bm: BMesh, matrixWorld: Mat4, excludeSelected = true, id?: unknown): SnapTargetMesh {
    bm.elemIndexEnsure(ElemType.Vert | ElemType.Edge | ElemType.Face)
    const nv = bm.totvert
    const positions = new Float32Array(nv * 3)
    const vertOk = new Uint8Array(nv)
    for (const v of bm.verts) {
        const p = mulM4V3(matrixWorld, [v.x, v.y, v.z])
        positions[v.index * 3] = p[0]
        positions[v.index * 3 + 1] = p[1]
        positions[v.index * 3 + 2] = p[2]
        vertOk[v.index] = v.hflag & ElemFlag.Hidden || excludeSelected && v.hflag & ElemFlag.Select ? 0 : 1
    }

    const ne = bm.totedge
    const edges = new Uint32Array(ne * 2)
    const edgeOk = new Uint8Array(ne)
    for (const e of bm.edges) {
        edges[e.index * 2] = e.v1.index
        edges[e.index * 2 + 1] = e.v2.index
        const moving = excludeSelected && (e.hflag & ElemFlag.Select || e.v1.hflag & ElemFlag.Select || e.v2.hflag & ElemFlag.Select)
        edgeOk[e.index] = e.hflag & ElemFlag.Hidden || moving ? 0 : 1
    }

    const tris: number[] = []
    const triFace: number[] = []
    const triOk: number[] = []
    const faceVerts: Uint32Array[] = []
    const faceEdges: Uint32Array[] = []
    for (const f of bm.faces) {
        const verts: BMVert[] = []
        const fe: number[] = []
        let moving = (f.hflag & ElemFlag.Select) !== 0 && excludeSelected
        for (const l of f.eachLoop()) {
            verts.push(l.v)
            if (l.e) fe.push(l.e.index)
            if (excludeSelected && l.v.hflag & ElemFlag.Select) moving = true
        }
        faceVerts[f.index] = new Uint32Array(verts.map(v => v.index))
        faceEdges[f.index] = new Uint32Array(fe)
        const ok = f.hflag & ElemFlag.Hidden || moving ? 0 : 1
        const no = faceNo(f)
        for (const [a, b, c] of triangulate(verts.map(v => [v.x, v.y, v.z] as Vec3), no)) {
            tris.push(verts[a].index, verts[b].index, verts[c].index)
            triFace.push(f.index)
            triOk.push(ok)
        }
    }

    return {
        positions, edges, tris: new Uint32Array(tris), triFace: new Int32Array(triFace),
        faceVerts, faceEdges, vertOk, edgeOk, triOk: new Uint8Array(triOk), id,
    }
}

/** A rendered triangle geometry as a snap target: every triangle's edges, deduplicated. */
export function snapTargetFromGeometry(position: ArrayLike<number>, index: ArrayLike<number> | null, matrixWorld: Mat4, id?: unknown): SnapTargetMesh {
    const nv = position.length / 3
    const positions = new Float32Array(nv * 3)
    for (let i = 0; i < nv; i++) {
        const p = mulM4V3(matrixWorld, [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]])
        positions[i * 3] = p[0]
        positions[i * 3 + 1] = p[1]
        positions[i * 3 + 2] = p[2]
    }
    const triCount = index ? index.length / 3 : nv / 3
    const tris = new Uint32Array(triCount * 3)
    for (let i = 0; i < triCount * 3; i++) tris[i] = index ? index[i] : i

    const edgeMap = new Map<number, number>()
    const edges: number[] = []
    const faceVerts: Uint32Array[] = []
    const faceEdges: Uint32Array[] = []
    const edgeIndex = (a: number, b: number): number => {
        const key = a < b ? a * nv + b : b * nv + a
        let e = edgeMap.get(key)
        if (e === undefined) {
            e = edges.length / 2
            edges.push(a, b)
            edgeMap.set(key, e)
        }
        return e
    }
    const triFace = new Int32Array(triCount)
    for (let t = 0; t < triCount; t++) {
        const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2]
        faceVerts.push(new Uint32Array([a, b, c]))
        faceEdges.push(new Uint32Array([edgeIndex(a, b), edgeIndex(b, c), edgeIndex(c, a)]))
        triFace[t] = t
    }
    return {
        positions, edges: new Uint32Array(edges), tris, triFace, faceVerts, faceEdges,
        vertOk: new Uint8Array(nv).fill(1), edgeOk: new Uint8Array(edges.length / 2).fill(1), triOk: new Uint8Array(triCount).fill(1), id,
    }
}

/** Triangle index triples for a polygon: a fan for convex quads and ear clipping beyond. */
export function triangulate(co: Vec3[], normal: Vec3): [number, number, number][] {
    const n = co.length
    if (n < 3) return []
    if (n === 3) return [[0, 1, 2]]
    // Project onto the face plane and clip ears (`BLI_polyfill_calc` in spirit).
    const m = axisDominantV3ToM3(normal)
    const pts = co.map(p => {
        const q = mulM3V3(m, p)
        return [q[0], q[1]] as [number, number]
    })
    const idx = pts.map((_, i) => i)
    const out: [number, number, number][] = []
    const area2 = (a: number, b: number, c: number): number =>
        (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])
    // Winding of the whole polygon decides which way an ear is convex.
    let signedArea = 0
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        signedArea += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
    }
    const sign = signedArea >= 0 ? 1 : -1
    const inside = (p: [number, number], a: number, b: number, c: number): boolean => {
        const s = (i: number, j: number) => (pts[j][0] - pts[i][0]) * (p[1] - pts[i][1]) - (pts[j][1] - pts[i][1]) * (p[0] - pts[i][0])
        const d1 = s(a, b) * sign, d2 = s(b, c) * sign, d3 = s(c, a) * sign
        return d1 >= 0 && d2 >= 0 && d3 >= 0
    }
    let guard = 0
    while (idx.length > 3 && guard++ < n * n) {
        let clipped = false
        for (let i = 0; i < idx.length; i++) {
            const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length]
            if (area2(a, b, c) * sign <= 0) continue
            let ear = true
            for (const k of idx) {
                if (k === a || k === b || k === c) continue
                if (inside(pts[k], a, b, c)) {
                    ear = false
                    break
                }
            }
            if (!ear) continue
            out.push([a, b, c])
            idx.splice(i, 1)
            clipped = true
            break
        }
        if (!clipped) break
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]])
    else for (let i = 1; i + 1 < idx.length; i++) out.push([idx[0], idx[i], idx[i + 1]])
    return out
}

/** Unused helper kept for symmetry with Blender's normal recomputation in snapping. */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
    return crossV3(subV3(b, a), subV3(c, a))
}
