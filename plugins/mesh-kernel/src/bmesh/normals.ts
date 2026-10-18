/**
 * `BM_mesh_normals_update` (`bmesh/intern/bmesh_mesh_normals.cc:257`): face normals from the polygon
 * (`bm_face_calc_normals_cb` :233, `BM_face_calc_normal`), then vertex normals as the corner-angle
 * weighted sum of the adjacent face normals (`bm_vert_calc_normals_impl` :85 with
 * `bm_vert_calc_normals_accum_loop` :66).
 *
 * This is the kernel's one normals update. Operators read `f->no` / `v->no` on entry, as Blender's do,
 * and the callers keep them current the way Blender does:
 * - an edit session after every committed operator (`EDBM_update` with `calc_normals`), after a modal
 *   transform, on entry and after an undo step (`plugin-mesh-edit` `MeshEditPlugin`);
 * - a bmesh operator whose `type_flag` has `BMO_OPTYPE_FLAG_NORMALS_CALC`, in `bmesh_edit_end`
 *   (`ops/bmo.ts` `bmeshEditEnd`);
 * - a mesh converted for an operator, with `calcFaceNormal` / `calcVertNormal` (`bmFromMesh`).
 */

import {BMLoop, BMVert} from './types'
import {BMesh} from './BMesh'
import {diskEdges} from './structure'
import {faceNormalUpdate} from './polygon'
import {Vec3, v3dot, v3normalize, v3sub} from '../math'

const vertCo = (v: BMVert): Vec3 => [v.x, v.y, v.z]

export function meshNormalsUpdate(bm: BMesh): void {
    // `BM_mesh_normals_update_ex` (:242): every face, then every vertex.
    for (const f of bm.faces) faceNormalUpdate(f)
    for (const v of bm.verts) vertCalcNormalsImpl(v)
}

/** `bm_vert_calc_normals_impl` (`bmesh_mesh_normals.cc:85`). */
export function vertCalcNormalsImpl(v: BMVert): void {
    const n: Vec3 = [0, 0, 0]
    if (v.e) {
        for (const e of diskEdges(v)) {
            const lFirst = e.l
            if (!lFirst) continue
            const e2diff = v3normalize(v3sub(vertCo(e.v1), vertCo(e.v2)))
            let l: BMLoop = lFirst
            do {
                if (l.v === v) {
                    const ePrev = l.prev.e!
                    const e1diff = v3normalize(v3sub(vertCo(ePrev.v1), vertCo(ePrev.v2)))
                    // `bm_vert_calc_normals_accum_loop` (:66): edge vectors run v1 -> v2, so flip the
                    // dot product when exactly one of the two loops runs the other way.
                    let dot = v3dot(e1diff, e2diff)
                    if ((ePrev.v1 === l.prev.v) !== (l.e!.v1 === l.v)) dot = -dot
                    const fac = Math.acos(Math.max(-1, Math.min(1, -dot)))
                    n[0] += l.f.nx * fac
                    n[1] += l.f.ny * fac
                    n[2] += l.f.nz * fac
                }
                l = l.radialNext!
            } while (l !== lFirst)
        }
    }
    let out = v3normalize(n)
    if (out[0] === 0 && out[1] === 0 && out[2] === 0) {
        // "Fallback normal." (:144): a vertex with no faces, or whose face normals cancel out.
        out = v3normalize(vertCo(v))
    }
    v.nx = out[0]
    v.ny = out[1]
    v.nz = out[2]
}
