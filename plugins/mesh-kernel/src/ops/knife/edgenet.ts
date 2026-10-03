/**
 * Splitting a face along a net of edges drawn inside it - how a knife cut becomes faces.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_polygon_edgenet.cc`:
 * - {@link faceSplitEdgenet} is `BM_face_split_edgenet` (`:477`) with its helpers
 *   `bm_face_split_edgenet_find_loop_pair` (`:105`), `..._find_loop_pair_exists` (`:222`),
 *   `..._find_loop_walk` (`:265`) and `..._find_loop` (`:414`);
 * - {@link faceSplitEdgenetConnectIslands} is `BM_face_split_edgenet_connect_islands` (`:1248`), which
 *   bridges edge islands that touch nothing (a cut drawn wholly inside a face) to the rest of the net
 *   so they can become faces, with `USE_PARTIAL_CONNECT` (`:733`) and its helpers.
 *
 * Differences from Blender, all in bookkeeping, none in the algorithm:
 * - Blender's private element flags (`_FLAG_WALK`, `_FLAG_WALK_ALT` in `head.api_flag`) are sets
 *   local to one call. `BM_ELEM_INTERNAL_TAG`, which connect-islands uses in `hflag` under four names
 *   (`VERT_NOT_IN_STACK`, `EDGE_NOT_IN_STACK`, `VERT_IN_ARRAY`, `VERT_IS_VALID`) whose meanings
 *   overlap on purpose, stays a header bit: {@link ElemFlag.InternalTag}.
 * - The 2D edge BVH (`BLI_bvhtree_ray_cast_ex` over the islands' edges) is a linear scan in edge order.
 *   The callbacks keep the nearest hit with a strict `<`, so the result is the same edge except when
 *   two edges are hit at exactly the same distance, where Blender's pick depends on tree order.
 * - `qsort` (unstable) is a stable sort; it only matters for exactly equal keys.
 *
 * Like Blender, connect-islands temporarily overwrites vertex coordinates with their 2D projection
 * and restores them before returning, and `faceSplitEdgenet` repoints `v.e` (the disk-cycle entry)
 * of the vertices it walks.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../../bmesh/types'
import {BMesh} from '../../bmesh/BMesh'
import {ElemFlag} from '../../constants'
import {diskEdgeExists, diskVertReplace} from '../../bmesh/structure'
import {edgeFindDouble, vertSplice} from '../../bmesh/splice'
import {edgeInFace} from '../../bmesh/euler'
import {copyElemAttrs, interpElemAttrs} from '../../bmesh/customdata'
import {interpWeightsPolyV2} from '../../bmesh/interp'
import {layerHasMath} from '../bevel-boundary'
import {
    angleSignedOnAxisV3V3V3V3,
    AxisMat,
    axisDominantV3ToM3,
    dot2,
    FLT_MAX,
    isectRaySegV2,
    isectSegSegV2PointEx,
    lenSqV2V2,
    linePointFactorV2,
    mulV2M3V3,
    normalize2,
    sub3,
    V2,
} from './geom'

const co = (v: BMVert): [number, number, number] => [v.x, v.y, v.z]
const fno = (f: BMFace): [number, number, number] => [f.nx, f.ny, f.nz]

/** `BM_LOOPS_OF_VERT` in Blender's order: the disk cycle from `v.e`, each radial cycle from `e.l`. */
function* loopsOfVert(v: BMVert): Generator<BMLoop> {
    if (!v.e) return
    const eFirst = v.e
    let e: BMEdge = eFirst
    do {
        if (e.l) {
            const lFirst = e.l
            let l: BMLoop = lFirst
            do {
                if (l.v === v) yield l
                l = l.radialNext!
            } while (l !== lFirst)
        }
        e = e.diskNext(v)!
    } while (e !== eFirst)
}

// region BM_face_split_edgenet

/** The private flags of one `BM_face_split_edgenet` call (`:49-54`). */
interface NetFlags {
    /** `FACE_NET`: the face being split and the faces made from it. */
    faceNet: Set<BMFace>
    /** `EDGE_NET`: the net plus the face's own boundary. */
    edgeNet: Set<BMEdge>
    /** `VERT_VISIT` */
    vertVisit: Set<BMVert>
    /** `VERT_IN_QUEUE` */
    vertInQueue: Set<BMVert>
}

/** `bm_edge_flagged_radial_count` (`:61`). */
function edgeFlaggedRadialCount(e: BMEdge, nf: NetFlags): number {
    let count = 0
    const l0 = e.l
    if (l0) {
        let l: BMLoop = l0
        do {
            if (nf.faceNet.has(l.f)) count++
        } while ((l = l.radialNext!) !== l0)
    }
    return count
}

/** `bm_edge_flagged_radial_first` (`:76`). */
function edgeFlaggedRadialFirst(e: BMEdge, nf: NetFlags): BMLoop | null {
    const l0 = e.l
    if (l0) {
        let l: BMLoop = l0
        do {
            if (nf.faceNet.has(l.f)) return l
        } while ((l = l.radialNext!) !== l0)
    }
    return null
}

/** `normalize_v2_m3_v3v3` (`:90`). */
function normalizeV2M3V3V3(axisMat: AxisMat, v1: BMVert, v2: BMVert): V2 {
    return normalize2(mulV2M3V3(axisMat, sub3(co(v1), co(v2))))[0]
}

