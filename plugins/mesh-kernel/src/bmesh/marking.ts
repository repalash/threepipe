/**
 * Selection: flags, propagation and flushing.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_marking.cc`. Selection in BMesh is not a set held
 * off to the side; it is a flag on each element, with rules that keep the three domains consistent.
 * Those rules are what make "select a face, switch to vertex mode, and its corners are selected" work.
 *
 * Two directions, and they are not symmetric:
 * - **Propagation**, on every individual set. Selecting an edge selects both its vertices.
 *   Deselecting one only deselects a vertex if no other selected edge still uses it, and only when
 *   vertex mode is off. {@link edgeSelectSet}, {@link faceSelectSet}.
 * - **Flushing**, done once after a batch. Upward: an edge becomes selected exactly when both its
 *   vertices are, and a face exactly when all its edges are. Downward runs only on a mode change.
 *   {@link selectFlush}, {@link selectFlushMode}.
 *
 * Hidden elements are never selectable, and every entry point checks that first.
 */

import {BMEdge, BMElemAny, BMFace, BMVert} from './types'
import {BMesh} from './BMesh'
import {diskEdges, radialLoops} from './structure'
import {ElemFlag, SelectMode, SelectModeMask} from '../constants'

/** Is some edge other than `eSkip`, using `v`, selected? Blender's `bm_vert_is_edge_select_any_other`. */
function vertHasOtherSelectedEdge(v: BMVert, eSkip: BMEdge): boolean {
    for (const e of diskEdges(v)) {
        if (e !== eSkip && (e.hflag & ElemFlag.Select)) return true
    }
    return false
}

/** Is some face other than `fSkip`, using `e`, selected? Blender's `bm_edge_is_face_select_any_other`. */
function edgeHasOtherSelectedFace(e: BMEdge, fSkip: BMFace): boolean {
    for (const l of radialLoops(e)) {
        if (l.f !== fSkip && (l.f.hflag & ElemFlag.Select)) return true
    }
    return false
}

/** Select or deselect a vertex. Port of `BM_vert_select_set`. */
export function vertSelectSet(bm: BMesh, v: BMVert, select: boolean): void {
    if (v.hflag & ElemFlag.Hidden) return
    if (select) {
        if (!(v.hflag & ElemFlag.Select)) {
            v.hflag |= ElemFlag.Select
            bm.totvertsel++
        }
    } else if (v.hflag & ElemFlag.Select) {
        v.hflag &= ~ElemFlag.Select
        bm.totvertsel--
    }
}

/**
 * Select or deselect an edge, propagating to its vertices.
 *
 * Port of `BM_edge_select_set`. Deselecting is the subtle half: outside vertex mode a vertex survives
 * if another selected edge still uses it, so dragging a selection off one edge does not punch holes in
 * a neighbouring one.
 */
export function edgeSelectSet(bm: BMesh, e: BMEdge, select: boolean): void {
    if (e.hflag & ElemFlag.Hidden) return

    if (select) {
        if (!(e.hflag & ElemFlag.Select)) {
            e.hflag |= ElemFlag.Select
            bm.totedgesel++
        }
        vertSelectSet(bm, e.v1, true)
        vertSelectSet(bm, e.v2, true)
        return
    }

    if (e.hflag & ElemFlag.Select) {
        e.hflag &= ~ElemFlag.Select
        bm.totedgesel--
    }

    if ((bm.selectMode & SelectMode.Vertex) === 0) {
        for (const v of [e.v1, e.v2]) {
            if (!vertHasOtherSelectedEdge(v, e)) vertSelectSet(bm, v, false)
        }
    } else {
        vertSelectSet(bm, e.v1, false)
        vertSelectSet(bm, e.v2, false)
    }
}

/**
 * Select or deselect a face, propagating to its edges and vertices.
 *
 * Port of `BM_face_select_set`. As with edges, deselecting keeps an edge alive when another selected
 * face still uses it.
 */
export function faceSelectSet(bm: BMesh, f: BMFace, select: boolean): void {
    if (f.hflag & ElemFlag.Hidden) return

    if (select) {
        if (!(f.hflag & ElemFlag.Select)) {
            f.hflag |= ElemFlag.Select
            bm.totfacesel++
        }
        for (const l of f.eachLoop()) {
            vertSelectSet(bm, l.v, true)
            if (l.e) edgeSelectSet(bm, l.e, true)
        }
        return
    }

    if (f.hflag & ElemFlag.Select) {
        f.hflag &= ~ElemFlag.Select
        bm.totfacesel--
    }

    for (const l of f.eachLoop()) {
        if (!l.e) continue
        if (!edgeHasOtherSelectedFace(l.e, f)) {
            edgeSelectSet(bm, l.e, false)
        }
    }
}

