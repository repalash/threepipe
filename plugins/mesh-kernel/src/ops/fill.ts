/**
 * Fill: make an edge or a face from the selection. Blender's `F` (`MESH_OT_edge_face_add`).
 *
 * Ported from
 * - `source/blender/bmesh/operators/bmo_create.cc` (`bmo_contextual_create_exec`): an edge from two
 *   vertices; two edges closing a chain with one free vertex; an edge-net fill (`edgenet_prepare` +
 *   `edgenet_fill`, `edgenet.ts`); a face dissolve when faces are selected; an edge-loop fill; and
 *   last a face through a vertex cloud sorted around its normal;
 * - `source/blender/bmesh/operators/bmo_fill_edgeloop.cc` (`bmo_edgeloop_fill_exec`);
 * - `source/blender/editors/mesh/editmesh_tools.cc` (`edbm_add_edge_face_exec` :921 with
 *   `edbm_add_edge_face__smooth_get` :741, `__vert_edge_lookup` :762, `__tricky_extend_sel` :783 and
 *   `__tricky_finalize_sel` :878): the selection-level operator, {@link edgeFaceAddSelection}.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {ElemFlag, ElemType} from '../constants'
import {diskEdgeExists, diskEdges, edgeIsBoundary, edgeIsWire} from '../bmesh/structure'
import {edgeSelectSet, faceSelectSet, selectHistoryStore, vertSelectSet} from '../bmesh/marking'
import {selectHistoryClear, elemsHflagDisable, elemsHflagEnable} from '../bmesh/hflag'
import {faceEdgeShareLoop} from '../bmesh/euler'
import {faceVertShareLoop} from '../bmesh/walkers'
import {faceExists} from './weld'
import {dissolveFaces} from './dissolve'
import {
    bmeshEditEnd,
    edgenetFill,
    edgenetPrepare,
    edgeShareFaceCheck,
    faceCopyShared,
    faceCreateNgonVerts,
    vertsSortRadialPlane,
} from './edgenet'

// region bmo_fill_edgeloop.cc

/** Slots of `edgeloop_fill` (`bmo_edgeloop_fill_def`). */
export interface EdgeloopFillOptions {
    /** Material to use. */
    matNr?: number
    /** Smooth state to use. */
    useSmooth?: boolean
}

/**
 * Fill isolated edge loops: when every vertex of `edges` uses exactly two of them, each closed loop
 * becomes a face (unless that face exists). Port of `bmo_edgeloop_fill_exec`
 * (`bmo_fill_edgeloop.cc:23`). Returns `faces.out` in mesh order.
 */
export function edgeloopFill(bm: BMesh, edges: readonly BMEdge[], options: EdgeloopFillOptions = {}): BMFace[] {
    // first collect an array of unique from the edges
    const tote = edges.length
    const totv = tote // these should be the same
    const verts: BMVert[] = []
    const vertUsed = new Set<BMVert>() // VERT_USED
    const edgeMark = new Set<BMEdge>() // EDGE_MARK
    const eleOut = new Set<BMFace>() // ELE_OUT
    const matNr = options.matNr ?? 0
    const useSmooth = options.useSmooth ?? false

    // 'VERT_USED' will be disabled, so enable and fill the array
    let i = 0
    for (const e of edges) {
        edgeMark.add(e)
        for (const v of [e.v1, e.v2]) {
            if (!vertUsed.has(v)) {
                if (i === tote) return [] // goto cleanup
                vertUsed.add(v)
                verts[i++] = v
            }
        }
    }

    // we have a different number of verts to edges
    if (i !== tote) return []

    // sanity check - that each vertex has 2 edge users
    for (i = 0; i < totv; i++) {
        let n = 0
        for (const e of diskEdges(verts[i])) if (edgeMark.has(e)) n++
        if (n !== 2) return []
    }

    // build array of connected verts and edges
    let ePrev: BMEdge | null = null
    let eNext: BMEdge | null = null
    let totvUsed = 0

    while (totvUsed < totv) {
        let v: BMVert = verts[0]
        for (i = 0; i < totv; i++) {
            v = verts[i]
            if (vertUsed.has(v)) break
        }

        // watch it, 'i' is used for final face length
        const fVerts: BMVert[] = []
        i = 0
        do {
            // we know that there are 2 edges per vertex so no need to check
            for (const e of diskEdges(v)) {
                if (edgeMark.has(e)) {
                    if (e !== ePrev) {
                        eNext = e
                        break
                    }
                }
            }
            // fill in the array
            fVerts[i] = v
            vertUsed.delete(v)
            totvUsed++
            // step over the edges
            v = eNext!.otherVert(v)
            ePrev = eNext
            i++
        } while (v !== fVerts[0])

        if (!faceExists(fVerts)) {
            // don't use calc_edges option because we already have the edges
            const f = faceCreateNgonVerts(bm, fVerts, null, {}, true, false)!
            eleOut.add(f)
            f.matNr = matNr
            if (useSmooth) f.hflag |= ElemFlag.Smooth
        }
    }

    return [...bm.faces].filter(f => eleOut.has(f))
}

