/**
 * Edge-net fill: faces from a net of edges, filling every hole the net bounds.
 *
 * Ported from Blender's
 * - `source/blender/bmesh/tools/bmesh_edgenet.cc` (`BM_mesh_edgenet` and all its helpers),
 * - `source/blender/bmesh/operators/bmo_edgenet.cc` (`bmo_edgenet_fill_exec`,
 *   `bmo_edgenet_prepare_exec`, `edge_next`),
 * and, in the `helpers` region, the parts of `bmesh_construct.cc`, `bmesh_query.cc`,
 * `bmesh_polygon.cc`, `bmesh_iterators.cc`, `bmo_fill_attribute.cc` and `bmo_normals.cc` that
 * those (and `bmo_create.cc` in `fill.ts`) call and that the kernel did not have yet.
 *
 * Blender's `BM_ELEM_TAG` header bits and `BMO_*` operator flags become Sets local to each call;
 * every `BMO_op_exec` gets a fresh flag layer in Blender, which is what a fresh Set is.
 */

import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {ElemFlag, ElemType} from '../constants'
import {diskEdgeExists, diskEdges, edgeIsManifold} from '../bmesh/structure'
import {copyElemAttrs} from '../bmesh/customdata'
import {faceNormalFlip} from '../bmesh/flip'
import {faceNormalUpdate} from '../bmesh/polygon'
import {edgesSortWinding} from '../bmesh/ngon'
import {edgeInFace} from '../bmesh/euler'
import {faceExists} from './weld'
import {faceCalcCenterMedianWeighted} from './poke'
import {Vec3} from '../math'
import {
    addNewellCrossV3V3V3,
    angleSignedOnAxisV3V3V3,
    angleSignedOnAxisV3V3V3V3,
    maddV3V3Fl,
    normalizeV3Len,
} from '../math/geom'
import {faceAttributeFill} from './faceAttributeFill'

const FLT_EPSILON = 1.1920928955078125e-7
const FLT_MAX = 3.4028234663852886e38

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

// region helpers

/** `BM_edge_share_face_check` (`bmesh_query.cc:1050`): do the two edges share a face? */
export function edgeShareFaceCheck(e1: BMEdge, e2: BMEdge): boolean {
    if (e1.l && e2.l) {
        let l: BMLoop = e1.l
        do {
            if (edgeInFace(e2, l.f)) return true
            l = l.radialNext!
        } while (l !== e1.l)
    }
    return false
}

/** `BM_edge_share_vert_check` (`bmesh_query.cc:1088`). */
export function edgeShareVertCheck(e1: BMEdge, e2: BMEdge): boolean {
    return e1.v1 === e2.v1 || e1.v1 === e2.v2 || e1.v2 === e2.v1 || e1.v2 === e2.v2
}

/**
 * `BM_edges_from_verts` (`bmesh_construct.cc:44`): `edgeArr[i]` joins `vertArr[i]` and
 * `vertArr[i + 1]`. Null when one of them does not exist.
 */
export function edgesFromVerts(vertArr: readonly BMVert[]): BMEdge[] | null {
    const len = vertArr.length
    const edgeArr: BMEdge[] = new Array(len)
    let iPrev = len - 1
    for (let i = 0; i < len; i++) {
        const e = diskEdgeExists(vertArr[iPrev], vertArr[i])
        if (!e) return null
        edgeArr[iPrev] = e
        iPrev = i
    }
    return edgeArr
}

/**
 * The faces using `v`, in Blender's `BM_FACES_OF_VERT` order: `bmiter__face_of_vert_begin` /
 * `_step` (`bmesh_iterators.cc:420`) with `bmesh_disk_facevert_count`, `bmesh_disk_faceloop_find_first`,
 * `bmesh_radial_faceloop_find_next`, `bmesh_disk_faceedge_find_next` and
 * `bmesh_radial_faceloop_find_first` (`bmesh_structure.cc:252-466`). A face is visited once per loop it
 * has at `v`. The order matters to {@link faceExistsOverlapSubset}, whose result depends on it.
 */
export function* facesOfVertIter(v: BMVert): Generator<BMFace> {
    // bmesh_disk_facevert_count
    let count = 0
    if (v.e) {
        for (const e of diskEdges(v)) {
            if (e.l) {
                let l: BMLoop = e.l
                do {
                    if (l.v === v) count++
                    l = l.radialNext!
                } while (l !== e.l)
            }
        }
    }
    if (!count) return
    // bmesh_disk_faceloop_find_first(v->e, v)
    let lFirst: BMLoop | null = null
    {
        const eFirstDisk = v.e!
        let eIter: BMEdge = eFirstDisk
        do {
            if (eIter.l) {
                lFirst = eIter.l.v === v ? eIter.l : eIter.l.next
                break
            }
            eIter = eIter.diskNext(v)!
        } while (eIter !== eFirstDisk)
    }
    let eNext: BMEdge = lFirst!.e!
    let lNext: BMLoop | null = lFirst
    while (true) {
        const lCurr = lNext
        if (count && lNext) {
            count--
            // bmesh_radial_faceloop_find_next(l_next, v)
            {
                const l: BMLoop = lNext
                let lIter: BMLoop = l.radialNext!
                let found: BMLoop = l
                do {
                    if (lIter.v === v) {
                        found = lIter
                        break
                    }
                    lIter = lIter.radialNext!
                } while (lIter !== l)
                lNext = found
            }
            if (lNext === lFirst) {
                // bmesh_disk_faceedge_find_next(e_next, v)
                {
                    const e = eNext
                    let eFind: BMEdge = e.diskNext(v)!
                    let found: BMEdge = e
                    do {
                        if (eFind.l) {
                            // bmesh_radial_facevert_check
                            let lIter: BMLoop = eFind.l
                            let has = false
                            do {
                                if (lIter.v === v) {
                                    has = true
                                    break
                                }
                                lIter = lIter.radialNext!
                            } while (lIter !== eFind.l)
                            if (has) {
                                found = eFind
                                break
                            }
                        }
                        eFind = eFind.diskNext(v)!
                    } while (eFind !== e)
                    eNext = found
                }
                // bmesh_radial_faceloop_find_first(e_next->l, v)
                {
                    const l = eNext.l!
                    let lIter: BMLoop = l
                    let found: BMLoop | null = null
                    do {
                        if (lIter.v === v) {
                            found = lIter
                            break
                        }
                        lIter = lIter.radialNext!
                    } while (lIter !== l)
                    lFirst = found
                }
                lNext = lFirst
            }
        }
        if (!count) lNext = null
        if (!lCurr) return
        yield lCurr.f
    }
}

