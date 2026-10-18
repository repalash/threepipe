/**
 * Edit-mode Solidify: `bmo_solidify_face_region_exec` (`source/blender/bmesh/operators/bmo_extrude.cc:836`)
 * with `calc_solidify_normals` (`:640`) and `solidify_add_thickness` (`:785`), and the edit-mode
 * operator over it (`edbm_solidify_exec`, `editors/mesh/editmesh_tools.cc:4116`).
 *
 * This is not the Solidify *modifier* (`solidify.ts`, `MOD_solidify_extrude.cc`): the operator
 * reverses the region, extrudes it keeping the originals, and pushes the new cap along shell-corrected
 * vertex normals of the cap alone. Operator flags (`FACE_MARK`, `EDGE_MARK`, `VERT_MARK`,
 * `EDGE_NONMAN`, `VERT_NONMAN`) are sets; `BM_ELEM_TAG` on vertices is a set too.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {faceNormalFlip} from '../bmesh/flip'
import {vertIsManifold} from '../bmesh/query'
import {elemsHflagDisable, elemsHflagEnable, selectHistoryClear} from '../bmesh/hflag'
import {ElemFlag, ElemType} from '../constants'
import {angleNormalizedV3V3, anglePolyV3, normalizeV3Len, normalizeV3Length, shellV3V3NormalizedToDist} from '../math/geom'
import type {Vec3} from '../math'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {bmVertNormalUpdate} from './connect'
import {extrudeFaceRegion} from './extrude'
import {loopsOfVert} from './dissolve'

const fno = (f: BMFace): Vec3 => [f.nx, f.ny, f.nz]

/**
 * `calc_solidify_normals` (`:640`): vertex normals of the marked region weighted by the angle across
 * each edge, falling back to the plain vertex normal at non-manifold vertices.
 */
function calcSolidifyNormals(bm: BMesh, faceMark: ReadonlySet<BMFace>): void {
    const edgeMark = new Set<BMEdge>(), vertMark = new Set<BMVert>()
    const edgeNonman = new Set<BMEdge>(), vertNonman = new Set<BMVert>()
    // can't use BM_edge_face_count because we need to count only marked faces
    const edgeFaceCount = new Map<BMEdge, number>()
    const vertTag = new Set<BMVert>(bm.verts) // BM_ELEM_TAG enabled on every vertex

    for (const f of bm.faces) {
        if (!faceMark.has(f)) continue
        for (const l of f.eachLoop()) {
            // And mark all edges and vertices on the marked faces
            const e = l.e!
            edgeMark.add(e)
            vertMark.add(e.v1)
            vertMark.add(e.v2)
            edgeFaceCount.set(e, (edgeFaceCount.get(e) ?? 0) + 1)
        }
    }
    for (const e of bm.edges) {
        if (!edgeMark.has(e)) continue
        const i = edgeFaceCount.get(e) ?? 0
        if (i === 0 || i > 2) {
            // Edge & vertices are non-manifold even when considering only marked faces
            edgeNonman.add(e)
            vertNonman.add(e.v1)
            vertNonman.add(e.v2)
        }
    }
    for (const v of bm.verts) {
        if (!vertIsManifold(v)) {
            vertNonman.add(v)
            continue
        }
        if (vertMark.has(v)) {
            v.nx = 0
            v.ny = 0
            v.nz = 0
        }
    }
    for (const e of bm.edges) {
        // If the edge is not part of the solidify region its normal should not be considered
        if (!edgeMark.has(e)) continue
        // If the edge joins more than two marked faces high quality normal computation won't work
        if (edgeNonman.has(e)) continue
        let f1: BMFace | null = null, f2: BMFace | null = null
        let l = e.l
        if (l) {
            do {
                if (faceMark.has(l.f)) {
                    if (f1 === null) f1 = l.f
                    else f2 = l.f
                }
            } while ((l = l.radialNext!) !== e.l)
        }
        let edgeNormal: Vec3
        if (f2 !== null) {
            const angle = angleNormalizedV3V3(fno(f1!), fno(f2))
            if (angle > 0) {
                // two faces using this edge, calculate the edge normal using the angle between the
                // faces as a weighting
                edgeNormal = [f1!.nx + f2.nx, f1!.ny + f2.ny, f1!.nz + f2.nz]
                normalizeV3Length(edgeNormal, angle)
            } else {
                // can't do anything useful here! Set the face index for a vert in case it gets a zero normal
                vertTag.delete(e.v1)
                vertTag.delete(e.v2)
                continue
            }
        } else {
            // only one face attached to that edge; "M_PI_2 is 90d in radians and that seems good enough"
            edgeNormal = [f1!.nx * Math.PI / 2, f1!.ny * Math.PI / 2, f1!.nz * Math.PI / 2]
        }
        e.v1.nx += edgeNormal[0]; e.v1.ny += edgeNormal[1]; e.v1.nz += edgeNormal[2]
        e.v2.nx += edgeNormal[0]; e.v2.ny += edgeNormal[1]; e.v2.nz += edgeNormal[2]
    }
    // normalize accumulated vertex normal
    for (const v of bm.verts) {
        if (!vertMark.has(v)) continue
        if (vertNonman.has(v)) {
            // use standard normals for vertices connected to non-manifold edges
            bmVertNormalUpdate(v)
            continue
        }
        const no: Vec3 = [v.nx, v.ny, v.nz]
        const len = normalizeV3Len(no)
        v.nx = no[0]; v.ny = no[1]; v.nz = no[2]
        if (len === 0 && !vertTag.has(v)) {
            // exceptional case, totally flat. use the normal of any marked face around the vertex
            let found: BMFace | null = null
            for (const l of loopsOfVert(v)) {
                if (faceMark.has(l.f)) {
                    found = l.f
                    break
                }
            }
            if (found) {
                v.nx = found.nx; v.ny = found.ny; v.nz = found.nz
            }
        }
    }
}

