/**
 * Beautify Fill: rotate the edges between triangles until no rotation makes the triangles better
 * shaped, and the edge rotation it is built on.
 *
 * Ported from `source/blender/bmesh/operators/bmo_beautify.cc` (`bmo_beautify_fill_exec`),
 * `bmesh/tools/bmesh_beautify.cc` (`BM_mesh_beautify_fill`, `BM_verts_calc_rotate_beauty` and the
 * rotation-state bookkeeping), the area cost of `blenlib/intern/polyfill_2d_beautify.cc`
 * (`BLI_polyfill_beautify_quad_rotate_calc_ex`, `BLI_polyfill_edge_calc_rotate_beauty__area`) and
 * `bmesh/intern/bmesh_mods.cc:607-888` (`BM_edge_rotate` with `BM_edge_calc_rotate`,
 * `BM_edge_rotate_check`, `_check_degenerate`, `_check_beauty`). Bridge Edge Loops runs it on the
 * triangles it makes between loops of different lengths.
 *
 * The operator flags (`ELE_NEW`, `FACE_MARK`) are `Set`s. `VERT_RESTRICT_TAG` reads the vertices'
 * `ElemFlag.Tag`, the shared header bit the caller sets, as in Blender. The rotation states are keyed
 * by `BM_elem_index_get` of the vertices, i.e. `head.index` - valid because every operator call
 * re-indexes the mesh (`BMO_push`, see `bmoOpExec` in `subdivideEdgering.ts`).
 */

import {BMEdge, BMFace, BMLoop, BMVert} from '../bmesh/types'
import {BMesh} from '../bmesh/BMesh'
import {diskEdgeExists} from '../bmesh/structure'
import {faceNormalFlip} from '../bmesh/flip'
import {faceSplit} from '../bmesh/mods'
import {faceEdgeShareLoop} from '../bmesh/euler'
import {faceOtherVertLoop, faceVertShareLoop} from '../bmesh/walkers'
import {edgeFacePair, FacesJoinDouble, facesJoinPair} from './dissolve'
import {edgeIsContiguous} from './dissolveLimit'
import {ElemFlag} from '../constants'
import {Vec3, v3cross, v3dot, v3sub} from '../math'
import {
    Vec2, angleNormalizedV3V3, axisDominantV3ToM3, crossTriV2, crossTriV3, lenSquaredV3V3, lenV2, mulV2M3V3,
    normalizeV3Len, subV2V2,
} from '../math/geom'
import {Heap, HeapNode} from '../math/heap'
import {BmeshEditEndFlags} from './edgenet'
import {bmoOpExec} from './subdivideEdgering'

const co = (v: BMVert): Vec3 => [v.x, v.y, v.z]

/** `FLT_MAX`. */
export const FLT_MAX = 3.4028234663852886e38

// region helpers (bmesh_query, generic - exported for reuse)

/** `BM_edge_ordered_verts` (`bmesh_query.cc:1155`): the edge's vertices in `e->l`'s winding. */
export function edgeOrderedVerts(e: BMEdge): [BMVert, BMVert] {
    const l = e.l!
    return [l.v, l.next.v]
}

// endregion

// region BM_edge_rotate (bmesh_mods.cc:607-888)

/** `eBMEdgeRotateFlag` (`bmesh_mods.hh:268`). */
export const BM_EDGEROT_CHECK_EXISTS = 1 << 0
export const BM_EDGEROT_CHECK_SPLICE = 1 << 1
export const BM_EDGEROT_CHECK_DEGENERATE = 1 << 2
export const BM_EDGEROT_CHECK_BEAUTY = 1 << 3

/**
 * `BM_edge_calc_rotate` (`bmesh_mods.cc:607`): the two loops whose vertices the rotated edge would
 * join, or null when the faces share more than this edge next to it.
 */
