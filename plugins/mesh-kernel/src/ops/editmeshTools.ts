/**
 * Edit-mode operators over the selection that wrap a ported `bmesh` operator: the `edbm_*_exec`
 * bodies of `source/blender/editors/mesh/editmesh_tools.cc` for Poke, Triangulate, Beautify, Wireframe,
 * Fill, Mark Seam / Sharp, Flip and Recalculate Normals and Delete Loose. Line references are to
 * `editmesh_tools.cc` (Blender main) unless stated.
 *
 * Each function is the loop body for one object: it reads the selection the way `EDBM_op_init` does
 * (`%hf` / `%he` / `%hv` with `BMO_FLAG_RESPECT_HIDE`: flagged and not hidden, in mesh order), runs the
 * operator as a top-level `BMO_op_exec` (with the operator's `type_flag` edit end, `bmoOpExec`) and
 * leaves the selection as Blender leaves it. The caller (the editor's session) then does what
 * `EDBM_update` does. A function returns `{ok: false}` for Blender's `continue` / `OPERATOR_CANCELLED`
 * paths, before touching the mesh, so a refused call changes nothing.
 *
 * Not ported: custom split normals (`BM_custom_loop_normals_to_vector_layer` /
 * `flip_custom_normals`) - the kernel has no custom normal layer, and without one Blender's calls are
 * no-ops.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {edgeIsBoundary, edgeIsWire} from '../bmesh/structure'
import {faceNormalFlip} from '../bmesh/flip'
import {selectModeFlush} from '../bmesh/marking'
import {edbmFlagDisableAll, elemHflagDisableAll, elemsHflagEnable} from '../bmesh/hflag'
import {DelContext, meshDeleteHflagContext} from '../bmesh/delete'
import {ElemFlag, ElemType} from '../constants'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {PokeCenterMode, pokeFaces} from './poke'
import {bmoTriangulate, TriangulateNgonMethod, TriangulateQuadMethod} from './triangulate'
import {bmoBeautifyFill} from './beautify'
import {edgeCalcFaceAngleEx} from './dissolveLimit'
import {wireframe} from './wireframe'
import {triangleFill} from './triangleFill'
import {recalcFaceNormals} from './edgenet'

export type EdbmResult<T = object> = ({ok: true} & T) | {ok: false, error: string}

/** `%hX` with `BM_ELEM_SELECT` under `BMO_FLAG_RESPECT_HIDE`: selected, not hidden, mesh order. */
function selectedVisible<T extends BMVert | BMEdge | BMFace>(elems: Iterable<T>): T[] {
    const out: T[] = []
    for (const e of elems) if ((e.hflag & ElemFlag.Select) && !(e.hflag & ElemFlag.Hidden)) out.push(e)
    return out
}

// region Poke (`edbm_poke_face_exec`, :5354)

/** `bmo_poke_def` `type_flag` (`bmesh_opdefines.cc`): NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE. */
const POKE_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

export interface PokeSelectionOptions {
    /** Blender's `offset` (`RNA_def_float_distance`, default 0, :5428). */
    offset?: number
    /** Blender's `use_relative_offset` (default false). */
    useRelativeOffset?: boolean
    /** Blender's `center_mode` (default `MEDIAN_WEIGHTED`), as the kernel's {@link PokeCenterMode}. */
    centerMode?: PokeCenterMode
}

/** `MESH_OT_poke` on the selected faces: each becomes a fan; the new centres and fans are selected. */
export function pokeFacesSelection(bm: BMesh, opts: PokeSelectionOptions = {}): EdbmResult<{verts: BMVert[], faces: BMFace[]}> {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    const faces = selectedVisible(bm.faces)
    const r = bmoOpExec(bm, POKE_TYPE_FLAG, () => pokeFaces(bm, faces, opts))
    edbmFlagDisableAll(bm, ElemFlag.Select)
    elemsHflagEnable(bm, r.verts, ElemType.Vert, ElemFlag.Select, true)
    elemsHflagEnable(bm, r.faces, ElemType.Face, ElemFlag.Select, true)
    return {ok: true, verts: r.verts, faces: r.faces}
}

