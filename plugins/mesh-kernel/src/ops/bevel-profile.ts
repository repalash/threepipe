/**
 * Profiles: the shape of the cross section between the two sides of a beveled edge.
 *
 * Ported from `bmesh_bevel.cc:2262-2830` (parameters and evaluation) and `:7623-8010` (the even
 * chord spacing). At `segments: 1` there is no profile at all, just a chamfer between the two
 * boundary verts. Above that the intermediate points lie on a superellipse
 * `|x|^r + |y|^r = 1`, spaced so the chords between consecutive points are of *equal length* rather
 * than equally spaced in the parameter - which for `r != 1` are very different things.
 *
 * The exponent comes from the user's `profile` slider as `r = -log(2) / log(sqrt(profile))`, so
 * `profile = 0.5` gives `r = 2`, a circular arc; `profile -> 1` gives a square outside corner and
 * `profile -> 0` a square inside one.
 *
 * Only four exponents have a closed-form even spacing (line, circle, square-out, square-in). Every
 * other one goes through {@link findEvenSuperellipseChordsGeneral}, an iterative relaxation that
 * Blender deliberately runs in `double` because the result would not otherwise be accurate to float
 * precision. This port is in JS `number`, which is that same `double`.
 */

import {
    M4, V3, addV3V3, addV3V3V3, angleV3V3, copyV3V3, crossV3V3V3, interpV3V3V3, isZeroV3,
    isectLinePlaneV3, lenV3V3, maxFf, maxIi, minFf, mulV3Fl, mulV3M4V3, normalizeV3, nv3, subV3V3,
    subV3V3V3, unitM4,
} from './bevel-math'
import {
    BEVEL_AFFECT, BEVEL_EPSILON, BEVEL_EPSILON_ANG, BEVEL_EPSILON_BIG, BEVEL_PROFILE, BevVert,
    BevelParams, BoundVert, PRO_CIRCLE_R, PRO_LINE_R, PRO_SQUARE_IN_R, PRO_SQUARE_R, Profile,
    ProfileSpacing,
} from './bevel-types'
import {co} from './bevel-bmquery'
import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {faceEdgeShareLoopQ} from './bevel-bmquery'
import {isectLineLineV3, dotV3V3, midV3V3V3, negateV3} from './bevel-math'
import {nearlyParallel, projectToEdge} from './bevel-offset'

/** `power_of_2_max_i` (`BLI_math_base.h`) - the smallest power of two at or above `n`. */
export function powerOf2MaxI(n: number): number {
    let p = 1
    while (p < n) p *= 2
    return p
}

/**
 * `set_profile_params` (`:2262`) - fill in a bound vert's profile control points and its projection
 * plane.
 *
 * The mid control point is the point on the beveled edge closest to the chord from this bound vert
 * to the next. The interesting branch is the collinear one: when start, middle and end line up there
 * is no plane through them, and Blender moves the profile onto the plane it believes the user
 * expects - the one containing the original vertex - so that a multi-segment bevel curves in that
 * plane instead of collapsing to a straight line. Which point becomes the new middle depends on
 * whether the neighbouring edges are themselves beveled.
 */
