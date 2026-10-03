/**
 * Subdivide Edge-Ring: cut the edges of a ring (the rungs between two rim loops) `cuts` times and
 * place the new vertices along a blend path, a surface-following curve or a straight line, with an
 * optional profile that bulges or pinches the middle.
 *
 * Ported from `source/blender/bmesh/operators/bmo_subdivide_edgering.cc` (all of it) and the edit-mode
 * operator `MESH_OT_subdivide_edgering` (`editors/mesh/editmesh_tools.cc:228-352`,
 * `mesh_operator_edgering_props`, `edbm_subdivide_edge_ring_exec`). Bridge Edge Loops' "Number of
 * Cuts" runs the same operator on the bridge's new edges (`bridge.ts`).
 *
 * Flags: the operator flags (`VERT_SHARED`, `EDGE_RING`, `EDGE_RIM`, `EDGE_IN_STACK`, `FACE_OUT`,
 * `FACE_SHARED`, `FACE_IN_STACK`) are `Set`s; the vertex `BM_ELEM_TAG` Blender uses to mark one side
 * of a loop pair is the header bit `ElemFlag.Tag`, cleared again before each function returns, as in
 * Blender ("verts use BM_ELEM_TAG, these need to be cleared before functions exit").
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists, diskEdges, edgeIsWire, radialLoops} from '../bmesh/structure'
import {
    BMEdgeLoopStore, edgeloopCalcCenter, edgeloopCalcNormal, edgeloopCalcNormalAligned, edgeloopEdgesGet,
    edgeloopFlip, edgeloopFromVerts, edgeloopsFind,
} from '../bmesh/edgeloop'
import {edgeSplit, faceSplit} from '../bmesh/mods'
import {elemHflagDisableAll} from '../bmesh/hflag'
import {BmeshEditEndFlags, bmoOpExec} from './bmo'
import {closestToLineV3} from './bevel-math'
import {ElemFlag, ElemType} from '../constants'
import {Vec3, v3cross, v3dot, v3sub} from '../math'
import {
    Quat, angleNormalizedV3V3, axisAngleToQuat, bisectV3V3V3, curveForwardDiffBezier, lenV3V3,
    mulQtQtqt, mulQtV3, normalizeQt, normalizeV3Len, transformPointByTriV3, vecToQuat,
} from '../math/geom'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]
const FLT_EPSILON = 1.1920928955078125e-7

// region helpers (generic - exported for reuse)


/**
 * `BM_edge_split_n` (`bmesh_mods.cc:584`): split `e` into `numcuts + 1` equal parts, always at its
 * current `v2` end. Returns the new vertices in order from `e.v1` to `e.v2`.
 */
export function edgeSplitN(bm: BMesh, e: BMEdge, numcuts: number): BMVert[] {
    const rVarr: BMVert[] = new Array(numcuts)
    for (let i = 0; i < numcuts; i++) {
        const percent = 1.0 / (numcuts + 1 - i)
        const {vNew} = edgeSplit(bm, e, e.v2, percent)
        // fill in reverse order (v1 -> v2)
        rVarr[numcuts - i - 1] = vNew
    }
    return rVarr
}

/**
 * `BM_edge_calc_face_tangent` (`bmesh_query.cc:1398`): the unit vector in `eLoop`'s face,
 * perpendicular to the edge, from the face's stored normal.
 */
export function edgeCalcFaceTangent(eLoop: BMLoop): Vec3 {
    const v1 = eLoop.v
    const v2 = eLoop.next.v
    const tvec = v3sub(co(v1), co(v2)) // use for temp storage
    // NOTE: we could average the tangents of both loops, for non flat ngons it will give a better
    // direction
    const r = v3cross(tvec, [eLoop.f.nx, eLoop.f.ny, eLoop.f.nz])
    normalizeV3Len(r)
    return r
}

/** `eSubdFalloff` / `PROP_*` names, as `rna_enum_proportional_falloff_curve_only_items` has them. */
export type SubdivProfileShape = 'SMOOTH' | 'SPHERE' | 'ROOT' | 'INVERSE_SQUARE' | 'SHARP' | 'LINEAR'

/** `bmesh_subd_falloff_calc` (`bmesh_query.cc:2477`). */
export function subdFalloffCalc(falloff: SubdivProfileShape, val: number): number {
    switch (falloff) {
    case 'SMOOTH':
        val = 3.0 * val * val - 2.0 * val * val * val
        break
    case 'SPHERE':
        val = Math.sqrt(2.0 * val - val * val)
        break
    case 'ROOT':
        val = Math.sqrt(val)
        break
    case 'SHARP':
        val = val * val
        break
    case 'LINEAR':
        break
    case 'INVERSE_SQUARE':
        val = val * (2.0 - val)
        break
    default:
        throw new Error(`mesh-kernel: unknown profile shape ${falloff as string}`)
    }
    return val
}

// endregion

/** Per-operator flags of one `subdivide_edgering` call. */
interface RingFlags {
    vertShared: Set<BMVert>
    edgeRing: Set<BMEdge>
    edgeRim: Set<BMEdge>
    edgeInStack: Set<BMEdge>
    faceOut: Set<BMFace>
    faceShared: Set<BMFace>
    faceInStack: Set<BMFace>
}

const isTag = (v: BMVert) => (v.hflag & ElemFlag.Tag) !== 0

