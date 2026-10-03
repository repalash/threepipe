/**
 * Triangulate: split quads (and, not yet, n-gons) into triangles.
 *
 * Ported from `source/blender/bmesh/operators/bmo_triangulate.cc` (`bmo_triangulate_exec`),
 * `bmesh/tools/bmesh_triangulate.cc` (`BM_mesh_triangulate`, `bm_face_triangulate_mapping`),
 * `bmesh/intern/bmesh_polygon.cc:1103` (`BM_face_triangulate`) and `bmesh_core.cc:2998`
 * (`bmesh_face_swap_data`). Bridge Edge Loops runs it on the quads it makes between loops of
 * different lengths.
 *
 * Only the quad branch of `BM_face_triangulate` is ported. The n-gon branch needs
 * `BLI_polyfill_calc_arena` and `BLI_polyfill_beautify` (`blenlib/intern/polyfill_2d.cc`,
 * `polyfill_2d_beautify.cc`), which the kernel does not have; it throws (see
 * `issues/open/modelling-tools/kernel-triangulate-ngon-polyfill.md`).
 *
 * `BM_ELEM_TAG` is the shared header bit `ElemFlag.Tag`, as in Blender: callers tag the faces to
 * triangulate and read the tagged output.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists} from '../bmesh/structure'
import {copyElemAttrs, copyElemHeader} from '../bmesh/customdata'
import {elemHflagDisableAll} from '../bmesh/hflag'
import {ElemFlag, ElemType} from '../constants'
import {Vec3} from '../math'
import {isQuadFlipV3, lenSquaredV3V3} from '../math/geom'
import {vertsCalcRotateBeauty} from './beautify'
import {BmeshEditEndFlags} from './edgenet'
import {bmoOpExec} from './subdivideEdgering'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

// region helpers (bmesh_core / bmesh_construct, generic - exported for reuse)

/**
 * `BM_face_create_verts` (`bmesh_core.cc:596`) with `BM_CREATE_NOP`. With `createEdges` the edges
 * are made by `BM_edges_from_verts_ensure` (`bmesh_construct.cc:57`) - in its order, the closing edge
 * `(verts[len-1], verts[0])` first - otherwise they must exist (`BM_edges_from_verts`) or null is
 * returned.
 */
export function faceCreateVerts(bm: BMesh, verts: readonly BMVert[], example: BMFace | null, createEdges: boolean): BMFace | null {
    const len = verts.length
    const edges: BMEdge[] = new Array(len)
    let iPrev = len - 1
    for (let i = 0; i < len; i++) {
        if (createEdges) {
            edges[iPrev] = bm.edgeCreate(verts[iPrev], verts[i], undefined, {noDouble: true})
        } else {
            const e = diskEdgeExists(verts[iPrev], verts[i])
            if (!e) return null
            edges[iPrev] = e
        }
        iPrev = i
    }
    return bm.faceCreateWithEdges([...verts], edges, example ?? undefined)
}

/** `BM_elem_attrs_copy` for loops (`bmesh_construct.cc:357`): corner data plus the header rule. */
export function loopAttrsCopy(bm: BMesh, src: BMLoop, dst: BMLoop): void {
    if (src === dst) return
    copyElemAttrs(src, dst, bm.ldata)
    copyElemHeader(src, dst, 'loop')
}

/**
 * `bmesh_face_swap_data` (`bmesh_core.cc:2998`): swap everything but the custom-data block and the
 * index between two faces - the loop cycles (with their `f` pointers), length, normal, material and
 * header flags. `BM_face_triangulate` uses it to keep the original face alive as the last triangle.
 * Like Blender it does not touch the selection counters.
 */
export function faceSwapData(fA: BMFace, fB: BMFace): void {
    if (fA === fB) throw new Error('mesh-kernel: faceSwapData needs two different faces')
    for (const l of fA.loops()) l.f = fB
    for (const l of fB.loops()) l.f = fA

    const lFirst = fA.lFirst
    fA.lFirst = fB.lFirst
    fB.lFirst = lFirst
    const len = fA.len
    fA.len = fB.len
    fB.len = len
    const [nx, ny, nz] = [fA.nx, fA.ny, fA.nz]
    fA.nx = fB.nx
    fA.ny = fB.ny
    fA.nz = fB.nz
    fB.nx = nx
    fB.ny = ny
    fB.nz = nz
    const matNr = fA.matNr
    fA.matNr = fB.matNr
    fB.matNr = matNr
    const hflag = fA.hflag
    fA.hflag = fB.hflag
    fB.hflag = hflag
    // swap back: `head.data` and `head.index` stay with their face
}

// endregion

// region triangulate

/** `MOD_TRIANGULATE_QUAD_*` (`DNA_modifier_types.h:1923`). */
export type TriangulateQuadMethod = 'BEAUTY' | 'FIXED' | 'ALTERNATE' | 'SHORT_EDGE' | 'LONG_EDGE'
/** `MOD_TRIANGULATE_NGON_*`. */
export type TriangulateNgonMethod = 'BEAUTY' | 'EAR_CLIP'

