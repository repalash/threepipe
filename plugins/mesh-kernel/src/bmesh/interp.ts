/**
 * Attribute interpolation across the surface of a mesh.
 *
 * Ported from `source/blender/bmesh/intern/bmesh_interp.cc`, together with the weighting function
 * the face-based entry points lean on - `interp_weights_poly_v2`
 * (`source/blender/blenlib/intern/math_geom.cc:4294`) - and the projection and normal helpers those
 * need in turn.
 *
 * Where `customdata.ts` answers *how* a single layer blends given weights, this file answers *which*
 * elements and *with what weights*. Every topological operator that creates a corner - subdivide,
 * inset, bevel, poke, knife - needs one of these, or it silently throws away the per-corner data
 * (UVs above all) that the artist put there.
 *
 * ## Structural differences from Blender, and why
 *
 * - Blender passes `void *` customdata blocks around (`const void **blocks`). Here a "block" is just
 *   the element, and {@link interpElemAttrs} reads through the domain's layer layout. So
 *   {@link faceInterpFromFaceEx} takes loops and vertices where Blender takes `blocks_l`/`blocks_v`.
 * - Blender asserts `BM_face_is_normal_valid(f_src)` and reads `f_src->no`. The kernel has no
 *   "normals are up to date" invariant - nothing recalculates `BMFace.nx/ny/nz` after an operator -
 *   so {@link faceCalcNormal} is called instead of trusting a stale field. Wherever Blender's assert
 *   would have held, the value is the same one Blender would have read.
 *
 * ## Out of scope: multires
 *
 * `BM_loop_interp_multires`, `BM_loop_interp_multires_ex`, `BM_face_interp_multires`,
 * `BM_face_interp_multires_ex` and `BM_face_multires_bounds_smooth` (`bmesh_interp.cc:221-692`) are
 * deliberately **not** ported, and not stubbed either. They read and write `CD_MDISPS`, the
 * per-corner grid of displacement vectors owned by the multires modifier. The kernel has no such
 * layer and no subdivision cage, so there is nothing for them to act on; they arrive with multires
 * or not at all. The visible consequence is that {@link loopInterpFromFace} has no `do_multires`
 * argument where `BM_loop_interp_from_face` does.
 */

import {BMEdge, BMFace, BMLoop, BMVert} from './types'
import {faceCalcNormal} from './polygon'
import {BMesh} from './BMesh'
import {copyElemAttrs, interpElemAttrs} from './customdata'
import {Vec3} from '../math'

/** `FLT_EPSILON`. `interp_weights_poly_v2` derives its tolerances from this, so it must match. */
const FLT_EPSILON = 1.1920928955078125e-7

/**
 * A 3x3 matrix in Blender's `float m[3][3]` layout, flattened row-major: `m[row * 3 + col]`.
 * Only {@link axisDominantV3ToM3} produces one and only {@link mulV2M3V3} consumes one; it is
 * exported because {@link faceInterpFromFaceEx} takes one, mirroring Blender's `axis_mat` argument.
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

/**
 * `normalize_v3_v3` (`blenlib/intern/math_vector_inline.cc`): normalise in place and return the
 * original length, zeroing rather than dividing when the vector is degenerate. The `1e-35` cutoff
 * is Blender's, not an arbitrary epsilon - it is the point below which squaring underflows.
 */
function normalizeV3(a: Vec3): number {
    let d = a[0] * a[0] + a[1] * a[1] + a[2] * a[2]
    if (d > 1.0e-35) {
        d = Math.sqrt(d)
        a[0] /= d
        a[1] /= d
        a[2] /= d
        return d
    }
    a[0] = a[1] = a[2] = 0
    return 0
}

// region projection to 2d

/** `ortho_basis_v3v3_v3` (`blenlib/intern/math_vector.cc:568`). Returns the two vectors orthogonal to `n`. */
function orthoBasisV3V3V3(n: Vec3): [Vec3, Vec3] {
    const eps = FLT_EPSILON
    const f = n[0] * n[0] + n[1] * n[1]

    if (f > eps) {
        const d = 1.0 / Math.sqrt(f)
        const n1: Vec3 = [n[1] * d, -n[0] * d, 0]
        const n2: Vec3 = [-n[2] * n1[1], n[2] * n1[0], n[0] * n1[1] - n[1] * n1[0]]
        return [n1, n2]
    }
    // Degenerate case: the normal is (near enough) the Z axis, so no rotation about Z is defined.
    return [[n[2] < 0 ? -1 : 1, 0, 0], [0, 1, 0]]
}

