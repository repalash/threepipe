/**
 * Building a face from a bag of edges.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_construct.cc` (`bm_edges_sort_winding`,
 * `BM_face_create_ngon`).
 *
 * `BMesh.faceCreateWithEdges` is `BM_face_create`: it wants the vertices and edges already in
 * winding order, `edges[i]` joining `verts[i]` to `verts[i + 1]`. An operator that has computed a
 * *set* of boundary edges - which is what dissolving a region gives you - has no such order, and
 * recovering it is not simply "walk the edges": the same set can be walked in two directions, and
 * only one of them agrees with the faces being replaced. That is why Blender's entry point takes
 * `v1` and `v2`: the caller names the first step, and the winding follows from it.
 *
 * This would sit naturally in `BMesh.ts` next to `faceCreate`, and should move there; it is here
 * because that file was owned elsewhere when the helpers were promoted out of `generate/primitives.ts`.
 */

import {BMEdge, BMFace, BMVert} from './types'
import {BMesh} from './BMesh'

/**
 * Order `edges` into a face winding whose first step is `v1 -> v2`.
 *
 * Port of `bm_edges_sort_winding` (`bmesh_construct.cc:136`). Blender marks the candidate edges and
 * vertices with its API scratch bits `_FLAG_MF` / `_FLAG_MV` and clears a vertex's as it is used, so
 * that a vertex reached twice is detected; the header flags here are not reserved for API scratch
 * use, so the two marks are local sets and "clearing" is a delete.
 *
 * Returns null when the edges do not form a single cycle starting that way - a vertex visited twice,
 * a chain that runs out, or a walk that does not come back to where it began. Blender returns false
 * for all three and its caller turns that into a null face.
 */
export function edgesSortWinding(
    v1: BMVert, v2: BMVert, edges: readonly BMEdge[],
): {edges: BMEdge[], verts: BMVert[]} | null {
    const len = edges.length
    const edgeTag = new Set(edges)
    const vertTag = new Set<BMVert>()
    for (const e of edges) {
        vertTag.add(e.v1)
        vertTag.add(e.v2)
    }

    const edgesSort: BMEdge[] = new Array(len)
    const vertsSort: BMVert[] = new Array(len)

    // Find the edge leaving v1 towards v2. A disk cycle is circular, so once a vertex has an edge
    // every step of `diskNext` is non-null.
    let vIter = v1
    if (!v1.e) return null
    let eFirst: BMEdge = v1.e
    let eIter: BMEdge = eFirst
    let found = false
    do {
        if (edgeTag.has(eIter) && eIter.otherVert(vIter) === v2) {
            found = true
            break
        }
        eIter = eIter.diskNext(vIter)!
    } while (eIter !== eFirst)
    if (!found) return null

    let i = 0
    eFirst = eIter
    do {
        if (edgeTag.has(eIter)) {
            if (!vertTag.has(vIter)) return null // vert appears in the loop twice
            edgeTag.delete(eIter)
            edgesSort[i] = eIter
            vertTag.delete(vIter)
            vertsSort[i] = vIter
            i += 1

            vIter = eIter.otherVert(vIter)
            if (i === len) {
                if (vIter !== vertsSort[0]) return null
                break
            }
            eFirst = eIter
        }
        eIter = eIter.diskNext(vIter)!
    } while (eIter !== eFirst)

    return i === len ? {edges: edgesSort, verts: vertsSort} : null
}

/**
 * Create a face from an unordered set of boundary edges, winding it so it starts `v1 -> v2`.
 *
 * Port of `BM_face_create_ngon` (`bmesh_construct.cc:210`), which is {@link edgesSortWinding}
 * followed by `BM_face_create`. Returns null when the edges do not form one cycle, exactly as
 * Blender does rather than building something broken.
 */
export function faceCreateNgon(
    bm: BMesh, v1: BMVert, v2: BMVert, edges: readonly BMEdge[], example?: BMFace,
): BMFace | null {
    const sorted = edgesSortWinding(v1, v2, edges)
    if (!sorted) return null
    return bm.faceCreateWithEdges(sorted.verts, sorted.edges, example)
}