/** What {@link faceTriangulate} made. */
export interface FaceTriangulateResult {
    /** New faces, not including `f` itself (which becomes the last triangle). */
    facesNew: BMFace[]
    /** Edges created by the triangulation. */
    edgesNew: BMEdge[]
    /** Triangles that duplicate an existing one (`r_faces_double`), most recent first. */
    facesDouble: BMFace[]
}

/**
 * `BM_face_triangulate` (`bmesh_polygon.cc:1103`): split `f` (more than three corners) into
 * triangles; `f` itself survives as the last one (`bmesh_face_swap_data`). With `useTag`, the new
 * faces (not `f`) and new edges get `ElemFlag.Tag` (tags are never cleared).
 *
 * Only quads are ported; an n-gon needs `BLI_polyfill_calc_arena` / `BLI_polyfill_beautify`
 * (`polyfill_2d.cc`), which the kernel does not have, and throws.
 */
export function faceTriangulate(
    bm: BMesh, f: BMFace, quadMethod: TriangulateQuadMethod, _ngonMethod: TriangulateNgonMethod, useTag: boolean,
): FaceTriangulateResult {
    if (f.len <= 3) throw new Error(`mesh-kernel: faceTriangulate needs more than three corners, face ${f.id} has ${f.len}`)
    const out: FaceTriangulateResult = {facesNew: [], edgesNew: [], facesDouble: []}

    const totfilltri = f.len - 2
    const lastTri = f.len - 3
    const loops: BMLoop[] = []
    const tris: [number, number, number][] = []

    if (f.len === 4) {
        // even though we're not using BLI_polyfill, fill in 'tris' and 'loops' so we can share code
        // to handle face creation afterwards.
        const lFirst = f.lFirst
        let lV1: BMLoop, lV2: BMLoop
        switch (quadMethod) {
        case 'FIXED':
            lV1 = lFirst
            lV2 = lFirst.next.next
            break
        case 'ALTERNATE':
            lV1 = lFirst.next
            lV2 = lFirst.prev
            break
        case 'SHORT_EDGE':
        case 'LONG_EDGE':
        case 'BEAUTY':
        default: {
            lV1 = lFirst.next
            lV2 = lFirst.next.next
            const lV3 = lFirst.prev
            const lV4 = lFirst
            let split24: boolean
            if (quadMethod === 'SHORT_EDGE') {
                const d1 = lenSquaredV3V3(co(lV4.v), co(lV2.v))
                const d2 = lenSquaredV3V3(co(lV1.v), co(lV3.v))
                split24 = (d2 - d1) > 0
            } else if (quadMethod === 'LONG_EDGE') {
                const d1 = lenSquaredV3V3(co(lV4.v), co(lV2.v))
                const d2 = lenSquaredV3V3(co(lV1.v), co(lV3.v))
                split24 = (d2 - d1) < 0
            } else {
                // first check if the quad is concave on either diagonal
                const flipFlag = isQuadFlipV3(co(lV1.v), co(lV2.v), co(lV3.v), co(lV4.v))
                if (flipFlag & (1 << 0)) split24 = true
                else if (flipFlag & (1 << 1)) split24 = false
                else split24 = vertsCalcRotateBeauty(lV1.v, lV2.v, lV3.v, lV4.v, 0, 0) > 0
            }
            // named confusingly, l_v1 is in fact the second vertex
            if (split24) lV1 = lV4
            else lV2 = lV3
            break
        }
        }

        loops[0] = lV1
        loops[1] = lV1.next
        loops[2] = lV2
        loops[3] = lV2.next

        tris.push([0, 1, 2], [0, 2, 3])
    } else {
        throw new Error('mesh-kernel: n-gon triangulation (BLI_polyfill_calc_arena) is not ported; only quads')
    }

    // loop over calculated triangles and create new geometry
    let fNew: BMFace | null = null
    for (let i = 0; i < totfilltri; i++) {
        const ltri = [loops[tris[i][0]], loops[tris[i][1]], loops[tris[i][2]]]
        const vTri = [ltri[0].v, ltri[1].v, ltri[2].v]

        fNew = faceCreateVerts(bm, vTri, f, true)!
        const lNew = fNew.lFirst

        // check for duplicate
        if (lNew.radialNext !== lNew) {
            let lIter = lNew.radialNext!
            do {
                if (lIter.f.len === 3 && lNew.prev.v === lIter.prev.v) {
                    // Check the last tri because we swap last f_new with f at the end...
                    out.facesDouble.unshift(i !== lastTri ? fNew : f)
                    break
                }
            } while ((lIter = lIter.radialNext!) !== lNew)
        }

        // copy CD data
        loopAttrsCopy(bm, ltri[0], lNew)
        loopAttrsCopy(bm, ltri[1], lNew.next)
        loopAttrsCopy(bm, ltri[2], lNew.prev)

        // add all but the last face which is swapped and removed (below)
        if (i !== lastTri) {
            if (useTag) fNew.hflag |= ElemFlag.Tag
            out.facesNew.push(fNew)
        }

        // new faces loops
        let lIter = lNew
        do {
            const e = lIter.e!
            // Confusing! if its not a boundary now, we know it will be later since this will be an
            // edge of one of the new faces which we're in the middle of creating.
            const isNewEdge = lIter === lIter.radialNext
            if (isNewEdge) {
                if (useTag) e.hflag |= ElemFlag.Tag
                out.edgesNew.push(e)
            }
            // NOTE: never disable tag's.
        } while ((lIter = lIter.next) !== lNew)
    }

    // we can't delete the real face, because some of the callers expect it to remain valid. so swap
    // data and delete the last created tri
    faceSwapData(f, fNew!)
    bm.faceKill(fNew!)

    return out
}

