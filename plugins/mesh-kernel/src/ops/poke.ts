/**
 * Poke faces: split each face into a fan of triangles around a new centre vertex.
 *
 * Ported from `source/blender/bmesh/operators/bmo_poke.cc` (`bmo_poke_exec`, `:31`), with the three
 * centre functions it chooses between from `bmesh_polygon.cc` (`:617`, `:654`, `:667`). The operator
 * definition, with its enum and slots, is `bmo_poke_def` in `bmesh_opdefines.cc:2754`.
 *
 * On a quad this is the St Andrew's cross: four triangles meeting at the middle, so every quad of a
 * cage gets both of its diagonals with a node where they cross. That is what lattice bracing is, and
 * {@link wireframe} turns it into struts.
 *
 * Divergences from Blender, both local to this file:
 *
 * - **Face normals are recomputed for the input faces on entry.** `bmo_poke_exec` reads `f->no`, which
 *   edit mode keeps current. Nothing in this kernel does, so - as in `inset.ts` - the operator refreshes
 *   the normals it reads. Only the input faces: nothing else is read.
 * - **No multires (`CD_MDISPS`) interpolation**, because the kernel has no multires layer.
 */

import {BMesh} from '../bmesh/BMesh'
import {BMFace, BMLoop, BMVert} from '../bmesh/types'
import {copyElemAttrs, copyElemHeader} from '../bmesh/customdata'
import {loopInterpFromFace} from '../bmesh/interp'
import {faceNormalUpdate} from '../bmesh/polygon'
import {Vec3} from '../math'

/**
 * Where the new vertex goes. Blender's `bmo_enum_poke_center_mode` (`bmesh_opdefines.cc:2742`):
 * `MEAN_WEIGHTED` is the default in the operator's UI (`MESH_OT_poke`).
 */
export type PokeCenterMode = 'meanWeighted' | 'mean' | 'bounds'

export interface PokeOptions {
    /** Move the centre vertex along the face normal by this much. Blender's `offset`. Default 0. */
    offset?: number
    /** How the centre is found. Default `meanWeighted`, as in Blender's `MESH_OT_poke`. */
    centerMode?: PokeCenterMode
    /**
     * Scale `offset` by the mean distance from the centre to the face's corners, so the same offset
     * means the same proportion on a large face and a small one. Blender's `use_relative_offset`.
     */
    useRelativeOffset?: boolean
}

export interface PokeResult {
    /** One new centre vertex per poked face, in input order. Blender's `verts.out`. */
    verts: BMVert[]
    /** The new triangles, `f.len` per input face, in input order. Blender's `faces.out`. */
    faces: BMFace[]
}

/** `BM_face_calc_center_median` (`bmesh_polygon.cc:654`): the plain mean of the corners. */
export function faceCalcCenterMedian(f: BMFace): Vec3 {
    const c: Vec3 = [0, 0, 0]
    let l = f.lFirst
    do {
        c[0] += l.v.x
        c[1] += l.v.y
        c[2] += l.v.z
        l = l.next
    } while (l !== f.lFirst)
    const inv = 1 / f.len
    return [c[0] * inv, c[1] * inv, c[2] * inv]
}

/**
 * `BM_face_calc_center_median_weighted` (`bmesh_polygon.cc:667`): each corner weighted by the summed
 * length of its two edges, so a long side does not get out-voted by a cluster of short ones.
 */
export function faceCalcCenterMedianWeighted(f: BMFace): Vec3 {
    const c: Vec3 = [0, 0, 0]
    let totw = 0
    let l = f.lFirst
    let wPrev = edgeLength(l.prev)
    do {
        const wCurr = edgeLength(l)
        const w = wCurr + wPrev
        c[0] += l.v.x * w
        c[1] += l.v.y * w
        c[2] += l.v.z * w
        totw += w
        wPrev = wCurr
        l = l.next
    } while (l !== f.lFirst)
    if (totw !== 0) {
        c[0] /= totw
        c[1] /= totw
        c[2] /= totw
    }
    return c
}

