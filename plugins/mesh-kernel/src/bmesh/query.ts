/**
 * Topology queries ported from `source/blender/bmesh/intern/bmesh_query.cc` that more than one
 * operator needs. (Older ports keep their own copies next to their first caller; new ones go here.)
 */

import {BMEdge, BMLoop, BMVert} from './types'
import {diskEdges, edgeIsBoundary, edgeIsManifold} from './structure'

/**
 * `BM_edge_other_loop` (`bmesh_query.cc:448`): the loop of the other face of manifold `e` at the same
 * vertex as `l`.
 */
export function edgeOtherLoop(e: BMEdge, l: BMLoop): BMLoop {
    let lOther = l.e === e ? l : l.prev
    lOther = lOther.radialNext!
    if (lOther.v === l.v) {
        // pass
    } else if (lOther.next.v === l.v) {
        lOther = lOther.next
    }
    return lOther
}

/**
 * `BM_vert_step_fan_loop` (`bmesh_query.cc:473`): step from `l` round its vertex across the edge that
 * is not `eStep[0]`, updating `eStep[0]`; null at a non-manifold edge.
 */
export function vertStepFanLoop(l: BMLoop, eStep: [BMEdge]): BMLoop | null {
    const ePrev = eStep[0]
    let eNext: BMEdge
    if (l.e === ePrev) eNext = l.prev.e!
    else if (l.prev.e === ePrev) eNext = l.e!
    else return null
    if (edgeIsManifold(eNext)) {
        eStep[0] = eNext
        return edgeOtherLoop(eNext, l)
    }
    return null
}

/**
 * `BM_vert_is_manifold` (`bmesh_query.cc:717`): every edge of `v` has one or two faces, at most two
 * are boundaries, and its faces form a single fan.
 */
export function vertIsManifold(v: BMVert): boolean {
    if (v.e === null) return false // loose vert
    let loopNum = 0
    let boundaryNum = 0
    // count edges while looking for non-manifold edges
    let lFirst: BMLoop | null = v.e.l // may be null
    for (const eIter of diskEdges(v)) {
        // loose edge or edge shared by more than two faces, edges with 1 face user are OK
        if (eIter.l === null || eIter.l !== eIter.l.radialNext!.radialNext) return false
        // count radial loops
        if (eIter.l.v === v) loopNum += 1
        if (!edgeIsBoundary(eIter)) {
            // non boundary check opposite loop
            if (eIter.l.radialNext!.v === v) loopNum += 1
        } else {
            // start at the boundary
            lFirst = eIter.l
            boundaryNum += 1
            // >2 boundaries can't be manifold
            if (boundaryNum === 3) return false
        }
    }
    const eFirst = lFirst!.e!
    lFirst = lFirst!.v === v ? lFirst! : lFirst!.next
    let loopNumRegion = 0
    let lIter: BMLoop | null = lFirst
    const ePrev: [BMEdge] = [eFirst]
    do {
        loopNumRegion += 1
    } while ((lIter = vertStepFanLoop(lIter!, ePrev)) !== lFirst && lIter !== null)
    return loopNum === loopNumRegion
}
