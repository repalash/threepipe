/**
 * Dissolving faces: merging a contiguous region into a single n-gon.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_core.cc` (`BM_faces_join`,
 * `bm_vert_is_manifold_flagged`) and `source/blender/bmesh/operators/bmo_dissolve.cc`
 * (`bmo_dissolve_faces_exec`).
 *
 * This is how a fan of triangles becomes one cap: `bmo_create_circle_exec` and `bmo_create_cone_exec`
 * both build their end caps as a triangle fan and then dissolve it, rather than constructing the
 * n-gon directly, because the fan is what the rest of the operator already has in hand.
 *
 * The join is not a merge of vertex lists. It takes the region's boundary - every edge with exactly
 * one adjacent face inside the region - and builds one face from that edge set with
 * {@link faceCreateNgon}, which is what recovers a winding from an unordered set. Interior edges and
 * the vertices that only interior edges touch then go away.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, edgeFaceCount, edgeIsBoundary, radialLoops} from '../bmesh/structure'
import {copyElemAttrs} from '../bmesh/customdata'
import {faceCreateNgon} from '../bmesh/ngon'
import {faceFindDouble} from '../bmesh/splice'

/**
 * Is `v` manifold *within* `region` - every edge at it used by two faces, and every one of those
 * faces inside the region?
 *
 * Port of `bm_vert_is_manifold_flagged` (`bmesh_core.cc:1232`). A vertex like that is entirely
 * interior to the region and disappears when the region becomes one face; one that fails the test is
 * on the boundary, or is a pinch point, and has to stay.
 */
export function vertIsManifoldInRegion(v: BMVert, region: ReadonlySet<BMFace>): boolean {
    if (!v.e) return false
    for (const e of diskEdges(v)) {
        if (!e.l) return false
        if (edgeIsBoundary(e)) return false
        for (const l of radialLoops(e)) {
            if (!region.has(l.f)) return false
        }
    }
    return true
}

/**
 * Merge a contiguous manifold region of faces into one n-gon, and return it.
 *
 * Port of `BM_faces_join` (`bmesh_core.cc:1263`). Returns null when the region is not a contiguous
 * manifold disc - an edge with three of the region's faces on it, or a boundary that is not a single
 * cycle - which is Blender's answer too, rather than corrupting the mesh.
 *
 * `doDel` is Blender's argument of the same name: on, the interior edges and vertices are deleted
 * (which takes the old faces with them); off, only the old faces go and their interior skeleton is
 * left behind as wire.
 *
 * Multires interpolation and the `r_double` reporting path are not ported - the kernel has no
 * multires layer, and no caller asks for the double.
 */
export function facesJoin(bm: BMesh, faces: readonly BMFace[], doDel: boolean): BMFace | null {
    if (!faces.length) return null
    if (faces.length === 1) return faces[0]

    const region = new Set(faces)
    const edges: BMEdge[] = []
    const delEdges: BMEdge[] = []
    const delVerts: BMVert[] = []
    const taggedEdges = new Set<BMEdge>()
    const taggedVerts = new Set<BMVert>()
    let v1: BMVert | null = null
    let v2: BMVert | null = null

    for (const f of faces) {
        for (const l of f.eachLoop()) {
            const e = l.e!
            let rlen = 0
            for (const rl of radialLoops(e)) if (region.has(rl.f)) rlen++

            if (rlen > 2) return null // not a contiguous manifold region
            if (rlen === 1) {
                edges.push(e)
                if (!v1) {
                    v1 = l.v
                    v2 = e.otherVert(l.v)
                }
            } else if (rlen === 2) {
                const d1 = vertIsManifoldInRegion(e.v1, region)
                const d2 = vertIsManifoldInRegion(e.v2, region)
                if (!d1 && !d2 && !taggedEdges.has(e)) {
                    // Don't remove an edge that makes up the side of another face, or that face goes too.
                    if (edgeFaceCount(e) <= 2) {
                        if (doDel) delEdges.push(e)
                        taggedEdges.add(e)
                    }
                } else {
                    if (d1 && !taggedVerts.has(e.v1)) {
                        if (doDel) delVerts.push(e.v1)
                        taggedVerts.add(e.v1)
                    }
                    if (d2 && !taggedVerts.has(e.v2)) {
                        if (doDel) delVerts.push(e.v2)
                        taggedVerts.add(e.v2)
                    }
                }
            }
        }
    }

    const fNew = edges.length ? faceCreateNgon(bm, v1!, v2!, edges, faces[0]) : null
    if (!fNew) return null

    const existing = faceFindDouble(fNew)
    if (existing) {
        bm.faceKill(fNew)
        return existing
    }

    // Take each new corner's attributes from the corner of the joined face that sat at the same vertex.
    for (const l of fNew.eachLoop()) {
        let l2 = l.radialNext!
        while (l2 !== l) {
            if (region.has(l2.f)) break
            l2 = l2.radialNext!
        }
        if (l2 !== l) {
            // The loops share an edge; which end they start from depends on the winding.
            if (l2.v !== l.v) l2 = l2.next
            copyElemAttrs(l2, l, bm.ldata)
        }
    }

    if (doDel) {
        for (const e of delEdges) if (bm.edges.has(e)) bm.edgeKill(e)
        for (const v of delVerts) if (bm.verts.has(v)) bm.vertKill(v)
    } else {
        for (const f of faces) if (bm.faces.has(f)) bm.faceKill(f)
    }

    return fNew
}

/**
 * Dissolve a set of faces, merging each connected group into one n-gon. Returns the faces made.
 *
 * Port of `bmo_dissolve_faces_exec` (`bmo_dissolve.cc:214`) reduced to its core: group the input
 * faces into regions connected across shared edges, then {@link facesJoin} each region. Blender
 * groups with `BM_mesh_calc_face_groups`; a flood fill over the same adjacency gives the same
 * partition, because the grouping is defined by that adjacency and nothing else.
 *
 * Blender's `use_verts` pass (dissolving vertices left with exactly two edges afterwards) and its
 * `BMO_error_raise` on a region that will not join are not ported - the primitives that need this
 * pass neither.
 */
export function dissolveFaces(bm: BMesh, faces: readonly BMFace[]): BMFace[] {
    const remaining = new Set(faces)
    const out: BMFace[] = []

    while (remaining.size) {
        const seed: BMFace = remaining.values().next().value!
        const group: BMFace[] = []
        const stack: BMFace[] = [seed]
        remaining.delete(seed)
        while (stack.length) {
            const f = stack.pop()!
            group.push(f)
            for (const l of f.eachLoop()) {
                for (const rl of radialLoops(l.e!)) {
                    if (remaining.has(rl.f)) {
                        remaining.delete(rl.f)
                        stack.push(rl.f)
                    }
                }
            }
        }
        const joined = facesJoin(bm, group, true)
        if (joined) out.push(joined)
    }

    return out
}
