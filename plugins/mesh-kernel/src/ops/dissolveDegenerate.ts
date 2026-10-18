/**
 * Degenerate Dissolve: `bmo_dissolve_degenerate_exec` (`source/blender/bmesh/operators/bmo_dissolve.cc:833`)
 * and the edit-mode operator over it (`edbm_dissolve_degenerate_exec`,
 * `editors/mesh/editmesh_tools.cc:6455`).
 *
 * Operator flags (`EDGE_MARK`, `EDGE_COLLAPSE`) are sets; `BM_ELEM_TAG` on loops ("checked later") is
 * a set too - new loops are created untagged (`bm_loop_create` zeroes `head.hflag`), which is what an
 * empty set gives them.
 */

import {BMEdge, BMLoop} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeSplit, faceSplit} from '../bmesh/mods'
import {selectFlushFromVerts} from '../bmesh/marking'
import {ElemFlag} from '../constants'
import {lenV3V3, normalizeV3Len} from '../math/geom'
import type {Vec3} from '../math'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {collapseEdges} from './collapse'

/** `BM_edge_calc_length_squared`, float32. */
function edgeCalcLengthSquared(e: BMEdge): number {
    const dx = Math.fround(e.v1.x - e.v2.x), dy = Math.fround(e.v1.y - e.v2.y), dz = Math.fround(e.v1.z - e.v2.z)
    return Math.fround(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)) + Math.fround(dz * dz))
}

/**
 * `bm_mesh_edge_collapse_flagged` (`:827`): `collapse edges=%fe uvs=true`, edges in mesh order; a
 * `BMO_op_callf` from inside the running operator, so nested (no edit end).
 */
function edgeCollapseFlagged(bm: BMesh, flagged: Set<BMEdge>): void {
    const edges = [...bm.edges].filter(e => flagged.has(e))
    bmoOpExec(bm, null, () => collapseEdges(bm, edges, true))
}

/**
 * `bmo_dissolve_degenerate_exec` (`:833`): collapse `edges` shorter than `dist`, then clip the
 * degenerate "ears" of the faces along them (corners whose two sides fold onto each other within
 * `dist`) by splitting and collapsing.
 */
export function dissolveDegenerate(bm: BMesh, edges: readonly BMEdge[], dist: number): void {
    const distSq = Math.fround(dist * dist)
    const edgeMark = new Set(edges) // EDGE_MARK
    const edgeCollapse = new Set<BMEdge>() // EDGE_COLLAPSE
    const loopTag = new Set<BMLoop>() // BM_ELEM_TAG on loops

    // collapse zero length edges, this accounts for zero area faces too
    let found = false
    for (const e of bm.edges) {
        if (edgeMark.has(e) && edgeCalcLengthSquared(e) < distSq) {
            edgeCollapse.add(e)
            found = true
        }
        // (clear all loop tags: the set starts empty)
    }
    if (found) edgeCollapseFlagged(bm, edgeCollapse)

    // clip degenerate ears from the face
    found = false
    // Edges made below are not `EDGE_MARK` (their tool flags start cleared), so the live set and a
    // snapshot of it walk the same marked edges.
    for (const e of [...bm.edges]) {
        if (!bm.edges.has(e) || !e.l || !edgeMark.has(e)) continue
        let lIter = e.l
        let lFirst = e.l
        do {
            // check the loop hasn't already been tested (and flag not to test again)
            if (loopTag.has(lIter)) continue
            loopTag.add(lIter)
            // check we're marked to tested (radial edge already tested)
            if (!edgeMark.has(lIter.prev.e!)) continue
            // check edges are not already going to be collapsed
            if (edgeCollapse.has(lIter.e!) || edgeCollapse.has(lIter.prev.e!)) continue

            // test if the faces loop (ear) is degenerate
            const dirPrev: Vec3 = [
                Math.fround(lIter.prev.v.x - lIter.v.x), Math.fround(lIter.prev.v.y - lIter.v.y), Math.fround(lIter.prev.v.z - lIter.v.z),
            ]
            const dirNext: Vec3 = [
                Math.fround(lIter.next.v.x - lIter.v.x), Math.fround(lIter.next.v.y - lIter.v.y), Math.fround(lIter.next.v.z - lIter.v.z),
            ]
            const lenPrev = normalizeV3Len(dirPrev)
            const lenNext = normalizeV3Len(dirNext)

            if (lenV3V3(dirPrev, dirNext) * Math.min(lenPrev, lenNext) <= dist) {
                let reset = false
                if (Math.abs(lenPrev - lenNext) <= dist) {
                    // both edges the same length
                    if (lIter.f.len === 3) {
                        // ideally this would have been discovered with short edge test above
                        edgeCollapse.add(lIter.next.e!)
                        found = true
                    } else {
                        // add a joining edge and tag for removal
                        const r = faceSplit(bm, lIter.f, lIter.prev, lIter.next, undefined, true)
                        if (r) {
                            edgeCollapse.add(r.eNew)
                            found = true
                            reset = true
                        }
                    }
                } else if (lenPrev < lenNext) {
                    // split 'l_iter->e', then join the vert with next
                    edgeSplit(bm, lIter.e!, lIter.v, lenPrev / lenNext)
                    const r = faceSplit(bm, lIter.f, lIter.prev, lIter.next, undefined, true)
                    if (r) {
                        edgeCollapse.add(r.eNew)
                        found = true
                    }
                    reset = true
                } else if (lenNext < lenPrev) {
                    // split 'l_iter->prev->e', then join the vert with next
                    edgeSplit(bm, lIter.prev.e!, lIter.v, lenNext / lenPrev)
                    const r = faceSplit(bm, lIter.f, lIter.prev, lIter.next, undefined, true)
                    if (r) {
                        edgeCollapse.add(r.eNew)
                        found = true
                    }
                    reset = true
                }
                // we can't easily track where we are on the radial edge, reset!
                if (reset) lFirst = lIter
            }
        } while ((lIter = lIter.radialNext!) !== lFirst)
    }
    if (found) edgeCollapseFlagged(bm, edgeCollapse)
}

/** `bmo_dissolve_degenerate_def` `type_flag`: UNTAN_MULTIRES | NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE. */
const DISSOLVE_DEGENERATE_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

export type DissolveDegenerateSelectionResult = {ok: true, changed: boolean, removed: [number, number, number]}

/**
 * `MESH_OT_dissolve_degenerate` (`:6455`): dissolve zero-area faces and zero-length edges among the
 * selected edges (`threshold`, Blender's "Merge Distance", default 1e-4). `removed` is what Blender
 * reports ("Removed: %d vertices, %d edges, %d faces"); with nothing found (`changed` false) Blender
 * still finishes, reporting "No degenerate geometry found".
 */
export function dissolveDegenerateSelection(bm: BMesh, threshold = 1e-4): DissolveDegenerateSelectionResult {
    const totvertOrig = bm.totvert, totedgeOrig = bm.totedge, totfaceOrig = bm.totface
    const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden))
    bmoOpExec(bm, DISSOLVE_DEGENERATE_TYPE_FLAG, () => dissolveDegenerate(bm, edges, Math.fround(threshold)))
    if (totvertOrig === bm.totvert && totedgeOrig === bm.totedge && totfaceOrig === bm.totface) {
        return {ok: true, changed: false, removed: [0, 0, 0]}
    }
    // tricky to maintain correct selection here, so just flush up from verts
    selectFlushFromVerts(bm, true)
    return {ok: true, changed: true, removed: [totvertOrig - bm.totvert, totedgeOrig - bm.totedge, totfaceOrig - bm.totface]}
}
