/**
 * Sweep - carry a closed profile section along a path, which is what Blender's Curve to Mesh node
 * does when you plug a Curve Circle into its Profile socket. Every bent pipe, grab rail, towing
 * shackle and lifting handle on a hard-surface model is this operator.
 *
 * Two ports live here, and they are independent of each other.
 *
 * 1. **Frames.** `calculate_tangents`, `calculate_normals_z_up` and `calculate_normals_minimum`
 *    from `source/blender/blenkernel/intern/curve_poly.cc`. The minimum-twist variant is the
 *    rotation-minimising frame transport that stops a swept tube from corkscrewing: each normal is
 *    the previous one rotated the same way the tangent rotated, so no twist is introduced beyond
 *    what the path itself forces. For a cyclic path the frame does not generally come back to where
 *    it started - the holonomy of the transport is not zero - so Blender measures the gap and
 *    spreads it evenly around the loop rather than leaving it all in one seam. That correction is
 *    ported here too; see {@link calculateNormalsMinimum} for what it does and does not guarantee.
 *
 * 2. **Topology.** `curve_to_mesh_sweep` and its helpers (`segments_num_no_duplicate_edge`,
 *    `has_caps`, `fill_mesh_topology`, `build_point_matrix`, `fill_mesh_positions`,
 *    `calculate_result_offsets`, `foreach_curve_combination`) from
 *    `source/blender/blenkernel/intern/curve_to_mesh_convert.cc`. The general form takes any number
 *    of main and profile curves and emits one tube per combination; the public {@link sweep} takes
 *    one path and one section, but the offset plumbing is ported intact because it is what makes
 *    the index arithmetic in `fillMeshTopology` readable, and because every index in that function
 *    is relative to those offsets.
 *
 * Blender emits **quads** for the tube and a single **n-gon** per cap, never triangles, and this
 * does the same. Tessellation is `bake.ts`'s job, not the generator's.
 *
 * Deliberately not ported, because the inputs do not exist here: curve evaluation (Bezier/NURBS to
 * a polyline - the path arrives already evaluated), the `tilt` point attribute that
 * `CurvesGeometry::evaluated_normals` applies on top of the frame normals, `NORMAL_MODE_FREE` with
 * custom normals, `mark_bezier_vector_edges_sharp`, and the generic attribute propagation from
 * curve domains onto the mesh.
 */

import {
    Mat4,
    mat4FromBasis,
    mat4Multiply,
    mat4Scale,
    mat4TransformPoint,
    v3add,
    v3cross,
    v3dot,
    v3len,
    v3mul,
    v3normalize,
    v3sub,
    Vec3,
} from '../math'
import {BMesh} from '../bmesh/BMesh'
import {BMEdge, BMFace, BMVert} from '../bmesh/types'
import {MeshData} from '../MeshData'
import {AttrDomain, AttrName, ElemFlag} from '../constants'

// region blenlib math the frame code needs

/** `safe_asinf` (`blenlib/intern/math_base_safe_inline.cc:49`) - `asin` with the argument clamped. */
function safeAsin(a: number): number {
    return Math.asin(a < -1 ? -1 : a > 1 ? 1 : a)
}

/**
 * `math::is_zero` (`blenlib/BLI_math_vector.hh:779`) - every component within `epsilon` of zero.
 * Note this is not a length test; Blender avoids the square root deliberately.
 */
function v3isZero(a: Vec3, epsilon = 0): boolean {
    return Math.abs(a[0]) <= epsilon && Math.abs(a[1]) <= epsilon && Math.abs(a[2]) <= epsilon
}

/**
 * `angle_normalized_v3v3` (`blenlib/intern/math_vector.cc:336`). Both arguments must be unit.
 *
 * The same value as `acos(dot(a, b))`, but `acos` loses most of its significant digits near 0 and
 * near PI, which is exactly where the frame transport spends its time - almost-parallel tangents.
 * The chord form is accurate there.
 */
export function angleNormalized(v1: Vec3, v2: Vec3): number {
    if (v3dot(v1, v2) >= 0) {
        return 2 * safeAsin(v3len(v3sub(v1, v2)) / 2)
    }
    const v2n: Vec3 = [-v2[0], -v2[1], -v2[2]]
    return Math.PI - 2 * safeAsin(v3len(v3sub(v1, v2n)) / 2)
}

/** `angle_v3v3` (`blenlib/intern/math_vector.cc:276`) - normalise, then {@link angleNormalized}. */
function angleBetween(a: Vec3, b: Vec3): number {
    return angleNormalized(v3normalize(a), v3normalize(b))
}

/** `project_plane_normalized_v3_v3v3` (`blenlib/intern/math_vector.cc:529`). `vPlane` must be unit. */
function projectPlaneNormalized(p: Vec3, vPlane: Vec3): Vec3 {
    return v3sub(p, v3mul(vPlane, v3dot(p, vPlane)))
}

/**
 * `angle_signed_on_axis_v3v3_v3` (`blenlib/intern/math_vector.cc:379`). The angle from `v1` to `v2`
 * measured in the plane perpendicular to `axis`, in `[0, 2 * PI)` rather than `(-PI, PI]`.
 */
export function angleSignedOnAxis(v1: Vec3, v2: Vec3, axis: Vec3): number {
    const v1Proj = projectPlaneNormalized(v1, axis)
    const v2Proj = projectPlaneNormalized(v2, axis)
    let angle = angleBetween(v1Proj, v2Proj)
    // Recover the sign from which side of the axis the projections cross to.
    const tproj = v3cross(v2Proj, v1Proj)
    if (v3dot(tproj, axis) < 0) angle = Math.PI * 2 - angle
    return angle
}

