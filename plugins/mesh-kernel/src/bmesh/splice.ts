/**
 * Splicing: fusing geometry that is already known to coincide element for element.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_core.cc` (`BM_vert_splice`, `BM_edge_splice`),
 * `bmesh_structure.cc` (`bmesh_edge_vert_swap`) and `bmesh_query.cc` (`BM_edge_find_double`,
 * `BM_face_find_double`).
 *
 * A splice is not a weld. `weldVerts` (`ops/weld.ts`, `bmo_weld_verts_exec`) takes an arbitrary target
 * map, splits faces whose own corners collide, collapses edges and rebuilds faces; it has to, because
 * the geometry being merged is only approximately coincident and the faces may overlap in any way.
 * A splice assumes the caller already knows the two pieces line up one for one, and so creates and
 * destroys nothing but the elements being removed: every face keeps its identity, its winding, its
 * attributes and its per-corner data, and simply ends up naming the survivor.
 *
 * That is exactly the situation at the seam of a full revolution, which is why `bmo_spin_exec` closes
 * its last ring with `BM_vert_splice` rather than with a weld - see `generate/spin.ts`.
 */

import {BMEdge, BMFace, BMVert} from './types'
import {BMesh} from './BMesh'
import {diskVertReplace, radialLoopAppend, radialLoopRemove, radialLoops} from './structure'

/**
 * Replace `vOld` with `vNew` on `e`, fixing both the disk cycle and the loops that name `vOld`.
 *
 * Port of `bmesh_edge_vert_swap` (`bmesh_structure.cc:37`). The loop pass is the part
 * `diskVertReplace` does not do: a loop names a vertex, so moving an edge between vertices has to
 * repoint the two loops of every face along that edge. Blender's non-recursive form only fixes the
 * loops of `e`; callers such as {@link vertSplice} run it over every edge of `vOld`, which covers
 * every loop because each corner belongs to two of them.
 */
export function edgeVertSwap(e: BMEdge, vNew: BMVert, vOld: BMVert): void {
    if (e.l) {
        for (const l of radialLoops(e)) {
            if (l.v === vOld) l.v = vNew
            else if (l.next.v === vOld) l.next.v = vNew
        }
    }
    diskVertReplace(e, vNew, vOld)
}

/**
 * Move every edge of `vSrc` onto `vDst` and remove `vSrc`.
 *
 * Port of `BM_vert_splice` (`bmesh_core.cc:2395`).
 *
 * Precondition, asserted by Blender and relied on here: the two vertices share no face. Splicing
 * across a face would leave that face naming the same vertex twice.
 *
 * Returns false when the two are already the same vertex, matching Blender's return.
 */
export function vertSplice(bm: BMesh, vDst: BMVert, vSrc: BMVert): boolean {
    if (vSrc === vDst) return false

    // `while ((e = v_src->e))` - every swap unlinks the edge from the source disk, so the loop ends
    // when the disk is empty rather than by walking it.
    let e = vSrc.e
    while (e) {
        edgeVertSwap(e, vDst, vSrc)
        e = vSrc.e
    }

    bm.vertKill(vSrc)
    return true
}

/**
 * Move every face of `eSrc` onto `eDst` and remove `eSrc`.
 *
 * Port of `BM_edge_splice` (`bmesh_core.cc:2678`). The pair left behind by a {@link vertSplice} is
 * two edges joining the same two vertices; this collapses them into one, which is what
 * {@link edgeFindDouble} is for.
 *
 * Returns false when the two edges do not span the same vertex pair.
 */
export function edgeSplice(bm: BMesh, eDst: BMEdge, eSrc: BMEdge): boolean {
    if (!eSrc.uses(eDst.v1) || !eSrc.uses(eDst.v2)) return false

    while (eSrc.l) {
        const l = eSrc.l
        radialLoopRemove(eSrc, l)
        radialLoopAppend(eDst, l)
    }

    // No face is left using it, so this only unlinks the two disk cycles.
    bm.edgeKill(eSrc)
    return true
}

/**
 * Another edge joining the same two vertices as `e`, or null. Walks `e`'s own disk cycle at `v1`.
 *
 * Port of `BM_edge_find_double` (`bmesh_query.cc:1596`). Splicing two pieces of geometry together
 * leaves duplicate edges behind, and this is how they are found.
 */
export function edgeFindDouble(e: BMEdge): BMEdge | null {
    const v = e.v1
    const vOther = e.v2
    let iter = e.diskNext(v)
    while (iter && iter !== e) {
        if (iter.uses(vOther)) return iter
        iter = iter.diskNext(v)
    }
    return null
}

/**
 * Another face made of exactly the same loop of edges as `f`, or null.
 *
 * Port of `BM_face_find_double` (`bmesh_query.cc:1675`). Only faces sharing `f`'s first edge can be
 * doubles, so the search is the radial cycle of that one edge. Blender compares in both directions
 * because the duplicate may have the opposite winding.
 *
 * Distinct from `faceExists` in `ops/weld.ts` (`BM_face_exists`), which searches for a face over a
 * given vertex list; this one starts from a face that is already in the mesh.
 */
export function faceFindDouble(f: BMFace): BMFace | null {
    const lFirst = f.lFirst
    if (!lFirst) return null
    for (let lIter = lFirst.radialNext; lIter && lIter !== lFirst; lIter = lIter.radialNext) {
        if (lIter.f.len !== lFirst.f.len) continue
        let lA = lFirst
        let lB = lIter
        const lBInit = lIter
        if (lIter.v === lFirst.v) {
            // Same winding: walk both forwards.
            do {
                if (lA.e !== lB.e) break
                lA = lA.next
                lB = lB.next
            } while (lB !== lBInit)
        } else {
            // Opposite winding: walk `f` backwards against the other face.
            do {
                if (lA.e !== lB.e) break
                lA = lA.prev
                lB = lB.next
            } while (lB !== lBInit)
        }
        if (lB === lBInit) return lIter.f
    }
    return null
}
