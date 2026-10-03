/**
 * Bridge Edge Loops: faces (or a weld) between pairs of edge loops.
 *
 * Ported from `source/blender/bmesh/operators/bmo_bridge.cc` (`bmo_bridge_loops_exec`,
 * `bridge_loop_pair` and its static helpers) and the edit-mode operator in
 * `editors/mesh/editmesh_tools.cc` (`edbm_bridge_tag_boundary_edges` :7363,
 * `edbm_bridge_edge_loops_for_single_editmesh` :7405, `edbm_bridge_edge_loops_exec` :7524,
 * `MESH_OT_bridge_edge_loops` :7572). "Number of Cuts" runs `subdivide_edgering` on the bridge's
 * `edges.out` (`:7489-7515`), see `subdivideEdgering.ts`.
 *
 * Bridging loops of different lengths runs two more bmesh operators nested: `triangulate`
 * (`triangulate.ts`) and `beautify_fill` (`beautify.ts`). Bridge only ever triangulates the quads it
 * made, so the unported n-gon branch of `BM_face_triangulate` is never reached.
 *
 * Flags: Blender's operator flags (`EDGE_MARK`, `EDGE_OUT`, `FACE_OUT`, `ELE_NEW`, `FACE_MARK`) are
 * per-operator `Set`s here. `BM_ELEM_TAG` is the shared header bit `ElemFlag.Tag`, as in Blender: the
 * nested `triangulate` and `beautify_fill` read the faces bridge tagged (`faces=%hf`), and beautify
 * reads the vertex tags bridge sets per side.
 *
 * Every operator runs through `bmoOpExec` (`subdivideEdgering.ts`), Blender's `BMO_op_exec`: the
 * `BMO_push` / `BMO_pop` re-indexing of every vertex, edge and face around it (which beautify's
 * rotation states read), and, for the outermost operator only, `bmesh_edit_end` (normals update and
 * select-mode flush per the operator's `type_flag`) - as `bmesh.ops.*` from Python gets too. The
 * nested operators (`weld_verts`, `triangulate`, `beautify_fill` inside bridge) get no
 * `bmesh_edit_end`, as nested `BMO_op_exec` calls do not (`toolflag_index != 1`).
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, edgeIsBoundary, edgeIsWire, radialLoops} from '../bmesh/structure'
import {faceAttrsCopy} from '../bmesh/customdata'
import {
    BMEdgeLoopStore, edgelinkNext, edgeloopCalcNormal, edgeloopCalcNormalAligned, edgeloopCopy, edgeloopExpand,
    edgeloopFlip, edgeloopsCalcCenter, edgeloopsCalcNormal, edgeloopsCalcOrder, edgeloopsFind,
} from '../bmesh/edgeloop'
import {faceExists, weldVerts} from './weld'
import {deleteFacesOflagContext} from './duplicate'
import {faceNormalUpdate} from '../bmesh/polygon'
import {dataInterpFromVerts} from '../bmesh/interp'
import {FLT_MAX, bmoBeautifyFillExec} from './beautify'
import {bmoTriangulateExec, faceCreateVerts, loopAttrsCopy} from './triangulate'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {edbmFlagDisableAll, elemHflagDisableAll, elemsHflagEnable} from '../bmesh/hflag'
import {normalsUpdate} from './bevel-bmquery'
import {ElemFlag, ElemType} from '../constants'
import {Vec3, v3cross, v3dot, v3sub} from '../math'
import {isZeroV3, lenV3V3, modI, normalizeV3Len} from '../math/geom'
import {
    SubdivideEdgeringOptions, SubdivProfileShape, SubdivRingInterp, bmoSubdivideEdgering,
} from './subdivideEdgering'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

// region helpers (bmesh_query / bmesh_core / bmesh_mods / blenlib, generic - exported for reuse)

/**
 * `BM_iter_at_index(bm, BM_LOOPS_OF_VERT, v, 0)`: the first loop the loops-of-vert iterator yields
 * (`bmiter__loop_of_vert_begin`, `bmesh_iterators.cc:459`), which is
 * `bmesh_disk_faceloop_find_first(v->e, v)` (`bmesh_structure.cc:302`), or null for a vertex no face
 * uses.
 */
