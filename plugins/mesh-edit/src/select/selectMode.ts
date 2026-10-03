/**
 * Switching select mode: what happens to the selection when the user presses 1, 2 or 3, with Shift
 * to combine modes and Ctrl to expand the selection on the way.
 *
 * Port of `EDBM_selectmode_convert` (`editors/mesh/editmesh_select.cc:3048`) and
 * `EDBM_selectmode_toggle_multi` (`:3159`), for one object. The plain mode switch itself,
 * `EDBM_selectmode_set`, is the kernel's `selectModeSet`.
 *
 * The rules, from the manual's "Select Mode" page and this code: going up (vertex to edge to face)
 * keeps only elements that are fully selected, going down selects every constituent, and Ctrl while
 * going up also takes any element that touches the selection.
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMVert,
    diskEdges,
    edgeSelectSet,
    ElemFlag,
    faceSelectSet,
    radialLoops,
    selectFlushFromVerts,
    SelectMode,
    SelectModeMask,
    selectModeSet,
    vertSelectSet,
} from '@threepipe/mesh-kernel'

// region queries - `bmesh_query.cc:1930-2030`

/** `BM_vert_is_all_edge_flag_test`. */
export function vertIsAllEdgeFlagTest(v: BMVert, hflag: number, respectHide: boolean): boolean {
    if (v.e) {
        for (const e of diskEdges(v)) {
            if (!respectHide || !(e.hflag & ElemFlag.Hidden)) {
                if (!(e.hflag & hflag)) return false
            }
        }
    }
    return true
}

/** `BM_vert_is_all_face_flag_test`. */
export function vertIsAllFaceFlagTest(v: BMVert, hflag: number, respectHide: boolean): boolean {
    if (v.e) {
        for (const e of diskEdges(v)) {
            for (const l of radialLoops(e)) {
                if (l.v !== v) continue
                if (!respectHide || !(l.f.hflag & ElemFlag.Hidden)) {
                    if (!(l.f.hflag & hflag)) return false
                }
            }
        }
    }
    return true
}

/** `BM_edge_is_all_face_flag_test`. */
export function edgeIsAllFaceFlagTest(e: BMEdge, hflag: number, respectHide: boolean): boolean {
    if (e.l) {
        for (const l of radialLoops(e)) {
            if (!respectHide || !(l.f.hflag & ElemFlag.Hidden)) {
                if (!(l.f.hflag & hflag)) return false
            }
        }
    }
    return true
}

/** `BM_edge_is_any_vert_flag_test`. */
export function edgeIsAnyVertFlagTest(e: BMEdge, hflag: number): boolean {
    return (e.v1.hflag & hflag) !== 0 || (e.v2.hflag & hflag) !== 0
}

/** `BM_edge_is_any_face_flag_test`. */
export function edgeIsAnyFaceFlagTest(e: BMEdge, hflag: number): boolean {
    for (const l of radialLoops(e)) if (l.f.hflag & hflag) return true
    return false
}

/** `BM_face_is_any_vert_flag_test`. */
export function faceIsAnyVertFlagTest(f: BMFace, hflag: number): boolean {
    for (const l of f.eachLoop()) if (l.v.hflag & hflag) return true
    return false
}

/** `BM_face_is_any_edge_flag_test`. */
export function faceIsAnyEdgeFlagTest(f: BMFace, hflag: number): boolean {
    for (const l of f.eachLoop()) if (l.e && l.e.hflag & hflag) return true
    return false
}

// endregion

/**
 * Convert the selection from one single mode to another, "expanding" on the way up.
 *
 * Port of `EDBM_selectmode_convert` (`editmesh_select.cc:3048`). Only the two modes passed in are
 * used, not the mesh's current mode, because this runs while the mode is being changed. First
 * tag-to-select, then select, to avoid a feedback loop.
 */