/**
 * `rotate_direction_around_axis` (`blenlib/intern/math_rotation.cc:112`). `axis` must be unit, and
 * `direction` must be unit unless it is zero.
 *
 * Rodrigues, split into the component along the axis (which the rotation leaves alone) and the
 * component in the plane (which it turns).
 */
export function rotateDirectionAroundAxis(direction: Vec3, axis: Vec3, angle: number): Vec3 {
    if (angle === 0 || v3isZero(direction, Number.EPSILON)) return direction

    const axisScaled = v3mul(axis, v3dot(direction, axis))
    const diff = v3sub(direction, axisScaled)
    const cross = v3cross(axis, diff)

    return v3add(axisScaled, v3add(v3mul(diff, Math.cos(angle)), v3mul(cross, Math.sin(angle))))
}

// endregion

// region frames - curve_poly.cc

/** Which rule orients the section around the path. Blender's `NormalMode`. */
export type NormalMode = 'minimumTwist' | 'zUp'

/**
 * `delta_dir` (`curve_poly.cc:16`). Returns the unit direction from `pos` to `next`, or null when
 * the two are closer together than the epsilon - the caller then keeps whatever it had.
 */
function deltaDir(pos: Vec3, next: Vec3): Vec3 | null {
    const epsilon = 1.0e-9

    const delta = v3sub(next, pos)
    const norm = v3len(delta)
    if (norm < epsilon) return null
    return v3mul(delta, 1 / norm)
}

/**
 * State carried between `direction_bisect` calls. Blender passes `other_dir` and `is_equal` by
 * mutable reference; JS has no equivalent, so the pair travels in an object.
 */
interface BisectState {
    /** Blender's `other_dir`: the direction of the last non-degenerate segment seen. */
    dir: Vec3
    /** Blender's `is_equal`: whether the previous call's segment was degenerate. */
    isEqual: boolean
}

/**
 * `direction_bisect` (`curve_poly.cc:33`) - an approximate tangent from the normalised sum of the
 * directions to the neighbouring points.
 *
 * Three degenerate cases, all of them load-bearing and all of them from the source:
 * - a zero-length segment reuses the previous direction, so coincident path points do not destroy
 *   the frame; the point still produces a ring, it just shares its neighbour's orientation;
 * - after a zero-length segment the previous direction is not adjacent any more, so the next
 *   segment's direction is used raw rather than bisected;
 * - a sharp reversal makes `prev + next` cancel, and the sum loses all its precision (#146332), so
 *   below ~45 degrees between segments the bisector is rebuilt from a cross product instead.
 */
function directionBisect(pos: Vec3, next: Vec3, state: BisectState): Vec3 {
    const epsilon = 1.0e-9
    const prevEqual = state.isEqual

    const nextDelta = v3sub(next, pos)
    const nextNorm = v3len(nextDelta)
    state.isEqual = nextNorm < epsilon
    if (state.isEqual) {
        /* Return the direction relative the 'previous' point. If `prevEqual` is true, this will
         * return the direction of the last non-zero segment. */
        return state.dir
    }

    const prevDir = state.dir
    state.dir = v3mul(nextDelta, 1 / nextNorm)
    if (prevEqual) {
        /* Return the direction of the next segment as previous direction is not an adjacent
         * segment! */
        return state.dir
    }
    const tangent = v3add(prevDir, state.dir)
    const norm = v3len(tangent)
    if (norm < 0.6627619) { /* Approximates angle between segments < 45 degrees. */
        if (norm < 2e-7) { /* Approximately < sin(1e-5) */
            return state.dir
        }
        /* Compute using the cross product, as catastrophic cancellation occurs in `tangent` when
         * the sum approaches 0, leading to significant numerical errors (see #146332). */
        const binormal = v3cross(state.dir, prevDir)
        const normal = v3sub(state.dir, prevDir)
        return v3normalize(v3cross(binormal, normal))
    }
    return v3mul(tangent, 1 / norm)
}

/**
 * Unit tangent per path point. Port of `calculate_tangents` (`curve_poly.cc:74`).
 *
 * The two ends of an open path take the direction of their one segment; interior points take the
 * bisector of the two segments meeting there. A cyclic path bisects at both ends as well, using the
 * closing segment. A path whose points are all coincident falls back to +Z, and leading degenerate
 * segments copy the first real tangent backwards.
 */
export function calculateTangents(positions: Vec3[], isCyclic: boolean): Vec3[] {
    const tangents: Vec3[] = positions.map((): Vec3 => [0, 0, 0])

    if (positions.length === 0) return tangents

    if (positions.length === 1) {
        tangents[0] = [0, 0, 1]
        return tangents
    }

    /* Find an initial valid tangent. */
    let firstValidIndex = -1
    for (let i = 0; i < positions.length - 1; i++) {
        const d = deltaDir(positions[i], positions[i + 1])
        if (d) {
            tangents[i] = d
            firstValidIndex = i
            break
        }
    }

    if (firstValidIndex === -1) {
        /* If all tangents used the fallback, it means that all positions are (almost) the same.
         * Just use the up-vector as default tangent. */
        for (let i = 0; i < tangents.length; i++) tangents[i] = [0, 0, 1]
        return tangents
    }
    if (firstValidIndex > 0) {
        for (let i = 0; i < firstValidIndex; i++) tangents[i] = [...tangents[firstValidIndex]] as Vec3
    }

    /* Calculate curve tangents using the delta from previous iteration(s). */
    const state: BisectState = {dir: tangents[firstValidIndex], isEqual: false}
    for (let i = firstValidIndex + 1; i < positions.length - 1; i++) {
        tangents[i] = directionBisect(positions[i], positions[i + 1], state)
    }

    const last = positions.length - 1
    if (isCyclic) {
        const first = positions[0]
        tangents[last] = directionBisect(positions[last], first, state)
        tangents[0] = directionBisect(first, positions[1], state)
    } else {
        const d = deltaDir(positions[last - 1], positions[last])
        tangents[last] = d ?? state.dir
    }

    return tangents
}

