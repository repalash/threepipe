/**
 * Dissolving edges and vertices: removing them while merging the faces around them.
 *
 * Ported from `source/blender/bmesh/operators/bmo_dissolve.cc` (`bmo_dissolve_edges_exec`,
 * `bmo_dissolve_verts_exec`, `bmo_find_end_of_chain`, `bmo_vert_touches_unselected_face`,
 * `bmo_vert_tagged_edges_count_at_most`, `bm_vert_collapse_edge_and_merge`) and
 * `bmesh_mods.cc` (`BM_faces_join_pair`). Face dissolve is in `dissolve.ts`; this file is separate so
 * it merges cleanly with the selection work happening in the kernel at the same time.
 *
 * What is ported and what is not, so nothing here is an approximation of something else:
 * - `dissolve_edges` with `use_verts` (Blender's default for Ctrl+X) and `angle_threshold` at its
 *   `bmo_dissolve_edges_init` default of 180°, where Blender skips the angle test
 *   (`dissolve_all`). `use_face_split` and `use_preserve_quads` are not ported: they are off in the
 *   edit-mode operator's defaults, and `bm_face_split` has no other caller yet.
 * - `dissolve_verts` without `use_face_split` and `use_boundary_tear`, likewise off by default.
 *
 * Blender's operator flags (`EDGE_TAG`, `EDGE_CHAIN`, `EDGE_ISGC`, `VERT_ISGC`, `VERT_MARK`,
 * `VERT_MARK_PAIR`) are sets here; `BMO_*_flag_enable/test` become `add`/`has`.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, edgeIsWire, radialLoops, vertEdges} from '../bmesh/structure'
import {loopReverse} from '../bmesh/flip'
import {facesJoin} from './dissolve'
import {joinEdgeKillVert} from '../bmesh/euler'

/** `BM_vert_is_edge_pair` (`bmesh_query.cc:580`): exactly two edges meet at `v`. */
export function vertIsEdgePair(v: BMVert): boolean {
    const e = v.e
    if (!e) return false
    let n = 0
    for (const _ of diskEdges(v)) if (++n > 2) return false
    return n === 2
}

/** `BM_edge_loop_pair`: the two loops of an edge with exactly two faces, else null. */
function edgeLoopPair(e: BMEdge): [BMLoop, BMLoop] | null {
    const a = e.l
    if (!a) return null
    const b = a.radialNext
    if (!b || b === a || b.radialNext !== a) return null
    return [a, b]
}

/** `BM_edge_face_pair`: the two faces of a manifold edge, else null. */
function edgeFacePair(e: BMEdge): [BMFace, BMFace] | null {
    const pair = edgeLoopPair(e)
    return pair ? [pair[0].f, pair[1].f] : null
}

/** `BM_DISK_EDGE_NEXT(e, v)` at a two-edge vertex: the other edge. */
function otherDiskEdge(e: BMEdge, v: BMVert): BMEdge {
    for (const x of diskEdges(v)) if (x !== e) return x
    return e
}

/** `BM_loop_other_edge_loop(l, v)`: the loop of the same face whose edge is the other one at `v`. */
function loopOtherEdgeLoop(l: BMLoop, v: BMVert): BMLoop {
    return l.v === v ? l.prev! : l.next!
}

/** Blender's `BM_LOOPS_OF_VERT`: one loop per face around `v`, the one whose `v` is `v`. */
function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    for (const e of diskEdges(v)) {
        for (const l of radialLoops(e)) if (l.v === v) yield l
    }
}

/**
 * `BM_faces_join_pair` (`bmesh_mods.cc:193`): join the two faces across one edge. When the faces
 * wind the same way along the shared edge (`l_a->v == l_b->v`) the second is reversed first, so
 * the join sees a consistent boundary.
 */
export function facesJoinPair(bm: BMesh, lA: BMLoop, lB: BMLoop, doDel: boolean): BMFace | null {
    if (lA.v === lB.v) loopReverse(lB.f)
    return facesJoin(bm, [lA.f, lB.f], doDel)
}

