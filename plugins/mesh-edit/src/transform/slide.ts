/**
 * Edge slide and vertex slide, the transform modes Blender runs on `G G` in edit mode, ported from
 * `editors/transform/transform_mode_edge_slide.cc`, `transform_mode_vert_slide.cc` and the slide data
 * of `transform_convert_mesh.cc` (`transform_mesh_edge_slide_data_create`,
 * `transform_mesh_vert_slide_data_create`).
 *
 * Both are {@link TransformModeInfo}s of {@link TransInfo}, so numeric input, increment and geometry
 * snapping, precision and the redo path work as for move, rotate and scale.
 *
 * Not ported: `correct_uv` (`mesh_customdatacorrect_*` in `transform_convert_mesh.cc`), which
 * re-interpolates the face corners' UVs as the vertices slide - see
 * `issues/open/modelling-tools/transform-slide-correct-uv.md`.
 */

import {BMEdge, BMesh, BMFace, BMLoop, BMVert, ElemFlag, radialLoops} from '@threepipe/mesh-kernel'
import {
    addV3,
    copyV3,
    crossV3,
    distSquaredToLineSegmentV2,
    dotV3,
    FLT_EPSILON,
    FLT_MAX,
    interpV3,
    invertM4,
    isectLineLineEpsilonV3,
    isectLinePlaneV3,
    isectRayTriV3,
    isZeroV3,
    lenSquaredV3V3,
    lenV3,
    lenV3V3,
    linePointFactorV3,
    m3FromM4,
    maddV3,
    Mat4,
    midV3,
    mulM3V3,
    mulM4M4,
    mulM4V3,
    mulProjectM4V3,
    mulV3Fl,
    normalizeV3,
    normalizedV3,
    subV3,
    Vec2,
    Vec3,
} from './math'
import {applyMouseInput, initMouseInputMode, setCustomPoints} from './input'
import {applyNumInput, hasNumInput, outputNumInput} from './numinput'
import {constraintSnapAxisToEdge, constraintSnapAxisToFace} from './constraints'
import {edgeExists, loopCalcFaceDirection, vertCo, vertIsBoundary, vertIsEdgePair} from './bmeshQuery'
import {
    getSnapPoint,
    transformSnapDistanceLenSquaredFn,
    transformSnapIncrement,
    transformSnapMixedApply,
    validSnap,
} from '../snap/transformSnap'
import {snapTargetFromBMesh} from '../snap/targets'
import {T_ALT_TRANSFORM, T_NO_CONSTRAINT, TD_SELECTED, TransData, TransDataContainer} from './types'
import type {SnapTargetMesh} from '../snap/snap'
import type {TransformModeInfo, TransInfo} from './TransInfo'
import type {ModalKeyEvent} from './keymap'

/**
 * The slide operators' properties (`TRANSFORM_OT_edge_slide`, `TRANSFORM_OT_vert_slide`,
 * `transform_ops.cc:1215`, `:1253`), read by the mode's init the way `initEdgeSlide` and
 * `initVertSlide` read them from `op->ptr`. A mode entered with `G G` gets none (the defaults).
 */
export interface SlideProps {
    /** `use_even`: keep the shape of the neighbouring loop instead of a proportional slide. */
    useEven?: boolean
    /** `flipped`: with even, follow the other neighbouring loop. */
    flipped?: boolean
    /** `use_clamp`: stay within the neighbouring edges. */
    useClamp?: boolean
    /** `single_side` (edge slide, hidden): slide towards the longer side only. */
    singleSide?: boolean
    /** `direction` (vertex slide, hidden): the world direction that picks each vertex's edge, for redo. */
    direction?: Vec3 | null
}

/** What a mode's event handler sees: Blender's `wmEvent` for `handle_event_fn`. */
export type SlideEvent = {type: 'mousemove', mval: Vec2} | {type: 'key', event: ModalKeyEvent}

// region shared

/**
 * `ED_view3d_ob_project_mat_get` (`view3d_project.cc:762`) with the `win_half` scaling of
 * `EdgeSlideData::update_proj_mat` (`transform_mode_edge_slide.cc:59`) folded into {@link projectSlide}.
 */
function projMatGet(t: TransInfo, tc: TransDataContainer): Mat4 {
    return mulM4M4(t.view.persmat, tc.mat)
}

/** `EdgeSlideData::project` / `VertSlideData::project`: object space to region pixels, no clipping. */
function projectSlide(t: TransInfo, projMat: Mat4, co: Vec3): Vec2 {
    const p = mulProjectM4V3(projMat, co)
    const hx = t.view.winx / 2, hy = t.view.winy / 2
    return [p[0] * hx + hx, p[1] * hy + hy]
}

/** `mouse_delta_to_world_dir` (`transform_generics.cc:1533`). */
export function mouseDeltaToWorldDir(t: TransInfo, delta: Vec2): Vec3 | null {
    if (delta[0] === 0 && delta[1] === 0) return null
    const dir = mulM3V3(m3FromM4(t.view.viewinv), [delta[0], delta[1], 0])
    normalizeV3(dir)
    // Skip zero length results after transform.
    if (isZeroV3(dir)) return null
    return dir
}

/** The first container that has slide data (`edge_slide_container_first_ok`, `transform_mode_edge_slide.cc:113`). */
function containerFirstOk<T>(t: TransInfo): TransDataContainer & {customMode: T} {
    for (const tc of t.containers) if (tc.customMode) return tc as TransDataContainer & {customMode: T}
    throw new Error('slide: no container with slide data')
}

/** `BLI_snprintf "%.4f "` of the slide headers. */
function headerValue(t: TransInfo, final: number): string {
    return hasNumInput(t.num) ? outputNumInput(t.num)[0] : final.toFixed(4) + ' '
}

/** Selected `TransData`, in data order (`TransDataContainer::foreach_index_selected`). */
function selectedData(tc: TransDataContainer): TransData[] {
    return tc.data.filter(td => td.flag & TD_SELECTED)
}

// endregion

// region edge slide data (`transform_convert_mesh.cc:2235-2747`)

/** `TransDataEdgeSlideVert` (`transform_convert.hh:64`). */
export interface TransDataEdgeSlideVert {
    td: TransData
    /** Directional vectors on the sides. */
    dirSide: [Vec3, Vec3]
    /** Distance between the two side targets. */
    edgeLen: number
    /** Which group of connected edges this vertex is in. */
    loopNr: number
}

/** `mesh_vert_is_inner` (`transform_convert_mesh.cc:2239`). */
function meshVertIsInner(v: BMVert): boolean {
    return vertIsEdgePair(v) && !vertIsBoundary(v)
}

/**
 * `bm_loop_calc_opposite_co` (`transform_convert_mesh.cc:2248`): the closest point on the n-gon's
 * opposite side, which sets the slide distance for n-gons.
 */
function bmLoopCalcOppositeCo(lTmp: BMLoop, planeNo: Vec3): Vec3 | null {
    // Skip adjacent edges.
    const lFirst = lTmp.next
    const lLast = lTmp.prev
    let distSqBest = FLT_MAX
    let out: Vec3 | null = null
    let lIter = lFirst
    do {
        const tvec = isectLinePlaneV3(vertCo(lIter.v), vertCo(lIter.next.v), vertCo(lTmp.v), planeNo)
        if (tvec) {
            const fac = linePointFactorV3(tvec, vertCo(lIter.v), vertCo(lIter.next.v))
            // Allow some overlap to avoid missing the intersection because of float precision.
            if (fac > -FLT_EPSILON && fac < 1 + FLT_EPSILON) {
                // Likelihood of multiple intersections per ngon is quite low, it would have to loop
                // back on itself, but better support it so check for the closest opposite edge.
                const distSqTest = lenSquaredV3V3(vertCo(lTmp.v), tvec)
                if (distSqTest < distSqBest) {
                    out = tvec
                    distSqBest = distSqTest
                }
            }
        }
    } while ((lIter = lIter.next) !== lLast)
    return out
}