export function vertFirstLoop(v: BMVert): BMLoop | null {
    if (!v.e) return null
    const eFirst = v.e
    let eIter: BMEdge = eFirst
    do {
        if (eIter.l !== null) return eIter.l.v === v ? eIter.l : eIter.l.next
        eIter = eIter.diskNext(v)!
    } while (eIter !== eFirst)
    return null
}

// endregion

// region bmo_bridge.cc

/** Per-operator flags of one `bridge_loops` call: `FACE_OUT` and `EDGE_OUT`. */
interface BridgeFlags {
    faceOut: Set<BMFace>
    edgeOut: Set<BMEdge>
}

/**
 * `bm_bridge_splice_loops` (`bmo_bridge.cc:33`): weld `a` onto `b` (same length), each target moved
 * to `merge_factor` of the way from its `a` vertex and its data interpolated likewise.
 */
function bridgeSpliceLoops(bm: BMesh, elA: readonly BMVert[], elB: readonly BMVert[], mergeFactor: number): void {
    const targetmap = new Map<BMVert, BMVert>()
    for (let i = 0; i < elA.length; i++) {
        const vA = elA[i], vB = elB[i]
        dataInterpFromVerts(bm, vA, vB, vB, mergeFactor)
        vB.setCo(
            vA.x + (vB.x - vA.x) * mergeFactor,
            vA.y + (vB.y - vA.y) * mergeFactor,
            vA.z + (vB.z - vA.z) * mergeFactor,
        )
        if (vA === vB) throw new Error('mesh-kernel: bridge merge of a vertex onto itself')
        targetmap.set(vA, vB)
    }
    // `BMO_op_exec(bm, &op_weld)`, nested
    bmoOpExec(bm, null, () => weldVerts(bm, targetmap))
}

/**
 * `bm_vert_loop_pair` (`bmo_bridge.cc:60`): the corners of the face using edge `v1-v2`, matched to
 * `v1` and `v2`; for a wire edge, any loop at each vertex.
 */
function vertLoopPair(v1: BMVert, v2: BMVert): [BMLoop | null, BMLoop | null] {
    const e = diskEdgeExists(v1, v2)!
    const l = e.l
    if (l) {
        if (l.v === v1) return [l, l.next]
        return [l.next, l]
    }
    // fallback to _any_ loop
    return [vertFirstLoop(v1), vertFirstLoop(v2)]
}

/**
 * `bm_edgeloop_offset_length` (`bmo_bridge.cc:83`): the summed distance between `a` from its start
 * and `b` from offset `ib` (wrapping), stopping early once past `lenMax`.
 */
function edgeloopOffsetLength(a: readonly BMVert[], b: readonly BMVert[], ib: number, lenMax: number): number {
    let len = 0
    let ia = 0
    do {
        len += lenV3V3(co(a[ia]), co(b[ib]))
        ib = ib + 1 < b.length ? ib + 1 : 0
    } while (++ia < a.length && len < lenMax)
    return len
}

/** `bm_bridge_best_rotation` (`bmo_bridge.cc:98`): rotate `b` so it lines up with `a` best. */
function bridgeBestRotation(storeA: BMEdgeLoopStore, storeB: BMEdgeLoopStore): void {
    const a = storeA.verts
    const b = storeB.verts
    let best = -1
    let lenBest = FLT_MAX
    for (let ib = 0; ib < b.length; ib++) {
        const len = edgeloopOffsetLength(a, b, ib, lenBest)
        if (len < lenBest) {
            best = ib
            lenBest = len
        }
    }
    if (best >= 0) storeB.verts = [...b.slice(best), ...b.slice(0, best)]
}

/** `bm_face_edges_tag_out` (`bmo_bridge.cc:122`). */
function faceEdgesTagOut(flags: BridgeFlags, f: BMFace): void {
    for (const l of f.eachLoop()) flags.edgeOut.add(l.e!)
}

/**
 * `bridge_loop_pair` (`bmo_bridge.cc:136`): orient two loops consistently (flip and winding votes),
 * line up closed loops (best rotation plus twist), then make a quad (or a triangle where the shorter
 * loop was expanded) per segment, or weld with `useMerge`. Loops of different lengths are
 * triangulated and beautified afterwards.
 */