export function setProfileParams(bp: BevelParams, bv: BevVert, bndv: BoundVert): void {
    let doLinearInterp = true
    const e = bndv.ebev
    const pro = bndv.profile

    const start = nv3()
    const end = nv3()
    copyV3V3(start, bndv.nv.co)
    copyV3V3(end, bndv.next.nv.co)
    if (e) {
        doLinearInterp = false
        pro.superR = bp.proSuperR
        // The projection direction is the direction of the edge.
        subV3V3V3(pro.projDir, co(e.e.v1), co(e.e.v2))
        if (e.isRev) {
            negateV3(pro.projDir)
        }
        normalizeV3(pro.projDir)
        projectToEdge(e.e, start, end, pro.middle)
        copyV3V3(pro.start, start)
        copyV3V3(pro.end, end)
        // The default plane to project onto is the one holding the triangle start-middle-end.
        const d1 = nv3()
        const d2 = nv3()
        subV3V3V3(d1, pro.middle, start)
        subV3V3V3(d2, pro.middle, end)
        normalizeV3(d1)
        normalizeV3(d2)
        crossV3V3V3(pro.planeNo, d1, d2)
        normalizeV3(pro.planeNo)
        if (nearlyParallel(d1, d2)) {
            /* start - middle - end are collinear. The beveled edge should then be coplanar with the
             * two boundary verts, and we want the profile on that common plane so multi-segment
             * bevels curve in it, which is what users expect. The new middle is either the original
             * vertex (when the neighbour edges are unbeveled) or the meeting point of the offset
             * lines (when they are beveled). */
            copyV3V3(pro.middle, co(bv.v))
            if (e.prev.isBev && e.next.isBev && bv.selcount >= 3) {
                // The mid point should be where the next and prev offset edges meet.
                const d3 = nv3()
                const d4 = nv3()
                const co4 = nv3()
                const meetco = nv3()
                const isect2 = nv3()

                subV3V3V3(d3, co(e.prev.e.v1), co(e.prev.e.v2))
                subV3V3V3(d4, co(e.next.e.v1), co(e.next.e.v2))
                normalizeV3(d3)
                normalizeV3(d4)
                if (nearlyParallel(d3, d4)) {
                    // The offset lines are collinear, so fall back to linear interpolation.
                    midV3V3V3(pro.middle, start, end)
                    doLinearInterp = true
                } else {
                    const co3 = nv3()
                    addV3V3V3(co3, start, d3)
                    addV3V3V3(co4, end, d4)
                    const isectKind = isectLineLineV3(start, co3, end, co4, meetco, isect2)
                    if (isectKind !== 0) {
                        copyV3V3(pro.middle, meetco)
                    } else {
                        // The offset lines do not intersect, so fall back to linear interpolation.
                        midV3V3V3(pro.middle, start, end)
                        doLinearInterp = true
                    }
                }
            }
            copyV3V3(pro.end, end)
            subV3V3V3(d1, pro.middle, start)
            normalizeV3(d1)
            subV3V3V3(d2, pro.middle, end)
            normalizeV3(d2)
            crossV3V3V3(pro.planeNo, d1, d2)
            normalizeV3(pro.planeNo)
            if (nearlyParallel(d1, d2)) {
                // The whole profile is collinear with the edge: just interpolate.
                doLinearInterp = true
            } else {
                copyV3V3(pro.planeCo, co(bv.v))
                copyV3V3(pro.projDir, pro.planeNo)
            }
        }
        copyV3V3(pro.planeCo, start)
    } else if (bndv.isArcStart) {
        // `pro.middle` was already set by the miter code.
        copyV3V3(pro.start, start)
        copyV3V3(pro.end, end)
        pro.superR = PRO_CIRCLE_R
        pro.planeCo[0] = pro.planeCo[1] = pro.planeCo[2] = 0
        pro.planeNo[0] = pro.planeNo[1] = pro.planeNo[2] = 0
        pro.projDir[0] = pro.projDir[1] = pro.projDir[2] = 0
        doLinearInterp = false
    } else if (bp.affectType === BEVEL_AFFECT.VERTICES) {
        copyV3V3(pro.start, start)
        copyV3V3(pro.middle, co(bv.v))
        copyV3V3(pro.end, end)
        pro.superR = bp.proSuperR
        pro.planeCo[0] = pro.planeCo[1] = pro.planeCo[2] = 0
        pro.planeNo[0] = pro.planeNo[1] = pro.planeNo[2] = 0
        pro.projDir[0] = pro.projDir[1] = pro.projDir[2] = 0
        doLinearInterp = false
    }

    if (doLinearInterp) {
        pro.superR = PRO_LINE_R
        copyV3V3(pro.start, start)
        copyV3V3(pro.end, end)
        midV3V3V3(pro.middle, start, end)
        // A line profile does not use the projection.
        pro.planeCo[0] = pro.planeCo[1] = pro.planeCo[2] = 0
        pro.planeNo[0] = pro.planeNo[1] = pro.planeNo[2] = 0
        pro.projDir[0] = pro.projDir[1] = pro.projDir[2] = 0
    }
}

/**
 * `move_profile_plane` (`:2388`) - move a profile's plane onto the one through its start, its end
 * and the original beveled vertex. Only used by `buildBoundaryTerminalEdge`.
 */
export function moveProfilePlane(bndv: BoundVert, bmvert: BMVert): void {
    const pro = bndv.profile

    // Only when projecting, and when start, end and projDir are not coplanar.
    if (isZeroV3(pro.projDir)) {
        return
    }

    const d1 = nv3()
    const d2 = nv3()
    subV3V3V3(d1, co(bmvert), pro.start)
    normalizeV3(d1)
    subV3V3V3(d2, co(bmvert), pro.end)
    normalizeV3(d2)
    const no = nv3()
    const no2 = nv3()
    const no3 = nv3()
    crossV3V3V3(no, d1, d2)
    crossV3V3V3(no2, d1, pro.projDir)
    crossV3V3V3(no3, d2, pro.projDir)

    if (normalizeV3(no) > BEVEL_EPSILON_BIG && normalizeV3(no2) > BEVEL_EPSILON_BIG &&
        normalizeV3(no3) > BEVEL_EPSILON_BIG) {
        const dot2 = dotV3V3(no, no2)
        const dot3 = dotV3V3(no, no3)
        if (Math.abs(dot2) < 1 - BEVEL_EPSILON_BIG && Math.abs(dot3) < 1 - BEVEL_EPSILON_BIG) {
            copyV3V3(bndv.profile.planeNo, no)
        }
    }

    // The parameters are no longer the defaults, so `calculateVmProfiles` must not reset them.
    pro.specialParams = true
}