/** `isect_face_dst` (`transform_convert_mesh.cc:2280`). */
function isectFaceDst(l: BMLoop): Vec3 {
    const f = l.f
    const lNext = l.next
    if (f.len === 4) {
        // We could use code below, but in this case sliding diagonally across the quad works well.
        return vertCo(lNext.next.v)
    }
    const planeNo = loopCalcFaceDirection(l)
    const isect = bmLoopCalcOppositeCo(l, planeNo)
    // Rare case.
    return isect ?? midV3(vertCo(l.prev.v), vertCo(lNext.v))
}

interface SlideFaceData {
    f: BMFace | null
    vDst: BMVert | null
    dst: Vec3
}

/** `SlideTempDataMesh` (`transform_convert_mesh.cc:2414`). Blender zero-initialises these structs. */
interface SlideTempDataMesh {
    /** The {@link TransDataEdgeSlideVert} index. */
    i: number
    sv: TransDataEdgeSlideVert | null
    v: BMVert | null
    e: BMEdge | null
    fdata: [SlideFaceData, SlideFaceData]
    vertIsEdgePair: boolean
}

function slideTempZero(): SlideTempDataMesh {
    return {i: 0, sv: null, v: null, e: null, fdata: [{f: null, vDst: null, dst: [0, 0, 0]}, {f: null, vDst: null, dst: [0, 0, 0]}], vertIsEdgePair: false}
}

/** C struct assignment. */
function slideTempCopy(s: SlideTempDataMesh): SlideTempDataMesh {
    return {
        i: s.i, sv: s.sv, v: s.v, e: s.e, vertIsEdgePair: s.vertIsEdgePair,
        fdata: [{...s.fdata[0], dst: copyV3(s.fdata[0].dst)}, {...s.fdata[1], dst: copyV3(s.fdata[1].dst)}],
    }
}

/**
 * `SlideTempDataMesh::find_best_dir` (`transform_convert_mesh.cc:2433`): the slot to slide in among the
 * directions already computed. `other` is the state of `curr` when its faces were linked to the previous
 * edge, `lSrc` the source corner of the edge being slid, `vDst` the vertex at the destination corner.
 */
function findBestDir(self: SlideTempDataMesh, other: SlideTempDataMesh, fCurr: BMFace, lSrc: BMLoop, vDst: BMVert): {dir: number, isect: boolean} {
    if (fCurr === other.fdata[0].f || vDst === other.fdata[0].vDst) return {dir: 0, isect: false}
    if (fCurr === other.fdata[1].f || vDst === other.fdata[1].vDst) return {dir: 1, isect: false}

    if (other.fdata[0].f || other.fdata[1].f) {
        // Find the best direction checking the edges that share faces between them.
        let bestDir = -1
        const lEdge = lSrc.next.v === vDst ? lSrc : lSrc.prev
        let lOther = lEdge.radialNext!
        while (lOther.f !== lEdge.f) {
            if (lOther.f === other.fdata[0].f) {
                bestDir = 0
                break
            }
            if (lOther.f === other.fdata[1].f) {
                bestDir = 1
                break
            }
            lOther = (lOther.v === self.v ? lOther.prev : lOther.next).radialNext!
        }
        if (bestDir !== -1) return {dir: bestDir, isect: true}
    }

    if (self.fdata[0].f === null || self.fdata[1].f === null) {
        return {dir: self.fdata[0].f !== null ? 1 : 0, isect: false}
    }

    // Find the best direction among those already computed. Prioritizing in order:
    // - Boundary edge that points to the closest direction.
    // - Any edge that points to the closest direction.
    const v = self.v!
    const e0 = self.fdata[0].vDst ? edgeExists(v, self.fdata[0].vDst) : null
    const e1 = self.fdata[1].vDst ? edgeExists(v, self.fdata[1].vDst) : null
    const isBoundary0 = !!e0 && edgeIsBoundaryLocal(e0)
    const isBoundary1 = !!e1 && edgeIsBoundaryLocal(e1)
    if (isBoundary0 && !isBoundary1) return {dir: 0, isect: true}
    if (isBoundary1 && !isBoundary0) return {dir: 1, isect: true}

    // Find the closest direction.
    const src = vertCo(v)
    const dst = vertCo(vDst)
    const dirCurr = subV3(dst, src)
    const dir0 = normalizedV3(subV3(self.fdata[0].dst, src))
    const dir1 = normalizedV3(subV3(self.fdata[1].dst, src))
    const dot0 = dotV3(dirCurr, dir0)
    const dot1 = dotV3(dirCurr, dir1)
    return {dir: dot0 < dot1 ? 1 : 0, isect: true}
}

/** `BM_edge_is_boundary`. */
function edgeIsBoundaryLocal(e: BMEdge): boolean {
    const l = e.l
    return l !== null && l.radialNext === l
}

/** `BM_edge_is_manifold`. */
function edgeIsManifoldLocal(e: BMEdge): boolean {
    const l = e.l
    return l !== null && l.radialNext !== l && l.radialNext!.radialNext === l
}

/**
 * `transform_mesh_edge_slide_data_create` (`transform_convert_mesh.cc:2301`): for each selected vertex
 * of the selected edge loops, the two directions it can slide in, grouped by connected loop. Null when
 * the selection is not a set of loops (a vertex with no or more than two selected edges, or a selected
 * edge with more than two faces).
 */
export function meshEdgeSlideDataCreate(bm: BMesh, tc: TransDataContainer): {sv: TransDataEdgeSlideVert[], groupLen: number} | null {
    const selected = selectedData(tc)

    // Ensure valid selection.
    for (const td of selected) {
        const v = td.extra as BMVert
        let numsel = 0
        if (v.e) {
            let e: BMEdge = v.e
            do {
                if (e.hflag & ElemFlag.Select) numsel++
                e = e.diskNext(v)!
            } while (e !== v.e)
        }
        if (numsel === 0 || numsel > 2) {
            // Invalid edge selection.
            return null
        }
    }

    const svByVert = new Map<BMVert, number>()
    const svArray: TransDataEdgeSlideVert[] = selected.map((td, i) => {
        // Identify the `TransDataEdgeSlideVert` by the vertex index.
        svByVert.set(td.extra as BMVert, i)
        return {td, loopNr: -1, dirSide: [[0, 0, 0], [0, 0, 0]], edgeLen: 0}
    })
    // `BM_ITER_MESH (e, &iter, bm, BM_EDGES_OF_MESH)`: the selected edges in mesh order.
    const selectedEdges: BMEdge[] = []
    for (const e of bm.edges) if (e.hflag & ElemFlag.Select) selectedEdges.push(e)
    return edgeSlideDataFill(svArray, svByVert, selectedEdges)
}