/**
 * `BM_face_exists_overlap_subset` (`bmesh_query.cc:1867`): is there a face whose vertices are all
 * in `varr`? Ported literally, including that `break` leaves only the inner face loop, so the result
 * is the outcome of the last face tested - and depends on `varr`'s order and on
 * {@link facesOfVertIter}'s.
 */
export function faceExistsOverlapSubset(varr: readonly BMVert[]): boolean {
    const len = varr.length
    let isInit = false
    let isOverlap = false
    const vOverlap = new Set<BMVert>()
    const fOverlap = new Set<BMFace>()
    for (let i = 0; i < len; i++) {
        for (const f of facesOfVertIter(varr[i])) {
            if (f.len <= len && !fOverlap.has(f)) {
                // Check if all verts in this face are flagged.
                if (!isInit) {
                    isInit = true
                    for (let j = 0; j < len; j++) vOverlap.add(varr[j])
                }
                let lIter = f.lFirst
                isOverlap = true
                do {
                    if (!vOverlap.has(lIter.v)) {
                        isOverlap = false
                        break
                    }
                } while ((lIter = lIter.next) !== f.lFirst)
                if (isOverlap) break
                fOverlap.add(f)
            }
        }
    }
    return isOverlap
}

/**
 * `BM_face_copy_shared` (`bmesh_construct.cc:79`): copy the corner data of every loop of `f` from
 * the neighbouring face across each edge (the first radial neighbour), once per loop, keeping the
 * first source that passes `filterFn`.
 */
export function faceCopyShared(bm: BMesh, f: BMFace, filterFn: ((l: BMLoop) => boolean) | null): void {
    const done = new Set<BMLoop>() // _FLAG_OVERLAP
    const lFirst = f.lFirst
    let lIter = lFirst
    do {
        const lOther = lIter.radialNext
        if (lOther && lOther !== lIter) {
            const lDst = [lIter, lIter.next]
            const lSrc = lOther.v === lIter.v ? [lOther, lOther.next] : [lOther.next, lOther]
            for (let j = 0; j < 2; j++) {
                if (!done.has(lDst[j])) {
                    if (filterFn === null || filterFn(lSrc[j])) {
                        // CustomData_bmesh_copy_block(bm->ldata, ...): data only, not the header.
                        copyElemAttrs(lSrc[j], lDst[j], bm.ldata)
                        done.add(lDst[j])
                    }
                }
            }
        }
    } while ((lIter = lIter.next) !== lFirst)
}

/** `BM_face_calc_area` (`bmesh_polygon.cc:213`): Newell's method. */
export function faceCalcArea(f: BMFace): number {
    const n: Vec3 = [0, 0, 0]
    let l = f.lFirst
    do {
        addNewellCrossV3V3V3(n, co(l.v), co(l.next.v))
    } while ((l = l.next) !== f.lFirst)
    return Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) * 0.5
}

/** Creation flags of `BM_face_create` that this port uses (`eBMCreateFlag`). */
export interface FaceCreateFlag {
    /** `BM_CREATE_NO_DOUBLE`: return the existing face with these vertices instead of a new one. */
    noDouble?: boolean
}

/**
 * `BM_face_create` (`bmesh_core.cc:527`) with its `BM_CREATE_NO_DOUBLE` check, over
 * {@link BMesh.faceCreateWithEdges}.
 */
export function faceCreateFlagged(bm: BMesh, verts: BMVert[], edges: BMEdge[], fExample: BMFace | null, createFlag: FaceCreateFlag): BMFace {
    if (createFlag.noDouble) {
        const f = faceExists(verts)
        if (f) return f
    }
    return bm.faceCreateWithEdges(verts, edges, fExample ?? undefined)
}

/**
 * `BM_face_create_ngon_verts` (`bmesh_construct.cc:230`): a face from an ordered vertex loop.
 * With `calcWinding`, edges that already have a face vote for the winding opposite to theirs; with
 * `createEdges` missing edges are made (otherwise a missing edge returns null). The face is built by
 * `BM_face_create_ngon` (`bmesh_construct.cc:210`), starting at `vertArr[len-1] -> vertArr[0]` or the
 * reverse.
 */
export function faceCreateNgonVerts(
    bm: BMesh, vertArr: readonly BMVert[], fExample: BMFace | null, createFlag: FaceCreateFlag,
    calcWinding: boolean, createEdges: boolean,
): BMFace | null {
    const len = vertArr.length
    const edgeArr: BMEdge[] = new Array(len)
    const winding = [0, 0]
    let iPrev = len - 1
    const vWinding = [vertArr[iPrev], vertArr[0]]

    for (let i = 0; i < len; i++) {
        if (createEdges) {
            edgeArr[i] = bm.edgeCreate(vertArr[iPrev], vertArr[i], undefined, {noDouble: true})
        } else {
            const e = diskEdgeExists(vertArr[iPrev], vertArr[i])
            if (!e) return null
            edgeArr[i] = e
        }

        if (calcWinding) {
            // The edge may exist already and be attached to a face; then find the best winding.
            if (edgeArr[i].l) {
                // BM_edge_ordered_verts(edge_arr[i], &test_v2, &test_v1): "we want to use the
                // reverse winding to the existing order".
                const testV2 = edgeArr[i].l!.v
                winding[vertArr[iPrev] === testV2 ? 1 : 0]++
            }
        }
        iPrev = i
    }

    if (calcWinding) {
        if (winding[0] < winding[1]) {
            winding[0] = 1
            winding[1] = 0
        } else {
            winding[0] = 0
            winding[1] = 1
        }
    } else {
        winding[0] = 0
        winding[1] = 1
    }

    // BM_face_create_ngon
    const sorted = edgesSortWinding(vWinding[winding[0]], vWinding[winding[1]], edgeArr)
    if (!sorted) return null
    return faceCreateFlagged(bm, sorted.verts, sorted.edges, fExample, createFlag)
}

/*
 * Single-precision arithmetic for `BM_verts_calc_normal_from_cloud_ex`. Blender stores coordinates
 * and computes this in `float`, and the function picks its vertices by comparing distances that are
 * often *mathematically equal* - for any three vertices the two candidates for `co_b` are exactly as
 * far from the median through `co_a` - so which one wins (and so the sign of the normal, and the
 * winding of a face `F` makes from three loose vertices) is decided by float32 rounding. These
 * helpers round every operation the way C's `float` arithmetic does (`FLT_EVAL_METHOD == 0`, no
 * fused multiply-add), in the operand order of `BLI_math_vector_inline.cc` / `math_geom.cc`.
 */
