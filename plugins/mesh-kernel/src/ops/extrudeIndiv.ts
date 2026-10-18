/**
 * Extruding individual elements: `bmo_extrude_discrete_faces_exec` (`:42`), `bmo_extrude_edge_only_exec`
 * (`:167`) with `bm_extrude_copy_face_loop_attributes` (`:128`) and `bmo_extrude_vert_indiv_exec`
 * (`:236`) from `source/blender/bmesh/operators/bmo_extrude.cc`, and the edit-mode wrappers
 * `edbm_extrude_discrete_faces` (`:104`), `EDBM_extrude_edges_indiv` (`:136`) and
 * `edbm_extrude_verts_indiv` (`:169`) from `editors/mesh/editmesh_extrude.cc`. These are the extrude
 * halves of the `MESH_OT_extrude_faces_move` / `_edges_move` / `_vertices_move` macros; the editor
 * chains the transform.
 *
 * Operator flags (`EXT_INPUT`, `EXT_KEEP`, `EXT_DEL`) are sets. `use_select_history` remaps the select
 * history onto the copies (`BMO_mesh_selected_remap` / the `select_history_map` lookups).
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {copyElemAttrs, copyElemHeader} from '../bmesh/customdata'
import {edbmFlagDisableAll, elemsHflagDisable, elemsHflagEnable} from '../bmesh/hflag'
import {faceSelectSet} from '../bmesh/marking'
import {edgeOtherLoop} from '../bmesh/query'
import {ElemFlag, ElemType} from '../constants'
import {BmeshEditEndFlags, bmoDuplicateExec, bmoOpExec} from './bmo'
import {faceCreateVerts} from './triangulate'

type Elem = BMVert | BMEdge | BMFace

/** `BMO_mesh_selected_remap` (`bmesh_operators.cc`) / the `select_history_map` lookups: point history entries at their copies. */
function selectHistoryRemap(bm: BMesh, map: ReadonlyMap<Elem, Elem>): void {
    for (const ese of bm.selectHistory) {
        const to = map.get(ese.elem)
        if (to) ese.elem = to as never
    }
}

const selectedVisible = <T extends Elem>(elems: Iterable<T>): T[] =>
    [...elems].filter(e => (e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden))

// region bmesh operators

/**
 * `bm_extrude_copy_face_loop_attributes` (`:128`): a side quad made from an edge takes its face data
 * from the face across that edge, and the corner data of the matching corners.
 */
function extrudeCopyFaceLoopAttributes(bm: BMesh, f: BMFace): void {
    // edge we are extruded from
    const lFirst0 = f.lFirst
    const lFirst1 = lFirst0.next
    const lFirst2 = lFirst1.next
    const lFirst3 = lFirst2.next
    if (lFirst0 === lFirst0.radialNext) return
    const lOther0 = edgeOtherLoop(lFirst0.e!, lFirst0)
    const lOther1 = edgeOtherLoop(lFirst0.e!, lFirst1)
    // copy data (`BM_elem_attrs_copy` keeps the destination's selection)
    copyElemHeader(lOther0.f, f, 'face')
    copyElemAttrs(lOther0.f, f, bm.pdata)
    f.hflag &= ~ElemFlag.Hidden // possibly we copy from a hidden face
    for (const [src, dst] of [[lOther0, lFirst0], [lOther0, lFirst3], [lOther1, lFirst1], [lOther1, lFirst2]] as [BMLoop, BMLoop][]) {
        copyElemHeader(src, dst, 'loop')
        copyElemAttrs(src, dst, bm.ldata)
    }
}

/**
 * `bmo_extrude_edge_only_exec` (`:167`): duplicate `edges` (and their vertices) and join each to its
 * copy with a quad. `geom.out`: the new vertices, the new edges and the quads, in mesh order.
 */