/** `bm_face_split_edgenet_find_loop_pair` (`:105`). `fOrig` is the face whose `no` is `face_normal`. */
function findLoopPair(vInit: BMVert, fOrig: BMFace, axisMat: AxisMat, nf: NetFlags): [BMEdge, BMEdge] | null {
    // Always find one boundary edge (to determine winding) and one wire (if available), otherwise
    // another boundary. Both lists are `BLI_SMALLSTACK`s: last pushed pops first.
    let edgesBoundary: BMEdge[] = []
    let edgesWire: BMEdge[] = []
    {
        const eFirst = vInit.e!
        let e: BMEdge = eFirst
        do {
            if (nf.edgeNet.has(e)) {
                const count = edgeFlaggedRadialCount(e, nf)
                if (count === 1) edgesBoundary.push(e)
                else if (count === 0) edgesWire.push(e)
            }
        } while ((e = e.diskNext(vInit)!) !== eFirst)
    }
    const edgesBoundaryLen = edgesBoundary.length
    const edgesWireLen = edgesWire.length

    // first edge should always be boundary
    if (edgesBoundaryLen === 0) return null
    const pair: [BMEdge, BMEdge] = [edgesBoundary.pop()!, null as unknown as BMEdge]

    // use to hold boundary OR wire edges
    let edgesSearch: BMEdge[] = []

    // attempt one boundary and one wire, or 2 boundary
    if (edgesWireLen === 0) {
        if (edgesBoundaryLen > 1) {
            pair[1] = edgesBoundary.pop()!
            if (edgesBoundaryLen > 2) [edgesSearch, edgesBoundary] = [edgesBoundary, edgesSearch]
        } else {
            // one boundary and no wire
            return null
        }
    } else {
        pair[1] = edgesWire.pop()!
        if (edgesWireLen > 1) [edgesSearch, edgesWire] = [edgesWire, edgesSearch]
    }

    // if we swapped above, search this list for the best edge
    if (edgesSearch.length) {
        // find the best edge in 'edge_list' to use for 'e_pair[1]'
        const vPrev = pair[0].otherVert(vInit)
        let vNext = pair[1].otherVert(vInit)
        const dirPrev = normalizeV2M3V3V3(axisMat, vPrev, vInit)
        const dirNext = normalizeV2M3V3V3(axisMat, vNext, vInit)
        let angleBestCos = dot2(dirNext, dirPrev)
        let e: BMEdge | undefined
        while ((e = edgesSearch.pop())) {
            vNext = e.otherVert(vInit)
            const dirTest = normalizeV2M3V3V3(axisMat, vNext, vInit)
            const angleTestCos = dot2(dirPrev, dirTest)
            if (angleTestCos > angleBestCos) {
                angleBestCos = angleTestCos
                pair[1] = e
            }
        }
    }

    // flip based on winding
    const lWalk = edgeFlaggedRadialFirst(pair[0], nf)!
    let swap = false
    // `face_normal == l_walk->f->no` compares pointers: is the walked face the face being split.
    if (lWalk.f === fOrig) swap = !swap
    if (lWalk.v !== vInit) swap = !swap
    if (swap) [pair[0], pair[1]] = [pair[1], pair[0]]
    return pair
}

/** `bm_face_split_edgenet_find_loop_pair_exists` (`:222`). */
function findLoopPairExists(vInit: BMVert, nf: NetFlags): boolean {
    let edgesBoundaryLen = 0
    let edgesWireLen = 0
    {
        const eFirst = vInit.e!
        let e: BMEdge = eFirst
        do {
            if (nf.edgeNet.has(e)) {
                const count = edgeFlaggedRadialCount(e, nf)
                if (count === 1) edgesBoundaryLen++
                else if (count === 0) edgesWireLen++
            }
        } while ((e = e.diskNext(vInit)!) !== eFirst)
    }
    // first edge should always be boundary
    if (edgesBoundaryLen === 0) return false
    // attempt one boundary and one wire, or 2 boundary
    if (edgesWireLen === 0 && edgesBoundaryLen < 2) return false
    return true
}

/** `bm_face_split_edgenet_find_loop_walk` (`:265`), with `USE_FASTPATH_NOFORK`. */
function findLoopWalk(vInit: BMVert, faceNormal: [number, number, number], pair: [BMEdge, BMEdge], nf: NetFlags): boolean {
    let found = false
    // `edge_order` (an array stack of `{angle, v}`).
    const edgeOrder: {angle: number, v: BMVert}[] = []
    // store visited verts so we can clear the visit flag after execution
    const vertVisit: BMVert[] = []
    // `BLI_SMALLSTACK`s; all verts pushed into these _must_ have their previous edges set.
    let vertStack: BMVert[] = []
    let vertStackNext: BMVert[] = []

    // start stepping
    let v: BMVert | undefined = pair[0].otherVert(vInit)
    v.e = pair[0]
    vertStack.push(v)

    const vDst = pair[1].otherVert(vInit)

    // This loop keeps stepping over the best possible edge; in most cases it finds the direct route
    // to close the face. Where paths can't be closed, alternatives are stored in `vert_stack`.
    outer:
    while ((v = vertStack.pop())) {
        // `walk_nofork:` - the fast path re-enters here without popping.
        for (;;) {
            // check if we're done!
            if (v === vDst) {
                found = true
                break outer
            }

            const eFirst = v.e!
            let eNext = eFirst.diskNext(v)! // always skip this verts edge

            // in rare cases there may be edges with a single connecting vertex
            if (eNext !== eFirst) {
                do {
                    if (nf.edgeNet.has(eNext) && edgeFlaggedRadialCount(eNext, nf) < 2) {
                        const vNext = eNext.otherVert(v)
                        if (!nf.vertVisit.has(vNext)) {
                            edgeOrder.push({angle: 0, v: vNext})
                            vNext.e = eNext
                        }
                    }
                } while ((eNext = eNext.diskNext(v)!) !== eFirst)
            }

            if (edgeOrder.length === 1) {
                // USE_FASTPATH_NOFORK: no fork, so no need to tag or push.
                v = edgeOrder.pop()!.v
                continue
            }
            break
        }

        // sort by angle if needed
        if (edgeOrder.length > 1) {
            const vPrev = v.e!.otherVert(v)
            for (const eo of edgeOrder) eo.angle = angleSignedOnAxisV3V3V3V3(co(vPrev), co(v), co(eo.v), faceNormal)
            // `BLI_sortutil_cmp_float_reverse`: descending.
            edgeOrder.sort((a, b) => b.angle - a.angle)
            // only tag forks
            vertVisit.push(v)
            nf.vertVisit.add(v)
        }

        let eo: {angle: number, v: BMVert} | undefined
        while ((eo = edgeOrder.pop())) vertStackNext.push(eo.v)

        if (vertStackNext.length) [vertStack, vertStackNext] = [vertStackNext, vertStack]
    }

    // clear flag for next execution
    for (const vv of vertVisit) nf.vertVisit.delete(vv)
    return found
}