// endregion

// region bmo_create.cc

/** Slots of `contextual_create` (`bmo_contextual_create_def`). */
export interface ContextualCreateOptions {
    /** Material to use. */
    matNr?: number
    /** Smooth to use. */
    useSmooth?: boolean
}

/** Outputs of `contextual_create`. */
export interface ContextualCreateResult {
    /** `faces.out`: newly-made face(s), or the region a face dissolve made. */
    facesOut: BMFace[]
    /** `edges.out`: newly-made edge(s); only the two-vertex case fills this. */
    edgesOut: BMEdge[]
}

/**
 * `bmo_contextual_create_exec` (`bmo_create.cc:24`) run as a top-level operator: the exec followed by
 * `bmesh_edit_end` with the op's `NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE`
 * (`bmesh_opdefines.cc`, `bmo_contextual_create_def`), as `BMO_op_exec` does for both
 * `bmesh.ops.contextual_create` and the edit-mode `F`.
 *
 * `geom` is the input slot, in slot order (Blender fills it verts, then edges, then faces, each in
 * mesh order).
 */
export function contextualCreate(bm: BMesh, geom: readonly (BMVert | BMEdge | BMFace)[], options: ContextualCreateOptions = {}): ContextualCreateResult {
    const r = contextualCreateExec(bm, geom, options)
    bmeshEditEnd(bm, {normalsCalc: true, selectFlush: true, selectValidate: true})
    return r
}