export function edgeCalcRotate(e: BMEdge, ccw: boolean): [BMLoop, BMLoop] | null {
    // we know this will work
    let [fa, fb] = edgeFacePair(e)!
    // so we can use `ccw` variable correctly, otherwise we could use the edges verts direct
    const [v1, v2] = edgeOrderedVerts(e)
    // we could swap the verts _or_ the faces, swapping faces gives more predictable results since
    // that way the next vert just stitches from face fa / fb
    if (!ccw) [fa, fb] = [fb, fa]
    const l1 = faceOtherVertLoop(fb, v2, v1)!
    const l2 = faceOtherVertLoop(fa, v1, v2)!
    // This occurs when faces share multiple edges next to `e`.
    if (l1.v === l2.v) return null
    return [l1, l2]
}

/** `BM_edge_rotate_check` (`bmesh_mods.cc:641`): manifold, and rotating can produce a valid edge. */
export function edgeRotateCheck(e: BMEdge): boolean {
    const pair = edgeFacePair(e)
    if (pair) {
        const [fa, fb] = pair
        let la = faceOtherVertLoop(fa, e.v2, e.v1)!
        let lb = faceOtherVertLoop(fb, e.v2, e.v1)!
        // check that the next vert in both faces isn't the same (ie - the next edge doesn't share the
        // same faces). since we can't rotate usefully in this case.
        if (la.v === lb.v) return false
        // mirror of the check above but in the opposite direction
        la = faceOtherVertLoop(fa, e.v1, e.v2)!
        lb = faceOtherVertLoop(fb, e.v1, e.v2)!
        if (la.v === lb.v) return false
        return true
    }
    return false
}

/** `BM_edge_rotate_check_degenerate` (`bmesh_mods.cc:670`): would the rotation flip a face? */
export function edgeRotateCheckDegenerate(e: BMEdge, l1: BMLoop, l2: BMLoop): boolean {
    // NOTE: for these vars 'old' just means initial edge state.
    // original verts - these will be in the edge 'e'
    const [v1Old, v2Old] = edgeOrderedVerts(e)
    // verts from the loops passed
    const v1 = l1.v
    const v2 = l2.v
    // get the next vert along
    const v1Alt = faceOtherVertLoop(l1.f, v1Old, v1)!.v
    const v2Alt = faceOtherVertLoop(l2.f, v2Old, v2)!.v

    // normalize all so comparisons are scale independent
    // old and new edge vecs
    const edDirOld = v3sub(co(v1Old), co(v2Old))
    const edDirNew = v3sub(co(v1), co(v2))
    normalizeV3Len(edDirOld)
    normalizeV3Len(edDirNew)
    // old edge corner vecs
    const edDirV1Old = v3sub(co(v1Old), co(v1))
    const edDirV2Old = v3sub(co(v2Old), co(v2))
    normalizeV3Len(edDirV1Old)
    normalizeV3Len(edDirV2Old)
    // old edge corner vecs
    const edDirV1New = v3sub(co(v1), co(v1Alt))
    const edDirV2New = v3sub(co(v2), co(v2Alt))
    normalizeV3Len(edDirV1New)
    normalizeV3Len(edDirV2New)

    // compare
    let crossOld = v3cross(edDirOld, edDirV1Old)
    let crossNew = v3cross(edDirNew, edDirV1New)
    if (v3dot(crossOld, crossNew) < 0) return false // does this flip?
    crossOld = v3cross(edDirOld, edDirV2Old)
    crossNew = v3cross(edDirNew, edDirV2New)
    if (v3dot(crossOld, crossNew) < 0) return false // does this flip?

    const edDirNewFlip: Vec3 = [-edDirNew[0], -edDirNew[1], -edDirNew[2]]
    // result is zero area corner
    if (v3dot(edDirNew, edDirV1New) > 0.999 || v3dot(edDirNewFlip, edDirV2New) > 0.999) return false
    return true
}

/** `BM_edge_rotate_check_beauty` (`bmesh_mods.cc:758`): the rotated edge is the shorter diagonal. */
export function edgeRotateCheckBeauty(e: BMEdge, l1: BMLoop, l2: BMLoop): boolean {
    // Stupid check for now: Could compare angles of surrounding edges before & after, but this is OK.
    return lenSquaredV3V3(co(e.v1), co(e.v2)) > lenSquaredV3V3(co(l1.v), co(l2.v))
}

