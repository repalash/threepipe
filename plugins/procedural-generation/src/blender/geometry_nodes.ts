/**
 * Port of Blender geometry node operations used in procedural generation.
 *
 * Each function corresponds to one or more Blender geometry nodes.
 * Source references point to the Blender source tree at:
 *   .repos/blender-gn-source/source/blender/
 */

import type {BufferGeometry} from 'threepipe'

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
    if (moduleWidth <= 0) return []
    const dx = seg.to[0] - seg.from[0], dz = seg.to[1] - seg.from[1]
    const len = Math.sqrt(dx * dx + dz * dz)
    if (len === 0) return []
    const dirX = dx / len, dirZ = dz / len
    const usable = len - 2 * offset
    const n = Math.max(1, Math.floor(usable / moduleWidth))
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

/**
 * Convert three.js Y-up coordinates to Blender Z-up coordinates.
 * Use this when positions come from three.js/GLB geometry (e.g. distributePointsOnFaces
 * on a loaded GLB mesh) and need to be passed to fromLocRotScale.
 *
 * three.js Y-up: (x, y, z) where Y is up
 * Blender Z-up:  (x, y, z) where Z is up
 * Mapping: blender_x = three_x, blender_y = -three_z, blender_z = three_y
 */
export function yUpToZUp(x: number, y: number, z: number): [number, number, number] {
    return [x, -z, y]
}

/**
 * Build a 4x4 column-major world matrix from Blender Z-up position + EulerXYZ rotation + scale.
 *
 * IMPORTANT: All inputs must be in Blender Z-up coordinate space.
 * If your positions come from three.js/GLB geometry (Y-up), convert them first:
 *   const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z)
 *   fromLocRotScale(bx, by, bz, rx, ry, rz, sx, sy, sz)
 *
 * The viewer's buildSceneFromInstances() converts the output matrices back to Y-up for rendering.
 */
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

// ─── Rotate Euler (FunctionNodeRotateEuler) ────────────────────────
// source: nodes/function/nodes/node_fn_rotate_euler.cc
//
// Applies a rotation to an existing Euler rotation.
// Supports both EULER and AXIS_ANGLE rotation types,
// in both OBJECT (global) and LOCAL space.

/**
 * Convert Euler XYZ angles to a 3x3 rotation matrix (row-major).
 * source: blenlib/intern/math_rotation.c — eul_to_mat3
 */
export function eulToMat3(rx: number, ry: number, rz: number): number[] {
    const ci = Math.cos(rx), si = Math.sin(rx)
    const cj = Math.cos(ry), sj = Math.sin(ry)
    const ck = Math.cos(rz), sk = Math.sin(rz)
    const cc = ci * ck, cs = ci * sk
    const sc = si * ck, ss = si * sk
    return [
        cj * ck, sj * sc - cs, sj * cc + ss,
        cj * sk, sj * ss + cc, sj * cs - sc,
        -sj, cj * si, cj * ci,
    ]
}

/**
 * Convert axis-angle to a 3x3 rotation matrix (row-major).
 * source: blenlib/intern/math_rotation.c — axis_angle_to_mat3
 */
export function axisAngleToMat3(ax: number, ay: number, az: number, angle: number): number[] {
    const len = Math.sqrt(ax * ax + ay * ay + az * az)
    if (len < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const nx = ax / len, ny = ay / len, nz = az / len
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
    return [
        t * nx * nx + c, t * nx * ny - s * nz, t * nx * nz + s * ny,
        t * nx * ny + s * nz, t * ny * ny + c, t * ny * nz - s * nx,
        t * nx * nz - s * ny, t * ny * nz + s * nx, t * nz * nz + c,
    ]
}

/**
 * Multiply two 3x3 row-major matrices.
 * source: blenlib/BLI_math_matrix.h — mul_m3_m3m3
 */
export function mulMat3(a: number[], b: number[]): number[] {
    const r = new Array(9)
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            r[row * 3 + col] =
                a[row * 3 + 0] * b[0 * 3 + col] +
                a[row * 3 + 1] * b[1 * 3 + col] +
                a[row * 3 + 2] * b[2 * 3 + col]
        }
    }
    return r
}

/**
 * Convert a 3x3 rotation matrix (row-major) to Euler XYZ angles.
 * source: blenlib/intern/math_rotation.c — mat3_to_eul
 */
export function mat3ToEul(m: number[]): [number, number, number] {
    const cy = Math.sqrt(m[0] * m[0] + m[3] * m[3])
    if (cy > 1e-6) {
        return [
            Math.atan2(m[7], m[8]),
            Math.atan2(-m[6], cy),
            Math.atan2(m[3], m[0]),
        ]
    } else {
        return [
            Math.atan2(-m[5], m[4]),
            Math.atan2(-m[6], cy),
            0,
        ]
    }
}