/** The exec body of `bmo_contextual_create_exec` (`bmo_create.cc:24`). See {@link contextualCreate}. */
export function contextualCreateExec(bm: BMesh, geom: readonly (BMVert | BMEdge | BMFace)[], options: ContextualCreateOptions = {}): ContextualCreateResult {
    const matNr = options.matNr ?? 0
    const useSmooth = options.useSmooth ?? false
    const vertNew = new Set<BMVert>() // ELE_NEW on verts
    const edgeNew = new Set<BMEdge>() // ELE_NEW on edges
    const faceNew = new Set<BMFace>() // ELE_NEW on faces
    const geomVerts: BMVert[] = []
    let totv = 0, tote = 0, totf = 0

    // count number of each element type we were passed
    for (const h of geom) {
        if (h instanceof BMVert) {
            vertNew.add(h)
            geomVerts.push(h)
            totv++
        } else if (h instanceof BMEdge) {
            edgeNew.add(h)
            tote++
        } else {
            faceNew.add(h)
            totf++
        }
    }
    const edgesFlagged = () => [...bm.edges].filter(e => edgeNew.has(e)) // `edges=%fe` ELE_NEW
    const none: ContextualCreateResult = {facesOut: [], edgesOut: []}

    // --- Support Edge Creation ---
    // simple case when we only have 2 verts selected.
    if (totv === 2 && tote === 0 && totf === 0) {
        // BMO_iter_as_array(geom, BM_VERT, verts, 2)
        const verts = geomVerts.slice(0, 2)
        if (verts.length === 2) {
            // create edge
            const e = bm.edgeCreate(verts[0], verts[1], undefined, {noDouble: true})
            return {facesOut: [], edgesOut: [e]} // ELE_OUT, BMO_slot_buffer_from_enabled_flag
        }
        return none
    }

    // --- Support for Special Case ---
    // where there is a contiguous edge ring with one isolated vertex: create 2 edges.
    if (totf === 0 && totv >= 4 && totv === tote + 2) {
        // find a free standing vertex and 2 endpoint verts
        let vFree: BMVert | null = null, vA: BMVert | null = null, vB: BMVert | null = null
        let ok = true
        for (const v of geomVerts) {
            // count how many flagged edges this vertex uses
            let totEdges = 0
            for (const e of diskEdges(v)) if (edgeNew.has(e)) totEdges++
            if (totEdges === 0) {
                // only accept 1 free vert
                if (vFree === null) vFree = v
                else ok = false
            } else if (totEdges === 1) {
                if (vA === null) vA = v
                else if (vB === null) vB = v
                else ok = false
            } else if (totEdges === 2) {
                // do nothing, regular case
            } else {
                ok = false // if a vertex has 3+ edge users then cancel - this is only simple cases
            }
            if (!ok) break
        }
        if (ok && vFree && vA && vB) {
            edgeNew.add(bm.edgeCreate(vFree, vA, undefined, {noDouble: true}))
            edgeNew.add(bm.edgeCreate(vFree, vB, undefined, {noDouble: true}))
            tote += 2
        }
    }
    // --- end special case support, continue as normal ---

    // EdgeNet Create
    if (tote !== 0) {
        // call edgenet prepare op so additional face creation cases work
        for (const e of edgenetPrepare(bm, edgesFlagged())) edgeNew.add(e)

        const facesOut = edgenetFill(bm, edgesFlagged(), {matNr, useSmooth, sides: 10000})
        // return if edge net create did something
        if (facesOut.length) return {facesOut, edgesOut: []}
    }

    // Dissolve Face
    if (totf !== 0) { // should be (totf > 1)... see below
        // NOTE: allow this to run on single faces so running on a single face won't go on to
        // create a face, treating them as random
        const region = dissolveFaces(bm, [...bm.faces].filter(f => faceNew.has(f)))
        // if we dissolved anything, then return
        if (region.length) return {facesOut: region, edgesOut: []}
    }

    // Fill EdgeLoop's - fills isolated loops, different from edgenet
    if (tote > 2) {
        // NOTE: in most cases 'edgenet_fill' will handle this case since in common cases users fill
        // in empty spaces, however its possible to have an edge selection around existing geometry
        // that makes 'edgenet_fill' fail. (Called without mat_nr / use_smooth: their defaults.)
        const facesOut = edgeloopFill(bm, edgesFlagged())
        // return if edge loop fill did something
        if (facesOut.length) return {facesOut, edgesOut: []}
    }

    // Continue with ad-hoc fill methods since operators fail. (Blender's `if (false)` branch, making
    // edges from the select history, is disabled in the source and not ported.)

    // Fill Vertex Cloud - last resort when all else fails.
    if (totv > 2) {
        // TODO (Blender): some of these vertices may be connected by edges, this connectivity could
        // be used rather than treating them as a bunch of isolated verts.
        const vertArr = geomVerts.slice(0, totv)
        vertsSortRadialPlane(vertArr)

        // create edges and find the winding (if faces are attached to any existing edges)
        const f = faceCreateNgonVerts(bm, vertArr, null, {noDouble: true}, true, true)
        if (f) {
            f.matNr = matNr
            if (useSmooth) f.hflag |= ElemFlag.Smooth
            faceCopyShared(bm, f, null)
            return {facesOut: [f], edgesOut: []}
        }
    }
    return none
}

// endregion

// region editmesh_tools.cc

/** `edbm_add_edge_face__smooth_get` (`editmesh_tools.cc:741`): do most selected edges' faces vote smooth? */
export function edbmAddEdgeFaceSmoothGet(bm: BMesh): boolean {
    const voteOnSmooth = [0, 0]
    for (const e of bm.edges) {
        if ((e.hflag & ElemFlag.Select) && e.l) {
            voteOnSmooth[e.l.f.hflag & ElemFlag.Smooth ? 1 : 0]++
        }
    }
    return voteOnSmooth[0] < voteOnSmooth[1]
}

/**
 * `edbm_add_edge_face_exec__vert_edge_lookup` (`editmesh_tools.cc:762`): up to `eArrLen` visible
 * edges of `v` (other than `eUsed`) passing `func`, in disk order.
 */
function edbmAddEdgeFaceVertEdgeLookup(v: BMVert, eUsed: BMEdge | null, eArrLen: number, func: (e: BMEdge) => boolean): BMEdge[] {
    const eArr: BMEdge[] = []
    for (const eIter of diskEdges(v)) {
        if (!(eIter.hflag & ElemFlag.Hidden)) {
            if (eUsed === null || eUsed !== eIter) {
                if (func(eIter)) {
                    eArr.push(eIter)
                    if (eArr.length >= eArrLen) break
                }
            }
        }
    }
    return eArr
}

/**
 * `edbm_add_edge_face_exec__tricky_extend_sel` (`editmesh_tools.cc:783`): with one vertex selected,
 * or one edge, on the corner/side of a boundary or wire chain, extend the selection so `F` can make a
 * triangle or quad there. Returns the element to deselect afterwards, or null.
 */
