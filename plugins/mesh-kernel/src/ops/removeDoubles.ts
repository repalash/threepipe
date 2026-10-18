/**
 * Merge vertices that sit on top of each other - Blender's "Merge by Distance".
 *
 * Ported from `bmo_removedoubles.cc`: `bmesh_find_doubles_by_distance_impl` (`:688`),
 * `bmesh_find_doubles_by_distance_connected_impl` (`:763`), `bmesh_find_doubles_common` (`:856`) and
 * `bmo_remove_doubles_exec` (`:911`).
 *
 * The finding and the welding are deliberately separate, as they are in Blender: `findDoubles*`
 * builds a target map and `weldVerts` applies it, so a caller can inspect or filter what is about to
 * be merged. `removeDoubles` is the two together.
 *
 * Two ways to find them, and the difference matters. The plain distance search merges anything within
 * range of anything else, which is what you want after an import that split vertices at every UV
 * seam. The **connected** search only follows edges and face corners out from each vertex, so two
 * surfaces that happen to touch are left alone - which is what you want after joining parts that
 * overlap, where merging across the join would weld unrelated geometry together.
 */

import {BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, radialLoops} from '../bmesh/structure'
import {ElemFlag} from '../constants'
import {weldVerts, WeldResult} from './weld'

export interface RemoveDoublesOptions {
    /** Merge distance. Blender's `dist`, default 0.0001 as in the operator. */
    distance?: number
    /** Only follow edges and face corners, rather than searching all of space. Blender's `use_connected`. */
    useConnected?: boolean
    /** Vertices that must survive a merge rather than being merged away. Blender's `keep_verts`. */
    keepVerts?: Iterable<BMVert>
    /** Select the surviving vertices. */
    selectResult?: boolean
}

const distSquared = (a: BMVert, b: BMVert): number =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2

/**
 * Given a cluster of coincident vertices, which one survives.
 *
 * `deduplicate_target_calc_fn` (`bmo_removedoubles.cc:714`) verbatim: a pair keeps the lower index
 * for stability, and a larger cluster keeps whichever member is closest to the cluster's centroid,
 * again breaking ties on the lower index. The search starts from the last entry because that is
 * where the search originated and so is the likeliest answer.
 */
function clusterTarget(verts: BMVert[], cluster: number[]): number {
    if (cluster.length === 2) return cluster[0] < cluster[1] ? 0 : 1

    let cx = 0, cy = 0, cz = 0
    for (const ci of cluster) {
        cx += verts[ci].x
        cy += verts[ci].y
        cz += verts[ci].z
    }
    cx /= cluster.length
    cy /= cluster.length
    cz /= cluster.length

    const end = cluster.length - 1
    const dsq = (i: number) => {
        const v = verts[cluster[i]]
        return (v.x - cx) ** 2 + (v.y - cy) ** 2 + (v.z - cz) ** 2
    }
    let iBest = end
    let best = dsq(iBest)
    for (let i = 0; i < end; i++) {
        const test = dsq(i)
        if (test > best) continue
        if (test === best && cluster[i] > cluster[iBest]) continue
        iBest = i
        best = test
    }
    return iBest
}

/**
 * Map every vertex within `dist` of another onto the one that survives.
 *
 * Port of `bmesh_find_doubles_by_distance_impl` and the second pass of `kdtree_calc_duplicates_cb`
 * (`BLI_kdtree.hh:802`) that drives it. The KD-tree is replaced by a direct range scan: the tree is a
 * lookup structure, not part of the algorithm, and `duplicates_cb` sees the same candidate set either
 * way. The survivor choice is Blender's, so a cluster keeps the member Blender would keep.
 */
export function findDoublesByDistance(
    verts: BMVert[], dist: number, keepVerts?: Set<BMVert>,
): Map<BMVert, BMVert> {
    const n = verts.length
    const duplicates: number[] = new Array(n)
    for (let i = 0; i < n; i++) duplicates[i] = keepVerts?.has(verts[i]) ? i : -1
    const distSq = dist * dist

    for (let i = 0; i < n; i++) {
        if (duplicates[i] !== -1 && duplicates[i] !== i) continue
        const a = verts[i]
        const cluster: number[] = []
        for (let j = 0; j < n; j++) {
            if (j === i) continue
            // Unassigned, or already a survivor in its own right. A kept vertex is pre-assigned to
            // itself and can still absorb its neighbours - Blender's `has_self_index`, which tells
            // `kdtree_calc_duplicates_cb` that those entries are targets rather than candidates.
            if (duplicates[j] !== -1 && duplicates[j] !== j) continue
            if (distSquared(a, verts[j]) <= distSq) cluster.push(j)
        }
        if (!cluster.length) continue
        cluster.push(i)

        // A vertex that must be kept wins outright; otherwise Blender's centroid rule decides.
        const kept = cluster.find(ci => duplicates[ci] === ci)
        const target = kept ?? cluster[clusterTarget(verts, cluster)]
        for (const ci of cluster) {
            if (duplicates[ci] === ci) continue
            duplicates[ci] = target
        }
    }

    return toTargetMap(verts, duplicates)
}

