/**
 * Disk and radial cycle primitives.
 *
 * A direct port of `source/blender/bmesh/intern/bmesh_structure.cc`. These functions are the only
 * place that mutates cycle links; everything above them composes these. Getting one of them subtly
 * wrong corrupts topology in ways that surface much later, so each is a line-for-line translation and
 * the tests assert the cycle invariants directly.
 *
 * Blender's note on ordering applies here too: the order of elements in the disk and radial cycles is
 * undefined. Only the loop cycle has a meaningful order (the face winding). Nothing may depend on
 * disk or radial order.
 */

import {BMEdge, BMLoop, BMVert} from './types'

// region disk cycle - the edges around a vertex

/**
 * Insert `e` into the disk cycle of `v`.
 *
 * Port of `bmesh_disk_edge_append` (`bmesh_structure.cc:139`).
 */
export function diskEdgeAppend(e: BMEdge, v: BMVert): void {
    if (!v.e) {
        v.e = e
        e.setDiskNext(v, e)
        e.setDiskPrev(v, e)
        return
    }
    const first = v.e
    // Read the existing predecessor before overwriting it, as Blender does via dl2->prev.
    const prev = first.diskPrev(v)

    e.setDiskNext(v, first)
    e.setDiskPrev(v, prev)

    first.setDiskPrev(v, e)
    if (prev) prev.setDiskNext(v, e)
}

/**
 * Remove `e` from the disk cycle of `v`, repointing `v.e` if it referenced `e`.
 *
 * Port of `bmesh_disk_edge_remove` (`bmesh_structure.cc:164`).
 */
export function diskEdgeRemove(e: BMEdge, v: BMVert): void {
    const next = e.diskNext(v)
    const prev = e.diskPrev(v)

    if (prev) prev.setDiskNext(v, next)
    if (next) next.setDiskPrev(v, prev)

    if (v.e === e) {
        // When e was the only edge in the cycle its next points back at itself, so the vertex
        // becomes loose rather than pointing at a removed edge.
        v.e = e !== next ? next : null
    }

    e.setDiskNext(v, null)
    e.setDiskPrev(v, null)
}

/**
 * The edge joining `v1` and `v2`, or null. Walks `v1`'s disk cycle.
 *
 * Port of `bmesh_disk_edge_exists` (`bmesh_structure.cc:186`).
 */
export function diskEdgeExists(v1: BMVert, v2: BMVert): BMEdge | null {
    if (!v1.e) return null
    const first = v1.e
    let iter: BMEdge = first
    do {
        if (iter.joins(v1, v2)) return iter
        iter = iter.diskNext(v1)!
    } while (iter && iter !== first)
    return null
}

/** Number of edges using `v`. Port of `bmesh_disk_count` (`bmesh_structure.cc:202`). */
export function diskCount(v: BMVert): number {
    if (!v.e) return 0
    let count = 0
    const first = v.e
    let iter: BMEdge = first
    do {
        count++
        iter = iter.diskNext(v)!
    } while (iter && iter !== first)
    return count
}

/** Iterate the edges around `v` without allocating. Order is undefined but stable per walk. */
export function* diskEdges(v: BMVert): Generator<BMEdge> {
    if (!v.e) return
    const first = v.e
    let iter: BMEdge = first
    do {
        // Capture next before yielding: callers sometimes unlink the current edge mid-walk.
        const next = iter.diskNext(v)!
        yield iter
        iter = next
    } while (iter && iter !== first)
}

/** All edges using `v`, as an array. */
export function vertEdges(v: BMVert): BMEdge[] {
    return [...diskEdges(v)]
}

/**
 * Replace `vOld` with `vNew` on `e`, moving it between disk cycles.
 *
 * Port of `bmesh_disk_vert_replace` (`bmesh_structure.cc`). The edge must not already use `vNew`,
 * which would make it degenerate.
 */
export function diskVertReplace(e: BMEdge, vNew: BMVert, vOld: BMVert): void {
    if (!e.uses(vOld)) throw new Error(`mesh-kernel: edge ${e.id} does not use vertex ${vOld.id}`)
    if (e.uses(vNew)) throw new Error(`mesh-kernel: edge ${e.id} already uses vertex ${vNew.id}`)
    diskEdgeRemove(e, vOld)
    if (e.v1 === vOld) e.v1 = vNew
    else e.v2 = vNew
    diskEdgeAppend(e, vNew)
}

// endregion

// region radial cycle - the loops (faces) around an edge

/**
 * Insert `l` into the radial cycle of `e` and point `l.e` at it.
 *
 * Port of `bmesh_radial_loop_append` (`bmesh_structure.cc:377`).
 */
export function radialLoopAppend(e: BMEdge, l: BMLoop): void {
    if (e.l === null) {
        e.l = l
        l.radialNext = l
        l.radialPrev = l
    } else {
        l.radialPrev = e.l
        l.radialNext = e.l.radialNext
        e.l.radialNext!.radialPrev = l
        e.l.radialNext = l
        e.l = l
    }

    if (l.e && l.e !== e) {
        throw new Error(`mesh-kernel: loop ${l.id} is already in the radial cycle of edge ${l.e.id}`)
    }
    l.e = e
}