const F = Math.fround
const f32Co = (v: BMVert): Vec3 => [F(v.x), F(v.y), F(v.z)]
const f32Sub = (a: Vec3, b: Vec3): Vec3 => [F(a[0] - b[0]), F(a[1] - b[1]), F(a[2] - b[2])]
/** `dot_v3v3`: `a[0]*b[0] + a[1]*b[1] + a[2]*b[2]`, left to right. */
const f32Dot = (a: Vec3, b: Vec3): number => F(F(F(a[0] * b[0]) + F(a[1] * b[1])) + F(a[2] * b[2]))
/** `normalize_v3` (`normalize_v3_v3_length` with unit length 1): in place, returning the length. */
function f32Normalize(a: Vec3): number {
    let d = f32Dot(a, a)
    if (d > 1.0e-35) {
        d = F(Math.sqrt(d))
        const m = F(1 / d)
        a[0] = F(a[0] * m)
        a[1] = F(a[1] * m)
        a[2] = F(a[2] * m)
    } else {
        a[0] = a[1] = a[2] = 0
        d = 0
    }
    return d
}
/** `project_plane_normalized_v3_v3v3` (`math_vector.cc`): `p + v_plane * -dot(p, v_plane)`. */
function f32ProjectPlaneNormalized(p: Vec3, vPlane: Vec3): Vec3 {
    const mul = f32Dot(p, vPlane)
    return [F(p[0] + F(vPlane[0] * -mul)), F(p[1] + F(vPlane[1] * -mul)), F(p[2] + F(vPlane[2] * -mul))]
}
/** `cross_v3_v3v3`. */
const f32Cross = (a: Vec3, b: Vec3): Vec3 => [
    F(F(a[1] * b[2]) - F(a[2] * b[1])), F(F(a[2] * b[0]) - F(a[0] * b[2])), F(F(a[0] * b[1]) - F(a[1] * b[0]))]
/** `normal_tri_v3` (`math_geom.cc:45`): `n`, its pre-normalisation length. */
function f32NormalTri(v1: Vec3, v2: Vec3, v3: Vec3): {n: Vec3, len: number} {
    const n = f32Cross(f32Sub(v1, v2), f32Sub(v2, v3))
    return {n, len: f32Normalize(n)}
}
/** `normal_quad_v3` (`math_geom.cc:62`). */
function f32NormalQuad(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3): {n: Vec3, len: number} {
    const n = f32Cross(f32Sub(v1, v3), f32Sub(v2, v4))
    return {n, len: f32Normalize(n)}
}
/** `add_newell_cross_v3_v3v3` (`math_vector_inline.cc`). */
function f32AddNewellCross(n: Vec3, a: Vec3, b: Vec3): void {
    n[0] = F(n[0] + F(F(a[1] - b[1]) * F(a[2] + b[2])))
    n[1] = F(n[1] + F(F(a[2] - b[2]) * F(a[0] + b[0])))
    n[2] = F(n[2] + F(F(a[0] - b[0]) * F(a[1] + b[1])))
}

/**
 * `BM_verts_calc_normal_from_cloud_ex` (`bmesh_polygon.cc:889`, current source, including the
 * radial "refine" pass that Blender 3.4.1 does not have), in float32 arithmetic (see above).
 * Returns the normal, the centre and the index of the vertex used as tangent.
 */
export function vertsCalcNormalFromCloudEx(varr: readonly BMVert[]): {normal: Vec3, center: Vec3, indexTangent: number} {
    const varrLen = varr.length
    const varrLenInv = F(1 / varrLen)
    const cos = varr.map(f32Co)
    let rNormal: Vec3 = [0, 0, 0]

    // Get the center point and collect vector array since we loop over these a lot.
    const center: Vec3 = [0, 0, 0]
    for (let i = 0; i < varrLen; i++) {
        // madd_v3_v3fl
        center[0] = F(center[0] + F(cos[i][0] * varrLenInv))
        center[1] = F(center[1] + F(cos[i][1] * varrLenInv))
        center[2] = F(center[2] + F(cos[i][2] * varrLenInv))
    }

    // Find the 'co_a' point from center.
    let coAIndex = 0
    let coA = -1
    {
        let distSqMax = -1
        for (let i = 0; i < varrLen; i++) {
            const d = f32Sub(cos[i], center) // len_squared_v3v3
            const distSqTest = f32Dot(d, d)
            if (!(distSqTest <= distSqMax)) {
                coA = i
                coAIndex = i
                distSqMax = distSqTest
            }
        }
    }

    const dirA = f32Sub(cos[coA], center)
    f32Normalize(dirA)

    let coB = -1
    let dirB: Vec3 = [0, 0, 0]
    {
        let distSqMax = -1
        for (let i = 0; i < varrLen; i++) {
            if (i === coA) continue // `varr[i]->co == co_a`, a pointer test
            const dirTest = f32ProjectPlaneNormalized(f32Sub(cos[i], center), dirA)
            const distSqTest = f32Dot(dirTest, dirTest)
            if (!(distSqTest <= distSqMax)) {
                coB = i
                distSqMax = distSqTest
                dirB = dirTest
            }
        }
    }

    if (varrLen <= 3) {
        rNormal = f32NormalTri(center, cos[coA], cos[coB]).n
        return {normal: rNormal, center, indexTangent: coAIndex}
    }

    f32Normalize(dirB)

    let coAOpposite = -1
    let coBOpposite = -1
    {
        let dotAMin = FLT_MAX
        let dotBMin = FLT_MAX
        for (let i = 0; i < varrLen; i++) {
            let dotTest
            if (i !== coA) {
                dotTest = f32Dot(dirA, cos[i])
                if (dotTest < dotAMin) {
                    dotAMin = dotTest
                    coAOpposite = i
                }
            }
            if (i !== coB) {
                dotTest = f32Dot(dirB, cos[i])
                if (dotTest < dotBMin) {
                    dotBMin = dotTest
                    coBOpposite = i
                }
            }
        }
    }

    const quad = f32NormalQuad(cos[coA], cos[coB], cos[coAOpposite], cos[coBOpposite])
    rNormal = quad.n
    if (quad.len !== 0) {
        // Refine by accumulating a normal over all vertices in radial order around the initial
        // normal - so all vertices contribute to the result.
        const order: number[] = new Array(varrLen)
        const angles: number[] = new Array(varrLen)
        for (let i = 0; i < varrLen; i++) {
            order[i] = i
            angles[i] = angleSignedOnAxisV3V3V3(dirA, f32Sub(cos[i], center), rNormal)
        }
        // "This order ensures the normal doesn't flip when refining." (`std::ranges::sort` is not
        // stable; equal angles may order differently here.)
        order.sort((a, b) => angles[b] - angles[a])
        const normalRefine: Vec3 = [0, 0, 0]
        let vPrev = cos[order[varrLen - 1]]
        for (let i = 0; i < varrLen; i++) {
            const vCurr = cos[order[i]]
            f32AddNewellCross(normalRefine, vPrev, vCurr)
            vPrev = vCurr
        }
        if (f32Normalize(normalRefine) !== 0) {
            // Re-compute the tangent, because it's *possible* the original tangent is aligned with
            // the new normal.
            let distSqMax = -1
            for (let i = 0; i < varrLen; i++) {
                const dirTest = f32ProjectPlaneNormalized(f32Sub(cos[i], center), normalRefine)
                const distSqTest = f32Dot(dirTest, dirTest)
                if (!(distSqTest <= distSqMax)) {
                    coAIndex = i
                    distSqMax = distSqTest
                }
            }
            rNormal = normalRefine
        }
    }
    return {normal: rNormal, center, indexTangent: coAIndex}
}