/** `bm_face_split_edgenet_find_loop` (`:414`). */
function findLoop(vInit: BMVert, fOrig: BMFace, axisMat: AxisMat, nf: NetFlags):
    {verts: BMVert[], edges: BMEdge[], checkFaceExists: boolean} | null {
    const pair = findLoopPair(vInit, fOrig, axisMat, nf)
    if (!pair) return null
    if (!findLoopWalk(vInit, fno(fOrig), pair, nf)) return null

    // Skip redundant checks for existing faces if *any* edges are wire.
    let checkFaceExists = true
    const verts: BMVert[] = [vInit]
    const edges: BMEdge[] = [pair[1]]
    if (!pair[1].l) checkFaceExists = false
    let v = pair[1].otherVert(vInit)
    do {
        verts.push(v)
        edges.push(v.e!)
        if (checkFaceExists && !v.e!.l) checkFaceExists = false
    } while ((v = v.e!.otherVert(v)) !== vInit)
    if (verts.length < 3) return null
    return {verts, edges, checkFaceExists}
}

/**
 * `bmesh_face_swap_data` (`bmesh_core.cc`): swap two faces' contents - loops, length, flags, normal,
 * material - leaving each its own custom data and identity.
 */
function faceSwapData(fa: BMFace, fb: BMFace): void {
    for (const l of fa.loops()) l.f = fb
    for (const l of fb.loops()) l.f = fa
    ;[fa.lFirst, fb.lFirst] = [fb.lFirst, fa.lFirst]
    ;[fa.len, fb.len] = [fb.len, fa.len]
    ;[fa.hflag, fb.hflag] = [fb.hflag, fa.hflag]
    ;[fa.nx, fb.nx] = [fb.nx, fa.nx]
    ;[fa.ny, fb.ny] = [fb.ny, fa.ny]
    ;[fa.nz, fb.nz] = [fb.nz, fa.nz]
    ;[fa.matNr, fb.matNr] = [fb.matNr, fa.matNr]
}

/**
 * Split `f` along `edgeNet`, edges lying inside it (each must not already be an edge of `f`).
 * `BM_face_split_edgenet` (`bmesh_polygon_edgenet.cc:477`).
 *
 * Returns the faces the net divides `f` into, the first of which is `f` itself (it keeps its identity
 * and takes the first region's shape), or null when `edgeNet` is empty. `f.nx/ny/nz` must be current.
 */
export function faceSplitEdgenet(bm: BMesh, f: BMFace, edgeNet: readonly BMEdge[]): BMFace[] | null {
    if (!edgeNet.length) return null

    const nf: NetFlags = {faceNet: new Set([f]), edgeNet: new Set(), vertVisit: new Set(), vertInQueue: new Set()}
    for (const e of edgeNet) nf.edgeNet.add(e)
    for (const l of f.eachLoop()) nf.edgeNet.add(l.e!)

    const axisMat = axisDominantV3ToM3(fno(f))

    // any vert can be used to begin with
    const lFirst = f.lFirst
    const vertQueue: BMVert[] = [lFirst.v]
    nf.vertInQueue.add(lFirst.v)

    const faceArr: BMFace[] = []
    let v: BMVert | undefined
    while ((v = vertQueue.pop())) {
        nf.vertInQueue.delete(v)
        const loop = findLoop(v, f, axisMat, nf)
        if (!loop) continue
        let fNew: BMFace | null = null
        if (loop.checkFaceExists && faceExistsVerts(loop.verts)) {
            // Should only happen in unexpected/degenerate cases, see: #150360.
        } else {
            fNew = bm.faceCreateWithEdges(loop.verts, loop.edges, f)
        }
        if (fNew) {
            faceArr.push(fNew)
            fNew.nx = f.nx
            fNew.ny = f.ny
            fNew.nz = f.nz
            // warning, normally don't do this, its needed for mesh intersection - which tracks
            // face-sides based on selection
            fNew.hflag = f.hflag
            if (f.hflag & ElemFlag.Select) bm.totfacesel++
            nf.faceNet.add(fNew)

            // add new verts to keep finding loops for (verts between boundary and manifold edges)
            for (const l of fNew.eachLoop()) {
                // Avoid adding to queue multiple times (not common but happens).
                if (!nf.vertInQueue.has(l.v) && findLoopPairExists(l.v, nf)) {
                    vertQueue.push(l.v)
                    nf.vertInQueue.add(l.v)
                }
            }
        }
    }

    if (bm.ldata.layers.some(layerHasMath)) {
        // reuse VERT_VISIT here to tag vert's already interpolated (`:611`)
        const visit = new Set<BMVert>()
        const blocks = f.loops()
        const cos2d: number[] = []
        const w: number[] = new Array(f.len)
        // interior loops
        const axisMatI = axisDominantV3ToM3(fno(f))

        // first simply copy from existing face
        for (const lIter of blocks) {
            for (const lOther of loopsOfVert(lIter.v)) {
                if (lOther.f !== f && nf.faceNet.has(lOther.f)) copyElemAttrs(lIter, lOther, bm.ldata)
            }
            // tag not to interpolate
            visit.add(lIter.v)
            const p = mulV2M3V3(axisMatI, co(lIter.v))
            cos2d.push(p[0], p[1])
        }
        for (const e of edgeNet) {
            for (const vv of [e.v1, e.v2]) {
                if (visit.has(vv)) continue
                visit.add(vv)
                // interpolate this loop, then copy to the rest
                let lFirstI: BMLoop | null = null
                for (const lIter of loopsOfVert(vv)) {
                    if (!nf.faceNet.has(lIter.f)) continue
                    if (lFirstI === null) {
                        const p = mulV2M3V3(axisMatI, co(vv))
                        interpWeightsPolyV2(w, cos2d, f.len, p[0], p[1])
                        interpElemAttrs(lIter, blocks, w, bm.ldata)
                        lFirstI = lIter
                    } else {
                        copyElemAttrs(lFirstI, lIter, bm.ldata)
                    }
                }
            }
        }
    }

    if (faceArr.length) {
        faceSwapData(f, faceArr[0])
        bm.faceKill(faceArr[0])
        faceArr[0] = f
    }
    return faceArr
}

