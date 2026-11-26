/**
 * The offset geometry: where the new boundary points sit relative to the original edges.
 *
 * Ported from `source/blender/bmesh/tools/bmesh_bevel.cc:1643-2260`. This is the part of bevel that
 * decides distances, and an approximation anywhere in it shows up immediately as a bevel that is the
 * wrong width. Nothing here touches the mesh; every function reads positions and writes a point.
 *
 * The five offset types are not five scalings of one number. `offset`, `width` and `depth` all end up
 * as a per-side `offsetL`/`offsetR` computed in `bevelVertConstruct` and then met by
 * {@link offsetMeet} on the angle bisector, while `percent` and `absolute` abandon the bisector
 * entirely and intersect two lines slid along the *adjacent* legs of the two faces
 * ({@link offsetMeetLinesPercentOrAbsolute}). That is why they cannot be checked against each other.
 */

import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {
    V3, V4, addV3V3, addV3V3V3, angleNormalizedV3V3, angleV3V3, closestToPlaneNormalizedV3, compareFf,
    copyV3V3, crossV3V3V3, dotV3V3, interpV3V3V3, isectLineLineV3, maddV3V3Fl, maddV3V3V3Fl, maxFf,
    midV3V3V3, mulV3Fl, negateV3, normalizeV3, nv3, planeFromPointNormalV3, subV3V3V3, zeroV3,
} from './bevel-math'
import {
    AngleKind, BEVEL_AMT, BEVEL_EPSILON_ANG, BEVEL_EPSILON_ANG_DOT, BEVEL_EPSILON_BIG,
    BEVEL_EPSILON_D, BEVEL_SMALL_ANG, BevelParams, EdgeHalf,
} from './bevel-types'
import {co, edgeCalcLength, edgeOtherVert, faceVertShareLoop, fno, vno} from './bevel-bmquery'

/** `nearly_parallel` (`:793`). */
export function nearlyParallel(d1: readonly number[], d2: readonly number[]): boolean {
    const ang = angleV3V3(d1, d2)
    return Math.abs(ang) < BEVEL_EPSILON_ANG || Math.abs(ang - Math.PI) < BEVEL_EPSILON_ANG
}

/**
 * `nearly_parallel_normalized` (`:803`). Both inputs must be unit length.
 *
 * The comparison is on `|dot|` against 1 with a tolerance derived from the two-degree angle, which
 * is not the same test as {@link nearlyParallel} - it is looser near parallel and is used where the
 * caller has already normalised and cannot afford the `acos`.
 */
export function nearlyParallelNormalized(d1: readonly number[], d2: readonly number[]): boolean {
    const directionDot = dotV3V3(d1, d2)
    return compareFf(Math.abs(directionDot), 1.0, BEVEL_EPSILON_ANG_DOT)
}

/**
 * `slide_dist` (`:1644`) - the point a distance `d` from `v` along `e`, clamped just short of the
 * far end so the result never passes it.
 */
export function slideDist(e: EdgeHalf, v: BMVert, d: number, rSlideco: V3): void {
    const dir = nv3()
    subV3V3V3(dir, co(v), co(edgeOtherVert(e.e, v)))
    const len = normalizeV3(dir)

    if (d > len) {
        d = len - 50.0 * BEVEL_EPSILON_D
    }
    copyV3V3(rSlideco, co(v))
    maddV3V3Fl(rSlideco, dir, -d)
}

/**
 * `is_outside_edge` (`:1658`) - is `point` off the end of `e`? If so the closer endpoint comes back
 * in `rCloserV`.
 */
export function isOutsideEdge(e: EdgeHalf, point: readonly number[], rCloserV: {v: BMVert | null}): boolean {
    const l1 = co(e.e.v1)
    const u = nv3()
    const h = nv3()
    subV3V3V3(u, co(e.e.v2), l1)
    subV3V3V3(h, point, l1)
    const lenu = normalizeV3(u)
    const lambda = dotV3V3(u, h)
    if (lambda <= -BEVEL_EPSILON_BIG * lenu) {
        rCloserV.v = e.e.v1
        return true
    }
    if (lambda >= (1.0 + BEVEL_EPSILON_BIG) * lenu) {
        rCloserV.v = e.e.v2
        return true
    }
    return false
}