/**
 * Remove `l` from the radial cycle of `e`, clearing its links and its edge reference.
 *
 * Port of `bmesh_radial_loop_remove` (`bmesh_structure.cc:401`).
 */
export function radialLoopRemove(e: BMEdge, l: BMLoop): void {
    if (e !== l.e) {
        throw new Error(`mesh-kernel: loop ${l.id} is not in the radial cycle of edge ${e.id}`)
    }

    if (l.radialNext !== l) {
        if (l === e.l) e.l = l.radialNext
        l.radialNext!.radialPrev = l.radialPrev
        l.radialPrev!.radialNext = l.radialNext
    } else {
        if (l !== e.l) {
            throw new Error(`mesh-kernel: edge ${e.id} radial cycle is inconsistent around loop ${l.id}`)
        }
        e.l = null
    }

    l.radialNext = null
    l.radialPrev = null
    l.e = null
}

/**
 * Number of loops (so faces) using `e`. Port of `bmesh_radial_length` (`bmesh_structure.cc:468`).
 *
 * 0 is a wire edge, 1 a boundary, 2 manifold, more non-manifold.
 */
export function radialLength(e: BMEdge): number {
    if (!e.l) return 0
    let count = 0
    const first = e.l
    let iter: BMLoop = first
    do {
        count++
        iter = iter.radialNext!
    } while (iter && iter !== first)
    return count
}

/** Iterate the loops around `e` without allocating. */
export function* radialLoops(e: BMEdge): Generator<BMLoop> {
    if (!e.l) return
    const first = e.l
    let iter: BMLoop = first
    do {
        const next = iter.radialNext!
        yield iter
        iter = next
    } while (iter && iter !== first)
}

/** Faces using `e`. */
export function edgeFaces(e: BMEdge) {
    return [...radialLoops(e)].map(l => l.f)
}

/** Number of faces using `e`. Blender's `BM_edge_face_count`. */
export function edgeFaceCount(e: BMEdge): number {
    return radialLength(e)
}

/** Exactly two faces use this edge. Blender's `BM_edge_is_manifold`. */
export function edgeIsManifold(e: BMEdge): boolean {
    const l = e.l
    return l !== null && l.radialNext !== l && l.radialNext!.radialNext === l
}

/** Exactly one face uses this edge. Blender's `BM_edge_is_boundary`. */
export function edgeIsBoundary(e: BMEdge): boolean {
    const l = e.l
    return l !== null && l.radialNext === l
}

/** No face uses this edge. Blender's `BM_edge_is_wire`. */
export function edgeIsWire(e: BMEdge): boolean {
    return e.l === null
}

// endregion

// region validation

/**
 * Check the cycle invariants around one vertex and one edge, the way `bmesh_disk_validate` and
 * `bmesh_radial_validate` do. Returns human-readable problems; empty means consistent.
 *
 * Used by tests and by `BMesh.validate()`, not in hot paths.
 */
export function validateDisk(v: BMVert): string[] {
    const problems: string[] = []
    if (!v.e) return problems

    const first = v.e
    let iter: BMEdge = first
    let guard = 0
    do {
        if (!iter.uses(v)) {
            problems.push(`vertex ${v.id} disk cycle contains edge ${iter.id}, which does not use it`)
            break
        }
        const next = iter.diskNext(v)
        const prev = iter.diskPrev(v)
        if (!next || !prev) {
            problems.push(`vertex ${v.id} disk cycle has a null link at edge ${iter.id}`)
            break
        }
        if (next.diskPrev(v) !== iter) {
            problems.push(`vertex ${v.id} disk cycle is not doubly linked at edge ${iter.id}`)
            break
        }
        iter = next
        if (++guard > 1e6) {
            problems.push(`vertex ${v.id} disk cycle does not terminate`)
            break
        }
    } while (iter !== first)

    return problems
}

export function validateRadial(e: BMEdge): string[] {
    const problems: string[] = []
    if (!e.l) return problems

    const first = e.l
    let iter: BMLoop = first
    let guard = 0
    do {
        if (iter.e !== e) {
            problems.push(`edge ${e.id} radial cycle contains loop ${iter.id}, whose edge is ${iter.e?.id ?? 'null'}`)
            break
        }
        if (!iter.radialNext || !iter.radialPrev) {
            problems.push(`edge ${e.id} radial cycle has a null link at loop ${iter.id}`)
            break
        }
        if (iter.radialNext.radialPrev !== iter) {
            problems.push(`edge ${e.id} radial cycle is not doubly linked at loop ${iter.id}`)
            break
        }
        // The loop must actually run along this edge.
        if (!e.joins(iter.v, iter.next.v)) {
            problems.push(`edge ${e.id} has loop ${iter.id} whose span (${iter.v.id}, ${iter.next.v.id}) does not match`)
            break
        }
        iter = iter.radialNext
        if (++guard > 1e6) {
            problems.push(`edge ${e.id} radial cycle does not terminate`)
            break
        }
    } while (iter !== first)

    return problems
}

// endregion