/**
 * Port of `calculate_normals_z_up` (`curve_poly.cc:126`).
 *
 * The normal is the tangent turned a quarter turn about Z, so the section keeps a consistent "up"
 * in world space. Cheap and stable, but a path that climbs and turns at once makes the section
 * rotate about the path, which is the corkscrew {@link calculateNormalsMinimum} exists to avoid.
 * A tangent that points straight up or down has no such direction, and falls back to +X - the same
 * fallback and the same epsilon as `vec_to_quat`.
 */
export function calculateNormalsZUp(tangents: Vec3[]): Vec3[] {
    /* Same as in `vec_to_quat`. */
    const epsilon = 1e-4
    return tangents.map((tangent): Vec3 => {
        if (Math.abs(tangent[0]) + Math.abs(tangent[1]) < epsilon) {
            return [1, 0, 0]
        }
        return v3normalize([tangent[1], -tangent[0], 0])
    })
}

/**
 * Rotate the last normal in the same way the tangent has been rotated.
 * Port of `calculate_next_normal` (`curve_poly.cc:146`).
 */
function calculateNextNormal(lastNormal: Vec3, lastTangent: Vec3, currentTangent: Vec3): Vec3 {
    if (v3isZero(lastTangent) || v3isZero(currentTangent)) {
        return lastNormal
    }
    const angle = angleNormalized(lastTangent, currentTangent)
    if (angle !== 0) {
        const axis = v3normalize(v3cross(lastTangent, currentTangent))
        if (!v3isZero(axis)) {
            /* The iterative process here (computing the current normal by rotating the previous
             * one) can accumulate small floating point errors, leading to 'not enough' normalized
             * results at some point (see #121169). */
            return v3normalize(rotateDirectionAroundAxis(lastNormal, axis, angle))
        }
    }
    return lastNormal
}

/**
 * Port of `calculate_normals_minimum` (`curve_poly.cc:166`) - rotation-minimising frames.
 *
 * The first normal is the Z-up one, and every following normal is the previous one carried through
 * the same rotation that took the previous tangent to this one. No twist is added anywhere, so the
 * section arrives at the far end of a bent pipe in the orientation it started in.
 *
 * For `cyclic`, the frame carried all the way round does not generally land back on the first
 * normal; the residue is the holonomy of the path and is a property of its shape, not a bug. A
 * generator that ignored it would leave the whole gap concentrated in the seam between the last
 * ring and the first, which is visible as a pinch. Blender measures the gap and rotates normal `i`
 * by `gap * i / n`, which does not remove the gap - nothing can - but spreads it evenly, so the
 * twist between *every* consecutive pair of rings, the wrap-around pair included, is the same
 * `gap / n`. That uniformity is the property to test for, not a zero seam.
 */
export function calculateNormalsMinimum(tangents: Vec3[], cyclic: boolean): Vec3[] {
    const normals: Vec3[] = tangents.map((): Vec3 => [0, 0, 0])
    if (normals.length === 0) return normals

    const epsilon = 1e-4

    /* Set initial normal. */
    const firstTangent = tangents[0]
    if (Math.abs(firstTangent[0]) + Math.abs(firstTangent[1]) < epsilon) {
        normals[0] = [1, 0, 0]
    } else {
        normals[0] = v3normalize([firstTangent[1], -firstTangent[0], 0])
    }

    /* Forward normal with minimum twist along the entire curve. */
    for (let i = 1; i < normals.length; i++) {
        normals[i] = calculateNextNormal(normals[i - 1], tangents[i - 1], tangents[i])
    }

    if (!cyclic) {
        return normals
    }

    /* Compute how much the first normal deviates from the normal that has been forwarded along the
     * entire cyclic curve. */
    const last = normals.length - 1
    const uncorrectedLastNormal = calculateNextNormal(normals[last], tangents[last], tangents[0])
    let correctionAngle = angleSignedOnAxis(normals[0], uncorrectedLastNormal, tangents[0])
    if (correctionAngle > Math.PI) {
        correctionAngle = correctionAngle - 2 * Math.PI
    }

    /* Gradually apply correction by rotating all normals slightly around their tangents. */
    const angleStep = correctionAngle / normals.length
    for (let i = 0; i < normals.length; i++) {
        const axis = tangents[i]
        if (v3isZero(axis)) continue
        const angle = angleStep * i
        normals[i] = rotateDirectionAroundAxis(normals[i], axis, angle)
    }

    return normals
}

/** Tangents and normals together, choosing the normal rule. Blender's `evaluated_normals` switch. */
export function calculateFrames(
    positions: Vec3[], cyclic: boolean, normalMode: NormalMode = 'minimumTwist',
): {tangents: Vec3[], normals: Vec3[]} {
    const tangents = calculateTangents(positions, cyclic)
    const normals = normalMode === 'zUp'
        ? calculateNormalsZUp(tangents)
        : calculateNormalsMinimum(tangents, cyclic)
    return {tangents, normals}
}