/**
 * `move_weld_profile_planes` (`:2428`) - the same for the two bound verts of a weld, where the plane
 * wanted is the one through both of them and the original vertex.
 */
export function moveWeldProfilePlanes(bv: BevVert, bndv1: BoundVert, bndv2: BoundVert): void {
    if (isZeroV3(bndv1.profile.projDir) || isZeroV3(bndv2.profile.projDir)) {
        return
    }
    const d1 = nv3()
    const d2 = nv3()
    const no = nv3()
    subV3V3V3(d1, co(bv.v), bndv1.nv.co)
    subV3V3V3(d2, co(bv.v), bndv2.nv.co)
    crossV3V3V3(no, d1, d2)
    const l1 = normalizeV3(no)

    // `no` is the new projection plane normal, but do not move if it is coplanar with both
    // projection directions.
    const no2 = nv3()
    const no3 = nv3()
    crossV3V3V3(no2, d1, bndv1.profile.projDir)
    const l2 = normalizeV3(no2)
    crossV3V3V3(no3, d2, bndv2.profile.projDir)
    const l3 = normalizeV3(no3)
    if (l1 !== 0.0 && (l2 !== 0.0 || l3 !== 0.0)) {
        const dot1 = Math.abs(dotV3V3(no, no2))
        const dot2 = Math.abs(dotV3V3(no, no3))
        if (Math.abs(dot1 - 1.0) > BEVEL_EPSILON) {
            copyV3V3(bndv1.profile.planeNo, no)
        }
        if (Math.abs(dot2 - 1.0) > BEVEL_EPSILON) {
            copyV3V3(bndv2.profile.planeNo, no)
        }
    }

    bndv1.profile.specialParams = true
    bndv2.profile.specialParams = true
}

/**
 * `bev_ccw_test` (`:2465`) - 1 when `a` and `b` are CCW on the normal side of `f`, -1 when reversed,
 * 0 when they share no such face.
 */
export function bevCcwTest(a: BMEdge, b: BMEdge, f: BMFace | null): number {
    if (!f) return 0
    const la = faceEdgeShareLoopQ(f, a)
    const lb = faceEdgeShareLoopQ(f, b)
    if (!la || !lb) return 0
    return lb.next === la ? 1 : -1
}

/**
 * `make_unit_square_map` (`:2499`).
 *
 * Builds the matrix taking the unit square to the sheared parallelogram whose corners are `va`,
 * `vmid`, `vb` and the implied fourth. The quarter circle in the first quadrant of the unit square
 * becomes the quadrant of a sheared ellipse in the parallelogram, which is how a 2D profile sample
 * becomes a 3D point. Blender derives it as `M = B * inverse(A)` with the inverse done by hand:
 * `(0,1,0) -> va`, `(1,1,0) -> vmid`, `(1,0,0) -> vb`, `(0,1,1) -> vd`.
 *
 * False when the parallelogram is degenerate, which callers take as "use linear interpolation".
 */
