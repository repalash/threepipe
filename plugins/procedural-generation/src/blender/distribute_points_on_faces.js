/**
 * Port of Blender's GeometryNodeDistributePointsOnFaces.
 *
 * Source files:
 *   - source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
 *   - source/blender/blenlib/BLI_rand.hh (RandomNumberGenerator)
 *   - source/blender/blenlib/intern/rand.cc (round_probabilistic)
 *   - source/blender/blenlib/intern/noise.cc (hash, hash_float, hash_float_to_float)
 *   - source/blender/blenlib/BLI_noise.hh (function declarations)
 *
 * This is a line-by-line port of the Blender C++ implementation.
 * It supports both RANDOM and POISSON distribution methods.
 *
 * Key implementation details:
 *   - Uses Blender's LCG-based RandomNumberGenerator (not JS Math.random)
 *   - Per-triangle RNG seeded with noise::hash(tri_i, seed)
 *   - Point count per tri via round_probabilistic(area * density * densityFactor)
 *   - Barycentric coords via RNG get_barycentric_coordinates
 *   - Poisson mode: oversample then eliminate close points via KDTree
 *   - Point IDs: noise::hash(noise::hash_float(bary_coord), tri_i)
 *   - Seed is multiplied by 5383843 (from node_geo_exec)
 */