/**
 * `BM_verts_sort_radial_plane` (`bmesh_construct.cc:302`): order a vertex cloud by its signed angle
 * around the cloud's normal, starting from the tangent vertex. Sorts `vertArr` in place. Blender's
 * `std::ranges::sort` is not stable; JS's is, so vertices at exactly equal angles may come out in a
 * different order.
 */
export function vertsSortRadialPlane(vertArr: BMVert[]): void {
    const len = vertArr.length
    const {normal: nor, center: cent, indexTangent} = vertsCalcNormalFromCloudEx(vertArr)
    const far = co(vertArr[indexTangent])
    const vang: {first: number, second: number}[] = new Array(len)
    const vertArrMap = vertArr.slice()
    for (let i = 0; i < len; i++) {
        vang[i] = {first: angleSignedOnAxisV3V3V3V3(far, cent, co(vertArr[i]), nor), second: i}
    }
    vang.sort((a, b) => a.first - b.first)
    for (let i = 0; i < len; i++) vertArr[i] = vertArrMap[vang[i].second]
}

/** `normal_tri_v3` (`math_geom.cc:45`) with the returned length. */
function normalTriV3Len(v1: Vec3, v2: Vec3, v3: Vec3): {n: Vec3, len: number} {
    const n1 = [v1[0] - v2[0], v1[1] - v2[1], v1[2] - v2[2]]
    const n2 = [v2[0] - v3[0], v2[1] - v3[1], v2[2] - v3[2]]
    const n: Vec3 = [n1[1] * n2[2] - n1[2] * n2[1], n1[2] * n2[0] - n1[0] * n2[2], n1[0] * n2[1] - n1[1] * n2[0]]
    const len = normalizeV3Len(n)
    return {n, len}
}

/**
 * `BM_mesh_calc_face_groups` (`bmesh_query.cc:2111`): partition the faces (those with `hflagTest`,
 * or all when 0) into groups connected across edges (`htypeStep` has `Edge`, the radial cycle,
 * filtered by `filterFn`) and/or vertices (`Vert`, `BM_LOOPS_OF_LOOP`). Groups are face arrays, in
 * Blender's discovery order. Blender leaves `BM_ELEM_TAG` set on every face as a side effect; the
 * tag here is a local set.
 */
export function meshCalcFaceGroups(
    bm: BMesh,
    filterFn: ((l: BMLoop) => boolean) | null,
    filterPairFn: ((lA: BMLoop, lB: BMLoop) => boolean) | null,
    hflagTest: number,
    htypeStep: number,
): BMFace[][] {
    const tag = new Set<BMFace>()
    let totFaces = 0
    for (const f of bm.faces) {
        if (hflagTest === 0 || (f.hflag & hflagTest)) totFaces++
        else tag.add(f) // never walk over tagged
    }

    const groups: BMFace[][] = []
    let totTouch = 0
    const faceIter = bm.faces.values()
    let fNextRes = faceIter.next()

    while (totTouch !== totFaces) {
        const stack: BMFace[] = []
        for (; !fNextRes.done; fNextRes = faceIter.next()) {
            const fNext = fNextRes.value
            if (!tag.has(fNext)) {
                tag.add(fNext)
                stack.push(fNext)
                break
            }
        }

        const group: BMFace[] = []
        let f: BMFace | undefined
        while ((f = stack.pop())) {
            group.push(f)
            totTouch++

            if (htypeStep & ElemType.Edge) {
                let lIter = f.lFirst
                do {
                    let lRadialIter = lIter.radialNext!
                    if (lRadialIter !== lIter && (filterFn === null || filterFn(lIter))) {
                        do {
                            if (filterPairFn === null || filterPairFn(lIter, lRadialIter)) {
                                const fOther = lRadialIter.f
                                if (!tag.has(fOther)) {
                                    tag.add(fOther)
                                    stack.push(fOther)
                                }
                            }
                        } while ((lRadialIter = lRadialIter.radialNext!) !== lIter)
                    }
                } while ((lIter = lIter.next) !== f.lFirst)
            }

            if (htypeStep & ElemType.Vert) {
                let lIter = f.lFirst
                do {
                    if (filterFn === null || filterFn(lIter)) {
                        // BM_LOOPS_OF_LOOP (`bmiter__loop_of_loop_*`, `bmesh_iterators.cc:523`): the
                        // other loops of the radial cycle of `lIter`.
                        for (let lOther = lIter.radialNext!; lOther !== lIter; lOther = lOther.radialNext!) {
                            if (filterPairFn === null || filterPairFn(lIter, lOther)) {
                                const fOther = lOther.f
                                if (!tag.has(fOther)) {
                                    tag.add(fOther)
                                    stack.push(fOther)
                                }
                            }
                        }
                    }
                } while ((lIter = lIter.next) !== f.lFirst)
            }
        }
        groups.push(group)
    }
    return groups
}

