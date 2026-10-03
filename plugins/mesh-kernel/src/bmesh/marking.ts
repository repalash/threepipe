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

/**
 * Set an edge's flag without touching its vertices. Port of `BM_edge_select_set_noflush`
 * (`bmesh_marking.cc`), used by the downward face flush where the vertices are handled separately.
 */
export function edgeSelectSetNoflush(bm: BMesh, e: BMEdge, select: boolean): void {
    if (e.hflag & ElemFlag.Hidden) return
    if (select) {
        if (!(e.hflag & ElemFlag.Select)) {
            e.hflag |= ElemFlag.Select
            bm.totedgesel++
        }
    } else if (e.hflag & ElemFlag.Select) {
        e.hflag &= ~ElemFlag.Select
        bm.totedgesel--
    }
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

// region mode flush - `bm_mesh_select_mode_flush_*` (bmesh_marking.cc:330-500)

/** `bm_mesh_select_mode_flush_vert_to_edge`: an edge is selected exactly when both vertices are. */
function flushVertToEdge(bm: BMesh): void {
    for (const e of bm.edges) {
        const ok = !(e.hflag & ElemFlag.Hidden)
            && (e.v1.hflag & ElemFlag.Select) !== 0
            && (e.v2.hflag & ElemFlag.Select) !== 0
        if (rawSelectSet(e, ok)) bm.totedgesel += ok ? 1 : -1
    }
}

/** `bm_mesh_select_mode_flush_edge_to_face`: a face is selected exactly when all its edges are. */
function flushEdgeToFace(bm: BMesh): void {
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

/** `bm_mesh_select_mode_flush_edge_to_vert`: flush down from edges to vertices. */
function flushEdgeToVert(bm: BMesh): void {
    let anySelect = false
    for (const e of bm.edges) {
        if (e.hflag & ElemFlag.Hidden) continue
        if (e.hflag & ElemFlag.Select) {
            anySelect = true
        } else {
            vertSelectSet(bm, e.v1, false)
            vertSelectSet(bm, e.v2, false)
        }
    }
    if (anySelect) {
        for (const e of bm.edges) {
            if (e.hflag & ElemFlag.Hidden) continue
            if (e.hflag & ElemFlag.Select) {
                vertSelectSet(bm, e.v1, true)
                vertSelectSet(bm, e.v2, true)
            }
        }
    }
}

/** `bm_mesh_select_mode_flush_face_to_vert_and_edge`: flush down from faces to vertices and edges. */
function flushFaceToVertAndEdge(bm: BMesh): void {
    let anySelect = false
    for (const f of bm.faces) {
        if (f.hflag & ElemFlag.Hidden) continue
        if (f.hflag & ElemFlag.Select) {
            anySelect = true
        } else {
            for (const l of f.eachLoop()) {
                vertSelectSet(bm, l.v, false)
                if (l.e) edgeSelectSetNoflush(bm, l.e, false)
            }
        }
    }
    if (anySelect) {
        for (const f of bm.faces) {
            if (f.hflag & ElemFlag.Hidden) continue
            if (f.hflag & ElemFlag.Select) {
                for (const l of f.eachLoop()) {
                    vertSelectSet(bm, l.v, true)
                    if (l.e) edgeSelectSetNoflush(bm, l.e, true)
                }
            }
        }
    }
}

/**
 * Flush the selection upward according to the mode: in vertex mode vertices decide edges and edges
 * decide faces; in edge mode edges decide faces; in face mode nothing flushes.
 *
 * Port of `BM_mesh_select_mode_flush` (`bmesh_marking.cc:502`, `BMSelectFlushFlag_Default`), which is
 * what Blender's `EDBM_selectmode_flush` runs after every selection operator. Differs from
 * {@link selectFlush} in that it respects the mode: two opposite edges of a quad selected in edge mode
 * do not drag the other two along just because all four corners are selected.
 */
export function selectModeFlush(bm: BMesh): void {
    selectModeFlushEx(bm, bm.selectMode, false)
}

/**
 * Port of `BM_mesh_select_mode_flush_ex` (`bmesh_marking.cc:502`): an optional downward flush from the
 * mode's domain, then always the upward one.
 */
export function selectModeFlushEx(bm: BMesh, mode: SelectModeMask, flushDown: boolean): void {
    if (flushDown) {
        if (mode & SelectMode.Vertex) {
            // Pass.
        } else if (mode & SelectMode.Edge) {
            flushEdgeToVert(bm)
        } else if (mode & SelectMode.Face) {
            flushFaceToVertAndEdge(bm)
        }
    }
    // Always flush up.
    if (mode & SelectMode.Vertex) flushVertToEdge(bm)
    if (mode & (SelectMode.Vertex | SelectMode.Edge)) flushEdgeToFace(bm)
    // Remove any deselected elements from the history.
    selectHistoryValidate(bm)
}

/**
 * Flush downward from the mode's domain, then upward.
 *
 * `BM_mesh_select_mode_flush_ex` with `BMSelectFlushFlag::Down`. In edge mode every selected edge
 * selects its vertices; in face mode every selected face selects its edges and vertices.
 */
export function selectFlushMode(bm: BMesh): void {
    selectModeFlushEx(bm, bm.selectMode, true)
}

/**
 * Select edges and faces whose vertices are all selected (`select`), or deselect edges and faces that
 * have a deselected vertex (`!select`). Only ever changes flags in that one direction.
 *
 * Port of `BM_mesh_select_flush_from_verts` (`bmesh_marking.cc:550`).
 */
export function selectFlushFromVerts(bm: BMesh, select: boolean): void {
    if (select) {
        for (const e of bm.edges) {
            if ((e.v1.hflag & ElemFlag.Select) && (e.v2.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden)) {
                if (rawSelectSet(e, true)) bm.totedgesel++
            }
        }
        for (const f of bm.faces) {
            let ok = !(f.hflag & ElemFlag.Hidden)
            if (ok) {
                for (const l of f.eachLoop()) {
                    if (!(l.v.hflag & ElemFlag.Select)) {
                        ok = false
                        break
                    }
                }
            }
            if (ok && rawSelectSet(f, true)) bm.totfacesel++
        }
    } else {
        for (const e of bm.edges) {
            if (e.hflag & ElemFlag.Hidden) continue
            if (!(e.hflag & ElemFlag.Select)) continue
            if (!(e.v1.hflag & ElemFlag.Select) || !(e.v2.hflag & ElemFlag.Select)) {
                if (rawSelectSet(e, false)) bm.totedgesel--
            }
        }
        for (const f of bm.faces) {
            if (f.hflag & ElemFlag.Hidden) continue
            if (!(f.hflag & ElemFlag.Select)) continue
            for (const l of f.eachLoop()) {
                if (!(l.v.hflag & ElemFlag.Select)) {
                    if (rawSelectSet(f, false)) bm.totfacesel--
                    break
                }
            }
        }
    }
}

/**
 * Remove isolated elements the mode cannot represent, after a "select less" has contracted the
 * selection: in edge mode re-derive the vertices from the edges, in face mode re-derive the edges and
 * vertices from the faces.
 *
 * Port of `BM_mesh_select_mode_clean_ex` (`bmesh_marking.cc:256`).
 */
export function selectModeClean(bm: BMesh): void {
    const mode = bm.selectMode
    if (mode & SelectMode.Vertex) {
        // Pass.
    } else if (mode & SelectMode.Edge) {
        if (bm.totvertsel) {
            for (const v of bm.verts) v.hflag &= ~ElemFlag.Select
            bm.totvertsel = 0
        }
        if (bm.totedgesel) {
            for (const e of bm.edges) {
                if (e.hflag & ElemFlag.Select) {
                    vertSelectSet(bm, e.v1, true)
                    vertSelectSet(bm, e.v2, true)
                }
            }
        }
    } else if (mode & SelectMode.Face) {
        if (bm.totvertsel) {
            for (const v of bm.verts) v.hflag &= ~ElemFlag.Select
            bm.totvertsel = 0
        }
        if (bm.totedgesel) {
            for (const e of bm.edges) e.hflag &= ~ElemFlag.Select
            bm.totedgesel = 0
        }
        if (bm.totfacesel) {
            for (const f of bm.faces) {
                if (f.hflag & ElemFlag.Select) {
                    for (const l of f.eachLoop()) if (l.e) edgeSelectSet(bm, l.e, true)
                }
            }
        }
    }
}

// endregion

/**
 * Change the select mode, converting the existing selection to it.
 *
 * Port of `EDBM_selectmode_set` (`editors/mesh/editmesh_select.cc:2985`). History entries whose type
 * the new mode cannot represent are dropped, as Blender's `edbm_strip_selections` does. Then:
 * - vertex mode: edges and faces whose vertices are all selected become selected;
 * - edge mode: vertices are re-derived from the selected edges, faces from the edges;
 * - face mode: edges (and so vertices) are re-derived from the selected faces only.
 *
 * Converting *between* single modes with Blender's "expand" rules is `selectModeConvert` in the
 * mesh-edit plugin; this is the plain switch.
 */
export function selectModeSet(bm: BMesh, mode: SelectModeMask): void {
    if (mode === 0) throw new Error('mesh-kernel: select mode must include at least one domain')
    bm.selectMode = mode
    // Strip stored selection that is not relevant to the new mode.
    bm.selectHistory = bm.selectHistory.filter(h => {
        if (h.elem instanceof BMVert) return (mode & SelectMode.Vertex) !== 0
        if (h.elem instanceof BMEdge) return (mode & SelectMode.Edge) !== 0
        return (mode & SelectMode.Face) !== 0
    })

    if (bm.totvertsel === 0 && bm.totedgesel === 0 && bm.totfacesel === 0) return

    if (mode & SelectMode.Vertex) {
        if (bm.totvertsel) selectFlushFromVerts(bm, true)
    } else if (mode & SelectMode.Edge) {
        // Deselect vertices, and select again based on edge select.
        for (const v of bm.verts) vertSelectSet(bm, v, false)
        if (bm.totedgesel) {
            for (const e of bm.edges) if (e.hflag & ElemFlag.Select) edgeSelectSet(bm, e, true)
            // Selects faces based on edge status.
            selectModeFlush(bm)
        }
    } else if (mode & SelectMode.Face) {
        // Deselect edges, and select again based on face select.
        for (const e of bm.edges) edgeSelectSet(bm, e, false)
        if (bm.totfacesel) {
            for (const f of bm.faces) if (f.hflag & ElemFlag.Select) faceSelectSet(bm, f, true)
        }
    }
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

/*
 * Ports of `BM_vert_hide_set`, `BM_edge_hide_set` and `BM_face_hide_set` (`bmesh_marking.cc:1506`),
 * wrapped the way `_bm_elem_hide_set` wraps them: an element is deselected before it is hidden.
 *
 * Blender only deselects the element itself and lets the following `EDBM_selectmode_flush` deselect
 * the edges and faces it dragged into hiding. Here every element that becomes hidden is deselected
 * on the spot, through the propagating setters, so a hidden element is never selected even between
 * the hide and the flush; the end state after the flush is the same.
 */

function setHidden(bm: BMesh, elem: BMVert | BMEdge | BMFace, hide: boolean): void {
    if (hide) {
        if (elem instanceof BMVert) vertSelectSet(bm, elem, false)
        else if (elem instanceof BMEdge) edgeSelectSet(bm, elem, false)
        else faceSelectSet(bm, elem, false)
        elem.hflag |= ElemFlag.Hidden
    } else {
        elem.hflag &= ~ElemFlag.Hidden
    }
}

/** `bm_vert_is_edge_visible_any`. */
function vertIsEdgeVisibleAny(v: BMVert): boolean {
    for (const e of diskEdges(v)) if (!(e.hflag & ElemFlag.Hidden)) return true
    return false
}

/** `bm_edge_is_face_visible_any`. */
function edgeIsFaceVisibleAny(e: BMEdge): boolean {
    for (const l of radialLoops(e)) if (!(l.f.hflag & ElemFlag.Hidden)) return true
    return false
}

/** `vert_flush_hide_set`: hide the vertex unless one of its edges is still visible. */
function vertFlushHideSet(bm: BMesh, v: BMVert): void {
    setHidden(bm, v, !vertIsEdgeVisibleAny(v))
}

/** `edge_flush_hide_set`: hide the edge unless one of its faces is still visible. */
function edgeFlushHideSet(bm: BMesh, e: BMEdge): void {
    setHidden(bm, e, !edgeIsFaceVisibleAny(e))
}

/** Hide (or show) a vertex, its edges and their faces. Port of `BM_vert_hide_set`. */
export function vertHideSet(bm: BMesh, v: BMVert, hide: boolean): void {
    setHidden(bm, v, hide)
    for (const e of diskEdges(v)) {
        setHidden(bm, e, hide)
        for (const l of radialLoops(e)) setHidden(bm, l.f, hide)
    }
}

/**
 * Hide (or show) an edge and the faces around it. Hiding also hides either vertex that has no visible
 * edge left; showing shows both. Port of `BM_edge_hide_set`.
 */
export function edgeHideSet(bm: BMesh, e: BMEdge, hide: boolean): void {
    for (const l of radialLoops(e)) setHidden(bm, l.f, hide)
    setHidden(bm, e, hide)
    if (hide) {
        vertFlushHideSet(bm, e.v1)
        vertFlushHideSet(bm, e.v2)
    } else {
        setHidden(bm, e.v1, false)
        setHidden(bm, e.v2, false)
    }
}

/**
 * Hide (or show) a face. Hiding also hides its edges that have no visible face left and its vertices
 * that have no visible edge left; showing shows its edges and vertices. Port of `BM_face_hide_set`.
 */
export function faceHideSet(bm: BMesh, f: BMFace, hide: boolean): void {
    setHidden(bm, f, hide)
    if (hide) {
        for (const l of f.eachLoop()) if (l.e) edgeFlushHideSet(bm, l.e)
        for (const l of f.eachLoop()) vertFlushHideSet(bm, l.v)
    } else {
        for (const l of f.eachLoop()) {
            if (l.e) setHidden(bm, l.e, false)
            setHidden(bm, l.v, false)
        }
    }
}

/** Dispatch on element type. Port of `BM_elem_hide_set`. */
export function elemHideSet(bm: BMesh, elem: BMVert | BMEdge | BMFace, hide: boolean): void {
    if (elem instanceof BMVert) vertHideSet(bm, elem, hide)
    else if (elem instanceof BMEdge) edgeHideSet(bm, elem, hide)
    else faceHideSet(bm, elem, hide)
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