function bridgeLoopPair(
    bm: BMesh, flags: BridgeFlags, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore,
    useMerge: boolean, mergeFactor: number, twistOffset: number,
): void {
    const eps = 0.00001
    const isClosed = elStoreA.closed && elStoreB.closed
    const useEdgeout = true

    let elStoreALen = elStoreA.len
    let elStoreBLen = elStoreB.len

    if (elStoreALen < elStoreBLen) {
        [elStoreALen, elStoreBLen] = [elStoreBLen, elStoreALen];
        [elStoreA, elStoreB] = [elStoreB, elStoreA]
    }

    if (elStoreALen !== elStoreBLen) {
        elemHflagDisableAll(bm, ElemType.Face | ElemType.Edge, ElemFlag.Tag, false)
    }

    const elDir = v3sub(elStoreA.co, elStoreB.co)

    if (isClosed) {
        // if all loops are closed this will calculate twice for all loops
        edgeloopCalcNormal(elStoreA)
        edgeloopCalcNormal(elStoreB)
    } else {
        const lbA = elStoreA.verts
        const lbB = elStoreB.verts

        // normalizing isn't strictly needed but without we may get very large values
        const dirAOrig = v3sub(co(lbA[0]), co(lbA[lbA.length - 1]))
        const dirBOrig = v3sub(co(lbB[0]), co(lbB[lbB.length - 1]))

        // make the directions point out from the normals, 'no' is used as a temp var
        let no = v3cross(dirAOrig, elDir)
        const dirA = v3cross(no, elDir)
        no = v3cross(dirBOrig, elDir)
        const dirB = v3cross(no, elDir)

        let testA: Vec3, testB: Vec3
        if (!isZeroV3(dirA) && !isZeroV3(dirB)) {
            testA = dirA
            testB = dirB
        } else {
            // This is a corner case: when loops are aligned to the direction between the loops
            // values of 'dir_a/b' is degenerate, in this case compare the original directions
            // (before they were corrected by 'el_dir'), see: #43013
            testA = dirAOrig
            testB = dirBOrig
        }

        if (v3dot(testA, testB) < 0) edgeloopFlip(elStoreB)

        no = [elDir[0], elDir[1], elDir[2]]
        normalizeV3Len(no)
        edgeloopCalcNormalAligned(elStoreA, no)
        edgeloopCalcNormalAligned(elStoreB, no)
    }

    const dotA = v3dot(elStoreA.no, elDir)
    const dotB = v3dot(elStoreB.no, elDir)

    if (v3dot(elDir, elDir) < eps || (Math.abs(dotA) < eps && Math.abs(dotB) < eps)) {
        // in this case there is no depth between the two loops, eg: 2x 2d circles, one scaled
        // smaller, in this case 'el_dir' can't be used, just ensure we have matching flipping.
        if (v3dot(elStoreA.no, elStoreB.no) < 0) edgeloopFlip(elStoreB)
    } else if ((dotA < 0) !== (dotB < 0)) {
        edgeloopFlip(elStoreB)
    }

    // we only care about flipping if we make faces
    if (useMerge === false) {
        const no: Vec3 = [elStoreA.no[0] + elStoreB.no[0], elStoreA.no[1] + elStoreB.no[1], elStoreA.no[2] + elStoreB.no[2]]
        if (v3dot(no, elDir) < 0) {
            edgeloopFlip(elStoreA)
            edgeloopFlip(elStoreB)
        }

        // vote on winding (so new face winding is based on existing connected faces)
        if (bm.totface) {
            const estorePair = [elStoreA, elStoreB]
            const windingVotes = [0, 0]
            let windingDir = 1
            for (let i = 0; i < 2; i++, windingDir = -windingDir) {
                const vs = estorePair[i].verts
                for (let k = 0; k < vs.length; k++) {
                    const kNext = edgelinkNext(estorePair[i], k)
                    if (kNext >= 0) {
                        const e = diskEdgeExists(vs[k], vs[kNext])
                        if (e && edgeIsBoundary(e)) {
                            windingVotes[i] += e.l!.v === vs[k] ? windingDir : -windingDir
                        }
                    }
                }
            }

            if (windingVotes[0] || windingVotes[1]) {
                const flip = [false, false]
                // for direction aligned loops we can't rely on the directly we have, use the winding
                // defined by the connected faces (see #48356).
                if (Math.abs(dotA) < eps) {
                    if (windingVotes[0] < 0) {
                        flip[0] = !flip[0]
                        windingVotes[0] *= -1
                    }
                }
                if (Math.abs(dotB) < eps) {
                    if (windingVotes[1] < 0) {
                        flip[1] = !flip[1]
                        windingVotes[1] *= -1
                    }
                }
                // when both loops contradict the winding, flip them so surrounding geometry matches
                if ((windingVotes[0] + windingVotes[1]) < 0) {
                    flip[0] = !flip[0]
                    flip[1] = !flip[1]
                }
                if (flip[0]) edgeloopFlip(elStoreA)
                if (flip[1]) edgeloopFlip(elStoreB)
            }
        }
    }

    if (elStoreALen > elStoreBLen) {
        elStoreB = edgeloopCopy(elStoreB)
        edgeloopExpand(bm, elStoreB, elStoreALen, false, null)
    }

    if (isClosed) {
        bridgeBestRotation(elStoreA, elStoreB)

        // add twist
        if (twistOffset !== 0) {
            const lenB = elStoreB.len
            // `BLI_rfindlink(lb_b, mod_i(twist_offset, len_b))`: counted from the end
            const elB = lenB - 1 - modI(twistOffset, lenB)
            const b = elStoreB.verts
            elStoreB.verts = [...b.slice(elB), ...b.slice(0, elB)]
        }
    }

    // Assign after flipping is finalized
    const a = elStoreA.verts
    const b = elStoreB.verts

    if (useMerge) {
        bridgeSpliceLoops(bm, a, b, mergeFactor)
    } else {
        let elA = 0
        let elB = 0
        while (true) {
            let elANext: number, elBNext: number
            if (isClosed) {
                elANext = edgelinkNext(elStoreA, elA)
                elBNext = edgelinkNext(elStoreB, elB)
            } else {
                elANext = elA + 1 < a.length ? elA + 1 : -1
                elBNext = elB + 1 < b.length ? elB + 1 : -1
                if (elANext < 0 || elBNext < 0) break
            }

            const vA = a[elA]
            const vB = b[elB]
            const vANext = a[elANext]
            const vBNext = b[elBNext]

            let lA: BMLoop | null = null
            let lB: BMLoop | null = null
            let lANext: BMLoop | null = null
            let lBNext: BMLoop | null = null

            // get loop data - before making the face
            if (vB !== vBNext) {
                [lA, lANext] = vertLoopPair(vA, vANext);
                [lB, lBNext] = vertLoopPair(vB, vBNext)
            } else {
                // lazy, could be more clever here
                [lA, lANext] = vertLoopPair(vA, vANext)
                lB = lBNext = vertFirstLoop(vB)
            }

            if (lA && lANext === null) lANext = lA
            if (lANext && lA === null) lA = lANext
            if (lB && lBNext === null) lBNext = lB
            if (lBNext && lB === null) lB = lBNext
            const fExample = lA ? lA.f : (lB ? lB.f : null)

            let f: BMFace | null
            if (vB !== vBNext) {
                // USE_DUPLICATE_FACE_VERT_CHECK: only check for duplicates between loops.
                if (vB === vANext || vB === vA || vBNext === vANext || vBNext === vA) {
                    f = null
                } else {
                    const vArr = [vB, vBNext, vANext, vA]
                    f = faceExists(vArr)
                    if (f === null) {
                        // copy if loop data if its is missing on one ring
                        f = faceCreateVerts(bm, vArr, null, true)!
                        let lIter = f.lFirst
                        if (lB) loopAttrsCopy(bm, lB, lIter)
                        lIter = lIter.next
                        if (lBNext) loopAttrsCopy(bm, lBNext, lIter)
                        lIter = lIter.next
                        if (lANext) loopAttrsCopy(bm, lANext, lIter)
                        lIter = lIter.next
                        if (lA) loopAttrsCopy(bm, lA, lIter)
                    }
                }
            } else {
                // USE_DUPLICATE_FACE_VERT_CHECK
                if (vB === vANext || vB === vA) {
                    f = null
                } else {
                    const vArr = [vB, vANext, vA]
                    f = faceExists(vArr)
                    if (f === null) {
                        // fan-fill a triangle
                        f = faceCreateVerts(bm, vArr, null, true)!
                        let lIter = f.lFirst
                        if (lB) loopAttrsCopy(bm, lB, lIter)
                        lIter = lIter.next
                        if (lANext) loopAttrsCopy(bm, lANext, lIter)
                        lIter = lIter.next
                        if (lA) loopAttrsCopy(bm, lA, lIter)
                    }
                }
            }

            if (f !== null) {
                if (fExample && fExample !== f) faceAttrsCopy(bm, fExample, f)
                flags.faceOut.add(f)
                f.hflag |= ElemFlag.Tag
                // tag all edges of the face, untag the loop edges after
                if (useEdgeout) faceEdgesTagOut(flags, f)
            }

            if (elANext === 0) break

            elA = elANext
            elB = elBNext
        }
    }

    if (elStoreALen !== elStoreBLen) {
        const estorePair = [elStoreA, elStoreB]
        // when we have to bridge between different sized edge-loops, be clever and post-process for
        // best results

        // triangulate inline
        // `BMO_op_initf(bm, &op_sub, 0, ...)`: flag 0, so hidden faces are not skipped
        const triFaces = [...bm.faces].filter(f => f.testFlag(ElemFlag.Tag))
        // calc normals for input faces before executing
        for (const f of triFaces) faceNormalUpdate(f)
        const tri = bmoOpExec(bm, null, () => bmoTriangulateExec(bm, triFaces, 'BEAUTY', 'BEAUTY'))
        for (const f of tri.faces) flags.faceOut.add(f)
        elemsHflagEnable(bm, tri.faces, ElemType.Face, ElemFlag.Tag, false)

        // tag verts on each side so we can restrict rotation of edges to verts on the same side
        for (let i = 0; i < 2; i++) {
            for (const v of estorePair[i].verts) v.setFlag(ElemFlag.Tag, i === 1)
        }

        // `beautify_fill faces=%hf edges=ae use_restrict_tag=%b method=%i`, BM_ELEM_TAG, true, 1
        const beautyFaces = [...bm.faces].filter(f => f.testFlag(ElemFlag.Tag))
        const beautyEdges = [...bm.edges]

        if (useEdgeout) {
            for (const f of beautyFaces) {
                flags.faceOut.add(f)
                faceEdgesTagOut(flags, f)
            }
        }

        const geomOut = bmoOpExec(bm, null, () => bmoBeautifyFillExec(bm, beautyFaces, beautyEdges, true, 1))
        // there may also be tagged faces that didn't rotate, mark input

        if (useEdgeout) {
            for (const f of geomOut.faces) {
                flags.faceOut.add(f)
                faceEdgesTagOut(flags, f)
            }
        } else {
            for (const f of geomOut.faces) flags.faceOut.add(f)
        }
    }

    if (useEdgeout && useMerge === false) {
        // we've enabled all face edges above, now disable all loop edges
        const estorePair = [elStoreA, elStoreB]
        for (let i = 0; i < 2; i++) {
            const vs = estorePair[i].verts
            for (let k = 0; k < vs.length; k++) {
                const kNext = edgelinkNext(estorePair[i], k)
                if (kNext >= 0) {
                    if (vs[k] !== vs[kNext]) {
                        const e = diskEdgeExists(vs[k], vs[kNext])
                        if (e) flags.edgeOut.delete(e)
                    }
                }
            }
        }
    }
}

