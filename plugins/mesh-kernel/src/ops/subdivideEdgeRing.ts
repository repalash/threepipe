/**
 * Subdivide Edge-Ring: cut the edges that run across a selected ring of edges, with the new loops
 * following a straight line, a blended path, or the surface on either side.
 *
 * Port of `source/blender/bmesh/operators/bmo_subdivide_edgering.cc` (`bmesh.ops.subdivide_edgering`)
 * and `edbm_subdivide_edge_ring_exec` (`editors/mesh/editmesh_tools.cc:294`, `MESH_OT_subdivide_edgering`).
 * `BKE_curve_forward_diff_bezier` (`blenkernel/intern/curve.cc:1695`) is ported here too.
 *
 * Blender's operator flags (`EDGE_RING`, `EDGE_RIM`, `FACE_OUT`, ...) and the vertex `BM_ELEM_TAG`
 * become sets beside the mesh; nothing on the elements is touched except what the operator changes.
 * One ordering detail differs: Blender keys an edge-loop pair by the two stores' memory addresses
 * (`bm_edgering_pair_calc`, `:255`), which follow allocation order in practice; here they are keyed by
 * the order `BM_mesh_edgeloops_find` returned them in.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, radialLoops} from '../bmesh/structure'
import {ElemFlag} from '../constants'
import {
    BMEdgeLoopStore,
    edgeloopCalcCenter,
    edgeloopCalcNormal,
    edgeloopCalcNormalAligned,
    edgeloopEdgesGet,
    edgeloopFlip,
    edgeloopFromVerts,
    edgeloopsFind,
} from '../bmesh/edgeloop'
import {edgeSplit, faceSplit} from '../bmesh/mods'
import {Vec3, v3cross, v3dot, v3sub} from '../math'
import {
    angleNormalizedV3V3,
    bisectV3V3V3V3,
    closestToLineV3,
    lenV3V3,
    normalizeV3Len,
    transformPointByTriV3,
} from '../math/geom'
import {axisAngleToQuat, mulQtQtQt, mulQtV3, normalizeQt, Quat, vecToQuat} from '../math/rotation'
import {SubdFalloff, subdFalloffCalc} from './subdivide'

const FLT_EPSILON = 1.1920929e-7

/** `SUBD_RING_INTERP_*` (`bmesh_operators.hh`): how the new loops are placed between the two rims. */
export type EdgeRingInterp = 'linear' | 'path' | 'surface'

export interface SubdivideEdgeRingOptions {
    /** `cuts`: new loops between each pair of rims. */
    cuts: number
    /** `interp_mode`. */
    interpMode: EdgeRingInterp
    /** `smooth`: the bezier handle length factor for `path` and `surface`. */
    smooth: number
    /** `profile_shape`: the falloff that shapes the profile. */
    profileShape?: SubdFalloff
    /** `profile_shape_factor`: how much the intermediate loops shrink (negative) or grow; 0 is none. */
    profileShapeFactor?: number
}

export type SubdivideEdgeRingResult =
    | {ok: true, changed: boolean, faces: BMFace[]}
    | {ok: false, error: string}

/** `BMO_slot_buffer_flag_enable` / `BMO_*_flag_*` stand-ins, one set per flag. */
interface Flags {
    edgeRing: Set<BMEdge>
    edgeRim: Set<BMEdge>
    edgeInStack: Set<BMEdge>
    faceOut: Set<BMFace>
    faceShared: Set<BMFace>
    faceInStack: Set<BMFace>
    vertShared: Set<BMVert>
    /** `BM_ELEM_TAG` on vertices. */
    tag: Set<BMVert>
}

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

function setFlag<T>(set: Set<T>, el: T, on: boolean): void {
    if (on) set.add(el)
    else set.delete(el)
}

// region specialized utility functions (`bmo_subdivide_edgering.cc:50-191`)

/** `bezier_handle_calc_length_v3` (`:69`). */
function bezierHandleCalcLengthV3(coA: Vec3, noA: Vec3, coB: Vec3, noB: Vec3): number {
    const dot = v3dot(noA, noB)
    // gives closest approx at a circle with 2 parallel handles
    let fac = 1.333333
    if (dot < 0) {
        // Scale down to 0.666 if we point directly at each other rough but ok.
        // TODO: current blend from dot may not be optimal but its also a detail.
        const t = 1 + dot
        fac = fac * t + 0.75 * (1 - t)
    }
    // 2d length projected on plane of normals
    let coAOfs = v3cross(noA, noB)
    if (v3dot(coAOfs, coAOfs) > FLT_EPSILON) {
        coAOfs = [coAOfs[0] + coA[0], coAOfs[1] + coA[1], coAOfs[2] + coA[2]]
        // `closest_to_line_v3(co_a_ofs, co_b, co_a, co_a_ofs)`: `co_b` onto the line through `co_a`.
        coAOfs = closestToLineV3(coB, coA, coAOfs)
    } else {
        coAOfs = [coA[0], coA[1], coA[2]]
    }
    const len = lenV3V3(coAOfs, coB)
    return len * 0.5 * fac
}