// region Specialized Utility Functions

/**
 * `bezier_handle_calc_length_v3` (`bmo_subdivide_edgering.cc:69`): a Bezier handle length for two
 * points with handle directions, scaled down when they point at each other, measured on the plane of
 * the two directions.
 */
function bezierHandleCalcLengthV3(coA: Vec3, noA: Vec3, coB: Vec3, noB: Vec3): number {
    const dot = v3dot(noA, noB)
    // gives closest approx at a circle with 2 parallel handles
    let fac = 1.333333
    if (dot < 0) {
        // Scale down to 0.666 if we point directly at each other rough but ok.
        const t = 1.0 + dot
        fac = (fac * t) + (0.75 * (1.0 - t))
    }

    // 2d length projected on plane of normals
    let len: number
    {
        let coAOfs = v3cross(noA, noB)
        if (v3dot(coAOfs, coAOfs) > FLT_EPSILON) {
            coAOfs = [coAOfs[0] + coA[0], coAOfs[1] + coA[1], coAOfs[2] + coA[2]]
            closestToLineV3(coAOfs, coB, coA, coAOfs)
        } else {
            coAOfs = [coA[0], coA[1], coA[2]]
        }
        len = lenV3V3(coAOfs, coB)
    }

    return (len * 0.5) * fac
}

/** `bm_edgeloop_vert_tag` (`:106`). */
function edgeloopVertTag(elStore: BMEdgeLoopStore, tag: boolean): void {
    for (const v of elStore.verts) v.setFlag(ElemFlag.Tag, tag)
}

/** `bmo_edgeloop_vert_tag` (`:114`). */
function bmoEdgeloopVertTag(oflag: Set<BMVert>, elStore: BMEdgeLoopStore, tag: boolean): void {
    for (const v of elStore.verts) {
        if (tag) oflag.add(v)
        else oflag.delete(v)
    }
}

/** `bmo_face_is_vert_tag_all` (`:125`). */
function bmoFaceIsVertTagAll(f: BMFace, oflag: Set<BMVert>): boolean {
    for (const l of f.eachLoop()) if (!oflag.has(l.v)) return false
    return true
}

/** `bm_vert_is_tag_edge_connect` (`:137`): a ring edge at `v` leads to a tagged vertex. */
function vertIsTagEdgeConnect(flags: RingFlags, v: BMVert): boolean {
    for (const e of diskEdges(v)) {
        if (flags.edgeRing.has(e)) {
            const vOther = e.otherVert(v)
            if (isTag(vOther)) return true
        }
    }
    return false
}

/**
 * `bm_edgeloop_check_overlap_all` (`:157`): every vertex of each loop has a ring edge to the other
 * loop. "for now we need full overlap".
 */
function edgeloopCheckOverlapAll(flags: RingFlags, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore): boolean {
    let hasOverlap = true
    finally_: {
        edgeloopVertTag(elStoreA, false)
        edgeloopVertTag(elStoreB, true)
        for (const v of elStoreA.verts) {
            if (vertIsTagEdgeConnect(flags, v) === false) {
                hasOverlap = false
                break finally_
            }
        }
        edgeloopVertTag(elStoreA, true)
        edgeloopVertTag(elStoreB, false)
        for (const v of elStoreB.verts) {
            if (vertIsTagEdgeConnect(flags, v) === false) {
                hasOverlap = false
                break finally_
            }
        }
    }
    edgeloopVertTag(elStoreA, false)
    edgeloopVertTag(elStoreB, false)
    return hasOverlap
}

// endregion

// region Edge Loop Pairs

/**
 * `bm_edgering_pair_calc` (`:201`): the pairs of rim loops a ring edge joins, each found from the
 * first vertex of a loop, in order of discovery, without repeats. Blender orders a pair by the two
 * stores' addresses (`pair_test.first > pair_test.second`); the stores are allocated in
 * `BM_mesh_edgeloops_find` order, which is what their index in `eloopsRim` stands in for here.
 */
function edgeringPairCalc(flags: RingFlags, eloopsRim: BMEdgeLoopStore[]): [BMEdgeLoopStore, BMEdgeLoopStore][] {
    const eloopPairSet: [BMEdgeLoopStore, BMEdgeLoopStore][] = []
    const seen = new Set<string>()
    const vertEloopMap = new Map<BMVert, number>()

    // create vert -> eloop map (`Map::add` keeps the first)
    eloopsRim.forEach((elStore, i) => {
        for (const v of elStore.verts) if (!vertEloopMap.has(v)) vertEloopMap.set(v, i)
    })

    // collect eloop pairs
    eloopsRim.forEach((elStore, i) => {
        const v = elStore.verts[0]
        for (const e of diskEdges(v)) {
            if (flags.edgeRing.has(e)) {
                const vOther = e.otherVert(v)
                const other = vertEloopMap.get(vOther)
                // in rare cases we can't find a match
                if (other !== undefined) {
                    let first = i, second = other
                    if (first > second) [first, second] = [second, first]
                    // The pair may exist already.
                    const key = `${first},${second}`
                    if (!seen.has(key)) {
                        seen.add(key)
                        eloopPairSet.push([eloopsRim[first], eloopsRim[second]])
                    }
                }
            }
        }
    })
    return eloopPairSet
}

// endregion