/**
 * `recalc_face_normals_find_index` (`bmo_normals.cc:64`): the face holding the outer-most loop of
 * a connected group, and whether that face points towards the group's centre.
 */
function recalcFaceNormalsFindIndex(faces: readonly BMFace[]): {index: number, isFlip: boolean} {
    const eps = FLT_EPSILON
    let centAreaAccum = 0
    const cent: Vec3 = [0, 0, 0]
    const centFac = 1 / faces.length
    let isFlip = false

    // first calculate the center
    for (let i = 0; i < faces.length; i++) {
        const fArea = faceCalcArea(faces[i])
        const fCent = faceCalcCenterMedianWeighted(faces[i])
        maddV3V3Fl(cent, fCent, centFac * fArea)
        centAreaAccum += fArea
    }
    if (centAreaAccum !== 0) {
        cent[0] *= 1 / centAreaAccum
        cent[1] *= 1 / centAreaAccum
        cent[2] *= 1 / centAreaAccum
    }

    // Distances must start above zero, or we can't do meaningful calculations based on the
    // direction to the center.
    const best = {distSq: eps, edgeDot: -FLT_MAX, loopDot: -FLT_MAX}
    const test = {distSq: 0, edgeDot: 0, loopDot: 0}
    let fStartIndex = 0

    for (let i = 0; i < faces.length; i++) {
        let lIter = faces[i].lFirst
        do {
            const dir: Vec3 = [lIter.v.x - cent[0], lIter.v.y - cent[1], lIter.v.z - cent[2]]
            test.distSq = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]
            const isBestDistSq = test.distSq > best.distSq
            if (isBestDistSq || test.distSq === best.distSq) {
                const s = 1 / Math.sqrt(test.distSq)
                dir[0] *= s
                dir[1] *= s
                dir[2] *= s
                const ed0: Vec3 = [lIter.next.v.x - lIter.v.x, lIter.next.v.y - lIter.v.y, lIter.next.v.z - lIter.v.z]
                const ed1: Vec3 = [lIter.prev.v.x - lIter.v.x, lIter.prev.v.y - lIter.v.y, lIter.prev.v.z - lIter.v.z]
                if (normalizeV3Len(ed0) > eps && normalizeV3Len(ed1) > eps) {
                    test.edgeDot = Math.max(
                        dir[0] * ed0[0] + dir[1] * ed0[1] + dir[2] * ed0[2],
                        dir[0] * ed1[0] + dir[1] * ed1[1] + dir[2] * ed1[2])
                    const isBestEdgeDot = test.edgeDot > best.edgeDot
                    if (isBestDistSq || isBestEdgeDot || test.edgeDot === best.edgeDot) {
                        const loopDir: Vec3 = [
                            ed0[1] * ed1[2] - ed0[2] * ed1[1],
                            ed0[2] * ed1[0] - ed0[0] * ed1[2],
                            ed0[0] * ed1[1] - ed0[1] * ed1[0],
                        ]
                        if (normalizeV3Len(loopDir) > eps) {
                            // Highly unlikely the furthest loop is also the concave part of an ngon,
                            // but it can be contrived with _very_ non-planar faces - so better check.
                            const f = lIter.f
                            if (loopDir[0] * f.nx + loopDir[1] * f.ny + loopDir[2] * f.nz < 0) {
                                loopDir[0] = -loopDir[0]
                                loopDir[1] = -loopDir[1]
                                loopDir[2] = -loopDir[2]
                            }
                            const loopDirDot = dir[0] * loopDir[0] + dir[1] * loopDir[1] + dir[2] * loopDir[2]
                            test.loopDot = Math.abs(loopDirDot)
                            if (isBestDistSq || isBestEdgeDot || test.loopDot > best.loopDot) {
                                best.distSq = test.distSq
                                best.edgeDot = test.edgeDot
                                best.loopDot = test.loopDot
                                fStartIndex = i
                                isFlip = loopDirDot < 0
                            }
                        }
                    }
                }
            }
        } while ((lIter = lIter.next) !== faces[i].lFirst)
    }
    return {index: fStartIndex, isFlip}
}

/** `bmo_recalc_normal_loop_filter_cb` (`bmo_normals.cc:28`). */
const recalcNormalLoopFilter = (l: BMLoop): boolean => edgeIsManifold(l.e!)

/**
 * `bmo_recalc_face_normals_exec` (`bmo_normals.cc:258`) with `bmo_recalc_face_normals_array`
 * (`:192`): make the winding of every group of faces (connected across manifold edges) that holds
 * one of `faces` consistent, pointing outwards. Only `faces` are flipped.
 */
export function recalcFaceNormals(bm: BMesh, faces: readonly BMFace[]): void {
    const faceFlag = new Set(faces) // FACE_FLAG
    const groups = meshCalcFaceGroups(bm, recalcNormalLoopFilter, null, 0, ElemType.Edge)
    for (const facesGrp of groups) {
        let isCalc = false
        for (const f of facesGrp) {
            if (!isCalc) isCalc = faceFlag.has(f)
        }
        if (!isCalc) continue

        // bmo_recalc_face_normals_array
        const faceFlip = new Set<BMFace>() // FACE_FLIP
        const faceTemp = new Set<BMFace>() // FACE_TEMP
        const {index: fStartIndex, isFlip} = recalcFaceNormalsFindIndex(facesGrp)
        if (isFlip) faceFlip.add(facesGrp[fStartIndex])

        const fstack: BMFace[] = [facesGrp[fStartIndex]]
        faceTemp.add(facesGrp[fStartIndex])
        let f: BMFace | undefined
        while ((f = fstack.pop())) {
            const flipState = faceFlip.has(f)
            let lIter = f.lFirst
            do {
                const lOther = lIter.radialNext!
                if (lOther !== lIter && recalcNormalLoopFilter(lIter)) {
                    if (!faceTemp.has(lOther.f)) {
                        faceTemp.add(lOther.f)
                        if ((lOther.v === lIter.v) !== flipState) faceFlip.add(lOther.f)
                        else faceFlip.delete(lOther.f)
                        fstack.push(lOther.f)
                    }
                }
            } while ((lIter = lIter.next) !== f.lFirst)
        }

        // apply flipping to oflag'd faces
        for (const g of facesGrp) {
            if (faceFlag.has(g) && faceFlip.has(g)) faceNormalFlip(g)
        }
    }
}

// endregion

// region bmesh_edgenet.cc

