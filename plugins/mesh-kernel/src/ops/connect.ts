/**
 * Connect vertices across faces, splitting the faces: `bmesh.ops.connect_verts`, and the two edit-mode
 * operators built on it and on `connect_vert_pair` (`./connectPair.ts`) - Vertex Connect
 * (`MESH_OT_vert_connect`) and Vertex Connect Path (`MESH_OT_vert_connect_path`, the J key).
 *
 * Ported from `source/blender/bmesh/operators/bmo_connect.cc` (all of it) and
 * `source/blender/editors/mesh/editmesh_tools.cc:1194-1693` (`edbm_connect_vert_pair`,
 * `edbm_vert_connect_exec`, `bm_vert_is_select_history_open`, `bm_vert_connect_pair`,
 * `bm_vert_connect_select_history`, `bm_vert_connect_select_history_edge_to_vert_path`,
 * `edbm_vert_connect_path_exec`), with the `bmesh_query.cc` / `bmesh_polygon.cc` /
 * `bmesh_marking.cc` / `bmesh_mesh.cc` helpers they call that the kernel lacks (see `// region
 * helpers`).
 *
 * Operator flags become Sets beside the mesh: `VERT_INPUT` ({@link ConnectContext.vertInput}),
 * `EDGE_OUT` / `EDGE_OUT_ADJ`, `FACE_TAG` / `FACE_EXCLUDE`. Blender keeps a separate flag layer per
 * nested operator (`BMO_push`), which is what separate Sets per call reproduce.
 *
 * Not ported, because the kernel has no such data: `BM_custom_loop_normals_to_vector_layer` /
 * `_from_vector_layer` (custom split normals) and `EDBM_update` (looptris / draw caches - the editor
 * rebuilds those). The multires paths of `BM_face_split` are skipped as in `mods.ts`.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh, BMSelectHistoryEntry} from '../bmesh/BMesh'
import {faceSplit, loopIsAdjacent} from '../bmesh/mods'
import {faceVertShareLoop} from '../bmesh/walkers'
import {faceFindDouble} from '../bmesh/splice'
import {diskEdgeExists, diskEdges, radialLoops} from '../bmesh/structure'
import {edgeSelectSet, selectModeFlush} from '../bmesh/marking'
import {elemsHflagEnable} from '../bmesh/hflag'
import {faceEdgeShareLoop} from '../bmesh/euler'
import {normalsUpdate} from './bevel-bmquery'
import {loopsOfVert} from './dissolve'
import {bmeshEditEnd} from './bmo'
import {ElemFlag, ElemType} from '../constants'
import {Vec3, v3dot, v3sub} from '../math'
import {
    ISECT_LINE_LINE_CROSS, Vec2, addNewellCrossV3V3V3, axisDominantV3ToM3, equalsV2V2, isPolyConvexV2,
    isQuadFlipV3, isectSegSegV2, mulV2M3V3, normalizeV3Len,
} from '../math/geom'
import {connectVertPairExec} from './connectPair'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/**
 * `bmesh_edit_end` for a top-level `connect_verts` / `connect_vert_pair` (`BMO_op_exec`,
 * `bmesh_operators.cc:181`): both are `BMO_OPTYPE_FLAG_NORMALS_CALC | BMO_OPTYPE_FLAG_SELECT_FLUSH`
 * (`bmesh_opdefines.cc:1340`, `:1420`) - every normal recalculated, then the selection flushed by the
 * select mode with the history set aside (no `SELECT_VALIDATE`). Nested runs skip it, which is why
 * the `*Exec` functions do not call it.
 */
export const EDIT_END_FLAGS = {normalsCalc: true, selectFlush: true} as const

// region helpers - `bmesh_query.cc`, `bmesh_polygon.cc`, `bmesh_marking.cc`, `bmesh_mesh.cc`

/** `BM_LOOPS_OF_EDGE` (`bmiter__loop_of_edge_step`, `bmesh_iterators.cc:504`): the radial cycle from `e.l`. */
export function* loopsOfEdge(e: BMEdge): Generator<BMLoop> {
    if (!e.l) return
    let l: BMLoop = e.l
    do {
        yield l
        l = l.radialNext!
    } while (l !== e.l)
}

/** `BM_vert_is_wire` (`bmesh_query.cc:700`): the vertex has edges and none of them has a face. */
export function vertIsWire(v: BMVert): boolean {
    if (v.e) {
        for (const e of diskEdges(v)) {
            if (e.l) return false
        }
        return true
    }
    return false
}

/**
 * `bm_loop_normal_accum` (`bmesh_polygon.cc:719`): add the face normal weighted by the corner angle.
 * Blender takes the angle with `math::safe_acos_approx`, a float32 polynomial chosen for speed (and
 * 3.4.1, which wrote the fixtures, with exact `saacos`); exact `acos` with the same clamp is used
 * here, as the kernel's other normal code does.
 */
function loopNormalAccum(l: BMLoop, no: Vec3): void {
    const vec1 = v3sub(co(l.v), co(l.prev.v))
    const vec2 = v3sub(co(l.next.v), co(l.v))
    normalizeV3Len(vec1)
    normalizeV3Len(vec2)
    const fac = Math.acos(Math.min(1, Math.max(-1, -v3dot(vec1, vec2))))
    no[0] += l.f.nx * fac
    no[1] += l.f.ny * fac
    no[2] += l.f.nz * fac
}

