/**
 * Welding: collapse a set of vertices onto chosen survivors, rebuilding the topology around them.
 *
 * Ported from `source/blender/bmesh/operators/bmo_removedoubles.cc` (`bmo_weld_verts_exec`,
 * `remdoubles_splitface`, `remdoubles_createface`). This is the operator Blender's mirror calls
 * directly, and the BMesh equivalent of the `geometry::mesh_merge_verts` the array modifier ends on.
 *
 * It is not the same thing as {@link mergeVerts}. `mergeVerts` is `bmo_pointmerge_exec`: it collapses
 * a group of vertices to a single point and rebuilds the faces around them with `faceCreate`, which
 * has no "does this face already exist" check. That is fine for its own use (merging a handful of
 * selected vertices) but wrong for a weld, where the two faces being brought together are usually
 * *coincident*: rebuilding the second one produces a duplicate face sitting exactly on the first.
 * `remdoubles_createface` looks the face up with {@link faceExists} first and reuses it, which is why
 * a welded chain of array copies has one interior face rather than two.
 *
 * Blender tracks the elements to remove with an operator flag layer (`ELE_DEL`, `EDGE_COL`). The
 * kernel has no operator flags yet, so the same bookkeeping is done with `Set`s. Nothing else about
 * the algorithm changes; in particular the order of the four passes (split, edges, faces, delete)
 * is load-bearing and is preserved.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, radialLoops} from '../bmesh/structure'
import {copyElemAttrs, interpElemAttrs} from '../bmesh/customdata'
import {faceVertShareLoop} from '../bmesh/walkers'
import {splitFaceMakeEdge} from '../bmesh/euler'
import {ElemFlag} from '../constants'

export interface WeldOptions {
    /**
     * Move each survivor to the centroid of itself and everything welded into it.
     * Blender's `use_centroid`; implies {@link averageVertData}.
     */
    useCentroid?: boolean
    /**
     * Blend the vertex attribute layers of a survivor with those of the vertices welded into it,
     * rather than keeping the survivor's own. Blender's `average_vert_data`.
     */
    averageVertData?: boolean
}

export interface WeldResult {
    /** Vertices that were removed - the keys of the target map. */
    killedVerts: BMVert[]
    /** Edges removed because both their ends collapsed together, or because they were rebuilt. */
    killedEdges: BMEdge[]
    /** Faces removed, either collapsed or replaced by a rebuilt one. */
    killedFaces: BMFace[]
    /** Edges created to span the survivors. */
    newEdges: BMEdge[]
    /** Faces rebuilt on the survivors. Does not include faces that already existed and were reused. */
    newFaces: BMFace[]
    /**
     * Removed edge to the edge that took its place, when that edge had to be created.
     * Part of Blender's `targetmap_all`, which it builds for the selection history remap.
     */
    edgeReplace: Map<BMEdge, BMEdge>
    /** Removed edge to a pre-existing edge that already spanned the survivors. */
    edgeReuse: Map<BMEdge, BMEdge>
    /** Removed face to the face rebuilt in its place. */
    faceReplace: Map<BMFace, BMFace>
    /**
     * Removed face to a pre-existing face that already had the welded corner loop - the coincident
     * face case that makes a weld a weld rather than a duplication.
     */
    faceReuse: Map<BMFace, BMFace>
}

/**
 * The face with exactly this vertex loop, in either winding direction, or null.
 *
 * Port of `BM_face_exists` (`bmesh_query.cc:1627`). Walks the disk of `varr[0]` and, for every loop
 * that starts there on a face of the right length, compares the remaining corners forwards and then
 * backwards - the winding of `varr` is not known, and a face that exists mirrored is still the same
 * face.
 */
export function faceExists(varr: readonly BMVert[]): BMFace | null {
    const len = varr.length
    if (len < 3 || !varr[0].e) return null

    for (const eIter of diskEdges(varr[0])) {
        if (!eIter.l) continue
        for (const lRadial of radialLoops(eIter)) {
            if (lRadial.v !== varr[0] || lRadial.f.len !== len) continue

            // The first vertex matches; check the rest, in whichever direction the second one lies.
            let iWalk = 2
            if (lRadial.next.v === varr[1]) {
                let lWalk = lRadial.next.next
                do {
                    if (lWalk.v !== varr[iWalk]) break
                    lWalk = lWalk.next
                } while (++iWalk !== len)
            } else if (lRadial.prev.v === varr[1]) {
                let lWalk = lRadial.prev.prev
                do {
                    if (lWalk.v !== varr[iWalk]) break
                    lWalk = lWalk.prev
                } while (++iWalk !== len)
            }

            if (iWalk === len) return lRadial.f
        }
    }
    return null
}

/** Blender's `BM_loop_is_adjacent` (`bmesh_query_inline.hh:127`): are two loops of a face neighbours? */
function loopIsAdjacent(lA: BMLoop, lB: BMLoop): boolean {
    return lB === lA.next || lB === lA.prev
}

