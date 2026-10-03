/**
 * Select Linked: L picks the connected piece under the cursor, Ctrl+L grows every selected element
 * to its connected piece. Both can stop at seams, sharp edges, material changes or flipped normals.
 *
 * Port of `edbm_select_linked_pick_ex` (`editors/mesh/editmesh_select.cc:4275`),
 * `edbm_select_linked_exec` (`:4035`) and the delimit helpers `select_linked_delimit_test` /
 * `_begin` / `_end` (`:3913`, `:3994`, `:4021`). Blender's `BMO_ELE_TAG` on walkable edges becomes
 * the walker's `maskEdge` predicate.
 *
 * With no delimiter the walk is `BMW_VERT_SHELL` (every edge reachable through edges); with one it
 * is `BMW_LOOP_SHELL_WIRE`, which walks face corners and wire edges and so respects the edge mask.
 * In face mode the walk is `BMW_ISLAND` over faces, masked likewise.
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMLoop,
    BMVert,
    edgeSelectSet,
    ElemFlag,
    faceSelectSet,
    radialLoops,
    SelectMode,
    selectModeFlush,
    vertSelectSet,
    walkIslandIter,
    walkLoopShellWireIter,
    walkVertShellEdgesIter,
    WalkOptions,
} from '@threepipe/mesh-kernel'
import {edgeIsAnyFaceFlagTest} from './selectMode'

/** `BMO_DELIM_*` (`bmesh_operator_api.hh:545`). UV delimiting needs corner UV layers; not ported. */
export interface LinkedDelimit {
    /** Stop at edges whose two faces wind in opposite directions (`BMO_DELIM_NORMAL`). */
    normal?: boolean
    /** Stop at material changes (`BMO_DELIM_MATERIAL`). */
    material?: boolean
    /** Stop at UV seams (`BMO_DELIM_SEAM`). */
    seam?: boolean
    /** Stop at sharp edges (`BMO_DELIM_SHARP`). */
    sharp?: boolean
}

export function linkedDelimitIsSet(delimit: LinkedDelimit | undefined): delimit is LinkedDelimit {
    return !!delimit && !!(delimit.normal || delimit.material || delimit.seam || delimit.sharp)
}

/**
 * The default delimiter when none is given, as `select_linked_delimit_default_from_op` starts out:
 * none in vertex and edge mode, seams in face mode.
 */
export function linkedDelimitDefault(bm: BMesh): LinkedDelimit {
    return bm.selectMode & (SelectMode.Vertex | SelectMode.Edge) ? {} : {seam: true}
}

/** `BM_edge_is_contiguous` (`bmesh_query_inline.hh:96`): two faces, winding the same way. */
function edgeIsContiguous(e: BMEdge): boolean {
    const l = e.l
    if (!l) return false
    const lOther = l.radialNext!
    return lOther !== l && lOther.radialNext === l && lOther.v !== l.v
}

/** `select_linked_delimit_test` (`:3913`): true when the walk must not cross this edge. */
export function selectLinkedDelimitTest(e: BMEdge, delimit: LinkedDelimit): boolean {
    if (delimit.seam && e.hflag & ElemFlag.Seam) return true
    if (delimit.sharp && !(e.hflag & ElemFlag.Smooth)) return true
    if (delimit.normal && !edgeIsContiguous(e)) return true
    if (delimit.material && e.l && e.l.radialNext !== e.l) {
        const matNr = e.l.f.matNr
        for (const l of radialLoops(e)) if (l.f.matNr !== matNr) return true
    }
    return false
}

/** `select_linked_delimit_begin`: the edge mask, true where the walk is OK. */
function delimitMask(delimit: LinkedDelimit): (e: BMEdge) => boolean {
    return e => !selectLinkedDelimitTest(e, delimit)
}

/**
 * `edbm_select_linked_pick_ex` (`:4275`): select (or deselect) everything connected to one
 * element.
 */