function edgeSlideDataFill(svArray: TransDataEdgeSlideVert[], svByVert: Map<BMVert, number>, selectedEdges: BMEdge[]): {sv: TransDataEdgeSlideVert[], groupLen: number} | null {
    // Edges must have at most two faces.
    for (const e of selectedEdges) {
        // Can edges with at least once face user.
        if (!edgeIsManifoldLocal(e) && !edgeIsBoundaryLocal(e)) return null
    }

    // Map indicating the indexes of `TransData` connected by edge.
    const tdConnected: [number, number][] = svArray.map(() => [-1, -1])
    for (const e of selectedEdges) {
        const tdIndex1 = svByVert.get(e.v1) ?? -1
        const tdIndex2 = svByVert.get(e.v2) ?? -1
        // This can occur when the mesh has symmetry enabled but is not symmetrical. See #120811.
        if (tdIndex1 === -1 || tdIndex2 === -1) continue
        const slot1 = tdConnected[tdIndex1][0] !== -1 ? 1 : 0
        const slot2 = tdConnected[tdIndex2][0] !== -1 ? 1 : 0
        tdConnected[tdIndex1][slot1] = tdIndex2
        tdConnected[tdIndex2][slot2] = tdIndex1
    }

    // Compute the sliding groups.
    let loopNr = 0
    for (let i = 0; i < svArray.length; i++) {
        if (svArray[i].loopNr !== -1) {
            // This vertex has already been computed.
            continue
        }

        // Start from a vertex connected to just a single edge or any if it doesn't exist.
        let iCurr = i
        let iPrev = tdConnected[i][1]
        while (iPrev !== -1 && iPrev !== i) {
            const tmp = tdConnected[iPrev][0] !== iCurr ? tdConnected[iPrev][0] : tdConnected[iPrev][1]
            iCurr = iPrev
            iPrev = tmp
        }

        // We need at least 3 points to calculate the intersection of `prev`-`curr` and `next`-`curr`
        // destinations. `next_next` is only required to identify the edge in `next.e`.
        //
        //  |            |            |            |
        //  |   prev.e   |   curr.e   |   next.e   |
        // prev.v ---- curr.v ---- next.v ---- next_next.v
        let prev = slideTempZero()
        let curr = slideTempZero()
        let next = slideTempZero()
        const nextNext = slideTempZero()
        let tmp: SlideTempDataMesh

        next.i = tdConnected[iCurr][0] !== iPrev ? tdConnected[iCurr][0] : tdConnected[iCurr][1]
        if (next.i !== -1) {
            next.sv = svArray[next.i]
            next.v = next.sv.td.extra as BMVert
            next.vertIsEdgePair = meshVertIsInner(next.v)
        }

        curr.i = iCurr
        if (curr.i !== -1) {
            curr.sv = svArray[curr.i]
            curr.v = curr.sv.td.extra as BMVert
            curr.vertIsEdgePair = meshVertIsInner(curr.v)
            if (next.i !== -1) curr.e = edgeExists(curr.v, next.v!)
        }

        // Do not compute `prev` for now. Let the loop calculate `curr` twice.
        prev.i = -1

        while (curr.i !== -1) {
            if (next.i !== -1) {
                nextNext.i = tdConnected[next.i][0] !== curr.i ? tdConnected[next.i][0] : tdConnected[next.i][1]
                if (nextNext.i !== -1) {
                    nextNext.sv = svArray[nextNext.i]
                    nextNext.v = nextNext.sv.td.extra as BMVert
                    nextNext.vertIsEdgePair = meshVertIsInner(nextNext.v)
                    next.e = edgeExists(next.v!, nextNext.v)
                }

                tmp = slideTempCopy(curr)

                for (const l of radialLoops(curr.e!)) {
                    const fCurr = l.f

                    let v1Dst: BMVert, v2Dst: BMVert
                    let lEdgeNext: BMEdge
                    let l1: BMLoop, l2: BMLoop
                    if (l.v === curr.v) {
                        l1 = l
                        l2 = l.next
                        lEdgeNext = l2.e!
                        v1Dst = l1.prev.v
                        v2Dst = l2.next.v
                    } else {
                        l1 = l.next
                        l2 = l
                        lEdgeNext = l2.prev.e!
                        v1Dst = l1.next.v
                        v2Dst = l2.prev.v
                    }

                    const dst = vertCo(v1Dst)

                    // Sometimes the sliding direction may fork (`isect_curr_dirs` is `true`). In this
                    // case, the resulting direction is the intersection of the destinations.
                    // Identify the slot to slide according to the directions already computed in `curr`.
                    const {dir: bestDir, isect: isectCurrDirs} = findBestDir(curr, tmp, fCurr, l1, v1Dst)

                    if (curr.fdata[bestDir].f === null) {
                        curr.fdata[bestDir].f = fCurr
                        if (curr.vertIsEdgePair) {
                            curr.fdata[bestDir].dst = isectFaceDst(l1)
                        } else {
                            curr.fdata[bestDir].vDst = v1Dst
                            curr.fdata[bestDir].dst = vertCo(v1Dst)
                        }
                    }

                    // Compute `next`.
                    next.fdata[bestDir].f = fCurr
                    if (lEdgeNext === next.e || next.vertIsEdgePair) {
                        // Case where the vertex slides over the face.
                        next.fdata[bestDir].vDst = null
                        next.fdata[bestDir].dst = isectFaceDst(l2)
                    } else {
                        // Case where the vertex slides over an edge.
                        next.fdata[bestDir].vDst = v2Dst
                        next.fdata[bestDir].dst = vertCo(v2Dst)
                    }

                    if (isectCurrDirs) {
                        // The `best_dir` can only have one direction.
                        const currOrig = curr.sv!.td.iloc
                        const dst0 = prev.fdata[bestDir].dst
                        const dst1 = curr.fdata[bestDir].dst
                        const dst2 = dst
                        const dst3 = next.fdata[bestDir].dst

                        // Sanity check the line-line intersection (`transform_convert_mesh.cc:2605-2669`):
                        // the intersection of lines A (dst0-dst1) and B (dst2-dst3) is only used when it
                        // lies in the cone with its tip at `curr_orig` and its sides through dst1 and
                        // dst2; otherwise, or for degenerate input, the midpoint of dst1 and dst2 is
                        // used. See #144270.
                        const isectEps = FLT_EPSILON
                        const res = isectLineLineEpsilonV3(dst0, dst1, dst2, dst3, isectEps)
                        let isectLineLine: number = res.count
                        const isectPair: Vec3[] = res.count !== 0 ? [res.i1, res.i2] : []

                        if (isectLineLine !== 0) {
                            // Check if the intersections are outside the "valid conical region".
                            const dir1 = normalizedV3(subV3(dst1, currOrig))
                            const dir2 = normalizedV3(subV3(dst2, currOrig))
                            const n = crossV3(dir1, dir2)
                            const lenN = normalizeV3(n)
                            if (lenN < isectEps) {
                                isectLineLine = 0
                            } else {
                                const planeNo1 = crossV3(n, dir1)
                                const len1 = normalizeV3(planeNo1)
                                const planeNo2 = crossV3(dir2, n)
                                const len2 = normalizeV3(planeNo2)
                                if (len1 < isectEps || len2 < isectEps) {
                                    isectLineLine = 0
                                } else {
                                    for (let isectPass = 0; isectPass < isectLineLine; isectPass++) {
                                        const isectCo = subV3(isectPair[isectPass], currOrig)
                                        if (dotV3(isectCo, planeNo1) <= 0 || dotV3(isectCo, planeNo2) <= 0) {
                                            // Outside the plane, ignore.
                                            isectLineLine = 0
                                            break
                                        }
                                    }
                                }
                            }
                        }

                        curr.fdata[bestDir].dst = isectLineLine !== 0 ? midV3(isectPair[0], isectPair[1]) : midV3(dst1, dst2)
                    }
                }
            }

            // The data in `curr` is computed. Use to compute the `TransDataEdgeSlideVert`.
            const sv = curr.sv!
            const iloc = sv.td.iloc
            if (curr.fdata[0].f) sv.dirSide[0] = subV3(curr.fdata[0].dst, iloc)
            if (curr.fdata[1].f) sv.dirSide[1] = subV3(curr.fdata[1].dst, iloc)
            sv.edgeLen = lenV3V3(sv.dirSide[0], sv.dirSide[1])
            sv.loopNr = loopNr

            if (iPrev !== -1 && prev.i === iPrev) {
                // Cycle returned to the beginning. The data with index `i_curr` was computed twice to
                // make sure the directions are correct the second time.
                break
            }

            // Move forward.
            prev = curr
            curr = next
            next = slideTempCopy(nextNext)
        }
        loopNr++
    }
    return {sv: svArray, groupLen: loopNr}
}

// endregion

// region edge visibility (`editmesh_utils.cc:1955-2040`)