// region Subdivide an edge 'n' times and return an open edgeloop

/**
 * `bm_edge_subdiv_as_loop` (`:274`): split `e` `cuts` times and append the open loop of its
 * vertices, running from the end that is not `vA` to `vA`.
 */
function edgeSubdivAsLoop(bm: BMesh, eloops: BMEdgeLoopStore[], e: BMEdge, vA: BMVert, cuts: number): void {
    const vB = e.otherVert(vA)
    const inner = edgeSplitN(bm, e, cuts)
    const vArr: BMVert[] = new Array(cuts + 2)
    for (let i = 0; i < cuts; i++) vArr[i + 1] = inner[i]
    if (vA === e.v1) {
        vArr[0] = vA
        vArr[cuts + 1] = vB
    } else {
        vArr[0] = vB
        vArr[cuts + 1] = vA
    }
    const eloop = edgeloopFromVerts(vArr, false)
    if (vA === e.v1) edgeloopFlip(eloop)
    eloops.push(eloop)
}

// endregion

// region Loop Pair Cache

/**
 * `bm_vert_calc_surface_tangent` (`:319`): the direction a ring leaves `v` along the surrounding
 * surface - the negated face tangent of the rim edges' faces outside the pair (blended with the
 * inside when `v` sits between two pairs), or the inside's when `v` is on a boundary. Always points
 * towards `FACE_SHARED`. Reads face normals, so they must be current.
 */
function vertCalcSurfaceTangent(flags: RingFlags, v: BMVert): Vec3 {
    // get outer normal, fall back to inner (if this vertex is on a boundary)
    let foundOuter = false, foundInner = false, foundOuterTag = false
    const noOuter: Vec3 = [0, 0, 0]
    const noInner: Vec3 = [0, 0, 0]

    // first find rim edges, typically we will only add 2 normals
    for (const e of diskEdges(v)) {
        if (edgeIsWire(e)) {
            // pass - this may confuse things
        } else if (flags.edgeRim.has(e)) {
            for (const l of radialLoops(e)) {
                // use unmarked (surrounding) faces to create surface tangent
                const no = edgeCalcFaceTangent(l)
                if (flags.faceShared.has(l.f)) {
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
                    if (flags.faceOut.has(l.f)) foundOuterTag = true
                }
            }
        }
    }

    // detect if this vertex is in-between 2 loops (when blending multiple), if so - take both inner
    // and outer into account
    const rNo: Vec3 = [0, 0, 0]
    if (foundInner && foundOuterTag) {
        // blend between the 2
        noOuter[0] = -noOuter[0]
        noOuter[1] = -noOuter[1]
        noOuter[2] = -noOuter[2]
        normalizeV3Len(noOuter)
        normalizeV3Len(noInner)
        rNo[0] = noOuter[0] + noInner[0]
        rNo[1] = noOuter[1] + noInner[1]
        rNo[2] = noOuter[2] + noInner[2]
        normalizeV3Len(rNo)
    } else if (foundOuter) {
        rNo[0] = -noOuter[0]
        rNo[1] = -noOuter[1]
        rNo[2] = -noOuter[2]
        normalizeV3Len(rNo)
    } else {
        // we always have inner geometry
        rNo[0] = noInner[0]
        rNo[1] = noInner[1]
        rNo[2] = noInner[2]
        normalizeV3Len(rNo)
    }
    return rNo
}

/** `bm_faces_share_tag_flush` (`:385`): tag the faces at these edges whose corners are all `VERT_SHARED`. */
function facesShareTagFlush(flags: RingFlags, eArr: readonly BMEdge[]): void {
    for (const e of eArr) {
        for (const l of radialLoops(e)) {
            if (!flags.faceShared.has(l.f)) {
                if (bmoFaceIsVertTagAll(l.f, flags.vertShared)) flags.faceShared.add(l.f)
            }
        }
    }
}

/** `bm_faces_share_tag_clear` (`:407`). */
function facesShareTagClear(flags: RingFlags, eArr: readonly BMEdge[]): void {
    for (const e of eArr) {
        for (const l of radialLoops(e)) flags.faceShared.delete(l.f)
    }
}

/**
 * `LoopPairStore` (`:429`): per loop pair, the spline handle direction of each rim vertex, computed
 * before any mesh change ("needed so we don't get feedback loop reading/writing the mesh data").
 * Only `SURFACE` fills it.
 */
interface LoopPairStore {
    norsA: Map<BMVert, Vec3> | null
    norsB: Map<BMVert, Vec3> | null
}