/** `bm_edgeloop_vert_tag` (`:106`). */
function edgeloopVertTag(fl: Flags, store: BMEdgeLoopStore, tag: boolean): void {
    for (const v of store.verts) setFlag(fl.tag, v, tag)
}

/** `bmo_edgeloop_vert_tag` (`:114`). */
function bmoEdgeloopVertTag(fl: Flags, store: BMEdgeLoopStore, tag: boolean): void {
    for (const v of store.verts) setFlag(fl.vertShared, v, tag)
}

/** `bmo_face_is_vert_tag_all` (`:125`). */
function faceIsVertSharedAll(fl: Flags, f: BMFace): boolean {
    for (const l of f.eachLoop()) if (!fl.vertShared.has(l.v)) return false
    return true
}

/** `bm_vert_is_tag_edge_connect` (`:137`). */
function vertIsTagEdgeConnect(fl: Flags, v: BMVert): boolean {
    for (const e of diskEdges(v)) {
        if (fl.edgeRing.has(e) && fl.tag.has(e.otherVert(v))) return true
    }
    return false
}

/**
 * `bm_edgeloop_check_overlap_all` (`:157`): every vertex of each loop has a ring edge to the other.
 * For now we need full overlap, supporting partial overlap could be done but gets complicated when
 * trimming endpoints is not enough to ensure consistency.
 */
function edgeloopCheckOverlapAll(fl: Flags, a: BMEdgeLoopStore, b: BMEdgeLoopStore): boolean {
    let hasOverlap = true
    edgeloopVertTag(fl, a, false)
    edgeloopVertTag(fl, b, true)
    for (const v of a.verts) {
        if (!vertIsTagEdgeConnect(fl, v)) {
            hasOverlap = false
            break
        }
    }
    if (hasOverlap) {
        edgeloopVertTag(fl, a, true)
        edgeloopVertTag(fl, b, false)
        for (const v of b.verts) {
            if (!vertIsTagEdgeConnect(fl, v)) {
                hasOverlap = false
                break
            }
        }
    }
    edgeloopVertTag(fl, a, false)
    edgeloopVertTag(fl, b, false)
    return hasOverlap
}

// endregion

// region edge loop pairs (`:193-266`)

/** `bm_edgering_pair_calc` (`:201`): the rim loops a ring edge joins, each pair once, in finding order. */
function edgeringPairCalc(fl: Flags, eloopsRim: BMEdgeLoopStore[]): [BMEdgeLoopStore, BMEdgeLoopStore][] {
    const order = new Map<BMEdgeLoopStore, number>()
    eloopsRim.forEach((s, i) => order.set(s, i))
    // create vert -> eloop map
    const vertEloop = new Map<BMVert, BMEdgeLoopStore>()
    for (const store of eloopsRim) {
        // `Map::add` keeps the first value for a key.
        for (const v of store.verts) if (!vertEloop.has(v)) vertEloop.set(v, store)
    }
    // collect eloop pairs
    const pairs: [BMEdgeLoopStore, BMEdgeLoopStore][] = []
    const seen = new Set<string>()
    for (const store of eloopsRim) {
        const v = store.verts[0]
        for (const e of diskEdges(v)) {
            if (!fl.edgeRing.has(e)) continue
            const other = vertEloop.get(e.otherVert(v))
            // in rare cases we can't find a match
            if (!other) continue
            let first = store, second = other
            if (order.get(first)! > order.get(second)!) [first, second] = [second, first]
            const key = order.get(first) + ',' + order.get(second)
            // The pair may exist already.
            if (!seen.has(key)) {
                seen.add(key)
                pairs.push([first, second])
            }
        }
    }
    return pairs
}

// endregion

// region subdivide an edge 'n' times and return an open edgeloop (`:270-301`)

