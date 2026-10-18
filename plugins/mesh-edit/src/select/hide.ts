/**
 * Hide and reveal: H hides the selection, Shift+H everything else, Alt+H brings it all back.
 *
 * Port of `EDBM_mesh_hide` (`editors/mesh/editmesh_utils.cc:1545`) and `EDBM_mesh_reveal` (`:1618`).
 * Hiding works on the mode's lowest domain and flushes up through the kernel's `*HideSet` (an edge
 * cannot stay visible without its vertices, a face without its edges); revealing selects what was
 * hidden, in the domains the mode shows, so the user can see what came back.
 */

import {
    BMesh,
    BMEdge,
    BMFace,
    BMVert,
    edgeIsWire,
    ElemFlag,
    elemHideSet,
    elemSelectSet,
    SelectMode,
    selectModeFlush,
} from '@threepipe/mesh-kernel'

type Elem = BMVert | BMEdge | BMFace

/**
 * Hide the selected elements, or with `swap` the unselected ones. Returns whether anything changed.
 */
export function meshHide(bm: BMesh, swap: boolean): boolean {
    const mode = bm.selectMode
    const domain: Iterable<Elem> = mode & SelectMode.Vertex ? bm.verts : mode & SelectMode.Edge ? bm.edges : bm.faces
    const isFaces = !(mode & (SelectMode.Vertex | SelectMode.Edge))
    const isEdgesOrFaces = !(mode & SelectMode.Vertex)
    let changed = false

    // Collect first: hiding mutates the flags the test reads.
    const targets: Elem[] = []
    for (const ele of domain) {
        if (ele.hflag & ElemFlag.Hidden) continue
        const selected = (ele.hflag & ElemFlag.Select) !== 0
        if (selected !== swap) targets.push(ele)
    }
    for (const ele of targets) {
        if (ele.hflag & ElemFlag.Hidden) continue
        elemHideSet(bm, ele, true)
        changed = true
    }

    // Hiding unselected.
    if (swap) {
        // In face select mode, also hide loose edges that are not part of any visible face.
        if (isFaces) {
            for (const e of bm.edges) {
                if (!edgeIsWire(e)) continue
                if (!(e.hflag & ElemFlag.Hidden) && !(e.hflag & ElemFlag.Select)) {
                    elemHideSet(bm, e, true)
                    changed = true
                }
            }
        }
        // In edge or face select mode, also hide isolated verts that are not connected to an edge.
        if (isEdgesOrFaces) {
            for (const v of bm.verts) {
                if (v.e) continue
                if (!(v.hflag & ElemFlag.Hidden) && !(v.hflag & ElemFlag.Select)) {
                    elemHideSet(bm, v, true)
                    changed = true
                }
            }
        }
    }

    if (changed) selectModeFlush(bm)
    return changed
}

/**
 * Reveal every hidden element, selecting (`select`) or deselecting the revealed ones in the mode's
 * domains. Returns whether anything was hidden.
 */
export function meshReveal(bm: BMesh, select: boolean): boolean {
    const mode = bm.selectMode
    const domains: Iterable<Elem>[] = [bm.verts, bm.edges, bm.faces]
    const sels = [
        (mode & SelectMode.Vertex) !== 0,
        (mode & SelectMode.Edge) !== 0,
        (mode & SelectMode.Face) !== 0,
    ]

    // Remember what was hidden before all is revealed (Blender tags it).
    const wasHidden: Set<Elem>[] = [new Set(), new Set(), new Set()]
    let changed = false
    for (let i = 0; i < 3; i++) {
        for (const ele of domains[i]) {
            if (ele.hflag & ElemFlag.Hidden) {
                wasHidden[i].add(ele)
                changed = true
            }
        }
    }
    if (!changed) return false

    // Reveal everything.
    for (const domain of domains) for (const ele of domain) ele.hflag &= ~ElemFlag.Hidden

    // Select relevant just-revealed elements.
    for (let i = 0; i < 3; i++) {
        if (!sels[i]) continue
        for (const ele of wasHidden[i]) elemSelectSet(bm, ele, select)
    }
    return true
}