/** RNA-level options of `bmesh.ops.bridge_loops` (`bmo_bridge_loops_def`, `bmesh_opdefines.cc:842`). */
export interface BridgeLoopsOptions {
    usePairs?: boolean
    useCyclic?: boolean
    /** Merge rather than creating faces. */
    useMerge?: boolean
    /** Merge factor. */
    mergeFactor?: number
    /** Twist offset for closed loops. */
    twistOffset?: number
}

/** `bridge_loops`'s outcome: `faces.out` / `edges.out`, or the `BMO_error_raise` message. */
export interface BridgeLoopsResult {
    /** False when the operator raised `BMO_ERROR_CANCEL`; the mesh is then unchanged by it. */
    ok: boolean
    error?: string
    /** New faces (`faces.out`, mesh order); empty with `useMerge`. */
    faces: BMFace[]
    /** New edges (`edges.out`, mesh order): the bridge's edges, not the loops'. Empty with `useMerge`. */
    edges: BMEdge[]
}

/** `bmo_bridge_loops_def` `type_flag` (`bmesh_opdefines.cc:868`). */
const BRIDGE_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

/** `bmo_bridge_loops_exec` without the top-level `bmesh_edit_end`. */
function bridgeLoopsExec(bm: BMesh, edges: Iterable<BMEdge>, opts: BridgeLoopsOptions): BridgeLoopsResult {
    // merge-bridge support
    const usePairs = opts.usePairs === true
    const useMerge = opts.useMerge === true
    const mergeFactor = opts.mergeFactor ?? 0
    const useCyclic = opts.useCyclic === true && useMerge === false
    const twistOffset = opts.twistOffset ?? 0
    const flags: BridgeFlags = {faceOut: new Set(), edgeOut: new Set()}
    let changed = false
    let error: string | undefined

    const edgeMark = new Set<BMEdge>(edges)

    let eloops = edgeloopsFind(bm, e => edgeMark.has(e))
    const count = eloops.length

    edgeloopsCalcCenter(eloops)

    cleanup: {
        if (count < 2) {
            error = 'Select at least two edge loops'
            break cleanup
        }

        if (usePairs && (count % 2)) {
            error = 'Select an even number of loops to bridge pairs'
            break cleanup
        }

        if (useMerge) {
            let match = true
            const eloopLen = eloops[0].len
            for (const elStore of eloops) {
                if (eloopLen !== elStore.len) {
                    match = false
                    break
                }
            }
            if (!match) {
                error = 'Selected loops must have equal edge counts'
                break cleanup
            }
        }

        if (count > 2) {
            if (usePairs) edgeloopsCalcNormal(eloops)
            eloops = edgeloopsCalcOrder(eloops, usePairs)
        }

        for (let i = 0; i < eloops.length; i++) {
            let next = i + 1
            if (next >= eloops.length) {
                if (useCyclic && count > 2) next = 0
                else break
            }
            bridgeLoopPair(bm, flags, eloops[i], eloops[next], useMerge, mergeFactor, twistOffset)
            if (usePairs) i++
            changed = true
        }
    }

    const result: BridgeLoopsResult = {ok: error === undefined, faces: [], edges: []}
    if (error !== undefined) result.error = error
    if (changed) {
        if (useMerge === false) {
            result.faces = [...bm.faces].filter(f => flags.faceOut.has(f))
            result.edges = [...bm.edges].filter(e => flags.edgeOut.has(e))
        }
    }
    return result
}