/** `BM_face_exists` (`bmesh_query.cc:1627`). */
function faceExistsVerts(varr: readonly BMVert[]): BMFace | null {
    const len = varr.length
    if (!varr[0].e) return null
    const eFirst = varr[0].e
    let eIter: BMEdge = eFirst
    do {
        if (eIter.l) {
            const lFirstRadial = eIter.l
            let lIterRadial: BMLoop = lFirstRadial
            do {
                if (lIterRadial.v === varr[0] && lIterRadial.f.len === len) {
                    // the first 2 verts match, now check the remaining; winding isn't known
                    let iWalk = 2
                    if (lIterRadial.next.v === varr[1]) {
                        let lWalk = lIterRadial.next.next
                        do {
                            if (lWalk.v !== varr[iWalk]) break
                            lWalk = lWalk.next
                        } while (++iWalk !== len)
                    } else if (lIterRadial.prev.v === varr[1]) {
                        let lWalk = lIterRadial.prev.prev
                        do {
                            if (lWalk.v !== varr[iWalk]) break
                            lWalk = lWalk.prev
                        } while (++iWalk !== len)
                    }
                    if (iWalk === len) return lIterRadial.f
                }
            } while ((lIterRadial = lIterRadial.radialNext!) !== lFirstRadial)
        }
    } while ((eIter = eIter.diskNext(varr[0])!) !== eFirst)
    return null
}

// endregion

// region BM_face_split_edgenet_connect_islands

const ITAG = ElemFlag.InternalTag
const testTag = (el: {hflag: number}) => (el.hflag & ITAG) !== 0
const enableTag = (el: {hflag: number}) => { el.hflag |= ITAG }
const disableTag = (el: {hflag: number}) => { el.hflag &= ~ITAG }

/** `SORT_AXIS` (`:738`). */
const SORT_AXIS = 0

/** `edge_isect_verts_point_2d` (`:740`), on the 2D coordinates written into `x`/`y`. */
function edgeIsectVertsPoint2d(e: BMEdge, va: BMVert, vb: BMVert): V2 | null {
    // This bias seems like it could be too large, mostly its not needed, see #52329.
    const endpointBias = 1e-4
    const [kind, p] = isectSegSegV2PointEx([va.x, va.y], [vb.x, vb.y], [e.v1.x, e.v1.y], [e.v2.x, e.v2.y], endpointBias)
    return kind === 1 && e.v1 !== va && e.v2 !== va && e.v1 !== vb && e.v2 !== vb ? p : null
}

/** `axis_pt_cmp` (`:753`). */
function axisPtCmp(a: readonly number[], b: readonly number[]): number {
    if (a[0] < b[0]) return -1
    if (a[0] > b[0]) return 1
    if (a[1] < b[1]) return -1
    if (a[1] > b[1]) return 1
    return 0
}

/** `EdgeGroupIsland` (`:775`). `edgeLinks` is the island's edge list, in `LinkNode` order. */
interface EdgeGroupIsland {
    edgeLinks: BMEdge[]
    vertLen: number
    edgeLen: number
    hasPrevEdge: boolean
    vertSpan: {min: BMVert, max: BMVert, minAxis: V2, maxAxis: V2}
}

/** `EdgeGroup_FindConnection_Args` (`:886`). */
interface FindConnectionArgs {
    edgeArr: BMEdge[]
    edgeArrNew: BMEdge[]
    /** How many of {@link edgeArrNew} are filled. */
    edgeArrNewLen: () => number
    vertRange: [number, number]
}

/** `test_edges_isect_2d_vert` (`:897`), the BVH ray cast as a scan. */
function testEdgesIsect2dVert(args: FindConnectionArgs, vOrigin: BMVert, vOther: BMVert): BMEdge | null {
    const [dir, distOrig] = normalize2([vOther.x - vOrigin.x, vOther.y - vOrigin.y])
    let hitDist = distOrig
    let hitIndex = -1
    // `bvhtree_test_edges_isect_2d_vert_cb` (`:825`)
    for (let index = 0; index < args.edgeArr.length; index++) {
        const e = args.edgeArr[index]
        const p = edgeIsectVertsPoint2d(e, vOrigin, vOther)
        if (!p) continue
        const t = linePointFactorV2(p, [vOrigin.x, vOrigin.y], [vOther.x, vOther.y])
        const distNew = distOrig * t
        // avoid float precision issues, possible this is greater, check above zero to allow some
        // overlap (and needed for partial-connect which will overlap vertices)
        if (distNew < hitDist && distNew > 0) {
            // v1/v2 will both be in the same group
            const v1Index = e.v1.index
            if (v1Index < args.vertRange[0] || v1Index >= args.vertRange[1]) {
                hitDist = distNew
                hitIndex = index
            }
        }
    }
    void dir
    let eHit = hitIndex !== -1 ? args.edgeArr[hitIndex] : null
    // check existing connections (no spatial optimization here since we're continually adding).
    if (hitIndex === -1) {
        let tBest = 1
        const n = args.edgeArrNewLen()
        for (let i = 0; i < n; i++) {
            const p = edgeIsectVertsPoint2d(args.edgeArrNew[i], vOrigin, vOther)
            if (p) {
                const tTest = linePointFactorV2(p, [vOrigin.x, vOrigin.y], [vOther.x, vOther.y])
                if (tTest < tBest) {
                    tBest = tTest
                    eHit = args.edgeArrNew[i]
                }
            }
        }
    }
    return eHit
}