/** `bm_edgering_pair_store_create` (`:440`). */
function edgeringPairStoreCreate(
    flags: RingFlags, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore, interpMode: SubdivRingInterp,
): LoopPairStore {
    const lpair: LoopPairStore = {norsA: null, norsB: null}

    if (interpMode === 'SURFACE') {
        const eArrA = edgeloopEdgesGet(elStoreA)
        const eArrB = edgeloopEdgesGet(elStoreB)

        lpair.norsA = new Map()
        lpair.norsB = new Map()
        const norsPair = [lpair.norsA, lpair.norsB]
        const elStorePair = [elStoreA, elStoreB]

        // now calculate nor

        // all other verts must _not_ be tagged
        bmoEdgeloopVertTag(flags.vertShared, elStoreA, true)
        bmoEdgeloopVertTag(flags.vertShared, elStoreB, true)

        // tag all faces that are in-between both loops
        facesShareTagFlush(flags, eArrA)
        facesShareTagFlush(flags, eArrB)

        // now we have all data we need, calculate vertex spline nor!
        for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
            for (const v of elStorePair[sideIndex].verts) {
                const nor = vertCalcSurfaceTangent(flags, v)
                // `Map::add` keeps the first
                if (!norsPair[sideIndex].has(v)) norsPair[sideIndex].set(v, nor)
            }
        }

        // cleanup verts share
        bmoEdgeloopVertTag(flags.vertShared, elStoreA, false)
        bmoEdgeloopVertTag(flags.vertShared, elStoreB, false)

        // cleanup faces share
        facesShareTagClear(flags, eArrA)
        facesShareTagClear(flags, eArrB)
    }
    return lpair
}

// endregion

// region Interpolation Function

/**
 * `bm_edgering_pair_interpolate` (`:533`): place the inner vertices of every new ring loop. The two
 * rim loops' centres and normals (turned to face each other) define a centre spline; `PATH` carries
 * each ring's ends along it with a minimum-twist frame, `SURFACE` gives each ring its own Bezier from
 * the surface tangents, `LINEAR` leaves the straight cuts. A profile factor then scales each step
 * towards or away from the centre spline.
 */
