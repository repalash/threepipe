/**
 * Edge Split: `BM_mesh_edgesplit` (`source/blender/bmesh/tools/bmesh_edgesplit.cc:22`),
 * `bmo_split_edges_exec` (`bmesh/operators/bmo_split_edges.cc:18`) and the edit-mode operator
 * (`edbm_edge_split_selected_edges` / `_verts`, `edbm_edge_split_exec`,
 * `editors/mesh/editmesh_tools.cc:1906-2040`).
 */

import {BMEdge, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {vertSeparate, vertSeparateHflag} from '../bmesh/separate'
import {elemHflagDisableAll, elemsHflagEnable} from '../bmesh/hflag'
import {selectFlushFromVerts, vertSelectSet} from '../bmesh/marking'
import {ElemFlag, ElemType} from '../constants'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'

/**
 * `BM_mesh_edgesplit` (`bmesh_edgesplit.cc:22`) with `tag_only` and without `copy_select` (the operator's
 * call): split every `Tag`ged edge per face, then each tagged vertex per fan.
 */
export function meshEdgesplit(bm: BMesh, useVerts: boolean): void {
    if (useVerts) {
        // "prevent one edge having both verts unflagged"
        for (const e of bm.edges) {
            if ((e.hflag & ElemFlag.Tag) && !(e.v1.hflag & ElemFlag.Tag) && !(e.v2.hflag & ElemFlag.Tag)) {
                e.v1.hflag |= ElemFlag.Tag
                e.v2.hflag |= ElemFlag.Tag
            }
        }
    } else {
        for (const e of bm.edges) {
            if (e.hflag & ElemFlag.Tag) {
                e.v1.hflag |= ElemFlag.Tag
                e.v2.hflag |= ElemFlag.Tag
            }
        }
    }
    for (const e of bm.edges) {
        if (!bm.edges.has(e) || !(e.hflag & ElemFlag.Tag)) continue
        for (const v of [e.v1, e.v2]) {
            if (v.hflag & ElemFlag.Tag) {
                v.hflag &= ~ElemFlag.Tag
                vertSeparateHflag(bm, v, ElemFlag.Tag, false)
            }
        }
    }
}

/**
 * `bmo_split_edges_exec`: split `edges` (and with `useVerts`, at `verts` only). Returns `edges.out`: every
 * tagged edge afterwards (the inputs and their copies), in mesh order.
 */
export function splitEdges(bm: BMesh, edges: readonly BMEdge[], verts: readonly BMVert[] = [], useVerts = false): BMEdge[] {
    elemHflagDisableAll(bm, ElemType.Edge, ElemFlag.Tag, false)
    for (const e of edges) e.hflag |= ElemFlag.Tag
    if (useVerts) {
        // "this slows down the operation but its ok because the modifier doesn't use"
        for (const v of verts) v.hflag |= ElemFlag.Tag
    }
    meshEdgesplit(bm, useVerts)
    return [...bm.edges].filter(e => e.hflag & ElemFlag.Tag)
}

/** `bmo_split_edges_def` `type_flag`: UNTAN_MULTIRES | NORMALS_CALC | SELECT_FLUSH. */
const SPLIT_EDGES_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true}

export type EdgeSplitType = 'EDGE' | 'VERT'

/**
 * `MESH_OT_edge_split` (`edbm_edge_split_exec`, `editmesh_tools.cc:2008`): `EDGE` splits the faces along
 * the selected edges; `VERT` splits faces and edges at the selected vertices.
 */
export function edgeSplitSelection(bm: BMesh, type: EdgeSplitType = 'EDGE'): {ok: true} | {ok: false, error: string} {
    if (type === 'EDGE') {
        // `edbm_edge_split_selected_edges` (:1906)
        if (bm.totedgesel === 0) return {ok: false, error: 'No edges selected'}
        const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden))
        const out = bmoOpExec(bm, SPLIT_EDGES_TYPE_FLAG, () => splitEdges(bm, edges))
        // `EDBM_op_call_and_selectf(em, op, "edges.out", false, ..)`
        elemHflagDisableAll(bm, ElemType.Vert | ElemType.Edge | ElemType.Face, ElemFlag.Select, false)
        elemsHflagEnable(bm, out, ElemType.Edge, ElemFlag.Select, true)
        selectFlushFromVerts(bm, true)
        return {ok: true}
    }
    // `edbm_edge_split_selected_verts` (:1933): "tracking vertices through the 'split_edges' operator is
    // complicated. Instead, tag loops for selection."
    if (bm.totvertsel === 0) return {ok: false, error: 'No vertices selected'}
    const loopTag = new Set<BMLoop>()
    for (const e of bm.edges) {
        e.hflag &= ~ElemFlag.Tag
        if (e.l !== null) {
            if (!(e.hflag & ElemFlag.Hidden) && ((e.v1.hflag & ElemFlag.Select) || (e.v2.hflag & ElemFlag.Select))) e.hflag |= ElemFlag.Tag
            // Store selection in loop tags.
            let l = e.l
            do {
                if (l.v.hflag & ElemFlag.Select) loopTag.add(l)
                else loopTag.delete(l)
            } while ((l = l.radialNext!) !== e.l)
        }
    }
    const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Tag) && !(e.hflag & ElemFlag.Hidden))
    const verts = [...bm.verts].filter(v => (v.hflag & ElemFlag.Select) && !(v.hflag & ElemFlag.Hidden))
    // `EDBM_op_callf(em, op, "split_edges edges=%he verts=%hv use_verts=%b", BM_ELEM_TAG, BM_ELEM_SELECT, true)`
    bmoOpExec(bm, SPLIT_EDGES_TYPE_FLAG, () => splitEdges(bm, edges, verts, true))
    for (const e of [...bm.edges]) {
        if (!bm.edges.has(e)) continue
        if (e.l !== null) {
            let l = e.l
            do {
                if (loopTag.has(l)) vertSelectSet(bm, l.v, true)
            } while ((l = l.radialNext!) !== e.l)
        } else {
            // Split out wire.
            for (const v of [e.v1, e.v2]) {
                if ((v.hflag & ElemFlag.Select) && e.diskNext(v) !== e) vertSeparate(bm, v, [e], true)
            }
        }
    }
    selectFlushFromVerts(bm, true)
    return {ok: true}
}