/** `BM_edge_split_n` (`bmesh_mods.cc:584`): the new vertices, ordered from `e.v1` to `e.v2`. */
export function edgeSplitN(bm: BMesh, e: BMEdge, numcuts: number): BMVert[] {
    const varr: BMVert[] = new Array(numcuts)
    for (let i = 0; i < numcuts; i++) {
        const percent = 1 / (numcuts + 1 - i)
        const {vNew} = edgeSplit(bm, e, e.v2, percent)
        // fill in reverse order (v1 -> v2)
        varr[numcuts - i - 1] = vNew
    }
    return varr
}

/** `bm_edge_subdiv_as_loop` (`:274`). */
function edgeSubdivAsLoop(bm: BMesh, eloops: BMEdgeLoopStore[], e: BMEdge, vA: BMVert, cuts: number): void {
    const vB = e.otherVert(vA)
    const inner = edgeSplitN(bm, e, cuts)
    // `e->v1` after the split, as Blender reads it.
    const varr = vA === e.v1 ? [vA, ...inner, vB] : [vB, ...inner, vA]
    const eloop = edgeloopFromVerts(varr, false)
    if (vA === e.v1) edgeloopFlip(eloop)
    eloops.push(eloop)
}

// endregion

// region loop pair cache (`:305-525`)

/** `BM_edge_calc_face_tangent` (`bmesh_query.cc:1398`). */
function edgeCalcFaceTangent(l: BMLoop): Vec3 {
    // `BM_edge_ordered_verts_ex`: the edge's verts in the winding of `l`.
    const tvec = v3sub(co(l.v), co(l.next.v))
    // NOTE: we could average the tangents of both loops, for non flat ngons it will give a better direction.
    const r = v3cross(tvec, [l.f.nx, l.f.ny, l.f.nz])
    normalizeV3Len(r)
    return r
}

/**
 * `bm_vert_calc_surface_tangent` (`:319`): the direction the spline leaves a rim vertex, from the
 * faces around the rim. Resulting normal will _always_ point towards `FACE_SHARED`.
 */
function vertCalcSurfaceTangent(fl: Flags, v: BMVert): Vec3 {
    // get outer normal, fall back to inner (if this vertex is on a boundary)
    let foundOuter = false, foundInner = false, foundOuterTag = false
    const noOuter: Vec3 = [0, 0, 0], noInner: Vec3 = [0, 0, 0]

    // first find rim edges, typically we will only add 2 normals
    for (const e of diskEdges(v)) {
        if (e.l === null) {
            // pass - this may confuse things
        } else if (fl.edgeRim.has(e)) {
            for (const l of radialLoops(e)) {
                // use unmarked (surrounding) faces to create surface tangent
                const no = edgeCalcFaceTangent(l)
                if (fl.faceShared.has(l.f)) {
                    noInner[0] += no[0]
                    noInner[1] += no[1]
                    noInner[2] += no[2]
                    foundInner = true
                } else {
                    noOuter[0] += no[0]
                    noOuter[1] += no[1]
                    noOuter[2] += no[2]
                    foundOuter = true
                    // other side is used too, blend midway
                    if (fl.faceOut.has(l.f)) foundOuterTag = true
                }
            }
        }
    }

    // detect if this vertex is in-between 2 loops (when blending multiple), if so - take both inner
    // and outer into account
    if (foundInner && foundOuterTag) {
        // blend between the 2
        const neg: Vec3 = [-noOuter[0], -noOuter[1], -noOuter[2]]
        normalizeV3Len(neg)
        normalizeV3Len(noInner)
        const r: Vec3 = [neg[0] + noInner[0], neg[1] + noInner[1], neg[2] + noInner[2]]
        normalizeV3Len(r)
        return r
    }
    if (foundOuter) {
        const r: Vec3 = [-noOuter[0], -noOuter[1], -noOuter[2]]
        normalizeV3Len(r)
        return r
    }
    // we always have inner geometry
    const r: Vec3 = [noInner[0], noInner[1], noInner[2]]
    normalizeV3Len(r)
    return r
}

/** `bm_faces_share_tag_flush` (`:385`): tag faces whose vertices are all `VERT_SHARED`. */
function facesShareTagFlush(fl: Flags, edges: BMEdge[]): void {
    for (const e of edges) {
        for (const l of radialLoops(e)) {
            if (!fl.faceShared.has(l.f) && faceIsVertSharedAll(fl, l.f)) fl.faceShared.add(l.f)
        }
    }
}

/** `bm_faces_share_tag_clear` (`:407`). */
function facesShareTagClear(fl: Flags, edges: BMEdge[]): void {
    for (const e of edges) for (const l of radialLoops(e)) fl.faceShared.delete(l.f)
}