/** `VertNetInfo` (`bmesh_edgenet.cc:28`): a path of verts walked over. */
interface VertNetInfo {
    /** previous vertex */
    prev: BMVert | null
    /** path scanning pass value, for internal calculation */
    pass: number
    /** face index connected to the edge between this and the previous vert */
    face: number
    flag: number
}

const VNINFO_FLAG_IS_MIXFACE = 1 << 0

interface EdgenetState {
    vnetInfo: VertNetInfo[]
    /** `BM_ELEM_TAG` on edges. */
    edgeTag: Set<BMEdge>
}

/** `bm_edge_step_ok` (`bmesh_edgenet.cc:42`): tagged, and a wire or boundary edge. */
function bmEdgeStepOk(s: EdgenetState, e: BMEdge): boolean {
    return s.edgeTag.has(e) && (e.l === null || e.l === e.l.radialNext)
}

/** `bm_edge_face` (`bmesh_edgenet.cc:47`). */
function bmEdgeFace(e: BMEdge): number {
    return e.l ? e.l.f.index : -1
}

/** `bm_edgenet_edge_get_next` (`bmesh_edgenet.cc:55`). `edgeQueue` is a stack (head at the end). */
function bmEdgenetEdgeGetNext(bm: BMesh, s: EdgenetState, edgeQueue: BMEdge[]): BMEdge | null {
    while (edgeQueue.length) {
        const e = edgeQueue.pop()!
        if (bmEdgeStepOk(s, e)) return e
    }
    for (const e of bm.edges) {
        if (bmEdgeStepOk(s, e)) return e
    }
    return null
}

/**
 * `bm_edgenet_path_from_pass` (`bmesh_edgenet.cc:84`): prepend half a loop to `vLs` (a list with its
 * head at index 0).
 */
function bmEdgenetPathFromPass(v: BMVert, vLs: BMVert[], vnetInfo: VertNetInfo[]): number {
    let vn = vnetInfo[v.index]
    const pass = vn.pass
    let vLsTot = 0
    do {
        vLs.unshift(v)
        vLsTot += 1
        v = vn.prev!
        vn = vnetInfo[v.index]
    } while (vn.pass === pass)
    return vLsTot
}

/** `bm_edgenet_path_check_overlap` (`bmesh_edgenet.cc:107`). */
function bmEdgenetPathCheckOverlap(v1: BMVert, v2: BMVert, vnetInfo: VertNetInfo[]): boolean {
    // vert order doesn't matter (to the face it describes; it does to the overlap test's result)
    const vLs: BMVert[] = [] // head at index 0
    for (const vStart of [v1, v2]) {
        let v = vStart
        let vn = vnetInfo[v.index]
        const pass = vn.pass
        do {
            vLs.unshift(v)
            v = vn.prev!
            vn = vnetInfo[v.index]
        } while (vn.pass === pass)
    }
    if (vLs.length) return faceExistsOverlapSubset(vLs)
    return false
}

/** `bm_edgenet_face_from_path` (`bmesh_edgenet.cc:142`). */
function bmEdgenetFaceFromPath(bm: BMesh, path: BMVert[]): BMFace {
    const edgeArr = edgesFromVerts(path)
    if (!edgeArr) throw new Error('mesh-kernel: edgenet path has a missing edge')
    // no need for BM_face_exists_multi, we do overlap checks before allowing the path to be used
    return bm.faceCreateWithEdges(path, edgeArr)
}

/**
 * `bm_edgenet_path_step` (`bmesh_edgenet.cc:177`): step from `vCurr` to every vert not already in
 * the path, appending them to `vLs` (a stack, head at the end). Returns the connecting edge when the
 * two halves of a path meet.
 */
function bmEdgenetPathStep(s: EdgenetState, vCurr: BMVert, vLs: BMVert[]): BMEdge | null {
    const vnetInfo = s.vnetInfo
    for (;;) { // begin:
        let tot = 0
        let vLsTot = 0
        const vnCurr = vnetInfo[vCurr.index]

        for (const e of diskEdges(vCurr)) {
            const vNext = e.otherVert(vCurr)
            if (vNext !== vnCurr.prev) {
                if (bmEdgeStepOk(s, e)) {
                    const vnNext = vnetInfo[vNext.index]
                    // check we're not looping back on ourselves
                    if (vnCurr.pass !== vnNext.pass) {
                        if (vnCurr.pass === -vnNext.pass) {
                            if ((vnCurr.flag & VNINFO_FLAG_IS_MIXFACE) || (vnNext.flag & VNINFO_FLAG_IS_MIXFACE)) {
                                // found connecting edge
                                if (!bmEdgenetPathCheckOverlap(vCurr, vNext, vnetInfo)) return e
                            }
                        } else {
                            vnNext.face = bmEdgeFace(e)
                            vnNext.pass = vnCurr.pass
                            vnNext.prev = vCurr

                            // flush flag down the path
                            vnNext.flag &= ~VNINFO_FLAG_IS_MIXFACE
                            if ((vnCurr.flag & VNINFO_FLAG_IS_MIXFACE) || vnNext.face === -1 || vnNext.face !== vnCurr.face) {
                                vnNext.flag |= VNINFO_FLAG_IS_MIXFACE
                            }

                            // add to the list!
                            vLs.push(vNext)
                            vLsTot += 1
                        }
                    }
                }
                tot += 1
            }
        }

        // trick to walk along wire-edge paths
        if (vLsTot === 1 && tot === 1) {
            vCurr = vLs.pop()!
            continue // goto begin (Blender avoids recursion: it can crash on very large nets)
        }
        return null
    }
}

interface EdgenetPath {
    /** Vertices of the face, in order. */
    path: BMVert[]
    pathCost: number
}