// endregion

// region topology - curve_to_mesh_convert.cc

/** `curves::segments_num` (`BKE_curves.hh:574`). */
function segmentsNum(pointsNum: number, cyclic: boolean): number {
    return cyclic && pointsNum > 1 ? pointsNum : pointsNum - 1
}

/**
 * `segments_num_no_duplicate_edge` (`curve_to_mesh_convert.cc:20`). A two-point cyclic curve would
 * otherwise close with a second edge on top of the first one.
 */
function segmentsNumNoDuplicateEdge(pointsNum: number, cyclic: boolean): number {
    if (pointsNum === 0) return 0
    if (pointsNum <= 2) return segmentsNum(pointsNum, false)
    return segmentsNum(pointsNum, cyclic)
}

/**
 * `has_caps` (`curve_to_mesh_convert.cc:31`). Only an open path with a closed section has ends to
 * cap, and a section of two segments or fewer would cap with a degenerate n-gon.
 */
function hasCaps(mainCyclic: boolean, profileCyclic: boolean, profileSegmentNum: number): boolean {
    return !mainCyclic && profileCyclic && profileSegmentNum > 2
}

/** A polyline in, and out of, the sweep. One of Blender's `CurvesGeometry` curves. */
export interface SweepCurve {
    /** Evaluated points; no Bezier or NURBS evaluation happens here. */
    positions: Vec3[]
    /** Closes the polyline back onto its first point. Blender's `cyclic` point attribute. */
    cyclic?: boolean
    /** Only meaningful for the main curve. Blender's per-curve `normal_mode`. */
    normalMode?: NormalMode
}

/** The flat arrays `fillMeshTopology` writes into - `Mesh`'s edge, corner and face-offset spans. */
interface TopologyBuffers {
    edges: Int32Array
    cornerVerts: Int32Array
    cornerEdges: Int32Array
    faceOffsets: Int32Array
}

/**
 * Port of `fill_mesh_topology` (`curve_to_mesh_convert.cc:38`).
 *
 * Writes one tube into the shared arrays at the given offsets. The layout, which every index below
 * depends on, is: vertices ring by ring; then all the edges running *along* the path (grouped by
 * profile index, `mainSegmentNum` of them each); then all the edges running *around* each ring
 * (grouped by ring, `profileSegmentNum` of them each); then one quad per (ring segment, profile
 * segment) pair; then, if capped, two n-gons.
 */
function fillMeshTopology(
    vertOffset: number,
    edgeOffset: number,
    faceOffset: number,
    loopOffset: number,
    mainPointNum: number,
    profilePointNum: number,
    mainCyclic: boolean,
    profileCyclic: boolean,
    fillCaps: boolean,
    buffers: TopologyBuffers,
): void {
    const {edges, cornerVerts, cornerEdges, faceOffsets} = buffers
    const mainSegmentNum = segmentsNumNoDuplicateEdge(mainPointNum, mainCyclic)
    const profileSegmentNum = segmentsNum(profilePointNum, profileCyclic)

    if (profilePointNum === 1) {
        // A single profile point degenerates to a polyline: edges, no faces.
        for (let i = 0; i < mainPointNum - 1; i++) {
            edges[(edgeOffset + i) * 2] = vertOffset + i
            edges[(edgeOffset + i) * 2 + 1] = vertOffset + i + 1
        }

        if (mainCyclic && mainSegmentNum > 2) {
            const e = edgeOffset + mainSegmentNum - 1
            edges[e * 2] = vertOffset + mainPointNum - 1
            edges[e * 2 + 1] = vertOffset
        }
        return
    }

    /* Add the edges running along the length of the curve, starting at each profile vertex. */
    const mainEdgesStart = edgeOffset
    for (let iProfile = 0; iProfile < profilePointNum; iProfile++) {
        const profileEdgeOffset = mainEdgesStart + iProfile * mainSegmentNum
        for (let iRing = 0; iRing < mainSegmentNum; iRing++) {
            const iNextRing = iRing === mainPointNum - 1 ? 0 : iRing + 1

            const ringVertOffset = vertOffset + profilePointNum * iRing
            const nextRingVertOffset = vertOffset + profilePointNum * iNextRing

            const e = profileEdgeOffset + iRing
            edges[e * 2] = ringVertOffset + iProfile
            edges[e * 2 + 1] = nextRingVertOffset + iProfile
        }
    }

    /* Add the edges running along each profile ring. */
    const profileEdgesStart = mainEdgesStart + profilePointNum * mainSegmentNum
    for (let iRing = 0; iRing < mainPointNum; iRing++) {
        const ringVertOffset = vertOffset + profilePointNum * iRing

        const ringEdgeOffset = profileEdgesStart + iRing * profileSegmentNum
        for (let iProfile = 0; iProfile < profileSegmentNum; iProfile++) {
            const iNextProfile = iProfile === profilePointNum - 1 ? 0 : iProfile + 1

            const e = ringEdgeOffset + iProfile
            edges[e * 2] = ringVertOffset + iProfile
            edges[e * 2 + 1] = ringVertOffset + iNextProfile
        }
    }

    /* Calculate face and corner indices. */
    for (let iRing = 0; iRing < mainSegmentNum; iRing++) {
        const iNextRing = iRing === mainPointNum - 1 ? 0 : iRing + 1

        const ringVertOffset = vertOffset + profilePointNum * iRing
        const nextRingVertOffset = vertOffset + profilePointNum * iNextRing

        const ringEdgeStart = profileEdgesStart + profileSegmentNum * iRing
        const nextRingEdgeOffset = profileEdgesStart + profileSegmentNum * iNextRing

        const ringFaceOffset = faceOffset + iRing * profileSegmentNum
        const ringLoopOffset = loopOffset + iRing * profileSegmentNum * 4

        for (let iProfile = 0; iProfile < profileSegmentNum; iProfile++) {
            const ringSegmentLoopOffset = ringLoopOffset + iProfile * 4
            const iNextProfile = iProfile === profilePointNum - 1 ? 0 : iProfile + 1

            const mainEdgeStart = mainEdgesStart + mainSegmentNum * iProfile
            const nextMainEdgeStart = mainEdgesStart + mainSegmentNum * iNextProfile

            faceOffsets[ringFaceOffset + iProfile] = ringSegmentLoopOffset

            cornerVerts[ringSegmentLoopOffset] = ringVertOffset + iProfile
            cornerEdges[ringSegmentLoopOffset] = ringEdgeStart + iProfile

            cornerVerts[ringSegmentLoopOffset + 1] = ringVertOffset + iNextProfile
            cornerEdges[ringSegmentLoopOffset + 1] = nextMainEdgeStart + iRing

            cornerVerts[ringSegmentLoopOffset + 2] = nextRingVertOffset + iNextProfile
            cornerEdges[ringSegmentLoopOffset + 2] = nextRingEdgeOffset + iProfile

            cornerVerts[ringSegmentLoopOffset + 3] = nextRingVertOffset + iProfile
            cornerEdges[ringSegmentLoopOffset + 3] = mainEdgeStart + iRing
        }
    }

    if (fillCaps && hasCaps(mainCyclic, profileCyclic, profileSegmentNum)) {
        const faceNum = mainSegmentNum * profileSegmentNum
        const capLoopOffset = loopOffset + faceNum * 4
        const capFaceOffset = faceOffset + faceNum

        faceOffsets[capFaceOffset] = capLoopOffset
        faceOffsets[capFaceOffset + 1] = capLoopOffset + profileSegmentNum

        const lastRingIndex = mainPointNum - 1
        const lastRingVertOffset = vertOffset + profilePointNum * lastRingIndex
        const lastRingEdgeOffset = profileEdgesStart + profileSegmentNum * lastRingIndex

        // The start cap walks the first ring backwards so it faces away from the tube; the end cap
        // walks the last ring forwards, for the same reason.
        for (let i = 0; i < profileSegmentNum; i++) {
            const iInv = profileSegmentNum - i - 1
            cornerVerts[capLoopOffset + i] = vertOffset + iInv
            cornerEdges[capLoopOffset + i] = profileEdgesStart +
                (i === profileSegmentNum - 1 ? profileSegmentNum - 1 : iInv - 1)
            cornerVerts[capLoopOffset + profileSegmentNum + i] = lastRingVertOffset + i
            cornerEdges[capLoopOffset + profileSegmentNum + i] = lastRingEdgeOffset + i
        }
    }
}