/**
 * `axis_dominant_v3_to_m3` (`blenlib/intern/math_geom.cc:3646`): a basis whose Z row is `normal`,
 * transposed so that {@link mulV2M3V3} reads its columns. `normal` must be unit length.
 */
function axisDominantV3ToM3(normal: Vec3): Mat3 {
    const [r0, r1] = orthoBasisV3V3V3(normal)
    const r2 = normal
    // transpose_m3: m'[i][j] = m[j][i].
    return [
        r0[0], r1[0], r2[0],
        r0[1], r1[1], r2[1],
        r0[2], r1[2], r2[2],
    ]
}

/** `mul_v2_m3v3` (`blenlib/intern/math_matrix_c.cc:844`): the first two components of `Mᵀ·a`. */
function mulV2M3V3(out: number[], outOffset: number, m: Mat3, x: number, y: number, z: number): void {
    out[outOffset] = m[0] * x + m[3] * y + m[6] * z
    out[outOffset + 1] = m[1] * x + m[4] * y + m[7] * z
}

/** `ortho_v3_v3` (`blenlib/intern/math_vector.cc:593`), with `axis_dominant_v3_single` (`math_geom_inline.cc:86`). */
function orthoV3V3(v: Vec3): Vec3 {
    const x = Math.abs(v[0])
    const y = Math.abs(v[1])
    const z = Math.abs(v[2])
    const axis = x > y ? (x > z ? 0 : 2) : (y > z ? 1 : 2)
    switch (axis) {
    case 0: return [-v[1] - v[2], v[0], v[0]]
    case 1: return [v[1], -v[0] - v[2], v[1]]
    default: return [v[2], v[2], -v[0] - v[1]]
    }
}

// endregion

// region face normal and tangent

/** `axis_sort_v3` (`blenlib/intern/math_vector.cc:758`): indices of `values`, ascending. */
function axisSortV3(values: readonly [number, number, number]): [number, number, number] {
    const v: [number, number, number] = [values[0], values[1], values[2]]
    const order: [number, number, number] = [0, 1, 2]
    const swap = (a: number, b: number): void => {
        const tv = v[a]; v[a] = v[b]; v[b] = tv
        const to = order[a]; order[a] = order[b]; order[b] = to
    }
    if (v[0] < v[1]) {
        if (v[2] < v[0]) swap(0, 2)
    } else if (v[1] < v[2]) {
        swap(0, 1)
    } else {
        swap(0, 2)
    }
    if (v[2] < v[1]) swap(1, 2)
    return order
}

/**
 * `bm_vert_tri_find_unique_edge` (`bmesh_polygon.cc:~300`): the edge whose two neighbours are
 * closest to equal length, i.e. the "base" of the most isosceles reading of the triangle.
 */
function vertTriFindUniqueEdge(verts: [BMVert, BMVert, BMVert]): number {
    const len = (a: BMVert, b: BMVert): number =>
        Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
    const lens: [number, number, number] = [
        len(verts[0], verts[1]),
        len(verts[1], verts[2]),
        len(verts[2], verts[0]),
    ]
    const difs: [number, number, number] = [
        Math.abs(lens[1] - lens[2]),
        Math.abs(lens[2] - lens[0]),
        Math.abs(lens[0] - lens[1]),
    ]
    return axisSortV3(difs)[0]
}

/** `BM_vert_tri_calc_tangent_from_edge` (`bmesh_polygon.cc:341`). */
function vertTriCalcTangentFromEdge(verts: [BMVert, BMVert, BMVert]): Vec3 {
    const index = vertTriFindUniqueEdge(verts)
    const indexNext = (index + 1) % 3
    const a = verts[index], b = verts[indexNext]
    const t: Vec3 = [a.x - b.x, a.y - b.y, a.z - b.z]
    normalizeV3(t)
    return t
}

