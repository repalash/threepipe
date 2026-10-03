/**
 * Dissolving edges and vertices: removing them while merging the faces around them.
 *
 * Ported from `source/blender/bmesh/operators/bmo_dissolve.cc` (`bmo_dissolve_edges_exec`,
 * `bmo_dissolve_verts_exec`, `bm_face_split`, `bmo_find_end_of_chain`,
 * `bmo_vert_touches_unselected_face`, `bmo_vert_tagged_edges_count_at_most`,
 * `bmo_vert_calc_edge_angle_blended`) and `editors/mesh/editmesh_tools.cc`
 * (`edbm_dissolve_verts_exec`, `edbm_dissolve_edges_exec`, `edbm_dissolve_mode_exec` and the
 * `edbm_dissolve_prop__*` RNA properties). Face dissolve and the shared BMesh helpers
 * (`BM_faces_join`, `BM_vert_collapse_edge`, ...) are in `dissolve.ts`.
 *
 * Blender's operator flags (`EDGE_TAG`, `EDGE_CHAIN`, `EDGE_ISGC`, `VERT_MARK`, `VERT_MARK_PAIR`,
 * `VERT_MARK_TEAR`, `VERT_TAG`, `VERT_ISGC`) are sets here; `BMO_*_flag_enable/test` become
 * `add`/`has`.
 *
 * Blender 3.4.1 (the binary the fixtures come from) had an older `bmo_dissolve_edges_exec` - no
 * `angle_threshold`, no `use_preserve_quads`, and a simpler vertex marking - and a `BM_faces_join`
 * without the double-face reuse. This file ports the current source; the parity suite documents the
 * cases where the two differ and asserts the current behaviour by hand there.
 */

import {BMEdge, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, edgeIsBoundary, edgeIsWire} from '../bmesh/structure'
import {faceSplit} from '../bmesh/mods'
import {faceCalcNormal} from '../bmesh/polygon'
import {selectCountsRecalc} from '../bmesh/marking'
import {angleOnAxisV3V3V3V3, angleV3V3V3} from '../math/geom'
import {v3dot, Vec3} from '../math'
import {ElemFlag, SelectMode, SelectModeMask} from '../constants'
import {normalsUpdate} from './bevel-bmquery'
import {bmeshEditEnd} from './bmo'
import {
    DISSOLVE_EDIT_END,
    dissolveFacesSelection,
    DissolveSelectionResult,
    edgeFacePair,
    edgeLoopPair,
    elemsWithHflag,
    facesJoinPair,
    loopsOfVert,
    vertCollapseEdgeAndMerge,
    vertEdgePair,
    vertIsEdgePair,
} from './dissolve'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/**
 * `RAD2DEGF(0.0001f)` (`bmo_dissolve.cc:466`) - Blender's own expression, radians-to-degrees and all
 * (about 0.0057), in `float` as Blender computes it.
 */
const ANGLE_EPSILON = Math.fround(Math.fround(0.0001) * Math.fround(180 / Math.PI))

/**
 * `bmo_vert_calc_edge_angle_blended` (`bmo_dissolve.cc:91`): the bend at a two-edge vertex, blending
 * the raw angle between its edges with the angle seen around the vertex normal, the more so the
 * more the two faces of the vertex's edge fold over (`raw_factor`, 0 up to 90 degrees of fold, 1 at
 * 180). Face normals are recomputed (merges leave them stale); the vertex normal is the stored one.
 */
function vertCalcEdgeAngleBlended(v: BMVert): number {
    const ePair = vertEdgePair(v)!
    // Compute the angle between the edges. Start with the raw angle.
    const vA = ePair[0].otherVert(v)
    const vB = ePair[1].otherVert(v)
    let angle = Math.PI - angleV3V3V3(co(vA), co(v), co(vB))

    const fPair = edgeFacePair(v.e!)
    if (fPair) {
        // Due to merges, the normals are not currently trustworthy. Compute them.
        const noA = faceCalcNormal(fPair[0])
        const noB = faceCalcNormal(fPair[1])
        // Now determine the raw factor based on how folded the faces are.
        const rawFactor = Math.min(Math.max(-v3dot(noA, noB), 0), 1)
        // Blend the two ways of computing the angle.
        const normalAngle = Math.PI - angleOnAxisV3V3V3V3(co(vA), co(v), co(vB), [v.nx, v.ny, v.nz])
        // `interpf(angle, normal_angle, raw_factor)`
        angle = rawFactor * angle + (1 - rawFactor) * normalAngle
    }
    return angle
}