/** `bm_edgenet_path_calc` (`bmesh_edgenet.cc:255`): the first path from `e` that can form a face. */
function bmEdgenetPathCalc(s: EdgenetState, e: BMEdge, passNr: number, pathCostMax: number): EdgenetPath | null {
    const vnetInfo = s.vnetInfo
    const fIndex = bmEdgeFace(e)

    const vn1 = vnetInfo[e.v1.index]
    const vn2 = vnetInfo[e.v2.index]
    vn1.pass = passNr
    vn2.pass = -passNr
    vn1.prev = e.v2
    vn2.prev = e.v1
    vn1.face = vn2.face = fIndex
    vn1.flag = vn2.flag = fIndex === -1 ? VNINFO_FLAG_IS_MIXFACE : 0

    // Prime the search-list (prepend v1, then v2: v2 is the head). Stacks, head at the end.
    let vLsPrev: BMVert[] = [e.v1, e.v2]
    let vLsNext: BMVert[] = []
    let pathCostAccum = 0
    let found: boolean

    do {
        found = false
        // no point to continue, we're over budget
        if (pathCostAccum >= pathCostMax) return null

        while (vLsPrev.length) {
            // The list only ever grows past this length within one step (the wire trick pops only
            // what that step pushed), so "the head changed" is "the length changed".
            const vLsNextOld = vLsNext.length
            const v = vLsPrev.pop()!
            const eFound = bmEdgenetPathStep(s, v, vLsNext)
            if (eFound) {
                const path: BMVert[] = []
                bmEdgenetPathFromPass(eFound.v1, path, vnetInfo)
                path.reverse()
                bmEdgenetPathFromPass(eFound.v2, path, vnetInfo)
                return {path, pathCost: pathCostAccum}
            }
            // check if a change was made
            if (vLsNextOld !== vLsNext.length) found = true
        }

        pathCostAccum++
        // swap
        vLsPrev = vLsNext
        vLsNext = []
    } while (found)

    // tag not to search again
    s.edgeTag.delete(e)
    return null
}

/**
 * `bm_edgenet_path_calc_best` (`bmesh_edgenet.cc:353`): {@link bmEdgenetPathCalc}, then retried from
 * every other edge of the path found, keeping any cheaper path - which avoids very strange/long
 * paths.
 */
function bmEdgenetPathCalcBest(s: EdgenetState, e: BMEdge, passNr: {value: number}, pathCostMax: number): EdgenetPath | null {
    let path = bmEdgenetPathCalc(s, e, passNr.value, pathCostMax)
    passNr.value++
    if (path === null) return null
    // any face that takes 1 iteration to find we consider valid
    if (path.pathCost < 1) return path

    const vertArr = path.path.slice()
    const pathLen = vertArr.length
    let pathCost = path.pathCost
    let iPrev = pathLen - 1
    for (let i = 0; i < pathLen; i++) {
        const eOther = diskEdgeExists(vertArr[i], vertArr[iPrev])!
        if (eOther !== e) {
            const pathTest = bmEdgenetPathCalc(s, eOther, passNr.value, pathCost)
            passNr.value++
            if (pathTest) {
                path = pathTest
                pathCost = pathTest.pathCost
            }
        }
        iPrev = i
    }
    return path
}

/**
 * `BM_mesh_edgenet` (`bmesh_edgenet.cc:417`): fill every face an edge net bounds. Works on the
 * edges in `edgeTag` (Blender's `BM_ELEM_TAG`; with `useEdgeTag` false the tag is first reduced to
 * those that are wire or boundary, as Blender's `BM_elem_flag_set(e, TAG, bm_edge_step_ok(e))` does)
 * and adds the new faces to `faceTag` when `useNewFaceTag`. `edgeTag` is consumed: edges that can
 * form no face are removed from it.
 *
 * Side effect, as in Blender: vertex and face `index` values are set (`BM_mesh_elem_index_ensure`),
 * and each new face gets `index = totface - 1`, which "only needs to be unique, not kept valid".
 */
export function meshEdgenet(bm: BMesh, useEdgeTag: boolean, useNewFaceTag: boolean, edgeTag: Set<BMEdge>, faceTag: Set<BMFace>): void {
    const vnetInfo: VertNetInfo[] = new Array(bm.totvert)
    for (let i = 0; i < bm.totvert; i++) vnetInfo[i] = {prev: null, pass: 0, face: 0, flag: 0}
    const s: EdgenetState = {vnetInfo, edgeTag}
    const edgeQueue: BMEdge[] = []
    const passNr = {value: 1}

    if (!useEdgeTag) {
        for (const e of bm.edges) {
            if (bmEdgeStepOk(s, e)) edgeTag.add(e)
            else edgeTag.delete(e)
        }
    }

    bm.elemIndexEnsure(ElemType.Vert | ElemType.Face)

    while (true) {
        const e = bmEdgenetEdgeGetNext(bm, s, edgeQueue)
        if (e === null) break

        const path = bmEdgenetPathCalcBest(s, e, passNr, Number.MAX_SAFE_INTEGER)
        if (path) {
            const f = bmEdgenetFaceFromPath(bm, path.path)
            // queue edges to operate on
            let lIter = f.lFirst
            do {
                if (bmEdgeStepOk(s, lIter.e!)) edgeQueue.push(lIter.e!)
            } while ((lIter = lIter.next) !== f.lFirst)

            if (useNewFaceTag) faceTag.add(f)

            // the face index only needs to be unique, not kept valid
            f.index = bm.totface - 1
        }
    }
}

// endregion

// region bmo_edgenet.cc

/** Slots of `edgenet_fill` (`bmesh_opdefines.cc`, `bmo_edgenet_fill_def`). */
export interface EdgenetFillOptions {
    /** Material to use. */
    matNr?: number
    /** Smooth state to use. */
    useSmooth?: boolean
    /** Number of sides. Unused by Blender ("TODO: sides"). */
    sides?: number
}

/**
 * `bmo_edgenet_fill_exec` (`bmo_edgenet.cc:27`): fill the holes the net of `edges` bounds. New faces
 * take `matNr` / `useSmooth`, then `face_attribute_fill` copies attributes and winding from the
 * neighbouring faces; groups touching no existing face get their winding from
 * `recalc_face_normals`. Returns `faces.out` in mesh order.
 *
 * This is the exec body. Run as a top-level `bmesh.ops.edgenet_fill`, Blender then applies
 * `bmesh_edit_end` with `NORMALS_CALC | SELECT_FLUSH` (see {@link bmeshEditEnd}).
 */
export function edgenetFill(bm: BMesh, edges: readonly BMEdge[], options: EdgenetFillOptions = {}): BMFace[] {
    const matNr = options.matNr ?? 0
    const useSmooth = options.useSmooth ?? false

    if (!bm.totvert || !bm.totedge) return []

    const edgeTag = new Set(edges)
    const faceTag = new Set<BMFace>()
    meshEdgenet(bm, true, true, edgeTag, faceTag) // TODO (Blender): sides.

    // BMO_slot_buffer_from_enabled_hflag(..., BM_ELEM_TAG), respecting hide.
    const facesOut = [...bm.faces].filter(f => faceTag.has(f) && !(f.hflag & ElemFlag.Hidden))

    for (const f of facesOut) {
        f.matNr = matNr
        if (useSmooth) f.hflag |= ElemFlag.Smooth
        // Normals are zeroed.
        faceNormalUpdate(f)
    }

    // --- Attribute Fill ---
    const {facesFail} = faceAttributeFill(bm, facesOut, {useNormals: true, useData: true})
    // check if some faces couldn't be touched
    if (facesFail.length) recalcFaceNormals(bm, facesFail)

    return facesOut
}