/**
 * `BM_edge_rotate` (`bmesh_mods.cc:766`): spin a manifold edge to join the other two corners of its
 * two faces. Returns the new edge, or null when a check fails (nothing changed) or the re-split fails
 * after the join (the faces stay joined, as in Blender).
 *
 */
export function edgeRotate(bm: BMesh, e: BMEdge, ccw: boolean, checkFlag: number): BMEdge | null {
    if (!edgeRotateCheck(e)) return null
    const calc = edgeCalcRotate(e, ccw)
    if (!calc) return null
    let [l1, l2] = calc

    // the loops will be freed so assign verts
    const v1 = l1.v
    const v2 = l2.v

    // Checking Code - make sure we can rotate
    if (checkFlag & BM_EDGEROT_CHECK_BEAUTY) {
        if (!edgeRotateCheckBeauty(e, l1, l2)) return null
    }
    // check before applying
    if (checkFlag & BM_EDGEROT_CHECK_EXISTS) {
        if (diskEdgeExists(v1, v2)) return null
    }
    // slowest, check last
    if (checkFlag & BM_EDGEROT_CHECK_DEGENERATE) {
        if (!edgeRotateCheckDegenerate(e, l1, l2)) return null
    }

    // Rotate The Edge
    // first create the new edge, this is so we can copy the customdata from the old one
    // if splice if disabled, always add in a new edge even if there's one there.
    const eNew = bm.edgeCreate(v1, v2, e, {noDouble: (checkFlag & BM_EDGEROT_CHECK_SPLICE) !== 0})

    const fHflagPrev1 = l1.f.hflag
    const fHflagPrev2 = l2.f.hflag

    // maintain active face
    let fActivePrev = 0
    if (bm.actFace === l1.f) fActivePrev = 1
    else if (bm.actFace === l2.f) fActivePrev = 2

    const isFlipped = !edgeIsContiguous(e)

    // don't delete the edge, manually remove the edge after so we can copy its attributes
    const fDouble: FacesJoinDouble = {double: null}
    const f = facesJoinPair(bm, faceEdgeShareLoop(l1.f, e)!, faceEdgeShareLoop(l2.f, e)!, true, fDouble)
    if (f === null) return null

    // NOTE: this assumes joining the faces _didnt_ also remove the verts.
    const la = faceVertShareLoop(f, v1)
    const lb = faceVertShareLoop(f, v2)
    if (la && lb && faceSplit(bm, f, la, lb, undefined, true)) {
        l1 = la
        l2 = lb
        // we should really be able to know the faces some other way, rather than fetching them back
        // from the edge, but this is predictable where using the return values from face split isn't.
        const pair = edgeFacePair(eNew)
        if (pair) {
            const [fa, fb] = pair
            fa.hflag = fHflagPrev1
            fb.hflag = fHflagPrev2

            if (fActivePrev === 1) bm.actFace = fa
            else if (fActivePrev === 2) bm.actFace = fb

            if (isFlipped) {
                faceNormalFlip(fb)
                // Needed otherwise `ccw` toggles direction
                if (ccw) eNew.l = eNew.l!.radialNext
            }
        }
    } else {
        // See `BM_faces_join` note on callers asserting when `r_double` is non-null. Checked here
        // because a double is acceptable as long as its temporary. (`BLI_assert_msg(f_double ==
        // nullptr, ...)` - a debug-build assertion only.)
        return null
    }

    return eNew
}

// endregion

// region beautify (bmesh_beautify.cc, polyfill_2d_beautify.cc, bmo_beautify.cc)

/** `VERT_RESTRICT_TAG` / `EDGE_RESTRICT_DEGENERATE` (`bmesh_beautify.hh:17`). */
export const VERT_RESTRICT_TAG = 1 << 0
export const EDGE_RESTRICT_DEGENERATE = 1 << 1