export function makeUnitSquareMap(
    va: readonly number[], vmid: readonly number[], vb: readonly number[], rMat: M4,
): boolean {
    const vaVmid = nv3()
    const vbVmid = nv3()
    subV3V3V3(vaVmid, vmid, va)
    subV3V3V3(vbVmid, vmid, vb)

    if (isZeroV3(vaVmid) || isZeroV3(vbVmid)) {
        return false
    }

    if (Math.abs(angleV3V3(vaVmid, vbVmid) - Math.PI) <= BEVEL_EPSILON_ANG) {
        return false
    }

    const vo = nv3()
    const vd = nv3()
    const vddir = nv3()
    subV3V3V3(vo, va, vbVmid)
    crossV3V3V3(vddir, vbVmid, vaVmid)
    normalizeV3(vddir)
    addV3V3V3(vd, vo, vddir)

    /* The columns of m are `vmid - va`, `vmid - vb`, `vmid + vd - va - vb`, `va + vb - vmid`.
     * Blender stores column `i` at `m[i][*]`, which in this flat layout is `rMat[i * 4 + j]`. */
    const c0 = nv3()
    subV3V3V3(c0, vmid, va)
    rMat[0] = c0[0]; rMat[1] = c0[1]; rMat[2] = c0[2]; rMat[3] = 0.0
    const c1 = nv3()
    subV3V3V3(c1, vmid, vb)
    rMat[4] = c1[0]; rMat[5] = c1[1]; rMat[6] = c1[2]; rMat[7] = 0.0
    const c2 = nv3()
    addV3V3V3(c2, vmid, vd)
    subV3V3(c2, va)
    subV3V3(c2, vb)
    rMat[8] = c2[0]; rMat[9] = c2[1]; rMat[10] = c2[2]; rMat[11] = 0.0
    const c3 = nv3()
    addV3V3V3(c3, va, vb)
    subV3V3(c3, vmid)
    rMat[12] = c3[0]; rMat[13] = c3[1]; rMat[14] = c3[2]; rMat[15] = 1.0

    return true
}

/**
 * `make_unit_cube_map` (`:2556`) - the same idea in three dimensions, taking the `(1,1,1)` corner of
 * the unit cube to the corner `vd` with `va`, `vb`, `vc` around it in CCW order.
 */
export function makeUnitCubeMap(
    va: readonly number[], vb: readonly number[], vc: readonly number[], vd: readonly number[], rMat: M4,
): void {
    const c = nv3()

    copyV3V3(c, va); subV3V3(c, vb); subV3V3(c, vc); addV3V3(c, vd); mulV3Fl(c, 0.5)
    rMat[0] = c[0]; rMat[1] = c[1]; rMat[2] = c[2]; rMat[3] = 0.0
    copyV3V3(c, vb); subV3V3(c, va); subV3V3(c, vc); addV3V3(c, vd); mulV3Fl(c, 0.5)
    rMat[4] = c[0]; rMat[5] = c[1]; rMat[6] = c[2]; rMat[7] = 0.0
    copyV3V3(c, vc); subV3V3(c, va); subV3V3(c, vb); addV3V3(c, vd); mulV3Fl(c, 0.5)
    rMat[8] = c[0]; rMat[9] = c[1]; rMat[10] = c[2]; rMat[11] = 0.0
    copyV3V3(c, va); addV3V3(c, vb); addV3V3(c, vc); subV3V3(c, vd); mulV3Fl(c, 0.5)
    rMat[12] = c[0]; rMat[13] = c[1]; rMat[14] = c[2]; rMat[15] = 1.0
}

/**
 * `superellipse_co` (`:2591`) - the point on `x^r + y^r = 1` at parameter `x`.
 *
 * For `r < 1` the function is mirrored about `y = x` first, which keeps the range numerically
 * stable; symmetry makes that free, and the caller mirrors back.
 */
export function superellipseCo(x: number, r: number, rbig: boolean): number {
    if (rbig) {
        return Math.pow(1.0 - Math.pow(x, r), 1.0 / r)
    }
    return 1.0 - Math.pow(1.0 - Math.pow(1.0 - x, r), 1.0 / r)
}

/**
 * `get_profile_point` (`:2612`) - the profile point at index `i` out of `nseg`.
 *
 * `nseg` is either `bp.seg` or a power of two at or below `pro_spacing.seg_2`. In the second case
 * the points are *subsampled* out of `profCo2`, which is deliberately not evenly spaced - the cubic
 * subdivision that consumes them wants the power-of-two parameterisation, not equal chords.
 */
export function getProfilePoint(bp: BevelParams, pro: Profile, i: number, nseg: number, rCo: V3): void {
    if (bp.seg === 1) {
        if (i === 0) {
            copyV3V3(rCo, pro.start)
        } else {
            copyV3V3(rCo, pro.end)
        }
    } else if (nseg === bp.seg) {
        const a = pro.profCo!
        rCo[0] = a[3 * i]
        rCo[1] = a[3 * i + 1]
        rCo[2] = a[3 * i + 2]
    } else {
        const subsampleSpacing = bp.proSpacing.seg2 / nseg
        const a = pro.profCo2!
        const base = 3 * i * subsampleSpacing
        rCo[0] = a[base]
        rCo[1] = a[base + 1]
        rCo[2] = a[base + 2]
    }
}