/**
 * `bm_face_split` (`bmo_dissolve.cc:175`): at every flagged vertex that is not a two-edge vertex, cut
 * off the corner of each face with more than three sides whose neighbouring corners are both
 * unflagged, so the dissolve keeps the surrounding geometry. With `useEdgeDelete` the vertex's edges
 * (and so its faces) are then removed, last flagged vertex first - that is "Tear Boundary".
 */
function bmFaceSplit(bm: BMesh, oflag: ReadonlySet<BMVert>, useEdgeDelete: boolean): void {
    const edgeDeleteVerts: BMVert[] = []

    for (const v of [...bm.verts]) {
        if (!oflag.has(v)) continue
        if (vertIsEdgePair(v)) continue
        for (const l of loopsOfVert(v)) {
            if (l.f.len > 3) {
                if (!oflag.has(l.next.v) && !oflag.has(l.prev.v)) {
                    faceSplit(bm, l.f, l.next, l.prev, undefined, true)
                }
            }
        }
        if (useEdgeDelete) edgeDeleteVerts.push(v)
    }

    if (useEdgeDelete) {
        // `BLI_stack_pop`: last pushed first.
        while (edgeDeleteVerts.length) {
            const v = edgeDeleteVerts.pop()!
            // remove surrounding edges & faces
            while (v.e) bm.edgeKill(v.e)
        }
    }
}

/**
 * Walk a chain of two-edge vertices from `v` away from `e` and return the vertex where it ends.
 * With `edgeOflag` every edge walked is marked, and the walk gives up (null) at an edge already
 * marked; it also gives up if the chain loops back. `bmo_find_end_of_chain` (`bmo_dissolve.cc:369`).
 */
function findEndOfChain(e: BMEdge, v: BMVert, edgeOflag: Set<BMEdge> | null): BMVert | null {
    const vInit = v
    while (vertIsEdgePair(v)) {
        // Move one step down the chain.
        e = e.diskNext(v)!
        v = e.otherVert(v)
        // If we walk to an edge that has already been processed, there's no need to keep working.
        if (edgeOflag && edgeOflag.has(e)) return null
        // Optionally mark along the chain.
        if (edgeOflag) edgeOflag.add(e)
        // Avoid an eternal loop even in the case of degenerate geometry.
        if (v === vInit) return null
    }
    return v
}

/**
 * Would dissolving `v` alter a face neither of whose edges at `v` is tagged? Always false for a vertex
 * already marked. `bmo_vert_touches_unselected_face` (`bmo_dissolve.cc:404`).
 */
function vertTouchesUnselectedFace(v: BMVert, edgeTag: ReadonlySet<BMEdge>, vertMark: ReadonlySet<BMVert>): boolean {
    // If the vert was already tested and marked, don't test again.
    if (vertMark.has(v)) return false
    for (const lA of loopsOfVert(v)) {
        // `BM_loop_other_edge_loop(l_a, v)`
        const lB = lA.v === v ? lA.prev : lA.next
        // `l_a` and `l_b` are now the two edges of the face that share this vert.
        if (!edgeTag.has(lA.e!) && !edgeTag.has(lB.e!)) return true
    }
    return false
}

/** `bmo_vert_tagged_edges_count_at_most` (`bmo_dissolve.cc:430`). */
function vertTaggedEdgesCountAtMost(v: BMVert, edgeOflag: ReadonlySet<BMEdge>, max: number): number {
    let retval = 0
    for (const e of diskEdges(v)) {
        if (edgeOflag.has(e)) retval++
        if (retval === max) return retval
    }
    return retval
}