/**
 * `edges_angle_kind` (`:1679`) - is the corner at `v` between `e1` and `e2` under, at, or over 180
 * degrees?
 *
 * The in-line case is tested first with the cheap dot-product form, because the cross product of two
 * nearly-parallel directions is numerical noise and its sign against the normal is meaningless.
 */
export function edgesAngleKind(e1: EdgeHalf, e2: EdgeHalf, v: BMVert): AngleKind {
    const v1 = edgeOtherVert(e1.e, v)
    const v2 = edgeOtherVert(e2.e, v)
    const dir1 = nv3()
    const dir2 = nv3()
    subV3V3V3(dir1, co(v), co(v1))
    subV3V3V3(dir2, co(v), co(v2))
    normalizeV3(dir1)
    normalizeV3(dir2)

    if (nearlyParallelNormalized(dir1, dir2)) {
        return AngleKind.STRAIGHT
    }

    // Angles are in [0, pi]; compare the cross product with the normal to see whether they are reflex.
    const cross = nv3()
    crossV3V3V3(cross, dir1, dir2)
    normalizeV3(cross)
    let no: V3
    if (e1.fnext) {
        no = fno(e1.fnext)
    } else if (e2.fprev) {
        no = fno(e2.fprev)
    } else {
        no = vno(v)
    }

    if (dotV3V3(cross, no) < 0) {
        return AngleKind.LARGER
    }
    return AngleKind.SMALLER
}

/**
 * `point_between_edges` (`:1717`) - is `point`, which should be roughly in the plane of `f`, inside
 * the CCW sweep from `e1` to `e2`?
 */
export function pointBetweenEdges(
    point: readonly number[], v: BMVert, f: BMFace, e1: EdgeHalf, e2: EdgeHalf,
): boolean {
    const v1 = edgeOtherVert(e1.e, v)
    const v2 = edgeOtherVert(e2.e, v)
    const dir1 = nv3()
    const dir2 = nv3()
    const dirco = nv3()
    const no = nv3()
    subV3V3V3(dir1, co(v), co(v1))
    subV3V3V3(dir2, co(v), co(v2))
    subV3V3V3(dirco, co(v), point)
    normalizeV3(dir1)
    normalizeV3(dir2)
    normalizeV3(dirco)
    let ang11 = angleNormalizedV3V3(dir1, dir2)
    let ang1co = angleNormalizedV3V3(dir1, dirco)
    // Angles are in [0, pi]; the cross product against the face normal says which are reflex.
    crossV3V3V3(no, dir1, dir2)
    if (dotV3V3(no, fno(f)) < 0) {
        ang11 = Math.PI * 2.0 - ang11
    }
    crossV3V3V3(no, dir1, dirco)
    if (dotV3V3(no, fno(f)) < 0) {
        ang1co = Math.PI * 2.0 - ang1co
    }
    return ang11 - ang1co > -BEVEL_EPSILON_ANG
}

/**
 * `edge_edge_angle_less_than_180` (`:1746`) - is the sweep from `e1` to `e2` around their shared
 * vertex, seen from the normal side of `f`, neither reflex nor straight?
 */
