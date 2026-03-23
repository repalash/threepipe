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

// ─── Mesh Grid ──────────────────────────────────────────────────────
// source: nodes/geometry/nodes/node_geo_mesh_primitive_grid.cc
//
// Creates a grid of points in the XY plane (Blender convention).
// Returns vertex positions and face indices.

export interface GridPoint {
    x: number
    y: number
    z: number
    /** Index in the grid (row * cols + col) */
    index: number
    /** Column index */
    col: number
    /** Row index */
    row: number
}

/** Create a grid of points. Matches Blender's Grid node (vertices, not faces).
 *  Blender iterates X first (column-major): for each X column, all Y rows. */
export function meshGrid(
    sizeX: number, sizeY: number,
    verticesX: number, verticesY: number,
): GridPoint[] {
    const nx = Math.max(2, verticesX)
    const ny = Math.max(2, verticesY)
    const points: GridPoint[] = []
    // Column-major order to match Blender's vertex ordering
    for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
            points.push({
                x: (ix / (nx - 1) - 0.5) * sizeX,
                y: (iy / (ny - 1) - 0.5) * sizeY,
                z: 0,
                index: ix * ny + iy,
                col: ix,
                row: iy,
            })
        }
    }
    return points
}

// ─── Separate Geometry ──────────────────────────────────────────────
// source: nodes/geometry/nodes/node_geo_separate_geometry.cc
//
// Splits an array into two parts based on a boolean selection per element.

/** Split an array by a boolean selection. Returns [selected, inverted]. */
export function separateGeometry<T>(
    items: T[],
    selection: boolean[],
): [selected: T[], inverted: T[]] {
    const selected: T[] = []
    const inverted: T[] = []
    for (let i = 0; i < items.length; i++) {
        if (selection[i]) selected.push(items[i])
        else inverted.push(items[i])
    }
    return [selected, inverted]
}

// ─── Named Attributes ──────────────────────────────────────────────
// source: nodes/geometry/nodes/node_geo_input_named_attribute.cc
// source: nodes/geometry/nodes/node_geo_store_named_attribute.cc
//
// Simple key-value store per element. In our system, attributes are stored
// as properties on the point/element objects.

/** Store a named attribute on each element. Mutates in place. */
export function storeNamedAttribute(
    items: Record<string, any>[],
    name: string,
    values: any[],
): void {
    for (let i = 0; i < items.length; i++) {
        items[i][name] = values[i]
    }
}

/** Read a named attribute from each element. Returns array of values. */
export function inputNamedAttribute(
    items: Record<string, any>[],
    name: string,
): any[] {
    return items.map(item => item[name])
}

// ─── from_loc_rot_scale (EulerXYZ) ─────────────────────────────────
// source: blenlib/BLI_math_matrix.hh — from_loc_rot_scale, from_rotation(EulerXYZBase)
//
// Computes a 4x4 column-major world matrix from position, EulerXYZ rotation, and scale.
// This is the core of Instance on Points (node_geo_instance_on_points.cc line 109):
//   dst_transform = math::from_loc_rot_scale<float4x4>(positions[i], rotations[i], scales[i])
//
// The rotation matrix for EulerXYZ (BLI_math_matrix.hh lines 991-1018):
//   mat[col][row] with: i=x, j=y, k=z
//   mat[0][0] = cos_j * cos_k
//   mat[1][0] = sin_j * sin_i_cos_k - cos_i_sin_k
//   mat[2][0] = sin_j * cos_i_cos_k + sin_i_sin_k
//   mat[0][1] = cos_j * sin_k
//   mat[1][1] = sin_j * sin_i_sin_k + cos_i_cos_k
//   mat[2][1] = sin_j * cos_i_sin_k - sin_i_cos_k
//   mat[0][2] = -sin_j
//   mat[1][2] = cos_j * sin_i
//   mat[2][2] = cos_j * cos_i
//
// Then: result = R * S (scale applied per-column), location set directly.

/** Build a 4x4 column-major world matrix from position, EulerXYZ rotation (radians), and scale. */
export function fromLocRotScale(
    px: number, py: number, pz: number,
    rx: number, ry: number, rz: number,
    sx: number, sy: number, sz: number,
): number[] {
    const ci = Math.cos(rx), si = Math.sin(rx)
    const cj = Math.cos(ry), sj = Math.sin(ry)
    const ck = Math.cos(rz), sk = Math.sin(rz)
    const ci_ck = ci * ck, ci_sk = ci * sk
    const si_ck = si * ck, si_sk = si * sk

    // Rotation matrix (column-major: mat[col][row])
    const r00 = cj * ck
    const r10 = sj * si_ck - ci_sk
    const r20 = sj * ci_ck + si_sk
    const r01 = cj * sk
    const r11 = sj * si_sk + ci_ck
    const r21 = sj * ci_sk - si_ck
    const r02 = -sj
    const r12 = cj * si
    const r22 = cj * ci

    // R * S (scale applied per-column) + location
    // Column-major output: [col0, col1, col2, col3]
    return [
        r00 * sx, r01 * sx, r02 * sx, 0,  // col 0 (X axis * sx)
        r10 * sy, r11 * sy, r12 * sy, 0,  // col 1 (Y axis * sy)
        r20 * sz, r21 * sz, r22 * sz, 0,  // col 2 (Z axis * sz)
        px, py, pz, 1,                      // col 3 (translation)
    ]
}

// ─── Join Geometry ──────────────────────────────────────────────────
// source: nodes/geometry/nodes/node_geo_join_geometry.cc
//
// Concatenates geometry arrays in input link order.
// The point indices in the result are sequential: first input's points get indices
// 0..N-1, second input starts at N, etc. This ordering is critical for downstream
// nodes that use point indices (randomBool, randomInt, Instance on Points Pick Instance).

/** Join geometry arrays in order. Returns concatenated array with sequential indices. */
export function joinGeometry<T>(...arrays: T[][]): T[] {
    const result: T[] = []
    for (const arr of arrays) {
        for (const item of arr) result.push(item)
    }
    return result
}

// ─── Transform Geometry (Components mode) ───────────────────────────
// source: nodes/geometry/nodes/node_geo_transform_geometry.cc
//
// In Components mode: builds a 4x4 matrix from (translation, rotation, scale)
// using from_loc_rot_scale, then transforms all point positions.
// When rotation is identity and scale is (1,1,1), it's a pure translation.

/** Transform point positions: new_pos = pos * scale + translation (simplified for common case). */
export function transformPoints<T extends {x: number, y: number, z: number}>(
    points: T[],
    tx: number, ty: number, tz: number,
    sx = 1, sy = 1, sz = 1,
): T[] {
    return points.map(p => ({...p, x: p.x * sx + tx, y: p.y * sy + ty, z: p.z * sz + tz}))
}