/** `BM_face_find_longest_loop` (`bmesh_query.cc:1523`). */
function faceFindLongestLoop(f: BMFace): BMLoop {
    let lenMaxSq = 0
    const lFirst = f.lFirst
    let lIter: BMLoop = lFirst
    // Blender's fallback when coordinates are not finite.
    let longest: BMLoop = lFirst
    do {
        const a = lIter.v, b = lIter.next.v
        const lenSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
        if (lenSq >= lenMaxSq) {
            longest = lIter
            lenMaxSq = lenSq
        }
        lIter = lIter.next
    } while (lIter !== lFirst)
    return longest
}

/** `bm_face_calc_tangent_from_quad_edge_pair` (`bmesh_polygon.cc:398`): the longer of the two edge pairs. */
function faceCalcTangentFromQuadEdgePair(f: BMFace): Vec3 {
    const l0 = f.lFirst
    const v0 = l0.v, v1 = l0.next.v, v2 = l0.next.next.v, v3 = l0.next.next.next.v

    const t: Vec3 = [
        (v3.x - v2.x) + (v0.x - v1.x),
        (v3.y - v2.y) + (v0.y - v1.y),
        (v3.z - v2.z) + (v0.z - v1.z),
    ]
    const other: Vec3 = [
        (v0.x - v3.x) + (v1.x - v2.x),
        (v0.y - v3.y) + (v1.y - v2.y),
        (v0.z - v3.z) + (v1.z - v2.z),
    ]
    const lenSq = (v: Vec3): number => v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
    const r: Vec3 = lenSq(t) < lenSq(other) ? other : t
    normalizeV3(r)
    return r
}

/** `BM_face_calc_tangent_from_edge` (`bmesh_polygon.cc:388`): along the face's longest edge. */
function faceCalcTangentFromEdge(f: BMFace): Vec3 {
    const lLong = faceFindLongestLoop(f)
    const a = lLong.v, b = lLong.next.v
    const t: Vec3 = [a.x - b.x, a.y - b.y, a.z - b.z]
    normalizeV3(t)
    return t
}

/**
 * `BM_face_calc_tangent_auto` (`bmesh_polygon.cc:572`). Only reached for a face whose vertices are
 * all collinear, where there is no normal to project along; see {@link loopInterpFromFace}.
 */
export function faceCalcTangentAuto(f: BMFace): Vec3 {
    if (f.len === 3) {
        const l = f.lFirst
        return vertTriCalcTangentFromEdge([l.v, l.next.v, l.next.next.v])
    }
    if (f.len === 4) return faceCalcTangentFromQuadEdgePair(f)
    return faceCalcTangentFromEdge(f)
}

// endregion

// region interp_weights_poly_v2

/**
 * `mean_value_half_tan_v2_db` (`blenlib/intern/math_geom.cc:4193`).
 *
 * Kept in double precision exactly as Blender does, and for the reason Blender gives: a point far
 * outside the polygon makes `len - dot` a catastrophic cancellation in float.
 */
function meanValueHalfTanV2Db(
    currX: number, currY: number, currLen: number,
    nextX: number, nextY: number, nextLen: number,
): number {
    // cross_v2v2_db
    const area = currX * nextY - currY * nextX
    // Compared against zero rather than an epsilon, per Blender's note on #73348.
    if (area !== 0) {
        const dot = currX * nextX + currY * nextY
        const len = currLen * nextLen
        const result = (len - dot) / area
        if (Number.isFinite(result)) return result
    }
    return 0
}

/** `closest_to_line_v2` (`blenlib/intern/math_geom.cc:3298`). Returns lambda, writes the point into `out`. */
function closestToLineV2(
    out: [number, number], px: number, py: number,
    l1x: number, l1y: number, l2x: number, l2y: number,
): number {
    const ux = l2x - l1x, uy = l2y - l1y
    const hx = px - l1x, hy = py - l1y
    const denom = ux * ux + uy * uy
    if (denom === 0) {
        out[0] = l1x
        out[1] = l1y
        return 0
    }
    const lambda = (ux * hx + uy * hy) / denom
    out[0] = l1x + ux * lambda
    out[1] = l1y + uy * lambda
    return lambda
}

