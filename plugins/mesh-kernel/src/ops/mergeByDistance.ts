/**
 * Merge by Distance in edit mode: Blender's `mesh.remove_doubles` (`M` > By Distance).
 *
 * Port of `edbm_remove_doubles_exec` (`editors/mesh/editmesh_tools.cc:3652`) with the props of
 * `MESH_OT_remove_doubles` (`:3746`), and of `EDBM_automerge` (`editmesh_automerge.cc:83`) for
 * `use_unselected`. The finding and welding are the kernel's existing ports of `find_doubles` and
 * `weld_verts` (`removeDoubles.ts`, `weld.ts`).
 *
 * `use_sharp_edge_from_normals` only matters with custom split normals
 * (`BM_custom_loop_normals_to_vector_layer` / `_from_vector_layer`); the kernel has no custom normal
 * layer, so - as in Blender on a mesh without one - it changes nothing.
 */

import {BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {ElemFlag, ElemType, SelectMode} from '../constants'
import {elemHflagEnableTest} from '../bmesh/hflag'
import {selectModeFlush} from '../bmesh/marking'
import {findDoublesByDistance} from './removeDoubles'
import {weldVerts} from './weld'

export interface MergeByDistanceOptions {
    /** Maximum distance between elements to merge. Blender's `threshold`, default 0.0001 (min 1e-6, max 50). */
    threshold?: number
    /**
     * Move vertices to the centroid of the duplicate cluster, otherwise the vertex closest to the
     * centroid is used. Blender's `use_centroid`, default true.
     */
    useCentroid?: boolean
    /** Merge selected to other unselected vertices. Blender's `use_unselected`, default false. */
    useUnselected?: boolean
    /** Calculate sharp edges using custom normal data (when available). Default false; see the module note. */
    useSharpEdgeFromNormals?: boolean
}

export interface MergeByDistanceResult {
    ok: true
    /** Vertices removed - Blender's "Removed %d vertices" report. */
    removed: number
}

/** `MESH_OT_remove_doubles` defaults (`editmesh_tools.cc:3760`-`:3782`). */
export const MERGE_BY_DISTANCE_DEFAULTS: Required<MergeByDistanceOptions> = {
    threshold: 1e-4,
    useCentroid: true,
    useUnselected: false,
    useSharpEdgeFromNormals: false,
}

/**
 * Merge the selected vertices that lie within `threshold` of each other (or, with `useUnselected`,
 * merge them into unselected vertices within range), keeping the selection as it was.
 */
export function mergeByDistanceSelection(bm: BMesh, options: MergeByDistanceOptions = {}): MergeByDistanceResult {
    const threshold = options.threshold ?? MERGE_BY_DISTANCE_DEFAULTS.threshold
    const useCentroid = options.useCentroid ?? MERGE_BY_DISTANCE_DEFAULTS.useCentroid
    const useUnselected = options.useUnselected ?? MERGE_BY_DISTANCE_DEFAULTS.useUnselected

    // Selection used as target with 'use_unselected'.
    if (bm.totvertsel === 0) return {ok: true, removed: 0}

    const totvertOrig = bm.totvert

    // avoid losing selection state (select -> tags)
    const htypeSelect = bm.selectMode & SelectMode.Vertex ? ElemType.Vert
        : bm.selectMode & SelectMode.Edge ? ElemType.Edge : ElemType.Face

    // store selection as tags
    elemHflagEnableTest(bm, htypeSelect, ElemFlag.Tag, true, true, ElemFlag.Select)

    let targetmap: Map<BMVert, BMVert>
    if (useUnselected) {
        // `EDBM_automerge(obedit, false, BM_ELEM_SELECT, threshold, use_centroid)` (`:3697`):
        // "find_doubles verts=%av keep_verts=%Hv dist=%f use_connected=%b" - every vertex is a
        // candidate (`%av` does not skip hidden ones), the unselected visible ones are kept
        // (`%Hv` with `BMO_FLAG_RESPECT_HIDE`), so only non-kept vertices merge into kept ones.
        const all = [...bm.verts]
        const keep = new Set(all.filter(v => !(v.hflag & ElemFlag.Select) && !(v.hflag & ElemFlag.Hidden)))
        targetmap = findDoublesByDistance(all, threshold, keep.size ? keep : undefined)
    } else {
        // "find_doubles verts=%hv dist=%f" (`:3700`): the selected, visible vertices.
        const verts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select && !(v.hflag & ElemFlag.Hidden))
        targetmap = findDoublesByDistance(verts, threshold)
    }
    // "weld_verts targetmap=%S use_centroid=%b" (`:3704`).
    weldVerts(bm, targetmap, {useCentroid})

    const count = totvertOrig - bm.totvert

    // restore selection from tags
    elemHflagEnableTest(bm, htypeSelect, ElemFlag.Select, true, true, ElemFlag.Tag)
    selectModeFlush(bm)

    return {ok: true, removed: count}
}