/** `test_edges_isect_2d_ray` (`:954`), the BVH ray cast as a scan. */
function testEdgesIsect2dRay(args: FindConnectionArgs, vOrigin: BMVert, dir: V2): BMEdge | null {
    let hitDist = FLT_MAX / 2 // `BVH_RAYCAST_DIST_MAX`
    let hitIndex = -1
    const origin: V2 = [vOrigin.x, vOrigin.y]
    // `bvhtree_test_edges_isect_2d_ray_cb` (`:851`)
    for (let index = 0; index < args.edgeArr.length; index++) {
        const e = args.edgeArr[index]
        // direction is normalized, so this will be the distance
        const distNew = isectRaySegV2(origin, dir, [e.v1.x, e.v1.y], [e.v2.x, e.v2.y])
        if (distNew === null) continue
        if (distNew < hitDist && distNew > 0) {
            if (e.v1 !== vOrigin && e.v2 !== vOrigin) {
                const v1Index = e.v1.index
                // v1/v2 will both be in the same group
                if (v1Index < args.vertRange[0] || v1Index >= args.vertRange[1]) {
                    hitDist = distNew
                    hitIndex = index
                }
            }
        }
    }
    let eHit = hitIndex !== -1 ? args.edgeArr[hitIndex] : null
    // check existing connections (no spatial optimization here since we're continually adding).
    if (hitIndex !== -1) {
        const n = args.edgeArrNewLen()
        for (let i = 0; i < n; i++) {
            const e = args.edgeArrNew[i]
            const distNew = isectRaySegV2(origin, dir, [e.v1.x, e.v1.y], [e.v2.x, e.v2.y])
            if (distNew !== null && e.v1 !== vOrigin && e.v2 !== vOrigin) {
                // avoid float precision issues, possible this is greater
                if (distNew < hitDist) {
                    hitDist = distNew
                    eHit = args.edgeArrNew[i]
                }
            }
        }
    }
    return eHit
}

/** `bm_face_split_edgenet_find_connection` (`:1003`). Returns a vertex index, or -1. */
function findConnection(args: FindConnectionArgs, vOrigin: BMVert, directionSign: boolean, vertArr: BMVert[]): number {
    // Cast a ray along +/- SORT_AXIS, take the hit edge, cast rays to its vertices checking they
    // don't hit a closer edge, and keep stepping until a vertex is reached unblocked.
    const dir: V2 = [0, 0]
    dir[SORT_AXIS] = directionSign ? 1 : -1
    let eHit = testEdgesIsect2dRay(args, vOrigin, dir)
    let vOther: BMVert | null = null
    void vertArr

    if (eHit) {
        let vOtherFallback: BMVert | null = null
        const vertSearch: BMVert[] = []
        // ensure we never add verts multiple times (not all that likely - but possible)
        const vertBlacklist: BMVert[] = []
        do {
            const e = eHit!
            // ensure the closest vertex is popped back off the stack first
            const vPair = lenSqV2V2([vOrigin.x, vOrigin.y], [e.v1.x, e.v1.y]) > lenSqV2V2([vOrigin.x, vOrigin.y], [e.v2.x, e.v2.y])
                ? [e.v1, e.v2] : [e.v2, e.v1]
            for (const vIter of vPair) {
                // `VERT_IS_VALID`
                if (testTag(vIter)) {
                    const axisOk = directionSign ? (axisVal(vIter) > axisVal(vOrigin)) : (axisVal(vIter) < axisVal(vOrigin))
                    if (axisOk) {
                        vertSearch.push(vIter)
                        vertBlacklist.push(vIter)
                        disableTag(vIter)
                    }
                }
            }
            vOtherFallback = vOther
        } while ((vOther = vertSearch.pop() ?? null) && (eHit = testEdgesIsect2dVert(args, vOrigin, vOther)))

        if (vOther === null) vOther = vOtherFallback

        // reset the blacklist flag, for future use
        for (const vv of vertBlacklist) enableTag(vv)
    }
    // if we reach this line, v_other is either the best vertex or its null
    return vOther ? vOther.index : -1
}

const axisVal = (v: BMVert) => SORT_AXIS === 0 ? v.x : v.y

/** `test_tagged_and_notface` (`:1092`). */
const testTaggedAndNotface = (e: BMEdge, f: BMFace) => testTag(e) && !edgeInFace(e, f)

/**
 * `BM_vert_separate_tested_edges` (`bmesh_core.cc:2655`): move the edges of `vSrc` passing `test` onto
 * `vDst`'s disk cycle (the disk only; loops are not touched).
 */
function vertSeparateTestedEdges(vDst: BMVert, vSrc: BMVert, test: (e: BMEdge) => boolean): void {
    const edgesHflag: BMEdge[] = []
    const eFirst = vSrc.e!
    let eIter: BMEdge = eFirst
    do {
        // `BLI_linklist_prepend_alloca`: walked back to front below.
        if (test(eIter)) edgesHflag.unshift(eIter)
    } while ((eIter = eIter.diskNext(vSrc)!) !== eFirst)
    for (const e of edgesHflag) diskVertReplace(e, vDst, vSrc)
}