/**
 * `BM_vert_calc_normal` (`bmesh_polygon.cc:764`): the angle-weighted average of the stored normals of
 * the faces around `v`, or the zero vector (and false) for a vertex without faces.
 */
export function vertCalcNormal(v: BMVert): {no: Vec3, ok: boolean} {
    let len = 0
    const no: Vec3 = [0, 0, 0]
    if (v.e) {
        for (const e of diskEdges(v)) {
            if (e.l) {
                for (const l of radialLoops(e)) {
                    if (l.v === v) {
                        loopNormalAccum(l, no)
                        len++
                    }
                }
            }
        }
    }
    if (len) {
        normalizeV3Len(no)
        return {no, ok: true}
    }
    return {no, ok: false}
}

/**
 * `BM_vert_normal_update` (`bmesh_polygon.cc:819`): `BM_vert_calc_normal(v, v->no)`. Unlike the
 * whole-mesh update there is no fallback: a vertex without faces gets the zero normal. (Named apart
 * from `bevel-bmquery`'s `vertNormalUpdate`, which is `bm_vert_calc_normals_impl` with the
 * normalised-position fallback of the whole-mesh update.)
 */
export function bmVertNormalUpdate(v: BMVert): void {
    const {no} = vertCalcNormal(v)
    v.nx = no[0]
    v.ny = no[1]
    v.nz = no[2]
}

/**
 * `BM_face_calc_normal_subset` (`bmesh_polygon.cc:1034`): Newell's normal of the part of the face from
 * `lFirst` to `lLast` (inclusive), closed by the edge back from `lLast` to `lFirst`. Returns the
 * normal and its length before normalising (0 when degenerate).
 */
export function faceCalcNormalSubset(lFirst: BMLoop, lLast: BMLoop): {no: Vec3, len: number} {
    const no: Vec3 = [0, 0, 0]
    let lIter = lFirst
    const lTerm = lLast.next
    let vPrev = co(lLast.v)
    do {
        const vCurr = co(lIter.v)
        addNewellCrossV3V3V3(no, vPrev, vCurr)
        vPrev = vCurr
    } while ((lIter = lIter.next) !== lTerm)
    const len = normalizeV3Len(no)
    return {no, len}
}

/** `bm_face_calc_split_dot` (`bmesh_query.cc:232`). */
function faceCalcSplitDot(lA: BMLoop, lB: BMLoop): number {
    const a = faceCalcNormalSubset(lA, lB)
    if (a.len !== 0) {
        const b = faceCalcNormalSubset(lB, lA)
        if (b.len !== 0) return v3dot(a.no, b.no)
    }
    return -1
}

/**
 * `BM_vert_pair_share_face_by_angle` (`bmesh_query.cc:263`): of the faces both vertices use, the one
 * a split between them divides most evenly (the two halves' normals agree best).
 */
export function vertPairShareFaceByAngle(
    vA: BMVert, vB: BMVert, allowAdjacent: boolean,
): {f: BMFace, lA: BMLoop, lB: BMLoop} | null {
    let lCurA: BMLoop | null = null
    let lCurB: BMLoop | null = null
    let fCur: BMFace | null = null
    if (vA.e && vB.e) {
        let dotBest = -1
        for (const lA of loopsOfVert(vA)) {
            const lB = faceVertShareLoop(lA.f, vB)
            if (lB && (allowAdjacent || !loopIsAdjacent(lA, lB))) {
                if (fCur === null) {
                    fCur = lA.f
                    lCurA = lA
                    lCurB = lB
                } else {
                    // avoid expensive calculations if we only ever find one face
                    if (dotBest === -1) dotBest = faceCalcSplitDot(lCurA!, lCurB!)
                    const dot = faceCalcSplitDot(lA, lB)
                    if (dot > dotBest) {
                        dotBest = dot
                        fCur = lA.f
                        lCurA = lA
                        lCurB = lB
                    }
                }
            }
        }
    }
    return fCur ? {f: fCur, lA: lCurA!, lB: lCurB!} : null
}

/**
 * `BM_vert_pair_share_face_check_cb` (`bmesh_query.cc:126`): do the vertices share a face that
 * passes `testFn`? Faces are visited in `BM_FACES_OF_VERT` order around `vA`.
 */
export function vertPairShareFaceCheckCb(vA: BMVert, vB: BMVert, testFn: (f: BMFace) => boolean): boolean {
    if (vA.e && vB.e) {
        for (const l of loopsOfVert(vA)) {
            const f = l.f
            if (testFn(f)) {
                if (faceVertShareLoop(f, vB)) return true
            }
        }
    }
    return false
}

/**
 * `BM_edge_pair_share_face_by_len` (`bmesh_query.cc:204`): the smallest face both edges belong to,
 * with each edge's loop in it.
 */