/**
 * `BM_mesh_triangulate` (`bmesh_triangulate.cc:80`): triangulate every face (only the
 * `ElemFlag.Tag`ged ones with `tagOnly`) of at least `minVertices` corners, in mesh order. With
 * `keepDoubles` (Blender: a `face_map.out` slot was given, as `bmo_triangulate_exec` always does)
 * duplicate triangles are left in the mesh and returned; otherwise they are killed.
 */
export function meshTriangulate(
    bm: BMesh, quadMethod: TriangulateQuadMethod, ngonMethod: TriangulateNgonMethod, minVertices: number,
    tagOnly: boolean, keepDoubles: boolean,
): {faceMap: Map<BMFace, BMFace>, facesDouble: Map<BMFace, BMFace>} {
    const faceMap = new Map<BMFace, BMFace>()
    const facesDouble = new Map<BMFace, BMFace>()
    const doubles: BMFace[] = []
    // `BM_ITER_MESH` over faces: faces created while iterating are visited too (the mempool grows at
    // its end), but they are triangles, below `minVertices`.
    const iter = bm.faces.values()
    for (let r = iter.next(); !r.done; r = iter.next()) {
        const face = r.value
        if (face.len >= minVertices) {
            if (tagOnly === false || face.testFlag(ElemFlag.Tag)) {
                const res = faceTriangulate(bm, face, quadMethod, ngonMethod, tagOnly)
                if (keepDoubles) {
                    // `bm_face_triangulate_mapping` (`:33`)
                    if (res.facesNew.length) {
                        faceMap.set(face, face)
                        for (const fNew of res.facesNew) faceMap.set(fNew, face)
                        for (const fd of res.facesDouble) facesDouble.set(fd, face)
                    }
                } else {
                    doubles.unshift(...res.facesDouble)
                }
            }
        }
    }
    for (const f of doubles) bm.faceKill(f)
    return {faceMap, facesDouble}
}

/** Result of {@link bmoTriangulateExec}. */
export interface TriangulateResult {
    edges: BMEdge[]
    faces: BMFace[]
    faceMap: Map<BMFace, BMFace>
    faceMapDouble: Map<BMFace, BMFace>
}

/**
 * `bmo_triangulate_exec` (`bmo_triangulate.cc:29`), as a nested operator (no `bmesh_edit_end`).
 * Clears `ElemFlag.Tag` on every face and edge, tags `faces`, triangulates them; `faces.out` /
 * `edges.out` are every tagged face / edge afterwards, in mesh order.
 */
export function bmoTriangulateExec(
    bm: BMesh, faces: Iterable<BMFace>, quadMethod: TriangulateQuadMethod = 'BEAUTY',
    ngonMethod: TriangulateNgonMethod = 'BEAUTY',
): TriangulateResult {
    const input = [...faces]
    elemHflagDisableAll(bm, ElemType.Face | ElemType.Edge, ElemFlag.Tag, false)
    for (const f of input) f.hflag |= ElemFlag.Tag

    const {faceMap, facesDouble} = meshTriangulate(bm, quadMethod, ngonMethod, 4, true, true)

    return {
        edges: [...bm.edges].filter(e => e.testFlag(ElemFlag.Tag)),
        faces: [...bm.faces].filter(f => f.testFlag(ElemFlag.Tag)),
        faceMap,
        faceMapDouble: facesDouble,
    }
}

// endregion

/** `bmo_triangulate_def` `type_flag` (`bmesh_opdefines.cc:1663`): no `SELECT_VALIDATE`. */
const TRIANGULATE_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: false}

/**
 * `bmesh.ops.triangulate`: {@link bmoTriangulateExec} run as a top-level operator (`BMO_op_exec`:
 * re-index, the operator, normals update and select-mode flush, `bmesh_edit_end`). Face normals must
 * be current (`BLI_assert(BM_face_is_normal_valid(f))`), as edit mode keeps them.
 */
export function bmoTriangulate(
    bm: BMesh, faces: Iterable<BMFace>, quadMethod: TriangulateQuadMethod = 'BEAUTY',
    ngonMethod: TriangulateNgonMethod = 'BEAUTY',
): TriangulateResult {
    const input = [...faces]
    return bmoOpExec(bm, TRIANGULATE_TYPE_FLAG, () => bmoTriangulateExec(bm, input, quadMethod, ngonMethod))
}