/** `dist_squared_to_line_segment_v2` (`:307`) through `closest_to_line_segment_v2` (`:381`). */
function distSquaredToLineSegmentV2(
    px: number, py: number, l1x: number, l1y: number, l2x: number, l2y: number,
): number {
    const cp: [number, number] = [0, 0]
    const lambda = closestToLineV2(cp, px, py, l1x, l1y, l2x, l2y)
    // Blender flips the checks so a segment that is really a point still returns an endpoint.
    let cx: number, cy: number
    if (lambda <= 0) {
        cx = l1x
        cy = l1y
    } else if (lambda >= 1) {
        cx = l2x
        cy = l2y
    } else {
        cx = cp[0]
        cy = cp[1]
    }
    return (cx - px) ** 2 + (cy - py) ** 2
}

/** `line_point_factor_v2` (`blenlib/intern/math_geom.cc:3389`), with Blender's zero fallback. */
function linePointFactorV2(
    px: number, py: number, l1x: number, l1y: number, l2x: number, l2y: number,
): number {
    const ux = l2x - l1x, uy = l2y - l1y
    const hx = px - l1x, hy = py - l1y
    const dot = ux * ux + uy * uy
    return dot > 0 ? (ux * hx + uy * hy) / dot : 0
}

/** `IS_POINT_IX` / `IS_SEGMENT_IX` (`math_geom.cc:4139`). */
const IS_POINT_IX = 1 << 0
const IS_SEGMENT_IX = 1 << 1

/**
 * Mean value coordinates of `co` inside the 2D polygon `v`. Port of `interp_weights_poly_v2`
 * (`blenlib/intern/math_geom.cc:4294`), the weighting every face-based interpolation here uses.
 *
 * The plain Mark Meyer et al. mean-value formula misbehaves near the polygon boundary, so Blender
 * short-circuits two cases and this port keeps both, because they are what makes the result exact
 * where exactness is visible:
 *
 * - **On a vertex** (within `eps` of it): that vertex takes weight 1 and every other weight is 0.
 *   Without this, splitting an edge at `fac = 0` would perturb the corner it landed on.
 * - **On an edge** (within `eps` of the segment): the two endpoints of that segment share the weight
 *   linearly, everything else is 0. This is what keeps a UV seam straight.
 *
 * Otherwise the weights are the half-tangent sums, normalised to sum to 1. Note that they are *not*
 * clamped: a point outside the polygon gets negative weights, which extrapolate, and Blender relies
 * on that.
 *
 * `eps` is derived from the data (`16 * FLT_EPSILON * max_value`), not fixed, so the tolerance
 * tracks the scale of the mesh.
 *
 * @param w output, `n` weights
 * @param v polygon corners, flattened `[x0, y0, x1, y1, ...]`
 * @param n number of corners
 * @param co the point to weight, in the same 2D space
 */