/**
 * `bm_face_split_edgenet_partial_connect` (`:1105`): split vertices which are part of a partial
 * connection (only a single vertex connecting an island). All edges and vertices must have
 * `BM_ELEM_INTERNAL_TAG` set; the function leaves them set.
 */
function partialConnect(bm: BMesh, vDelimit: BMVert, f: BMFace): BMVert | null {
    // initial check - see if we have 3+ flagged edges attached to 'v_delimit'
    const eDelimitList: BMEdge[] = []
    // start with face edges, since we need to split away wire-only edges
    let eFaceInit: BMEdge | null = null
    {
        const e0 = vDelimit.e!
        let eIter: BMEdge = e0
        do {
            if (testTag(eIter)) {
                eDelimitList.unshift(eIter)
                if (eIter.l !== null && edgeInFace(eIter, f)) eFaceInit = eIter
            }
        } while ((eIter = eIter.diskNext(vDelimit)!) !== vDelimit.e)
    }
    // skip typical edge-chain verts
    if (eDelimitList.length <= 2) return null

    // Store connected vertices for restoring the flag
    const vertStack: BMVert[] = [vDelimit]
    disableTag(vDelimit)

    // Walk the net...
    {
        const search: BMVert[] = []
        let vOther: BMVert | undefined = (eFaceInit ?? vDelimit.e!).otherVert(vDelimit)
        search.push(vOther)
        if (testTag(vOther)) {
            disableTag(vOther)
            vertStack.unshift(vOther)
        }
        while ((vOther = search.pop())) {
            const e0 = vOther.e!
            let eIter: BMEdge = e0
            do {
                const vStep = eIter.otherVert(vOther)
                if (testTag(eIter) && testTag(vStep)) {
                    disableTag(vStep)
                    search.push(vStep)
                    vertStack.unshift(vStep)
                }
            } while ((eIter = eIter.diskNext(vOther)!) !== vOther.e)
        }
    }

    // Detect if this is a delimiter by checking if we didn't walk any of edges connected to 'v_delimit'.
    let isDelimit = false
    {
        const e0 = vDelimit.e!
        let eIter: BMEdge = e0
        do {
            const vStep = eIter.otherVert(vDelimit)
            if (testTag(vStep) && !edgeInFace(eIter, f)) {
                isDelimit = true // if one vertex is valid - we have a mix
            } else {
                // match the vertex flag (only for edges around 'v_delimit')
                disableTag(eIter)
            }
        } while ((eIter = eIter.diskNext(vDelimit)!) !== vDelimit.e)
    }

    // Execute the split
    let vSplit: BMVert | null = null
    if (isDelimit) {
        vSplit = bm.vertCreate(vDelimit.x, vDelimit.y, vDelimit.z)
        vertSeparateTestedEdges(vSplit, vDelimit, e => testTaggedAndNotface(e, f))
        enableTag(vSplit)
        // Degenerate, avoid eternal loop, see: #59074.
        if (vSplit.e === null) {
            bm.vertKill(vSplit)
            vSplit = null
        }
    }

    // Restore flags
    for (const vv of vertStack) enableTag(vv)
    for (const e of eDelimitList) enableTag(e)
    return vSplit
}

/** `bm_vert_partial_connect_check_overlap` (`:1235`). */
function partialConnectCheckOverlap(remap: number[], vAIndex: number, vBIndex: number): boolean {
    // Connected to each other.
    return remap[vAIndex] === vBIndex || remap[vBIndex] === vAIndex
}

/** `bm_face_pair_overlap_check_subset_same_winding` (`bmesh_core.cc:52`). */
function overlapSameWinding(lA: BMLoop, lAEnd: BMLoop, lB: BMLoop): boolean {
    let a = lA, b = lB
    for (;;) {
        if (b.v !== a.v) return false
        if (a === lAEnd) break
        a = a.next
        b = b.next
    }
    return true
}

/** `bm_face_pair_overlap_check_subset_swap_winding` (`bmesh_core.cc:98`). */
function overlapSwapWinding(lA: BMLoop, lAEnd: BMLoop, lB: BMLoop): boolean {
    let a = lA, b = lB
    for (;;) {
        if (b.v !== a.v) return false
        if (a === lAEnd) break
        a = a.next
        b = b.prev
    }
    return true
}

/**
 * `BM_vert_splice_check_double_face` (`bmesh_core.cc:2215`): would splicing the two vertices make two
 * faces that use the same vertices?
 */
export function vertSpliceCheckDoubleFace(vA: BMVert, vB: BMVert): boolean {
    if (!vA.e || !vB.e) return false
    const vPair = [vA, vB]
    const loopsPair: BMLoop[][] = [[], []]
    for (let side = 0; side < 2; side++) {
        const e0 = vPair[side].e!
        let eIter: BMEdge = e0
        do {
            const l0 = eIter.l
            if (l0) {
                let l: BMLoop = l0
                do {
                    if (l.v === vPair[side]) loopsPair[side].push(l)
                } while ((l = l.radialNext!) !== l0)
            }
        } while ((eIter = eIter.diskNext(vPair[side])!) !== e0)
        if (!loopsPair[side].length) return false
    }
    for (const lp of loopsPair) if (lp.length > 1) lp.sort((a, b) => a.f.len - b.f.len)

    let aBeg = 0
    let bBeg = 0
    while (aBeg < loopsPair[0].length && bBeg < loopsPair[1].length) {
        const aLen = loopsPair[0][aBeg].f.len
        const bLen = loopsPair[1][bBeg].f.len
        if (aLen < bLen) { aBeg++; continue }
        if (aLen > bLen) { bBeg++; continue }
        // `a_len == b_len`: find the range of elements with this length in both lists.
        const fLen = aLen
        let aEnd = aBeg + 1
        let bEnd = bBeg + 1
        while (aEnd < loopsPair[0].length && loopsPair[0][aEnd].f.len === fLen) aEnd++
        while (bEnd < loopsPair[1].length && loopsPair[1][bEnd].f.len === fLen) bEnd++
        // Compare all pairs within this matching length range.
        for (let ai = aBeg; ai < aEnd; ai++) {
            const lA = loopsPair[0][ai]
            for (let bi = bBeg; bi < bEnd; bi++) {
                const lB = loopsPair[1][bi]
                if (lA.next.v === lB.next.v && lA.prev.v === lB.prev.v) {
                    if (overlapSameWinding(lA.next.next, lA.prev.prev, lB.next.next)) return true
                } else if (lA.next.v === lB.prev.v && lA.prev.v === lB.next.v) {
                    if (overlapSwapWinding(lA.next.next, lA.prev.prev, lB.prev.prev)) return true
                }
            }
        }
        aBeg = aEnd
        bBeg = bEnd
    }
    return false
}