/**
 * `BM_elem_flag_merge_ex`: union the two headers' flags, except that `hflagAnd` bits survive only if
 * both elements had them. Used so a weld does not randomly select or unhide the result.
 */
function elemFlagMergeEx(a: {hflag: number}, b: {hflag: number}, hflagAnd: number): void {
    if (((a.hflag & b.hflag) & hflagAnd) === 0) {
        a.hflag &= ~hflagAnd
        b.hflag &= ~hflagAnd
    }
    a.hflag = b.hflag = a.hflag | b.hflag
}

/**
 * Split a face whose own corners are about to be welded onto each other.
 *
 * Port of `remdoubles_splitface`. Without this, a face that has both a vertex and that vertex's weld
 * target among its corners (and they are not neighbours) would fold onto itself; Blender cuts it
 * along that pair first and recurses into both halves.
 */
function remdoublesSplitface(bm: BMesh, f: BMFace, targetmap: Map<BMVert, BMVert>): void {
    let lDouble: BMLoop | null = null
    let lTar: BMLoop | null = null

    for (const l of f.eachLoop()) {
        const vTar = targetmap.get(l.v)
        // A null lookup means this vertex is itself a target rather than a double.
        if (!vTar) continue
        const candidate = faceVertShareLoop(f, vTar)
        if (candidate && candidate !== l && !loopIsAdjacent(candidate, l)) {
            lDouble = l
            lTar = candidate
            break
        }
    }

    if (!lDouble || !lTar) return

    const {fNew} = splitFaceMakeEdge(bm, f, lDouble, lTar)
    remdoublesSplitface(bm, f, targetmap)
    remdoublesSplitface(bm, fNew, targetmap)
}

/**
 * Rebuild `f` with every welded corner replaced by its survivor.
 *
 * Port of `remdoubles_createface`. Corners whose mapped vertex equals the next corner's mapped
 * vertex collapse away; a vertex that would appear twice makes the face impossible, and Blender
 * bails rather than producing a self-touching n-gon. When the resulting loop already bounds a face,
 * that face is returned instead of a duplicate being made - see the note at the top of this file.
 */
function remdoublesCreateface(
    bm: BMesh, f: BMFace, targetmap: Map<BMVert, BMVert>, doomedVerts: Set<BMVert>,
): {face: BMFace | null, created: boolean} {
    const edges: BMEdge[] = []
    const verts: BMVert[] = []
    const loops: BMLoop[] = []
    const inFace = new Set<BMVert>()

    const mapVert = (l: BMLoop): {v: BMVert, isDel: boolean} => {
        const isDel = doomedVerts.has(l.v)
        return {v: isDel ? targetmap.get(l.v)! : l.v, isDel}
    }

    const lFirst = f.lFirst
    let lCurr = lFirst
    let curr = mapVert(lCurr)
    let bailed = false

    do {
        const lNext = lCurr.next
        const next = mapVert(lNext)

        let eNew: BMEdge | null
        if (!curr.isDel && !next.isDel) {
            // Neither end moved, so the original edge still spans this corner pair.
            eNew = lCurr.e
        } else if (curr.v === next.v) {
            eNew = null // The corner collapsed away.
        } else {
            eNew = diskEdgeExists(curr.v, next.v)
        }

        if (eNew) {
            if (inFace.has(curr.v)) {
                // The face would use a vertex twice; it cannot be made.
                edges.length = 0
                bailed = true
                break
            }
            inFace.add(curr.v)
            edges.push(eNew)
            loops.push(lCurr)
            verts.push(curr.v)
        }

        curr = next
        lCurr = lNext
    } while (lCurr !== lFirst)

    if (bailed || edges.length < 3) return {face: null, created: false}

    const existing = faceExists(verts)
    if (existing) return {face: existing, created: false}

    const fNew = bm.faceCreateWithEdges(verts, edges, f)
    const dstLoops = [...fNew.eachLoop()]
    for (let i = 0; i < dstLoops.length; i++) copyElemAttrs(loops[i], dstLoops[i], bm.ldata)
    return {face: fNew, created: true}
}

/**
 * Weld each key of `targetmap` onto its value.
 *
 * Port of `bmo_weld_verts_exec` (`bmo_removedoubles.cc:181`). The map must be flat: Blender's
 * callers resolve chains (`a -> b -> c`) before calling, and so must ours. Self-mappings are
 * ignored rather than deleting the vertex, which is what every caller means by them.
 *
 * The four passes are Blender's, in Blender's order:
 * 1. split any face that has both a double and its target among its own corners,
 * 2. remap the edges, collapsing those whose two ends now coincide,
 * 3. rebuild every face that used a double, reusing an existing face where one is already there,
 * 4. delete the doubles and everything tagged along the way.
 */