export function edgeEdgeAngleLessThan180(e1: BMEdge, e2: BMEdge, f: BMFace): boolean {
    let v: BMVert
    let v1: BMVert
    let v2: BMVert
    if (e1.v1 === e2.v1) {
        v = e1.v1; v1 = e1.v2; v2 = e2.v2
    } else if (e1.v1 === e2.v2) {
        v = e1.v1; v1 = e1.v2; v2 = e2.v1
    } else if (e1.v2 === e2.v1) {
        v = e1.v2; v1 = e1.v1; v2 = e2.v2
    } else if (e1.v2 === e2.v2) {
        v = e1.v2; v1 = e1.v1; v2 = e2.v1
    } else {
        // Blender asserts here; the edges were supposed to share a vertex.
        return false
    }
    const dir1 = nv3()
    const dir2 = nv3()
    const cross = nv3()
    subV3V3V3(dir1, co(v1), co(v))
    subV3V3V3(dir2, co(v2), co(v))
    crossV3V3V3(cross, dir1, dir2)
    return dotV3V3(cross, fno(f)) > 0
}

/**
 * `offset_meet_lines_percent_or_absolute` (`:1785`).
 *
 * For `percent` and `absolute` the boundary point is not on the angle bisector at all: it is where
 * two lines meet, each of which is the leg of an adjacent face slid inwards by the requested amount.
 * Blender's comment about fake EdgeHalfs is the important part - at the time this runs the BevVerts
 * for the neighbouring vertices may not exist, so the four legs are found by walking `f1` and `f2`
 * directly and wrapped in throwaway EdgeHalf records that only ever have their `e` field read.
 *
 * When any leg is invisible from its opposite leg, or either face is missing, Blender gives up and
 * returns the two original edges, which makes the intersection land on `v` itself.
 */
export function offsetMeetLinesPercentOrAbsolute(
    bp: BevelParams, e1: EdgeHalf, e2: EdgeHalf, v: BMVert,
    rL1a: V3, rL1b: V3, rL2a: V3, rL2b: V3,
): void {
    const v1 = edgeOtherVert(e1.e, v)
    const v2 = edgeOtherVert(e2.e, v)
    const f1 = e1.fnext
    const f2 = e2.fprev
    let noOffsets = f1 === null || f2 === null
    if (!noOffsets) {
        // Only `.e` is ever read off these, so a bare object standing in for `EdgeHalf` is enough.
        const fake = (e: BMEdge): EdgeHalf => ({e} as EdgeHalf)
        const e0 = fake(faceVertShareLoop(f1!, v1)!.e!)
        const e3 = fake(faceVertShareLoop(f2!, v2)!.prev.e!)
        const e4 = fake(faceVertShareLoop(f1!, v)!.prev.e!)
        const e5 = fake(faceVertShareLoop(f2!, v)!.e!)
        // All the legs must be visible from their opposite legs.
        // (The last test passes `f1` where `f2` would read more naturally; that is Blender's line,
        // kept as-is - changing it would change results on non-planar corners.)
        noOffsets = !edgeEdgeAngleLessThan180(e0.e, e1.e, f1!) ||
            !edgeEdgeAngleLessThan180(e1.e, e4.e, f1!) ||
            !edgeEdgeAngleLessThan180(e2.e, e3.e, f2!) ||
            !edgeEdgeAngleLessThan180(e5.e, e2.e, f1!)
        if (!noOffsets) {
            let d0: number, d3: number, d4: number, d5: number
            if (bp.offsetType === BEVEL_AMT.ABSOLUTE) {
                d0 = d3 = d4 = d5 = bp.offset
            } else {
                d0 = bp.offset * edgeCalcLength(e0.e) / 100.0
                d3 = bp.offset * edgeCalcLength(e3.e) / 100.0
                d4 = bp.offset * edgeCalcLength(e4.e) / 100.0
                d5 = bp.offset * edgeCalcLength(e5.e) / 100.0
            }
            // `bp->use_weights` is out of scope (no deform-vertex or bevel-weight domain here), so
            // Blender's `e1_wt`/`e2_wt` are both 1 and the multiplications drop out.
            slideDist(e4, v, d4, rL1a)
            slideDist(e0, v1, d0, rL1b)
            slideDist(e5, v, d5, rL2a)
            slideDist(e3, v2, d3, rL2b)
        }
    }
    if (noOffsets) {
        copyV3V3(rL1a, co(v))
        copyV3V3(rL1b, co(v1))
        copyV3V3(rL2a, co(v))
        copyV3V3(rL2b, co(v2))
    }
}