function edbmAddEdgeFaceTrickyExtendSel(bm: BMesh): BMVert | BMEdge | null {
    if (bm.totvertsel === 1 && bm.totedgesel === 0 && bm.totfacesel === 0) {
        // first look for 2 boundary edges
        let v: BMVert | null = null
        for (const x of bm.verts) {
            if (x.hflag & ElemFlag.Select) {
                v = x
                break
            }
        }
        if (v) {
            let edPair: BMEdge[] | null = null
            const wire = edbmAddEdgeFaceVertEdgeLookup(v, null, 3, edgeIsWire)
            if (wire.length === 2 && !edgeShareFaceCheck(wire[0], wire[1])) {
                edPair = wire
            } else {
                const boundary = edbmAddEdgeFaceVertEdgeLookup(v, null, 3, edgeIsBoundary)
                if (boundary.length === 2 && !edgeShareFaceCheck(boundary[0], boundary[1])) edPair = boundary
            }
            if (edPair) {
                const eOther = diskEdgeExists(edPair[0].otherVert(v), edPair[1].otherVert(v))
                edgeSelectSet(bm, edPair[0], true)
                edgeSelectSet(bm, edPair[1], true)
                if (eOther) edgeSelectSet(bm, eOther, true)
                return v
            }
        }
    } else if (bm.totvertsel === 2 && bm.totedgesel === 1 && bm.totfacesel === 0) {
        // first look for 2 boundary edges
        let e: BMEdge | null = null
        for (const x of bm.edges) {
            if (x.hflag & ElemFlag.Select) {
                e = x
                break
            }
        }
        if (e) {
            const sel = e
            // One alternative of the `||` chain: both lookups give exactly one edge, neither of which
            // shares a face with `e`. Each alternative rewrites both arrays before testing them.
            const alt = (f1: (x: BMEdge) => boolean, f2: (x: BMEdge) => boolean): [BMEdge, BMEdge] | null => {
                const p1 = edbmAddEdgeFaceVertEdgeLookup(sel.v1, sel, 2, f1)
                if (p1.length !== 1) return null
                const p2 = edbmAddEdgeFaceVertEdgeLookup(sel.v2, sel, 2, f2)
                if (p2.length !== 1) return null
                if (edgeShareFaceCheck(sel, p1[0]) || edgeShareFaceCheck(sel, p2[0])) return null
                return [p1[0], p2[0]]
            }
            const pair = alt(edgeIsWire, edgeIsWire)
                // better support mixed cases #37203.
                ?? alt(edgeIsWire, edgeIsBoundary)
                ?? alt(edgeIsBoundary, edgeIsWire)
                ?? alt(edgeIsBoundary, edgeIsBoundary)
            if (pair) {
                const v1Other = pair[0].otherVert(sel.v1)
                const v2Other = pair[1].otherVert(sel.v2)
                const eOther = v1Other !== v2Other ? diskEdgeExists(v1Other, v2Other) : null
                edgeSelectSet(bm, pair[0], true)
                edgeSelectSet(bm, pair[1], true)
                if (eOther) edgeSelectSet(bm, eOther, true)
                return sel
            }
        }
    }
    return null
}

/**
 * `edbm_add_edge_face_exec__tricky_finalize_sel` (`editmesh_tools.cc:878`): after a tricky extend
 * made one face, select the element across it from the one the user had, so pressing `F` again keeps
 * adding geometry.
 */
function edbmAddEdgeFaceTrickyFinalizeSel(bm: BMesh, eleDesel: BMVert | BMEdge, f: BMFace): void {
    // Now we need to find the edge that isn't connected to this element.
    selectHistoryClear(bm)

    // Un-hide the face since its possible hidden was copied when copying surrounding face
    // attributes; un-hide before adding to select history since we may extend into an existing,
    // hidden vert/edge.
    f.hflag &= ~ElemFlag.Hidden
    faceSelectSet(bm, f, false)

    if (eleDesel instanceof BMVert) {
        const l = faceVertShareLoop(f, eleDesel)!
        vertSelectSet(bm, eleDesel, false)
        edgeSelectSet(bm, l.next.e!, true)
        selectHistoryStore(bm, l.next.e!)
    } else {
        const l = faceEdgeShareLoop(f, eleDesel)!
        edgeSelectSet(bm, eleDesel, false)
        if (f.len === 4) {
            const eActive = l.next.next.e!
            eActive.hflag &= ~ElemFlag.Hidden
            edgeSelectSet(bm, eActive, true)
            selectHistoryStore(bm, eActive)
        } else {
            const vActive = l.next.next.v
            vActive.hflag &= ~ElemFlag.Hidden
            vertSelectSet(bm, vActive, true)
            selectHistoryStore(bm, vActive)
        }
    }
}

