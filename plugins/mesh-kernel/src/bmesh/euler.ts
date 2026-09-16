/**
 * Euler operators - the kernel operations every higher-level mesh operator is built from.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_core.cc`. Each one takes the mesh from one valid
 * state to another while preserving the Euler characteristic, which is why Blender calls them Euler
 * operators. Extrude, inset, subdivide, dissolve, knife and bevel are all compositions of these.
 *
 * | here | Blender | what it does |
 * | --- | --- | --- |
 * | {@link splitEdgeMakeVert} | `bmesh_kernel_split_edge_make_vert` (SEMV) | insert a vertex into an edge, splitting every face that used it |
 * | {@link joinEdgeKillVert} | `bmesh_kernel_join_edge_kill_vert` (JEKV) | the inverse: dissolve a valence-2 vertex |
 * | {@link splitFaceMakeEdge} | `bmesh_kernel_split_face_make_edge` (SFME) | cut a face in two along a new edge |
 * | {@link joinFaceKillEdge} | `bmesh_kernel_join_face_kill_edge` (JFKE) | the inverse: merge two faces by dissolving their shared edge |
 *
 * These are low-level: they assume their preconditions and do not flush selection or recalculate
 * normals. Callers in the operator layer are responsible for that, exactly as in Blender.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from './types'
import {BMesh} from './BMesh'
import {
    diskEdgeAppend,
    diskEdgeRemove,
    diskEdges,
    diskVertReplace,
    edgeIsManifold,
    radialLoopAppend,
    radialLoopRemove,
    radialLoops,
} from './structure'
import {copyElemAttrs, interpElemAttrsMidpoint} from './customdata'

/** Remove a loop from its radial cycle without clearing `l.e`. Blender's `bmesh_radial_loop_unlink`. */
function radialLoopUnlink(l: BMLoop): void {
    if (l.radialNext !== l) {
        l.radialNext!.radialPrev = l.radialPrev
        l.radialPrev!.radialNext = l.radialNext
    }
    l.radialNext = null
    l.radialPrev = null
}

/** The loop of `f` that runs along `e`, or null. Blender's `BM_face_edge_share_loop`. */
export function faceEdgeShareLoop(f: BMFace, e: BMEdge): BMLoop | null {
    if (!e.l) return null
    const first = e.l
    let l: BMLoop = first
    do {
        if (l.f === f) return l
        l = l.radialNext!
    } while (l !== first)
    return null
}

/** True when `e` is one of the edges of `f`. Blender's `BM_edge_in_face`. */
export function edgeInFace(e: BMEdge, f: BMFace): boolean {
    for (const l of f.eachLoop()) if (l.e === e) return true
    return false
}

/** How many edges the two faces share. Blender's `BM_face_share_edge_count`. */
export function faceShareEdgeCount(f1: BMFace, f2: BMFace): number {
    let count = 0
    for (const l of f1.eachLoop()) {
        if (l.e && edgeInFace(l.e, f2)) count++
    }
    return count
}

export interface SplitEdgeResult {
    /** The vertex inserted into the edge. */
    vNew: BMVert
    /** The new edge, running from the original `tv` to {@link vNew}. */
    eNew: BMEdge
}

/**
 * Insert a vertex into `e`, splitting every face that used it.
 *
 * `tv` must be one of the edge's endpoints; the new vertex is inserted between `tv` and the other
 * end, and `e` keeps the far end. Every loop in the edge's radial cycle is split in two, so each
 * adjacent face gains one corner.
 *
 * Port of `bmesh_kernel_split_edge_make_vert` (`bmesh_core.cc:1646`). The new vertex is placed at
 * `tv`'s position by Blender; pass `factor` to interpolate along the edge instead, which is what
 * subdivide wants.
 */