/**
 * Port of `build_point_matrix` (`curve_to_mesh_convert.cc:163`). The section's local XY plane maps
 * onto (X axis, Y axis) and its local Z onto the third axis, so a flat profile ends up
 * perpendicular to whatever is passed as the Z axis.
 */
function buildPointMatrix(location: Vec3, tangent: Vec3, normal: Vec3): Mat4 {
    /* Normal and tangent may not be orthogonal in case of custom normals. */
    return mat4FromBasis(tangent, v3normalize(v3cross(normal, tangent)), normal, location)
}

/**
 * Port of `fill_mesh_positions` (`curve_to_mesh_convert.cc:176`).
 *
 * Note the deliberate argument swap at the `buildPointMatrix` call, which is in Blender too: the
 * *normal* is handed in as the matrix's X axis and the *tangent* as its Z axis, so the profile's
 * own XY plane lands in the plane perpendicular to the path and profile X runs along the frame
 * normal. Reading it as `(location, tangent, normal)` gives a tube lying along the section instead
 * of the path.
 */
function fillMeshPositions(
    mainPointNum: number,
    profilePointNum: number,
    mainPositions: Vec3[],
    profilePositions: Vec3[],
    tangents: Vec3[],
    normals: Vec3[],
    scales: number[] | null,
    meshPositions: Float32Array,
    vertOffset: number,
): void {
    const write = (index: number, p: Vec3) => {
        meshPositions[index * 3] = p[0]
        meshPositions[index * 3 + 1] = p[1]
        meshPositions[index * 3 + 2] = p[2]
    }
    if (profilePointNum === 1) {
        for (let iRing = 0; iRing < mainPointNum; iRing++) {
            let pointMatrix = buildPointMatrix(mainPositions[iRing], normals[iRing], tangents[iRing])
            if (scales) {
                pointMatrix = mat4Multiply(pointMatrix, mat4Scale([scales[iRing], scales[iRing], scales[iRing]]))
            }
            write(vertOffset + iRing, mat4TransformPoint(pointMatrix, profilePositions[0]))
        }
    } else {
        for (let iRing = 0; iRing < mainPointNum; iRing++) {
            let pointMatrix = buildPointMatrix(mainPositions[iRing], normals[iRing], tangents[iRing])
            if (scales) {
                pointMatrix = mat4Multiply(pointMatrix, mat4Scale([scales[iRing], scales[iRing], scales[iRing]]))
            }

            const ringVertStart = vertOffset + iRing * profilePointNum
            for (let iProfile = 0; iProfile < profilePointNum; iProfile++) {
                write(ringVertStart + iProfile, mat4TransformPoint(pointMatrix, profilePositions[iProfile]))
            }
        }
    }
}