// endregion

// region Triangulate Faces (`edbm_quads_convert_to_tris_exec`, :5450)

/**
 * `MESH_OT_quads_convert_to_tris` on the selected faces: triangulate, select the triangles, remove
 * the faces that duplicated existing ones (`face_map_double.out`), flush by the select mode.
 */
export function quadsConvertToTrisSelection(
    bm: BMesh, quadMethod: TriangulateQuadMethod = 'BEAUTY', ngonMethod: TriangulateNgonMethod = 'BEAUTY',
): EdbmResult<{faces: BMFace[]}> {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    const r = bmoTriangulate(bm, selectedVisible(bm.faces), quadMethod, ngonMethod)
    // select the output
    elemsHflagEnable(bm, r.faces, ElemType.Face, ElemFlag.Select, true)
    // remove the doubles
    for (const f of r.faceMapDouble.keys()) if (bm.faces.has(f)) bm.faceKill(f)
    selectModeFlush(bm) // EDBM_selectmode_flush
    return {ok: true, faces: r.faces.filter(f => bm.faces.has(f))}
}

// endregion

// region Beautify Faces (`edbm_beautify_fill_exec`, :5279)

/**
 * `MESH_OT_beautify_fill` on the selected faces. `angleLimit` (radians, Blender's `angle_limit`,
 * default 180 degrees) restricts the edges that may rotate to those flatter than it; at 180 every
 * selected edge may. The rotated edges and faces are added to the selection.
 */
export function beautifyFillSelection(bm: BMesh, angleLimit = Math.PI): EdbmResult {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    // `const float angle_max = M_PI;` and the RNA float are both float32.
    const angleMax = Math.fround(Math.PI)
    const limit = Math.fround(angleLimit)
    let hflag: number
    if (limit >= angleMax) {
        hflag = ElemFlag.Select
    } else {
        for (const e of bm.edges) {
            const tag = (e.hflag & ElemFlag.Select) !== 0 && edgeCalcFaceAngleEx(e, angleMax) < limit
            if (tag) e.hflag |= ElemFlag.Tag
            else e.hflag &= ~ElemFlag.Tag
        }
        hflag = ElemFlag.Tag
    }
    const faces = selectedVisible(bm.faces)
    const edges = [...bm.edges].filter(e => (e.hflag & hflag) && !(e.hflag & ElemFlag.Hidden))
    // `EDBM_op_call_and_selectf(em, op, "geom.out", true, "beautify_fill faces=%hf edges=%he", ..)`
    const r = bmoBeautifyFill(bm, faces, edges)
    elemsHflagEnable(bm, [...r.edges, ...r.faces], ElemType.Edge | ElemType.Face, ElemFlag.Select, true)
    return {ok: true}
}

// endregion

// region Wireframe (`edbm_wireframe_exec`, :7620)

/** `bmo_wireframe_def` `type_flag`: NORMALS_CALC | SELECT_FLUSH | SELECT_VALIDATE. */
const WIREFRAME_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

export interface WireframeSelectionOptions {
    /** Blender's `use_boundary` (default true, :7698). */
    useBoundary?: boolean
    /** `use_even_offset` (default true). */
    useEvenOffset?: boolean
    /** `use_relative_offset` (default false). */
    useRelativeOffset?: boolean
    /** `use_replace` (default true). */
    useReplace?: boolean
    /** `thickness` (default 0.01). */
    thickness?: number
    /** `offset` (default 0.01). */
    offset?: number
    /** `use_crease` (default false). */
    useCrease?: boolean
    /** `crease_weight` (default 0.01). */
    creaseWeight?: number
}