export function edgePairShareFaceByLen(
    eA: BMEdge, eB: BMEdge, allowAdjacent: boolean,
): {f: BMFace, lA: BMLoop, lB: BMLoop} | null {
    let lCurA: BMLoop | null = null
    let lCurB: BMLoop | null = null
    let fCur: BMFace | null = null
    if (eA.l && eB.l) {
        for (const lA of loopsOfEdge(eA)) {
            if (fCur === null || lA.f.len < fCur.len) {
                const lB = faceEdgeShareLoop(lA.f, eB)
                if (lB && (allowAdjacent || !loopIsAdjacent(lA, lB))) {
                    fCur = lA.f
                    lCurA = lA
                    lCurB = lB
                }
            }
        }
    }
    return fCur ? {f: fCur, lA: lCurA!, lB: lCurB!} : null
}

/** `angle_signed_v2v2` (`math_vector.cc:330`). */
function angleSignedV2V2(v1: Vec2, v2: Vec2): number {
    const perpDot = v1[1] * v2[0] - v1[0] * v2[1]
    return Math.atan2(perpDot, v1[0] * v2[0] + v1[1] * v2[1])
}

/** `angle_signed_v2v2_pos` (`bmesh_polygon.cc:40`): the signed angle in `[0, 2pi]`. */
function angleSignedV2V2Pos(v1: Vec2, v2: Vec2): number {
    const angle = angleSignedV2V2(v1, v2)
    if (angle < 0) return angle + Math.PI * 2
    return angle
}

/** `math::normalize` for a `float2` (`BLI_math_vector.hh:521`): threshold on the squared length. */
function normalizeV2Math(v: Vec2): Vec2 {
    const lenSq = v[0] * v[0] + v[1] * v[1]
    if (lenSq > 1.0e-35) {
        const len = Math.sqrt(lenSq)
        return [v[0] / len, v[1] / len]
    }
    return [0, 0]
}

/** A pair of corners to cut between; Blender's `BMLoop *(*loops)[2]`, `[0]` cleared to reject. */
export type LoopPair = [BMLoop | null, BMLoop]

/**
 * `BM_face_splits_check_legal` (`bmesh_polygon.cc:1335`): clear (`pair[0] = null`) every proposed
 * cut of `f` that does not lie inside the face, crosses one of its edges, or crosses another cut.
 * Reads the stored face normal, which must be current. A convex face accepts every cut.
 *
 * Blender numbers the loops into `l->head.index` (marking the index dirty); a local map does the same
 * without touching the elements.
 *
 * Version note: Blender 3.4.1 decided "inside" by casting a ray from the cut's midpoint; the current
 * source (ported here) compares the cut's direction with the corner angle at both ends.
 */
export function faceSplitsCheckLegal(f: BMFace, loops: LoopPair[]): void {
    const len = loops.length
    const center: Vec2 = [0, 0]
    const axisMat = axisDominantV3ToM3([f.nx, f.ny, f.nz])
    const projverts: Vec2[] = new Array(f.len)

    let l = f.lFirst
    for (let i = 0; i < f.len; i++, l = l.next) {
        projverts[i] = mulV2M3V3(axisMat, co(l.v))
        center[0] += projverts[i][0]
        center[1] += projverts[i][1]
    }

    // first test for completely convex face
    if (isPolyConvexV2(projverts)) return

    center[0] *= 1 / f.len
    center[1] *= 1 / f.len

    const index = new Map<BMLoop, number>()
    l = f.lFirst
    for (let i = 0; i < f.len; i++, l = l.next) {
        index.set(l, i)
        // center the projection for maximum accuracy
        projverts[i][0] -= center[0]
        projverts[i][1] -= center[1]
    }

    // `edgeverts` alias `projverts` entries, so `EDGE_SHARE_VERT` compares identities as C compares pointers.
    const edgeverts: [Vec2, Vec2][] = new Array(len)
    for (let i = 0; i < len; i++) {
        edgeverts[i] = [projverts[index.get(loops[i][0]!)!], projverts[index.get(loops[i][1])!]]
    }

    // Check the split is inside the face, otherwise clear it.
    // Ensure the edge between the two corners of the face defines a line that lies within the face.
    for (let i = 0; i < len; i++) {
        // Compare the angles at the loops.
        const lPair = loops[i] as [BMLoop, BMLoop]
        const coPair: [Vec2, Vec2] = [projverts[index.get(lPair[0])!], projverts[index.get(lPair[1])!]]

        // Always allow cuts that overlap (unlikely but not an error).
        if (equalsV2V2(coPair[0], coPair[1])) continue

        const pairDir = normalizeV2Math([coPair[1][0] - coPair[0][0], coPair[1][1] - coPair[0][1]])
        for (let side = 0; side < 2; side++) {
            const c = coPair[side]
            let lPrev = lPair[side].prev
            let lNext = lPair[side].next

            // Account for zero length edges, not essential but they shouldn't break the calculation.
            {
                const limitInit = f.len - 3
                let limit = limitInit
                while (equalsV2V2(c, projverts[index.get(lPrev)!]) && limit-- > 0) lPrev = lPrev.prev
                limit = limitInit
                while (equalsV2V2(c, projverts[index.get(lNext)!]) && limit-- > 0) lNext = lNext.next
            }

            const coPrev = projverts[index.get(lPrev)!]
            const coNext = projverts[index.get(lNext)!]

            const dirOther: Vec2 = side === 0 ? pairDir : [-pairDir[0], -pairDir[1]]
            const dirPrev = normalizeV2Math([coPrev[0] - c[0], coPrev[1] - c[1]])
            const dirNext = normalizeV2Math([coNext[0] - c[0], coNext[1] - c[1]])

            if (angleSignedV2V2Pos(dirPrev, dirOther) > angleSignedV2V2Pos(dirPrev, dirNext)) {
                loops[i][0] = null
                break
            }
        }
    }

    const edgeShareVert = (e1: [Vec2, Vec2], e2: [Vec2, Vec2]) =>
        e1[0] === e2[0] || e1[0] === e2[1] || e1[1] === e2[0] || e1[1] === e2[1]

    // do line crossing tests
    for (let i = 0, iPrev = f.len - 1; i < f.len; iPrev = i++) {
        const fEdge: [Vec2, Vec2] = [projverts[iPrev], projverts[i]]
        for (let j = 0; j < len; j++) {
            if (loops[j][0] !== null && !edgeShareVert(fEdge, edgeverts[j])) {
                if (isectSegSegV2(fEdge[0], fEdge[1], edgeverts[j][0], edgeverts[j][1]) === ISECT_LINE_LINE_CROSS) {
                    loops[j][0] = null
                }
            }
        }
    }

    // self intersect tests
    for (let i = 0; i < len; i++) {
        if (loops[i][0]) {
            for (let j = i + 1; j < len; j++) {
                if (loops[j][0] !== null && !edgeShareVert(edgeverts[i], edgeverts[j])) {
                    if (isectSegSegV2(edgeverts[i][0], edgeverts[i][1], edgeverts[j][0], edgeverts[j][1]) ===
                        ISECT_LINE_LINE_CROSS) {
                        loops[i][0] = null
                        break
                    }
                }
            }
        }
    }
}