function edgeringPairInterpolate(
    lpair: LoopPairStore, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore, eloopsRing: BMEdgeLoopStore[],
    interpMode: SubdivRingInterp, cuts: number, smooth: number, falloffCache: number[] | null,
): void {
    const resolu = cuts + 2
    const dims = 3

    edgeloopCalcCenter(elStoreA)
    edgeloopCalcCenter(elStoreB)

    let isANoValid = edgeloopCalcNormal(elStoreA)
    let isBNoValid = edgeloopCalcNormal(elStoreB)

    const elStoreACo: Vec3 = [...elStoreA.co] as Vec3
    const elStoreBCo: Vec3 = [...elStoreB.co] as Vec3

    // correct normals need to be flipped to face each other we know both normals point in the same
    // direction so one will need flipping
    let elStoreANo: Vec3
    let elStoreBNo: Vec3
    {
        const elDir = v3sub(elStoreACo, elStoreBCo)
        const no: Vec3 = [elDir[0], elDir[1], elDir[2]]
        normalizeV3Len(no)

        if (isANoValid === false) isANoValid = edgeloopCalcNormalAligned(elStoreA, no)
        if (isBNoValid === false) isBNoValid = edgeloopCalcNormalAligned(elStoreB, no)

        elStoreANo = [...elStoreA.no] as Vec3
        elStoreBNo = [...elStoreB.no] as Vec3

        if (v3dot(elStoreANo, elDir) > 0) elStoreANo = [-elStoreANo[0], -elStoreANo[1], -elStoreANo[2]]
        if (v3dot(elStoreBNo, elDir) < 0) elStoreBNo = [-elStoreBNo[0], -elStoreBNo[1], -elStoreBNo[2]]
    }
    // now normals are correct, don't touch!

    /** `BKE_curve_forward_diff_bezier` per axis into `resolu` points. */
    const bezier = (p0: Vec3, h0: Vec3, h1: Vec3, p1: Vec3): Vec3[] => {
        const out: Vec3[] = Array.from({length: resolu}, () => [0, 0, 0] as Vec3)
        for (let i = 0; i < dims; i++) {
            const c = curveForwardDiffBezier(p0[i], h0[i], h1[i], p1[i], resolu - 1)
            for (let k = 0; k < resolu; k++) out[k][i] = c[k]
        }
        return out
    }

    // Calculate the center spline, multiple.
    let coordArrayMain: Vec3[] | null = null
    if (interpMode === 'PATH' || falloffCache) {
        const handleLen = bezierHandleCalcLengthV3(elStoreACo, elStoreANo, elStoreBCo, elStoreBNo) * smooth
        const handleA: Vec3 = [
            elStoreANo[0] * handleLen + elStoreACo[0],
            elStoreANo[1] * handleLen + elStoreACo[1],
            elStoreANo[2] * handleLen + elStoreACo[2],
        ]
        const handleB: Vec3 = [
            elStoreBNo[0] * handleLen + elStoreBCo[0],
            elStoreBNo[1] * handleLen + elStoreBCo[1],
            elStoreBNo[2] * handleLen + elStoreBCo[2],
        ]
        coordArrayMain = bezier(elStoreACo, handleA, handleB, elStoreBCo)
    }

    const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
        a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
    ]
    const setCo = (v: BMVert, c: Vec3) => v.setCo(c[0], c[1], c[2])

    switch (interpMode) {
    case 'LINEAR': {
        if (falloffCache) {
            const coordArray: Vec3[] = []
            for (let i = 0; i < resolu; i++) coordArray[i] = lerp(elStoreACo, elStoreBCo, i / (resolu - 1))

            for (const elStoreRing of eloopsRing) {
                elStoreRing.verts.forEach((v, i) => {
                    if (i > 0 && i < resolu - 1) {
                        // shape
                        if (falloffCache) setCo(v, lerp(coordArray[i], co(v), falloffCache[i]))
                    }
                })
            }
        }
        break
    }
    case 'PATH': {
        const main = coordArrayMain!
        const directionArray: Vec3[] = new Array(resolu)
        const quatArray: Quat[] = new Array(resolu)
        const triArray: [Vec3, Vec3, Vec3][] = new Array(resolu)

        // very similar to make_bevel_list_3D_minimum_twist

        // calculate normals
        directionArray[0] = [elStoreANo[0], elStoreANo[1], elStoreANo[2]]
        directionArray[resolu - 1] = [-elStoreBNo[0], -elStoreBNo[1], -elStoreBNo[2]]
        for (let i = 1; i < resolu - 1; i++) {
            directionArray[i] = bisectV3V3V3(main[i - 1], main[i], main[i + 1])
        }

        quatArray[0] = vecToQuat(directionArray[0], 5, 1)
        normalizeQt(quatArray[0])

        for (let i = 1; i < resolu; i++) {
            const angle = angleNormalizedV3V3(directionArray[i - 1], directionArray[i])
            if (angle > 0) { // otherwise we can keep as is
                const crossTmp = v3cross(directionArray[i - 1], directionArray[i])
                const q = axisAngleToQuat(crossTmp, angle)
                quatArray[i] = mulQtQtqt(q, quatArray[i - 1])
                normalizeQt(quatArray[i])
            } else {
                quatArray[i] = [...quatArray[i - 1]] as Quat
            }
        }

        // init base tri
        for (let i = 0; i < resolu; i++) {
            const shapeSize = falloffCache ? falloffCache[i] : 1.0
            const triTmp: [Vec3, Vec3, Vec3] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
            // create the triangle and transform
            for (let j = 0; j < 3; j++) {
                if (j === 1) triTmp[j][0] = shapeSize
                else if (j === 2) triTmp[j][1] = shapeSize
                mulQtV3(quatArray[i], triTmp[j])
                triTmp[j][0] += main[i][0]
                triTmp[j][1] += main[i][1]
                triTmp[j][2] += main[i][2]
            }
            triArray[i] = triTmp
        }

        const triSta = triArray[0]
        const triEnd = triArray[resolu - 1]

        for (const elStoreRing of eloopsRing) {
            const lbRing = elStoreRing.verts
            const vA = lbRing[0]
            const vB = lbRing[lbRing.length - 1]
            // skip first and last
            for (let i = 1; i < lbRing.length - 1; i++) {
                const triTmp = triArray[i]
                const coA = transformPointByTriV3(co(vA), triTmp, triSta)
                const coB = transformPointByTriV3(co(vB), triTmp, triEnd)
                setCo(lbRing[i], lerp(coA, coB, i / (resolu - 1)))
            }
        }
        break
    }
    case 'SURFACE': {
        // calculate a bezier handle per edge ring
        for (const elStoreRing of eloopsRing) {
            const lbRing = elStoreRing.verts
            const vA = lbRing[0]
            const vB = lbRing[lbRing.length - 1]

            const coA = co(vA)
            const coB = co(vB)

            // don't calculate normals here else we get into feedback loop when subdividing 2+
            // connected edge rings
            const noA = lpair.norsA!.get(vA)
            const noB = lpair.norsB!.get(vB)
            if (!noA || !noB) throw new Error('mesh-kernel: subdivide edge-ring: ring end not on its rim loop')

            const handleLen = bezierHandleCalcLengthV3(coA, noA, coB, noB) * smooth
            const handleA: Vec3 = [noA[0] * handleLen + coA[0], noA[1] * handleLen + coA[1], noA[2] * handleLen + coA[2]]
            const handleB: Vec3 = [noB[0] * handleLen + coB[0], noB[1] * handleLen + coB[1], noB[2] * handleLen + coB[2]]

            const coordArray = bezier(coA, handleA, handleB, coB)

            // skip first and last
            for (let i = 1; i < lbRing.length - 1; i++) {
                if (i > 0 && i < resolu - 1) {
                    setCo(lbRing[i], coordArray[i])
                    // shape
                    if (falloffCache) setCo(lbRing[i], lerp(coordArrayMain![i], co(lbRing[i]), falloffCache[i]))
                }
            }
        }
        break
    }
    }
}

// endregion

/**
 * `bm_face_slice` (`:832`): cut a face into `cuts + 1` slices, each cut from the corner before `l`
 * to the corner after its far end, following the larger remainder. Stops when a cut would join
 * adjacent corners.
 */
function faceSlice(bm: BMesh, flags: RingFlags, l: BMLoop, cuts: number): void {
    // TODO: interpolate edge data.
    let lNew: BMLoop | null = l
    for (let i = 0; i < cuts; i++) {
        // no chance of double
        const res = faceSplit(bm, lNew!.f, lNew!.prev, lNew!.next.next, undefined, false)
        lNew = res ? res.lNew : null
        if (lNew === null) {
            // This happens when l_new->prev and l_new->next->next are adjacent. Since this sets l_new
            // to nullptr, we cannot continue this for-loop.
            break
        }
        if (lNew.f.len < lNew.radialNext!.f.len) lNew = lNew.radialNext!
        flags.faceOut.add(lNew.f)
        flags.faceOut.add(lNew.radialNext!.f)
    }
}