export function interpWeightsPolyV2(
    w: number[], v: ArrayLike<number>, n: number, coX: number, coY: number,
): void {
    if (n < 2) {
        // Blender initialises from `v[n - 2]`, which is only in bounds from two corners up. A face
        // never has fewer; anything that gets here is a caller bug, not a case to paper over.
        throw new Error(`mesh-kernel: interpWeightsPolyV2 needs at least 2 corners, got ${n}`)
    }

    // The floating point precision we can expect from the supplied data.
    let maxValue = 0
    for (let i = 0; i < n; i++) {
        maxValue = Math.max(maxValue, Math.abs(v[i * 2] - coX))
        maxValue = Math.max(maxValue, Math.abs(v[i * 2 + 1] - coY))
    }

    // Derived empirically by Blender against the test files in D7772.
    const eps = 16.0 * FLT_EPSILON * maxValue
    const epsSq = eps * eps

    let totweight = 0
    let ixFlag = 0

    // Blender walks `float *v_curr` pointers; indices are the same thing without the out-of-bounds
    // read of `v[n]` that C does (and never uses) on the final step.
    let iCurr = n - 1
    let iNext = 0
    let vCurr = iCurr
    let vNext = iNext

    // DIR_V2_SET(&d_curr, v[n - 2], co); DIR_V2_SET(&d_next, v[n - 1], co)
    let dCurrX = v[(n - 2) * 2] - coX
    let dCurrY = v[(n - 2) * 2 + 1] - coY
    let dCurrLen = Math.sqrt(dCurrX * dCurrX + dCurrY * dCurrY)
    let dNextX = v[vCurr * 2] - coX
    let dNextY = v[vCurr * 2 + 1] - coY
    let dNextLen = Math.sqrt(dNextX * dNextX + dNextY * dNextY)
    let htPrev = meanValueHalfTanV2Db(dCurrX, dCurrY, dCurrLen, dNextX, dNextY, dNextLen)

    while (iNext < n) {
        // 'd_next.len' is in fact 'd_curr.len', just avoiding a copy to begin with.
        if (dNextLen < eps) {
            ixFlag = IS_POINT_IX
            break
        }
        if (distSquaredToLineSegmentV2(
            coX, coY, v[vCurr * 2], v[vCurr * 2 + 1], v[vNext * 2], v[vNext * 2 + 1],
        ) < epsSq) {
            ixFlag = IS_SEGMENT_IX
            break
        }

        dCurrX = dNextX
        dCurrY = dNextY
        dCurrLen = dNextLen
        dNextX = v[vNext * 2] - coX
        dNextY = v[vNext * 2 + 1] - coY
        dNextLen = Math.sqrt(dNextX * dNextX + dNextY * dNextY)

        const ht = meanValueHalfTanV2Db(dCurrX, dCurrY, dCurrLen, dNextX, dNextY, dNextLen)
        w[iCurr] = dCurrLen === 0 ? 0 : (htPrev + ht) / dCurrLen
        totweight += w[iCurr]

        iCurr = iNext++
        vCurr = vNext
        vNext = iNext

        htPrev = ht
    }

    if (ixFlag) {
        for (let i = 0; i < n; i++) w[i] = 0

        if (ixFlag & IS_POINT_IX) {
            w[iCurr] = 1
        } else {
            let fac = linePointFactorV2(
                coX, coY, v[vCurr * 2], v[vCurr * 2 + 1], v[vNext * 2], v[vNext * 2 + 1],
            )
            fac = fac < 0 ? 0 : fac > 1 ? 1 : fac
            w[iCurr] = 1 - fac
            w[iNext] = fac
        }
    } else if (totweight !== 0) {
        for (let i = 0; i < n; i++) w[i] /= totweight
    }
}

// endregion

// region two-element blends

/**
 * `bm_data_interp_from_elem` (`bmesh_interp.cc:38`). Edges and vertices share the logic; Blender
 * notes there is currently no need for them to differ.
 *
 * The `fac <= 0` / `fac >= 1` short circuits are Blender's, and they are not just an optimisation:
 * copying the block is exact where a weighted sum of `1.0` and `0.0` is only nearly exact, and it
 * carries the layers that have no interpolation rule at all.
 *
 * Blender's outer `if (ele_src_1->head.data && ele_src_2->head.data)` is not reproduced, because it
 * is a null-pointer guard rather than a rule: in this kernel a missing block reads as the layer
 * defaults (`getComponent`), so blending two unwritten elements is well defined and yields those
 * same defaults.
 */
function dataInterpFromElem(
    bm: BMesh, domain: 'vert' | 'edge', src1: BMVert | BMEdge, src2: BMVert | BMEdge,
    dst: BMVert | BMEdge, fac: number,
): void {
    const layout = bm.layoutFor(domain)
    if (fac <= 0) {
        if (src1 !== dst) copyElemAttrs(src1, dst, layout)
    } else if (fac >= 1) {
        if (src2 !== dst) copyElemAttrs(src2, dst, layout)
    } else {
        interpElemAttrs(dst, [src1, src2], [1 - fac, fac], layout)
    }
}

/** `BM_data_interp_from_verts` (`bmesh_interp.cc:75`). */
export function dataInterpFromVerts(
    bm: BMesh, vSrc1: BMVert, vSrc2: BMVert, vDst: BMVert, fac: number,
): void {
    dataInterpFromElem(bm, 'vert', vSrc1, vSrc2, vDst, fac)
}