/** `calculate_profile_segments` (`:2641`) - the 2D samples mapped into 3D and onto the profile plane. */
function calculateProfileSegments(
    profile: Profile, map: M4, useMap: boolean, reversed: boolean, ns: number,
    xvals: Float64Array, yvals: Float64Array, rProfCo: Float64Array,
): void {
    const coV = nv3()
    for (let k = 0; k <= ns; k++) {
        if (k === 0) {
            copyV3V3(coV, profile.start)
        } else if (k === ns) {
            copyV3V3(coV, profile.end)
        } else if (useMap) {
            const p = [
                reversed ? yvals[ns - k] : xvals[k],
                reversed ? xvals[ns - k] : yvals[k],
                0.0,
            ]
            mulV3M4V3(coV, map, p)
        } else {
            interpV3V3V3(coV, profile.start, profile.end, k / ns)
        }
        // Finish by projecting onto the final profile plane.
        if (!isZeroV3(profile.projDir)) {
            const co2 = nv3()
            addV3V3V3(co2, coV, profile.projDir)
            const out = nv3()
            if (!isectLinePlaneV3(out, coV, co2, profile.planeCo, profile.planeNo)) {
                // Should not happen.
                copyV3V3(out, coV)
            }
            rProfCo[3 * k] = out[0]
            rProfCo[3 * k + 1] = out[1]
            rProfCo[3 * k + 2] = out[2]
        } else {
            rProfCo[3 * k] = coV[0]
            rProfCo[3 * k + 1] = coV[1]
            rProfCo[3 * k + 2] = coV[2]
        }
    }
}

/**
 * `calculate_profile` (`:2698`) - fill in a bound vert's `profCo` (and `profCo2` when `seg` is not
 * already a power of two, because the ADJ subdivision needs power-of-two boundaries).
 *
 * @param reversed sample the profile from the other end. Used so that the two sides of one beveled
 *   edge agree about which way round the profile runs.
 * @param miter take the samples from the separate miter spacing table.
 */
export function calculateProfile(bp: BevelParams, bndv: BoundVert, reversed: boolean, miter: boolean): void {
    const pro = bndv.profile
    const proSpacing = miter ? bp.proSpacingMiter : bp.proSpacing

    if (bp.seg === 1) {
        return
    }

    const need2 = bp.seg !== bp.proSpacing.seg2
    if (pro.profCo === null) {
        pro.profCo = new Float64Array(3 * (bp.seg + 1))
        if (need2) {
            pro.profCo2 = new Float64Array(3 * (bp.proSpacing.seg2 + 1))
        } else {
            pro.profCo2 = pro.profCo
        }
    }

    let useMap: boolean
    const map: M4 = unitM4()
    if (bp.profileType === BEVEL_PROFILE.SUPERELLIPSE && pro.superR === PRO_LINE_R) {
        useMap = false
    } else {
        useMap = makeUnitSquareMap(pro.start, pro.middle, pro.end, map)
    }

    if (bp.vmeshMethod === 1 /* BEVEL_VMESH.CUTOFF */ && useMap) {
        /* The "height" of the profile: the (0,0) and (1,1) corners of the untransformed profile put
         * through the 2D->3D map, and the distance between them. */
        const bottomCorner = nv3(0, 0, 0)
        mulV3M4V3(bottomCorner, map, bottomCorner)
        const topCorner = nv3(1, 1, 0)
        mulV3M4V3(topCorner, map, topCorner)
        pro.height = lenV3V3(bottomCorner, topCorner)
    }

    calculateProfileSegments(
        pro, map, useMap, reversed, bp.seg, proSpacing.xvals!, proSpacing.yvals!, pro.profCo)
    if (need2) {
        calculateProfileSegments(
            pro, map, useMap, reversed, bp.proSpacing.seg2,
            proSpacing.xvals2!, proSpacing.yvals2!, pro.profCo2!)
    }
}

/**
 * `snap_to_superellipsoid` (`:2762`) - snap a direction onto the superellipsoid with exponent
 * `superR`. Only used for the pipe and cube-corner special cases.
 *
 * @param midline for a square profile, snap to both planes rather than the closer one.
 */