export function bmoExtrudeEdgeOnlyExec(
    bm: BMesh, edges: readonly BMEdge[], useNormalFlip = false, useSelectHistory = false,
): {verts: BMVert[], edges: BMEdge[], faces: BMFace[]} {
    const inE = new Set(edges) // EXT_INPUT
    const inV = new Set<BMVert>()
    for (const e of edges) {
        inV.add(e.v1)
        inV.add(e.v2)
    }
    // `duplicate geom=%fve use_select_history=%b`, nested.
    const dupe = bmoOpExec(bm, null, () => bmoDuplicateExec(bm, {
        verts: [...bm.verts].filter(v => inV.has(v)), edges: [...bm.edges].filter(e => inE.has(e)), faces: [],
    }))
    if (useSelectHistory) selectHistoryRemap(bm, new Map<Elem, Elem>([...dupe.vertMap, ...dupe.edgeMap]))

    const keep = new Set<Elem>() // EXT_KEEP
    for (const [eSrc, eNew] of dupe.boundaryMap) {
        let e = eSrc
        const edgeNormalFlip = !(e.l && e.v1 !== e.l.v)
        const fVerts = edgeNormalFlip === useNormalFlip
            ? [e.v1, e.v2, eNew.v2, eNew.v1]
            : [e.v2, e.v1, eNew.v1, eNew.v2]
        // "not sure what to do about example face, pass nullptr for now"
        const f = faceCreateVerts(bm, fVerts, null, true)!
        extrudeCopyFaceLoopAttributes(bm, f)
        if (inE.has(e)) e = eNew
        keep.add(f)
        keep.add(e)
        keep.add(e.v1)
        keep.add(e.v2)
    }
    return {
        verts: [...bm.verts].filter(v => keep.has(v)),
        edges: [...bm.edges].filter(e => keep.has(e)),
        faces: [...bm.faces].filter(f => keep.has(f)),
    }
}

/**
 * `bmo_extrude_vert_indiv_exec` (`:236`): each of `verts` gets a copy joined to it by a new edge.
 * Returns `verts.out` (the copies) and `edges.out`.
 */
export function bmoExtrudeVertIndivExec(bm: BMesh, verts: readonly BMVert[], useSelectHistory = false): {verts: BMVert[], edges: BMEdge[]} {
    const keepV = new Set<BMVert>(), keepE = new Set<BMEdge>() // EXT_KEEP
    for (const vIn of verts) {
        let v = vIn
        let dupev = bm.vertCreate(v.x, v.y, v.z, v) // `BM_vert_create(bm, v->co, v, BM_CREATE_NOP)`
        dupev.nx = v.nx; dupev.ny = v.ny; dupev.nz = v.nz
        keepV.add(dupev)
        if (useSelectHistory) selectHistoryRemap(bm, new Map<Elem, Elem>([[v, dupev]]))
        // not essential, but ensures face normals from extruded edges are contiguous
        if (v.e && v.e.l === null && v.e.diskNext(v) === v.e && v.e.v1 === v) { // BM_vert_is_wire_endpoint
            const t = v
            v = dupev
            dupev = t
        }
        const e = bm.edgeCreate(v, dupev)
        keepE.add(e)
    }
    return {verts: [...bm.verts].filter(v => keepV.has(v)), edges: [...bm.edges].filter(e => keepE.has(e))}
}

/** `bm_face_copy_impl` + `BM_face_copy` (`bmesh_core.cc`) with `copy_verts` and `copy_edges`. */
function faceCopy(bm: BMesh, f: BMFace): BMFace {
    const loops = f.loops()
    const len = loops.length
    const verts = loops.map(l => {
        const v = bm.vertCreate(l.v.x, l.v.y, l.v.z, l.v)
        v.nx = l.v.nx; v.ny = l.v.ny; v.nz = l.v.nz
        return v
    })
    const edges = loops.map((l, i) => {
        const [v1, v2] = l.e!.v1 === l.v ? [verts[i], verts[(i + 1) % len]] : [verts[(i + 1) % len], verts[i]]
        return bm.edgeCreate(v1, v2, l.e!)
    })
    const fCopy = bm.faceCreateWithEdges(verts, edges, f)
    const copyLoops = fCopy.loops()
    for (let i = 0; i < len; i++) {
        copyElemHeader(loops[i], copyLoops[i], 'loop')
        copyElemAttrs(loops[i], copyLoops[i], bm.ldata)
    }
    return fCopy
}

/**
 * `bmo_extrude_discrete_faces_exec` (`:42`): each face is copied with its own vertices and edges, joined
 * to its old rim by quads, and the original face removed (`DEL_ONLYFACES`). `faces.out`: the copies.
 */