/**
 * Walk a chain of two-edge vertices from `v` away from `e`, marking the edges walked in `mark`.
 * Returns the vertex where the chain ends, or null when the walk reaches an edge that is already
 * marked (processed before) or loops back on itself. `bmo_find_end_of_chain` (`bmo_dissolve.cc:370`).
 */
function findEndOfChain(e: BMEdge, v: BMVert, mark: Set<BMEdge> | null): BMVert | null {
    const vInit = v
    while (vertIsEdgePair(v)) {
        e = otherDiskEdge(e, v)
        v = e.otherVert(v)
        if (mark) {
            if (mark.has(e)) return null
            mark.add(e)
        }
        if (v === vInit) return null
    }
    return v
}

/**
 * Does dissolving `v` alter a face none of whose edges at `v` is tagged? True at a quad corner that a
 * dissolve edge merely touches; false at a T-junction on a loop cut.
 * `bmo_vert_touches_unselected_face` (`bmo_dissolve.cc:402`).
 */
function vertTouchesUnselectedFace(v: BMVert, edgeTag: Set<BMEdge>, vertMark: Set<BMVert>): boolean {
    if (vertMark.has(v)) return false
    for (const lA of loopsOfVert(v)) {
        const lB = loopOtherEdgeLoop(lA, v)
        if (!edgeTag.has(lA.e!) && !edgeTag.has(lB.e!)) return true
    }
    return false
}

/** `bmo_vert_tagged_edges_count_at_most` (`bmo_dissolve.cc:426`). */
function vertTaggedEdgesCountAtMost(v: BMVert, tag: Set<BMEdge>, max: number): number {
    let n = 0
    for (const e of diskEdges(v)) {
        if (tag.has(e)) n++
        if (n === max) return n
    }
    return n
}

export interface DissolveEdgesOptions {
    /**
     * Also dissolve the vertices the edges leave with only two edges (so a dissolved loop cut
     * leaves no stray vertices on the neighbouring edges). Blender's `use_verts`, default on.
     */
    useVerts?: boolean
}

/**
 * Dissolve edges: merge the face pair on either side of each edge, then clean up what the merges
 * left loose. Returns how many of the given edges were dissolved.
 *
 * Port of `bmo_dissolve_edges_exec` (`bmo_dissolve.cc:455`) at `angle_threshold = 180°`, where
 * every marked vertex dissolves without the angle test (`dissolve_all`). Edges with other than two
 * faces (boundary, wire, non-manifold) are left alone, as Blender leaves them.
 */