/**
 * `bmesh.ops.bridge_loops`: port of `bmo_bridge_loops_exec` (`bmo_bridge.cc:579`), run as a top-level
 * operator (normals update and select-mode flush after, `bmesh_edit_end`).
 *
 * The edge loops among `edges` are found (`BM_mesh_edgeloops_find`), ordered when there are more
 * than two (`BM_mesh_edgeloops_calc_order`, by normals too with `usePairs`), and bridged in
 * sequence: each consecutive pair, every other pair with `usePairs`, and the last back to the first
 * with `useCyclic` (three or more loops, not with `useMerge`).
 */
export function bmoBridgeLoops(bm: BMesh, edges: Iterable<BMEdge>, opts: BridgeLoopsOptions = {}): BridgeLoopsResult {
    const input = [...edges]
    return bmoOpExec(bm, BRIDGE_TYPE_FLAG, () => bridgeLoopsExec(bm, input, opts))
}

// endregion

// region editmesh_tools.cc - MESH_OT_bridge_edge_loops

/** `MESH_BRIDGELOOP_*` (`editmesh_tools.cc:7357`): the "Connect Loops" enum. */
export type BridgeLoopType = 'SINGLE' | 'CLOSED' | 'PAIRS'

/**
 * `MESH_OT_bridge_edge_loops` properties (`editmesh_tools.cc:7572`) with `mesh_operator_edgering_props`
 * (`:237`, called with `cuts_min = 0`, `cuts_default = 0`). Values outside an RNA property's hard range
 * are clamped, as RNA does.
 */