export function snapToSuperellipsoid(point: V3, superR: number, midline: boolean): void {
    const r = superR
    if (r === PRO_CIRCLE_R) {
        normalizeV3(point)
        return
    }

    const a = maxFf(0.0, point[0])
    const b = maxFf(0.0, point[1])
    const c = maxFf(0.0, point[2])
    let x = a
    let y = b
    let z = c
    if (r === PRO_SQUARE_R || r === PRO_SQUARE_IN_R) {
        // Only called for a 2D profile, where z is already zero.
        z = 0.0
        x = minFf(1.0, x)
        y = minFf(1.0, y)
        if (r === PRO_SQUARE_R) {
            // Snap to whichever of the x == 1 and y == 1 lines is closer, or maybe to both.
            const dx = 1.0 - x
            const dy = 1.0 - y
            if (dx < dy) {
                x = 1.0
                y = midline ? 1.0 : y
            } else {
                y = 1.0
                x = midline ? 1.0 : x
            }
        } else {
            // Snap to whichever of the x == 0 and y == 0 lines is closer, or maybe to both.
            if (x < y) {
                x = 0.0
                y = midline ? 0.0 : y
            } else {
                y = 0.0
                x = midline ? 0.0 : x
            }
        }
    } else {
        const rinv = 1.0 / r
        if (a === 0.0) {
            if (b === 0.0) {
                x = 0.0
                y = 0.0
                z = Math.pow(c, rinv)
            } else {
                x = 0.0
                y = Math.pow(1.0 / (1.0 + Math.pow(c / b, r)), rinv)
                z = c * y / b
            }
        } else {
            x = Math.pow(1.0 / (1.0 + Math.pow(b / a, r) + Math.pow(c / a, r)), rinv)
            y = b * x / a
            z = c * x / a
        }
    }
    point[0] = x
    point[1] = y
    point[2] = z
}

// region even chord spacing (`:7623-8010`)

/**
 * `find_superellipse_chord_endpoint` (`:7627`) - find `xnew > x0` with
 * `distance((x0, y0), (xnew, ynew)) == dtarget`.
 *
 * The Illinois variant of the false-position method, because the function is close enough to linear
 * that linear interpolation converges in a handful of steps. The bracket `[x0 + sqrt(2)/2 * dtarget,
 * x0 + dtarget]` is valid only while the gradient stays between -1 and 1, which the caller ensures
 * by only ever working on half the profile.
 */
export function findSuperellipseChordEndpoint(x0: number, dtarget: number, r: number, rbig: boolean): number {
    const y0 = superellipseCo(x0, r, rbig)
    const tol = 1e-13 // Accumulates over many segments, so it is deliberately tight.
    const maxiter = 10

    let xmin = x0 + Math.SQRT2 / 2.0 * dtarget
    xmin = Math.min(xmin, 1.0)
    let xmax = x0 + dtarget
    xmax = Math.min(xmax, 1.0)
    let ymin = superellipseCo(xmin, r, rbig)
    let ymax = superellipseCo(xmax, r, rbig)

    // Blender's note: using the squared distance does not converge nearly as well.
    let dmaxerr = Math.sqrt((xmax - x0) ** 2 + (ymax - y0) ** 2) - dtarget
    let dminerr = Math.sqrt((xmin - x0) ** 2 + (ymin - y0) ** 2) - dtarget

    let xnew = xmax - dmaxerr * (xmax - xmin) / (dmaxerr - dminerr)
    let lastupdatedUpper = true

    for (let iter = 0; iter < maxiter; iter++) {
        const ynew = superellipseCo(xnew, r, rbig)
        const dnewerr = Math.sqrt((xnew - x0) ** 2 + (ynew - y0) ** 2) - dtarget
        if (Math.abs(dnewerr) < tol) {
            break
        }
        if (dnewerr < 0) {
            xmin = xnew
            ymin = ynew
            dminerr = dnewerr
            if (!lastupdatedUpper) {
                xnew = (dmaxerr / 2 * xmin - dminerr * xmax) / (dmaxerr / 2 - dminerr)
            } else {
                xnew = xmax - dmaxerr * (xmax - xmin) / (dmaxerr - dminerr)
            }
            lastupdatedUpper = false
        } else {
            xmax = xnew
            ymax = ynew
            dmaxerr = dnewerr
            if (lastupdatedUpper) {
                xnew = (dmaxerr * xmin - dminerr / 2 * xmax) / (dmaxerr - dminerr / 2)
            } else {
                xnew = xmax - dmaxerr * (xmax - xmin) / (dmaxerr - dminerr)
            }
            lastupdatedUpper = true
        }
    }
    return xnew
}

/**
 * `find_even_superellipse_chords_general` (`:7691`) - equidistant points in the first quadrant, for
 * any exponent.
 *
 * Only half the profile is solved: the point where the superellipse crosses `y = x` is `mx`, and for
 * `r >= 1` the range `[0, mx]` is solved and mirrored, for `r < 1` the range `[mx, 1]`. Points start
 * linearly spaced and are repositioned until the spread of chord lengths is within tolerance.
 */