export interface DissolveEdgesOptions {
    /**
     * Dissolve remaining vertices which connect to only two edges (Blender's `use_verts`).
     * Default **true** here - what this function always did and what `MESH_OT_dissolve_edges`
     * defaults to; note the bare `bmesh.ops.dissolve_edges` slot defaults to false.
     */
    useVerts?: boolean
    /** Split off face corners to maintain surrounding geometry (`use_face_split`). Default false. */
    useFaceSplit?: boolean
    /**
     * Remaining vertices which separate edge pairs are preserved if their edge angle exceeds this
     * threshold (`angle_threshold`, radians, 0..pi). Default pi (`bmo_dissolve_edges_init`), where
     * no angle test is made; at (about) 0 no vertex dissolves (`use_verts` is turned off).
     */
    angleThreshold?: number
    /** When dissolving the edge between two triangles, don't dissolve vertices (`use_preserve_quads`). Default false (bmesh op). */
    usePreserveQuads?: boolean
}

/**
 * Dissolve edges: merge the face pair on either side of each edge, then clean up what the merges
 * left loose and (with `useVerts`) dissolve the vertices left between two edges. Returns how many of
 * the given edges had their two faces joined.
 *
 * Port of `bmo_dissolve_edges_exec` (`bmo_dissolve.cc:455`). Edges with other than two faces
 * (boundary, wire, non-manifold) are left alone, as Blender leaves them. No normals refresh or
 * selection flush (see `dissolveEdgesSelection`); vertex normals are read for the angle test, so they
 * must be current when `angleThreshold` is below pi.
 */