export function splitEdgeMakeVert(bm: BMesh, e: BMEdge, tv: BMVert, factor?: number): SplitEdgeResult {
    if (!e.uses(tv)) throw new Error(`mesh-kernel: edge ${e.id} does not use vertex ${tv.id}`)
    const vOld = e.otherVert(tv)

    // Blender creates the new vertex at tv's position and leaves moving it to the caller.
    const vNew = bm.vertCreate(tv.x, tv.y, tv.z, tv)
    // Keep the new edge's vertex order matching the original, so extruded faces do not flip.
    const eNew = bm.edgeCreate(tv, vNew, e)

    // edgeCreate already linked eNew into both disk cycles; Blender unlinks, rewires, then relinks.
    diskEdgeRemove(eNew, tv)
    diskEdgeRemove(eNew, vNew)

    diskVertReplace(e, vNew, tv)

    diskEdgeAppend(eNew, vNew)
    diskEdgeAppend(eNew, tv)

    if (factor !== undefined) {
        vNew.x = tv.x + (vOld.x - tv.x) * factor
        vNew.y = tv.y + (vOld.y - tv.y) * factor
        vNew.z = tv.z + (vOld.z - tv.z) * factor
        interpElemAttrsMidpoint(vNew, tv, vOld, bm.vdata, factor)
    }

    // Split the radial cycle: each existing loop becomes two, one per half of the edge.
    let lNext = e.l
    e.l = null
    if (lNext) {
        let isFirst = true
        while (lNext) {
            const l: BMLoop = lNext
            l.f.len++
            lNext = lNext !== lNext.radialNext ? lNext.radialNext : null
            radialLoopUnlink(l)

            const lNew = new BMLoop(bm.nextId(), vNew, null, l.f)
            bm.loops.add(lNew)
            copyElemAttrs(l, lNew, bm.ldata)

            lNew.prev = l
            lNew.next = l.next
            lNew.prev.next = lNew
            lNew.next.prev = lNew
            lNew.v = vNew

            // Give each half-loop the edge it actually spans.
            if (e.joins(lNew.v, lNew.next.v)) {
                lNew.e = null
                l.e = null
                if (isFirst) {
                    isFirst = false
                    l.radialNext = null
                    l.radialPrev = null
                }
                radialLoopAppend(e, lNew)
                radialLoopAppend(eNew, l)
            } else if (eNew.joins(lNew.v, lNew.next.v)) {
                lNew.e = null
                l.e = null
                if (isFirst) {
                    isFirst = false
                    l.radialNext = null
                    l.radialPrev = null
                }
                radialLoopAppend(eNew, lNew)
                radialLoopAppend(e, l)
            } else {
                throw new Error(`mesh-kernel: split of edge ${e.id} left loop ${lNew.id} spanning neither half`)
            }
        }
    }

    return {vNew, eNew}
}

/**
 * Dissolve a valence-2 vertex, merging its two edges into one. The inverse of
 * {@link splitEdgeMakeVert}.
 *
 * `eKill` is removed and `vKill` with it; the surviving edge is returned. Returns null when the
 * precondition fails, rather than corrupting the mesh: `vKill` must have exactly two edges, and the
 * two edges must not already share their far endpoints.
 *
 * Port of `bmesh_kernel_join_edge_kill_vert` (`bmesh_core.cc:1799`), simplified to the case the
 * operator layer needs. Blender's version additionally handles killing the *other* edge and faces of
 * length 3 collapsing; those paths are added when an operator needs them.
 */