/** `bm_edgering_pair_order_is_flipped` (`:854`): do the two (aligned) loops wind opposite ways? */
function edgeringPairOrderIsFlipped(elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore): boolean {
    const lbA = elStoreA.verts
    const lbB = elStoreB.verts
    const exists = (a: BMVert, b: BMVert) => diskEdgeExists(a, b) !== null

    // ListBase walk on arrays: index `-1` is a null `next`.
    const next = (lb: BMVert[], i: number) => i + 1 < lb.length ? i + 1 : -1

    let stepA = 0
    let stepB = 0

    // step around any fan-faces on both sides
    do {
        stepA = next(lbA, stepA)
    } while (stepA !== -1 && (exists(lbA[stepA], lbB[0]) || exists(lbA[stepA], lbB[next(lbB, 0)])))
    do {
        stepB = next(lbB, stepB)
    } while (stepB !== -1 && (exists(lbB[stepB], lbA[0]) || exists(lbB[stepB], lbA[next(lbA, 0)])))

    stepA = stepA !== -1 ? stepA - 1 : lbA.length - 1
    stepB = stepB !== -1 ? stepB - 1 : lbB.length - 1

    return !(exists(lbA[stepA], lbB[stepB])
        || exists(lbA[next(lbA, 0)], lbB[stepB])
        || exists(lbB[next(lbB, 0)], lbA[stepA]))
}

/**
 * `bm_edgering_pair_order` (`:900`): for two closed loops, rotate `b` to start at the vertex a ring
 * edge joins to `a`'s first and make it wind the same way; for open ones, flip `b` when the two
 * first vertices are not joined by a ring edge.
 */
function edgeringPairOrder(flags: RingFlags, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore): void {
    edgeloopVertTag(elStoreA, false)
    edgeloopVertTag(elStoreB, true)

    const rotateFirst = (store: BMEdgeLoopStore, v: BMVert) => {
        const i = store.verts.indexOf(v)
        store.verts = [...store.verts.slice(i), ...store.verts.slice(0, i)]
    }

    // before going much further, get ourselves in order
    // - align loops (not strictly necessary but handy)
    // - ensure winding is set for both loops
    if (elStoreA.closed && elStoreB.closed) {
        const nodeV = elStoreA.verts[0]
        let vOther: BMVert | null = null
        for (const e of diskEdges(nodeV)) {
            if (flags.edgeRing.has(e)) {
                vOther = e.otherVert(nodeV)
                if (isTag(vOther)) break
                vOther = null
            }
        }
        if (vOther === null || elStoreB.verts.indexOf(vOther) < 0) {
            throw new Error('mesh-kernel: subdivide edge-ring: closed rim loops are not joined at their first vertex')
        }

        rotateFirst(elStoreB, vOther)

        // now check we are winding the same way
        if (edgeringPairOrderIsFlipped(elStoreA, elStoreB)) {
            edgeloopFlip(elStoreB)
            // re-ensure the first node
            rotateFirst(elStoreB, vOther)
        }
    } else {
        // If we don't share and edge - flip.
        const e = diskEdgeExists(elStoreA.verts[0], elStoreB.verts[0])
        if (e === null || !flags.edgeRing.has(e)) edgeloopFlip(elStoreB)
    }

    // for cases with multiple loops
    edgeloopVertTag(elStoreB, false)
}

/**
 * `bm_edgering_pair_subdiv` (`:971`): split every ring edge between the two loops `cuts` times (each
 * becoming a ring loop in `eloopsRing`) and slice the faces between them.
 */
function edgeringPairSubdiv(
    bm: BMesh, flags: RingFlags, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore,
    eloopsRing: BMEdgeLoopStore[], cuts: number,
): void {
    const edgesRingArr: BMEdge[] = []
    const facesRingArr: BMFace[] = []

    edgeloopVertTag(elStoreA, false)
    edgeloopVertTag(elStoreB, true)

    for (const v of elStoreA.verts) {
        for (const e of [...diskEdges(v)]) {
            if (!flags.edgeInStack.has(e)) {
                const vOther = e.otherVert(v)
                if (isTag(vOther)) {
                    flags.edgeInStack.add(e)
                    edgesRingArr.push(e)
                    // add faces to the stack
                    for (const l of radialLoops(e)) {
                        const f = l.f
                        if (flags.faceOut.has(f)) {
                            if (!flags.faceInStack.has(f)) {
                                flags.faceInStack.add(f)
                                facesRingArr.push(f)
                            }
                        }
                    }
                }
            }
        }
    }

    let e: BMEdge | undefined
    while ((e = edgesRingArr.pop())) {
        // found opposite edge
        flags.edgeInStack.delete(e)
        // unrelated to subdiv, but if we _don't_ clear flag, multiple rings fail
        flags.edgeRing.delete(e)
        const vOther = isTag(e.v1) ? e.v1 : e.v2
        edgeSubdivAsLoop(bm, eloopsRing, e, vOther, cuts)
    }

    let f: BMFace | undefined
    while ((f = facesRingArr.pop())) {
        flags.faceInStack.delete(f)
        // Check each edge of the face
        let lIter = f.lFirst
        do {
            if (flags.edgeRim.has(lIter.e!)) {
                faceSlice(bm, flags, lIter, cuts)
                break
            }
        } while ((lIter = lIter.next) !== f.lFirst)
    }

    // Clear tags so subdiv verts don't get tagged too.
    for (const elStoreRing of eloopsRing) edgeloopVertTag(elStoreRing, false)

    // cleanup after
    edgeloopVertTag(elStoreB, false)
}