/**
 * `BM_face_splits_check_optimal` (`bmesh_polygon.cc:1458`): clear every cut for which `f` is not the
 * face {@link vertPairShareFaceByAngle} would pick for the pair.
 */
export function faceSplitsCheckOptimal(f: BMFace, loops: LoopPair[]): void {
    for (let i = 0; i < loops.length; i++) {
        const share = vertPairShareFaceByAngle(loops[i][0]!.v, loops[i][1].v, false)
        if (f !== (share ? share.f : null)) loops[i][0] = null
    }
}

/**
 * `BM_iter_elem_count_flag(BM_EDGES_OF_VERT, v, hflag, value)` (`bmesh_iterators.cc:269`): how many
 * edges around `v` have `hflag` set (`value`) or clear.
 */
export function vertEdgesCountFlag(v: BMVert, hflag: number, value: boolean): number {
    let count = 0
    for (const e of diskEdges(v)) {
        if (((e.hflag & hflag) !== 0) === value) count++
    }
    return count
}

/** `BM_select_history_htype_all` (`bmesh_marking.cc:1227`): the union of the history's element types. */
export function selectHistoryHtypeAll(bm: BMesh): number {
    let htypeSelected = 0
    for (const ese of bm.selectHistory) {
        htypeSelected |= ese.elem.htype
        // Early exit if all types found.
        if (htypeSelected === (ElemType.Vert | ElemType.Edge | ElemType.Face)) break
    }
    return htypeSelected
}

/** `count_bits_i` (`math_bits_inline.h`). */
function countBitsI(i: number): number {
    let n = 0
    for (let x = i >>> 0; x; x &= x - 1) n++
    return n
}

// endregion

// region bmo_connect.cc

/** Options of `bmesh.ops.connect_verts` (`bmesh_opdefines.cc:1320`). */
export interface ConnectVertsOptions {
    /** `faces_exclude`: input faces to explicitly exclude from connecting. */
    facesExclude?: Iterable<BMFace>
    /** `check_degenerate`: prevent splits with overlaps & intersections. Default false (slot default). */
    checkDegenerate?: boolean
}

/** Result of {@link connectVerts}. */
export interface ConnectVertsResult {
    /**
     * `edges.out`: the new edges (`EDGE_OUT`) plus existing edges that join two input vertices
     * (`EDGE_OUT_ADJ`), in mesh order.
     */
    edges: BMEdge[]
    /**
     * The `BMO_ERROR_FATAL` message "Could not connect vertices" when a face could not be split
     * (`bmo_connect.cc:210`), else null. The operator keeps going with the other faces, as Blender's does.
     */
    error: string | null
}

/** The `bmo_connect_verts_exec` operator flags, one Set each (`bmo_connect.cc:24`-`:32`). */
interface ConnectContext {
    vertInput: Set<BMVert>
    edgeOut: Set<BMEdge>
    edgeOutAdj: Set<BMEdge>
}

/**
 * `bm_face_connect_verts` (`bmo_connect.cc:34`): split one face between its input vertices. Pairs up
 * consecutive tagged corners (corners of an input vertex that is not in the middle of a run of input
 * vertices), filters the cuts with {@link faceSplitsCheckLegal} or {@link faceSplitsCheckOptimal}, and
 * splits along what remains, each split continuing in the newly made face. Returns 0 when there was
 * nothing to cut, 1 on success, -1 when a cut could not be made.
 */