export function selectLinkedPick(bm: BMesh, ele: BMVert | BMEdge | BMFace, select: boolean, delimit?: LinkedDelimit): void {
    const useDelimit = linkedDelimitIsSet(delimit)
    const opts: WalkOptions = {testHidden: true, maskEdge: useDelimit ? delimitMask(delimit) : undefined}

    if (ele instanceof BMVert || ele instanceof BMEdge) {
        if (useDelimit) {
            for (const step of walkLoopShellWireIter(ele, opts)) {
                if (step instanceof BMLoop) {
                    if (ele instanceof BMVert) vertSelectSet(bm, step.v, select)
                    else if (step.e) edgeSelectSet(bm, step.e, select)
                } else {
                    edgeSelectSet(bm, step, select)
                }
            }
        } else {
            for (const e of walkVertShellEdgesIter(ele, opts)) edgeSelectSet(bm, e, select)
        }
        selectModeFlush(bm)
    } else {
        for (const f of walkIslandIter(ele, false, opts)) faceSelectSet(bm, f, select)
    }
}

/**
 * `edbm_select_linked_exec` (`:4035`): grow every selected element to its connected piece, for the
 * mode's domain.
 */
export function selectLinkedAll(bm: BMesh, delimit?: LinkedDelimit): void {
    const useDelimit = linkedDelimitIsSet(delimit)
    const walkOk = useDelimit ? delimitMask(delimit) : null
    const opts: WalkOptions = {testHidden: true, maskEdge: walkOk ?? undefined}
    const mode = bm.selectMode

    if (mode & SelectMode.Vertex) {
        const tagged = new Set<BMVert>()
        for (const v of bm.verts) if (v.hflag & ElemFlag.Select) tagged.add(v)

        // Exclude all delimited verts, unless the edge has a selected face: that supports stepping
        // off isolated vertices which would otherwise be ignored.
        if (walkOk) {
            for (const e of bm.edges) {
                if (!walkOk(e) && edgeIsAnyFaceFlagTest(e, ElemFlag.Select)) {
                    tagged.delete(e.v1)
                    tagged.delete(e.v2)
                }
            }
        }

        for (const v of bm.verts) {
            if (!tagged.has(v)) continue
            if (walkOk) {
                for (const step of walkLoopShellWireIter(v, opts)) {
                    if (step instanceof BMLoop) {
                        vertSelectSet(bm, step.v, true)
                        tagged.delete(step.v)
                    } else {
                        edgeSelectSet(bm, step, true)
                        tagged.delete(step.v1)
                        tagged.delete(step.v2)
                    }
                }
            } else {
                for (const e of walkVertShellEdgesIter(v, opts)) {
                    edgeSelectSet(bm, e, true)
                }
            }
        }
        selectModeFlush(bm)
    } else if (mode & SelectMode.Edge) {
        const tagged = new Set<BMEdge>()
        for (const e of bm.edges) {
            if (!(e.hflag & ElemFlag.Select)) continue
            // With delimiters, an edge that may not be walked still seeds the walk when it has no
            // selected face, so isolated edges are not ignored.
            if (walkOk && !(walkOk(e) || !edgeIsAnyFaceFlagTest(e, ElemFlag.Select))) continue
            tagged.add(e)
        }

        for (const e of bm.edges) {
            if (!tagged.has(e)) continue
            if (walkOk) {
                for (const step of walkLoopShellWireIter(e, opts)) {
                    if (step instanceof BMLoop) {
                        if (step.e) edgeSelectSet(bm, step.e, true)
                        if (step.prev.e) edgeSelectSet(bm, step.prev.e, true)
                        if (step.e) tagged.delete(step.e)
                    } else {
                        edgeSelectSet(bm, step, true)
                        tagged.delete(step)
                    }
                }
            } else {
                for (const eWalk of walkVertShellEdgesIter(e, opts)) {
                    edgeSelectSet(bm, eWalk, true)
                    tagged.delete(eWalk)
                }
            }
        }
        selectModeFlush(bm)
    } else {
        const tagged = new Set<BMFace>()
        for (const f of bm.faces) if (f.hflag & ElemFlag.Select) tagged.add(f)
        for (const f of bm.faces) {
            if (!tagged.has(f)) continue
            for (const fWalk of walkIslandIter(f, false, opts)) {
                faceSelectSet(bm, fWalk, true)
                tagged.delete(fWalk)
            }
        }
    }
}