export function weldVerts(
    bm: BMesh, targetmap: Map<BMVert, BMVert>, options: WeldOptions = {},
): WeldResult {
    const useCentroid = options.useCentroid === true
    const averageVertData = options.averageVertData === true || useCentroid

    const result: WeldResult = {
        killedVerts: [], killedEdges: [], killedFaces: [], newEdges: [], newFaces: [],
        edgeReplace: new Map(), edgeReuse: new Map(),
        faceReplace: new Map(), faceReuse: new Map(),
    }

    // Pass 0: mark the doubles for deletion and merge their header flags into the survivor, "else we
    // get randomly selected/unselected verts".
    const doomedVerts = new Set<BMVert>()
    const clusters = new Map<BMVert, BMVert[]>()
    for (const [v, vDst] of targetmap) {
        if (v === vDst) continue
        if (!bm.verts.has(v) || !bm.verts.has(vDst)) continue
        doomedVerts.add(v)
        elemFlagMergeEx(v, vDst, ElemFlag.Hidden)
        if (averageVertData) {
            const group = clusters.get(vDst)
            if (group) group.push(v)
            else clusters.set(vDst, [v])
        }
    }
    if (!doomedVerts.size) return result

    if (useCentroid) {
        for (const [vDst, cluster] of clusters) {
            let x = vDst.x, y = vDst.y, z = vDst.z
            for (const v of cluster) {
                x += v.x
                y += v.y
                z += v.z
            }
            const n = cluster.length + 1
            vDst.setCo(x / n, y / n, z / n)
        }
    }

    if (averageVertData) {
        for (const [vDst, cluster] of clusters) {
            const sources = [vDst, ...cluster]
            const w = 1 / sources.length
            interpElemAttrs(vDst, sources, sources.map(() => w), bm.vdata)
        }
    }

    // Pass 1: "Check if any faces are getting their own corners merged together, split face if so."
    for (const f of [...bm.faces]) remdoublesSplitface(bm, f, targetmap)

    // Pass 2: remap the edges. An edge whose two ends land on the same survivor collapses; otherwise
    // the survivors get an edge (reused if one is already there) and the original is tagged.
    const collapsedEdges = new Set<BMEdge>()
    const doomedEdges = new Set<BMEdge>()
    for (const e of [...bm.edges]) {
        let v1 = e.v1
        let v2 = e.v2
        const isDelV1 = doomedVerts.has(v1)
        const isDelV2 = doomedVerts.has(v2)
        if (!isDelV1 && !isDelV2) continue

        if (isDelV1) v1 = targetmap.get(v1)!
        if (isDelV2) v2 = targetmap.get(v2)!

        if (v1 === v2) {
            collapsedEdges.add(e)
        } else {
            let eNew = diskEdgeExists(v1, v2)
            if (!eNew) {
                eNew = bm.edgeCreate(v1, v2, e)
                result.newEdges.push(eNew)
                result.edgeReplace.set(e, eNew)
            } else {
                result.edgeReuse.set(e, eNew)
            }
            // "Always merge flags, even for edges we already created."
            elemFlagMergeEx(eNew, e, ElemFlag.Hidden)
        }
        doomedEdges.add(e)
    }

    // Pass 3: "Faces get modified by creating new faces here, then at the end the old faces are
    // deleted." A face survives untouched only when none of its corners moved.
    const doomedFaces = new Set<BMFace>()
    for (const f of [...bm.faces]) {
        let vertDelete = false
        let edgeCollapse = 0
        for (const l of f.eachLoop()) {
            if (doomedVerts.has(l.v)) vertDelete = true
            if (l.e && collapsedEdges.has(l.e)) edgeCollapse++
        }
        if (!vertDelete) continue

        doomedFaces.add(f)
        if (f.len - edgeCollapse < 3) continue

        const {face: fNew, created} = remdoublesCreateface(bm, f, targetmap, doomedVerts)
        if (!fNew) continue
        if (created) {
            // Blender swaps the two faces' data so the original pointer survives and kills the new
            // one, purely to avoid returning a list of created faces. The kernel returns that list,
            // so the new face is kept and the original is deleted; the resulting topology is the same.
            result.newFaces.push(fNew)
            result.faceReplace.set(f, fNew)
        } else {
            elemFlagMergeEx(fNew, f, ElemFlag.Hidden)
            result.faceReuse.set(f, fNew)
        }
        if (bm.actFace === f) bm.actFace = fNew
    }

    // Pass 4: `BMO_mesh_delete_oflag_context(bm, ELE_DEL, DEL_ONLYTAGGED)` - faces, then edges,
    // then vertices, each only if tagged.
    for (const f of doomedFaces) {
        if (!bm.faces.has(f)) continue
        bm.faceKill(f)
        result.killedFaces.push(f)
    }
    for (const e of doomedEdges) {
        if (!bm.edges.has(e)) continue
        bm.edgeKill(e)
        result.killedEdges.push(e)
    }
    for (const v of doomedVerts) {
        if (!bm.verts.has(v)) continue
        bm.vertKill(v)
        result.killedVerts.push(v)
    }

    return result
}