export function dissolveEdges(bm: BMesh, edges: readonly BMEdge[], options: DissolveEdgesOptions = {}): number {
    const edgeTag = new Set<BMEdge>()
    const edgeChain = new Set<BMEdge>()
    const edgeIsgc = new Set<BMEdge>()
    const vertIsgc = new Set<BMVert>()
    const vertMark = new Set<BMVert>()
    const vertTag = new Set<BMVert>()

    // A C `float` slot (`BMO_slot_float_get`); `bmo_dissolve_edges_init` sets it to `M_PI`.
    const angleThreshold = Math.fround(options.angleThreshold ?? Math.PI)
    // Use verts when told to... except, do *not* use verts when angle_threshold is 0.0.
    const useVerts = (options.useVerts ?? true) && angleThreshold > ANGLE_EPSILON
    // If angle threshold is 180, don't bother with angle math, just dissolve everything.
    const dissolveAll = angleThreshold > Math.PI - ANGLE_EPSILON
    const useFaceSplit = options.useFaceSplit ?? false
    const usePreserveQuads = options.usePreserveQuads ?? false

    if (useFaceSplit || useVerts) for (const e of edges) edgeTag.add(e)

    // Tag certain geometry around the selected edges, for later processing.
    for (const e of edges) {
        // Connected edge chains have endpoints with edge pairs; mark them to skip the angle test later.
        if (vertIsEdgePair(e.v1) || vertIsEdgePair(e.v2)) edgeChain.add(e)

        const fPair = edgeFacePair(e)
        if (fPair) {
            // Tag the edges and verts of both faces: they may end up loose after the dissolve.
            for (const f of fPair) {
                for (const l of f.eachLoop()) {
                    vertIsgc.add(l.v)
                    edgeIsgc.add(l.e!)
                }
            }
            // Extend EDGE_TAG to both ends of a chain that will dissolve with this edge.
            if (useVerts && edgeChain.has(e)) {
                findEndOfChain(e, e.v1, edgeTag)
                findEndOfChain(e, e.v2, edgeTag)
            }
        }
    }

    if (useVerts) {
        // Mark all verts that are candidates to be dissolved.
        for (const e of edges) {
            // Edges only dissolve if they are manifold.
            const fPair = edgeFacePair(e)
            if (!fPair) continue

            for (let i = 0; i < 2; i++) {
                let vEdge: BMVert | null = i === 0 ? e.v1 : e.v2

                // An edge between two triangles should dissolve to a quad, akin to un-triangulate.
                if (usePreserveQuads && fPair[0].len === 3 && fPair[1].len === 3
                    && vertTaggedEdgesCountAtMost(vEdge, edgeTag, 2) === 1) {
                    continue
                }

                // If a chain, follow the chain until the end is found; the test happens there.
                if (vertIsEdgePair(vEdge)) vEdge = findEndOfChain(e, vEdge, edgeChain)

                // If the end of the chain was searched for and was not located, take no action.
                if (vEdge === null) continue

                // Contact with an unselected face is incidental unless only one tagged edge ends here.
                if (vertTouchesUnselectedFace(vEdge, edgeTag, vertMark)
                    && vertTaggedEdgesCountAtMost(vEdge, edgeTag, 2) !== 1) {
                    continue
                }

                // Mark for dissolve.
                vertMark.add(vEdge)
            }
        }
    }

    if (useFaceSplit) {
        for (const v of bm.verts) {
            let untagCount = 0
            for (const e of diskEdges(v)) if (!edgeTag.has(e)) untagCount++
            // check that we have 2 edges remaining after dissolve
            if (untagCount <= 2) vertTag.add(v)
        }
        bmFaceSplit(bm, vertTag, false)
    }

    // Merge any face pairs that straddle a selected edge.
    let dissolved = 0
    for (const e of edges) {
        const pair = edgeLoopPair(e)
        if (pair && facesJoinPair(bm, pair[0], pair[1], false)) dissolved++
    }

    // Cleanup geometry: edges the merges left without faces.
    for (const e of [...bm.edges]) {
        if (bm.edges.has(e) && e.l === null && edgeIsgc.has(e)) bm.edgeKill(e)
    }
    // Cleanup geometry: verts left without edges.
    for (const v of [...bm.verts]) {
        if (bm.verts.has(v) && v.e === null && vertIsgc.has(v)) bm.vertKill(v)
    }

    // If dissolving verts, then evaluate each VERT_MARK vert.
    if (useVerts) {
        for (const v of bm.verts) {
            if (!vertMark.has(v)) continue
            // If it is not an edge pair, it cannot be merged.
            const ePair = vertEdgePair(v)
            if (!ePair) {
                vertMark.delete(v)
                continue
            }
            // At an angle threshold of 180, dissolve everything, skip the math of the angle test.
            if (dissolveAll) continue
            // Verts in edge chains ignore the angle test.
            if (edgeChain.has(ePair[0]) || edgeChain.has(ePair[1])) continue
            // If the angle at the vert is larger than the threshold, it cannot be merged.
            if (vertCalcEdgeAngleBlended(v) > Math.fround(angleThreshold - ANGLE_EPSILON)) {
                vertMark.delete(v)
                continue
            }
        }

        // Dissolve all verts that remain tagged, in a separate pass so early dissolves do not alter
        // the angles measured at neighbouring verts.
        for (const v of [...bm.verts]) {
            if (!bm.verts.has(v) || !vertMark.has(v)) continue
            // Edge merges might have changed a neighbouring vert so it is no longer an edge pair.
            if (!vertIsEdgePair(v)) continue
            vertCollapseEdgeAndMerge(bm, v, true)
        }
    }
    return dissolved
}

export interface DissolveVertsOptions {
    /** Split off face corners to maintain surrounding geometry (`use_face_split`). Default false. */
    useFaceSplit?: boolean
    /** Split off face corners instead of merging faces (`use_boundary_tear`). Default false. */
    useBoundaryTear?: boolean
}

/**
 * Dissolve vertices: merge every face around each vertex into one, then remove the vertex; a vertex
 * between two edges is collapsed out of its edge chain instead. Returns how many of the given
 * vertices are gone afterwards.
 *
 * Port of `bmo_dissolve_verts_exec` (`bmo_dissolve.cc:695`).
 */