/** `BM_data_interp_from_edges` (`bmesh_interp.cc:85`). */
export function dataInterpFromEdges(
    bm: BMesh, eSrc1: BMEdge, eSrc2: BMEdge, eDst: BMEdge, fac: number,
): void {
    dataInterpFromElem(bm, 'edge', eSrc1, eSrc2, eDst, fac)
}

/**
 * `BM_data_interp_face_vert_edge` (`bmesh_interp.cc:106`).
 *
 * Called straight after SEMV has put `v` into `e`: `e` now spans `v` and `vSrc1`, and every face
 * that used the original edge has gained a corner at `v`. For each of those faces this walks to the
 * two corners the new one sits between - the one at `vSrc1` and the one at the far end - and blends
 * them at `fac`.
 *
 * The radial walk is the whole point. A manifold edge has two faces, and the two faces wind in
 * opposite directions along it, so "the corner before" and "the corner after" are different loops on
 * each. Copying one corner's data, which is what the kernel did before
 * (`issues/open/modelling-tools/kernel-split-edge-copies-corner-data.md`), gives stepped UVs.
 *
 * Blender's `v_src_2` parameter is unused in its own body; it is kept here for call-site symmetry
 * with `BM_edge_split` (`bmesh_mods.cc:522`).
 *
 * @param vSrc1 the vertex at the far end of `e` from the split
 * @param v the vertex SEMV inserted
 * @param e the half of the original edge that runs from `v` to `vSrc1`
 * @param fac how far along, from the *other* original endpoint towards `vSrc1`
 */
export function dataInterpFaceVertEdge(
    bm: BMesh, vSrc1: BMVert, _vSrc2: BMVert, v: BMVert, e: BMEdge, fac: number,
): void {
    if (!e.l) return

    const w: [number, number] = [fac, 1 - fac]

    // Blender declares these outside the loop and never resets them, so a radial loop that matches
    // neither branch would reuse the previous face's corners. It cannot happen - every loop of `e`
    // is at `v` or at `vSrc1` - and the early return below is Blender's own guard for it.
    let lV1: BMLoop | null = null
    let lV: BMLoop | null = null
    let lV2: BMLoop | null = null

    const first = e.l
    let lIter: BMLoop = first
    do {
        if (lIter.v === vSrc1) {
            lV1 = lIter
            lV = lV1.next
            lV2 = lV.next
        } else if (lIter.v === v) {
            lV1 = lIter.next
            lV = lIter
            lV2 = lIter.prev
        }

        if (!lV1 || !lV2) return

        interpElemAttrs(lV!, [lV1, lV2], w, bm.ldata)

        lIter = lIter.radialNext!
    } while (lIter !== first)
}

// endregion

// region face-based interpolation

/**
 * The 2D projection `BM_face_interp_from_face`, `BM_loop_interp_from_face` and
 * `BM_vert_interp_from_face` all build before weighting: an orthonormal basis from the face normal,
 * and every corner of the face flattened into it.
 *
 * Shared rather than written out three times, which is what Blender does via the `_ex` split.
 * The zero-normal fallback is `BM_loop_interp_from_face`'s (`bmesh_interp.cc:707-720`); the other
 * two assert a valid normal instead, and this is a superset of that.
 */
function faceProject2d(f: BMFace): {cos2d: number[], axisMat: Mat3} {
    let axisDominant = faceCalcNormal(f)
    if (axisDominant[0] === 0 && axisDominant[1] === 0 && axisDominant[2] === 0) {
        // Rare case in which all the vertices of the face are aligned. Get a random axis that is
        // orthogonal to the tangent.
        axisDominant = orthoV3V3(faceCalcTangentAuto(f))
        normalizeV3(axisDominant)
    }
    const axisMat = axisDominantV3ToM3(axisDominant)

    const cos2d: number[] = new Array(f.len * 2)
    let i = 0
    for (const l of f.eachLoop()) {
        mulV2M3V3(cos2d, i * 2, axisMat, l.v.x, l.v.y, l.v.z)
        i++
    }
    return {cos2d, axisMat}
}