export function joinEdgeKillVert(bm: BMesh, eKill: BMEdge, vKill: BMVert): BMEdge | null {
    if (!eKill.uses(vKill)) return null

    // vKill must be used by exactly two edges for the join to be well defined.
    let valence = 0
    let eOther: BMEdge | null = null
    for (const e of diskEdges(vKill)) {
        valence++
        if (e !== eKill) eOther = e
    }
    if (valence !== 2 || !eOther) return null

    const vTarget = eKill.otherVert(vKill)
    const vFar = eOther.otherVert(vKill)
    if (vTarget === vFar) return null // would collapse to a degenerate edge

    // Dissolving the vertex removes one corner from each adjacent face, so a triangle would
    // collapse to a degenerate two-corner face.
    for (const l of radialLoops(eKill)) {
        if (l.f.len <= 3) return null
    }

    // Drop one loop per adjacent face: the one sitting at vKill.
    for (const l of [...radialLoops(eKill)]) {
        const f = l.f
        // A loop spans (l.v, l.next.v). The radial loops of eKill span vKill and vTarget, so the
        // loop positioned *at* vKill is either this one or the next.
        const lDrop = l.v === vKill ? l : l.next
        const lPrev = lDrop.prev
        const lNext = lDrop.next

        lPrev.next = lNext
        lNext.prev = lPrev
        if (f.lFirst === lDrop) f.lFirst = lNext
        f.len--

        // radialLoopRemove, not radialLoopUnlink: the dropped loop may be the one its edge's `l`
        // points at, and unlink leaves that pointer dangling. This was a real bug, caught only by
        // the exhaustive split-then-rejoin test - the common configurations happen to be safe.
        if (lDrop.e) radialLoopRemove(lDrop.e, lDrop)
        bm.loops.delete(lDrop)

        // Whichever edge the surviving loop referenced, it now spans the merged edge.
        lPrev.e = eOther
    }

    // Detach eKill entirely, then move eOther onto the target vertex.
    diskEdgeRemove(eKill, eKill.v1)
    diskEdgeRemove(eKill, eKill.v2)
    bm.edges.delete(eKill)

    diskVertReplace(eOther, vTarget, vKill)
    bm.verts.delete(vKill)

    return eOther
}

export interface SplitFaceResult {
    /** The face that was split off. The original face keeps its identity. */
    fNew: BMFace
    /** The edge created between the two loops. */
    eNew: BMEdge
}

/**
 * Cut `f` in two along a new edge joining the vertices of `lv1` and `lv2`.
 *
 * Both loops must belong to `f` and must not be adjacent, or the "split" would produce a degenerate
 * face. The original face keeps the part containing `lv1`'s side; a new face is returned for the rest.
 *
 * Port of `bmesh_kernel_split_face_make_edge` (`bmesh_core.cc:1507`).
 */
export function splitFaceMakeEdge(bm: BMesh, f: BMFace, lv1: BMLoop, lv2: BMLoop): SplitFaceResult {
    if (lv1.f !== f || lv2.f !== f) {
        throw new Error(`mesh-kernel: both loops must belong to face ${f.id}`)
    }
    if (lv1 === lv2) throw new Error('mesh-kernel: cannot split a face along a single loop')
    if (lv1.next === lv2 || lv2.next === lv1) {
        throw new Error('mesh-kernel: cannot split a face between adjacent loops; the result would be degenerate')
    }

    const v1 = lv1.v
    const v2 = lv2.v
    const eNew = bm.edgeCreate(v1, v2)

    const fNew = new BMFace(bm.nextId())
    fNew.hflag = f.hflag
    fNew.matNr = f.matNr
    copyElemAttrs(f, fNew, bm.pdata)

    const lF1 = new BMLoop(bm.nextId(), v2, eNew, f)
    const lF2 = new BMLoop(bm.nextId(), v1, eNew, fNew)
    bm.loops.add(lF1)
    bm.loops.add(lF2)
    copyElemAttrs(lv2, lF1, bm.ldata)
    copyElemAttrs(lv1, lF2, bm.ldata)

    lF1.prev = lv2.prev
    lF2.prev = lv1.prev
    lv2.prev.next = lF1
    lv1.prev.next = lF2

    lF1.next = lv1
    lF2.next = lv2
    lv1.prev = lF1
    lv2.prev = lF2

    // Decide which half keeps the original first loop, preserving corner order where possible.
    let firstLoopInF1 = false
    {
        let iter: BMLoop = lF1
        do {
            if (iter === f.lFirst) {
                firstLoopInF1 = true
                break
            }
            iter = iter.next
        } while (iter !== lF1)
    }

    if (firstLoopInF1) {
        if (f.lFirst.prev === lF1) fNew.lFirst = lF2.prev
        else if (f.lFirst.next === lF1) fNew.lFirst = lF2.next
        else fNew.lFirst = lF2
    } else {
        fNew.lFirst = f.lFirst
        if (f.lFirst.prev === lF2) f.lFirst = lF1.prev
        else if (f.lFirst.next === lF2) f.lFirst = lF1.next
        else f.lFirst = lF1
    }

    // Re-home every loop of the new face and count both cycles.
    let f2len = 0
    {
        let iter: BMLoop = fNew.lFirst
        do {
            iter.f = fNew
            f2len++
            iter = iter.next
        } while (iter !== fNew.lFirst)
    }

    // The new loops only join the radial cycle once their faces are settled.
    lF1.e = null
    lF2.e = null
    radialLoopAppend(eNew, lF1)
    radialLoopAppend(eNew, lF2)

    fNew.len = f2len

    let f1len = 0
    {
        let iter: BMLoop = f.lFirst
        do {
            f1len++
            iter = iter.next
        } while (iter !== f.lFirst)
    }
    f.len = f1len

    bm.faces.add(fNew)
    return {fNew, eNew}
}