export function dissolveVerts(bm: BMesh, verts: readonly BMVert[], options: DissolveVertsOptions = {}): number {
    const useFaceSplit = options.useFaceSplit ?? false
    const useBoundaryTear = options.useBoundaryTear ?? false
    const vertMark = new Set<BMVert>(verts)
    const vertIsgc = new Set<BMVert>(verts)
    const vertMarkTear = new Set<BMVert>()
    const vertMarkPair = new Set<BMVert>()
    const edgeIsgc = new Set<BMEdge>()

    if (useFaceSplit) bmFaceSplit(bm, vertMark, false)

    if (useBoundaryTear) {
        for (const v of verts) {
            if (vertIsEdgePair(v)) continue
            for (const e of diskEdges(v)) {
                if (edgeIsBoundary(e)) {
                    vertMarkTear.add(v)
                    break
                }
            }
        }
        bmFaceSplit(bm, vertMarkTear, true)
    }

    for (const v of verts) {
        let eFirst: BMEdge | null = null
        for (const lFirst of loopsOfVert(v)) {
            let lIter = lFirst
            do {
                vertIsgc.add(lIter.v)
                edgeIsgc.add(lIter.e!)
            } while ((lIter = lIter.next) !== lFirst)
            eFirst = lFirst.e
        }

        // important e_first won't be deleted
        if (eFirst) {
            let e = eFirst
            do {
                const eNext = e.diskNext(v)!
                if (edgeIsWire(e)) bm.edgeKill(e)
                e = eNext
            } while (e !== eFirst)
        }
    }

    // tag here so we avoid feedback loop (checking topology as we edit)
    for (const v of verts) if (vertIsEdgePair(v)) vertMarkPair.add(v)

    for (const v of verts) {
        // Merge across every edge that touches `v`, one `BM_faces_join_pair()` per edge.
        if (vertMarkPair.has(v)) continue
        for (const e of diskEdges(v)) {
            const pair = edgeLoopPair(e)
            if (pair) facesJoinPair(bm, pair[0], pair[1], false)
        }
    }

    // Cleanup geometry (`BM_faces_join_pair` removes geometry we're looping on), in a separate pass.
    for (const e of [...bm.edges]) {
        if (bm.edges.has(e) && e.l === null && edgeIsgc.has(e)) bm.edgeKill(e)
    }

    // final cleanup
    for (const v of verts) {
        if (bm.verts.has(v) && vertIsEdgePair(v)) vertCollapseEdgeAndMerge(bm, v, false)
    }

    for (const v of [...bm.verts]) {
        if (bm.verts.has(v) && v.e === null && vertIsgc.has(v)) bm.vertKill(v)
    }

    let gone = 0
    for (const v of new Set(verts)) if (!bm.verts.has(v)) gone++
    return gone
}

// region edit-mode operators

/** RNA properties of `MESH_OT_dissolve_verts` (`editmesh_tools.cc:6074`). */
export interface DissolveVertsSelectionOptions {
    /** "Face Split": split off face corners to maintain surrounding geometry. Default false. */
    useFaceSplit?: boolean
    /** "Tear Boundary": split off face corners instead of merging faces. Default false. */
    useBoundaryTear?: boolean
}

/**
 * Edit-mode Dissolve Vertices: `edbm_dissolve_verts_exec` (`editmesh_tools.cc:6032`). Runs
 * {@link dissolveVerts} on the selected visible vertices, then `bmesh_edit_end` (normals, select-mode
 * flush). Nothing selected: nothing happens (`changed: false`), as in Blender.
 *
 * Not ported: `BM_custom_loop_normals_to_vector_layer` / `_from_vector_layer` (see
 * `dissolveFacesSelection`).
 */
export function dissolveVertsSelection(bm: BMesh, options: DissolveVertsSelectionOptions = {}): DissolveSelectionResult {
    selectCountsRecalc(bm)
    if (bm.totvertsel === 0) return {ok: true, changed: false, regionOut: []}
    dissolveVerts(bm, elemsWithHflag(bm.verts, ElemFlag.Select), {
        useFaceSplit: options.useFaceSplit ?? false,
        useBoundaryTear: options.useBoundaryTear ?? false,
    })
    bmeshEditEnd(bm, DISSOLVE_EDIT_END)
    return {ok: true, changed: true, regionOut: []}
}