import { Vector3 } from 'threepipe';
import { hash2, hash3 } from './noise';
// ─── float_as_uint ─────────────────────────────────────────────────
// source/blender/blenlib/intern/noise.cc — float_as_uint
// Reinterpret a float's bits as a uint32. In C++ this is a union cast.
// In JS we use DataView for the same bit reinterpretation.
const _floatBuf = new ArrayBuffer(4);
const _floatView = new DataView(_floatBuf);
function float_as_uint(f) {
    _floatView.setFloat32(0, f, true); // little-endian
    return _floatView.getUint32(0, true);
}
// ─── noise::hash_float(float3) ─────────────────────────────────────
// source/blender/blenlib/intern/noise.cc lines 210-213
// uint32_t hash_float(float3 k) {
//   return hash(float_as_uint(k.x), float_as_uint(k.y), float_as_uint(k.z));
// }
function hash_float_float3(x, y, z) {
    return hash3(float_as_uint(x), float_as_uint(y), float_as_uint(z));
}
// ─── noise::hash_float_to_float(float3) ────────────────────────────
// source/blender/blenlib/intern/noise.cc lines 264-267
// float hash_float_to_float(float3 k) {
//   return uint_to_float_01(hash_float(k));
// }
function hash_float_to_float_float3(x, y, z) {
    return hash_float_float3(x, y, z) / 0xFFFFFFFF;
}
// ─── RandomNumberGenerator ─────────────────────────────────────────
// source/blender/blenlib/BLI_rand.hh
// source/blender/blenlib/intern/rand.cc
//
// Blender's RNG is a 48-bit Linear Congruential Generator.
// State: uint64_t x_
// step(): x_ = (0x5DEECE66D * x_ + 0xB) & 0x0000FFFFFFFFFFFF
// seed(s): x_ = (uint64(s) << 16) | 0x330E
// get_uint32(): step(); return uint32(x_ >> 17)
// get_int32():  step(); return int32(x_ >> 17)
// get_float():  float(get_int32()) / 0x80000000
//
// NOTE: JavaScript doesn't have native 64-bit integer arithmetic,
// so we use BigInt for the internal state to match Blender exactly.
class RandomNumberGenerator {
    constructor(seed) {
        this.seed(seed);
    }
    // source/blender/blenlib/BLI_rand.hh — seed()
    seed(s) {
        const lowseed = 0x330en;
        this.x_ = ((BigInt(s >>> 0) << 16n) | lowseed);
    }
    // source/blender/blenlib/BLI_rand.hh — step()
    step() {
        const multiplier = 0x5deece66dn;
        const addend = 0xbn;
        const mask = 0x0000ffffffffffffn;
        this.x_ = (multiplier * this.x_ + addend) & mask;
    }
    // source/blender/blenlib/BLI_rand.hh — get_uint32()
    get_uint32() {
        this.step();
        return Number((this.x_ >> 17n) & 0xffffffffn);
    }
    // source/blender/blenlib/BLI_rand.hh — get_int32()
    // In Blender this returns int32_t(x_ >> 17), which is a signed 32-bit value.
    // The key difference: get_float divides by 0x80000000 (2^31),
    // so the result is in [0, 1) because get_int32 returns non-negative values
    // (the top bit of the 48-bit state is shifted to bit 31, but the 48-bit
    // state is always positive, so x_ >> 17 fits in 31 bits => always >= 0).
    get_int32() {
        this.step();
        // x_ is at most 48 bits, x_ >> 17 is at most 31 bits, always non-negative
        return Number(this.x_ >> 17n);
    }
    // source/blender/blenlib/BLI_rand.hh — get_float()
    // return float(this->get_int32()) / 0x80000000;
    get_float() {
        return this.get_int32() / 0x80000000;
    }
    // source/blender/blenlib/BLI_rand.hh — get_barycentric_coordinates()
    get_barycentric_coordinates() {
        let rand1 = this.get_float();
        let rand2 = this.get_float();
        if (rand1 + rand2 > 1.0) {
            rand1 = 1.0 - rand1;
            rand2 = 1.0 - rand2;
        }
        return [rand1, rand2, 1.0 - rand1 - rand2];
    }
    // source/blender/blenlib/intern/rand.cc — round_probabilistic()
    // int RandomNumberGenerator::round_probabilistic(float x)
    // {
    //   const float round_up_probability = fractf(x);
    //   const bool round_up = round_up_probability > this->get_float();
    //   return int(x) + int(round_up);
    // }
    round_probabilistic(x) {
        // fractf in Blender: x - floorf(x)
        const round_up_probability = x - Math.floor(x);
        const round_up = round_up_probability > this.get_float();
        return Math.floor(x) + (round_up ? 1 : 0);
    }
}
// ─── Triangle area ─────────────────────────────────────────────────
// source/blender/blenlib/intern/math_geom.c — area_tri_v3
// Computes area of triangle from 3 vertices: 0.5 * |cross(v1-v0, v2-v0)|
const _edge1 = new Vector3();
const _edge2 = new Vector3();
function area_tri_v3(v0, v1, v2) {
    _edge1.subVectors(v1, v0);
    _edge2.subVectors(v2, v0);
    _edge1.cross(_edge2);
    return _edge1.length() * 0.5;
}
// ─── Triangle face normal ──────────────────────────────────────────
// source/blender/blenlib/intern/math_geom.c — normal_tri_v3
// Computes normalized face normal of a triangle.
function normal_tri_v3(v0, v1, v2, outNormal) {
    _edge1.subVectors(v1, v0);
    _edge2.subVectors(v2, v0);
    outNormal.crossVectors(_edge1, _edge2).normalize();
}
// ─── Interpolation ─────────────────────────────────────────────────
// source/blender/blenlib/intern/math_interp.c — interp_v3_v3v3v3
// Barycentric interpolation: result = v0*bary[0] + v1*bary[1] + v2*bary[2]
function interp_v3_v3v3v3(v0, v1, v2, bary, out) {
    out.set(v0.x * bary[0] + v1.x * bary[1] + v2.x * bary[2], v0.y * bary[0] + v1.y * bary[1] + v2.y * bary[2], v0.z * bary[0] + v1.z * bary[1] + v2.z * bary[2]);
}
function getTriangleData(geometry) {
    const posAttr = geometry.getAttribute('position');
    if (!posAttr)
        throw new Error('distributePointsOnFaces: geometry has no position attribute');
    const index = geometry.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(posAttr.count / 3);
    return {
        triCount,
        getTriVerts(tri_i, v0, v1, v2) {
            let i0, i1, i2;
            if (index) {
                i0 = index.getX(tri_i * 3);
                i1 = index.getX(tri_i * 3 + 1);
                i2 = index.getX(tri_i * 3 + 2);
            }
            else {
                i0 = tri_i * 3;
                i1 = tri_i * 3 + 1;
                i2 = tri_i * 3 + 2;
            }
            v0.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
            v1.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
            v2.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2));
        },
        getTriCornerIndices(tri_i) {
            // In Blender, corner_tris maps to loop indices which then map to vert indices.
            // For BufferGeometry, the index buffer contains vertex indices directly.
            // In Blender's distribute code, density_factors is per-corner (per loop),
            // and corner_tris[tri][0..2] are loop indices.
            // For our case, we use vertex indices as corner indices since
            // BufferGeometry doesn't have separate loop/corner concepts.
            if (index) {
                return [
                    index.getX(tri_i * 3),
                    index.getX(tri_i * 3 + 1),
                    index.getX(tri_i * 3 + 2),
                ];
            }
            return [tri_i * 3, tri_i * 3 + 1, tri_i * 3 + 2];
        },
    };
}
function sample_mesh_surface(triData, base_density, density_factors, seed) {
    const positions = [];
    const baryCoords = [];
    const triIndices = [];
    const v0 = new Vector3();
    const v1 = new Vector3();
    const v2 = new Vector3();
    const point_pos = new Vector3();
    for (let tri_i = 0; tri_i < triData.triCount; tri_i++) {
        triData.getTriVerts(tri_i, v0, v1, v2);
        const [c0, c1, c2] = triData.getTriCornerIndices(tri_i);
        let corner_tri_density_factor = 1.0;
        if (density_factors !== null) {
            const v0_density_factor = Math.max(0.0, density_factors[c0]);
            const v1_density_factor = Math.max(0.0, density_factors[c1]);
            const v2_density_factor = Math.max(0.0, density_factors[c2]);
            corner_tri_density_factor = (v0_density_factor + v1_density_factor + v2_density_factor) / 3.0;
        }
        const area = area_tri_v3(v0, v1, v2);
        // source line 139: const int corner_tri_seed = noise::hash(tri_i, seed);
        const corner_tri_seed = hash2(tri_i, seed);
        const corner_tri_rng = new RandomNumberGenerator(corner_tri_seed);
        // source line 142-143
        const point_amount = corner_tri_rng.round_probabilistic(area * base_density * corner_tri_density_factor);
        for (let i = 0; i < point_amount; i++) {
            const bary_coord = corner_tri_rng.get_barycentric_coordinates();
            interp_v3_v3v3v3(v0, v1, v2, bary_coord, point_pos);
            positions.push(point_pos.clone());
            baryCoords.push(bary_coord);
            triIndices.push(tri_i);
        }
    }
    return { positions, baryCoords, triIndices };
}
class KDTree3D {
    constructor(_capacity) {
        this.nodes = [];
        this.root = -1;
        // Pre-allocate is optional but we just use push
    }
    insert(index, co) {
        this.nodes.push({
            index,
            co: [co.x, co.y, co.z],
            left: -1,
            right: -1,
            axis: 0,
        });
    }
    balance() {
        if (this.nodes.length === 0) {
            this.root = -1;
            return;
        }
        // Build a balanced KDTree by sorting on median split
        const indices = Array.from({ length: this.nodes.length }, (_, i) => i);
        this.root = this._balance(indices, 0);
    }
    _balance(indices, depth) {
        if (indices.length === 0)
            return -1;
        if (indices.length === 1) {
            this.nodes[indices[0]].axis = depth % 3;
            this.nodes[indices[0]].left = -1;
            this.nodes[indices[0]].right = -1;
            return indices[0];
        }
        const axis = depth % 3;
        indices.sort((a, b) => this.nodes[a].co[axis] - this.nodes[b].co[axis]);
        const mid = indices.length >> 1;
        const nodeIdx = indices[mid];
        this.nodes[nodeIdx].axis = axis;
        const leftIndices = indices.slice(0, mid);
        const rightIndices = indices.slice(mid + 1);
        this.nodes[nodeIdx].left = this._balance(leftIndices, depth + 1);
        this.nodes[nodeIdx].right = this._balance(rightIndices, depth + 1);
        return nodeIdx;
    }
    /**
     * Range search: find all points within `radius` of `co`.
     * Calls callback(index, dist_sq) for each found point.
     * If callback returns false, stop searching.
     */
    range_search(co, radius, callback) {
        if (this.root === -1)
            return;
        const radius_sq = radius * radius;
        this._range_search(this.root, [co.x, co.y, co.z], radius_sq, callback);
    }
    _range_search(nodeIdx, co, radius_sq, callback) {
        if (nodeIdx === -1)
            return true;
        const node = this.nodes[nodeIdx];
        const dx = co[0] - node.co[0];
        const dy = co[1] - node.co[1];
        const dz = co[2] - node.co[2];
        const dist_sq = dx * dx + dy * dy + dz * dz;
        if (dist_sq <= radius_sq) {
            if (!callback(node.index, dist_sq))
                return false;
        }
        const axis = node.axis;
        const diff = co[axis] - node.co[axis];
        const diff_sq = diff * diff;
        // Search the side of the splitting plane that contains co first
        const first = diff <= 0 ? node.left : node.right;
        const second = diff <= 0 ? node.right : node.left;
        if (!this._range_search(first, co, radius_sq, callback))
            return false;
        // Only search the other side if the splitting plane is closer than radius
        if (diff_sq <= radius_sq) {
            if (!this._range_search(second, co, radius_sq, callback))
                return false;
        }
        return true;
    }
}
// ─── update_elimination_mask_for_close_points ──────────────────────
// source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
// lines 170-203
//
// For each non-eliminated point, mark all other points within minimum_distance
// as eliminated. This is Blender's spatial elimination for Poisson disk.
function update_elimination_mask_for_close_points(positions, minimum_distance, elimination_mask) {
    if (minimum_distance <= 0.0) {
        return;
    }
    const kdtree = new KDTree3D(positions.length);
    for (let i = 0; i < positions.length; i++) {
        kdtree.insert(i, positions[i]);
    }
    kdtree.balance();
    for (let i = 0; i < positions.length; i++) {
        if (elimination_mask[i]) {
            continue;
        }
        // source lines 190-202: range search, eliminate neighbors
        kdtree.range_search(positions[i], minimum_distance, (index, _dist_sq) => {
            if (index !== i) {
                elimination_mask[index] = true;
            }
            return true; // continue searching
        });
    }
}
// ─── update_elimination_mask_based_on_density_factors ───────────────
// source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
// lines 205-233
//
// For Poisson mode: after distance elimination, further eliminate points
// based on interpolated density factor at each point's barycentric position.
function update_elimination_mask_based_on_density_factors(triData, density_factors, baryCoords, triIndices, elimination_mask) {
    for (let i = 0; i < baryCoords.length; i++) {
        if (elimination_mask[i]) {
            continue;
        }
        const [c0, c1, c2] = triData.getTriCornerIndices(triIndices[i]);
        const bary_coord = baryCoords[i];
        const v0_density_factor = Math.max(0.0, density_factors[c0]);
        const v1_density_factor = Math.max(0.0, density_factors[c1]);
        const v2_density_factor = Math.max(0.0, density_factors[c2]);
        // source line 225-226: barycentric interpolation of density
        const probability = v0_density_factor * bary_coord[0] +
            v1_density_factor * bary_coord[1] +
            v2_density_factor * bary_coord[2];
        // source line 228-229: hash_float_to_float(bary_coord) — hash float3 to [0,1]
        const h = hash_float_to_float_float3(bary_coord[0], bary_coord[1], bary_coord[2]);
        if (h > probability) {
            elimination_mask[i] = true;
        }
    }
}
// ─── eliminate_points_based_on_mask ─────────────────────────────────
// source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
// lines 235-247
//
// Remove-and-reorder (swap with last, then pop) in reverse order.
function eliminate_points_based_on_mask(elimination_mask, positions, baryCoords, triIndices) {
    for (let i = positions.length - 1; i >= 0; i--) {
        if (elimination_mask[i]) {
            // remove_and_reorder: swap with last element, then pop
            const last = positions.length - 1;
            if (i !== last) {
                positions[i] = positions[last];
                baryCoords[i] = baryCoords[last];
                triIndices[i] = triIndices[last];
            }
            positions.pop();
            baryCoords.pop();
            triIndices.pop();
        }
    }
}
// ─── compute normals (legacy mode — face normals) ──────────────────
// source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
// lines 371-395 — compute_legacy_normal_outputs
//
// Blender has two normal modes. Legacy computes flat face normals.
// We use legacy mode since we don't have per-vertex normals from Blender's
// mesh system. If the geometry has vertex normals, we interpolate those instead.
function compute_normals(geometry, triData, baryCoords, triIndices) {
    const normals = [];
    const normalAttr = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const v0 = new Vector3();
    const v1 = new Vector3();
    const v2 = new Vector3();
    if (normalAttr) {
        // Interpolate vertex normals (similar to Blender's MeshNormalDomain::Point path)
        for (let i = 0; i < baryCoords.length; i++) {
            const tri_i = triIndices[i];
            const bary = baryCoords[i];
            let i0, i1, i2;
            if (index) {
                i0 = index.getX(tri_i * 3);
                i1 = index.getX(tri_i * 3 + 1);
                i2 = index.getX(tri_i * 3 + 2);
            }
            else {
                i0 = tri_i * 3;
                i1 = tri_i * 3 + 1;
                i2 = tri_i * 3 + 2;
            }
            const nx = normalAttr.getX(i0) * bary[0] + normalAttr.getX(i1) * bary[1] + normalAttr.getX(i2) * bary[2];
            const ny = normalAttr.getY(i0) * bary[0] + normalAttr.getY(i1) * bary[1] + normalAttr.getY(i2) * bary[2];
            const nz = normalAttr.getZ(i0) * bary[0] + normalAttr.getZ(i1) * bary[1] + normalAttr.getZ(i2) * bary[2];
            const n = new Vector3(nx, ny, nz);
            n.normalize();
            normals.push(n);
        }
    }
    else {
        // Legacy face normal path (compute_legacy_normal_outputs)
        const outNormal = new Vector3();
        for (let i = 0; i < baryCoords.length; i++) {
            const tri_i = triIndices[i];
            triData.getTriVerts(tri_i, v0, v1, v2);
            normal_tri_v3(v0, v1, v2, outNormal);
            normals.push(outNormal.clone());
        }
    }
    return normals;
}
// ─── compute point IDs ─────────────────────────────────────────────
// source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
// lines 431-436
//
// ids.span[i] = noise::hash(noise::hash_float(bary_coord), tri_i);
// noise::hash_float(float3) = hash(float_as_uint(x), float_as_uint(y), float_as_uint(z))
function compute_point_ids(baryCoords, triIndices) {
    const ids = [];
    for (let i = 0; i < baryCoords.length; i++) {
        const bary = baryCoords[i];
        const bary_hash = hash_float_float3(bary[0], bary[1], bary[2]);
        ids.push(hash2(bary_hash, triIndices[i]));
    }
    return ids;
}
/**
 * Port of Blender's GeometryNodeDistributePointsOnFaces.
 *
 * Distributes points on the surface of a triangulated mesh geometry.
 *
 * RANDOM mode: For each triangle, computes an expected point count from
 * area * density * densityFactor, uses round_probabilistic to get the actual
 * count, then generates random barycentric coordinates for each point.
 *
 * POISSON mode: First oversamples the surface at densityMax, then eliminates
 * points closer than minDistance using a KDTree, then further eliminates
 * points based on per-vertex density factors.
 *
 * @param geometry - A three.js BufferGeometry (must have position attribute, triangulated)
 * @param options - Distribution options matching Blender's node interface
 * @returns positions, normals, and deterministic IDs for each generated point
 */