/**
 * The edit mesh's triangles for `BMBVH_EdgeVisible`, object space, hidden faces left out
 * (`BMBVH_RESPECT_HIDDEN`). A brute-force stand-in for Blender's `BMBVHTree`: the same nearest hit.
 */
interface EdgeVisibilityTree {
    target: SnapTargetMesh
    faces: BMFace[]
}

function bmbvhNew(t: TransInfo): EdgeVisibilityTree {
    const bm = t.bm!
    const identity: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const target = snapTargetFromBMesh(bm, identity, false)
    const faces: BMFace[] = []
    for (const f of bm.faces) faces[f.index] = f
    return {target, faces}
}

/** `BKE_bmbvh_ray_cast` (`editmesh_bvh.cc:289`) with no radius: the nearest face the ray hits. */
function bmbvhRayCast(tree: EdgeVisibilityTree, co: Vec3, dir: Vec3): BMFace | null {
    const m = tree.target
    let best = FLT_MAX
    let bestTri = -1
    const p = m.positions
    const at = (i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
    for (let ti = 0; ti < m.triFace.length; ti++) {
        if (!m.triOk[ti]) continue
        const dist = isectRayTriV3(co, dir, at(m.tris[ti * 3]), at(m.tris[ti * 3 + 1]), at(m.tris[ti * 3 + 2]))
        if (dist !== null && dist < best) {
            best = dist
            bestTri = ti
        }
    }
    return bestTri !== -1 && best !== FLT_MAX ? tree.faces[m.triFace[bestTri]] : null
}

/** `edge_ray_cast` (`editmesh_utils.cc:1955`): the face hit, unless it is one of the edge's own. */
function edgeRayCast(tree: EdgeVisibilityTree, co: Vec3, dir: Vec3, e: BMEdge): BMFace | null {
    const f = bmbvhRayCast(tree, co, dir)
    if (f && [...radialLoops(e)].some(l => l.f === f)) return null
    return f
}

/** `scale_point` (`editmesh_utils.cc:1967`). */
function scalePoint(c1: Vec3, p: Vec3, s: number): Vec3 {
    return addV3(mulV3Fl(subV3(c1, p), s), p)
}

/**
 * `BMBVH_EdgeVisible` (`editmesh_utils.cc:1974`): rays from three points along the edge towards the
 * view origin; visible when one of them reaches it unblocked.
 */
function bmbvhEdgeVisible(tree: EdgeVisibilityTree, e: BMEdge, t: TransInfo, tc: TransDataContainer): boolean {
    const epsilon = 0.01
    const mvalF: Vec2 = [t.view.winx / 2, t.view.winy / 2]
    let origin = t.view.winToSegment(mvalF).start
    origin = mulM4V3(invertM4(tc.mat), origin)

    let co1 = vertCo(e.v1)
    let co2 = midV3(vertCo(e.v1), vertCo(e.v2))
    let co3 = vertCo(e.v2)
    co1 = scalePoint(co1, co2, 0.99)
    co3 = scalePoint(co3, co2, 0.99)

    // OK, idea is to generate rays going from the camera origin to the three points on the edge
    // (v1, mid, v2).
    const dir1 = subV3(origin, co1)
    const dir2 = subV3(origin, co2)
    const dir3 = subV3(origin, co3)
    const d1 = normalizedLength(dir1, epsilon)
    const d2 = normalizedLength(dir2, epsilon)
    const d3 = normalizedLength(dir3, epsilon)

    // Offset coordinates slightly along view vectors, to avoid hitting the faces that own the edge.
    co1 = addV3(co1, d1)
    co2 = addV3(co2, d2)
    co3 = addV3(co3, d3)
    normalizeV3(d1)
    normalizeV3(d2)
    normalizeV3(d3)

    // Do three samplings: left, middle, right.
    const f = edgeRayCast(tree, co1, d1, e)
    if (f && !edgeRayCast(tree, co2, d2, e)) return true
    if (f && !edgeRayCast(tree, co3, d3, e)) return true
    if (!f) return true
    return false
}

/** `normalize_v3_length`. */
function normalizedLength(v: Vec3, length: number): Vec3 {
    const r = copyV3(v)
    normalizeV3(r)
    return mulV3Fl(r, length)
}

/** `is_vert_slide_visible_bmesh` (`transform_mode_edge_slide.cc:197`). */
function isVertSlideVisibleBmesh(t: TransInfo, tc: TransDataContainer, tree: EdgeVisibilityTree, sv: TransDataEdgeSlideVert): boolean {
    const v = sv.td.extra as BMVert
    if (!v.e) return false
    let e: BMEdge = v.e
    do {
        if (!(e.hflag & (ElemFlag.Select | ElemFlag.Hidden)) && bmbvhEdgeVisible(tree, e, t, tc)) return true
        e = e.diskNext(v)!
    } while (e !== v.e)
    return false
}

// endregion

// region edge slide (`transform_mode_edge_slide.cc`)

/** `EdgeSlideData` (`transform_mode_edge_slide.cc:48`). */
export class EdgeSlideData {
    sv: TransDataEdgeSlideVert[] = []
    mvalStart: Vec2 = [0, 0]
    mvalEnd: Vec2 = [0, 0]
    currSvIndex = 0
    projMat: Mat4 = []

    /** `EdgeSlideData::update_proj_mat`. */
    updateProjMat(t: TransInfo, tc: TransDataContainer): void {
        this.projMat = projMatGet(t, tc)
    }

    /** `EdgeSlideData::project`: the two side targets on screen. */
    project(t: TransInfo, sv: TransDataEdgeSlideVert): [Vec2, Vec2] {
        const iloc = sv.td.iloc
        return [projectSlide(t, this.projMat, addV3(iloc, sv.dirSide[0])), projectSlide(t, this.projMat, addV3(iloc, sv.dirSide[1]))]
    }
}

/** `EdgeSlideParams` (`transform_mode_edge_slide.cc:95`). */
export interface EdgeSlideParams {
    perc: number
    /** When un-clamped - use this index: `TransDataEdgeSlideVert.dir_side`. */
    currSideUnclamp: number
    useEven: boolean
    flipped: boolean
    /** The cursor the slide directions were picked with, kept for redo (see {@link SlideSavedProps}). */
    mvalInit: Vec2
}

/** `calcEdgeSlideCustomPoints` (`transform_mode_edge_slide.cc:130`). */
function calcEdgeSlideCustomPoints(t: TransInfo): void {
    const sld = containerFirstOk<EdgeSlideData>(t).customMode
    setCustomPoints(t.mouse, sld.mvalEnd, sld.mvalStart)
    // `setCustomPoints` isn't normally changing as the mouse moves, in this case apply mouse input
    // immediately so we don't refresh with the value from the previous points. (No input mode yet -
    // Blender's `mi->apply` is null - leaves the values alone.)
    if (t.mouse.mode !== 'none') t.values = applyMouseInput(t, t.mouse, t.mval)
}

/** `interp_line_v3_v3v3v3` (`transform_mode_edge_slide.cc:143`): along a line of two segments. */
export function interpLineV3V3V3V3(v1: Vec3, v2: Vec3, v3: Vec3, t: number): Vec3 {
    // Could be pre-calculated.
    let tMid = linePointFactorV3(v2, v1, v3)
    const tDelta = t - tMid
    if (tDelta < 0) {
        if (Math.abs(tMid) < FLT_EPSILON) return copyV3(v2)
        return interpV3(v1, v2, t / tMid)
    }
    t = t - tMid
    tMid = 1 - tMid
    if (Math.abs(tMid) < FLT_EPSILON) return copyV3(v3)
    return interpV3(v2, v3, t / tMid)
}

/** `edge_slide_data_init_mval` (`transform_mode_edge_slide.cc:173`). */
function edgeSlideDataInitMval(t: TransInfo, sld: EdgeSlideData, mvalDir: Vec2): void {
    // Possible all of the edge loops are pointing directly at the view.
    if (mvalDir[0] * mvalDir[0] + mvalDir[1] * mvalDir[1] < 0.1) mvalDir = [0, 100]
    const mi = t.mouse
    // Zero out Start; `mval_dir` holds a vector along edge loop.
    sld.mvalStart = [Math.trunc(mi.imval[0]), Math.trunc(mi.imval[1])]
    sld.mvalEnd = [Math.trunc(mi.imval[0] + mvalDir[0] * 0.5), Math.trunc(mi.imval[1] + mvalDir[1] * 0.5)]
}

/**
 * `calcEdgeSlide_mval_range` (`transform_mode_edge_slide.cc:223`): the screen segment the cursor slides
 * along (the side directions of the vertex nearest the cursor) and, for a double-sided slide, which
 * side is which for every loop, so all loops follow the cursor the same way.
 */
function calcEdgeSlideMvalRange(t: TransInfo, tc: TransDataContainer, sld: EdgeSlideData, loopNr: number, mval: Vec2, useCalcDirection: boolean): void {
    // Use for visibility checks.
    const useOccludeGeometry = t.occludeGeometry
    const tree = useOccludeGeometry ? bmbvhNew(t) : null

    // Find mouse vectors, the global one, and one per loop in case we have multiple loops selected,
    // in case they are oriented different.
    let mvalDir: Vec2 = [0, 0]
    let distBestSq = FLT_MAX
    const loopDir: Vec2[] = useCalcDirection ? Array.from({length: loopNr}, () => [0, 0] as Vec2) : []
    const loopMaxdist: number[] = useCalcDirection ? new Array(loopNr).fill(FLT_MAX) : []

    for (let i = 0; i < sld.sv.length; i++) {
        const sv = sld.sv[i]
        const isVisible = !useOccludeGeometry || isVertSlideVisibleBmesh(t, tc, tree!, sv)

        // This test is only relevant if object is not wire-drawn! See #32068.
        if (!isVisible && !useCalcDirection) continue

        // Search cross edges for visible edge to the mouse cursor, then use the shared vertex to
        // calculate screen vector. Screen-space coords.
        const [scoA, scoB] = sld.project(t, sv)

        // Global direction.
        const distSq = distSquaredToLineSegmentV2(mval, scoB, scoA)
        if (isVisible) {
            const lenSq = (scoB[0] - scoA[0]) ** 2 + (scoB[1] - scoA[1]) ** 2
            if (distSq < distBestSq && lenSq > 0.1) {
                distBestSq = distSq
                mvalDir = [scoB[0] - scoA[0], scoB[1] - scoA[1]]
                sld.currSvIndex = i
            }
        }

        if (useCalcDirection) {
            // Per loop direction.
            const lNr = sv.loopNr
            if (distSq < loopMaxdist[lNr]) {
                loopMaxdist[lNr] = distSq
                loopDir[lNr] = [scoB[0] - scoA[0], scoB[1] - scoA[1]]
            }
        }
    }

    if (useCalcDirection) {
        for (const sv of sld.sv) {
            // Switch a/b if loop direction is different from global direction.
            const d = loopDir[sv.loopNr]
            if (d[0] * mvalDir[0] + d[1] * mvalDir[1] < 0) sv.dirSide = [sv.dirSide[1], sv.dirSide[0]]
        }
    }

    edgeSlideDataInitMval(t, sld, mvalDir)
}

/** `createEdgeSlideVerts` (`transform_mode_edge_slide.cc:348`). */
function createEdgeSlideVerts(t: TransInfo, tc: TransDataContainer, useDoubleSide: boolean): EdgeSlideData | null {
    const created = meshEdgeSlideDataCreate(t.bm!, tc)
    if (!created || !created.sv.length) return null
    const sld = new EdgeSlideData()
    sld.sv = created.sv
    const groupLen = created.groupLen

    if (!useDoubleSide) {
        // Single Side Case. Used by `MESH_OT_offset_edge_loops_slide`. It only slides to the side
        // with the longest length.
        const arrayLen = Array.from({length: groupLen}, () => ({accum: [0, 0] as Vec2, count: 0}))
        for (const sv of sld.sv) {
            arrayLen[sv.loopNr].accum[0] += lenV3(sv.dirSide[0])
            arrayLen[sv.loopNr].accum[1] += lenV3(sv.dirSide[1])
            arrayLen[sv.loopNr].count++
        }
        for (const accum of arrayLen) {
            accum.accum[0] /= accum.count
            accum.accum[1] /= accum.count
        }
        for (const sv of sld.sv) {
            if (arrayLen[sv.loopNr].accum[1] > arrayLen[sv.loopNr].accum[0]) sv.dirSide[0] = sv.dirSide[1]
            sv.dirSide[1] = [0, 0, 0]
            sv.edgeLen = lenV3(sv.dirSide[0])
        }
    }

    sld.currSvIndex = 0
    sld.updateProjMat(t, tc)
    calcEdgeSlideMvalRange(t, tc, sld, groupLen, t.mval, useDoubleSide)
    return sld
}

/** `handleEventEdgeSlide` (`transform_mode_edge_slide.cc:418`). */
function handleEventEdgeSlide(t: TransInfo, ev: SlideEvent): boolean {
    const slp = t.customMode as EdgeSlideParams | null
    if (!slp) return false
    if (ev.type === 'mousemove') {
        calcEdgeSlideCustomPoints(t)
        return false
    }
    const e = ev.event
    if (!e.press) return false
    switch (e.code) {
    case 'KeyE':
        slp.useEven = !slp.useEven
        calcEdgeSlideCustomPoints(t)
        return true
    case 'KeyF':
        slp.flipped = !slp.flipped
        calcEdgeSlideCustomPoints(t)
        return true
    case 'KeyC':
        // Use like a modifier key.
        t.flag ^= T_ALT_TRANSFORM
        calcEdgeSlideCustomPoints(t)
        return true
    default:
        return false
    }
}

/** `edge_slide_snap_apply` (`transform_mode_edge_slide.cc:600`). */
function edgeSlideSnapApply(t: TransInfo, value: number[]): void {
    const tc = containerFirstOk<EdgeSlideData>(t)
    const slp = t.customMode as EdgeSlideParams
    const sldActive = tc.customMode
    const sv = sldActive.sv[sldActive.currSvIndex]
    let coOrig = copyV3(sv.td.iloc)
    const coDest: [Vec3, Vec3] = [addV3(coOrig, sv.dirSide[0]), addV3(coOrig, sv.dirSide[1])]
    if (tc.useLocalMat) {
        coOrig = mulM4V3(tc.mat, coOrig)
        coDest[0] = mulM4V3(tc.mat, coDest[0])
        coDest[1] = mulM4V3(tc.mat, coDest[1])
    }

    let dvec = subV3(getSnapPoint(t), t.tsnap.snapSource)
    let snapPoint = addV3(coOrig, dvec)

    let perc = value[0]
    let sideIndex: number
    let tMid = 0
    if (!slp.useEven) {
        const isClamp = !(t.flag & T_ALT_TRANSFORM)
        if (isClamp) {
            sideIndex = perc < 0 ? 1 : 0
        } else {
            // Use the side indicated in `EdgeSlideParams::curr_side_unclamp` as long as that side is
            // not zero length.
            sideIndex = slp.currSideUnclamp === (!isZeroV3(sv.dirSide[slp.currSideUnclamp]) ? 1 : 0) ? 1 : 0
        }
    } else {
        // Could be pre-calculated.
        tMid = linePointFactorV3([0, 0, 0], sv.dirSide[0], sv.dirSide[1])
        const tSnap = linePointFactorV3(snapPoint, coDest[0], coDest[1])
        sideIndex = tSnap >= tMid ? 1 : 0
    }

    if (t.tsnap.targetType === 'edge' || t.tsnap.targetType === 'face') {
        const coDir = subV3(coDest[sideIndex], coOrig)
        normalizeV3(coDir)
        dvec = t.tsnap.targetType === 'edge' ? constraintSnapAxisToEdge(t, coDir, dvec) : constraintSnapAxisToFace(t, coDir, dvec)
        snapPoint = addV3(coOrig, dvec)
    }

    perc = linePointFactorV3(snapPoint, coOrig, coDest[sideIndex])
    if (!slp.useEven) {
        if (sideIndex) perc *= -1
    } else {
        if (!sideIndex) perc = (1 - perc) * tMid
        else perc = perc * (1 - tMid) + tMid
        if (slp.flipped) perc = 1 - perc
        perc = 2 * perc - 1
        if (!slp.flipped) perc *= -1
    }
    value[0] = perc
}

/** `edge_slide_apply_elem` (`transform_mode_edge_slide.cc:685`). */
function edgeSlideApplyElem(sv: TransDataEdgeSlideVert, fac: number, currLengthFac: number, currSideUnclamp: number,
    useClamp: boolean, useEven: boolean, useFlip: boolean): Vec3 {
    let rCo = copyV3(sv.td.iloc)
    if (!useEven) {
        if (useClamp) {
            const sideIndex = fac < 0 ? 1 : 0
            const facFinal = Math.abs(fac)
            rCo = maddV3(rCo, sv.dirSide[sideIndex], facFinal)
        } else {
            let sideIndex = currSideUnclamp
            if (isZeroV3(sv.dirSide[sideIndex])) sideIndex = sideIndex ? 0 : 1
            const facFinal = sideIndex === (fac < 0 ? 1 : 0) ? Math.abs(fac) : -Math.abs(fac)
            rCo = maddV3(rCo, sv.dirSide[sideIndex], facFinal)
        }
    } else if (sv.edgeLen > FLT_EPSILON) {
        // NOTE(@ideasman42): Implementation note, even mode ignores the starting positions and uses
        // only the a/b verts, this could be changed/improved so the distance is still met but the
        // verts are moved along their original path (which may not be straight), however how it works
        // now is OK and matches 2.4x.
        const facFinal = Math.min(sv.edgeLen, currLengthFac) / sv.edgeLen
        const coA = addV3(rCo, sv.dirSide[0])
        const coB = addV3(rCo, sv.dirSide[1])
        rCo = useFlip ? interpLineV3V3V3V3(coB, rCo, coA, facFinal) : interpLineV3V3V3V3(coA, rCo, coB, facFinal)
    }
    return rCo
}

/** `doEdgeSlide` (`transform_mode_edge_slide.cc:739`). */
function doEdgeSlide(t: TransInfo, perc: number): void {
    const slp = t.customMode as EdgeSlideParams
    const sldActive = containerFirstOk<EdgeSlideData>(t).customMode
    slp.perc = perc

    const useClamp = !(t.flag & T_ALT_TRANSFORM)
    const useEven = slp.useEven
    const useFlip = slp.flipped

    const currSideUnclamp = slp.currSideUnclamp
    let currLengthFac = 0
    if (useEven) {
        const svActive = sldActive.sv[sldActive.currSvIndex]
        currLengthFac = svActive.edgeLen * (((useFlip ? perc : -perc) + 1) / 2)
    } else if (useClamp) {
        slp.currSideUnclamp = perc < 0 ? 1 : 0
    }

    for (const tc of t.containers) {
        const sld = tc.customMode as EdgeSlideData | undefined
        if (!sld) continue
        for (const sv of sld.sv) {
            sv.td.loc = edgeSlideApplyElem(sv, perc, currLengthFac, currSideUnclamp, useClamp, useEven, useFlip)
        }
    }
}

/** `applyEdgeSlide` (`transform_mode_edge_slide.cc:774`). */
function applyEdgeSlide(t: TransInfo): void {
    const isClamp = !(t.flag & T_ALT_TRANSFORM)
    const isConstrained = !(!isClamp || hasNumInput(t.num))

    const v = [t.values[0] + t.valuesModalOffset[0]]
    transformSnapMixedApply(t, v)
    if (!validSnap(t)) transformSnapIncrement(t, v)
    let final = v[0]

    // Only do this so out of range values are not displayed.
    if (isConstrained) final = Math.max(-1, Math.min(1, final))

    const num = [final]
    applyNumInput(t.num, num)
    final = num[0]

    t.valuesFinal[0] = final
    t.header = 'Edge Slide: ' + headerValue(t, final)
    doEdgeSlide(t, final)
}

/** `initEdgeSlide_ex` (`transform_mode_edge_slide.cc:884`). */
function initEdgeSlideEx(t: TransInfo, useDoubleSide: boolean, useEven: boolean, flipped: boolean, useClamp: boolean): void {
    t.mode = 'edgeSlide'
    const slp: EdgeSlideParams = {
        perc: 0,
        currSideUnclamp: 0,
        useEven,
        // Happens to be best for single-sided.
        flipped: useDoubleSide ? flipped : !flipped,
        mvalInit: [t.mval[0], t.mval[1]],
    }
    if (!useClamp) t.flag |= T_ALT_TRANSFORM
    t.customMode = slp

    let ok = false
    for (const tc of t.containers) {
        const sld = t.bm ? createEdgeSlideVerts(t, tc, useDoubleSide) : null
        if (sld) {
            tc.customMode = sld
            ok = true
        }
    }
    if (!ok) {
        t.state = 'cancel'
        return
    }

    // Set custom point first if you want value to be initialized by init.
    calcEdgeSlideCustomPoints(t)
    initMouseInputMode(t.mouse, 'customRatioFlip')

    t.idxMax = 0
    t.num.idxMax = 0
    t.increment[0] = 0.1
    t.incrementPrecision = 0.1
    t.num.valInc = [0.1, 0.1, 0.1]
    t.num.unitType = ['none', 'none', 'none']
}

/** `initEdgeSlide` (`transform_mode_edge_slide.cc:944`). */
function initEdgeSlide(t: TransInfo, op: SlideProps | null): void {
    // The following properties could be unset when transitioning from this operator to another and
    // back. For example pressing "G" to move, and then "G" again to go back to edge slide.
    initEdgeSlideEx(t, !(op?.singleSide ?? false), op?.useEven ?? false, op?.flipped ?? false, op?.useClamp ?? true)
}

export const TransModeEdgeSlide: TransformModeInfo = {
    flags: T_NO_CONSTRAINT,
    init: initEdgeSlide,
    transform: applyEdgeSlide,
    handleEvent: handleEventEdgeSlide,
    snapDistance: transformSnapDistanceLenSquaredFn,
    snapApply: edgeSlideSnapApply,
}

/**
 * `drawEdgeSlide` (`transform_mode_edge_slide.cc:461`) as geometry: the guide segments and points, in
 * world space, for the overlay to draw.
 */
export function edgeSlideDrawData(t: TransInfo): SlideDrawData | null {
    const tc = t.containers.find(c => c.customMode)
    const slp = t.customMode as EdgeSlideParams | null
    if (!tc || !slp) return null
    const sld = tc.customMode as EdgeSlideData
    const w = (co: Vec3): Vec3 => mulM4V3(tc.mat, co)
    const isClamp = !(t.flag & T_ALT_TRANSFORM)
    const currSv = sld.sv[sld.currSvIndex]
    const currSvCoOrig = currSv.td.iloc
    const out: SlideDrawData = {lines: [], points: [], guide: null}

    if (slp.useEven) {
        // Even mode.
        const fac = (slp.perc + 1) / 2
        const coA = addV3(currSvCoOrig, currSv.dirSide[0])
        const coB = addV3(currSvCoOrig, currSv.dirSide[1])
        if (!isZeroV3(currSv.dirSide[0])) out.lines.push(w(coA), w(currSvCoOrig))
        if (!isZeroV3(currSv.dirSide[1])) out.lines.push(w(coB), w(currSvCoOrig))
        let coTest: Vec3 | null = null
        if (slp.flipped) {
            if (!isZeroV3(currSv.dirSide[1])) coTest = coB
        } else if (!isZeroV3(currSv.dirSide[0])) {
            coTest = coA
        }
        if (coTest) out.points.push(w(coTest))
        out.guide = w(interpLineV3V3V3V3(coB, currSvCoOrig, coA, fac))
    } else if (!isClamp) {
        const sideIndex = slp.currSideUnclamp
        // TODO(@ideasman42): Loop over all verts.
        for (const sv of sld.sv) {
            let a = !isZeroV3(sv.dirSide[sideIndex]) ? copyV3(sv.dirSide[sideIndex]) : copyV3(sv.dirSide[sideIndex ? 0 : 1])
            a = mulV3Fl(a, 100)
            const b = mulV3Fl(a, -1)
            out.lines.push(w(addV3(a, sv.td.iloc)), w(addV3(b, sv.td.iloc)))
        }
    } else {
        // Common case.
        const coDir = addV3(currSvCoOrig, currSv.dirSide[slp.currSideUnclamp])
        out.lines.push(w(currSvCoOrig), w(coDir))
    }
    return out
}

/** What a slide mode draws: line segments (pairs), control points, and the even-mode guide point. */
export interface SlideDrawData {
    lines: Vec3[]
    points: Vec3[]
    guide: Vec3 | null
}

// endregion

// region vertex slide (`transform_mode_vert_slide.cc`)

/** `TransDataVertSlideVert` (`transform_convert.hh:80`). */
export interface TransDataVertSlideVert {
    td: TransData
    /** Target locations, object space. */
    coLinkOrig3d: Vec3[]
    coLinkCurr: number
}

const coDest3d = (sv: TransDataVertSlideVert): Vec3 => sv.coLinkOrig3d[sv.coLinkCurr]

/**
 * `transform_mesh_vert_slide_data_create` (`transform_convert_mesh.cc:2179`): for each selected vertex,
 * the other ends of its visible edges, or its own position when it has none.
 */
export function meshVertSlideDataCreate(tc: TransDataContainer): TransDataVertSlideVert[] {
    const out: TransDataVertSlideVert[] = []
    for (const td of selectedData(tc)) {
        const v = td.extra as BMVert
        const targets: Vec3[] = []
        if (v.e) {
            let e: BMEdge = v.e
            do {
                if (!(e.hflag & ElemFlag.Hidden)) targets.push(vertCo(e.otherVert(v)))
                e = e.diskNext(v)!
            } while (e !== v.e)
        }
        // NOTE(@ideasman42): it may be better not to add these at all since sliding into itself is
        // a no-op. Needs to be investigated.
        if (!targets.length) targets.push(copyV3(td.iloc))
        out.push({td, coLinkOrig3d: targets, coLinkCurr: 0})
    }
    return out
}

/** `VertSlideData` (`transform_mode_vert_slide.cc:43`). */
export class VertSlideData {
    sv: TransDataVertSlideVert[] = []
    currSvIndex = 0
    projMat: Mat4 = []

    updateProjMat(t: TransInfo, tc: TransDataContainer): void {
        this.projMat = projMatGet(t, tc)
    }

    project(t: TransInfo, co: Vec3): Vec2 {
        return projectSlide(t, this.projMat, co)
    }

    /**
     * `VertSlideData::update_active_edges` (`:91`): per vertex, the edge closest to a world direction.
     * Run while moving the mouse to slide along the edge matching the mouse direction.
     */
    updateActiveEdges(tc: TransDataContainer, dir: Vec3): void {
        const obmat3 = m3FromM4(tc.mat)
        for (const sv of this.sv) {
            if (sv.coLinkOrig3d.length <= 1) continue
            const vCoOrig = sv.td.iloc
            let dirDotBest = -FLT_MAX
            let coLinkCurrBest = -1
            for (let j = 0; j < sv.coLinkOrig3d.length; j++) {
                const dirLocal = subV3(sv.coLinkOrig3d[j], vCoOrig)
                const tdir = normalizedV3(mulM3V3(obmat3, dirLocal))
                const dirDot = dotV3(dir, tdir)
                if (dirDot > dirDotBest) {
                    dirDotBest = dirDot
                    coLinkCurrBest = j
                }
            }
            if (coLinkCurrBest !== -1) sv.coLinkCurr = coLinkCurrBest
        }
    }

    /** `VertSlideData::update_active_vert` (`:137`): the vertex nearest the cursor sets the reference. */
    updateActiveVert(t: TransInfo, mval: Vec2): void {
        let distMinSq = FLT_MAX
        for (let i = 0; i < this.sv.length; i++) {
            const co2d = this.project(t, this.sv[i].td.iloc)
            const distSq = (mval[0] - co2d[0]) ** 2 + (mval[1] - co2d[1]) ** 2
            if (distSq < distMinSq) {
                distMinSq = distSq
                this.currSvIndex = i
            }
        }
    }
}

/** `VertSlideParams` (`transform_mode_vert_slide.cc:154`). */
export interface VertSlideParams {
    perc: number
    useEven: boolean
    flipped: boolean
    /** Must never be zero length, otherwise should be null. */
    dir3d: Vec3 | null
    /** The cursor the reference vertex was picked with, kept for redo. */
    mvalInit: Vec2
}

/** `vert_slide_update_input` (`transform_mode_vert_slide.cc:163`). */
function vertSlideUpdateInput(t: TransInfo): void {
    const slp = t.customMode as VertSlideParams
    const sld = containerFirstOk<VertSlideData>(t).customMode
    const sv = sld.sv[sld.currSvIndex]
    const coOrig2d = sld.project(t, sv.td.iloc)
    const coCurr2d = sld.project(t, coDest3d(sv))
    // `int mval_ofs[2], mval_start[2], mval_end[2]`.
    const mvalOfs: Vec2 = [Math.trunc(t.mouse.imval[0] - coOrig2d[0]), Math.trunc(t.mouse.imval[1] - coOrig2d[1])]
    const mvalStart: Vec2 = [Math.trunc(coOrig2d[0] + mvalOfs[0]), Math.trunc(coOrig2d[1] + mvalOfs[1])]
    const mvalEnd: Vec2 = [Math.trunc(coCurr2d[0] + mvalOfs[0]), Math.trunc(coCurr2d[1] + mvalOfs[1])]
    if (slp.flipped && slp.useEven) setCustomPoints(t.mouse, mvalStart, mvalEnd)
    else setCustomPoints(t.mouse, mvalEnd, mvalStart)
}

/** `calcVertSlideCustomPoints` (`transform_mode_vert_slide.cc:190`). */
function calcVertSlideCustomPoints(t: TransInfo): void {
    vertSlideUpdateInput(t)
    // `setCustomPoints` isn't normally changing as the mouse moves, in this case apply mouse input
    // immediately so we don't refresh with the value from the previous points.
    if (t.mouse.mode !== 'none') t.values = applyMouseInput(t, t.mouse, t.mval)
}

/** `handleEventVertSlide` (`transform_mode_vert_slide.cc:242`). */
function handleEventVertSlide(t: TransInfo, ev: SlideEvent, handled: boolean): boolean {
    // Event already handled.
    if (handled && ev.type !== 'mousemove') return false
    const slp = t.customMode as VertSlideParams | null
    if (!slp) return false
    if (ev.type === 'mousemove') {
        // Don't recalculate the best edge.
        const isClamp = !(t.flag & T_ALT_TRANSFORM)
        if (isClamp) {
            const dirUnit = mouseDeltaToWorldDir(t, [ev.mval[0] - t.mouse.imval[0], ev.mval[1] - t.mouse.imval[1]])
            if (dirUnit) {
                // Update the slide direction for every selected object.
                for (const tc of t.containers) {
                    const sld = tc.customMode as VertSlideData | undefined
                    if (sld) sld.updateActiveEdges(tc, dirUnit)
                }
                slp.dir3d = dirUnit
            }
        }
        calcVertSlideCustomPoints(t)
        return false
    }
    const e = ev.event
    if (!e.press) return false
    switch (e.code) {
    case 'KeyE':
        slp.useEven = !slp.useEven
        if (slp.flipped) calcVertSlideCustomPoints(t)
        return true
    case 'KeyF':
        slp.flipped = !slp.flipped
        calcVertSlideCustomPoints(t)
        return true
    case 'KeyC':
        // Use like a modifier key.
        t.flag ^= T_ALT_TRANSFORM
        calcVertSlideCustomPoints(t)
        return true
    default:
        return false
    }
}

/** `vert_slide_apply_elem` (`transform_mode_vert_slide.cc:433`). */
function vertSlideApplyElem(sv: TransDataVertSlideVert, perc: number, useEven: boolean, useFlip: boolean): Vec3 {
    const coOrig3d = sv.td.iloc
    const coDest = coDest3d(sv)
    if (!useEven) return interpV3(coOrig3d, coDest, perc)
    const dir = subV3(coDest, coOrig3d)
    const edgeLen = normalizeV3(dir)
    if (edgeLen > FLT_EPSILON) return useFlip ? maddV3(coDest, dir, -perc) : maddV3(coOrig3d, dir, perc)
    return copyV3(coOrig3d)
}

/** `doVertSlide` (`transform_mode_vert_slide.cc:462`). */
function doVertSlide(t: TransInfo, perc: number): void {
    const slp = t.customMode as VertSlideParams
    slp.perc = perc
    const useEven = slp.useEven
    for (const tc of t.containers) {
        const sld = tc.customMode as VertSlideData | undefined
        if (!sld) continue
        let tperc = perc
        if (useEven) {
            const svCurr = sld.sv[sld.currSvIndex]
            tperc *= lenV3V3(svCurr.td.iloc, coDest3d(svCurr))
        }
        for (const sv of sld.sv) sv.td.loc = vertSlideApplyElem(sv, tperc, useEven, slp.flipped)
    }
}

/** `vert_slide_snap_apply` (`transform_mode_vert_slide.cc:489`). */
function vertSlideSnapApply(t: TransInfo, value: number[]): void {
    const tc = containerFirstOk<VertSlideData>(t)
    const sld = tc.customMode
    const sv = sld.sv[sld.currSvIndex]
    let coOrig3d = copyV3(sv.td.iloc)
    let coCurr3d = copyV3(coDest3d(sv))
    if (tc.useLocalMat) {
        coOrig3d = mulM4V3(tc.mat, coOrig3d)
        coCurr3d = mulM4V3(tc.mat, coCurr3d)
    }
    let dvec = subV3(getSnapPoint(t), t.tsnap.snapSource)
    if (t.tsnap.targetType === 'edge' || t.tsnap.targetType === 'face') {
        const coDir = subV3(coCurr3d, coOrig3d)
        normalizeV3(coDir)
        dvec = t.tsnap.targetType === 'edge' ? constraintSnapAxisToEdge(t, coDir, dvec) : constraintSnapAxisToFace(t, coDir, dvec)
    }
    const snapPoint = addV3(coOrig3d, dvec)
    value[0] = linePointFactorV3(snapPoint, coOrig3d, coCurr3d)
}

/** `applyVertSlide` (`transform_mode_vert_slide.cc:521`). */
function applyVertSlide(t: TransInfo): void {
    const isClamp = !(t.flag & T_ALT_TRANSFORM)
    const isConstrained = !(!isClamp || hasNumInput(t.num))

    const v = [t.values[0] + t.valuesModalOffset[0]]
    transformSnapMixedApply(t, v)
    if (!validSnap(t)) transformSnapIncrement(t, v)
    let final = v[0]

    // Only do this so out of range values are not displayed.
    if (isConstrained) final = Math.max(0, Math.min(1, final))

    const num = [final]
    applyNumInput(t.num, num)
    final = num[0]

    t.valuesFinal[0] = final
    t.header = 'Vertex Slide: ' + headerValue(t, final)
    doVertSlide(t, final)
}

/** `initVertSlide_ex` (`transform_mode_vert_slide.cc:621`). */
function initVertSlideEx(t: TransInfo, useEven: boolean, flipped: boolean, useClamp: boolean, direction: Vec3 | null): void {
    t.mode = 'vertSlide'
    const slp: VertSlideParams = {perc: 0, useEven, flipped, dir3d: null, mvalInit: [t.mval[0], t.mval[1]]}
    if (!useClamp) t.flag |= T_ALT_TRANSFORM
    if (direction) slp.dir3d = normalizedV3(direction)
    t.customMode = slp

    let ok = false
    const initDir: Vec3 = slp.dir3d
        ?? mouseDeltaToWorldDir(t, [t.mval[0] - t.mouse.imval[0], t.mval[1] - t.mouse.imval[1]])
        // Fallback direction so the operator initializes before any mouse movement.
        ?? [1, 0, 0]

    for (const tc of t.containers) {
        const sv = t.bm ? meshVertSlideDataCreate(tc) : []
        if (!sv.length) continue
        const sld = new VertSlideData()
        sld.sv = sv
        sld.currSvIndex = 0
        sld.updateProjMat(t, tc)
        sld.updateActiveVert(t, t.mval)
        sld.updateActiveEdges(tc, initDir)
        tc.customMode = sld
        ok = true
    }
    if (!ok) {
        t.state = 'cancel'
        return
    }

    // Set custom point first if you want value to be initialized by init.
    calcVertSlideCustomPoints(t)
    initMouseInputMode(t.mouse, 'customRatio')

    t.idxMax = 0
    t.num.idxMax = 0
    t.increment[0] = 0.1
    t.incrementPrecision = 0.1
    t.num.valInc = [0.1, 0.1, 0.1]
    t.num.unitType = ['none', 'none', 'none']
}

/** `initVertSlide` (`transform_mode_vert_slide.cc:697`). */
function initVertSlide(t: TransInfo, op: SlideProps | null): void {
    initVertSlideEx(t, op?.useEven ?? false, op?.flipped ?? false, op?.useClamp ?? true, op?.direction ?? null)
}

export const TransModeVertSlide: TransformModeInfo = {
    flags: T_NO_CONSTRAINT,
    init: initVertSlide,
    transform: applyVertSlide,
    handleEvent: handleEventVertSlide,
    snapDistance: transformSnapDistanceLenSquaredFn,
    snapApply: vertSlideSnapApply,
}

/** `drawVertSlide` (`transform_mode_vert_slide.cc:308`) as geometry, world space. */
export function vertSlideDrawData(t: TransInfo): SlideDrawData | null {
    const tc = t.containers.find(c => c.customMode)
    const slp = t.customMode as VertSlideParams | null
    if (!tc || !slp) return null
    const sld = tc.customMode as VertSlideData
    const w = (co: Vec3): Vec3 => mulM4V3(tc.mat, co)
    const isClamp = !(t.flag & T_ALT_TRANSFORM)
    const out: SlideDrawData = {lines: [], points: [], guide: null}
    for (const sv of sld.sv) {
        const coOrig = sv.td.iloc
        const coDest = coDest3d(sv)
        if (isClamp) {
            out.lines.push(w(coOrig), w(coDest))
        } else {
            const a = mulV3Fl(subV3(coDest, coOrig), 100)
            const b = mulV3Fl(a, -1)
            out.lines.push(w(addV3(a, coOrig)), w(addV3(b, coOrig)))
        }
    }
    const curr = sld.sv[sld.currSvIndex]
    out.points.push(w(slp.flipped && slp.useEven ? coDest3d(curr) : curr.td.iloc))
    return out
}

// endregion