export function dissolveEdges(bm: BMesh, edges: readonly BMEdge[], options: DissolveEdgesOptions = {}): number {
    const useVerts = options.useVerts ?? true
    const edgeTag = new Set<BMEdge>(useVerts ? edges : [])
    const edgeChain = new Set<BMEdge>()
    const edgeIsgc = new Set<BMEdge>()
    const vertIsgc = new Set<BMVert>()
    const vertMark = new Set<BMVert>()

    // Tag the geometry around the selected edges for the later cleanup, and extend the tag along
    // chains of two-edge vertices, which dissolve whole.
    for (const e of edges) {
        if (vertIsEdgePair(e.v1) || vertIsEdgePair(e.v2)) edgeChain.add(e)
        const pair = edgeFacePair(e)
        if (!pair) continue
        for (const f of pair) {
            for (const l of f.eachLoop()) {
                vertIsgc.add(l.v)
                edgeIsgc.add(l.e!)
            }
        }
        if (useVerts && edgeChain.has(e)) {
            findEndOfChain(e, e.v1, edgeTag)
            findEndOfChain(e, e.v2, edgeTag)
        }
    }

    // Mark the vertices that should dissolve once the edges have gone.
    if (useVerts) {
        for (const e of edges) {
            if (!edgeFacePair(e)) continue
            for (let vEdge of [e.v1, e.v2] as (BMVert | null)[]) {
                if (vertIsEdgePair(vEdge!)) vEdge = findEndOfChain(e, vEdge!, edgeChain)
                if (!vEdge) continue
                if (vertTouchesUnselectedFace(vEdge, edgeTag, vertMark) && vertTaggedEdgesCountAtMost(vEdge, edgeTag, 2) !== 1) continue
                vertMark.add(vEdge)
            }
        }
    }

    // Merge any face pairs that straddle a selected edge.
    let dissolved = 0
    for (const e of edges) {
        if (!bm.edges.has(e)) continue
        const pair = edgeLoopPair(e)
        if (!pair) continue
        if (facesJoinPair(bm, pair[0], pair[1], false)) dissolved++
    }

    // Cleanup: edges the merges left without faces, then vertices left without edges.
    for (const e of [...bm.edges]) if (!e.l && edgeIsgc.has(e)) bm.edgeKill(e)
    for (const v of [...bm.verts]) if (!v.e && vertIsgc.has(v)) bm.vertKill(v)

    // Dissolve the marked vertices that are now two-edge vertices, in a separate pass as Blender
    // does, so one collapse cannot change what the next one sees. `angle_threshold` is 180°, so
    // there is no angle test to apply.
    if (useVerts) {
        for (const v of [...bm.verts]) {
            if (!vertMark.has(v) || !vertIsEdgePair(v)) continue
            joinEdgeKillVert(bm, v.e!, v)
        }
    }
    return dissolved
}

/**
 * Dissolve vertices: merge every face around each vertex into one, then remove the vertex.
 * Returns how many vertices were dissolved.
 *
 * Port of `bmo_dissolve_verts_exec` (`bmo_dissolve.cc:695`) without `use_face_split` and
 * `use_boundary_tear`. A vertex on only two edges is collapsed out of its edge chain instead of
 * merging faces, as `VERT_MARK_PAIR` arranges.
 */
export function dissolveVerts(bm: BMesh, verts: readonly BMVert[]): number {
    const vertIsgc = new Set<BMVert>(verts)
    const edgeIsgc = new Set<BMEdge>()

    for (const v of verts) {
        let eFirst: BMEdge | null = null
        for (const lFirst of loopsOfVert(v)) {
            for (const l of lFirst.f.eachLoop()) {
                vertIsgc.add(l.v)
                edgeIsgc.add(l.e!)
            }
            eFirst = lFirst.e
        }
        // Wire edges at the vertex go first; `e_first` has a face so it will not be killed here.
        if (eFirst) {
            for (const e of [...diskEdges(v)]) if (edgeIsWire(e)) bm.edgeKill(e)
        }
    }

    // Tag here so the topology checks are not fed back by the edits below.
    const markPair = new Set<BMVert>(verts.filter(vertIsEdgePair))

    for (const v of verts) {
        if (markPair.has(v)) continue
        // Merge across every edge that touches `v`, one `BM_faces_join_pair` per edge.
        for (const e of vertEdges(v)) {
            if (!bm.edges.has(e)) continue
            const pair = edgeLoopPair(e)
            if (pair) facesJoinPair(bm, pair[0], pair[1], false)
        }
    }

    // Cleanup, in a separate pass since the joins remove geometry the loops above walk.
    for (const e of [...bm.edges]) if (!e.l && edgeIsgc.has(e)) bm.edgeKill(e)

    let dissolved = 0
    for (const v of verts) {
        if (!bm.verts.has(v)) {
            dissolved++
            continue
        }
        if (vertIsEdgePair(v) && joinEdgeKillVert(bm, v.e!, v)) dissolved++
    }
    for (const v of [...bm.verts]) if (!v.e && vertIsgc.has(v)) bm.vertKill(v)
    for (const v of verts) if (!bm.verts.has(v)) dissolved = Math.max(dissolved, 1)
    return dissolved
}
