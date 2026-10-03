/**
 * The `BM_*` modifiers one level above the Euler operators: what Blender's bmesh operators call to
 * split an edge or a face.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_mods.cc`. The multires (`CD_MDISPS`) branches of
 * both functions are not ported: the kernel has no multires layer, and without one Blender skips
 * them (`cd_loop_mdisp_offset == -1`).
 */

import {BMEdge, BMFace, BMLoop, BMVert} from './types'
import {BMesh} from './BMesh'
import {SplitEdgeResult, SplitFaceResult, splitEdgeMakeVert, splitFaceMakeEdge} from './euler'

/**
 * `BM_edge_split` (`bmesh_mods.cc:478`): insert a vertex into `e` at `fac` of the way from `v` to
 * the other end. The new edge `eNew` runs from `v` to the new vertex (`v_new == e_new->v2`) and `e`
 * keeps the far end; corner and vertex data are interpolated at `fac` (`:521`-`:522`), and the new
 * edge copies `e`'s flags and attributes (`:518`-`:519`, done by `edgeCreate`'s example).
 */
export function edgeSplit(bm: BMesh, e: BMEdge, v: BMVert, fac: number): SplitEdgeResult {
    return splitEdgeMakeVert(bm, e, v, fac)
}

/** `BM_loop_is_adjacent` (`bmesh_query.cc`): `l_b` follows or precedes `l_a` in their face. */
export function loopIsAdjacent(lA: BMLoop, lB: BMLoop): boolean {
    return lA.next === lB || lA.prev === lB
}

/**
 * `BM_face_split` (`bmesh_mods.cc:207`): cut `f` in two along a new edge from `lA.v` to `lB.v`.
 * Returns null, changing nothing, when the loops are adjacent or not both of `f` (`:221`, the
 * "could be an assert" guard). `example` is copied onto the new edge; with `noDouble` an edge that
 * already joins the two vertices is reused. The result's `lNew` is Blender's `r_l`.
 */
export function faceSplit(
    bm: BMesh, f: BMFace, lA: BMLoop, lB: BMLoop, example?: BMEdge, noDouble = false,
): SplitFaceResult | null {
    if (lA === lB || loopIsAdjacent(lA, lB) || f !== lA.f || f !== lB.f) return null
    return splitFaceMakeEdge(bm, f, lA, lB, example, noDouble)
}