/** `LoopPairStore` (`:429`): the spline handle directions of the two rims, cached before any change. */
interface LoopPairStore {
    norsA: Map<BMVert, Vec3>
    norsB: Map<BMVert, Vec3>
}

/** `bm_edgering_pair_store_create` (`:440`). */
function edgeringPairStoreCreate(fl: Flags, a: BMEdgeLoopStore, b: BMEdgeLoopStore, interpMode: EdgeRingInterp): LoopPairStore {
    const lpair: LoopPairStore = {norsA: new Map(), norsB: new Map()}
    if (interpMode !== 'surface') return lpair

    const eArrA = edgeloopEdgesGet(a)
    const eArrB = edgeloopEdgesGet(b)

    // all other verts must _not_ be tagged
    bmoEdgeloopVertTag(fl, a, true)
    bmoEdgeloopVertTag(fl, b, true)
    // tag all faces that are in-between both loops
    facesShareTagFlush(fl, eArrA)
    facesShareTagFlush(fl, eArrB)

    // now we have all data we need, calculate vertex spline nor!
    for (const [store, nors] of [[a, lpair.norsA], [b, lpair.norsB]] as const) {
        for (const v of store.verts) {
            // `nors_gh_iter->add(v, i)` keeps the first index for a vertex.
            if (!nors.has(v)) nors.set(v, vertCalcSurfaceTangent(fl, v))
        }
    }

    // cleanup verts share
    bmoEdgeloopVertTag(fl, a, false)
    bmoEdgeloopVertTag(fl, b, false)
    // cleanup faces share
    facesShareTagClear(fl, eArrA)
    facesShareTagClear(fl, eArrB)
    return lpair
}

// endregion

// region interpolation function (`:529-827`)

/**
 * `BKE_curve_forward_diff_bezier` (`blenkernel/intern/curve.cc:1695`): `it + 1` points of one
 * coordinate of a cubic bezier by forward differencing.
 */
export function curveForwardDiffBezier(q0: number, q1: number, q2: number, q3: number, it: number): number[] {
    let f = it
    const rt0 = q0
    const rt1 = 3 * (q1 - q0) / f
    f *= f
    const rt2 = 3 * (q0 - 2 * q1 + q2) / f
    f *= it
    const rt3 = (q3 - q0 + 3 * (q1 - q2)) / f

    q0 = rt0
    q1 = rt1 + rt2 + rt3
    q2 = 2 * rt2 + 6 * rt3
    q3 = 6 * rt3

    const p: number[] = []
    for (let a = 0; a <= it; a++) {
        p.push(q0)
        q0 += q1
        q1 += q2
        q2 += q3
    }
    return p
}

/** The three `BKE_curve_forward_diff_bezier` calls over x, y and z. */
function bezierPoints(a: Vec3, ha: Vec3, hb: Vec3, b: Vec3, it: number): Vec3[] {
    const xs = curveForwardDiffBezier(a[0], ha[0], hb[0], b[0], it)
    const ys = curveForwardDiffBezier(a[1], ha[1], hb[1], b[1], it)
    const zs = curveForwardDiffBezier(a[2], ha[2], hb[2], b[2], it)
    return xs.map((x, i) => [x, ys[i], zs[i]])
}

const interpV3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function setCo(v: BMVert, c: Vec3): void {
    v.x = c[0]
    v.y = c[1]
    v.z = c[2]
}

