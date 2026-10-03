/**
 * Bulk header-flag setters: what Blender's edit-mode operators use to stash the selection in a tag,
 * restore it, clear it, and select an operator's output.
 *
 * Ported from `bmesh/intern/bmesh_marking.cc` (`BM_mesh_elem_hflag_disable_test` :1359,
 * `BM_mesh_elem_hflag_enable_test` :1428, `BM_mesh_elem_hflag_disable_all` / `_enable_all`,
 * `BM_select_history_clear` :1210), `bmesh/intern/bmesh_operators.cc`
 * (`BMO_slot_buffer_hflag_enable` :1059, `BMO_slot_buffer_hflag_disable` :1093, taking the slot's
 * elements as an array) and `editors/mesh/editmesh_utils.cc` (`EDBM_flag_disable_all` :451,
 * `EDBM_flag_enable_all` :461). The UV-selection bookkeeping in the `EDBM_` functions is not ported:
 * the kernel has no UV select layer yet.
 */

import {BMEdge, BMFace, BMVert} from './types'
import {BMesh} from './BMesh'
import {ElemFlag, ElemType, ElemTypeMask} from '../constants'
import {elemHideSet, elemSelectSet} from './marking'

type Elem = BMVert | BMEdge | BMFace

function elemType(e: Elem): number {
    return e instanceof BMVert ? ElemType.Vert : e instanceof BMEdge ? ElemType.Edge : ElemType.Face
}

function* elemsOfTypes(bm: BMesh, htype: ElemTypeMask): Generator<Elem> {
    // `iter_types = {BM_VERTS_OF_MESH, BM_EDGES_OF_MESH, BM_FACES_OF_MESH}`: verts, then edges, then faces.
    if (htype & ElemType.Vert) yield* [...bm.verts]
    if (htype & ElemType.Edge) yield* [...bm.edges]
    if (htype & ElemType.Face) yield* [...bm.faces]
}

/** `BM_select_history_clear` (`bmesh_marking.cc:1210`). */
export function selectHistoryClear(bm: BMesh): void {
    bm.selectHistory = []
}

/**
 * `BM_mesh_elem_hflag_disable_test` (`bmesh_marking.cc:1359`): clear `hflag` on every element of
 * `htype` that has `hflagTest` (all of them when 0); with `overwrite`, set it on the rest. Clearing
 * `Select` deselects properly (`BM_elem_select_set`) and clears the select history.
 */
export function elemHflagDisableTest(
    bm: BMesh, htype: ElemTypeMask, hflag: number, respectHide: boolean, overwrite: boolean, hflagTest: number,
): void {
    const hflagNosel = hflag & ~ElemFlag.Select
    if (hflag & ElemFlag.Select) selectHistoryClear(bm)

    if (htype === (ElemType.Vert | ElemType.Edge | ElemType.Face) && hflag === ElemFlag.Select
        && !respectHide && hflagTest === 0) {
        // Fast path for deselect all, avoid topology loops since we know all will be de-selected anyway.
        for (const ele of elemsOfTypes(bm, htype)) ele.hflag &= ~ElemFlag.Select
        bm.totvertsel = bm.totedgesel = bm.totfacesel = 0
        return
    }
    for (const ele of elemsOfTypes(bm, htype)) {
        if (respectHide && ele.hflag & ElemFlag.Hidden) {
            // pass
        } else if (!hflagTest || ele.hflag & hflagTest) {
            if (hflag & ElemFlag.Select) elemSelectSet(bm, ele, false)
            ele.hflag &= ~hflag
        } else if (overwrite) {
            // no match!
            if (hflag & ElemFlag.Select) elemSelectSet(bm, ele, true)
            ele.hflag |= hflagNosel
        }
    }
}

/**
 * `BM_mesh_elem_hflag_enable_test` (`bmesh_marking.cc:1428`): set `hflag` on every element of
 * `htype` that has `hflagTest` (all of them when 0); with `overwrite`, clear it on the rest. Setting
 * `Select` selects properly (`BM_elem_select_set`), so a hidden element never becomes selected.
 */
export function elemHflagEnableTest(
    bm: BMesh, htype: ElemTypeMask, hflag: number, respectHide: boolean, overwrite: boolean, hflagTest: number,
): void {
    // Use the nosel version when setting so under no condition may a hidden face become selected.
    const hflagNosel = hflag & ~ElemFlag.Select
    for (const ele of elemsOfTypes(bm, htype)) {
        if (respectHide && ele.hflag & ElemFlag.Hidden) {
            // pass
        } else if (!hflagTest || ele.hflag & hflagTest) {
            // match!
            if (hflag & ElemFlag.Select) elemSelectSet(bm, ele, true)
            ele.hflag |= hflagNosel
        } else if (overwrite) {
            // no match!
            if (hflag & ElemFlag.Select) elemSelectSet(bm, ele, false)
            ele.hflag &= ~hflag
        }
    }
}

/** `BM_mesh_elem_hflag_disable_all`. */
export function elemHflagDisableAll(bm: BMesh, htype: ElemTypeMask, hflag: number, respectHide: boolean): void {
    elemHflagDisableTest(bm, htype, hflag, respectHide, false, 0)
}

/** `BM_mesh_elem_hflag_enable_all`. */
export function elemHflagEnableAll(bm: BMesh, htype: ElemTypeMask, hflag: number, respectHide: boolean): void {
    elemHflagEnableTest(bm, htype, hflag, respectHide, false, 0)
}

/** `EDBM_flag_disable_all` (`editmesh_utils.cc:451`). */
export function edbmFlagDisableAll(bm: BMesh, hflag: number): void {
    elemHflagDisableAll(bm, ElemType.Vert | ElemType.Edge | ElemType.Face, hflag, false)
}

/** `EDBM_flag_enable_all` (`editmesh_utils.cc:461`). */
export function edbmFlagEnableAll(bm: BMesh, hflag: number): void {
    elemHflagEnableAll(bm, ElemType.Vert | ElemType.Edge | ElemType.Face, hflag, true)
}

/**
 * `BMO_slot_buffer_hflag_enable` (`bmesh_operators.cc:1059`) over an operator's output elements:
 * set `hflag` on those of `htype`; with `doFlush`, `Select` goes through `BM_elem_select_set` and
 * `Hidden` through `BM_elem_hide_set(.., false)` - as Blender's source has it.
 */
export function elemsHflagEnable(bm: BMesh, elems: Iterable<Elem>, htype: ElemTypeMask, hflag: number, doFlush: boolean): void {
    const doFlushSelect = doFlush && (hflag & ElemFlag.Select) !== 0
    const doFlushHide = doFlush && (hflag & ElemFlag.Hidden) !== 0
    for (const ele of elems) {
        if (!(htype & elemType(ele))) continue
        if (doFlushSelect) elemSelectSet(bm, ele, true)
        if (doFlushHide) elemHideSet(bm, ele, false)
        ele.hflag |= hflag
    }
}

/** `BMO_slot_buffer_hflag_disable` (`bmesh_operators.cc:1093`). */
export function elemsHflagDisable(bm: BMesh, elems: Iterable<Elem>, htype: ElemTypeMask, hflag: number, doFlush: boolean): void {
    const doFlushSelect = doFlush && (hflag & ElemFlag.Select) !== 0
    const doFlushHide = doFlush && (hflag & ElemFlag.Hidden) !== 0
    for (const ele of elems) {
        if (!(htype & elemType(ele))) continue
        if (doFlushSelect) elemSelectSet(bm, ele, false)
        if (doFlushHide) elemHideSet(bm, ele, false)
        ele.hflag &= ~hflag
    }
}