/** Dispatch on element type. Port of `BM_elem_select_set`. */
export function elemSelectSet(bm: BMesh, elem: BMElemAny, select: boolean): void {
    if (elem instanceof BMVert) vertSelectSet(bm, elem, select)
    else if (elem instanceof BMEdge) edgeSelectSet(bm, elem, select)
    else if (elem instanceof BMFace) faceSelectSet(bm, elem, select)
    // Loops carry no selection of their own; they follow their vertex and face.
}

/** Set the flag without touching neighbours or counters' consistency rules. Use inside flush only. */
function rawSelectSet(elem: BMVert | BMEdge | BMFace, select: boolean): boolean {
    const was = (elem.hflag & ElemFlag.Select) !== 0
    if (select) elem.hflag |= ElemFlag.Select
    else elem.hflag &= ~ElemFlag.Select
    return was !== select
}

/**
 * Flush selection upward: an edge becomes selected exactly when both its vertices are, and a face
 * exactly when all its edges are.
 *
 * Port of the upward half of `BM_mesh_select_mode_flush_ex`. Call once after a batch of vertex-level
 * changes rather than per element.
 */
export function selectFlush(bm: BMesh): void {
    for (const e of bm.edges) {
        const ok = !(e.hflag & ElemFlag.Hidden)
            && (e.v1.hflag & ElemFlag.Select) !== 0
            && (e.v2.hflag & ElemFlag.Select) !== 0
        if (rawSelectSet(e, ok)) bm.totedgesel += ok ? 1 : -1
    }
    for (const f of bm.faces) {
        let ok = !(f.hflag & ElemFlag.Hidden)
        if (ok) {
            for (const l of f.eachLoop()) {
                if (!l.e || !(l.e.hflag & ElemFlag.Select)) {
                    ok = false
                    break
                }
            }
        }
        if (rawSelectSet(f, ok)) bm.totfacesel += ok ? 1 : -1
    }
}

/**
 * Flush downward from the mode's domain, then upward.
 *
 * Port of `BM_mesh_select_mode_flush_ex` with `BMSelectFlushFlag::Down`. In edge mode every selected
 * edge selects its vertices; in face mode every selected face selects its edges and vertices. Used on
 * a mode change, where the authoritative domain has just changed.
 */
export function selectFlushMode(bm: BMesh): void {
    if (bm.selectMode & SelectMode.Face) {
        for (const v of bm.verts) if (rawSelectSet(v, false)) bm.totvertsel--
        for (const e of bm.edges) if (rawSelectSet(e, false)) bm.totedgesel--
        for (const f of bm.faces) {
            if (!(f.hflag & ElemFlag.Select)) continue
            for (const l of f.eachLoop()) {
                if (rawSelectSet(l.v, true)) bm.totvertsel++
                if (l.e && rawSelectSet(l.e, true)) bm.totedgesel++
            }
        }
    } else if (bm.selectMode & SelectMode.Edge) {
        for (const v of bm.verts) if (rawSelectSet(v, false)) bm.totvertsel--
        for (const e of bm.edges) {
            if (!(e.hflag & ElemFlag.Select)) continue
            if (rawSelectSet(e.v1, true)) bm.totvertsel++
            if (rawSelectSet(e.v2, true)) bm.totvertsel++
        }
    }
    selectFlush(bm)
    selectHistoryValidate(bm)
}

/**
 * Change the select mode, converting the existing selection to it.
 *
 * Port of `EDBM_selectmode_set` (`editors/mesh/editmesh_select.cc:2985`). History entries whose type
 * the new mode cannot represent are dropped, as Blender's `edbm_strip_selections` does.
 */
export function selectModeSet(bm: BMesh, mode: SelectModeMask): void {
    if (mode === 0) throw new Error('mesh-kernel: select mode must include at least one domain')
    bm.selectMode = mode
    bm.selectHistory = bm.selectHistory.filter(h => {
        if (h.elem instanceof BMVert) return (mode & SelectMode.Vertex) !== 0
        if (h.elem instanceof BMEdge) return (mode & SelectMode.Edge) !== 0
        return (mode & SelectMode.Face) !== 0
    })
    selectFlushMode(bm)
}

/** Select every visible element. Port of the `SELECT` branch of `MESH_OT_select_all`. */
export function selectAll(bm: BMesh): void {
    for (const v of bm.verts) if (!(v.hflag & ElemFlag.Hidden)) vertSelectSet(bm, v, true)
    selectFlush(bm)
}

/** Deselect everything, including the history. */
export function selectNone(bm: BMesh): void {
    for (const v of bm.verts) if (rawSelectSet(v, false)) bm.totvertsel--
    for (const e of bm.edges) if (rawSelectSet(e, false)) bm.totedgesel--
    for (const f of bm.faces) if (rawSelectSet(f, false)) bm.totfacesel--
    bm.selectHistory = []
}