export interface BridgeEdgeLoopsOptions {
    /** Connect Loops: method of bridging multiple loops. Open Loop / Closed Loop / Loop Pairs. Default `'SINGLE'`. */
    type?: BridgeLoopType
    /** Merge: merge rather than creating faces. Default false. */
    useMerge?: boolean
    /** Merge Factor, 0..1. Default 0.5. */
    mergeFactor?: number
    /** Twist: twist offset for closed loops, -1000..1000. Default 0. */
    twistOffset?: number
    /** Number of Cuts, 0..1000 (UI 0..64). Default 0. */
    numberCuts?: number
    /** Interpolation: interpolation method. Linear / Blend Path / Blend Surface. Default `'PATH'`. */
    interpolation?: SubdivRingInterp
    /** Smoothness: smoothness factor, 0..1000 (UI 0..2). Default 1. */
    smoothness?: number
    /** Profile Factor: how much intermediary new edges are shrunk/expanded, -1000..1000 (UI -2..2). Default 0. */
    profileShapeFactor?: number
    /** Profile Shape: shape of the profile. Default `'SMOOTH'`. */
    profileShape?: SubdivProfileShape
}

/** What {@link bridgeEdgeLoopsSelection} did. */
export type BridgeEdgeLoopsResult =
    | {
        ok: true
        /** Faces the bridge made (`faces.out`), now selected; empty with `useMerge`. */
        faces: BMFace[]
        /** The bridge's new edges (`edges.out`). */
        edges: BMEdge[]
        /** Faces made by "Number of Cuts" (`subdivide_edgering`'s `faces.out`), also selected. */
        cutFaces: BMFace[]
        /** Selected faces deleted first (bridging face selections). */
        facesDeleted: number
        /** Whether the mesh changed (false when nothing was selected). */
        changed: boolean
    }
    | {
        ok: false
        /** Blender's report. */
        error: string
        /**
         * Whether the mesh changed anyway: with faces selected Blender deletes them before the bridge
         * fails and does not restore them (`editmesh_tools.cc:7421-7428`, #123405).
         */
        changed: boolean
        facesDeleted: number
    }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * `edbm_bridge_tag_boundary_edges` (`editmesh_tools.cc:7363`): tag (`ElemFlag.Tag`) the selected
 * edges that bound the face selection - wire, boundary, or used by an unselected face - and the
 * selected faces to delete; returns how many faces were tagged.
 */