export function findEvenSuperellipseChordsGeneral(
    seg: number, r: number, xvals: Float64Array, yvals: Float64Array,
): void {
    const smoothitermax = 10
    const errorTol = 1e-7
    const imax = Math.floor((seg + 1) / 2) - 1 // Ceiling division minus one.

    const segOdd = seg % 2 !== 0

    let rbig: boolean
    let mx: number
    if (r > 1.0) {
        rbig = true
        mx = Math.pow(0.5, 1.0 / r)
    } else {
        rbig = false
        mx = 1 - Math.pow(0.5, 1.0 / r)
    }

    // Initial positions, linearly spaced along the x axis.
    for (let i = 0; i <= imax; i++) {
        xvals[i] = i * mx / seg * 2
        yvals[i] = superellipseCo(xvals[i], r, rbig)
    }
    yvals[0] = 1

    // Smooth distance loop.
    for (let iter = 0; iter < smoothitermax; iter++) {
        let sum = 0.0
        let dmin = 2.0
        let dmax = 0.0
        /* Update the distances between neighbouring points, keeping the highest and lowest so we can
         * tell whether the maximum error against the average - which is not known yet - is within
         * the required precision. */
        for (let i = 0; i < imax; i++) {
            const d = Math.sqrt((xvals[i + 1] - xvals[i]) ** 2 + (yvals[i + 1] - yvals[i]) ** 2)
            sum += d
            dmax = Math.max(d, dmax)
            dmin = Math.min(d, dmin)
        }
        // The last distance is weighted by a half when the segment count is odd.
        let davg: number
        if (segOdd) {
            sum += Math.SQRT2 / 2 * (yvals[imax] - xvals[imax])
            davg = sum / (imax + 0.5)
        } else {
            sum += Math.sqrt((xvals[imax] - mx) ** 2 + (yvals[imax] - mx) ** 2)
            davg = sum / (imax + 1.0)
        }
        let precisionReached = true
        if (dmax - davg > errorTol) {
            precisionReached = false
        }
        if (dmin - davg < errorTol) {
            precisionReached = false
        }
        if (precisionReached) {
            break
        }

        for (let i = 1; i <= imax; i++) {
            xvals[i] = findSuperellipseChordEndpoint(xvals[i - 1], davg, r, rbig)
            yvals[i] = superellipseCo(xvals[i], r, rbig)
        }
    }

    // Fill the remaining half by mirroring about y = x.
    if (!segOdd) {
        xvals[imax + 1] = mx
        yvals[imax + 1] = mx
    }
    for (let i = imax + 1; i <= seg; i++) {
        yvals[i] = xvals[seg - i]
        xvals[i] = yvals[seg - i]
    }

    if (!rbig) {
        for (let i = 0; i <= seg; i++) {
            const temp = xvals[i]
            xvals[i] = 1.0 - yvals[i]
            yvals[i] = 1.0 - temp
        }
    }
}

/**
 * `find_even_superellipse_chords` (`:7787`) - the four closed-form exponents, and the general search
 * for everything else.
 *
 * Note the odd-segment cases for the two square profiles: one chord has to cut the corner, and its
 * length is `sqrt(2)` times a straight one, which is where the `n2 + sqrt(2)/2` divisor comes from.
 */
export function findEvenSuperellipseChords(
    n: number, r: number, xvals: Float64Array, yvals: Float64Array,
): void {
    const segOdd = n % 2 !== 0
    const n2 = Math.floor(n / 2)

    if (r === PRO_LINE_R) {
        // Linear spacing.
        for (let i = 0; i <= n; i++) {
            xvals[i] = i / n
            yvals[i] = 1.0 - i / n
        }
        return
    }
    if (r === PRO_CIRCLE_R) {
        // Equal angle spacing; equal chords on a circle are equal angles.
        const temp = (Math.PI / 2) / n
        for (let i = 0; i <= n; i++) {
            xvals[i] = Math.sin(i * temp)
            yvals[i] = Math.cos(i * temp)
        }
        return
    }
    if (r === PRO_SQUARE_IN_R) {
        if (!segOdd) {
            for (let i = 0; i <= n2; i++) {
                xvals[i] = 0.0
                yvals[i] = 1.0 - i / n2
                xvals[n - i] = yvals[i]
                yvals[n - i] = xvals[i]
            }
        } else {
            const temp = 1.0 / (n2 + Math.SQRT2 / 2.0)
            for (let i = 0; i <= n2; i++) {
                xvals[i] = 0.0
                yvals[i] = 1.0 - i * temp
                xvals[n - i] = yvals[i]
                yvals[n - i] = xvals[i]
            }
        }
        return
    }
    if (r === PRO_SQUARE_R) {
        if (!segOdd) {
            for (let i = 0; i <= n2; i++) {
                xvals[i] = i / n2
                yvals[i] = 1.0
                xvals[n - i] = yvals[i]
                yvals[n - i] = xvals[i]
            }
        } else {
            const temp = 1.0 / (n2 + Math.SQRT2 / 2)
            for (let i = 0; i <= n2; i++) {
                xvals[i] = i * temp
                yvals[i] = 1.0
                xvals[n - i] = yvals[i]
                yvals[n - i] = xvals[i]
            }
        }
        return
    }
    findEvenSuperellipseChordsGeneral(n, r, xvals, yvals)
}