/**
 * Rotate Euler by axis-angle in local space.
 * source: nodes/function/nodes/node_fn_rotate_euler.cc — "Rotate Euler by AxisAngle/Local"
 *
 * Computes: result = mat3_to_eul(eul_to_mat3(input) * axis_angle_to_mat3(axis, angle))
 */
export function rotateEulerAxisAngleLocal(
    inputEuler: [number, number, number],
    axis: [number, number, number],
    angle: number,
): [number, number, number] {
    const inputMat = eulToMat3(inputEuler[0], inputEuler[1], inputEuler[2])
    const rotMat = axisAngleToMat3(axis[0], axis[1], axis[2], angle)
    const resultMat = mulMat3(inputMat, rotMat)
    return mat3ToEul(resultMat)
}

/**
 * Rotate Euler by axis-angle in object (global) space.
 * source: nodes/function/nodes/node_fn_rotate_euler.cc — "Rotate Euler by AxisAngle/Object"
 *
 * Computes: result = mat3_to_eul(axis_angle_to_mat3(axis, angle) * eul_to_mat3(input))
 */
export function rotateEulerAxisAngleObject(
    inputEuler: [number, number, number],
    axis: [number, number, number],
    angle: number,
): [number, number, number] {
    const inputMat = eulToMat3(inputEuler[0], inputEuler[1], inputEuler[2])
    const rotMat = axisAngleToMat3(axis[0], axis[1], axis[2], angle)
    const resultMat = mulMat3(rotMat, inputMat)
    return mat3ToEul(resultMat)
}

// ─── Image Texture Sampling ────────────────────────────────────────
// source: nodes/geometry/nodes/node_geo_image_texture.cc
//
// Samples an image texture at UV coordinates using bilinear interpolation.

/** Raw pixel data for image texture sampling. */
export interface ImageTextureData {
    /** Flat pixel data (RGBA or RGB). */
    data: Uint8Array | Uint8ClampedArray | Float32Array
    width: number
    height: number
    /** Number of channels per pixel (typically 4 for RGBA). */
    channels: number
}

/**
 * Sample the red channel of an image texture at UV coordinates.
 * Uses bilinear interpolation, matching Blender's GeometryNodeImageTexture.
 * Returns a value in [0, 1].
 * source: nodes/geometry/nodes/node_geo_image_texture.cc
 */
export function sampleImageTexture(tex: ImageTextureData | null, u: number, v: number): number {
    if (!tex) return 0.5
    const pu = Math.min(Math.max(u, 0), 1) * (tex.width - 1)
    const pv = Math.min(Math.max(1 - v, 0), 1) * (tex.height - 1) // V flipped
    const x0 = Math.floor(pu), y0 = Math.floor(pv)
    const x1 = Math.min(x0 + 1, tex.width - 1), y1 = Math.min(y0 + 1, tex.height - 1)
    const fx = pu - x0, fy = pv - y0
    const idx = (y: number, x: number) => (y * tex.width + x) * tex.channels
    const scale = tex.data instanceof Float32Array ? 1 : 255
    const c00 = tex.data[idx(y0, x0)] / scale
    const c10 = tex.data[idx(y0, x1)] / scale
    const c01 = tex.data[idx(y1, x0)] / scale
    const c11 = tex.data[idx(y1, x1)] / scale
    return c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy
}

// ─── ColorRamp (ShaderNodeValToRGB) ────────────────────────────────
// source: nodes/shader/nodes/node_shader_valtorgb.cc
//
// Linear interpolation between color stops.

/** Evaluate a linear ColorRamp with 2 stops (returns factor in [0, 1]). */
export function colorRampLinear2(fac: number, pos0: number, pos1: number): number {
    if (fac <= pos0) return 0
    if (fac >= pos1) return 1
    return (fac - pos0) / (pos1 - pos0)
}

// ─── UV interpolation ───────────────────────────────────────────────
// Interpolate UV coordinates at scatter points using barycentric coordinates.
// This is what Blender's Image Texture node does when connected to a UV field
// in a geometry nodes context — it evaluates the UV at each distributed point
// by interpolating the triangle's vertex UVs with the point's bary coords.

/**
 * Interpolate UV coordinates for scattered points.
 * Uses barycentric coordinates and triangle indices from distributePointsOnFaces
 * to interpolate vertex UVs at each scatter point position.
 *
 * @param geometry - The source mesh with UV attribute
 * @param baryCoords - Barycentric coordinates from distributePointsOnFaces
 * @param triIndices - Triangle indices from distributePointsOnFaces
 * @param uvAttrName - Name of the UV attribute (default: 'uv')
 * @returns Array of [u, v] pairs for each scatter point, or null if no UV attribute
 */