function faceConnectVerts(bm: BMesh, f: BMFace, checkDegenerate: boolean, ctx: ConnectContext): number {
    const loopsSplit: LoopPair[] = []
    const vertsPair: [BMVert, BMVert][] = []

    let lTagPrev: BMLoop | null = null
    let lTagFirst: BMLoop | null = null
    let result = 1

    const lFirst = f.lFirst
    let lIter = lFirst
    do {
        if (ctx.vertInput.has(lIter.v) &&
            // Ensure this vertex isn't part of a contiguous group.
            (!ctx.vertInput.has(lIter.prev.v) || !ctx.vertInput.has(lIter.next.v))) {
            if (!lTagPrev) {
                lTagPrev = lTagFirst = lIter
                continue
            }

            if (!loopIsAdjacent(lTagPrev, lIter)) {
                const e = diskEdgeExists(lTagPrev.v, lIter.v)
                if (e === null || !ctx.edgeOut.has(e)) {
                    loopsSplit.push([lTagPrev, lIter])
                }
            }

            lTagPrev = lIter
        }
    } while ((lIter = lIter.next) !== lFirst)

    if (loopsSplit.length === 0) return 0

    if (!loopIsAdjacent(lTagFirst!, lTagPrev!) &&
        // ensure we don't add the same pair twice
        !(loopsSplit[0][0] === lTagFirst && loopsSplit[0][1] === lTagPrev)) {
        loopsSplit.push([lTagFirst!, lTagPrev!])
    }

    if (checkDegenerate) faceSplitsCheckLegal(f, loopsSplit)
    else faceSplitsCheckOptimal(f, loopsSplit)

    for (let i = 0; i < loopsSplit.length; i++) {
        if (loopsSplit[i][0] === null) continue
        vertsPair.push([loopsSplit[i][0]!.v, loopsSplit[i][1].v])
    }

    // Clear and re-use to store duplicate faces, to remove after splitting is finished.
    const deferredRemove: [BMLoop | null, BMLoop | null][] = []

    for (let i = 0; i < vertsPair.length; i++) {
        let fNew: BMFace | null
        let lNew: BMLoop | null

        // Note that duplicate edges in this case is very unlikely but it can happen, see #70287.
        const edgeExists = diskEdgeExists(vertsPair[i][0], vertsPair[i][1]) !== null
        const lPair: [BMLoop | null, BMLoop | null] = [null, null]
        if ((lPair[0] = faceVertShareLoop(f, vertsPair[i][0])) &&
            (lPair[1] = faceVertShareLoop(f, vertsPair[i][1]))) {
            const split = faceSplit(bm, f, lPair[0], lPair[1], undefined, edgeExists)
            fNew = split ? split.fNew : null
            lNew = split ? split.lNew : null

            // Check if duplicate faces have been created, store the loops for removal in this case.
            // Note that this matches how triangulate works (newly created duplicates get removed).
            if (edgeExists) {
                let deferred: [BMLoop | null, BMLoop | null] | null = null
                for (let j = 0; j < 2; j++) {
                    if (faceFindDouble(lPair[j]!.f)) {
                        if (deferred === null) {
                            deferred = [null, null]
                            deferredRemove.push(deferred)
                        }
                        deferred[j] = lPair[j]
                    }
                }
            }
        } else {
            fNew = null
            lNew = null
        }

        if (!lNew || !fNew) {
            result = -1
            break
        }

        f = fNew
        ctx.edgeOut.add(lNew.e!)
    }

    for (const pair of deferredRemove) {
        for (let j = 0; j < 2; j++) {
            if (pair[j] !== null) bm.faceKill(pair[j]!.f)
        }
    }

    return result
}

/**
 * The body of `bmo_connect_verts_exec` (`bmo_connect.cc:165`), without the top-level
 * `bmesh_edit_end`: `connect_vert_pair` runs it nested. Use {@link connectVerts} from outside.
 */
export function connectVertsExec(bm: BMesh, verts: Iterable<BMVert>, options: ConnectVertsOptions = {}): ConnectVertsResult {
    const checkDegenerate = options.checkDegenerate ?? false
    const ctx: ConnectContext = {vertInput: new Set(), edgeOut: new Set(), edgeOutAdj: new Set()}
    const faceTag = new Set<BMFace>()
    // `BLI_LINKSTACK`: pushed in order, popped from the top.
    const faces: BMFace[] = []
    let error: string | null = null

    // tag so we won't touch ever (typically hidden faces)
    const faceExclude = new Set(options.facesExclude ?? [])

    // add all faces connected to verts
    for (const v of verts) {
        ctx.vertInput.add(v)
        for (const lIter of loopsOfVert(v)) {
            const f = lIter.f
            if (!faceExclude.has(f)) {
                if (!faceTag.has(f)) {
                    faceTag.add(f)
                    if (f.len > 3) faces.push(f)
                }
            }

            // flag edges even if these are not newly created
            // this way cut-pairs that include co-linear edges will get
            // predictable output.
            if (ctx.vertInput.has(lIter.prev.v)) ctx.edgeOutAdj.add(lIter.prev.e!)
            if (ctx.vertInput.has(lIter.next.v)) ctx.edgeOutAdj.add(lIter.e!)
        }
    }

    // connect faces
    let f: BMFace | undefined
    while ((f = faces.pop())) {
        if (faceConnectVerts(bm, f, checkDegenerate, ctx) === -1) {
            error = 'Could not connect vertices'
        }
    }

    // `BMO_slot_buffer_from_enabled_flag(..., "edges.out", BM_EDGE, EDGE_OUT | EDGE_OUT_ADJ)`: mesh order.
    const edges: BMEdge[] = []
    for (const e of bm.edges) {
        if (ctx.edgeOut.has(e) || ctx.edgeOutAdj.has(e)) edges.push(e)
    }
    return {edges, error}
}