/** `bm_edgering_pair_interpolate` (`:533`): place the new loops between the two rims. */
function edgeringPairInterpolate(lpair: LoopPairStore, a: BMEdgeLoopStore, b: BMEdgeLoopStore, eloopsRing: BMEdgeLoopStore[],
    interpMode: EdgeRingInterp, cuts: number, smooth: number, falloffCache: number[] | null): void {
    const resolu = cuts + 2

    edgeloopCalcCenter(a)
    edgeloopCalcCenter(b)
    let isANoValid = edgeloopCalcNormal(a)
    let isBNoValid = edgeloopCalcNormal(b)
    const aCo: Vec3 = [a.co[0], a.co[1], a.co[2]]
    const bCo: Vec3 = [b.co[0], b.co[1], b.co[2]]

    // correct normals need to be flipped to face each other; we know both normals point in the same
    // direction so one will need flipping
    const elDir = v3sub(aCo, bCo)
    const no: Vec3 = [elDir[0], elDir[1], elDir[2]]
    normalizeV3Len(no)
    if (!isANoValid) isANoValid = edgeloopCalcNormalAligned(a, no)
    if (!isBNoValid) isBNoValid = edgeloopCalcNormalAligned(b, no)
    void isANoValid
    void isBNoValid
    const aNo: Vec3 = [a.no[0], a.no[1], a.no[2]]
    const bNo: Vec3 = [b.no[0], b.no[1], b.no[2]]
    if (v3dot(aNo, elDir) > 0) {
        aNo[0] = -aNo[0]
        aNo[1] = -aNo[1]
        aNo[2] = -aNo[2]
    }
    if (v3dot(bNo, elDir) < 0) {
        bNo[0] = -bNo[0]
        bNo[1] = -bNo[1]
        bNo[2] = -bNo[2]
    }
    // now normals are correct, don't touch!

    // Calculate the center spline, multiple.
    let coordArrayMain: Vec3[] | null = null
    if (interpMode === 'path' || falloffCache) {
        const handleLen = bezierHandleCalcLengthV3(aCo, aNo, bCo, bNo) * smooth
        const handleA: Vec3 = [aCo[0] + aNo[0] * handleLen, aCo[1] + aNo[1] * handleLen, aCo[2] + aNo[2] * handleLen]
        const handleB: Vec3 = [bCo[0] + bNo[0] * handleLen, bCo[1] + bNo[1] * handleLen, bCo[2] + bNo[2] * handleLen]
        coordArrayMain = bezierPoints(aCo, handleA, handleB, bCo, resolu - 1)
    }

    switch (interpMode) {
    case 'linear': {
        if (falloffCache) {
            const coordArray: Vec3[] = []
            for (let i = 0; i < resolu; i++) coordArray.push(interpV3(aCo, bCo, i / (resolu - 1)))
            for (const ring of eloopsRing) {
                ring.verts.forEach((v, i) => {
                    // shape
                    if (i > 0 && i < resolu - 1) setCo(v, interpV3(coordArray[i], co(v), falloffCache[i]))
                })
            }
        }
        break
    }
    case 'path': {
        const main = coordArrayMain!
        const directionArray: Vec3[] = new Array(resolu)
        const quatArray: Quat[] = new Array(resolu)
        const triArray: [Vec3, Vec3, Vec3][] = new Array(resolu)

        // very similar to make_bevel_list_3D_minimum_twist

        // calculate normals
        directionArray[0] = [aNo[0], aNo[1], aNo[2]]
        directionArray[resolu - 1] = [-bNo[0], -bNo[1], -bNo[2]]
        for (let i = 1; i < resolu - 1; i++) directionArray[i] = bisectV3V3V3V3(main[i - 1], main[i], main[i + 1])

        quatArray[0] = vecToQuat(directionArray[0], 5, 1)
        normalizeQt(quatArray[0])

        for (let i = 1; i < resolu; i++) {
            const angle = angleNormalizedV3V3(directionArray[i - 1], directionArray[i])
            if (angle > 0) { // otherwise we can keep as is
                const crossTmp = v3cross(directionArray[i - 1], directionArray[i])
                const q = axisAngleToQuat(crossTmp, angle)
                quatArray[i] = mulQtQtQt(q, quatArray[i - 1])
                normalizeQt(quatArray[i])
            } else {
                quatArray[i] = [...quatArray[i - 1]] as Quat
            }
        }

        // init base tri
        for (let i = 0; i < resolu; i++) {
            const shapeSize = falloffCache ? falloffCache[i] : 1
            const tri: [Vec3, Vec3, Vec3] = [[0, 0, 0], [shapeSize, 0, 0], [0, shapeSize, 0]]
            // create the triangle and transform
            for (let j = 0; j < 3; j++) {
                const r = mulQtV3(quatArray[i], tri[j])
                tri[j] = [r[0] + main[i][0], r[1] + main[i][1], r[2] + main[i][2]]
            }
            triArray[i] = tri
        }

        const triSta = triArray[0]
        const triEnd = triArray[resolu - 1]

        for (const ring of eloopsRing) {
            const vA = ring.verts[0]
            const vB = ring.verts[ring.verts.length - 1]
            const coVA = co(vA), coVB = co(vB)
            // skip first and last
            for (let i = 1; i < ring.verts.length - 1; i++) {
                const triTmp = triArray[i]
                const coA = transformPointByTriV3(coVA, triTmp, triSta)
                const coB = transformPointByTriV3(coVB, triTmp, triEnd)
                setCo(ring.verts[i], interpV3(coA, coB, i / (resolu - 1)))
            }
        }
        break
    }
    case 'surface': {
        // calculate a bezier handle per edge ring
        for (const ring of eloopsRing) {
            const vA = ring.verts[0]
            const vB = ring.verts[ring.verts.length - 1]
            const coA = co(vA)
            const coB = co(vB)
            // don't calculate normals here else we get into feedback loop when subdividing 2+
            // connected edge rings
            const noA = lpair.norsA.get(vA)!
            const noB = lpair.norsB.get(vB)!
            const handleLen = bezierHandleCalcLengthV3(coA, noA, coB, noB) * smooth
            const handleA: Vec3 = [coA[0] + noA[0] * handleLen, coA[1] + noA[1] * handleLen, coA[2] + noA[2] * handleLen]
            const handleB: Vec3 = [coB[0] + noB[0] * handleLen, coB[1] + noB[1] * handleLen, coB[2] + noB[2] * handleLen]
            const coordArray = bezierPoints(coA, handleA, handleB, coB, resolu - 1)

            // skip first and last
            for (let i = 1; i < ring.verts.length - 1; i++) {
                if (i > 0 && i < resolu - 1) {
                    const v = ring.verts[i]
                    setCo(v, coordArray[i])
                    // shape
                    if (falloffCache) setCo(v, interpV3(coordArrayMain![i], co(v), falloffCache[i]))
                }
            }
        }
        break
    }
    }
}