/**
 * `find_profile_fullness` (`:7863`) - how far "out" the profile bulges, used as the starting shape
 * for the ADJ subdivision.
 *
 * The table and the two regression lines are Blender's: an offline optimisation found the fullness
 * giving the closest fit to a sphere at a cube corner, as a function of `r` and the segment count.
 * There is nothing to derive here; the numbers are the answer.
 */
export function findProfileFullness(bp: BevelParams): number {
    const nseg = bp.seg

    const CIRCLE_FULLNESS_SEGS = 11
    const circleFullness = [
        0.0, // nsegs == 1
        0.559, 0.642, 0.551, 0.646, 0.624, 0.646, 0.619, 0.647, 0.639, 0.647,
    ]

    let fullness: number
    if (bp.profileType === BEVEL_PROFILE.CUSTOM) {
        // The average "height" of the profile's sampled points, ends excluded.
        fullness = 0.0
        for (let i = 0; i < nseg; i++) {
            fullness += (bp.proSpacing.xvals![i] + bp.proSpacing.yvals![i]) / (2.0 * nseg)
        }
    } else if (bp.proSuperR === PRO_LINE_R) {
        fullness = 0.0
    } else if (bp.proSuperR === PRO_CIRCLE_R && nseg > 0 && nseg <= CIRCLE_FULLNESS_SEGS) {
        fullness = circleFullness[nseg - 1]
    } else if (nseg % 2 === 0) {
        fullness = 2.4506 * bp.profile - 0.00000300 * nseg - 0.6266
    } else {
        fullness = 2.3635 * bp.profile + 0.000152 * nseg - 0.6060
    }
    return fullness
}

/**
 * `set_profile_spacing` (`:7924`) - fill a {@link ProfileSpacing} with the 2D sample positions.
 *
 * Note the line `bp->pro_spacing.seg_2 = seg_2;`: Blender writes `seg_2` onto the *main* spacing
 * struct even when filling the miter one, so `proSpacingMiter.seg2` stays zero. That is not a
 * transcription slip here - `calculateProfile` only ever reads `bp.proSpacing.seg2`, so the field is
 * never consulted on the miter struct, and changing it would change nothing except the diff.
 */
export function setProfileSpacing(bp: BevelParams, proSpacing: ProfileSpacing, custom: boolean): void {
    const seg = bp.seg

    if (seg <= 1) {
        // With one segment there is no profile information to hold.
        proSpacing.xvals = null
        proSpacing.yvals = null
        proSpacing.xvals2 = null
        proSpacing.yvals2 = null
        proSpacing.seg2 = 0
        return
    }

    if (custom) {
        // `BEVEL_PROFILE_CUSTOM` needs `BKE_curveprofile_init` and the widget's Bezier sample table,
        // neither of which exists here. Out of scope, stated in the `bevel.ts` header. Nothing in
        // this port passes true; the check is here so a future caller finds out immediately.
        throw new Error('mesh-kernel: bevel custom profiles (CurveProfile) are not ported')
    }

    const seg2 = maxIi(powerOf2MaxI(bp.seg), 4)

    bp.proSpacing.seg2 = seg2
    if (seg2 === seg) {
        // Filled in below, once `xvals` exists - Blender aliases the two pointers.
        proSpacing.xvals2 = null
        proSpacing.yvals2 = null
    } else {
        proSpacing.xvals2 = new Float64Array(seg2 + 1)
        proSpacing.yvals2 = new Float64Array(seg2 + 1)
        // `custom` (the CurveProfile widget's sample table) is out of scope; see the bevel.ts header.
        findEvenSuperellipseChords(seg2, bp.proSuperR, proSpacing.xvals2, proSpacing.yvals2)
    }

    proSpacing.xvals = new Float64Array(seg + 1)
    proSpacing.yvals = new Float64Array(seg + 1)
    findEvenSuperellipseChords(seg, bp.proSuperR, proSpacing.xvals, proSpacing.yvals)

    if (seg2 === seg) {
        proSpacing.xvals2 = proSpacing.xvals
        proSpacing.yvals2 = proSpacing.yvals
    }
}

// endregion