/** `solidify_add_thickness` (`:785`): push each vertex of the marked faces along its normal, shell-corrected and angle-weighted. */
function solidifyAddThickness(bm: BMesh, faceMark: ReadonlySet<BMFace>, dist: number): void {
    const vertAngles = new Map<BMVert, number>()
    const vertAccum = new Map<BMVert, number>()
    for (const f of bm.faces) {
        if (!faceMark.has(f)) continue
        const loops = f.loops()
        const faceAngles = anglePolyV3(loops.map(l => [l.v.x, l.v.y, l.v.z] as Vec3))
        loops.forEach((l, i) => {
            const v = l.v
            vertAccum.set(v, Math.fround((vertAccum.get(v) ?? 0) + faceAngles[i]))
            vertAngles.set(v, Math.fround((vertAngles.get(v) ?? 0)
                + Math.fround(shellV3V3NormalizedToDist([v.nx, v.ny, v.nz], fno(f)) * faceAngles[i])))
        })
    }
    for (const v of bm.verts) {
        const accum = vertAccum.get(v) ?? 0
        if (accum) { // zero if unselected
            const s = Math.fround(dist * Math.fround(vertAngles.get(v)! / accum))
            v.setCo(v.x + v.nx * s, v.y + v.ny * s, v.z + v.nz * s)
        }
    }
}

/**
 * `bmo_solidify_face_region_exec` (`:836`): give the region `faces` a thickness. Returns `geom.out`'s
 * faces, the new (inner) cap.
 */
export function solidifyFaceRegion(bm: BMesh, faces: readonly BMFace[], thickness: number): BMFace[] {
    // Flip original faces (so the shell is extruded inward): `reverse_faces`, nested.
    bmoOpExec(bm, null, () => { for (const f of faces) faceNormalFlip(f) })
    // Extrude the region: `extrude_face_region use_keep_orig=true`, nested.
    const r = bmoOpExec(bm, null, () => extrudeFaceRegion(bm, [...faces], {keepOriginal: true, selectResult: false}))
    if (!r) return []
    // Push the verts of the extruded faces inward to create thickness. `geom.out` is the duplicate's.
    const faceMark = new Set(r.faces)
    calcSolidifyNormals(bm, faceMark)
    solidifyAddThickness(bm, faceMark, thickness)
    return [...bm.faces].filter(f => faceMark.has(f))
}

/** `bmo_solidify_def` `type_flag`: NORMALS_CALC | SELECT_FLUSH. */
const SOLIDIFY_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true}

/**
 * `MESH_OT_solidify` (`edbm_solidify_exec`, `editmesh_tools.cc:4116`): solidify the selected faces by
 * `thickness` (default 0.01); the new faces end up selected, the originals not.
 */
export function solidifySelectionOperator(bm: BMesh, thickness = 0.01): {ok: true, faces: BMFace[]} | {ok: false, error: string} {
    if (bm.totfacesel === 0) return {ok: false, error: 'No faces selected'}
    const faces = [...bm.faces].filter(f => (f.hflag & ElemFlag.Select) && !(f.hflag & ElemFlag.Hidden))
    // deselect only the faces in the region to be solidified (leave wire edges and loose verts
    // selected, as there will be no corresponding geometry selected below)
    elemsHflagDisable(bm, faces, ElemType.Face, ElemFlag.Select, true)
    const out = bmoOpExec(bm, SOLIDIFY_TYPE_FLAG, () => solidifyFaceRegion(bm, faces, Math.fround(thickness)))
    // select the newly generated faces
    elemsHflagEnable(bm, out, ElemType.Face, ElemFlag.Select, true)
    // No need to flush the selection, any selection history is no longer valid.
    selectHistoryClear(bm)
    return {ok: true, faces: out}
}