// endregion

// region pair ordering and subdivision (`:829-1078`)

/** `bm_face_slice` (`:832`): cut an n-gon into `cuts + 1` slices. */
function faceSlice(bm: BMesh, fl: Flags, l: BMLoop, cuts: number): void {
    // TODO: interpolate edge data.
    let lNew: BMLoop | null = l
    for (let i = 0; i < cuts; i++) {
        // no chance of double
        const r = faceSplit(bm, lNew!.f, lNew!.prev, lNew!.next.next)
        lNew = r ? r.lNew : null
        if (lNew === null) {
            // This happens when l_new->prev and l_new->next->next are adjacent. Since this sets
            // l_new to nullptr, we cannot continue this for-loop.
            break
        }
        if (lNew.f.len < lNew.radialNext!.f.len) lNew = lNew.radialNext!
        fl.faceOut.add(lNew.f)
        fl.faceOut.add(lNew.radialNext!.f)
    }
}

/** `bm_edgering_pair_order_is_flipped` (`:854`). */
function edgeringPairOrderIsFlipped(a: BMEdgeLoopStore, b: BMEdgeLoopStore): boolean {
    const la = a.verts, lb = b.verts
    // we _must_ have same starting edge shared
    // step around any fan-faces on both sides
    let ia = 0
    do {
        ia++
    } while (ia < la.length && (diskEdgeExists(la[ia], lb[0]) || diskEdgeExists(la[ia], lb[1])))
    let ib = 0
    do {
        ib++
    } while (ib < lb.length && (diskEdgeExists(lb[ib], la[0]) || diskEdgeExists(lb[ib], la[1])))
    const sa = ia < la.length ? ia - 1 : la.length - 1
    const sb = ib < lb.length ? ib - 1 : lb.length - 1
    return !(diskEdgeExists(la[sa], lb[sb]) || diskEdgeExists(la[1], lb[sb]) || diskEdgeExists(lb[1], la[sa]))
}

/** `BLI_listbase_rotate_first`. */
function rotateFirst(store: BMEdgeLoopStore, v: BMVert): void {
    const i = store.verts.indexOf(v)
    if (i > 0) store.verts = [...store.verts.slice(i), ...store.verts.slice(0, i)]
}

/**
 * `bm_edgering_pair_order` (`:900`): takes 2 edge loops that share edges, sort their verts and
 * rotates the list so they line up.
 */
function edgeringPairOrder(fl: Flags, a: BMEdgeLoopStore, b: BMEdgeLoopStore): void {
    edgeloopVertTag(fl, a, false)
    edgeloopVertTag(fl, b, true)

    // before going much further, get ourselves in order
    // - align loops (not strictly necessary but handy)
    // - ensure winding is set for both loops
    if (a.closed && b.closed) {
        const first = a.verts[0]
        let vOther: BMVert | null = null
        for (const e of diskEdges(first)) {
            if (fl.edgeRing.has(e)) {
                vOther = e.otherVert(first)
                if (fl.tag.has(vOther)) break
                vOther = null
            }
        }
        if (vOther === null) throw new Error('subdivideEdgeRing: closed rims without a shared ring edge')
        rotateFirst(b, vOther)
        // now check we are winding the same way
        if (edgeringPairOrderIsFlipped(a, b)) {
            edgeloopFlip(b)
            // re-ensure the first node
            rotateFirst(b, vOther)
        }
    } else {
        // If we don't share and edge - flip.
        const e = diskEdgeExists(a.verts[0], b.verts[0])
        if (e === null || !fl.edgeRing.has(e)) edgeloopFlip(b)
    }

    // for cases with multiple loops
    edgeloopVertTag(fl, b, false)
}