/** `edge_next` (`bmo_edgenet.cc:77`). */
function edgeNext(e: BMEdge, edgeMark: Set<BMEdge>, edgeVis: Set<BMEdge>): BMEdge | null {
    for (let i = 0; i < 2; i++) {
        for (const e2 of diskEdges(i ? e.v2 : e.v1)) {
            if (edgeMark.has(e2) && !edgeVis.has(e2) && e2 !== e) return e2
        }
    }
    return null
}

/**
 * `bmo_edgenet_prepare_exec` (`bmo_edgenet.cc:96`): when `edges` form one or two open chains (no
 * vertex using more than two of them), close them so `edgenet_fill` can make a face: one chain gets
 * an edge between its ends, two chains get two edges between their ends, paired to avoid a bow-tie
 * (the most planar triangle pair, #30367 / #143905). Returns `edges.out` in mesh order: the new edges
 * and, because Blender's `ELE_NEW` and `EDGE_MARK` share a bit, the input edges - or nothing when the
 * input has a vertex with three input edges or two closed loops.
 */
export function edgenetPrepare(bm: BMesh, edges: readonly BMEdge[]): BMEdge[] {
    const edgeMark = new Set(edges) // EDGE_MARK
    const edgeVis = new Set<BMEdge>() // EDGE_VIS
    const eleNew = new Set<BMEdge>() // ELE_NEW
    const countMarked = (v: BMVert): number => {
        let n = 0
        for (const e of diskEdges(v)) if (edgeMark.has(e)) n++
        return n
    }

    // validate that each edge has at most one other tagged edge in the disk cycle around each of
    // its vertices
    let ok = true
    for (const e of edges) {
        for (let i = 0; i < 2; i++) {
            if (countMarked(i ? e.v2 : e.v1) > 2) {
                ok = false
                break
            }
        }
        if (!ok) break
    }
    // we don't have valid edge layouts, return
    if (!ok) return []

    let edges1: BMEdge[] = []
    let edges2: BMEdge[] = []

    // find connected loops within the input edge
    let count = 0
    while (true) {
        let e: BMEdge | null = null
        for (const eIter of edges) {
            if (!edgeVis.has(eIter)) {
                if (countMarked(eIter.v1) === 1 || countMarked(eIter.v2) === 1) {
                    e = eIter
                    break
                }
            }
        }
        if (!e) break

        let list: BMEdge[]
        if (!count) list = edges1
        else if (count === 1) list = edges2
        else break

        while (e) {
            edgeVis.add(e)
            list.push(e)
            e = edgeNext(e, edgeMark, edgeVis)
        }
        count++
    }

    if (edges1.length > 2 && edgeShareVertCheck(edges1[0], edges1[edges1.length - 1])) {
        if (edges2.length > 2 && edgeShareVertCheck(edges2[0], edges2[edges2.length - 1])) {
            return []
        }
        edges1 = edges2
        edges2 = []
    }

    if (edges2.length > 2 && edgeShareVertCheck(edges2[0], edges2[edges2.length - 1])) {
        edges2 = []
    }

    // two unconnected loops, connect the
    if (edges1.length && edges2.length) {
        let v1: BMVert, v2: BMVert, v3: BMVert, v4: BMVert
        if (edges1.length === 1) {
            v1 = edges1[0].v1
            v2 = edges1[0].v2
        } else {
            v1 = edges1[1].uses(edges1[0].v1) ? edges1[0].v2 : edges1[0].v1
            const i = edges1.length - 1
            v2 = edges1[i - 1].uses(edges1[i].v1) ? edges1[i].v2 : edges1[i].v1
        }
        if (edges2.length === 1) {
            v3 = edges2[0].v1
            v4 = edges2[0].v2
        } else {
            v3 = edges2[1].uses(edges2[0].v1) ? edges2[0].v2 : edges2[0].v1
            const i = edges2.length - 1
            v4 = edges2[i - 1].uses(edges2[i].v1) ? edges2[i].v2 : edges2[i].v1
        }

        // Avoid bow tie quads using most planar the triangle pair, see: #30367 & #143905.
        // (Blender 3.4.1 instead swapped when the unnormalised crosses (v1-v2)x(v1-v4) and
        // (v1-v4)x(v1-v3) pointed apart.)
        let dvec1 = normalTriV3Len(co(v1), co(v2), co(v4)).n
        let dvec2 = normalTriV3Len(co(v1), co(v4), co(v3)).n
        const dot24 = dvec1[0] * dvec2[0] + dvec1[1] * dvec2[1] + dvec1[2] * dvec2[2]

        dvec1 = normalTriV3Len(co(v1), co(v2), co(v3)).n
        dvec2 = normalTriV3Len(co(v1), co(v3), co(v4)).n
        const dot13 = dvec1[0] * dvec2[0] + dvec1[1] * dvec2[1] + dvec1[2] * dvec2[2]
        if (dot24 < dot13) {
            const t = v3
            v3 = v4
            v4 = t
        }

        eleNew.add(bm.edgeCreate(v1, v3, undefined, {noDouble: true}))
        eleNew.add(bm.edgeCreate(v2, v4, undefined, {noDouble: true}))
    } else if (edges1.length) {
        if (edges1.length > 1) {
            const v1 = edges1[1].uses(edges1[0].v1) ? edges1[0].v2 : edges1[0].v1
            const i = edges1.length - 1
            const v2 = edges1[i - 1].uses(edges1[i].v1) ? edges1[i].v2 : edges1[i].v1
            eleNew.add(bm.edgeCreate(v1, v2, undefined, {noDouble: true}))
        }
    }

    // BMO_slot_buffer_from_enabled_flag(..., ELE_NEW). `ELE_NEW` and `EDGE_MARK` are the same bit
    // (both `1`, `bmo_edgenet.cc:22-25`), so `edges.out` holds the input edges too - but only when
    // the exec gets this far (the early returns above leave it empty).
    return [...bm.edges].filter(e => eleNew.has(e) || edgeMark.has(e))
}

// endregion
