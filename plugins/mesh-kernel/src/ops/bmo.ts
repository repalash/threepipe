/**
 * Blender's bmesh-operator machinery the operator ports share: what `BMO_op_exec` does around an
 * operator (`BMO_push`/`BMO_pop` re-indexing, `bmesh_edit_end`), and the `duplicate`, `split` and
 * face-`delete` operators other operators call.
 *
 * Ported from `bmesh/intern/bmesh_operators.cc`, `bmesh/intern/bmesh_mesh.cc`,
 * `bmesh/operators/bmo_dupe.cc` and `bmesh/intern/bmesh_delete.cc`; each function cites its origin.
 * An `...Exec` function is the operator body alone; run it through {@link bmoOpExec} with the
 * operator's `type_flag` when it is the outermost operator, and with `null` when it is called from
 * inside another (Blender's nested `BMO_op_exec` has no `bmesh_edit_end`).
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdges, edgeIsBoundary, radialLoops} from '../bmesh/structure'
import {selectModeFlush} from '../bmesh/marking'
import {ElemType} from '../constants'
import {copyElemAttrs, copyElemHeader} from '../bmesh/customdata'
import {normalsUpdate} from './bevel-bmquery'

// region BMO_op_exec

/** `BMO_OPTYPE_FLAG_*` bits that `bmesh_edit_end` acts on. */
export interface BmeshEditEndFlags {
    normalsCalc?: boolean
    selectFlush?: boolean
    selectValidate?: boolean
}

/**
 * `bmesh_edit_end` (`bmesh_mesh.cc:298`): what `BMO_op_exec` does after a top-level operator (not
 * one called from inside another): recompute normals, flush the selection by the mesh's select mode,
 * and (without `selectValidate`) keep the select history untouched across that flush.
 */
export function bmeshEditEnd(bm: BMesh, flags: BmeshEditEndFlags): void {
    if (flags.normalsCalc) normalsUpdate(bm)
    let selectHistory = null
    if (!flags.selectValidate) {
        selectHistory = bm.selectHistory
        bm.selectHistory = []
    }
    if (flags.selectFlush) selectModeFlush(bm)
    if (!flags.selectValidate) bm.selectHistory = selectHistory!
}

/**
 * What `BMO_push` / `BMO_pop` (`bmesh_operators.cc:62`, `:77`) leave behind on the elements:
 * `bmo_flag_layer_alloc` / `_clear` / `_free` (`:1183`, `:1305`, `:1245`) walk every vertex, edge
 * and face to (re)allocate the operator flag layer and, "since we are looping over all data anyway",
 * set each one's `head.index` to its position in mesh order and clear the dirty bits. So every
 * operator - nested ones too - starts and ends with valid vertex/edge/face indices. Operators that
 * read `BM_elem_index_get` without an explicit ensure (beautify's rotation states,
 * `bmesh_beautify.cc:112`) depend on it.
 */
export function bmoFlagLayerIndex(bm: BMesh): void {
    bm.elemIndexEnsure(ElemType.Vert | ElemType.Edge | ElemType.Face)
}

/**
 * `BMO_op_exec` (`bmesh_operators.cc:168`): `BMO_push`, the operator, `bmesh_edit_end` with the
 * operator's `type_flag` when it is the outermost operator (`toolflag_index == 1`; `bmesh_edit_begin`
 * does nothing without multires), then `BMO_pop`. `typeFlag` is null for an operator run from inside
 * another one, which gets no `bmesh_edit_end`.
 */
export function bmoOpExec<T>(bm: BMesh, typeFlag: BmeshEditEndFlags | null, exec: () => T): T {
    bmoFlagLayerIndex(bm) // BMO_push
    const result = exec()
    if (typeFlag) bmeshEditEnd(bm, typeFlag)
    bmoFlagLayerIndex(bm) // BMO_pop
    return result
}

// endregion

// region duplicate, split, delete

/** Elements by type, a `BMO` element buffer split in three. */
export interface BMOGeom {
    verts: BMVert[]
    edges: BMEdge[]
    faces: BMFace[]
}

export interface BMODuplicateResult {
    /** `geom.out`: the new elements, in mesh order (verts, edges, faces). */
    geomOut: BMOGeom
    /** `boundary_map.out`: source edge -> new edge, for every copied edge with fewer than two input faces. */
    boundaryMap: Map<BMEdge, BMEdge>
    /** `vert_map.out` / `edge_map.out` / `face_map.out` in the source -> copy direction. */
    vertMap: Map<BMVert, BMVert>
    edgeMap: Map<BMEdge, BMEdge>
    faceMap: Map<BMFace, BMFace>
}