/** `bm_edgering_pair_subdiv` (`:971`): subdivide the ring edges joining the two loops. */
function edgeringPairSubdiv(bm: BMesh, fl: Flags, a: BMEdgeLoopStore, b: BMEdgeLoopStore, eloopsRing: BMEdgeLoopStore[], cuts: number): void {
    const edgesRing: BMEdge[] = []
    const facesRing: BMFace[] = []

    edgeloopVertTag(fl, a, false)
    edgeloopVertTag(fl, b, true)

    for (const v of a.verts) {
        for (const e of diskEdges(v)) {
            if (fl.edgeInStack.has(e)) continue
            const vOther = e.otherVert(v)
            if (!fl.tag.has(vOther)) continue
            fl.edgeInStack.add(e)
            edgesRing.push(e)
            // add faces to the stack
            for (const l of radialLoops(e)) {
                const f = l.f
                if (fl.faceOut.has(f) && !fl.faceInStack.has(f)) {
                    fl.faceInStack.add(f)
                    facesRing.push(f)
                }
            }
        }
    }

    let e: BMEdge | undefined
    while ((e = edgesRing.pop())) {
        // found opposite edge
        fl.edgeInStack.delete(e)
        // unrelated to subdiv, but if we _don't_ clear flag, multiple rings fail
        fl.edgeRing.delete(e)
        const vOther = fl.tag.has(e.v1) ? e.v1 : e.v2
        edgeSubdivAsLoop(bm, eloopsRing, e, vOther, cuts)
    }

    let f: BMFace | undefined
    while ((f = facesRing.pop())) {
        fl.faceInStack.delete(f)
        // Check each edge of the face
        for (const l of f.eachLoop()) {
            if (fl.edgeRim.has(l.e!)) {
                faceSlice(bm, fl, l, cuts)
                break
            }
        }
    }

    // Clear tags so subdiv verts don't get tagged too.
    for (const ring of eloopsRing) edgeloopVertTag(fl, ring, false)
    // cleanup after
    edgeloopVertTag(fl, b, false)
}

/** `bm_edgering_pair_ringsubd` (`:1063`). */
function edgeringPairRingsubd(bm: BMesh, fl: Flags, lpair: LoopPairStore, a: BMEdgeLoopStore, b: BMEdgeLoopStore,
    interpMode: EdgeRingInterp, cuts: number, smooth: number, falloffCache: number[] | null): void {
    const eloopsRing: BMEdgeLoopStore[] = []
    edgeringPairOrder(fl, a, b)
    edgeringPairSubdiv(bm, fl, a, b, eloopsRing, cuts)
    edgeringPairInterpolate(lpair, a, b, eloopsRing, interpMode, cuts, smooth, falloffCache)
}

// endregion

/**
 * `bmo_subdivide_edgering_exec` (`bmo_subdivide_edgering.cc:1086`): subdivide the edges joining the
 * rims of the given ring edges. Faces must have at most 4 sides (#48926). Returns Blender's
 * operator errors as `{ok: false}` before anything changes.
 */