/** Port of `ResultOffsets` (`curve_to_mesh_convert.cc:235`). */
interface ResultOffsets {
    /** The total number of curve combinations. */
    total: number
    /** Offsets into the result mesh for each combination; `total + 1` entries. */
    vert: number[]
    edge: number[]
    loop: number[]
    face: number[]
    /* The indices of the main and profile curves that form each combination. */
    mainIndices: number[]
    profileIndices: number[]
    /** Whether any curve in the profile or curve input has only a single evaluated point. */
    anySinglePointMain: boolean
    anySinglePointProfile: boolean
}

/**
 * Port of `calculate_result_offsets` (`curve_to_mesh_convert.cc:253`), minus the threading.
 *
 * The element counts per combination are the whole arithmetic of the generator, so they are worth
 * reading directly: one vertex per (path point, profile point); one edge per (path point, profile
 * *segment*) for the rings plus one per (path *segment*, profile point) running along; one quad per
 * (path segment, profile segment) plus two cap n-gons; four corners per quad plus one per profile
 * segment per cap.
 */
function calculateResultOffsets(
    main: SweepCurve[], profile: SweepCurve[], fillCaps: boolean,
): ResultOffsets {
    const total = main.length * profile.length
    const result: ResultOffsets = {
        total,
        vert: new Array(total + 1).fill(0),
        edge: new Array(total + 1).fill(0),
        loop: new Array(total + 1).fill(0),
        face: new Array(total + 1).fill(0),
        mainIndices: new Array(total).fill(0),
        profileIndices: new Array(total).fill(0),
        anySinglePointMain: main.some(c => c.positions.length === 1),
        anySinglePointProfile: profile.some(c => c.positions.length === 1),
    }

    let meshIndex = 0
    let vertOffset = 0
    let edgeOffset = 0
    let loopOffset = 0
    let faceOffset = 0
    for (let iMain = 0; iMain < main.length; iMain++) {
        const mainCyclic = !!main[iMain].cyclic
        const mainPointNum = main[iMain].positions.length
        const mainSegmentNum = segmentsNumNoDuplicateEdge(mainPointNum, mainCyclic)
        for (let iProfile = 0; iProfile < profile.length; iProfile++) {
            result.vert[meshIndex] = vertOffset
            result.edge[meshIndex] = edgeOffset
            result.loop[meshIndex] = loopOffset
            result.face[meshIndex] = faceOffset

            const profileCyclic = !!profile[iProfile].cyclic
            const profilePointNum = profile[iProfile].positions.length
            // Blender does not advance `meshIndex` here, so the next combination reuses the slot.
            // The entry points reject empty curves, which is the only way this can be reached.
            if (profilePointNum === 0) continue
            const profileSegmentNum = segmentsNum(profilePointNum, profileCyclic)

            const caps = fillCaps && hasCaps(mainCyclic, profileCyclic, profileSegmentNum)
            const tubeFaceNum = mainSegmentNum * profileSegmentNum

            vertOffset += mainPointNum * profilePointNum

            /* Add the ring edges, with one ring for every curve vertex, and the edge loops that run
             * along the length of the curve, starting on the first profile. */
            edgeOffset += mainPointNum * profileSegmentNum + mainSegmentNum * profilePointNum

            /* Add two cap N-gons for every ending. */
            faceOffset += tubeFaceNum + (caps ? 2 : 0)

            /* All faces on the tube are quads, and all cap faces are N-gons with an edge for each
             * profile edge. */
            loopOffset += tubeFaceNum * 4 + (caps ? profileSegmentNum * 2 : 0)

            meshIndex++
        }
    }

    result.vert[total] = vertOffset
    result.edge[total] = edgeOffset
    result.loop[total] = loopOffset
    result.face[total] = faceOffset

    meshIndex = 0
    for (let iMain = 0; iMain < main.length; iMain++) {
        for (let iProfile = 0; iProfile < profile.length; iProfile++) {
            result.mainIndices[meshIndex] = iMain
            result.profileIndices[meshIndex] = iProfile
            meshIndex++
        }
    }

    return result
}

/** Information at a specific combination of main and profile curves. Blender's `CombinationInfo`. */
interface CombinationInfo {
    iMain: number
    iProfile: number
    mainPointNum: number
    profilePointNum: number
    mainCyclic: boolean
    profileCyclic: boolean
    mainSegmentNum: number
    profileSegmentNum: number
    vertStart: number
    edgeStart: number
    faceStart: number
    loopStart: number
}

/** Port of `foreach_curve_combination` (`curve_to_mesh_convert.cc:450`), minus the threading. */
function foreachCurveCombination(
    main: SweepCurve[], profile: SweepCurve[], offsets: ResultOffsets,
    fn: (info: CombinationInfo) => void,
): void {
    for (let i = 0; i < offsets.total; i++) {
        const iMain = offsets.mainIndices[i]
        const iProfile = offsets.profileIndices[i]

        const mainPointNum = main[iMain].positions.length
        const profilePointNum = profile[iProfile].positions.length
        if (mainPointNum === 0 || profilePointNum === 0) continue

        const mainCyclic = !!main[iMain].cyclic
        const profileCyclic = !!profile[iProfile].cyclic

        fn({
            iMain,
            iProfile,
            mainPointNum,
            profilePointNum,
            mainCyclic,
            profileCyclic,
            mainSegmentNum: segmentsNum(mainPointNum, mainCyclic),
            profileSegmentNum: segmentsNum(profilePointNum, profileCyclic),
            vertStart: offsets.vert[i],
            edgeStart: offsets.edge[i],
            faceStart: offsets.face[i],
            loopStart: offsets.loop[i],
        })
    }
}