/**
 * Invert the selection within the mode's authoritative domain, then flush.
 * Hidden elements stay deselected.
 */
export function selectInvert(bm: BMesh): void {
    if (bm.selectMode & SelectMode.Face) {
        const wanted = [...bm.faces].filter(f => !(f.hflag & ElemFlag.Hidden) && !(f.hflag & ElemFlag.Select))
        selectNone(bm)
        for (const f of wanted) faceSelectSet(bm, f, true)
    } else if (bm.selectMode & SelectMode.Edge) {
        const wanted = [...bm.edges].filter(e => !(e.hflag & ElemFlag.Hidden) && !(e.hflag & ElemFlag.Select))
        selectNone(bm)
        for (const e of wanted) edgeSelectSet(bm, e, true)
    } else {
        const wanted = [...bm.verts].filter(v => !(v.hflag & ElemFlag.Hidden) && !(v.hflag & ElemFlag.Select))
        selectNone(bm)
        for (const v of wanted) vertSelectSet(bm, v, true)
    }
    selectFlush(bm)
}

/** Recount the selection counters from scratch. For tests and after bulk flag edits. */
export function selectCountsRecalc(bm: BMesh): void {
    let v = 0, e = 0, f = 0
    for (const x of bm.verts) if (x.hflag & ElemFlag.Select) v++
    for (const x of bm.edges) if (x.hflag & ElemFlag.Select) e++
    for (const x of bm.faces) if (x.hflag & ElemFlag.Select) f++
    bm.totvertsel = v
    bm.totedgesel = e
    bm.totfacesel = f
}

// region selection history

/** Append to the history, making the element active. Port of `BM_select_history_store`. */
export function selectHistoryStore(bm: BMesh, elem: BMVert | BMEdge | BMFace): void {
    selectHistoryRemove(bm, elem)
    bm.selectHistory.push({elem})
}

export function selectHistoryRemove(bm: BMesh, elem: BMVert | BMEdge | BMFace): void {
    const i = bm.selectHistory.findIndex(h => h.elem === elem)
    if (i >= 0) bm.selectHistory.splice(i, 1)
}

/** Drop history entries that are no longer selected. Port of `BM_select_history_validate`. */
export function selectHistoryValidate(bm: BMesh): void {
    bm.selectHistory = bm.selectHistory.filter(h => (h.elem.hflag & ElemFlag.Select) !== 0)
}

/** The active element: the last history entry. Port of `BM_select_history_active_get`. */
export function selectHistoryActive(bm: BMesh): BMVert | BMEdge | BMFace | null {
    return bm.selectHistory.length ? bm.selectHistory[bm.selectHistory.length - 1].elem : null
}

// endregion

// region hiding

/** Hide a vertex and everything using it. Port of `BM_vert_hide_set`. */
export function vertHideSet(bm: BMesh, v: BMVert, hide: boolean): void {
    if (hide) {
        vertSelectSet(bm, v, false)
        v.hflag |= ElemFlag.Hidden
        for (const e of diskEdges(v)) edgeHideSet(bm, e, true)
    } else {
        v.hflag &= ~ElemFlag.Hidden
    }
}

export function edgeHideSet(bm: BMesh, e: BMEdge, hide: boolean): void {
    if (hide) {
        edgeSelectSet(bm, e, false)
        e.hflag |= ElemFlag.Hidden
        for (const l of radialLoops(e)) faceHideSet(bm, l.f, true)
    } else {
        e.hflag &= ~ElemFlag.Hidden
    }
}

export function faceHideSet(bm: BMesh, f: BMFace, hide: boolean): void {
    if (hide) {
        faceSelectSet(bm, f, false)
        f.hflag |= ElemFlag.Hidden
    } else {
        f.hflag &= ~ElemFlag.Hidden
    }
}

/** Unhide everything and, like Blender's reveal, select what was revealed. */
export function revealAll(bm: BMesh, select = true): void {
    for (const v of bm.verts) v.hflag &= ~ElemFlag.Hidden
    for (const e of bm.edges) e.hflag &= ~ElemFlag.Hidden
    for (const f of bm.faces) f.hflag &= ~ElemFlag.Hidden
    if (select) selectAll(bm)
}

// endregion

/** Every selected element of the mode's authoritative domain. */
export function selectedElements(bm: BMesh): (BMVert | BMEdge | BMFace)[] {
    if (bm.selectMode & SelectMode.Face) return [...bm.faces].filter(f => f.hflag & ElemFlag.Select)
    if (bm.selectMode & SelectMode.Edge) return [...bm.edges].filter(e => e.hflag & ElemFlag.Select)
    return [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
}