export function subdivideEdgeRing(bm: BMesh, edges: readonly BMEdge[], opts: SubdivideEdgeRingOptions): SubdivideEdgeRingResult {
    // NOTE: keep this operator fast, its used in a modifier.
    const cuts = Math.trunc(opts.cuts)
    const interpMode = opts.interpMode
    const smooth = opts.smooth
    const resolu = cuts + 2
    // optional 'shape'
    const profileShape = opts.profileShape ?? 'smooth'
    const profileShapeFactor = opts.profileShapeFactor ?? 0
    const falloffCache: number[] | null = profileShapeFactor !== 0 ? new Array(cuts + 2) : null

    const fl: Flags = {
        edgeRing: new Set(edges), edgeRim: new Set(), edgeInStack: new Set(),
        faceOut: new Set(), faceShared: new Set(), faceInStack: new Set(),
        vertShared: new Set(), tag: new Set(),
    }

    // flag outer edges (loops defined as edges on the bounds of the edge ring)
    for (const e of edges) {
        for (const lE of radialLoops(e)) {
            const f = lE.f
            // could support ngons, other areas would need updating too, see #48926.
            if (f.len <= 4 && !fl.faceOut.has(f)) {
                // check at least 2 edges in the face are rings
                let ok = false
                for (const l of f.eachLoop()) {
                    if (fl.edgeRing.has(l.e!) && e !== l.e) {
                        ok = true
                        break
                    }
                }
                if (ok) {
                    fl.faceOut.add(f)
                    for (const l of f.eachLoop()) if (!fl.edgeRing.has(l.e!)) fl.edgeRim.add(l.e!)
                }
            }
        }
    }

    // Cache falloff for each step (symmetrical)
    if (falloffCache) {
        for (let i = 0; i < resolu; i++) {
            let shapeSize = 1
            let fac = i / (resolu - 1)
            fac = Math.abs(1 - 2 * Math.abs(0.5 - fac))
            fac = subdFalloffCalc(profileShape, fac)
            shapeSize += fac * profileShapeFactor
            falloffCache[i] = shapeSize
        }
    }

    // Execute subdivision on all ring pairs
    const eloopsRim = edgeloopsFind(bm, e => fl.edgeRim.has(e))
    let changed = false

    if (eloopsRim.length < 2) {
        return {ok: false, error: 'No edge rings found'}
    } else if (eloopsRim.length === 2) {
        // this case could be removed, but simple to avoid 'bm_edgering_pair_calc' in this case since
        // there's only one.
        const [a, b] = eloopsRim
        if (!edgeloopCheckOverlapAll(fl, a, b)) return {ok: false, error: 'Edge-ring pair isn\'t connected'}
        const lpair = edgeringPairStoreCreate(fl, a, b, interpMode)
        edgeringPairRingsubd(bm, fl, lpair, a, b, interpMode, cuts, smooth, falloffCache)
        changed = true
    } else {
        const pairs = edgeringPairCalc(fl, eloopsRim)
        if (!pairs.length) return {ok: false, error: 'Edge-rings are not connected'}
        // first cache pairs
        const lpairArr = pairs.map(([a, b]) => edgeloopCheckOverlapAll(fl, a, b) ? edgeringPairStoreCreate(fl, a, b, interpMode) : null)
        pairs.forEach(([a, b], i) => {
            const lpair = lpairArr[i]
            if (lpair) {
                edgeringPairRingsubd(bm, fl, lpair, a, b, interpMode, cuts, smooth, falloffCache)
                changed = true
            }
        })
    }

    // flag output
    const faces: BMFace[] = []
    if (changed) for (const f of bm.faces) if (fl.faceOut.has(f)) faces.push(f)
    return {ok: true, changed, faces}
}

/** `MESH_OT_subdivide_edgering`'s properties (`mesh_operator_edgering_props`, `editmesh_tools.cc:237`). */
export interface EditMeshSubdivideEdgeRingProps {
    /** `number_cuts`, default 10. */
    numberCuts?: number
    /** `interpolation`, default `path`. */
    interpolation?: EdgeRingInterp
    /** `smoothness`, default 1. */
    smoothness?: number
    /** `profile_shape`, default `smooth`. */
    profileShape?: SubdFalloff
    /** `profile_shape_factor`, default 0. */
    profileShapeFactor?: number
}

/**
 * `edbm_subdivide_edge_ring_exec` (`editmesh_tools.cc:294`): the selected edges as the ring. Null
 * when no edge is selected (the object is skipped); `{ok: false}` with Blender's report when the
 * selection is not a ring, and then the mesh is unchanged.
 */
export function editMeshSubdivideEdgeRing(bm: BMesh, props: EditMeshSubdivideEdgeRingProps = {}): SubdivideEdgeRingResult | null {
    if (bm.totedgesel === 0) return null
    // `edges=%he`: the selected edges, in mesh order.
    const edges: BMEdge[] = []
    for (const e of bm.edges) if (e.hflag & ElemFlag.Select) edges.push(e)
    return subdivideEdgeRing(bm, edges, {
        cuts: props.numberCuts ?? 10,
        interpMode: props.interpolation ?? 'path',
        smooth: props.smoothness ?? 1,
        profileShape: props.profileShape ?? 'smooth',
        profileShapeFactor: props.profileShapeFactor ?? 0,
    })
}