/** `signum_i_ex` (`math_base_inline.cc:541`). */
function signumIEx(a: number, eps: number): number {
    if (a > eps) return 1
    if (a < -eps) return -1
    return 0
}

/**
 * `BLI_polyfill_beautify_quad_rotate_calc_ex` (`polyfill_2d_beautify.cc:89`): negative when the
 * (1-3) diagonal of the 2D quad beats the current (2-4) one, by area over perimeter; `FLT_MAX` when
 * (1-3) is unusable, `-FLT_MAX` when (2-4) is.
 */
export function polyfillBeautifyQuadRotateCalcEx(
    v1: Vec2, v2: Vec2, v3: Vec2, v4: Vec2, lockDegenerate: boolean, rArea: {area: number} | null,
): number {
    // not a loop (only to be able to break out)
    do {
        // Allow very small faces to be considered non-zero.
        const epsZeroArea = 1e-12
        const area2x234 = crossTriV2(v2, v3, v4)
        const area2x241 = crossTriV2(v2, v4, v1)

        const area2x123 = crossTriV2(v1, v2, v3)
        const area2x134 = crossTriV2(v1, v3, v4)

        if (rArea) {
            rArea.area = (Math.abs(area2x234) + Math.abs(area2x241)
                // Include both pairs for predictable results.
                + Math.abs(area2x123) + Math.abs(area2x134)) / 8.0
        }

        // Test for unusable (1-3) state.
        // - Area sign flipping to check faces aren't going to point in opposite directions.
        // - Area epsilon check that the one of the faces won't be zero area.
        if ((area2x123 >= 0) !== (area2x134 >= 0)) break
        if (Math.abs(area2x123) <= epsZeroArea || Math.abs(area2x134) <= epsZeroArea) break

        // Test for unusable (2-4) state (same as above).
        if ((area2x234 >= 0) !== (area2x241 >= 0)) {
            if (lockDegenerate) break
            return -FLT_MAX // always rotate
        }
        if (Math.abs(area2x234) <= epsZeroArea || Math.abs(area2x241) <= epsZeroArea) {
            return -FLT_MAX // always rotate
        }

        {
            // testing rule: the area divided by the perimeter, check if (1-3) beats the existing
            // (2-4) edge rotation
            // edges around the quad
            const len12 = lenV2(subV2V2(v1, v2))
            const len23 = lenV2(subV2V2(v2, v3))
            const len34 = lenV2(subV2V2(v3, v4))
            const len41 = lenV2(subV2V2(v4, v1))
            // edges crossing the quad interior
            const len13 = lenV2(subV2V2(v1, v3))
            const len24 = lenV2(subV2V2(v2, v4))

            // NOTE: area is in fact (area * 2), but in this case its OK, since we're comparing ratios

            // edge (2-4), current state
            let areaA = Math.abs(area2x234)
            let areaB = Math.abs(area2x241)
            let primA = len23 + len34 + len24
            let primB = len41 + len12 + len24
            const fac24 = (areaA / primA) + (areaB / primB)

            // edge (1-3), new state
            areaA = Math.abs(area2x123)
            areaB = Math.abs(area2x134)
            primA = len12 + len23 + len13
            primB = len34 + len41 + len13
            const fac13 = (areaA / primA) + (areaB / primB)

            // negative number if (1-3) is an improved state
            return fac24 - fac13
        }
    } while (false)

    return FLT_MAX
}

/**
 * `BLI_polyfill_edge_calc_rotate_beauty__area` (`polyfill_2d_beautify.cc:182`): the quad projected
 * onto the plane of its two triangles' summed normal, then
 * {@link polyfillBeautifyQuadRotateCalcEx}. `FLT_MAX` for a degenerate or already flipped pair.
 */