/**
 * Connect isolated edge islands inside `f` to the rest of the net, so {@link faceSplitEdgenet} can make
 * faces of them. `BM_face_split_edgenet_connect_islands` (`bmesh_polygon_edgenet.cc:1248`).
 *
 * Returns the extended net (the input edges followed by the new connecting edges), or null when
 * there was nothing to connect (a single island), as Blender returns false.
 */
export function faceSplitEdgenetConnectIslands(bm: BMesh, f: BMFace, edgeNetInit: readonly BMEdge[], usePartialConnect: boolean): BMEdge[] | null {
    const edgeNetInitLen = edgeNetInit.length
    const edgeArr: BMEdge[] = [...edgeNetInit]
    for (const l of f.eachLoop()) edgeArr.push(l.e!)
    const edgeArrLen = edgeArr.length
    let ok = false
    let edgeNetNew: BMEdge[] = []
    let edgeNetNewLen = edgeNetInitLen

    for (const e of edgeArr) {
        enableTag(e)
        enableTag(e.v1)
        enableTag(e.v2)
    }

    // Split-out delimiting vertices (`USE_PARTIAL_CONNECT`, `:1300`). The list is prepended to.
    const tempVertPairs: {vTemp: BMVert, vOrig: BMVert}[] = []
    let remap: number[] = []
    if (usePartialConnect) {
        for (let i = 0; i < edgeNetInitLen; i++) {
            for (const vDelimit of [edgeArr[i].v1, edgeArr[i].v2]) {
                // NOTE: remapping will _never_ map a vertex to an already mapped vertex.
                let vOther: BMVert | null
                while ((vOther = partialConnect(bm, vDelimit, f))) tempVertPairs.unshift({vOrig: vDelimit, vTemp: vOther})
            }
        }
        if (tempVertPairs.length === 0) usePartialConnect = false
    }

    // Groups: islands of connected edges (`:1339`). Scan 'edge_arr' backwards so the outer face
    // boundary is handled first (since its likely to be the largest). `group_head` is prepended to.
    const groupList: EdgeGroupIsland[] = []
    {
        let edgeIndex = edgeArrLen - 1
        let edgeInGroupTot = 0
        const vstack: BMVert[] = []
        for (;;) {
            const edgeLinks: BMEdge[] = []
            let uniqueVertsInGroup = 0
            let uniqueEdgesInGroup = 0
            vstack.push(edgeArr[edgeIndex].v1)
            disableTag(edgeArr[edgeIndex].v1)
            let vIter: BMVert | undefined
            while ((vIter = vstack.pop())) {
                uniqueVertsInGroup++
                const e0 = vIter.e!
                let eIter: BMEdge = e0
                do {
                    if (testTag(eIter)) {
                        disableTag(eIter)
                        uniqueEdgesInGroup++
                        edgeLinks.unshift(eIter)
                        const vOther = eIter.otherVert(vIter)
                        if (testTag(vOther)) {
                            vstack.push(vOther)
                            disableTag(vOther)
                        }
                    }
                } while ((eIter = eIter.diskNext(vIter)!) !== vIter.e)
            }
            groupList.unshift({
                edgeLinks, vertLen: uniqueVertsInGroup, edgeLen: uniqueEdgesInGroup, hasPrevEdge: false,
                vertSpan: {min: edgeLinks[0].v1, max: edgeLinks[0].v2, minAxis: [0, 0], maxAxis: [0, 0]},
            })
            edgeInGroupTot += uniqueEdgesInGroup
            if (edgeInGroupTot === edgeArrLen) break
            // skip edges in the stack
            while (!testTag(edgeArr[edgeIndex])) edgeIndex--
        }
    }

    const vertCoordsBackup: [number, number, number][] = []
    const vertArr: BMVert[] = []

    if (groupList.length !== 1) {
        // Now we know there are holes: per-group data and a spatial lookup (`:1415`).
        const axisMat = axisDominantV3ToM3(fno(f))

        // fill 'groups_arr' in reverse order so the boundary face is first: `group_head` is newest
        // first and `groupList` already mirrors it, so the array is `groupList` reversed.
        const groupArr: EdgeGroupIsland[] = [...groupList].reverse()
        for (const g of groupArr) {
            // init with *any* different verts
            g.vertSpan.min = g.edgeLinks[0].v1
            g.vertSpan.max = g.edgeLinks[0].v2
            let minAxis: V2 = [FLT_MAX, FLT_MAX]
            let maxAxis: V2 = [-FLT_MAX, -FLT_MAX]
            for (const e of g.edgeLinks) {
                for (const vIter of [e.v1, e.v2]) {
                    // `dot_m3_v3_row_x/y` of the transposed basis: the 2D projection.
                    const p = mulV2M3V3(axisMat, co(vIter))
                    const axisValue: V2 = SORT_AXIS === 0 ? [p[0], p[1]] : [p[1], p[0]]
                    if (axisPtCmp(axisValue, minAxis) === -1) {
                        g.vertSpan.min = vIter
                        minAxis = axisValue
                    }
                    if (axisPtCmp(axisValue, maxAxis) === 1) {
                        g.vertSpan.max = vIter
                        maxAxis = axisValue
                    }
                }
            }
            g.vertSpan.minAxis = minAxis
            g.vertSpan.maxAxis = maxAxis
            g.hasPrevEdge = false
        }
        // `group_min_cmp_fn` (`:795`)
        groupArr.sort((g1, g2) => {
            let test = axisPtCmp(g1.vertSpan.minAxis, g2.vertSpan.minAxis)
            if (test === 0) test = axisPtCmp(g1.vertSpan.maxAxis, g2.vertSpan.maxAxis)
            return test
        })

        const vertsGroupTable: number[] = []
        {
            // relative location, for higher precision calculations
            const fCoRef = co(f.lFirst.v)
            let vIndex = 0 // global vert index
            for (let gIndex = 0; gIndex < groupArr.length; gIndex++) {
                for (const e of groupArr[gIndex].edgeLinks) {
                    for (const vIter of [e.v1, e.v2]) {
                        // `VERT_IN_ARRAY`
                        if (testTag(vIter)) continue
                        enableTag(vIter)
                        // not nice, but alternatives aren't much better
                        vertCoordsBackup[vIndex] = co(vIter)
                        const p = mulV2M3V3(axisMat, sub3(co(vIter), fCoRef))
                        vIter.x = p[0]
                        vIter.y = p[1]
                        vIter.z = 0
                        vIter.index = vIndex
                        vertArr[vIndex] = vIter
                        vertsGroupTable[vIndex] = gIndex
                        vIndex++
                    }
                }
            }
        }
        const vertArrLen = vertArr.length

        if (usePartialConnect) {
            // needs to be done once the vertex indices have been written into
            remap = new Array(vertArrLen).fill(-1)
            for (const tvp of tempVertPairs) remap[tvp.vTemp.index] = tvp.vOrig.index
        }

        // Create connections between groups (`:1566`).
        edgeNetNew = [...edgeNetInit]
        let edgeNetNewIndex = edgeNetInitLen
        const vertRange: [number, number] = [0, groupArr[0].vertLen]
        const args: FindConnectionArgs = {
            edgeArr,
            // we only want to check newly created edges
            edgeArrNew: [],
            edgeArrNewLen: () => edgeNetNewIndex - edgeNetInitLen,
            vertRange,
        }
        // `args.edge_arr_new` points into `edge_net_new` after the input edges.
        const syncNew = () => { args.edgeArrNew = edgeNetNew.slice(edgeNetInitLen) }

        for (let gIndex = 1; gIndex < groupArr.length; gIndex++) {
            const g = groupArr[gIndex]
            // The range of verts this group uses in 'verts_arr' (not including the last index).
            vertRange[0] = vertRange[1]
            vertRange[1] += g.vertLen

            if (!g.hasPrevEdge) {
                const vOrigin = g.vertSpan.min
                syncNew()
                const indexOther = findConnection(args, vOrigin, false, vertArr)
                // only for degenerate geometry
                if (indexOther !== -1) {
                    if (!usePartialConnect || !partialConnectCheckOverlap(remap, vOrigin.index, indexOther)) {
                        const vEnd = vertArr[indexOther]
                        // Doubles should not be present in the common case, see #150360.
                        const e = bm.edgeCreate(vOrigin, vEnd, undefined, {noDouble: true})
                        edgeNetNew[edgeNetNewIndex] = e
                        e.index = edgeNetNewIndex
                        edgeNetNewIndex++
                    }
                }
            }
            {
                const vOrigin = g.vertSpan.max
                syncNew()
                const indexOther = findConnection(args, vOrigin, true, vertArr)
                // only for degenerate geometry
                if (indexOther !== -1) {
                    if (!usePartialConnect || !partialConnectCheckOverlap(remap, vOrigin.index, indexOther)) {
                        const vEnd = vertArr[indexOther]
                        const e = bm.edgeCreate(vOrigin, vEnd, undefined, {noDouble: true})
                        edgeNetNew[edgeNetNewIndex] = e
                        e.index = edgeNetNewIndex
                        edgeNetNewIndex++
                    }
                    // tell the 'next' group it doesn't need to create its own back-link
                    groupArr[vertsGroupTable[indexOther]].hasPrevEdge = true
                }
            }
        }
        edgeNetNewLen = edgeNetNewIndex
        edgeNetNew.length = edgeNetNewLen
        ok = true

        for (let i = 0; i < vertArrLen; i++) {
            const b = vertCoordsBackup[i]
            vertArr[i].x = b[0]
            vertArr[i].y = b[1]
            vertArr[i].z = b[2]
        }
    }

    // finally: (`:1681`)
    if (usePartialConnect) {
        for (const tvp of tempVertPairs) {
            // its _very_ unlikely the edge exists, however splicing may cause this. see: #48012
            if (!diskEdgeExists(tvp.vOrig, tvp.vTemp) && !vertSpliceCheckDoubleFace(tvp.vOrig, tvp.vTemp)) {
                vertSplice(bm, tvp.vOrig, tvp.vTemp)
            }
        }
        // Remove edges which have become doubles since splicing vertices together.
        if (ok) {
            for (let i = edgeNetInitLen; i < edgeNetNewLen; i++) {
                while (edgeFindDouble(edgeNetNew[i])) {
                    bm.edgeKill(edgeNetNew[i])
                    edgeNetNewLen--
                    if (i === edgeNetNewLen) break
                    edgeNetNew[i] = edgeNetNew[edgeNetNewLen]
                }
            }
            edgeNetNew.length = edgeNetNewLen
        }
    }

    for (const e of edgeArr) {
        disableTag(e)
        disableTag(e.v1)
        disableTag(e.v2)
    }
    return ok ? edgeNetNew : null
}

// endregion