/** `BM_face_calc_center_bounds` (`bmesh_polygon.cc:617`): the middle of the corners' bounding box. */
export function faceCalcCenterBoundsV3(f: BMFace): Vec3 {
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    let l = f.lFirst
    do {
        const co: Vec3 = [l.v.x, l.v.y, l.v.z]
        for (let k = 0; k < 3; k++) {
            if (co[k] < min[k]) min[k] = co[k]
            if (co[k] > max[k]) max[k] = co[k]
        }
        l = l.next
    } while (l !== f.lFirst)
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/** `BM_edge_calc_length` for the edge `l` runs along: `l.v` to `l.next.v`. */
function edgeLength(l: BMLoop): number {
    const a = l.v
    const b = l.next.v
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** `BM_elem_attrs_copy` for a pair of loops: the corner data plus the header rule. */
function loopAttrsCopy(bm: BMesh, src: BMLoop, dst: BMLoop): void {
    if (src === dst) return
    copyElemAttrs(src, dst, bm.ldata)
    copyElemHeader(src, dst, 'loop')
}

const CENTER_FN: Record<PokeCenterMode, (f: BMFace) => Vec3> = {
    meanWeighted: faceCalcCenterMedianWeighted,
    mean: faceCalcCenterMedian,
    bounds: faceCalcCenterBoundsV3,
}

/**
 * Poke every face in `faces`. Port of `bmo_poke_exec` (`bmo_poke.cc:31`).
 *
 * Each face is replaced by `f.len` triangles `(l.v, l.next.v, centre)`, wound as the face was, so a
 * consistently wound surface stays consistently wound. The face's edges are kept - only the face is
 * killed - which is what lets neighbouring faces that were not poked stay attached.
 */
export function pokeFaces(bm: BMesh, faces: readonly BMFace[], opts: PokeOptions = {}): PokeResult {
    const offset = opts.offset ?? 0
    const useRelativeOffset = !!opts.useRelativeOffset
    const centerMode = opts.centerMode ?? 'meanWeighted'
    const calcCenter = CENTER_FN[centerMode]
    if (!calcCenter) throw new Error(`mesh-kernel: poke: unknown centre mode "${centerMode}"`)

    const outVerts: BMVert[] = []
    const outFaces: BMFace[] = []

    for (const f of faces) {
        if (!bm.faces.has(f)) continue
        // See the file header: `f->no` is assumed current by Blender.
        faceNormalUpdate(f)

        const fCenter = calcCenter(f)
        const vCenter = bm.vertCreate(fCenter[0], fCenter[1], fCenter[2])
        outVerts.push(vCenter)

        // 1.0, or the average length from the centre to the face verts.
        let offsetFac = useRelativeOffset ? 0 : 1

        // Only interpolate the central loop from the face once, then copy to all others in the fan.
        let lCenterExample: BMLoop | null = null

        const loops = f.loops()
        for (let i = 0; i < loops.length; i++) {
            const lIter = loops[i]
            const fNew = bm.faceCreate([lIter.v, lIter.next.v, vCenter], f)
            const lNew = fNew.lFirst

            if (i === 0) {
                lCenterExample = lNew.prev
                loopInterpFromFace(bm, lCenterExample, f, true)
            } else {
                loopAttrsCopy(bm, lCenterExample!, lNew.prev)
            }

            // Copy loop data.
            loopAttrsCopy(bm, lIter, lNew)
            loopAttrsCopy(bm, lIter.next, lNew.next)

            outFaces.push(fNew)

            if (useRelativeOffset) {
                offsetFac += Math.hypot(fCenter[0] - lIter.v.x, fCenter[1] - lIter.v.y, fCenter[2] - lIter.v.z)
            }
        }

        if (useRelativeOffset) offsetFac /= f.len
        // else remain at 1.0

        vCenter.nx = f.nx
        vCenter.ny = f.ny
        vCenter.nz = f.nz
        const d = offset * offsetFac
        vCenter.setCo(vCenter.x + f.nx * d, vCenter.y + f.ny * d, vCenter.z + f.nz * d)

        // Kill face.
        bm.faceKill(f)
    }

    return {verts: outVerts, faces: outFaces}
}