/**
 * Merge `f1` and `f2` by dissolving the edge they share, returning the surviving face.
 *
 * Returns null instead of corrupting the mesh when the join is not legal. Blender's checks, all kept:
 * the faces must differ, the edge must be manifold and present in both, the two loops must run in
 * opposite directions, neither face may contain the other's neighbouring edges, the faces must share
 * exactly one edge, and the join must not produce a repeated vertex.
 *
 * Port of `bmesh_kernel_join_face_kill_edge` (`bmesh_core.cc:2049`).
 */
export function joinFaceKillEdge(bm: BMesh, f1: BMFace, f2: BMFace, e: BMEdge): BMFace | null {
    if (f1 === f2) return null
    if (!edgeIsManifold(e)) return null

    const lF1 = faceEdgeShareLoop(f1, e)
    const lF2 = faceEdgeShareLoop(f2, e)
    if (!lF1 || !lF2) return null

    // Opposite winding: if both loops start at the same vertex the faces disagree on orientation.
    if (lF1.v === lF2.v) return null

    if (edgeInFace(lF1.next.e!, f2) || edgeInFace(lF1.prev.e!, f2)
        || edgeInFace(lF2.next.e!, f1) || edgeInFace(lF2.prev.e!, f1)) {
        return null
    }

    if (faceShareEdgeCount(f1, f2) > 1) return null

    // A vertex appearing in both rims (other than the shared edge's own) would repeat in the result.
    {
        const seen = new Set<BMVert>()
        for (const l of f1.eachLoop()) if (l !== lF1) seen.add(l.v)
        for (const l of f2.eachLoop()) {
            if (l !== lF2 && seen.has(l.v)) return null
        }
    }

    // Splice the two loop cycles together across the shared edge.
    lF1.prev.next = lF2.next
    lF2.next.prev = lF1.prev
    lF1.next.prev = lF2.prev
    lF2.prev.next = lF1.next

    if (f1.lFirst === lF1) f1.lFirst = lF1.next

    f1.len += f2.len - 2

    let iter: BMLoop = f1.lFirst
    for (let i = 0; i < f1.len; i++) {
        iter.f = f1
        iter = iter.next
    }

    // Drop the shared edge and the two loops that ran along it.
    radialLoopUnlink(lF1)
    radialLoopUnlink(lF2)
    diskEdgeRemove(e, e.v1)
    diskEdgeRemove(e, e.v2)
    bm.edges.delete(e)
    bm.loops.delete(lF1)
    bm.loops.delete(lF2)
    if (bm.actFace === f2) bm.actFace = f1
    bm.faces.delete(f2)

    return f1
}