/**
 * `bmesh.ops.connect_verts`: split faces by adding edges that connect `verts`.
 *
 * Port of `bmo_connect_verts_exec` (`bmo_connect.cc:165`) run as a top-level operator, so followed by
 * `bmesh_edit_end` ({@link bmeshEditEnd}): every normal is recalculated and the selection
 * flushed by the select mode. Face normals must be current on entry when `checkDegenerate` is set
 * (`BM_face_splits_check_legal` projects on them), as they are in edit mode.
 */
export function connectVerts(bm: BMesh, verts: Iterable<BMVert>, options: ConnectVertsOptions = {}): ConnectVertsResult {
    const result = connectVertsExec(bm, verts, options)
    bmeshEditEnd(bm, EDIT_END_FLAGS)
    return result
}

// endregion

// region editmesh_tools.cc - Vertex Connect, Vertex Connect Path

/** Result of the edit-mode connect operators. */
export type VertConnectResult =
    | {
        ok: true
        /**
         * The operator's `edges.out` (new edges and edges that already joined two connected
         * vertices). Empty when Vertex Connect Path connected only by wire edges or did nothing.
         */
        edges: BMEdge[]
    }
    | {
        ok: false
        /** Blender's report (or, where Blender cancels silently, the operator's own BMO message). */
        error: string
        /**
         * True only when Blender would restore the mesh from the redo backup it took before running
         * (`EDBM_redo_state_store`, `editmesh_tools.cc:1257`; restored by
         * `EDBM_redo_state_restore_and_free` at `:1277`): a face split failed part way. The kernel has
         * no in-place BMesh snapshot, so the caller restores from its own undo snapshot.
         */
        meshChanged: boolean
    }

const isFaceVisible = (f: BMFace) => !(f.hflag & ElemFlag.Hidden)

/**
 * `edbm_connect_vert_pair` (`editmesh_tools.cc:1194`): connect the selected vertices. Two vertices
 * that share no visible face are joined by `connect_vert_pair` (a cut across faces) and the cut
 * selected; otherwise `connect_verts` splits the faces between them - without the degenerate check
 * when the first two selected vertices share a visible face. Hidden vertices and faces are excluded.
 * Returns the `edges.out` count Blender returns as `len`, and the edges.
 */
function edbmConnectVertPair(bm: BMesh): {len: number, edges: BMEdge[], restored: boolean} {
    const vertsLen = bm.totvertsel
    let isPair = vertsLen === 2
    let checkDegenerate = true

    // sanity check
    if (vertsLen < 2) return {len: 0, edges: [], restored: false}

    const verts: BMVert[] = []
    for (const v of bm.verts) {
        if (v.hflag & ElemFlag.Select) verts.push(v)
    }

    if (vertPairShareFaceCheckCb(verts[0], verts[1], isFaceVisible)) {
        checkDegenerate = false
        isPair = false
    }

    // Edit mode keeps normals current; the kernel does not, so make them so (`BM_mesh_normals_update`).
    normalsUpdate(bm)

    let result: ConnectVertsResult
    if (isPair) {
        // "connect_vert_pair verts=%eb verts_exclude=%hv faces_exclude=%hf"
        result = connectVertPairExec(bm, [verts[0], verts[1]], {
            vertsExclude: [...bm.verts].filter(v => v.hflag & ElemFlag.Hidden),
            facesExclude: [...bm.faces].filter(f => f.hflag & ElemFlag.Hidden),
        })
    } else {
        // "connect_verts verts=%eb faces_exclude=%hf check_degenerate=%b"
        result = connectVertsExec(bm, verts, {
            facesExclude: [...bm.faces].filter(f => f.hflag & ElemFlag.Hidden),
            checkDegenerate,
        })
    }
    bmeshEditEnd(bm, EDIT_END_FLAGS)

    const failure = result.error !== null
    let len = result.edges.length

    if (len && isPair) {
        // new verts have been added, we have to select the edges, not just flush
        elemsHflagEnable(bm, result.edges, ElemType.Edge, ElemFlag.Select, true)
    }

    // `EDBM_op_finish` only fails on `BMO_ERROR_CANCEL`, which neither operator raises.
    if (failure) {
        // `EDBM_redo_state_restore_and_free`: see `VertConnectResult.meshChanged`.
        return {len: 0, edges: [], restored: true}
    }
    // so newly created edges get the selection state from the vertex
    selectModeFlush(bm) // `EDBM_selectmode_flush`
    return {len, edges: result.edges, restored: false}
}

/**
 * Vertex Connect (`MESH_OT_vert_connect`, "Connect selected vertices of faces, splitting the face"):
 * port of `edbm_vert_connect_exec` (`editmesh_tools.cc:1302`) for one mesh, which is
 * `edbm_connect_vert_pair` (see {@link edbmConnectVertPair}). The operator has no properties.
 *
 * Blender cancels without a report when nothing was connected; the error here is the message its
 * `connect_verts` raises for the same outcome.
 */