/** `bm_edgering_pair_ringsubd` (`:1063`). */
function edgeringPairRingsubd(
    bm: BMesh, flags: RingFlags, lpair: LoopPairStore, elStoreA: BMEdgeLoopStore, elStoreB: BMEdgeLoopStore,
    interpMode: SubdivRingInterp, cuts: number, smooth: number, falloffCache: number[] | null,
): void {
    const eloopsRing: BMEdgeLoopStore[] = []
    edgeringPairOrder(flags, elStoreA, elStoreB)
    edgeringPairSubdiv(bm, flags, elStoreA, elStoreB, eloopsRing, cuts)
    edgeringPairInterpolate(lpair, elStoreA, elStoreB, eloopsRing, interpMode, cuts, smooth, falloffCache)
}

/** `SUBD_RING_INTERP_*` (`bmesh_operators.hh:45`), by RNA name. */
export type SubdivRingInterp = 'LINEAR' | 'PATH' | 'SURFACE'

/** The slots of `bmesh.ops.subdivide_edgering` (`bmo_subdivide_edgering_def`, `bmesh_opdefines.cc:1778`). */
export interface SubdivideEdgeringOptions {
    /** Interpolation method. Slot default `LINEAR` (enum value 0). */
    interpMode?: SubdivRingInterp
    /** Smoothness factor. Slot default 0. */
    smooth?: number
    /** Number of cuts. Slot default 0. */
    cuts?: number
    /** Profile shape type. Slot default `SMOOTH` (0). */
    profileShape?: SubdivProfileShape
    /** How much intermediary new edges are shrunk/expanded. Slot default 0 (no profile). */
    profileShapeFactor?: number
}

/** `subdivide_edgering`'s outcome. */
export interface SubdivideEdgeringResult {
    /** False when the operator raised `BMO_ERROR_CANCEL`. */
    ok: boolean
    error?: string
    /** `faces.out`: the faces between the rim loops, sliced (mesh order); empty unless something was cut. */
    faces: BMFace[]
}

/** `bmo_subdivide_edgering_def` `type_flag` (`bmesh_opdefines.cc:1810`). */
const SUBDIVIDE_EDGERING_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

/** `bmo_subdivide_edgering_exec` (`bmo_subdivide_edgering.cc:1086`) without the top-level `bmesh_edit_end`. */
function subdivideEdgeringExec(bm: BMesh, edges: Iterable<BMEdge>, opts: SubdivideEdgeringOptions): SubdivideEdgeringResult {
    // NOTE: keep this operator fast, its used in a modifier.
    const cuts = opts.cuts ?? 0
    const interpMode = opts.interpMode ?? 'LINEAR'
    const smooth = opts.smooth ?? 0
    const resolu = cuts + 2

    // optional 'shape'
    const profileShape = opts.profileShape ?? 'SMOOTH'
    const profileShapeFactor = opts.profileShapeFactor ?? 0
    const falloffCache: number[] | null = profileShapeFactor !== 0 ? new Array(cuts + 2) : null

    const flags: RingFlags = {
        vertShared: new Set(), edgeRing: new Set(), edgeRim: new Set(), edgeInStack: new Set(),
        faceOut: new Set(), faceShared: new Set(), faceInStack: new Set(),
    }
    const input = [...edges]
    let changed = false
    let error: string | undefined

    for (const e of input) flags.edgeRing.add(e)

    elemHflagDisableAll(bm, ElemType.Vert, ElemFlag.Tag, false)

    // flag outer edges (loops defined as edges on the bounds of the edge ring)
    for (const e of input) {
        for (const l0 of [...radialLoops(e)]) {
            const f = l0.f
            // could support ngons, other areas would need updating too, see #48926.
            if (f.len <= 4 && !flags.faceOut.has(f)) {
                let ok = false
                // check at least 2 edges in the face are rings
                for (const l of f.eachLoop()) {
                    if (flags.edgeRing.has(l.e!) && e !== l.e) {
                        ok = true
                        break
                    }
                }
                if (ok) {
                    flags.faceOut.add(f)
                    for (const l of f.eachLoop()) {
                        if (!flags.edgeRing.has(l.e!)) flags.edgeRim.add(l.e!)
                    }
                }
            }
        }
    }

    // Cache falloff for each step (symmetrical)
    if (falloffCache) {
        for (let i = 0; i < resolu; i++) {
            let shapeSize = 1.0
            let fac = i / (resolu - 1)
            fac = Math.abs(1.0 - 2.0 * Math.abs(0.5 - fac))
            fac = subdFalloffCalc(profileShape, fac)
            shapeSize += fac * profileShapeFactor
            falloffCache[i] = shapeSize
        }
    }

    // Execute subdivision on all ring pairs
    const eloopsRim = edgeloopsFind(bm, e => flags.edgeRim.has(e))
    const count = eloopsRim.length

    cleanup: {
        if (count < 2) {
            error = 'No edge rings found'
            break cleanup
        } else if (count === 2) {
            // this case could be removed, but simple to avoid 'bm_edgering_pair_calc' in this case
            // since there's only one.
            const elStoreA = eloopsRim[0]
            const elStoreB = eloopsRim[eloopsRim.length - 1]
            const lpair = edgeloopCheckOverlapAll(flags, elStoreA, elStoreB)
                ? edgeringPairStoreCreate(flags, elStoreA, elStoreB, interpMode)
                : null
            if (lpair) {
                edgeringPairRingsubd(bm, flags, lpair, elStoreA, elStoreB, interpMode, cuts, smooth, falloffCache)
                changed = true
            } else {
                error = 'Edge-ring pair isn\'t connected'
                break cleanup
            }
        } else {
            const eloopPairsGs = edgeringPairCalc(flags, eloopsRim)
            if (eloopPairsGs.length === 0) {
                error = 'Edge-rings are not connected'
                break cleanup
            }

            // first cache pairs
            const lpairArr = eloopPairsGs.map(([elStoreA, elStoreB]) =>
                edgeloopCheckOverlapAll(flags, elStoreA, elStoreB)
                    ? edgeringPairStoreCreate(flags, elStoreA, elStoreB, interpMode)
                    : null)

            eloopPairsGs.forEach(([elStoreA, elStoreB], i) => {
                const lpair = lpairArr[i]
                if (lpair) {
                    edgeringPairRingsubd(bm, flags, lpair, elStoreA, elStoreB, interpMode, cuts, smooth, falloffCache)
                    changed = true
                }
            })
        }
    }

    const result: SubdivideEdgeringResult = {ok: error === undefined, faces: []}
    if (error !== undefined) result.error = error
    // flag output
    if (changed) result.faces = [...bm.faces].filter(f => flags.faceOut.has(f))
    return result
}