/**
 * `BM_face_interp_from_face_ex` (`bmesh_interp.cc:149`).
 *
 * Blender takes pre-gathered `blocks_l`/`blocks_v` pointer arrays; here the source loops are passed
 * as elements, since a "block" in this kernel is just the element itself.
 */
export function faceInterpFromFaceEx(
    bm: BMesh, fDst: BMFace, fSrc: BMFace, doVertex: boolean,
    srcLoops: readonly BMLoop[], cos2d: number[], axisMat: Mat3,
): void {
    const n = fSrc.len
    const w: number[] = new Array(n)
    const co: [number, number] = [0, 0]

    for (const lIter of fDst.eachLoop()) {
        mulV2M3V3(co, 0, axisMat, lIter.v.x, lIter.v.y, lIter.v.z)
        interpWeightsPolyV2(w, cos2d, n, co[0], co[1])
        interpElemAttrs(lIter, srcLoops, w, bm.ldata)
        if (doVertex) {
            interpElemAttrs(lIter.v, srcLoops.map(l => l.v), w, bm.vdata)
        }
    }
}

/**
 * `BM_face_interp_from_face` (`bmesh_interp.cc:176`): give every corner of `fDst` the data it would
 * have had as part of `fSrc`. What a dissolve or a face rebuild uses.
 */
export function faceInterpFromFace(bm: BMesh, fDst: BMFace, fSrc: BMFace, doVertex: boolean): void {
    const {cos2d, axisMat} = faceProject2d(fSrc)
    faceInterpFromFaceEx(bm, fDst, fSrc, doVertex, fSrc.loops(), cos2d, axisMat)
}

/**
 * `BM_loop_interp_from_face` (`bmesh_interp.cc:694`): give one corner the data it would have had as
 * part of `fSrc`.
 *
 * This is the workhorse behind inset, bevel and poke - anything that creates corners inside the
 * footprint of an existing face. The corner's *vertex position* is projected into the source face's
 * plane and weighted against the source face's corners by {@link interpWeightsPolyV2}, so a corner
 * exactly on a source vertex takes that vertex's data exactly, a corner on an edge takes the linear
 * blend along it, and a corner outside the face extrapolates.
 *
 * Blender's `do_multires` argument is absent; see the file header.
 *
 * @param doVertex also interpolate the destination loop's *vertex* attributes from the source
 *   face's vertices, with the same weights. `BM_loop_interp_from_face(..., true, ...)`.
 */
export function loopInterpFromFace(
    bm: BMesh, lDst: BMLoop, fSrc: BMFace, doVertex = false,
): void {
    const n = fSrc.len
    const {cos2d, axisMat} = faceProject2d(fSrc)
    const srcLoops = fSrc.loops()

    const co: [number, number] = [0, 0]
    mulV2M3V3(co, 0, axisMat, lDst.v.x, lDst.v.y, lDst.v.z)

    const w: number[] = new Array(n)
    interpWeightsPolyV2(w, cos2d, n, co[0], co[1])

    interpElemAttrs(lDst, srcLoops, w, bm.ldata)
    if (doVertex) {
        interpElemAttrs(lDst.v, srcLoops.map(l => l.v), w, bm.vdata)
    }
}

/**
 * `BM_vert_interp_from_face` (`bmesh_interp.cc:750`): a vertex takes the weighted blend of the
 * *vertices* of `fSrc`, by the same projection. Note the sources are `l_iter->v`, not the loops -
 * this is the vertex domain throughout.
 */
export function vertInterpFromFace(bm: BMesh, vDst: BMVert, fSrc: BMFace): void {
    const n = fSrc.len
    const {cos2d, axisMat} = faceProject2d(fSrc)

    const co: [number, number] = [0, 0]
    mulV2M3V3(co, 0, axisMat, vDst.x, vDst.y, vDst.z)

    const w: number[] = new Array(n)
    interpWeightsPolyV2(w, cos2d, n, co[0], co[1])

    const srcVerts: BMVert[] = []
    for (const l of fSrc.eachLoop()) srcVerts.push(l.v)
    interpElemAttrs(vDst, srcVerts, w, bm.vdata)
}

// endregion