export function vertConnectSelection(bm: BMesh): VertConnectResult {
    const r = edbmConnectVertPair(bm)
    if (!r.len) return {ok: false, error: 'Could not connect vertices', meshChanged: r.restored}
    return {ok: true, edges: r.edges}
}

/**
 * `bm_vert_is_select_history_open` (`editmesh_tools.cc:1345`): the history starts and ends with a
 * vertex, and each end has exactly one selected edge.
 */
function vertIsSelectHistoryOpen(bm: BMesh): boolean {
    const eleA = bm.selectHistory[0]
    const eleB = bm.selectHistory[bm.selectHistory.length - 1]
    if (eleA.elem instanceof BMVert && eleB.elem instanceof BMVert) {
        if (vertEdgesCountFlag(eleA.elem, ElemFlag.Select, true) === 1 &&
            vertEdgesCountFlag(eleB.elem, ElemFlag.Select, true) === 1) {
            return true
        }
    }
    return false
}

/**
 * `bm_vert_connect_pair` (`editmesh_tools.cc:1363`): run `connect_vert_pair` as a top-level operator
 * and select its `edges.out`. With `skipNormals` the caller has already set both vertex normals.
 * Returns whether any edge was added; `edges` collects the outputs.
 */
function vertConnectPair(bm: BMesh, vA: BMVert, vB: BMVert, edgesOut: BMEdge[], skipNormals = false): boolean {
    const totedgeOrig = bm.totedge

    const verts: [BMVert, BMVert] = [vA, vB]

    // Note that normals may be overridden when connecting more than 2 vertices.
    if (!skipNormals) {
        bmVertNormalUpdate(verts[0])
        bmVertNormalUpdate(verts[1])
    }

    const result = connectVertPairExec(bm, verts, {})
    bmeshEditEnd(bm, EDIT_END_FLAGS)
    elemsHflagEnable(bm, result.edges, ElemType.Edge, ElemFlag.Select, true)
    edgesOut.push(...result.edges)
    return bm.totedge !== totedgeOrig
}

/**
 * `bm_vert_connect_select_history` (`editmesh_tools.cc:1390`). The logic, as Blender states it:
 * - If there are any isolated/wire verts - connect as edges.
 * - Otherwise connect faces.
 * - If all edges have been created already, closed the loop.
 */
function vertConnectSelectHistory(bm: BMesh, edgesOut: BMEdge[]): boolean {
    const hist = bm.selectHistory
    if (hist.length >= 2 && bm.totvertsel > 2) {
        let tot = 0
        let changed = false
        let hasWire = false

        // ensure all verts have history
        for (const ese of hist) {
            if (!(ese.elem instanceof BMVert)) break
            const v = ese.elem
            if (!hasWire && (v.e === null || vertIsWire(v))) hasWire = true
            tot++
        }

        if (!hasWire) {
            // all verts have faces , connect verts via faces!
            if (tot === bm.totvertsel) {
                const origNormals = new Map<BMVert, Vec3>()

                // Connecting more than 2 vertices can change the mesh normal state, which can break
                // symmetry in cases where it is expected so we store the original normals to restore
                // later before connecting. See #154197
                const isMultiCut = bm.totvertsel > 2
                if (isMultiCut) {
                    for (const ese of hist) {
                        const v = ese.elem as BMVert
                        bmVertNormalUpdate(v)
                        origNormals.set(v, [v.nx, v.ny, v.nz])
                    }
                }

                for (let i = 1; i < hist.length; i++) {
                    const vLast = hist[i - 1].elem as BMVert
                    const vCurr = hist[i].elem as BMVert
                    if (diskEdgeExists(vLast, vCurr)) {
                        // pass, edge exists (and will be selected)
                    } else {
                        if (isMultiCut) {
                            const nLast = origNormals.get(vLast)!
                            const nCurr = origNormals.get(vCurr)!
                            vLast.nx = nLast[0]
                            vLast.ny = nLast[1]
                            vLast.nz = nLast[2]
                            vCurr.nx = nCurr[0]
                            vCurr.ny = nCurr[1]
                            vCurr.nz = nCurr[2]
                        }
                        changed = vertConnectPair(bm, vLast, vCurr, edgesOut, isMultiCut) || changed
                    }
                }

                if (changed) return true
            }

            if (!changed) {
                // existing loops: close the selection
                if (vertIsSelectHistoryOpen(bm)) {
                    changed = vertConnectPair(bm,
                        bm.selectHistory[0].elem as BMVert,
                        bm.selectHistory[bm.selectHistory.length - 1].elem as BMVert,
                        edgesOut) || changed

                    if (changed) return true
                }
            }
        } else {
            // no faces, simply connect the verts by edges
            for (let i = 1; i < hist.length; i++) {
                const vPrev = hist[i - 1].elem as BMVert
                const vCurr = hist[i].elem as BMVert
                if (diskEdgeExists(vPrev, vCurr)) {
                    // pass, edge exists (and will be selected)
                } else {
                    const e = bm.edgeCreate(vPrev, vCurr)
                    edgeSelectSet(bm, e, true)
                    changed = true
                }
            }

            if (!changed) {
                // existing loops: close the selection
                if (vertIsSelectHistoryOpen(bm)) {
                    const e = bm.edgeCreate(
                        bm.selectHistory[0].elem as BMVert,
                        bm.selectHistory[bm.selectHistory.length - 1].elem as BMVert)
                    edgeSelectSet(bm, e, true)
                }
            }

            return true
        }
    }

    return false
}