/**
 * `offset_meet` (`:1882`) - where the two offset edges for `e1` and `e2` meet, into `meetco`.
 *
 * `e1` and `e2` share vertex `v` and, usually, face `f`; seen from the normal side, `e1` precedes
 * `e2` CCW. The offset edge is on the right of both, with `e1` entering `v` and `e2` leaving it.
 *
 * With equal offsets the answer is on the angle bisector at `offset / sin(angle / 2)`; the general
 * case intersects the two offset lines, which is what the code actually does because the offsets can
 * differ once the adjustment pass has run. Three special cases come first:
 * - **Parallel edges.** The bisector is undefined, so the point goes perpendicular to both from `v`.
 *   Blender used to use `offset` and `dir1` here; on a circle with more than 200 sides that was
 *   visibly wrong (#61214), so it averages the two directions and still applies the bisector formula.
 * - **Anti-parallel edges**, which means the bevel runs into a zero-area face: just slide along the
 *   common line.
 * - A **small angle** with a known face, where the cross-product normal is nearly perpendicular to
 *   the face and looks wrong; the face normal is used instead.
 *
 * @param edgesBetween there are other edges between `e1` and `e2` CCW, so they share no face. The
 *   meeting point should still land on an existing face, so it is dropped onto one of the faces in
 *   between when one of them contains it.
 * @param eInPlane when dropping, skip the faces either side of this edge - it is the one whose two
 *   faces are coplanar, and dropping onto it does nothing useful.
 */
