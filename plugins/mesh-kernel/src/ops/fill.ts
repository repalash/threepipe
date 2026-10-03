/**
 * Fill: make an edge or a face from the selection. Blender's `F` (`MESH_OT_edge_face_add`).
 *
 * Ported from `source/blender/bmesh/operators/bmo_create.cc` (`bmo_contextual_create_exec`) and
 * `bmo_fill_edgeloop.cc` (`bmo_edgeloop_fill_exec`). The contextual operator tries, in order: an
 * edge from two vertices; two edges closing a ring that has one free vertex; an edge-net fill; a
 * face dissolve when faces are selected; and an edge-loop fill. The edge-net fill (`bmo_edgenet.cc`,
 * `edgenet_prepare` + `edgenet_fill`, which fills several holes and partial nets at once) is **not
 * ported**: a selection that only an edge net could fill returns null here, and the caller says so.
 * The one-vertex and two-vertex "tricky extend" cases of `edbm_add_edge_face_exec__tricky_extend_sel`
 * (`editmesh_tools.cc:783`) are not ported either.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {ElemFlag} from '../constants'
import {diskEdges} from '../bmesh/structure'
import {edgeSelectSet, faceSelectSet} from '../bmesh/marking'
import {faceExists} from './weld'
import {dissolveFaces} from './dissolve'

export interface FillResult {
    /** Faces made (or the dissolved region). */
    faces: BMFace[]
    /** Edges made. */
    edges: BMEdge[]
    /** The first face made, for callers that want one thing to select. */
    face: BMFace | null
}

/**
 * Fill isolated edge loops: each closed loop of the given edges, where every vertex uses exactly two
 * of them, becomes one face. Port of `bmo_edgeloop_fill_exec` (`bmo_fill_edgeloop.cc:14`); `mat_nr`
 * and `use_smooth` are not ported (the kernel's faces carry no material index yet).
 */
export function edgeloopFill(bm: BMesh, edges: readonly BMEdge[]): BMFace[] {
    const marked = new Set(edges)
    const verts: BMVert[] = []
    const used = new Set<BMVert>()
    for (const e of edges) {
        for (const v of [e.v1, e.v2]) {
            if (used.has(v)) continue
            if (verts.length === edges.length) return [] // more verts than edges: not loops
            used.add(v)
            verts.push(v)
        }
    }
    if (verts.length !== edges.length) return []

    // Every vertex has to use exactly two of the marked edges.
    for (const v of verts) {
        let n = 0
        for (const e of diskEdges(v)) if (marked.has(e)) n++
        if (n !== 2) return []
    }

    const out: BMFace[] = []
    let totvUsed = 0
    let ePrev: BMEdge | null = null
    while (totvUsed < verts.length) {
        let v = verts.find(x => used.has(x))!
        const fVerts: BMVert[] = []
        do {
            let eNext: BMEdge | null = null
            for (const e of diskEdges(v)) {
                if (marked.has(e) && e !== ePrev) {
                    eNext = e
                    break
                }
            }
            if (!eNext) return out
            fVerts.push(v)
            used.delete(v)
            totvUsed++
            v = eNext.otherVert(v)
            ePrev = eNext
        } while (v !== fVerts[0])

        if (!faceExists(fVerts)) {
            out.push(faceCreateNgonVerts(bm, fVerts))
        }
    }
    return out
}

/**
 * Create a face from an ordered vertex loop whose edges already exist, wound against the faces
 * that already use those edges so the new face's normal agrees with its neighbours.
 *
 * The winding vote of `BM_face_create_ngon_verts` (`bmesh_construct.cc:230`, `calc_winding`): for
 * every edge of the loop that has a face, note whether our order runs the same way that face runs
 * it; when most do, the loop is reversed, since adjacent faces must traverse a shared edge in
 * opposite directions.
 */
export function faceCreateNgonVerts(bm: BMesh, verts: readonly BMVert[]): BMFace {
    const winding = [0, 0]
    let prev = verts[verts.length - 1]
    for (const v of verts) {
        const e = prev.e ? [...diskEdges(prev)].find(x => x.joins(prev, v)) : undefined
        const l = e?.l
        if (l) {
            // `BM_edge_ordered_verts(e, &test_v2, &test_v1)`: the face at `e` runs `l.v` then the other end.
            const testV2 = l.v
            winding[prev === testV2 ? 1 : 0]++
        }
        prev = v
    }
    const ordered = winding[0] < winding[1] ? [...verts].reverse() : [...verts]
    return bm.faceCreate(ordered)
}

/**
 * The contextual create: what `F` does with the current selection. Returns null when nothing could
 * be made (and nothing was changed).
 */
export function fillSelection(bm: BMesh): FillResult | null {
    const verts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
    const edges = [...bm.edges].filter(e => e.hflag & ElemFlag.Select)
    const faces = [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    const totv = verts.length
    const tote = edges.length
    const totf = faces.length
    const eleNew = new Set<BMEdge>(edges)
    const madeEdges: BMEdge[] = []

    // --- Support Edge Creation: the simple case of exactly two vertices.
    if (totv === 2 && tote === 0 && totf === 0) {
        const e = bm.edgeCreate(verts[0], verts[1], undefined, {noDouble: true})
        edgeSelectSet(bm, e, true)
        return {faces: [], edges: [e], face: null}
    }

    // --- A contiguous edge ring with one isolated vertex: two edges close it.
    if (totf === 0 && totv >= 4 && totv === tote + 2) {
        let vFree: BMVert | null = null
        let vA: BMVert | null = null
        let vB: BMVert | null = null
        let ok = true
        for (const v of verts) {
            let n = 0
            for (const e of diskEdges(v)) if (eleNew.has(e)) n++
            if (n === 0) {
                if (!vFree) vFree = v
                else ok = false
            } else if (n === 1) {
                if (!vA) vA = v
                else if (!vB) vB = v
                else ok = false
            } else if (n !== 2) {
                ok = false
            }
            if (!ok) break
        }
        if (ok && vFree && vA && vB) {
            for (const other of [vA, vB]) {
                const e = bm.edgeCreate(vFree, other, undefined, {noDouble: true})
                eleNew.add(e)
                madeEdges.push(e)
                edgeSelectSet(bm, e, true)
            }
        }
    }

    // (edgenet_prepare + edgenet_fill would go here; see the module comment.)

    // --- Dissolve faces: with faces selected, F merges the region into one face. A single face
    // runs too, so it does not fall through to building a face from its own corners.
    if (totf !== 0) {
        const before = bm.totface
        const region = dissolveFaces(bm, faces)
        if (region.length && bm.totface < before) {
            for (const f of region) faceSelectSet(bm, f, true)
            return {faces: region, edges: madeEdges, face: region[0]}
        }
        if (region.length) return null
    }

    // --- Edge loops: a closed loop of selected edges becomes a face.
    if (eleNew.size > 2) {
        const made = edgeloopFill(bm, [...eleNew])
        if (made.length) {
            for (const f of made) faceSelectSet(bm, f, true)
            return {faces: made, edges: madeEdges, face: made[0]}
        }
    }

    return madeEdges.length ? {faces: [], edges: madeEdges, face: null} : null
}