export function selectModeConvert(bm: BMesh, modeOld: SelectModeMask, modeNew: SelectModeMask): void {
    if (modeOld === SelectMode.Vertex) {
        if (bm.totvertsel === 0) {
            // Pass.
        } else if (modeNew === SelectMode.Edge) {
            // Flush up (vert -> edge): select all edges associated with every selected vert.
            const tagged: BMEdge[] = []
            for (const e of bm.edges) if (edgeIsAnyVertFlagTest(e, ElemFlag.Select)) tagged.push(e)
            for (const e of tagged) edgeSelectSet(bm, e, true)
        } else if (modeNew === SelectMode.Face) {
            // Flush up (vert -> face): select all faces associated with every selected vert.
            const tagged: BMFace[] = []
            for (const f of bm.faces) if (faceIsAnyVertFlagTest(f, ElemFlag.Select)) tagged.push(f)
            for (const f of tagged) faceSelectSet(bm, f, true)
        }
    } else if (modeOld === SelectMode.Edge) {
        if (bm.totedgesel === 0) {
            // Pass.
        } else if (modeNew === SelectMode.Face) {
            // Flush up (edge -> face): select all faces associated with every selected edge.
            const tagged: BMFace[] = []
            for (const f of bm.faces) if (faceIsAnyEdgeFlagTest(f, ElemFlag.Select)) tagged.push(f)
            for (const f of tagged) faceSelectSet(bm, f, true)
        } else if (modeNew === SelectMode.Vertex) {
            // Flush down (edge -> vert).
            for (const v of bm.verts) {
                if (!vertIsAllEdgeFlagTest(v, ElemFlag.Select, true)) vertSelectSet(bm, v, false)
            }
            // Deselect edges without both verts selected.
            selectFlushFromVerts(bm, false)
        }
    } else if (modeOld === SelectMode.Face) {
        if (bm.totfacesel === 0) {
            // Pass.
        } else if (modeNew === SelectMode.Edge) {
            // Flush down (face -> edge).
            for (const e of bm.edges) {
                if (!edgeIsAllFaceFlagTest(e, ElemFlag.Select, true)) edgeSelectSet(bm, e, false)
            }
            // Deselect faces without edges selected.
            selectFlushFromVerts(bm, false)
        } else if (modeNew === SelectMode.Vertex) {
            // Flush down (face -> vert).
            for (const v of bm.verts) {
                if (!vertIsAllFaceFlagTest(v, ElemFlag.Select, true)) vertSelectSet(bm, v, false)
            }
            // Deselect faces without verts selected.
            selectFlushFromVerts(bm, false)
        }
    }
}

/** `highest_order_bit_s`. */
function highestOrderBit(n: number): number {
    let bit = 0
    while (n) {
        bit = n & -n
        n &= ~bit
    }
    return bit
}

/**
 * The select-mode buttons and the 1/2/3 keys.
 *
 * Port of `EDBM_selectmode_toggle_multi` (`editmesh_select.cc:3159`) for a single object:
 * - `action`: -1 leaves the mode set as computed, 0 disables `toggle`, 1 enables it, 2 toggles it.
 *   The keys use 2 with `useExtend` (Shift) and plain 1 without.
 * - `useExtend` (Shift): combine with the current modes rather than replace them. A mode that is
 *   the only one set cannot be removed.
 * - `useExpand` (Ctrl): convert the selection with {@link selectModeConvert} from the highest
 *   current mode first, so going up keeps touched elements.
 *
 * Returns whether the mode changed.
 */
export function selectModeToggleMulti(
    bm: BMesh,
    toggle: SelectModeMask,
    action: -1 | 0 | 1 | 2,
    useExtend: boolean,
    useExpand: boolean,
): boolean {
    if (toggle !== SelectMode.Vertex && toggle !== SelectMode.Edge && toggle !== SelectMode.Face) {
        throw new Error('selectModeToggleMulti: toggle must be a single mode')
    }
    const modeOld = bm.selectMode
    let modeNew: SelectModeMask = modeOld
    let onlyUpdate = false

    switch (action) {
    case -1:
        // Already set.
        break
    case 0:
        // Disable. Check we have something to do, and never disable the only flag set.
        if ((modeOld & toggle) === 0 || modeOld === toggle) {
            onlyUpdate = true
            break
        }
        modeNew &= ~toggle
        break
    case 1:
        // Enable.
        if ((modeOld & toggle) !== 0) {
            onlyUpdate = true
            break
        }
        modeNew |= toggle
        break
    case 2:
        // Toggle. Never disable the only flag set.
        if (modeOld === toggle) {
            onlyUpdate = true
            break
        }
        modeNew ^= toggle
        break
    }

    if (onlyUpdate) return false

    if (!useExtend || modeNew === 0) {
        if (useExpand) {
            const modeMax = highestOrderBit(modeOld)
            selectModeConvert(bm, modeMax, toggle)
        }
    }

    if (!useExtend || modeNew === 0) modeNew = toggle

    selectModeSet(bm, modeNew)
    return true
}