export function bmoExtrudeDiscreteFacesExec(bm: BMesh, faces: readonly BMFace[], useSelectHistory = false): BMFace[] {
    const del = new Set<BMFace>() // EXT_DEL
    const keep = new Set<BMFace>() // EXT_KEEP
    const remap = new Map<Elem, Elem>()
    for (const fOrg of faces) {
        del.add(fOrg)
        const fNew = faceCopy(bm, fOrg)
        keep.add(fNew)
        remap.set(fOrg, fNew)
        let lOrg = fOrg.lFirst
        let lNew = fNew.lFirst
        do {
            copyElemHeader(lOrg, lNew, 'loop')
            copyElemAttrs(lOrg, lNew, bm.ldata)
            const fSide = faceCreateVerts(bm, [lOrg.next.v, lNew.next.v, lNew.v, lOrg.v], fOrg, true)!
            const side = fSide.loops()
            for (const [src, dst] of [[lOrg.next, side[0]], [lOrg.next, side[1]], [lOrg, side[2]], [lOrg, side[3]]] as [BMLoop, BMLoop][]) {
                copyElemHeader(src, dst, 'loop')
                copyElemAttrs(src, dst, bm.ldata)
            }
            remap.set(lOrg.v, lNew.v)
            remap.set(lOrg.e!, lNew.e!)
            lNew = lNew.next
            lOrg = lOrg.next
        } while (lOrg !== fOrg.lFirst)
    }
    if (useSelectHistory) selectHistoryRemap(bm, remap)
    // `delete geom=%ff context=DEL_ONLYFACES`, nested.
    bmoOpExec(bm, null, () => { for (const f of [...bm.faces]) if (del.has(f)) bm.faceKill(f) })
    return [...bm.faces].filter(f => keep.has(f))
}

// endregion

// region edit mode

/** `bmo_extrude_discrete_faces_def` / `bmo_extrude_edge_only_def` `type_flag`: NORMALS_CALC. */
const NORMALS_CALC: BmeshEditEndFlags = {normalsCalc: true}
/** `bmo_extrude_vert_indiv_def` `type_flag`: SELECT_FLUSH. */
const SELECT_FLUSH: BmeshEditEndFlags = {selectFlush: true}

export type ExtrudeIndivResult = {ok: true} | {ok: false, error: string}

/**
 * `edbm_extrude_discrete_faces` (`editmesh_extrude.cc:104`, `MESH_OT_extrude_faces_indiv`): extrude
 * each selected face on its own; the copies are selected, and their vertex normals set to their
 * face's normal, which is the direction the chained shrink/fatten moves them. The caller must not
 * recompute vertex normals before that transform (`EDBM_update` runs with `calc_normals = false`).
 */
export function extrudeDiscreteFacesSelection(bm: BMesh): ExtrudeIndivResult {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    const faces = selectedVisible(bm.faces)
    // deselect original verts
    edbmFlagDisableAll(bm, ElemFlag.Select)
    const out = bmoOpExec(bm, NORMALS_CALC, () => bmoExtrudeDiscreteFacesExec(bm, faces, true))
    for (const f of out) {
        faceSelectSet(bm, f, true)
        // set face vertex normals to face normal
        for (const l of f.eachLoop()) {
            l.v.nx = f.nx; l.v.ny = f.ny; l.v.nz = f.nz
        }
    }
    return {ok: true}
}

/**
 * `EDBM_extrude_edges_indiv` (`editmesh_extrude.cc:136`, `MESH_OT_extrude_edges_indiv`): extrude the
 * selected edges on their own into a ribbon; the new rim (vertices and edges) is selected.
 */
export function extrudeEdgesIndivSelection(bm: BMesh, useNormalFlip = false): ExtrudeIndivResult {
    if (bm.totedgesel === 0) return {ok: false, error: 'No edges selected'}
    const edges = selectedVisible(bm.edges)
    // deselect original verts (`BM_SELECT_HISTORY_BACKUP` / `_RESTORE` around it)
    const history = bm.selectHistory
    edbmFlagDisableAll(bm, ElemFlag.Select)
    bm.selectHistory = history
    const r = bmoOpExec(bm, NORMALS_CALC, () => bmoExtrudeEdgeOnlyExec(bm, edges, useNormalFlip, true))
    elemsHflagEnable(bm, [...r.verts, ...r.edges], ElemType.Vert | ElemType.Edge, ElemFlag.Select, true)
    return {ok: true}
}

/**
 * `edbm_extrude_verts_indiv` (`editmesh_extrude.cc:169`, `MESH_OT_extrude_verts_indiv`): each selected
 * vertex gets a new vertex joined by an edge; the new vertices are selected, the old ones not.
 */
export function extrudeVertsIndivSelection(bm: BMesh): ExtrudeIndivResult {
    if (bm.totvertsel === 0) return {ok: false, error: 'No vertices selected'}
    const verts = selectedVisible(bm.verts)
    // deselect original verts
    elemsHflagDisable(bm, verts, ElemType.Vert, ElemFlag.Select, true)
    const r = bmoOpExec(bm, SELECT_FLUSH, () => bmoExtrudeVertIndivExec(bm, verts, true))
    elemsHflagEnable(bm, r.verts, ElemType.Vert, ElemFlag.Select, true)
    return {ok: true}
}

// endregion