export function offsetMeet(
    bp: BevelParams, e1: EdgeHalf, e2: EdgeHalf, v: BMVert, f: BMFace | null,
    edgesBetween: boolean, meetco: V3, eInPlane: EdgeHalf | null,
): void {
    // Direction vectors for the two offset lines.
    const dir1 = nv3()
    const dir2 = nv3()
    subV3V3V3(dir1, co(v), co(edgeOtherVert(e1.e, v)))
    subV3V3V3(dir2, co(edgeOtherVert(e2.e, v)), co(v))

    const dir1n = nv3()
    const dir2p = nv3()
    if (edgesBetween) {
        const e1next = e1.next
        const e2prev = e2.prev
        subV3V3V3(dir1n, co(edgeOtherVert(e1next.e, v)), co(v))
        subV3V3V3(dir2p, co(v), co(edgeOtherVert(e2prev.e, v)))
    } else {
        zeroV3(dir1n)
        zeroV3(dir2p)
    }

    let ang = angleV3V3(dir1, dir2)
    const normPerp1 = nv3()
    if (ang < BEVEL_EPSILON_ANG) {
        // e1 and e2 are parallel; put the offset point perpendicular to both, from v.
        const normV = nv3()
        if (f) {
            copyV3V3(normV, fno(f))
        } else {
            // The average of the face normals of the faces between e1 and e2.
            let fcount = 0
            zeroV3(normV)
            for (let eloop = e1; eloop !== e2; eloop = eloop.next) {
                if (eloop.fnext !== null) {
                    addV3V3(normV, fno(eloop.fnext))
                    fcount++
                }
            }
            if (fcount === 0) {
                copyV3V3(normV, vno(v))
            } else {
                mulV3Fl(normV, 1.0 / fcount)
            }
        }
        addV3V3(dir1, dir2)
        crossV3V3V3(normPerp1, dir1, normV)
        normalizeV3(normPerp1)
        const off1a = nv3()
        copyV3V3(off1a, co(v))
        let d = maxFf(e1.offsetR, e2.offsetL)
        d = d / Math.cos(ang / 2.0)
        maddV3V3Fl(off1a, normPerp1, d)
        copyV3V3(meetco, off1a)
    } else if (Math.abs(ang - Math.PI) < BEVEL_EPSILON_ANG) {
        // e1 and e2 are anti-parallel, so the bevel goes into a zero-area face.
        const d = maxFf(e1.offsetR, e2.offsetL)
        slideDist(e2, v, d, meetco)
    } else {
        const normV1 = nv3()
        const normV2 = nv3()
        if (f && ang < BEVEL_SMALL_ANG) {
            copyV3V3(normV1, fno(f))
            copyV3V3(normV2, fno(f))
        } else if (!edgesBetween) {
            crossV3V3V3(normV1, dir2, dir1)
            normalizeV3(normV1)
            if (dotV3V3(normV1, f ? fno(f) : vno(v)) < 0) {
                negateV3(normV1)
            }
            copyV3V3(normV2, normV1)
        } else {
            // Separate faces: get the face normal at each corner separately.
            crossV3V3V3(normV1, dir1n, dir1)
            normalizeV3(normV1)
            let ff = e1.fnext
            if (dotV3V3(normV1, ff ? fno(ff) : vno(v)) < 0) {
                negateV3(normV1)
            }
            crossV3V3V3(normV2, dir2, dir2p)
            normalizeV3(normV2)
            ff = e2.fprev
            if (dotV3V3(normV2, ff ? fno(ff) : vno(v)) < 0) {
                negateV3(normV2)
            }
        }

        // Vectors perpendicular to each edge, perpendicular to normV, pointing into the face.
        const normPerp2 = nv3()
        crossV3V3V3(normPerp1, dir1, normV1)
        crossV3V3V3(normPerp2, dir2, normV2)
        normalizeV3(normPerp1)
        normalizeV3(normPerp2)

        const off1a = nv3()
        const off1b = nv3()
        const off2a = nv3()
        const off2b = nv3()
        if (bp.offsetType === BEVEL_AMT.PERCENT || bp.offsetType === BEVEL_AMT.ABSOLUTE) {
            offsetMeetLinesPercentOrAbsolute(bp, e1, e2, v, off1a, off1b, off2a, off2b)
        } else {
            // A point at the offset distance from each line, then another point on each line.
            copyV3V3(off1a, co(v))
            maddV3V3Fl(off1a, normPerp1, e1.offsetR)
            addV3V3V3(off1b, off1a, dir1)
            copyV3V3(off2a, co(v))
            maddV3V3Fl(off2a, normPerp2, e2.offsetL)
            addV3V3V3(off2b, off2a, dir2)
        }

        const isect2 = nv3()
        const isectKind = isectLineLineV3(off1a, off1b, off2a, off2b, meetco, isect2)
        if (isectKind === 0) {
            // Collinear: already tested above, but with a different epsilon.
            copyV3V3(meetco, off1a)
        } else {
            /* The lines intersect, but is it somewhere reasonable? If one of the offsets is zero we
             * do not want an intersection outside that edge, which happens when the angle is over
             * 180 degrees or the offset exceeds the edge length. */
            const closer: {v: BMVert | null} = {v: null}
            if (e1.offsetR === 0.0 && isOutsideEdge(e1, meetco, closer)) {
                copyV3V3(meetco, co(closer.v!))
            }
            if (e2.offsetL === 0.0 && isOutsideEdge(e2, meetco, closer)) {
                copyV3V3(meetco, co(closer.v!))
            }
            if (edgesBetween && e1.offsetR > 0.0 && e2.offsetL > 0.0) {
                // Try to drop meetco onto a face between e1 and e2.
                if (isectKind === 2) {
                    // The lines did not meet in 3d: take the average of the two nearest points.
                    midV3V3V3(meetco, meetco, isect2)
                }
                for (let e = e1; e !== e2; e = e.next) {
                    const fnext = e.fnext
                    if (!fnext) continue
                    const plane: V4 = [0, 0, 0, 0]
                    planeFromPointNormalV3(plane, co(v), fno(fnext))
                    const dropco = nv3()
                    closestToPlaneNormalizedV3(dropco, plane, meetco)
                    // Do not drop to the faces next to the in-plane edge.
                    if (eInPlane) {
                        ang = angleV3V3(fno(fnext), fno(eInPlane.fnext!))
                        if (Math.abs(ang) < BEVEL_SMALL_ANG || Math.abs(ang - Math.PI) < BEVEL_SMALL_ANG) {
                            continue
                        }
                    }
                    if (pointBetweenEdges(dropco, v, fnext, e, e.next)) {
                        copyV3V3(meetco, dropco)
                        break
                    }
                }
            }
        }
    }
}