/** RNA properties of `MESH_OT_dissolve_edges` (`editmesh_tools.cc:6161`). */
export interface DissolveEdgesSelectionOptions {
    /** "Dissolve Vertices": dissolve remaining vertices which connect to only two edges. Default true. */
    useVerts?: boolean
    /**
     * "Angle Threshold": remaining vertices which separate edge pairs are preserved if their edge
     * angle exceeds this threshold. Radians, 0..pi, default pi.
     */
    angleThreshold?: number
    /** "Face Split": split off face corners to maintain surrounding geometry. Default false. */
    useFaceSplit?: boolean
    /** "Preserve Quads": when dissolving the edge between two triangles, don't dissolve vertices. Default true. */
    usePreserveQuads?: boolean
}

/**
 * Edit-mode Dissolve Edges: `edbm_dissolve_edges_exec` (`editmesh_tools.cc:6098`). Runs
 * {@link dissolveEdges} on the selected visible edges with the operator's defaults, then
 * `bmesh_edit_end`. When nothing is selected, or the mesh's element counts did not change, Blender
 * reports "No edges dissolved" - returned as the error (the operator has still run, as in Blender).
 *
 * Vertex normals are refreshed first: edit mode keeps them current for the angle test, the kernel
 * does not.
 */
export function dissolveEdgesSelection(bm: BMesh, options: DissolveEdgesSelectionOptions = {}): DissolveSelectionResult {
    selectCountsRecalc(bm)
    const totvertOrig = bm.totvert
    const totedgeOrig = bm.totedge
    const totfaceOrig = bm.totface
    if (bm.totedgesel === 0) return {ok: false, error: 'No edges dissolved'}

    normalsUpdate(bm)
    dissolveEdges(bm, elemsWithHflag(bm.edges, ElemFlag.Select), {
        useVerts: options.useVerts ?? true,
        useFaceSplit: options.useFaceSplit ?? false,
        angleThreshold: options.angleThreshold ?? Math.PI,
        usePreserveQuads: options.usePreserveQuads ?? true,
    })
    bmeshEditEnd(bm, DISSOLVE_EDIT_END)

    if (totvertOrig === bm.totvert && totedgeOrig === bm.totedge && totfaceOrig === bm.totface) {
        return {ok: false, error: 'No edges dissolved'}
    }
    return {ok: true, changed: true, regionOut: []}
}

/** RNA properties of `MESH_OT_dissolve_mode` (`editmesh_tools.cc:6303`). */
export interface DissolveModeSelectionOptions {
    /**
     * "Dissolve Vertices". When not given (`RNA_property_is_set` false) it is turned on unless face
     * select mode is on; given, it is used as is.
     */
    useVerts?: boolean
    /** "Angle Threshold" (edge select mode only). Radians, default pi. */
    angleThreshold?: number
    /** "Preserve Quads" (edge select mode only). Default true. */
    usePreserveQuads?: boolean
    /** "Face Split". Default false. */
    useFaceSplit?: boolean
    /** "Tear Boundary" (vertex select mode only). Default false. */
    useBoundaryTear?: boolean
}

/**
 * Edit-mode Dissolve Selection (X > Dissolve, Ctrl+X): `edbm_dissolve_mode_exec`
 * (`editmesh_tools.cc:6250`). Dispatches on `selectMode` (default `bm.selectMode`): vertex mode
 * dissolves vertices, else edge mode edges, else faces.
 */
export function dissolveModeSelection(
    bm: BMesh, selectMode: SelectModeMask = bm.selectMode, options: DissolveModeSelectionOptions = {},
): DissolveSelectionResult {
    let useVerts = options.useVerts
    if (useVerts === undefined) {
        // always enable in edge-mode (the RNA default, false, otherwise)
        useVerts = (selectMode & SelectMode.Face) === 0
    }

    if (selectMode & SelectMode.Vertex) {
        return dissolveVertsSelection(bm, {useFaceSplit: options.useFaceSplit, useBoundaryTear: options.useBoundaryTear})
    }
    if (selectMode & SelectMode.Edge) {
        return dissolveEdgesSelection(bm, {
            useVerts,
            angleThreshold: options.angleThreshold,
            useFaceSplit: options.useFaceSplit,
            usePreserveQuads: options.usePreserveQuads,
        })
    }
    return dissolveFacesSelection(bm, {useVerts})
}

// endregion

// Kept exported from here for existing importers.
export {vertIsEdgePair, facesJoinPair}