/** Inputs of {@link edgeFaceAddSelection}. `MESH_OT_edge_face_add` has no RNA properties. */
export interface EdgeFaceAddOptions {
    /**
     * The material index new faces get: Blender's `em->mat_nr`, the object's active material slot
     * (`ob->actcol - 1`). Not an operator property. Default 0.
     */
    matNr?: number
}

export type EdgeFaceAddResult =
    | {ok: true, faces: BMFace[], edges: BMEdge[]}
    | {ok: false, error: string}

/**
 * Make Edge/Face, Blender's `F` in edit mode: "Add an edge or face to selected". Port of
 * `edbm_add_edge_face_exec` (`editmesh_tools.cc:921`) on one mesh.
 *
 * Runs `contextual_create` on the selection (smooth when most selected edges' faces are smooth),
 * after extending a lone selected vertex or edge on a boundary / wire chain into the corner it
 * closes. New geometry is selected and unhidden; after a tricky extend that made one face, the
 * selection moves on to the next element instead, so `F` can be pressed repeatedly.
 *
 * On failure Blender cancels without a report and without undoing what it already did: the tricky
 * extend's selection changes and the operator's select flush stay. This port does the same.
 */
export function edgeFaceAddSelection(bm: BMesh, options: EdgeFaceAddOptions = {}): EdgeFaceAddResult {
    if (bm.totvertsel === 0 && bm.totedgesel === 0 && bm.totfacesel === 0) {
        return {ok: false, error: 'Select vertices, edges or faces to make an edge or face from'}
    }

    const useSmooth = edbmAddEdgeFaceSmoothGet(bm)
    const totedgeOrig = bm.totedge
    const totfaceOrig = bm.totface

    // be extra clever, figure out if a partial selection should be extended so we can create
    // geometry with single vert or single edge selection.
    const eleDesel = edbmAddEdgeFaceTrickyExtendSel(bm)

    // "contextual_create geom=%hfev": selected, not hidden (BMO_FLAG_RESPECT_HIDE), verts then edges
    // then faces, each in mesh order.
    const sel = (x: {hflag: number}) => (x.hflag & ElemFlag.Select) !== 0 && (x.hflag & ElemFlag.Hidden) === 0
    const geom: (BMVert | BMEdge | BMFace)[] = [
        ...[...bm.verts].filter(sel), ...[...bm.edges].filter(sel), ...[...bm.faces].filter(sel),
    ]
    const r = contextualCreate(bm, geom, {matNr: options.matNr ?? 0, useSmooth})

    // cancel if nothing was done
    if (totedgeOrig === bm.totedge && totfaceOrig === bm.totface) {
        return {ok: false, error: 'Nothing could be made from the selection: select two vertices for an edge, or a closed loop or edge net for a face'}
    }

    // normally we would want to leave the new geometry selected, but being able to press F many
    // times to add geometry is too useful!
    if (eleDesel && r.facesOut.length === 1 && r.facesOut[0]) {
        edbmAddEdgeFaceTrickyFinalizeSel(bm, eleDesel, r.facesOut[0])
    } else {
        // Newly created faces may include existing hidden edges, copying face data from
        // surrounding, may have copied hidden face flag too. Important that faces use flushing
        // since 'edges.out' won't include hidden edges that already existed.
        elemsHflagDisable(bm, r.facesOut, ElemType.Face, ElemFlag.Hidden, true)
        elemsHflagDisable(bm, r.edgesOut, ElemType.Edge, ElemFlag.Hidden, false)
        elemsHflagEnable(bm, r.facesOut, ElemType.Face, ElemFlag.Select, true)
        elemsHflagEnable(bm, r.edgesOut, ElemType.Edge, ElemFlag.Select, true)
    }

    return {ok: true, faces: r.facesOut, edges: r.edgesOut}
}

/** What {@link fillSelection} made. */
export interface FillResult {
    /** Faces made (or the dissolved region). */
    faces: BMFace[]
    /** Edges made (`edges.out`). */
    edges: BMEdge[]
    /** The first face made, for callers that want one thing to select. */
    face: BMFace | null
}

/**
 * {@link edgeFaceAddSelection} in the older shape: null when nothing could be made.
 * Prefer {@link edgeFaceAddSelection}, which carries Blender's failure message.
 */
export function fillSelection(bm: BMesh, options: EdgeFaceAddOptions = {}): FillResult | null {
    const r = edgeFaceAddSelection(bm, options)
    if (!r.ok) return null
    return {faces: r.faces, edges: r.edges, face: r.faces[0] ?? null}
}

// endregion
