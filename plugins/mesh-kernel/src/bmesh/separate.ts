/**
 * Separating vertices and edges: `bmesh_kernel_edge_separate`, `bmesh_kernel_vert_separate` (with its
 * `__cleanup`), `BM_vert_separate` and `BM_vert_separate_hflag` from
 * `source/blender/bmesh/intern/bmesh_core.cc:2427-2740`. The Euler operators behind Edge Split (and
 * Rip): an edge shared by several faces is split into one edge per face; a vertex whose faces no longer
 * share edges is split into one vertex per fan.
 *
 * `_FLAG_WALK` (`EDGE_VISIT`) is a set; the `BLI_SMALLSTACK`s are arrays used as stacks.
 */

import {BMEdge, BMLoop, BMVert} from './types'
import {BMesh} from './BMesh'
import {edgeIsBoundary, radialLoopAppend, radialLoopRemove} from './structure'
import {edgeSplice, edgeVertSwap} from './splice'
import {elemSelectSet} from './marking'
import {ElemFlag} from '../constants'

/** `BM_elem_select_copy` (`bmesh_construct.cc:397`). */
function elemSelectCopy(bm: BMesh, dst: BMVert | BMEdge, src: BMVert | BMEdge): void {
    if ((src.hflag & ElemFlag.Select) !== (dst.hflag & ElemFlag.Select)) {
        elemSelectSet(bm, dst, (src.hflag & ElemFlag.Select) !== 0)
    }
}

/** `bm_edge_supports_separate` (`:2427`): the edge has two or more faces. */
function edgeSupportsSeparate(e: BMEdge): boolean {
    return e.l !== null && e.l.radialNext !== e.l
}

/**
 * `bmesh_kernel_edge_separate` (`:2711`): move `lSep` (one face's use of `e`) onto a new edge between
 * the same two vertices.
 */
export function edgeSeparate(bm: BMesh, e: BMEdge, lSep: BMLoop, copySelect: boolean): void {
    if (edgeIsBoundary(e)) return // no cut required
    if (lSep === e.l) e.l = lSep.radialNext
    const eNew = bm.edgeCreate(e.v1, e.v2, e)
    radialLoopRemove(e, lSep)
    radialLoopAppend(eNew, lSep)
    lSep.e = eNew
    if (copySelect) elemSelectCopy(bm, eNew, e)
}

/**
 * `bmesh_kernel_vert_separate` (`:2431`): give each fan of edges around `v` (edges joined through a
 * face corner) its own vertex. Returns `v` and the new vertices.
 */
export function vertSeparateKernel(bm: BMesh, v: BMVert, copySelect: boolean): BMVert[] {
    const out: BMVert[] = [v]
    if (!v.e) return out
    const visit = new Set<BMEdge>() // EDGE_VISIT
    let vEdgesNum = 0
    let eIter = v.e
    do {
        vEdgesNum += 1
        visit.add(eIter)
    } while ((eIter = eIter.diskNext(v)!) !== v.e)

    const edges: BMEdge[] = []
    const edgesSearch: BMEdge[] = []
    let edgesFound = 0
    while (true) {
        // Considering only edges and faces incident on vertex v, walk the edges & collect in the
        // 'edges' list for splitting
        let e: BMEdge | undefined = v.e!
        visit.delete(e)
        do {
            edges.push(e)
            edgesFound += 1
            if (e.l) {
                let l = e.l
                do {
                    const lAdjacent = l.v === v ? l.prev : l.next
                    if (visit.has(lAdjacent.e!)) {
                        visit.delete(lAdjacent.e!)
                        edgesSearch.push(lAdjacent.e!)
                    }
                } while ((l = l.radialNext!) !== e.l)
            }
        } while ((e = edgesSearch.pop()))

        // now we have all edges connected to 'v->e'
        if (edgesFound === vEdgesNum) break // the remaining edges form the last fan, left as is

        const vNew = bm.vertCreate(v.x, v.y, v.z, v)
        if (copySelect) elemSelectCopy(bm, vNew, v)
        let es: BMEdge | undefined
        while ((es = edges.pop())) edgeVertSwap(es, vNew, v)
        out.push(vNew)
    }
    return out
}

/**
 * `bmesh_kernel_vert_separate__cleanup` (`:2559`): edges that were split off but whose vertices did not
 * separate after all are spliced back into the original. Each list starts with the original edge.
 */
function vertSeparateCleanup(bm: BMesh, edgesSeparate: BMEdge[][]): void {
    for (const list of edgesSeparate) {
        for (let i = 0; i + 1 < list.length; i++) {
            const eOrig = list[i]
            let j = i + 1
            while (j < list.length) {
                const e = list[j]
                if (e.v1 === eOrig.v1 && e.v2 === eOrig.v2 && edgeSplice(bm, eOrig, e)) list.splice(j, 1) // don't visit again
                else j++
            }
        }
    }
}

/**
 * Split each of `e` into one edge per face, collecting the copies (`BLI_linklist_prepend`: newest
 * first, the original at the head).
 */
function separateEdgeFully(bm: BMesh, e: BMEdge, copySelect: boolean, onFirst?: (eSep: BMEdge) => void): BMEdge[] {
    const origs: BMEdge[] = []
    let first = true
    do {
        const lSep = e.l!
        edgeSeparate(bm, e, lSep, copySelect)
        if (first && onFirst) onFirst(lSep.e!)
        first = false
        origs.unshift(lSep.e!)
    } while (edgeSupportsSeparate(e))
    origs.unshift(e)
    return origs
}

/** `BM_vert_separate` (`:2583`): split `eIn` per face, then `v` per fan, then splice back what did not part. */
export function vertSeparate(bm: BMesh, v: BMVert, eIn: readonly BMEdge[], copySelect: boolean): BMVert[] {
    const edgesSeparate: BMEdge[][] = []
    for (const e of eIn) {
        if (edgeSupportsSeparate(e)) edgesSeparate.unshift(separateEdgeFully(bm, e, copySelect))
    }
    const out = vertSeparateKernel(bm, v, copySelect)
    if (edgesSeparate.length) vertSeparateCleanup(bm, edgesSeparate)
    return out
}

/** `BM_vert_separate_hflag` (`:2616`): {@link vertSeparate} over the edges of `v` with `hflag`. */
export function vertSeparateHflag(bm: BMesh, v: BMVert, hflag: number, copySelect: boolean): BMVert[] {
    const edgesSeparate: BMEdge[][] = []
    let eIter = v.e!
    let eFirst = v.e!
    do {
        if (eIter.hflag & hflag) {
            const e = eIter
            if (edgeSupportsSeparate(e)) {
                const noneYet = edgesSeparate.length === 0
                // "trick to avoid looping over separated edges"
                edgesSeparate.unshift(separateEdgeFully(bm, e, copySelect, eSep => { if (noneYet) eFirst = eSep }))
            }
        }
    } while ((eIter = eIter.diskNext(v)!) !== eFirst)
    const out = vertSeparateKernel(bm, v, copySelect)
    if (edgesSeparate.length) vertSeparateCleanup(bm, edgesSeparate)
    return out
}
