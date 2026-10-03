/**
 * `BM_mesh_normals_update` (`bmesh/intern/bmesh_mesh_normals.cc`): face normals from the polygon,
 * vertex normals as the corner-angle weighted sum of the adjacent face normals
 * (`bm_vert_calc_normals_accum_loop`).
 *
 * Edit mode keeps these current; the operators that read `v->no` (subdivide's smoothing, the edge
 * ring's surface tangents) run on them. This moved here from `plugin-mesh-edit`'s `bmeshQuery.ts`
 * when the subdivide port needed it in the kernel.
 */

import {BMLoop, BMVert} from './types'
import {BMesh} from './BMesh'
import {diskEdges} from './structure'
import {faceNormalUpdate} from './polygon'
import {Vec3, v3dot, v3normalize, v3sub} from '../math'

const vertCo = (v: BMVert): Vec3 => [v.x, v.y, v.z]

export function meshNormalsUpdate(bm: BMesh): void {
    for (const f of bm.faces) faceNormalUpdate(f)
    for (const v of bm.verts) {
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
            // A loose vertex: Blender normalises its position as the normal (`bm_vert_calc_normals_impl`).
            out = v3normalize(vertCo(v))
        }
        v.nx = out[0]
        v.ny = out[1]
        v.nz = out[2]
    }
}