/**
 * `BEVEL_GOOD_ANGLE` (`:2073`). Blender's comment records that this has been retuned twice - from
 * 0.25 to 0.0001 for #44961, then to 0.1 for #86768 and #95335 - so it is a fix, not a taste value.
 */
export const BEVEL_GOOD_ANGLE = 0.1

/**
 * `offset_meet_edge` (`:2083`) - the meeting point when one of the two edges has zero offsets.
 *
 * Returns false, with `rAngle.angle` still filled in, when there is no usable meeting point: the
 * angle is degenerate, reflex, or a straight line. A reflex angle reports `2pi - ang` and false.
 */
export function offsetMeetEdge(
    e1: EdgeHalf, e2: EdgeHalf, v: BMVert, meetco: V3, rAngle: {angle: number} | null,
): boolean {
    const dir1 = nv3()
    const dir2 = nv3()
    subV3V3V3(dir1, co(edgeOtherVert(e1.e, v)), co(v))
    subV3V3V3(dir2, co(edgeOtherVert(e2.e, v)), co(v))
    normalizeV3(dir1)
    normalizeV3(dir2)

    // The angle from dir1 to dir2 as seen from the vertex normal side.
    let ang = angleNormalizedV3V3(dir1, dir2)
    if (Math.abs(ang) < BEVEL_GOOD_ANGLE) {
        if (rAngle) rAngle.angle = 0.0
        return false
    }
    const fnoV = nv3()
    crossV3V3V3(fnoV, dir1, dir2)
    if (dotV3V3(fnoV, vno(v)) < 0) {
        ang = 2.0 * Math.PI - ang // The angle is reflex.
        if (rAngle) rAngle.angle = ang
        return false
    }
    if (rAngle) rAngle.angle = ang

    if (Math.abs(ang - Math.PI) < BEVEL_GOOD_ANGLE) {
        return false
    }

    const sinang = Math.sin(ang)

    copyV3V3(meetco, co(v))
    if (e1.offsetR === 0.0) {
        maddV3V3Fl(meetco, dir1, e2.offsetL / sinang)
    } else {
        maddV3V3Fl(meetco, dir2, e1.offsetR / sinang)
    }
    return true
}

/** `good_offset_on_edge_between` (`:2133`) - neither side sees a reflex angle. */
export function goodOffsetOnEdgeBetween(e1: EdgeHalf, e2: EdgeHalf, emid: EdgeHalf, v: BMVert): boolean {
    const meet = nv3()
    const ang = {angle: 0}
    return offsetMeetEdge(e1, emid, v, meet, ang) && offsetMeetEdge(emid, e2, v, meet, ang)
}

/**
 * `offset_on_edge_between` (`:2149`) - put the meeting point on the in-between edge `emid`.
 *
 * CCW order seen from the vertex normal side is `e1`, `emid`, `e2`, and `emid` is not itself beveled.
 * Returns true when the point is a genuine compromise between where the two offset lines met `emid`,
 * in which case `rSinratio.value` carries the ratio of the sines of the two angles - that ratio is
 * what lets the profile be drawn with the right proportions on an unequal corner.
 *
 * For `percent` and `absolute` there is no compromise to make: slide along `emid` by the requested
 * amount and return true.
 */