/**
 * `bm_vert_connect_select_history_edge_to_vert_path` (`editmesh_tools.cc:1533`): convert an edge
 * selection history into a vertex path - two ordered loops, the first edge ending up in the middle -
 * for use as a path to connect. Returns the vertex history, or null when the history is not all
 * edges or does not cover every selected edge. Leaves `bm.selectHistory` as it was.
 */
function vertConnectSelectHistoryEdgeToVertPath(bm: BMesh): BMSelectHistoryEntry[] | null {
    let edgesLen = 0
    let side = false

    // first check all edges are OK
    for (const ese of bm.selectHistory) {
        if (ese.elem instanceof BMEdge) edgesLen += 1
        else return null
    }
    // if this is a mixed selection, bail out!
    if (bm.totedgesel !== edgesLen) return null

    const selectedOrig = bm.selectHistory
    const selected: BMSelectHistoryEntry[] = []

    // convert edge selection into 2 ordered loops (where the first edge ends up in the middle)
    for (let i = 0; i < selectedOrig.length; i++) {
        const eCurr = selectedOrig[i].elem as BMEdge
        const ePrev = i > 0 ? selectedOrig[i - 1].elem as BMEdge : null

        if (ePrev) {
            const share = edgePairShareFaceByLen(eCurr, ePrev, true)
            if (share) {
                if ((eCurr.v1 !== share.lA.v) === (ePrev.v1 !== share.lB.v)) side = !side
            } else if (isQuadFlipV3(co(eCurr.v1), co(eCurr.v2), co(ePrev.v2), co(ePrev.v1))) {
                side = !side
            }
        }

        let v = side ? eCurr.v2 : eCurr.v1
        if (!selected.length || selected[selected.length - 1].elem !== v) {
            // `BM_select_history_store_notest`
            selected.push({elem: v})
        }

        v = side ? eCurr.v1 : eCurr.v2
        if (!selected.length || selected[0].elem !== v) {
            // `BM_select_history_store_head_notest`
            selected.unshift({elem: v})
        }
    }

    return selected
}

/**
 * Vertex Connect Path (`MESH_OT_vert_connect_path`, "Connect vertices by their selection order,
 * creating edges, splitting faces"; the J key): port of `edbm_vert_connect_path_exec`
 * (`editmesh_tools.cc:1599`) for one mesh. The operator has no properties.
 *
 * - Exactly two selected vertices: Vertex Connect ({@link vertConnectSelection}), order ignored.
 * - Otherwise the select history is the path. A history of edges is first converted to a vertex
 *   path. Consecutive vertices are joined by `connect_vert_pair` (cuts across faces), or by new wire
 *   edges when any of them is loose or wire-only; when every consecutive pair is already joined and
 *   the path is open, its two ends are joined instead.
 * - The history is left as it was (an edge history is restored after the conversion), validated by
 *   the final select-mode flush.
 *
 * Nothing selected finishes without doing anything, as Blender's does.
 */
export function vertConnectPathSelection(bm: BMesh): VertConnectResult {
    const isPair = bm.totvertsel === 2

    if (bm.totvertsel === 0) return {ok: true, edges: []}

    // when there is only 2 vertices, we can ignore selection order
    if (isPair) {
        const r = edbmConnectVertPair(bm)
        if (!r.len) return {ok: false, error: 'Could not connect vertices', meshChanged: r.restored}
        return {ok: true, edges: r.edges}
    }

    // Skip mixed selections since path handling only supports uniform types, see #147150.
    const htypeSelected = selectHistoryHtypeAll(bm)
    if (countBitsI(htypeSelected) > 1) {
        return {ok: false, error: 'Could not connect mixed selection types', meshChanged: false}
    }
    // Faces are not supported, this check is only done to show a more useful error.
    if (htypeSelected & ElemType.Face) {
        return {ok: false, error: 'Could not connect a face selection', meshChanged: false}
    }

    let selectedOrig: BMSelectHistoryEntry[] = []
    if (bm.selectHistory.length) {
        const ese = bm.selectHistory[0]
        if (ese.elem instanceof BMEdge) {
            const path = vertConnectSelectHistoryEdgeToVertPath(bm)
            if (path) {
                // `std::swap(bm->selected, selected_orig)`
                selectedOrig = bm.selectHistory
                bm.selectHistory = path
            }
        }
    }

    // Edit mode keeps normals current; the kernel does not, so make them so (`BM_mesh_normals_update`).
    normalsUpdate(bm)

    const edges: BMEdge[] = []
    let ok: boolean
    if (vertConnectSelectHistory(bm, edges)) {
        selectModeFlush(bm) // `EDBM_selectmode_flush`
        ok = true
    } else {
        ok = false
    }

    if (selectedOrig.length) {
        // `BM_select_history_clear(bm); bm->selected = selected_orig;`
        bm.selectHistory = selectedOrig
    }

    if (!ok) return {ok: false, error: 'Invalid selection order', meshChanged: false}
    // `edges.out` of every pair, without the edges that a later split replaced.
    return {ok: true, edges: edges.filter((e, i) => bm.edges.has(e) && edges.indexOf(e) === i)}
}

// endregion
