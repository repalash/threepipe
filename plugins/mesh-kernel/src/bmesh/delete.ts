/**
 * Delete by header flag: `BM_mesh_delete_hflag_context` and `BM_mesh_delete_hflag_tagged`, ported from
 * `source/blender/bmesh/intern/bmesh_delete.cc:200-358` ("BMesh Delete Functions (no oflags)").
 *
 * The operator-flag twin (`BMO_mesh_delete_oflag_context`) is `bmoMeshDeleteFacesContext` in
 * `ops/bmo.ts` for its face context; this file is the header-flag version that edit-mode code calls
 * with `BM_ELEM_TAG` (Delete Loose, `editmesh_tools.cc:585`). Like Blender's it *sets* `hflag` on the
 * vertices and edges it decides to remove, so the caller's tag is changed on those elements.
 */

import {BMesh} from './BMesh'
import {ElemType, type ElemTypeMask} from '../constants'

/** `BMO_Delete_Context` (`bmesh_operator_api.hh:522`). */
export const DelContext = {
    Verts: 1,
    Edges: 2,
    OnlyFaces: 3,
    EdgesFaces: 4,
    Faces: 5,
    FacesKeepBoundary: 6,
    OnlyTagged: 7,
} as const
export type DelContextType = typeof DelContext[keyof typeof DelContext]

/** `bm_remove_tagged_faces` (`bmesh_delete.cc:212`). */
function removeTaggedFaces(bm: BMesh, hflag: number): void {
    for (const f of [...bm.faces]) if (f.hflag & hflag) bm.faceKill(f)
}

/** `bm_remove_tagged_edges` (`:224`). */
function removeTaggedEdges(bm: BMesh, hflag: number): void {
    for (const e of [...bm.edges]) if (e.hflag & hflag) bm.edgeKill(e)
}

/** `bm_remove_tagged_verts` (`:236`). */
function removeTaggedVerts(bm: BMesh, hflag: number): void {
    for (const v of [...bm.verts]) if (v.hflag & hflag) bm.vertKill(v)
}

/** `bm_remove_tagged_verts_loose` (`:248`): only the flagged vertices left without an edge. */
function removeTaggedVertsLoose(bm: BMesh, hflag: number): void {
    for (const v of [...bm.verts]) if ((v.hflag & hflag) && v.e === null) bm.vertKill(v)
}

/** `BM_mesh_delete_hflag_tagged` (`:260`). */
export function meshDeleteHflagTagged(bm: BMesh, hflag: number, htype: ElemTypeMask): void {
    if (htype & ElemType.Face) removeTaggedFaces(bm, hflag)
    if (htype & ElemType.Edge) removeTaggedEdges(bm, hflag)
    if (htype & ElemType.Vert) removeTaggedVerts(bm, hflag)
}

/**
 * `BM_mesh_delete_hflag_context` (`bmesh_delete.cc:273`). `DEL_FACES_KEEP_BOUNDARY` has no header-flag
 * branch in Blender (the switch has no case for it), so it deletes nothing here either.
 */
export function meshDeleteHflagContext(bm: BMesh, hflag: number, type: DelContextType): void {
    switch (type) {
    case DelContext.Verts:
        removeTaggedVerts(bm, hflag)
        break
    case DelContext.Edges:
        // flush down to vert
        for (const e of bm.edges) {
            if (e.hflag & hflag) {
                e.v1.hflag |= hflag
                e.v2.hflag |= hflag
            }
        }
        removeTaggedEdges(bm, hflag)
        removeTaggedVertsLoose(bm, hflag)
        break
    case DelContext.EdgesFaces:
        removeTaggedEdges(bm, hflag)
        break
    case DelContext.OnlyFaces:
        removeTaggedFaces(bm, hflag)
        break
    case DelContext.OnlyTagged:
        meshDeleteHflagTagged(bm, hflag, ElemType.Vert | ElemType.Edge | ElemType.Face)
        break
    case DelContext.Faces: {
        // go through and mark all edges and all verts of all faces for delete
        for (const f of bm.faces) {
            if (!(f.hflag & hflag)) continue
            for (const l of f.eachLoop()) {
                l.v.hflag |= hflag
                l.e!.hflag |= hflag
            }
        }
        // now go through and mark all remaining faces all edges for keeping
        for (const f of bm.faces) {
            if (f.hflag & hflag) continue
            for (const l of f.eachLoop()) {
                l.v.hflag &= ~hflag
                l.e!.hflag &= ~hflag
            }
        }
        // also mark all the vertices of remaining edges for keeping
        for (const e of bm.edges) {
            if (!(e.hflag & hflag)) {
                e.v1.hflag &= ~hflag
                e.v2.hflag &= ~hflag
            }
        }
        removeTaggedFaces(bm, hflag)
        removeTaggedEdges(bm, hflag)
        removeTaggedVerts(bm, hflag)
        break
    }
    }
}