/** Options for {@link curveToMeshSweep}, matching `curve_to_mesh_sweep`'s trailing arguments. */
export interface CurveToMeshSweepOptions {
    /** Blender's `fill_caps`: close the two ends of every open tube with an n-gon. */
    fillCaps?: boolean
    /**
     * Blender's `scales` VArray: a uniform scale of the section per main-curve point, the "radius"
     * spline attribute. One entry per point of every main curve, concatenated in curve order.
     */
    scales?: number[]
}

/**
 * Port of `curve_to_mesh_sweep` (`curve_to_mesh_convert.cc:833`).
 *
 * Sweeps every profile curve along every main curve and returns all of the tubes as one mesh, or
 * null when the combination produces nothing. This is the general entry point; {@link sweep} and
 * {@link primitiveSweep} are the single-path wrappers the command API uses.
 */
export function curveToMeshSweep(
    main: SweepCurve[], profile: SweepCurve[], options: CurveToMeshSweepOptions = {},
): MeshData | null {
    const fillCaps = !!options.fillCaps
    for (const c of [...main, ...profile]) {
        if (!c.positions.length) throw new Error('mesh-kernel: sweep: a curve has no points')
    }

    const offsets = calculateResultOffsets(main, profile, fillCaps)
    if (offsets.vert[offsets.total] === 0) return null

    const mesh = new MeshData()
    mesh.resize({
        verts: offsets.vert[offsets.total],
        edges: offsets.edge[offsets.total],
        faces: offsets.face[offsets.total],
        corners: offsets.loop[offsets.total],
    })

    const buffers: TopologyBuffers = {
        edges: mesh.edgeVerts,
        cornerVerts: mesh.cornerVerts,
        cornerEdges: mesh.cornerEdges,
        faceOffsets: mesh.faceOffsets,
    }

    foreachCurveCombination(main, profile, offsets, info => {
        fillMeshTopology(
            info.vertStart, info.edgeStart, info.faceStart, info.loopStart,
            info.mainPointNum, info.profilePointNum,
            info.mainCyclic, info.profileCyclic, fillCaps,
            buffers)
    })
    // Blender's `Mesh` allocates the offsets array with the terminator already in place; ours is
    // sized by `resize`, so close it here.
    mesh.faceOffsets[mesh.facesNum] = mesh.cornersNum

    // Frames, one set per main curve. Blender caches these on the CurvesGeometry.
    const mainFrames = main.map(c => calculateFrames(c.positions, !!c.cyclic, c.normalMode))
    const mainPointStart: number[] = []
    let acc = 0
    for (const c of main) {
        mainPointStart.push(acc)
        acc += c.positions.length
    }

    const positions = mesh.positions
    foreachCurveCombination(main, profile, offsets, info => {
        const frames = mainFrames[info.iMain]
        const start = mainPointStart[info.iMain]
        fillMeshPositions(
            info.mainPointNum,
            info.profilePointNum,
            main[info.iMain].positions,
            profile[info.iProfile].positions,
            frames.tangents,
            frames.normals,
            options.scales ? options.scales.slice(start, start + info.mainPointNum) : null,
            positions,
            info.vertStart)
    })

    if (fillCaps) {
        /* Blender marks the caps flat-shaded, and the two ring loops they sit on sharp, so the tube
         * shades smooth right up to a hard edge at each end. */
        const sharpFaces = mesh.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data
        const sharpEdges = mesh.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data
        foreachCurveCombination(main, profile, offsets, info => {
            if (hasCaps(info.mainCyclic, info.profileCyclic, info.profileSegmentNum)) {
                const faceNum = info.mainSegmentNum * info.profileSegmentNum
                sharpFaces[info.faceStart + faceNum] = 1
                sharpFaces[info.faceStart + faceNum + 1] = 1
            }
            if (info.mainCyclic || !info.profileCyclic) return
            const mainEdgesStart = info.edgeStart
            const lastRingIndex = info.mainPointNum - 1
            const profileEdgesStart = mainEdgesStart + info.profilePointNum * info.mainSegmentNum
            const lastRingEdgeOffset = profileEdgesStart + info.profileSegmentNum * lastRingIndex

            for (let i = 0; i < info.profileSegmentNum; i++) {
                sharpEdges[profileEdgesStart + i] = 1
                sharpEdges[lastRingEdgeOffset + i] = 1
            }
        })
    }

    return mesh
}

// endregion

// region the public sweep command

/**
 * The profile of Blender's Curve Circle node in radius mode.
 * Port of `create_radius_circle_curve` (`node_geo_curve_primitive_circle.cc:158`).
 */
export function circleProfile(radius: number, resolution: number): Vec3[] {
    const positions: Vec3[] = new Array(resolution)
    const thetaStep = 2 * Math.PI / resolution
    for (let i = 0; i < resolution; i++) {
        const theta = thetaStep * i
        positions[i] = [radius * Math.cos(theta), radius * Math.sin(theta), 0]
    }
    return positions
}

