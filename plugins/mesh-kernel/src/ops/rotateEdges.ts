/**
 * Rotate edges: `bmo_rotate_edges_exec` (`source/blender/bmesh/operators/bmo_rotate_edges.cc:232`) with
 * `bm_rotate_edges_simple` (`:29`) and `bm_rotate_edges_shared` (`:86`), and the edit-mode operator
 * over it (`edbm_edge_rotate_selected_exec`, `editors/mesh/editmesh_tools.cc:2408`). The rotation
 * itself is `BM_edge_rotate` (`edgeRotate` in `beautify.ts`).
 *
 * `BM_elem_index_set` on edges (the shared pass keys its heap table by it) becomes a map, so the
 * mesh's own indices are left alone; Blender marks them dirty instead.
 */

import {BMEdge, BMFace} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeIsManifold} from '../bmesh/structure'
import {elemHflagEnableTest, elemsHflagDisable, elemsHflagEnable} from '../bmesh/hflag'
import {selectModeFlush} from '../bmesh/marking'
import {ElemFlag, ElemType} from '../constants'
import {Heap, HeapNode} from '../math/heap'
import {BM_EDGEROT_CHECK_DEGENERATE, BM_EDGEROT_CHECK_EXISTS, edgeRotate, edgeRotateCheck, FLT_MAX} from './beautify'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {edgeFacePair} from './dissolve'

/** `BM_edge_calc_length_squared`, in float32 as Blender computes it. */
function edgeCalcLengthSquared(e: BMEdge): number {
    const dx = Math.fround(e.v1.x - e.v2.x), dy = Math.fround(e.v1.y - e.v2.y), dz = Math.fround(e.v1.z - e.v2.z)
    return Math.fround(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)) + Math.fround(dz * dz))
}

/** `bm_edge_calc_rotate_cost` (`:56`): longest first. */
function edgeCalcRotateCost(e: BMEdge): number {
    return -edgeCalcLengthSquared(e)
}

/** `bm_rotate_edges_simple` (`:29`): every edge has its own faces, so any order will do. */
function rotateEdgesSimple(bm: BMesh, edges: readonly BMEdge[], checkFlag: number, useCcw: boolean, out: Set<BMEdge>): void {
    for (const e of edges) {
        if (edgeRotateCheck(e)) {
            const eRotate = edgeRotate(bm, e, useCcw, checkFlag)
            if (eRotate) out.add(eRotate)
        }
    }
}

/**
 * `bm_edge_rotate_is_boundary` (`:65`): are fewer than two of the faces' other edges rotating too?
 * `index` is the edge's input index, -1 when it is not (or no longer) an input.
 */
function edgeRotateIsBoundary(e: BMEdge, index: (e: BMEdge) => number): boolean {
    let count = 0
    let lRadialIter = e.l!
    do {
        // Skip this edge.
        let lIter = lRadialIter.next
        do {
            if (index(lIter.e!) !== -1) {
                if (count === 1) return false
                count += 1
                break
            }
        } while ((lIter = lIter.next) !== lRadialIter)
    } while ((lRadialIter = lRadialIter.radialNext!) !== e.l)
    return true
}

/**
 * `bm_rotate_edges_shared` (`:86`): edges sharing faces; an edge that could not rotate is retried
 * after its neighbours have. Boundary edges of the region go first, longest first.
 */
function rotateEdgesShared(bm: BMesh, edges: readonly BMEdge[], checkFlag: number, useCcw: boolean, out: Set<BMEdge>): void {
    const edgesLen = edges.length
    const heap = new Heap<BMEdge>()
    const eheapTable: (HeapNode<BMEdge> | null)[] = new Array(edgesLen).fill(null)
    // `edge_free_id` in the table: "Never read edges with this value in the `eheap_table` since they have been freed."
    const freed = new Array<boolean>(edgesLen).fill(false)
    let edgesLenRotate = 0

    // `BM_elem_index_set(e, -1)` for every edge, then the input index for the manifold inputs.
    const idx = new Map<BMEdge, number>()
    const index = (e: BMEdge) => idx.get(e) ?? -1
    for (let i = 0; i < edgesLen; i++) idx.set(edges[i], edgeIsManifold(edges[i]) ? i : -1)

    const PASS_TYPE_BOUNDARY = 0, PASS_TYPE_DONE = 2
    let passType = PASS_TYPE_BOUNDARY
    while (passType !== PASS_TYPE_DONE && edgesLenRotate !== edgesLen) {
        for (let i = 0; i < edgesLen; i++) {
            if (freed[i]) continue // `e` is freed.
            const e = edges[i]
            let ok = index(e) !== -1 && edgeRotateCheck(e)
            if (ok && passType === PASS_TYPE_BOUNDARY) ok = edgeRotateIsBoundary(e, index)
            if (ok) {
                let cost = edgeCalcRotateCost(e)
                if (passType === PASS_TYPE_BOUNDARY) {
                    // "Trick to ensure once started, non boundaries are handled before other boundary
                    // edges." Move from negative to positive value, inverting so large values are
                    // still handled first.
                    cost = cost !== 0 ? Math.fround(-1 / cost) : FLT_MAX
                }
                eheapTable[i] = heap.insert(cost, e)
            }
        }

        if (heap.isEmpty()) {
            passType += 1
            continue
        }

        const edgesLenRotatePrev = edgesLenRotate
        while (!heap.isEmpty()) {
            const eBest = heap.popMin()!
            const eBestIndex = index(eBest)
            eheapTable[eBestIndex] = null

            // No problem if this fails, re-evaluate if faces connected to this edge are touched.
            if (edgeRotateCheck(eBest)) {
                const eRotate = edgeRotate(bm, eBest, useCcw, checkFlag)
                if (eRotate) {
                    out.add(eRotate)
                    // invalidate so we don't try touch this again.
                    idx.set(eRotate, -1)
                    // If rotate succeeds, the edge has been freed.
                    freed[eBestIndex] = true
                    edgesLenRotate += 1

                    // "We don't know the exact topology after rotating the edge, so loop over all
                    // faces attached to the new edge, typically this will only be two faces."
                    let lRadialIter = eRotate.l!
                    do {
                        // Skip this edge.
                        let lIter = lRadialIter.next
                        do {
                            const eIter = lIter.e!
                            const eIterIndex = index(eIter)
                            if (eIterIndex !== -1 && !freed[eIterIndex] && eheapTable[eIterIndex] === null) {
                                if (edgeRotateCheck(eIter)) {
                                    // Previously degenerate, now valid.
                                    eheapTable[eIterIndex] = heap.insert(edgeCalcRotateCost(eIter), eIter)
                                }
                            }
                        } while ((lIter = lIter.next) !== lRadialIter)
                    } while ((lRadialIter = lRadialIter.radialNext!) !== eRotate.l)
                }
            }
        }

        // If no actions were taken, move onto the next pass.
        if (edgesLenRotate === edgesLenRotatePrev) {
            passType += 1
            continue
        }
    }
}

