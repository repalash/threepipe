/**
 * Port of Blender geometry node operations used in procedural generation.
 *
 * Each function corresponds to one or more Blender geometry nodes.
 * Source references point to the Blender source tree at:
 *   .repos/blender-gn-source/source/blender/
 */

export type Vec2 = [number, number]

export interface CurveSegment {
    from: Vec2
    to: Vec2
}

// ─── Math node (WRAP) ───────────────────────────────────────────────
// source: nodes/function/nodes/node_fn_math.cc — MATH_WRAP
// Not a direct port but replicates the angle normalization used throughout.

/** Normalize angle to [-PI, PI], equivalent to Math node WRAP operation. */
export function normalizeAngle(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI
    while (a < -Math.PI) a += 2 * Math.PI
    return a
}

// ─── Align Euler to Vector ──────────────────────────────────────────
// source: nodes/function/nodes/node_fn_align_euler_to_vector.cc
//
// Computes the Y-axis rotation that aligns a module's forward direction
// to the outward-facing normal of a polygon edge. This is a simplified
// version for the 2D footprint case (rotation around Y only).

/** Compute outward-facing wall rotation for a polygon edge (three.js Y-up). */
export function alignEulerToEdgeNormal(x0: number, z0: number, x1: number, z1: number): number {
    const dx = x1 - x0, dz = z1 - z0
    const len = Math.sqrt(dx * dx + dz * dz)
    // Outward normal (90° CW for CCW polygon): normX = dz/len, normZ = -dx/len
    return normalizeAngle(Math.atan2(dz / len, -dx / len))
}

// ─── Sample point on segment ────────────────────────────────────────
// source: blenlib/intern/math_geom.c — closest_to_line_segment_v2
//
// Projects a point onto a line segment and returns the parameter t ∈ (0,1)
// if the point lies on the segment, or null otherwise.

/** Check if a point lies on a segment, return parameter t or null. */
export function pointOnSegment(fp: Vec2, x0: number, z0: number, x1: number, z1: number): number | null {
    const dx = x1 - x0, dz = z1 - z0
    const len2 = dx * dx + dz * dz
    const t = ((fp[0] - x0) * dx + (fp[1] - z0) * dz) / len2
    if (t < 0.01 || t > 0.99) return null
    if (Math.abs(x0 + t * dx - fp[0]) > 0.01 || Math.abs(z0 + t * dz - fp[1]) > 0.01) return null
    return t
}

// ─── Mesh to Curve + Split Edges + Trim Curve ───────────────────────
// source: nodes/geometry/nodes/node_geo_mesh_to_curve.cc
// source: nodes/geometry/nodes/node_geo_edge_split.cc
// source: nodes/geometry/nodes/node_geo_curve_trim.cc
//
// In Buildify, the base polygon is converted to curves (one per edge),
// then edges are split at flat pillar positions into individual segments.
// This function replicates that entire chain: for each polygon edge,
// find any flat pillars that lie on it, split into sub-segments.

/** Split polygon edges at flat pillar positions into curve segments. */
export function meshToCurveSplitTrim(corners: Vec2[], splitPoints: Vec2[]): CurveSegment[] {
    const segs: CurveSegment[] = []
    for (let i = 0; i < corners.length; i++) {
        const j = (i + 1) % corners.length
        const [x0, z0] = corners[i], [x1, z1] = corners[j]

        // Find split points on this edge
        const splits: {pos: Vec2, t: number}[] = []
        for (const fp of splitPoints) {
            const t = pointOnSegment(fp, x0, z0, x1, z1)
            if (t !== null) splits.push({pos: fp, t})
        }
        splits.sort((a, b) => a.t - b.t)

        // Create sub-segments
        let sx = x0, sz = z0
        for (const sp of splits) {
            segs.push({from: [sx, sz], to: [sp.pos[0], sp.pos[1]]})
            sx = sp.pos[0]; sz = sp.pos[1]
        }
        segs.push({from: [sx, sz], to: [x1, z1]})
    }
    return segs
}

// ─── Resample Curve (LENGTH mode) ───────────────────────────────────
// source: nodes/geometry/nodes/node_geo_curve_resample.cc
//
// Resamples a curve segment at regular intervals determined by module width.
// Returns center positions of each module slot along the segment.

/** Resample a segment into evenly-spaced module center positions. */
export function resampleCurve(
    seg: CurveSegment, moduleWidth: number, offset = 0,
): {x: number, z: number}[] {
    const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1]
    const len = Math.sqrt(dx * dx + dz * dz)
    const dirX = dx / len, dirZ = dz / len
    const usable = len - 2 * offset
    const n = Math.max(1, Math.round(usable / moduleWidth))
    const spacing = usable / n
    const points: {x: number, z: number}[] = []
    for (let i = 0; i < n; i++) {
        const t = offset + (i + 0.5) * spacing
        points.push({x: seg.from[0] + dirX * t, z: seg.from[1] + dirZ * t})
    }
    return points
}