export function interpolateScatterUVs(
    geometry: BufferGeometry,
    baryCoords: [number, number, number][],
    triIndices: number[],
    uvAttrName = 'uv',
): [number, number][] | null {
    const uvAttr = geometry.getAttribute(uvAttrName)
    if (!uvAttr) return null

    const index = geometry.getIndex()
    const uvs: [number, number][] = []

    for (let i = 0; i < baryCoords.length; i++) {
        const triIdx = triIndices[i]
        const [b0, b1, b2] = baryCoords[i]

        // Get vertex indices for this triangle
        let v0: number, v1: number, v2: number
        if (index) {
            v0 = index.getX(triIdx * 3)
            v1 = index.getX(triIdx * 3 + 1)
            v2 = index.getX(triIdx * 3 + 2)
        } else {
            v0 = triIdx * 3
            v1 = triIdx * 3 + 1
            v2 = triIdx * 3 + 2
        }

        // Interpolate UV using barycentric coordinates
        // In Blender, bary coords are (w, u, v) where w = 1 - u - v
        // b0 = weight for vertex 0, b1 = weight for vertex 1, b2 = weight for vertex 2
        const u = (uvAttr as any).getX(v0) * b0 + (uvAttr as any).getX(v1) * b1 + (uvAttr as any).getX(v2) * b2
        const v = (uvAttr as any).getY(v0) * b0 + (uvAttr as any).getY(v1) * b1 + (uvAttr as any).getY(v2) * b2

        uvs.push([u, v])
    }

    return uvs
}

// ─── Scatter to Instances ───────────────────────────────────────────
// High-level utility combining distributePointsOnFaces → yUpToZUp → randomRotation → randomScale → fromLocRotScale.
// Eliminates the most common agent bug: forgetting yUpToZUp when building GeneratedInstance[] from scatter results.

import type {DistributePointsOnFacesResult} from './distribute_points_on_faces'
import {randomFloat, randomVector} from './random_value'

/** Options for scatterToInstances. */
export interface ScatterToInstancesOptions {
    /** Asset filename for the GeneratedInstance object_name. */
    objectName: string
    /** Scale range [min, max]. Each instance gets a uniform random scale in this range. */
    scaleRange: [number, number]
    /** Seed for the Random Value scale node. */
    scaleSeed?: number
    /** Seed for the Random Value rotation node. */
    rotationSeed?: number
    /**
     * Rotation range per axis (Euler XYZ) in radians.
     * Default: full random rotation [-PI, PI] on all axes.
     * Pass [0,0] for no rotation on that axis.
     */
    rotationRange?: {min: [number, number, number], max: [number, number, number]}
    /**
     * Optional filter: return false to skip this point.
     * Called with (pointIndex, pointId) from the distribute result.
     */
    filter?: (index: number, id: number) => boolean
    /**
     * Optional per-point object name picker. Overrides objectName.
     * Called with (pointIndex, pointId). Return the GLB filename.
     */
    pickObject?: (index: number, id: number) => string
}

/**
 * Convert scatter results from distributePointsOnFaces into GeneratedInstance[].
 *
 * Handles the full pipeline that every scatter graph needs:
 * 1. Converts Y-up positions (from GLB geometry) to Blender Z-up via yUpToZUp
 * 2. Generates random rotation per point using Blender's randomVector
 * 3. Generates random scale per point using Blender's randomFloat
 * 4. Builds world matrix via fromLocRotScale
 *
 * This eliminates the coordinate conversion bug where agents forget yUpToZUp.
 */
export function scatterToInstances(
    result: DistributePointsOnFacesResult,
    options: ScatterToInstancesOptions,
): {world_matrix: number[], object_name: string}[] {
    const {
        objectName,
        scaleRange,
        scaleSeed = 0,
        rotationSeed = 0,
        rotationRange = {min: [-Math.PI, -Math.PI, -Math.PI], max: [Math.PI, Math.PI, Math.PI]},
        filter,
        pickObject,
    } = options

    const instances: {world_matrix: number[], object_name: string}[] = []

    for (let i = 0; i < result.positions.length; i++) {
        const id = result.ids[i]

        if (filter && !filter(i, id)) continue

        const pos = result.positions[i]
        // GLB geometry is Y-up → convert to Blender Z-up for fromLocRotScale
        const [bx, by, bz] = yUpToZUp(pos.x, pos.y, pos.z)

        const rot = randomVector(rotationRange.min, rotationRange.max, id, rotationSeed)
        const s = randomFloat(scaleRange[0], scaleRange[1], id, scaleSeed)

        instances.push({
            world_matrix: fromLocRotScale(bx, by, bz, rot[0], rot[1], rot[2], s, s, s),
            object_name: pickObject ? pickObject(i, id) : objectName,
        })
    }

    return instances
}