export interface SweepOptions {
    /** The path to sweep along. */
    path: Vec3[]
    /** Circular section radius. Ignored when `profile` is given. */
    radius?: number
    /** Circular section segment count. Blender's profile resolution. Default 8. */
    steps?: number
    /** An arbitrary section in the local XY plane, replacing the circle. */
    profile?: ([number, number] | Vec3)[]
    /** Close the path into a loop. Blender's `cyclic`. */
    closed?: boolean
    /** Cap the two open ends with n-gons. Blender's `fill_caps`. */
    capEnds?: boolean
    /** Normal mode - Blender's `NormalMode`. */
    normalMode?: NormalMode
}

/** Everything {@link sweep} and {@link primitiveSweep} agree on before calling the port. */
function sweepInputs(opts: SweepOptions): {main: SweepCurve[], profile: SweepCurve[], fillCaps: boolean} {
    if (!opts.path || opts.path.length < 1) {
        throw new Error('mesh-kernel: sweep needs at least one path point')
    }
    const steps = opts.steps ?? 8
    const profilePositions: Vec3[] = opts.profile
        ? opts.profile.map(p => [p[0], p[1], p.length > 2 ? (p as Vec3)[2] : 0])
        : circleProfile(opts.radius ?? 1, steps)
    if (!profilePositions.length) {
        throw new Error('mesh-kernel: sweep needs at least one profile point')
    }
    return {
        main: [{positions: opts.path, cyclic: !!opts.closed, normalMode: opts.normalMode ?? 'minimumTwist'}],
        // The section is a closed loop, which is what makes the result a tube rather than a ribbon,
        // and what `hasCaps` requires before it will cap anything.
        profile: [{positions: profilePositions, cyclic: true}],
        fillCaps: !!opts.capEnds,
    }
}

/**
 * Sweep a section along a path, adding the result to `bm`.
 *
 * The mesh is built by the {@link curveToMeshSweep} port and then linked into the BMesh, rather than
 * built twice, so the two entry points cannot drift apart. Existing elements of `bm` are untouched;
 * the returned arrays are the new ones, in Blender's index order.
 */
export function sweep(bm: BMesh, opts: SweepOptions): {verts: BMVert[], edges: BMEdge[], faces: BMFace[]} {
    const {main, profile, fillCaps} = sweepInputs(opts)
    const mesh = curveToMeshSweep(main, profile, {fillCaps})
    if (!mesh) return {verts: [], edges: [], faces: []}
    return appendMeshData(bm, mesh)
}

/** Sweep a section along a path as a standalone mesh. */
export function primitiveSweep(opts: SweepOptions): MeshData {
    const {main, profile, fillCaps} = sweepInputs(opts)
    const mesh = curveToMeshSweep(main, profile, {fillCaps})
    if (!mesh) throw new Error('mesh-kernel: sweep produced no geometry')
    return mesh
}

/**
 * Link a generated {@link MeshData} into an existing {@link BMesh}, preserving element order so the
 * returned arrays can be indexed the way the generator indexed them.
 *
 * Edges are created explicitly rather than left to `faceCreate`, because the generator already
 * decided which edge each corner uses and two rings of a two-segment profile legitimately share
 * their endpoints.
 */
function appendMeshData(bm: BMesh, mesh: MeshData): {verts: BMVert[], edges: BMEdge[], faces: BMFace[]} {
    const positions = mesh.positions
    const verts: BMVert[] = new Array(mesh.vertsNum)
    for (let i = 0; i < mesh.vertsNum; i++) {
        verts[i] = bm.vertCreate(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    }

    const edgeVerts = mesh.edgeVerts
    const edges: BMEdge[] = new Array(mesh.edgesNum)
    for (let e = 0; e < mesh.edgesNum; e++) {
        edges[e] = bm.edgeCreate(verts[edgeVerts[e * 2]], verts[edgeVerts[e * 2 + 1]])
    }

    const cornerVerts = mesh.cornerVerts
    const cornerEdges = mesh.cornerEdges
    const faces: BMFace[] = new Array(mesh.facesNum)
    for (let f = 0; f < mesh.facesNum; f++) {
        const start = mesh.faceOffsets[f]
        const end = mesh.faceOffsets[f + 1]
        const fv: BMVert[] = new Array(end - start)
        const fe: BMEdge[] = new Array(end - start)
        for (let c = start; c < end; c++) {
            fv[c - start] = verts[cornerVerts[c]]
            fe[c - start] = edges[cornerEdges[c]]
        }
        faces[f] = bm.faceCreateWithEdges(fv, fe)
    }

    // `sharp_edge` and `sharp_face` are the inverse of the BMesh SMOOTH flag - see `bmToMesh`.
    //
    // Set it both ways, exactly as `bmFromMesh` does. Blender's curve-to-mesh writes into a Mesh,
    // where the *absence* of `sharp_face` means smooth, and marks only the caps sharp; a new BMesh
    // face is flat (`bm_face_create__internal`, `bmesh_core.cc:493`). Only clearing the flag would
    // leave the swept sides flat and give a faceted tube.
    const sharpEdge = mesh.attributes.get(AttrName.sharpEdge)
    for (let e = 0; e < mesh.edgesNum; e++) {
        if (sharpEdge?.data[e]) edges[e].hflag &= ~ElemFlag.Smooth
        else edges[e].hflag |= ElemFlag.Smooth
    }
    const sharpFace = mesh.attributes.get(AttrName.sharpFace)
    for (let f = 0; f < mesh.facesNum; f++) {
        if (sharpFace?.data[f]) faces[f].hflag &= ~ElemFlag.Smooth
        else faces[f].hflag |= ElemFlag.Smooth
    }

    return {verts, edges, faces}
}

// endregion