/** `MESH_OT_wireframe` on the selected faces; the frame's faces end up the selection. */
export function wireframeSelection(bm: BMesh, opts: WireframeSelectionOptions = {}): EdbmResult<{faces: BMFace[]}> {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    const faces = selectedVisible(bm.faces)
    const r = bmoOpExec(bm, WIREFRAME_TYPE_FLAG, () => wireframe(bm, faces, opts))
    elemHflagDisableAll(bm, ElemType.Vert | ElemType.Edge | ElemType.Face, ElemFlag.Select, false)
    elemsHflagEnable(bm, r.faces, ElemType.Face, ElemFlag.Select, true)
    return {ok: true, faces: r.faces}
}

// endregion

// region Fill (`edbm_fill_exec`, :4677)

/** `bmo_triangle_fill_def` `type_flag`: NORMALS_CALC | SELECT_FLUSH. */
const TRIANGLE_FILL_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: false}

/**
 * `MESH_OT_fill` (Alt+F): fill the closed loops of selected edges with triangles, beautified by
 * default (`use_beauty`, :4755). The new edges and faces are added to the selection.
 */
export function triangleFillSelection(bm: BMesh, useBeauty = true): EdbmResult<{faces: BMFace[]}> {
    if (bm.totedgesel === 0) return {ok: false, error: 'No edges selected'}
    const totfaceOrig = bm.totface
    const edges = selectedVisible(bm.edges)
    const r = bmoOpExec(bm, TRIANGLE_FILL_TYPE_FLAG, () => triangleFill(bm, edges, {useBeauty}))
    // cancel if nothing was done
    if (totfaceOrig === bm.totface) return {ok: false, error: 'No faces filled'}
    // select new geometry
    elemsHflagEnable(bm, [...r.edges, ...r.faces], ElemType.Edge | ElemType.Face, ElemFlag.Select, true)
    return {ok: true, faces: r.faces}
}

// endregion

// region Mark Seam / Mark Sharp (`edbm_mark_seam_exec` :1036, `edbm_mark_sharp_exec` :1115)

/** `MESH_OT_mark_seam`: set (or with `clear`, clear) the seam flag of the selected visible edges. */
export function markSeamSelection(bm: BMesh, clear = false): EdbmResult {
    if (bm.totedgesel === 0) return {ok: false, error: 'No edges selected'}
    for (const e of bm.edges) {
        if (!(e.hflag & ElemFlag.Select) || (e.hflag & ElemFlag.Hidden)) continue
        if (clear) e.hflag &= ~ElemFlag.Seam
        else e.hflag |= ElemFlag.Seam
    }
    return {ok: true}
}

/**
 * `MESH_OT_mark_sharp`: mark the selected edges sharp (clear their smooth flag), or with `clear`
 * smooth. With `useVerts`, every edge with a selected vertex - Blender does not test visibility here.
 */
export function markSharpSelection(bm: BMesh, clear = false, useVerts = false): EdbmResult {
    if ((useVerts && bm.totvertsel === 0) || (!useVerts && bm.totedgesel === 0)) {
        return {ok: false, error: useVerts ? 'No vertices selected' : 'No edges selected'}
    }
    for (const e of bm.edges) {
        if (useVerts) {
            if (!((e.v1.hflag & ElemFlag.Select) || (e.v2.hflag & ElemFlag.Select))) continue
        } else if (!(e.hflag & ElemFlag.Select)) {
            continue
        }
        // `BM_elem_flag_set(eed, BM_ELEM_SMOOTH, clear)`
        if (clear) e.hflag |= ElemFlag.Smooth
        else e.hflag &= ~ElemFlag.Smooth
    }
    return {ok: true}
}

// endregion

// region Normals (`edbm_flip_normals_exec` :2342, `edbm_normals_make_consistent_exec` :2664)

/** `bmo_reverse_faces_def` / `bmo_recalc_face_normals_def` `type_flag`: NORMALS_CALC. */
const NORMALS_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true}