/**
 * `bmesh.ops.subdivide_edgering`: port of `bmo_subdivide_edgering_exec`
 * (`bmo_subdivide_edgering.cc:1086`), run as a top-level operator (normals update and select-mode
 * flush after, `bmesh_edit_end`).
 *
 * `edges` is the ring: the faces (tris and quads) with two of them become `FACE_OUT`, their other
 * edges the rims; the rim edge loops (`BM_mesh_edgeloops_find`) are paired up through the ring edges
 * and each pair's ring is cut. Reads face normals (`SURFACE`), so they must be current, as edit mode
 * keeps them.
 */
export function bmoSubdivideEdgering(bm: BMesh, edges: Iterable<BMEdge>, opts: SubdivideEdgeringOptions = {}): SubdivideEdgeringResult {
    const input = [...edges]
    return bmoOpExec(bm, SUBDIVIDE_EDGERING_TYPE_FLAG, () => subdivideEdgeringExec(bm, input, opts))
}

// region editmesh_tools.cc - MESH_OT_subdivide_edgering

/**
 * `mesh_operator_edgering_props` (`editmesh_tools.cc:237`) as `MESH_OT_subdivide_edgering` registers
 * them (`cuts_min = 1`, `cuts_default = 10`). Values outside an RNA property's hard range are
 * clamped, as RNA does.
 */
export interface SubdivideEdgeringSelectionOptions {
    /** Number of Cuts, 0..1000 (UI 1..64). Default 10. */
    numberCuts?: number
    /** Interpolation: interpolation method. Linear / Blend Path / Blend Surface. Default `'PATH'`. */
    interpolation?: SubdivRingInterp
    /** Smoothness: smoothness factor, 0..1000 (UI 0..2). Default 1. */
    smoothness?: number
    /** Profile Factor: how much intermediary new edges are shrunk/expanded, -1000..1000 (UI -2..2). Default 0. */
    profileShapeFactor?: number
    /** Profile Shape: shape of the profile. Default `'SMOOTH'`. */
    profileShape?: SubdivProfileShape
}

/** What {@link subdivideEdgeringSelection} did. */
export type SubdivideEdgeringSelectionResult =
    | {ok: true, faces: BMFace[], changed: boolean}
    | {ok: false, error: string}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * Subdivide Edge-Ring on the edit-mode selection: `edbm_subdivide_edge_ring_exec`
 * (`editmesh_tools.cc:294`). Does nothing without a selected edge; runs `subdivide_edgering` on the
 * selected (visible) edges. The selection is left to the operator's select-mode flush - the new
 * vertices are not selected.
 */
export function subdivideEdgeringSelection(bm: BMesh, options: SubdivideEdgeringSelectionOptions = {}): SubdivideEdgeringSelectionResult {
    const opProps: SubdivideEdgeringOptions = {
        interpMode: options.interpolation ?? 'PATH',
        cuts: clamp(Math.trunc(options.numberCuts ?? 10), 0, 1000),
        smooth: clamp(options.smoothness ?? 1.0, 0, 1e3),
        profileShape: options.profileShape ?? 'SMOOTH',
        profileShapeFactor: clamp(options.profileShapeFactor ?? 0, -1e3, 1e3),
    }

    if (bm.totedgesel === 0) return {ok: true, faces: [], changed: false}

    // `EDBM_op_callf(em, op, "subdivide_edgering edges=%he ...", BM_ELEM_SELECT, ...)`
    // (BMO_FLAG_RESPECT_HIDE)
    const edges = [...bm.edges].filter(e => e.testFlag(ElemFlag.Select) && !e.testFlag(ElemFlag.Hidden))
    const r = bmoSubdivideEdgering(bm, edges, opProps)
    if (!r.ok) return {ok: false, error: r.error!}
    return {ok: true, faces: r.faces, changed: true}
}

// endregion