export function polyfillEdgeCalcRotateBeautyArea(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3, lockDegenerate: boolean): number {
    // not a loop (only to be able to break out)
    do {
        let v1xy: Vec2, v2xy: Vec2, v3xy: Vec2, v4xy: Vec2
        // first get the 2d values
        {
            const eps = 1e-5
            const noA = crossTriV3(v2, v3, v4)
            const noB = crossTriV3(v2, v4, v1)
            const no: Vec3 = [noA[0] + noB[0], noA[1] + noB[1], noA[2] + noB[2]]
            const noScale = normalizeV3Len(no)
            if (noScale === 0) break

            const axisMat = axisDominantV3ToM3(no)
            v1xy = mulV2M3V3(axisMat, v1)
            v2xy = mulV2M3V3(axisMat, v2)
            v3xy = mulV2M3V3(axisMat, v3)
            v4xy = mulV2M3V3(axisMat, v4)

            // Check if input faces are already flipped. Accept (1, 1) / (-1, -1) / (-1/1, 0);
            // ignore (-1, 1) and (0, 0). The cross product is divided by 'no_scale' so the rotation
            // calculation is scale independent.
            if (!(signumIEx(crossTriV2(v2xy, v3xy, v4xy) / noScale, eps)
                + signumIEx(crossTriV2(v2xy, v4xy, v1xy) / noScale, eps))) {
                break
            }
        }

        // Important to lock degenerate here, since the triangle pars will be projected into
        // different 2D spaces. Allowing to rotate out of a degenerate state can flip the faces (when
        // performed iteratively).
        return polyfillBeautifyQuadRotateCalcEx(v1xy, v2xy, v3xy, v4xy, lockDegenerate, null)
    } while (false)

    return FLT_MAX
}

/** `normal_tri_v3` (`math_geom.cc:45`) returning the normal and the length it had. */
function normalTriV3Len(v1: Vec3, v2: Vec3, v3: Vec3): [Vec3, number] {
    const n = crossTriV3(v1, v2, v3)
    const len = normalizeV3Len(n)
    return [n, len]
}

/** `bm_edge_calc_rotate_beauty__angle` (`bmesh_beautify.cc:143`). */
function edgeCalcRotateBeautyAngle(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3): number {
    // not a loop (only to be able to break out)
    do {
        // edge (2-4), current state
        let [noA] = normalTriV3Len(v2, v3, v4)
        let [noB] = normalTriV3Len(v2, v4, v1)
        const angle24 = angleNormalizedV3V3(noA, noB)

        // edge (1-3), new state
        // only check new state for degenerate outcome
        let lenA: number, lenB: number
        [noA, lenA] = normalTriV3Len(v1, v2, v3)
        if (lenA === 0) break
        [noB, lenB] = normalTriV3Len(v1, v3, v4)
        if (lenB === 0) break
        const angle13 = angleNormalizedV3V3(noA, noB)

        return angle13 - angle24
    } while (false)

    return FLT_MAX
}

/**
 * `BM_verts_calc_rotate_beauty` (`bmesh_beautify.cc:171`): the cost of rotating the (2-4) diagonal of
 * the quad `v1 v2 v3 v4` to (1-3); negative is an improvement. `method` 0 is by area
 * (`BLI_polyfill_edge_calc_rotate_beauty__area`), otherwise by angle. With `VERT_RESTRICT_TAG`, only
 * a rotation joining a tagged and an untagged vertex (`ElemFlag.Tag`) is allowed.
 */
export function vertsCalcRotateBeauty(v1: BMVert, v2: BMVert, v3: BMVert, v4: BMVert, flag: number, method: number): number {
    // not a loop (only to be able to break out)
    do {
        if (flag & VERT_RESTRICT_TAG) {
            const vA = v1, vB = v3
            if (vA.testFlag(ElemFlag.Tag) === vB.testFlag(ElemFlag.Tag)) break
        }
        if (v1 === v3) break
        switch (method) {
        case 0:
            return polyfillEdgeCalcRotateBeautyArea(co(v1), co(v2), co(v3), co(v4), (flag & EDGE_RESTRICT_DEGENERATE) !== 0)
        default:
            return edgeCalcRotateBeautyAngle(co(v1), co(v2), co(v3), co(v4))
        }
    } while (false)
    return FLT_MAX
}