/**
 * The same, but only reaching along edges and face corners.
 *
 * Port of `bmesh_find_doubles_by_distance_connected_impl` (`:763`). From each vertex it floods
 * outward: every disk edge's far vertex is tested, and for faces with more than three corners the
 * vertices *not* reachable by an edge from this one are tested as well - the `l.next.next` to
 * `l.prev` walk, which for a quad is exactly the opposite corner. Triangles need no face step
 * because edge stepping already reaches every corner.
 *
 * The origin of a flood is the survivor; there is no centroid here, because a connected cluster is
 * walked from one end rather than found as a set.
 */
export function findDoublesByDistanceConnected(
    verts: BMVert[], dist: number, keepVerts?: Set<BMVert>,
): Map<BMVert, BMVert> {
    const n = verts.length
    const duplicates: number[] = new Array(n)
    const indexOf = new Map<BMVert, number>()
    for (let i = 0; i < n; i++) {
        duplicates[i] = keepVerts?.has(verts[i]) ? i : -1
        indexOf.set(verts[i], i)
    }
    const distSq = dist * dist

    for (let i = 0; i < n; i++) {
        if (duplicates[i] !== -1 && duplicates[i] !== i) continue
        const origin = verts[i]
        const stack: number[] = []
        let iCheck = i

        do {
            const vCheck = verts[iCheck]
            if (vCheck.e) {
                for (const e of diskEdges(vCheck)) {
                    const consider = (other: BMVert) => {
                        if (distSquared(other, origin) >= distSq) return
                        const iOther = indexOf.get(other)
                        if (iOther === undefined || duplicates[iOther] !== -1) return
                        duplicates[iOther] = i
                        stack.push(iOther)
                    }

                    consider(e.otherVert(vCheck)!)

                    if (!e.l) continue
                    for (const l of radialLoops(e)) {
                        // This face will be reached again from its other edge at `vCheck`.
                        if (l.v !== vCheck) continue
                        // Edge stepping already covers every corner of a triangle.
                        if (l.f.len <= 3) continue
                        // Every corner not joined to `vCheck` by an edge. A quad has exactly one.
                        let lIter = l.next!.next!
                        const lEnd = l.prev!
                        while (lIter !== lEnd) {
                            consider(lIter.v)
                            lIter = lIter.next!
                        }
                    }
                }
            }
            iCheck = stack.length ? stack.pop()! : -1
        } while (iCheck !== -1)
    }

    return toTargetMap(verts, duplicates)
}

/** `bmesh_find_doubles_common`'s final pass: a vertex mapped to itself or to nothing is not merged. */
function toTargetMap(verts: BMVert[], duplicates: number[]): Map<BMVert, BMVert> {
    const map = new Map<BMVert, BMVert>()
    for (let i = 0; i < verts.length; i++) {
        if (duplicates[i] === -1 || duplicates[i] === i) continue
        map.set(verts[i], verts[duplicates[i]])
    }
    return map
}

/**
 * Find coincident vertices and weld them. Blender's `Merge by Distance` / `bmo_remove_doubles_exec`.
 *
 * Returns the weld's result, so a caller can see what survived. Nothing happens - and nothing is
 * allocated - when no doubles are found.
 */
export function removeDoubles(
    bm: BMesh, verts: BMVert[], options: RemoveDoublesOptions = {},
): WeldResult & {merged: number} {
    const dist = options.distance ?? 0.0001
    const keepVerts = options.keepVerts ? new Set(options.keepVerts) : undefined
    const targetMap = options.useConnected
        ? findDoublesByDistanceConnected(verts, dist, keepVerts)
        : findDoublesByDistance(verts, dist, keepVerts)

    const result = weldVerts(bm, targetMap)
    if (options.selectResult) {
        for (const v of new Set(targetMap.values())) {
            if (bm.verts.has(v)) v.hflag |= ElemFlag.Select
        }
    }
    return {...result, merged: targetMap.size}
}

/** Merge doubles among the selected vertices. */
export function removeDoublesSelection(
    bm: BMesh, options: RemoveDoublesOptions = {},
): (WeldResult & {merged: number}) | null {
    const verts = [...bm.verts].filter(v => v.hflag & ElemFlag.Select)
    if (verts.length < 2) return null
    return removeDoubles(bm, verts, options)
}