export function edbmBridgeTagBoundaryEdges(bm: BMesh): number {
    // tags boundary edges from a face selection
    let totfaceDel = 0
    elemHflagDisableAll(bm, ElemType.Edge | ElemType.Face, ElemFlag.Tag, false)

    for (const e of bm.edges) {
        if (e.testFlag(ElemFlag.Select)) {
            if (edgeIsWire(e) || edgeIsBoundary(e)) {
                e.hflag |= ElemFlag.Tag
            } else {
                let isAllSel = true
                // check if its only used by selected faces
                for (const l of radialLoops(e)) {
                    const f = l.f
                    if (f.testFlag(ElemFlag.Select)) {
                        // Tag face for removal.
                        if (!f.testFlag(ElemFlag.Tag)) {
                            f.hflag |= ElemFlag.Tag
                            totfaceDel++
                        }
                    } else {
                        isAllSel = false
                    }
                }
                if (isAllSel === false) e.hflag |= ElemFlag.Tag
            }
        }
    }
    return totfaceDel
}

/** `bmo_delete_def` `type_flag` (`bmesh_opdefines.cc:1888`). */
const DELETE_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

/**
 * Bridge Edge Loops on the edit-mode selection: `edbm_bridge_edge_loops_exec` (`editmesh_tools.cc:7524`)
 * for one mesh, i.e. `edbm_bridge_edge_loops_for_single_editmesh` (`:7405`).
 *
 * Does nothing without a selected vertex. With faces selected, the edges bounding the face selection
 * are bridged, after the faces inside it are deleted (`delete context=DEL_FACES_KEEP_BOUNDARY`).
 * Without `useMerge`, the selection becomes the new faces (plus those of "Number of Cuts", which runs
 * `subdivide_edgering` on the new edges); with it, the welded loops stay selected.
 *
 * On failure (fewer than two loops, an odd count for pairs, unequal loops for a merge) Blender reports
 * and leaves the mesh as the bridge found it - which, with faces selected, is after their deletion.
 */