/**
 * `bmo_rotate_edges_exec` (`:232`): rotate `edges` (each between two faces) to join the faces' other
 * corners, clockwise or with `useCcw` counter-clockwise. Returns `edges.out`, the rotated edges.
 */
export function rotateEdges(bm: BMesh, edges: readonly BMEdge[], useCcw: boolean): BMEdge[] {
    const edgesLen = edges.length
    const isSingle = edgesLen === 1
    const checkFlag = isSingle ? BM_EDGEROT_CHECK_EXISTS : BM_EDGEROT_CHECK_EXISTS | BM_EDGEROT_CHECK_DEGENERATE

    let isSimple = true
    if (!isSingle) {
        const faceMark = new Set<BMFace>() // FACE_MARK
        for (const e of edges) {
            const pair = edgeFacePair(e)
            if (pair) {
                for (const f of pair) {
                    if (faceMark.has(f)) {
                        isSimple = false
                        break
                    }
                    faceMark.add(f)
                }
                if (!isSimple) break
            }
        }
    }

    const out = new Set<BMEdge>() // EDGE_OUT
    if (isSimple) rotateEdgesSimple(bm, edges, checkFlag, useCcw, out)
    else rotateEdgesShared(bm, edges, checkFlag, useCcw, out)
    return [...bm.edges].filter(e => out.has(e))
}

/** `bmo_rotate_edges_def` `type_flag`: NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE. */
const ROTATE_EDGES_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

export type EdgeRotateSelectionResult = {ok: true, failed: number} | {ok: false, error: string}

/**
 * `MESH_OT_edge_rotate` (`edbm_edge_rotate_selected_exec`, `editmesh_tools.cc:2408`): rotate the
 * selected edges, or the edges between two selected faces. `failed` counts the edges that could not
 * rotate (Blender's warning "Unable to rotate %d edge(s)").
 */
export function edgeRotateSelection(bm: BMesh, useCcw = false): EdgeRotateSelectionResult {
    if (bm.totedgesel === 0) return {ok: false, error: 'Select edges or face pairs for edge loops to rotate about'}

    // first see if we have two adjacent faces
    let tot = 0
    for (const e of bm.edges) {
        e.hflag &= ~ElemFlag.Tag
        if (e.hflag & ElemFlag.Select) {
            const pair = edgeFacePair(e)
            // if both faces are selected we rotate between them, otherwise - rotate between 2
            // unselected - but not mixed
            if (pair && ((pair[0].hflag & ElemFlag.Select) !== 0) === ((pair[1].hflag & ElemFlag.Select) !== 0)) {
                e.hflag |= ElemFlag.Tag
                tot++
            }
        }
    }
    // "OK, we don't have two adjacent faces, but we do have two selected ones. that's an error condition."
    if (tot === 0) return {ok: false, error: 'Could not find any selected edges that can be rotated'}

    // `rotate_edges edges=%he` with `BM_ELEM_TAG`, hidden excluded.
    const edges = [...bm.edges].filter(e => (e.hflag & ElemFlag.Tag) && !(e.hflag & ElemFlag.Hidden))
    // "avoids leaving old verts selected which can be a problem running multiple times, since this
    // means the edges become selected around the face which then attempt to rotate"
    elemsHflagDisable(bm, edges, ElemType.Edge, ElemFlag.Select, true)

    const out = bmoOpExec(bm, ROTATE_EDGES_TYPE_FLAG, () => rotateEdges(bm, edges, useCcw))
    // "edges may rotate into hidden vertices, if this does _not_ run we get an illogical state"
    elemsHflagDisable(bm, out, ElemType.Edge, ElemFlag.Hidden, true)
    elemsHflagEnable(bm, out, ElemType.Edge, ElemFlag.Select, true)

    const failed = tot - out.length
    if (failed !== 0) {
        // "If some edges fail to rotate, we need to re-select them, otherwise we can end up with
        // invalid selection (unselected edge between 2 selected faces)."
        elemHflagEnableTest(bm, ElemType.Edge, ElemFlag.Select, true, false, ElemFlag.Tag)
    }
    selectModeFlush(bm) // EDBM_selectmode_flush
    return {ok: true, failed}
}