/** `bm_edge_calc_rotate_beauty` (`bmesh_beautify.cc:204`). */
function edgeCalcRotateBeauty(e: BMEdge, flag: number, method: number): number {
    const l = e.l!
    const v1 = l.prev.v // First vert co
    const v2 = l.v // `e->v1` or `e->v2`.
    const v3 = l.radialNext!.prev.v // Second vert co
    const v4 = l.next.v // `e->v1` or `e->v2`.
    return vertsCalcRotateBeauty(v1, v2, v3, v4, flag, method)
}

/**
 * `erot_state_ex` (`bmesh_beautify.cc:112`) as a key: the edge's vertex indices and the two opposite
 * corners' (`BM_elem_index_get`, so whatever `head.index` holds, as in Blender), each pair ordered.
 * `alternate` swaps the roles (`erot_state_alternate`).
 */
function erotStateKey(e: BMEdge, alternate: boolean): string {
    const l = e.l!
    let v0 = e.v1.index, v1 = e.v2.index
    if (v0 > v1) [v0, v1] = [v1, v0]
    let f0 = l.prev.v.index, f1 = l.radialNext!.prev.v.index
    if (f0 > f1) [f0, f1] = [f1, f0]
    return alternate ? `${f0},${f1},${v0},${v1}` : `${v0},${v1},${f0},${f1}`
}

/**
 * `BM_mesh_beautify_fill` (`bmesh_beautify.cc:302`): rotate the edges of `edgeArray` (manifold edges
 * between triangles) best-first off a heap until no rotation improves, remembering each edge's past
 * states so it cannot cycle. Rotated edges go into `oflagEdge`, their faces into each of `oflagFace`
 * (Blender's `BMO_*_flag_enable` with the caller's flags). `edgeArray` is updated in place, and each
 * edge's `index` is set to its slot (Blender's `BM_elem_index_set`, "set_dirty").
 */
export function meshBeautifyFill(
    bm: BMesh, edgeArray: BMEdge[], flag: number, method: number,
    oflagEdge: Set<BMEdge> | null, oflagFace: Set<BMFace>[],
): void {
    const edgeArrayLen = edgeArray.length
    const edgeStateArr: Set<string>[] = Array.from({length: edgeArrayLen}, () => new Set<string>())
    const eheap = new Heap<BMEdge>()
    const eheapTable: (HeapNode<BMEdge> | null)[] = new Array(edgeArrayLen).fill(null)

    /** `edge_in_array` (`:218`). */
    const edgeInArray = (e: BMEdge): boolean => {
        const index = e.index
        return index >= 0 && index < edgeArrayLen && e === edgeArray[index]
    }

    /** `bm_edge_update_beauty_cost_single` (`:225`): recalc an edge in the heap. */
    const updateCostSingle = (e: BMEdge): void => {
        if (edgeInArray(e)) {
            const i = e.index
            const eStateSet = edgeStateArr[i]
            if (eheapTable[i]) {
                eheap.remove(eheapTable[i]!)
                eheapTable[i] = null
            }
            // check we're not moving back into a state we have been in before
            if (eStateSet.has(erotStateKey(e, true))) return
            // recalculate edge
            const cost = edgeCalcRotateBeauty(e, flag, method)
            if (cost < 0) eheapTable[i] = eheap.insert(cost, e)
            else eheapTable[i] = null
        }
    }

    /** `bm_edge_update_beauty_cost` (`:270`): we have rotated an edge, update its four neighbours. */
    const updateCost = (e: BMEdge): void => {
        const l = e.l!
        const eArr = [l.next.e!, l.prev.e!, l.radialNext!.next.e!, l.radialNext!.prev.e!]
        for (let i = 0; i < 4; i++) updateCostSingle(eArr[i])
    }

    // build heap
    for (let i = 0; i < edgeArrayLen; i++) {
        const e = edgeArray[i]
        const cost = edgeCalcRotateBeauty(e, flag, method)
        if (cost < 0) eheapTable[i] = eheap.insert(cost, e)
        else eheapTable[i] = null
        e.index = i // set_dirty
    }

    while (!eheap.isEmpty()) {
        let e: BMEdge | null = eheap.popMin()
        const i = e.index
        eheapTable[i] = null

        e = edgeRotate(bm, e, false, BM_EDGEROT_CHECK_EXISTS)

        if (e) {
            const eStateSet = edgeStateArr[i]
            // add the new state into the set so we don't move into this state again
            eStateSet.add(erotStateKey(e, false))

            // maintain the index array
            edgeArray[i] = e
            e.index = i

            // recalculate faces connected on the heap
            updateCost(e)

            // update flags
            if (oflagEdge) oflagEdge.add(e)
            for (const set of oflagFace) {
                set.add(e.l!.f)
                set.add(e.l!.radialNext!.f)
            }
        }
    }
}