export function bridgeEdgeLoopsSelection(bm: BMesh, options: BridgeEdgeLoopsOptions = {}): BridgeEdgeLoopsResult {
    const type = options.type ?? 'SINGLE'
    const usePairs = type === 'PAIRS'
    const useCyclic = type === 'CLOSED'
    const useMerge = options.useMerge ?? false
    const mergeFactor = clamp(options.mergeFactor ?? 0.5, 0, 1)
    const twistOffset = clamp(Math.trunc(options.twistOffset ?? 0), -1000, 1000)
    const opProps: SubdivideEdgeringOptions = {
        interpMode: options.interpolation ?? 'PATH',
        cuts: clamp(Math.trunc(options.numberCuts ?? 0), 0, 1000),
        smooth: clamp(options.smoothness ?? 1.0, 0, 1e3),
        profileShape: options.profileShape ?? 'SMOOTH',
        profileShapeFactor: clamp(options.profileShapeFactor ?? 0, -1e3, 1e3),
    }

    // `edbm_bridge_edge_loops_exec`: `if (em->bm->totvertsel == 0) continue;`
    if (bm.totvertsel === 0) {
        return {ok: true, faces: [], edges: [], cutFaces: [], facesDeleted: 0, changed: false}
    }

    let totfaceDel = 0
    let totfaceDelArr: BMFace[] = []
    const useFaces = bm.totfacesel !== 0
    let changed = false
    let edgeHflag: number

    if (useFaces) {
        // NOTE: When all faces are selected, all faces will be deleted with no edge-loops remaining.
        // In this case bridge will fail with a waning and delete all faces. (#123405)
        totfaceDel = edbmBridgeTagBoundaryEdges(bm)
        totfaceDelArr = [...bm.faces].filter(f => f.testFlag(ElemFlag.Tag))
        edgeHflag = ElemFlag.Tag
    } else {
        edgeHflag = ElemFlag.Select
    }

    // `EDBM_op_init(... "bridge_loops edges=%he ...", edge_hflag, ...)`: the slot is filled now,
    // before the delete (BMO_FLAG_RESPECT_HIDE).
    const bridgeEdges = [...bm.edges].filter(e => e.testFlag(edgeHflag) && !e.testFlag(ElemFlag.Hidden))

    if (useFaces && totfaceDel) {
        elemHflagDisableAll(bm, ElemType.Face, ElemFlag.Tag, false)
        for (const f of totfaceDelArr) f.hflag |= ElemFlag.Tag
        // `BMO_op_callf(bm, BMO_FLAG_DEFAULTS, "delete geom=%hf context=%i", BM_ELEM_TAG, DEL_FACES_KEEP_BOUNDARY)`
        const delFaces = [...bm.faces].filter(f => f.testFlag(ElemFlag.Tag) && !f.testFlag(ElemFlag.Hidden))
        bmoOpExec(bm, DELETE_TYPE_FLAG, () => deleteFacesOflagContext(bm, delFaces, true))
        changed = true
    }

    const bmop = bmoBridgeLoops(bm, bridgeEdges, {usePairs, useCyclic, useMerge, mergeFactor, twistOffset})

    if (!bmop.ok) {
        // `EDBM_op_finish` reports `BMO_ERROR_CANCEL` and changes nothing back.
        return {ok: false, error: bmop.error!, changed, facesDeleted: totfaceDel}
    }

    let cutFaces: BMFace[] = []
    // when merge is used the edges are joined and remain selected
    if (useMerge === false) {
        edbmFlagDisableAll(bm, ElemFlag.Select)
        elemsHflagEnable(bm, bmop.faces, ElemType.Face, ElemFlag.Select, true)
        changed = true
    }

    if (useMerge === false) {
        if (opProps.cuts) {
            // we only need face normals updated
            normalsUpdate(bm)
            const subd = bmoSubdivideEdgering(bm, bmop.edges, opProps)
            cutFaces = subd.faces
            elemsHflagEnable(bm, subd.faces, ElemType.Face, ElemFlag.Select, true)
            changed = true
        }
    }

    // `EDBM_op_finish` returns true without an error
    changed = true

    return {ok: true, faces: bmop.faces, edges: bmop.edges, cutFaces, facesDeleted: totfaceDel, changed}
}

// endregion