/**
 * `bmo_duplicate_exec` (`bmo_dupe.cc:370`) with `bmo_mesh_copy` (`:209`) and its element copies
 * (`bmo_vert_copy` :35, `bmo_edge_copy` :71, `bmo_face_copy` :147), within one mesh, with
 * `use_select_history` and `use_edge_flip_from_face` off (the defaults) and without `isovert_map.out`.
 *
 * Unlike `duplicateGeometry` in `duplicate.ts` this keeps Blender's order (input vertices, then input
 * edges, then input faces with whatever they still need), creates edges without the no-double
 * check, and records `boundary_map.out`, which the split-join of Grid Fill needs.
 */
export function bmoDuplicateExec(bm: BMesh, geom: BMOGeom): BMODuplicateResult {
    // DUPE_INPUT / DUPE_DONE / DUPE_NEW
    const inV = new Set(geom.verts), inE = new Set(geom.edges), inF = new Set(geom.faces)
    const doneV = new Set<BMVert>(), doneE = new Set<BMEdge>()
    const newElems = new Set<BMVert | BMEdge | BMFace>()
    const vhash = new Map<BMVert, BMVert>()
    const ehash = new Map<BMEdge, BMEdge>()
    const faceMap = new Map<BMFace, BMFace>()
    const boundaryMap = new Map<BMEdge, BMEdge>()

    /** `bmo_vert_copy`: `BM_vert_create(.., BM_CREATE_SKIP_CD)` + `BM_elem_attrs_copy`. */
    const vertCopy = (vSrc: BMVert): BMVert => {
        const vDst = bm.vertCreate(vSrc.x, vSrc.y, vSrc.z, vSrc)
        vhash.set(vSrc, vDst)
        newElems.add(vDst)
        return vDst
    }

    /** `bmo_edge_copy`. */
    const edgeCopy = (eSrc: BMEdge): BMEdge => {
        // "see if any of the neighboring faces are not being duplicated. in that case, add it to the
        // new/old map."
        let rlen = 0
        for (const l of radialLoops(eSrc)) if (inF.has(l.f)) rlen++
        const eDst = bm.edgeCreate(vhash.get(eSrc.v1)!, vhash.get(eSrc.v2)!, eSrc)
        if (rlen < 2) boundaryMap.set(eSrc, eDst)
        ehash.set(eSrc, eDst)
        newElems.add(eDst)
        return eDst
    }

    /** `bmo_face_copy`. */
    const faceCopy = (fSrc: BMFace): BMFace => {
        const lSrc = fSrc.loops()
        const fDst = bm.faceCreateWithEdges(lSrc.map(l => vhash.get(l.v)!), lSrc.map(l => ehash.get(l.e!)!), fSrc)
        faceMap.set(fSrc, fDst)
        // copy per-loop custom data
        const lDst = fDst.loops()
        for (let i = 0; i < lSrc.length; i++) {
            copyElemAttrs(lSrc[i], lDst[i], bm.ldata)
            copyElemHeader(lSrc[i], lDst[i], 'loop')
        }
        newElems.add(fDst)
        return fDst
    }

    // duplicate flagged vertices
    for (const v of [...bm.verts]) {
        if (inV.has(v) && !doneV.has(v)) {
            vertCopy(v)
            doneV.add(v)
        }
    }
    // now we dupe all the edges
    for (const e of [...bm.edges]) {
        if (inE.has(e) && !doneE.has(e)) {
            // make sure that verts are copied
            if (!doneV.has(e.v1)) {
                vertCopy(e.v1)
                doneV.add(e.v1)
            }
            if (!doneV.has(e.v2)) {
                vertCopy(e.v2)
                doneV.add(e.v2)
            }
            edgeCopy(e)
            doneE.add(e)
        }
    }
    // first we dupe all flagged faces and their elements from source
    for (const f of [...bm.faces]) {
        if (!inF.has(f)) continue
        for (const l of f.loops()) {
            if (!doneV.has(l.v)) {
                vertCopy(l.v)
                doneV.add(l.v)
            }
        }
        for (const l of f.loops()) {
            if (!doneE.has(l.e!)) {
                edgeCopy(l.e!)
                doneE.add(l.e!)
            }
        }
        faceCopy(f)
    }

    const result: BMODuplicateResult = {
        geomOut: {
            verts: [...bm.verts].filter(v => newElems.has(v)),
            edges: [...bm.edges].filter(e => newElems.has(e)),
            faces: [...bm.faces].filter(f => newElems.has(f)),
        },
        boundaryMap, vertMap: vhash, edgeMap: ehash, faceMap,
    }
    return result
}