/** Result of {@link bmoBeautifyFillExec}: `geom.out`, edges and faces in mesh order. */
export interface BeautifyFillResult {
    edges: BMEdge[]
    faces: BMFace[]
}

/**
 * `bmo_beautify_fill_exec` (`bmo_beautify.cc:23`), as a nested operator (no `bmesh_edit_end`): rotate
 * `edges` that lie between two triangles of `faces`. `method` 0 is area, 1 angle. Clears
 * `ElemFlag.Tag` on every edge, as Blender does.
 */
export function bmoBeautifyFillExec(
    bm: BMesh, faces: Iterable<BMFace>, edges: Iterable<BMEdge>, useRestrictTag: boolean, method: number,
): BeautifyFillResult {
    const flag = (useRestrictTag ? VERT_RESTRICT_TAG : 0)
        // Enable to avoid iterative edge rotation to cause the direction of faces to flip.
        | EDGE_RESTRICT_DEGENERATE
    const faceMark = new Set<BMFace>()
    const eleNewE = new Set<BMEdge>()
    const eleNewF = new Set<BMFace>()

    for (const f of faces) if (f.len === 3) faceMark.add(f)

    for (const e of bm.edges) e.hflag &= ~ElemFlag.Tag

    // will over alloc if some edges can't be rotated
    const edgeArray: BMEdge[] = []
    for (const e of edges) {
        // edge is manifold and can be rotated, faces are tagged
        if (edgeRotateCheck(e) && faceMark.has(e.l!.f) && faceMark.has(e.l!.radialNext!.f)) edgeArray.push(e)
    }

    meshBeautifyFill(bm, edgeArray, flag, method, eleNewE, [faceMark, eleNewF])

    return {
        edges: [...bm.edges].filter(e => eleNewE.has(e)),
        faces: [...bm.faces].filter(f => eleNewF.has(f)),
    }
}

// endregion

/** `bmo_beautify_fill_def` `type_flag` (`bmesh_opdefines.cc:2533`). */
const BEAUTIFY_FILL_TYPE_FLAG: BmeshEditEndFlags = {normalsCalc: true, selectFlush: true, selectValidate: true}

/**
 * `bmesh.ops.beautify_fill`: {@link bmoBeautifyFillExec} run as a top-level operator (`BMO_op_exec`:
 * re-index, the operator, normals update and select-mode flush, `bmesh_edit_end`).
 */
export function bmoBeautifyFill(
    bm: BMesh, faces: Iterable<BMFace>, edges: Iterable<BMEdge>, useRestrictTag = false, method: 'AREA' | 'ANGLE' = 'AREA',
): BeautifyFillResult {
    const inFaces = [...faces]
    const inEdges = [...edges]
    return bmoOpExec(bm, BEAUTIFY_FILL_TYPE_FLAG, () => bmoBeautifyFillExec(bm, inFaces, inEdges, useRestrictTag, method === 'AREA' ? 0 : 1))
}