export function offsetOnEdgeBetween(
    bp: BevelParams, e1: EdgeHalf, e2: EdgeHalf, emid: EdgeHalf, v: BMVert,
    meetco: V3, rSinratio: {value: number} | null,
): boolean {
    let retval = false

    const meet1 = nv3()
    const meet2 = nv3()
    const a1 = {angle: 0}
    const a2 = {angle: 0}
    const ok1 = offsetMeetEdge(e1, emid, v, meet1, a1)
    const ok2 = offsetMeetEdge(emid, e2, v, meet2, a2)
    const ang1 = a1.angle
    const ang2 = a2.angle
    if (bp.offsetType === BEVEL_AMT.PERCENT || bp.offsetType === BEVEL_AMT.ABSOLUTE) {
        const v2 = edgeOtherVert(emid.e, v)
        if (bp.offsetType === BEVEL_AMT.PERCENT) {
            // `bp->use_weights` is out of scope, so Blender's `wt` is 1.
            interpV3V3V3(meetco, co(v), co(v2), bp.offset / 100.0)
        } else {
            const dir = nv3()
            subV3V3V3(dir, co(v2), co(v))
            normalizeV3(dir)
            maddV3V3V3Fl(meetco, co(v), dir, bp.offset)
        }
        if (rSinratio) {
            rSinratio.value = ang1 === 0.0 ? 1.0 : Math.sin(ang2) / Math.sin(ang1)
        }
        return true
    }
    if (ok1 && ok2) {
        midV3V3V3(meetco, meet1, meet2)
        if (rSinratio) {
            // ang1 should not be 0, but be paranoid.
            rSinratio.value = ang1 === 0.0 ? 1.0 : Math.sin(ang2) / Math.sin(ang1)
        }
        retval = true
    } else if (ok1 && !ok2) {
        copyV3V3(meetco, meet1)
    } else if (!ok1 && ok2) {
        copyV3V3(meetco, meet2)
    } else {
        // Neither offset line met emid. Only happens when all three lines are on top of each other.
        slideDist(emid, v, e1.offsetR, meetco)
    }

    return retval
}

/**
 * `offset_in_plane` (`:2213`) - offset by `e`'s offset in the plane with normal `planeNo`, to the
 * left or right. With no plane, any plane other than the edge's own direction will do.
 */
export function offsetInPlane(e: EdgeHalf, planeNo: readonly number[] | null, left: boolean, rCo: V3): void {
    const v = e.isRev ? e.e.v2 : e.e.v1

    const dir = nv3()
    const no = nv3()
    subV3V3V3(dir, co(edgeOtherVert(e.e, v)), co(v))
    normalizeV3(dir)
    if (planeNo) {
        copyV3V3(no, planeNo)
    } else {
        zeroV3(no)
        if (Math.abs(dir[0]) < Math.abs(dir[1])) {
            no[0] = 1.0
        } else {
            no[1] = 1.0
        }
    }

    const fdir = nv3()
    if (left) {
        crossV3V3V3(fdir, dir, no)
    } else {
        crossV3V3V3(fdir, no, dir)
    }
    normalizeV3(fdir)
    copyV3V3(rCo, co(v))
    maddV3V3Fl(rCo, fdir, left ? e.offsetL : e.offsetR)
}

/**
 * `project_to_edge` (`:2246`) - the point on `e` closest to the line `(coA, coB)`.
 *
 * Blender only asserts on failure under `BEVEL_ASSERT_PROJECT`, which is off by default, and
 * otherwise falls back to `e->v1`; reproduced, because a degenerate profile here must not abort a
 * whole bevel.
 */
export function projectToEdge(e: BMEdge, coA: readonly number[], coB: readonly number[], projco: V3): void {
    const otherco = nv3()
    if (!isectLineLineV3(co(e.v1), co(e.v2), coA, coB, projco, otherco)) {
        copyV3V3(projco, co(e.v1))
    }
}