/**
 * `BMO_mesh_delete_oflag_context` (`bmesh_delete.cc:86`, `:139`-`:193`) for `DEL_FACES` and, with
 * `keepBoundary`, `DEL_FACES_KEEP_BOUNDARY` (an edge that is a boundary before the delete stays): the flagged faces go,
 * with every edge and vertex of theirs that no unflagged face (or, for vertices, unflagged edge)
 * still uses. The sets are the operator flag and are updated in place, as Blender's flags are;
 * `prepareFn` runs after the marking and before the removal, as Blender's does.
 */
export function bmoMeshDeleteFacesContext(
    bm: BMesh, flagV: Set<BMVert>, flagE: Set<BMEdge>, flagF: Set<BMFace>, keepBoundary = false, prepareFn?: () => void,
): void {
    // go through and mark all edges and all verts of all faces for delete
    for (const f of bm.faces) {
        if (!flagF.has(f)) continue
        for (const l of f.eachLoop()) {
            flagV.add(l.v)
            flagE.add(l.e!)
        }
    }
    // now go through and mark all remaining faces all edges for keeping
    for (const f of bm.faces) {
        if (flagF.has(f)) continue
        for (const l of f.eachLoop()) {
            flagV.delete(l.v)
            flagE.delete(l.e!)
        }
    }
    // also mark all the vertices of remaining edges for keeping
    for (const e of bm.edges) {
        // Only exception to normal 'DEL_FACES' logic (`DEL_FACES_KEEP_BOUNDARY`, `:172`).
        if (keepBoundary && edgeIsBoundary(e)) flagE.delete(e)
        if (!flagE.has(e)) {
            flagV.delete(e.v1)
            flagV.delete(e.v2)
        }
    }
    if (prepareFn) prepareFn()

    // `bmo_remove_tagged_faces` / `_edges` / `_verts` (`bmesh_delete.cc:19-53`)
    for (const f of [...bm.faces]) if (flagF.has(f)) bm.faceKill(f)
    for (const e of [...bm.edges]) if (flagE.has(e)) bm.edgeKill(e)
    for (const v of [...bm.verts]) if (flagV.has(v)) bm.vertKill(v)
}

/**
 * `bmo_split_exec` (`bmo_dupe.cc:433`): duplicate `geom`, then delete the originals in the
 * `DEL_FACES` context (keeping whatever unselected faces still use). Returns the duplicate's
 * `geom.out` and the split's `boundary_map.out`, whose key is the destination itself when the source
 * edge was deleted ("Use the 'destination' as the key and the value since it avoids adding freed
 * geometry into the map", #142633).
 */
export function bmoSplitExec(bm: BMesh, geom: BMOGeom, useOnlyFaces = false): {geomOut: BMOGeom, boundaryMap: Map<BMEdge, BMEdge>} {
    // `BMO_op_initf(bm, &dupeop, op->flag, "duplicate geom=%fve", SPLIT_INPUT)` + `BMO_op_exec`: nested, no edit end.
    const dupe = bmoOpExec(bm, null, () => bmoDuplicateExec(bm, geom))

    const newActFace = bm.actFace ? dupe.faceMap.get(bm.actFace) : undefined
    if (newActFace) bm.actFace = newActFace

    // SPLIT_INPUT
    const flagV = new Set(geom.verts), flagE = new Set(geom.edges), flagF = new Set(geom.faces)

    if (useOnlyFaces) {
        // make sure to remove edges and verts we don't need
        for (const e of bm.edges) {
            let found = false
            for (const l of radialLoops(e)) {
                if (!flagF.has(l.f)) {
                    found = true
                    break
                }
            }
            if (!found) flagE.add(e)
        }
        for (const v of bm.verts) {
            let found = false
            for (const e of diskEdges(v)) {
                if (!flagE.has(e)) {
                    found = true
                    break
                }
            }
            if (!found) flagV.add(v)
        }
    }

    const boundaryMap = new Map<BMEdge, BMEdge>()
    bmoMeshDeleteFacesContext(bm, flagV, flagE, flagF, false, () => {
        // "Call before deletion so deleted geometry isn't copied."
        for (const [key, val] of dupe.boundaryMap) {
            boundaryMap.set(flagE.has(key) ? val : key, val)
        }
    })

    return {geomOut: dupe.geomOut, boundaryMap}
}

// endregion