export function distributePointsOnFaces(geometry, options) {
    // source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
    // line 588: const int seed = params.extract_input<int>("Seed") * 5383843;
    const seed = Math.imul(options.seed, 5383843) >>> 0;
    const triData = getTriangleData(geometry);
    if (triData.triCount === 0) {
        return { positions: [], normals: [], ids: [], baryCoords: [], triIndices: [] };
    }
    let positions;
    let baryCoords;
    let triIndices;
    if (options.method === 'RANDOM') {
        // source lines 473-484: distribute_points_random
        // In Blender, RANDOM mode passes the per-corner density field as the density_factors
        // parameter to sample_mesh_surface with base_density=1.0.
        // The density field IS the density (points per unit area).
        // So: base_density = 1.0, density_factors per corner = density value.
        //
        // However, in our simplified interface, we have a scalar density and optional
        // per-vertex densityFactor array. We combine them:
        // - base_density = options.density
        // - density_factors = options.densityFactor (per vertex, optional)
        const result = sample_mesh_surface(triData, options.density, options.densityFactor ?? null, seed);
        positions = result.positions;
        baryCoords = result.baryCoords;
        triIndices = result.triIndices;
    }
    else {
        // POISSON mode
        // source lines 486-508: distribute_points_poisson_disk
        // Step 1: Oversample at max_density with no density factors
        const result = sample_mesh_surface(triData, options.density, // Density Max
        null, // no density factors for initial sampling
        seed);
        positions = result.positions;
        baryCoords = result.baryCoords;
        triIndices = result.triIndices;
        // Step 2: Eliminate points closer than minimum_distance
        const elimination_mask = new Array(positions.length).fill(false);
        update_elimination_mask_for_close_points(positions, options.minDistance ?? 0, elimination_mask);
        // Step 3: Eliminate based on density factors (if provided)
        if (options.densityFactor) {
            update_elimination_mask_based_on_density_factors(triData, options.densityFactor, baryCoords, triIndices, elimination_mask);
        }
        // Step 4: Remove eliminated points
        eliminate_points_based_on_mask(elimination_mask, positions, baryCoords, triIndices);
    }
    if (positions.length === 0) {
        return { positions: [], normals: [], ids: [], baryCoords: [], triIndices: [] };
    }
    // Compute normals
    const normals = compute_normals(geometry, triData, baryCoords, triIndices);
    // Compute point IDs
    const ids = compute_point_ids(baryCoords, triIndices);
    return { positions, normals, ids, baryCoords, triIndices };
}