/** `reverse_faces faces=%hf flip_multires=true` (`bmo_reverse_faces_exec`, `bmo_utils.cc:156`). */
function reverseFaces(bm: BMesh, faces: readonly BMFace[]): void {
    bmoOpExec(bm, NORMALS_TYPE_FLAG, () => {
        for (const f of faces) faceNormalFlip(f)
    })
}

/** `MESH_OT_flip_normals` (`only_clnors` false): reverse the winding of the selected faces. */
export function flipNormalsSelection(bm: BMesh): EdbmResult {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    reverseFaces(bm, selectedVisible(bm.faces))
    return {ok: true}
}

/**
 * `MESH_OT_normals_make_consistent`: wind every connected group of selected faces consistently,
 * outwards (`recalc_face_normals`), then with `inside` reverse them all.
 */
export function normalsMakeConsistentSelection(bm: BMesh, inside = false): EdbmResult {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    const faces = selectedVisible(bm.faces)
    bmoOpExec(bm, NORMALS_TYPE_FLAG, () => recalcFaceNormals(bm, faces))
    if (inside) reverseFaces(bm, selectedVisible(bm.faces))
    return {ok: true}
}

// endregion

// region Delete Loose (`edbm_delete_loose_exec`, :585)

/** `bm_face_is_loose` (:571): every edge of the face is a boundary. */
function faceIsLoose(f: BMFace): boolean {
    for (const l of f.eachLoop()) if (!edgeIsBoundary(l.e!)) return false
    return true
}

export interface DeleteLooseOptions {
    /** Blender's `use_verts` (default true, :677). */
    useVerts?: boolean
    /** `use_edges` (default true). */
    useEdges?: boolean
    /** `use_faces` (default false). */
    useFaces?: boolean
}

/**
 * `MESH_OT_delete_loose`: delete the selected loose faces (all edges boundary), wire edges and
 * vertices without edges, then deselect everything. `removed` is what Blender reports ("Removed: %d
 * vertices, %d edges, %d faces", `edbm_report_delete_info` :433).
 */
export function deleteLooseSelection(bm: BMesh, opts: DeleteLooseOptions = {}): EdbmResult<{removed: [number, number, number]}> {
    const old: [number, number, number] = [bm.totvert, bm.totedge, bm.totface]
    const useVerts = (opts.useVerts ?? true) && bm.totvertsel > 0
    const useEdges = (opts.useEdges ?? true) && bm.totedgesel > 0
    const useFaces = (opts.useFaces ?? false) && bm.totfacesel > 0

    elemHflagDisableAll(bm, ElemType.Vert | ElemType.Edge | ElemType.Face, ElemFlag.Tag, false)
    if (useFaces) {
        for (const f of bm.faces) {
            if (!(f.hflag & ElemFlag.Select)) continue
            if (faceIsLoose(f)) f.hflag |= ElemFlag.Tag
            else f.hflag &= ~ElemFlag.Tag
        }
        meshDeleteHflagContext(bm, ElemFlag.Tag, DelContext.Faces)
    }
    if (useEdges) {
        for (const e of bm.edges) {
            if (!(e.hflag & ElemFlag.Select)) continue
            if (edgeIsWire(e)) e.hflag |= ElemFlag.Tag
            else e.hflag &= ~ElemFlag.Tag
        }
        meshDeleteHflagContext(bm, ElemFlag.Tag, DelContext.Edges)
    }
    if (useVerts) {
        for (const v of bm.verts) {
            if (!(v.hflag & ElemFlag.Select)) continue
            if (v.e === null) v.hflag |= ElemFlag.Tag
            else v.hflag &= ~ElemFlag.Tag
        }
        meshDeleteHflagContext(bm, ElemFlag.Tag, DelContext.Verts)
    }
    edbmFlagDisableAll(bm, ElemFlag.Select)
    return {ok: true, removed: [old[0] - bm.totvert, old[1] - bm.totedge, old[2] - bm.totface]}
}

// endregion
